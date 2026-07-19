import type { BuiltTrack, TrackProfile } from '../../src/core/model';
import { authoredCurbAt, normalLateralEnvelope } from '../../src/core/surface';
import { mulberry32 } from '../../src/shared/rng';
import {
  evaluateProfileAnalytically,
  PROFILE_LAP_TIME_RATIO_ACCEPTABLE,
  profileFromFinalist,
  validateProfileFinalist,
  type AnalyticalEvaluation,
  type FinalistEvaluation
} from './profile-evaluate';

export interface ProfileSearchOptions {
  seed: number;
  maxEvaluations: number;
  budgetSeconds: number;
  searchDeadlineAt?: number;
  validationDeadlineAt?: number;
  now?: () => number;
  onProgress?: (event: ProfileSearchProgress) => void;
}

export interface ProfileSearchProgress {
  phase: 'search' | 'validation';
  stage: string;
  evaluations: number;
  maximumEvaluations: number;
  candidateId?: string;
  valid?: boolean;
}

export interface ProfileSearchSummary {
  variableCount: number;
  totalMutableAnchors: number;
  evaluations: number;
  rejectedBeforeEvaluation: number;
  cacheHits: number;
  deadlineReached: boolean;
  evaluationCapReached: boolean;
  simplifications: string[];
  pareto: AnalyticalEvaluation[];
  ranked: AnalyticalEvaluation[];
}

export interface ProfileOptimizationResult {
  incumbent: FinalistEvaluation;
  selected: FinalistEvaluation;
  selectedProfile: TrackProfile;
  finalists: FinalistEvaluation[];
  search: ProfileSearchSummary;
  verifiedImprovementSeconds: number;
  predictedImprovementSeconds: number;
  bestFoundNotGlobal: true;
  timings: { searchMilliseconds: number; validationMilliseconds: number };
}

function analyticalOrder(left: AnalyticalEvaluation, right: AnalyticalEvaluation): number {
  if (left.valid !== right.valid) return left.valid ? -1 : 1;
  return left.predictedLapTime - right.predictedLapTime ||
    left.trackingDemand - right.trackingDemand ||
    left.smoothness - right.smoothness ||
    left.id.localeCompare(right.id);
}

function finalistOrder(left: FinalistEvaluation, right: FinalistEvaluation): number {
  if (left.valid !== right.valid) return left.valid ? -1 : 1;
  return left.robustLapTime - right.robustLapTime ||
    left.maximumTrackingError - right.maximumTrackingError ||
    left.analytical.smoothness - right.analytical.smoothness ||
    left.analytical.id.localeCompare(right.analytical.id);
}

function dominates(left: AnalyticalEvaluation, right: AnalyticalEvaluation): boolean {
  if (!left.valid) return false;
  if (!right.valid) return true;
  const noWorse = left.predictedLapTime <= right.predictedLapTime &&
    left.smoothness <= right.smoothness && left.trackingDemand <= right.trackingDemand;
  const better = left.predictedLapTime < right.predictedLapTime ||
    left.smoothness < right.smoothness || left.trackingDemand < right.trackingDemand;
  return noWorse && better;
}

function paretoSet(candidates: readonly AnalyticalEvaluation[], limit = 16): AnalyticalEvaluation[] {
  const unique = new Map(candidates.map(candidate => [candidate.id, candidate]));
  return [...unique.values()].filter(candidate => candidate.valid &&
    ![...unique.values()].some(other => other.id !== candidate.id && dominates(other, candidate))
  ).sort(analyticalOrder).slice(0, limit);
}

function mutableAnchorIndices(profile: TrackProfile): {
  indices: number[];
  total: number;
  simplified: boolean;
} {
  const all = profile.anchors.map((anchor, index) => ({ anchor, index }))
    .filter(item => Math.abs(item.anchor.lateral) > 1e-9)
    .map(item => item.index);
  if (all.length <= 36) return { indices: all, total: all.length, simplified: false };
  const selected = Array.from({ length: 36 }, (_unused, index) =>
    all[Math.round(index * (all.length - 1) / 35)]!
  );
  return { indices: [...new Set(selected)], total: all.length, simplified: true };
}

function changedProfile(
  source: TrackProfile,
  changes: ReadonlyMap<number, number>
): TrackProfile {
  const {
    cornerLines: _cornerLines,
    cornerLineOptimizerVersion: _cornerLineOptimizerVersion,
    cornerLineProvenance: _cornerLineProvenance,
    ...idealProfile
  } = source;
  return {
    ...idealProfile,
    anchors: source.anchors.map((anchor, index) => ({
      ...anchor,
      lateral: changes.get(index) ?? anchor.lateral
    }))
  };
}

export function searchTrackProfile(
  built: BuiltTrack,
  incumbent: TrackProfile,
  options: ProfileSearchOptions
): ProfileSearchSummary {
  if (!Number.isInteger(options.maxEvaluations) || options.maxEvaluations <= 0)
    throw new Error('maxEvaluations must be a positive integer');
  const now = options.now ?? performance.now.bind(performance);
  const expired = (): boolean => options.searchDeadlineAt !== undefined &&
    now() >= options.searchDeadlineAt;
  const variables = mutableAnchorIndices(incumbent);
  const simplifications: string[] = [];
  simplifications.push(
    'broad search uses analytical footprint surface penalties; production physics validates finalists'
  );
  if (variables.simplified)
    simplifications.push(`mutable anchors reduced from ${variables.total} to ${variables.indices.length}`);
  const cache = new Map<string, AnalyticalEvaluation>();
  let evaluations = 0;
  let rejectedBeforeEvaluation = 0;
  let cacheHits = 0;
  const progressEvery = Math.max(1, Math.floor(options.maxEvaluations / 50));
  const evaluate = (profile: TrackProfile): AnalyticalEvaluation | null => {
    const key = profile.anchors.map(anchor => anchor.lateral.toFixed(6)).join(',');
    const cached = cache.get(key);
    if (cached) {
      cacheHits++;
      return cached;
    }
    if (evaluations >= options.maxEvaluations || expired()) return null;
    const evaluated = evaluateProfileAnalytically(built, profile);
    cache.set(key, evaluated);
    evaluations++;
    if (evaluations === 1 || evaluations % progressEvery === 0 ||
        evaluations === options.maxEvaluations)
      options.onProgress?.({
        phase: 'search',
        stage: 'analytical-evaluation',
        evaluations,
        maximumEvaluations: options.maxEvaluations,
        candidateId: evaluated.id,
        valid: evaluated.valid
      });
    return evaluated;
  };
  const baseline = evaluate(incumbent);
  if (!baseline?.valid) throw new Error(`Safe incumbent is invalid: ${baseline?.rejection ?? 'deadline'}`);
  const all: AnalyticalEvaluation[] = [baseline];
  let frontier: AnalyticalEvaluation[] = [baseline];
  const random = mulberry32(options.seed);
  const anchorSample = (index: number): number =>
    ((Math.round(incumbent.anchors[index]!.sFraction * built.tr.n) % built.tr.n) +
      built.tr.n) % built.tr.n;
  const directionalLimit = (index: number): number => {
    const original = incumbent.anchors[index]!.lateral;
    const envelope = normalLateralEnvelope(built.tr, anchorSample(index));
    return original > 0 ? envelope.maximum : -envelope.minimum;
  };
  const feasibleValue = (index: number, value: number): boolean => {
    const original = incumbent.anchors[index]!.lateral;
    const limit = directionalLimit(index);
    return Math.abs(value) <= limit + 1e-9 &&
      Math.sign(value) === Math.sign(original) &&
      Math.abs(value) >= Math.min(Math.abs(original), limit * 0.15);
  };
  // Probe normalized legal extents first. Unlike metre-only local steps, this
  // makes authored curb space reachable without adding a track-specific knob.
  const curbReachableIndices = variables.indices.filter(index => {
    const side = Math.sign(incumbent.anchors[index]!.lateral) as -1 | 1;
    return authoredCurbAt(built.tr, anchorSample(index), side);
  });
  const extentFractions = [0.8, 0.92, 1] as const;
  for (const centre of frontier) {
    if (evaluations >= options.maxEvaluations || expired()) break;
    for (const index of curbReachableIndices) {
      const sign = Math.sign(incumbent.anchors[index]!.lateral);
      for (const fraction of extentFractions) {
        const value = sign * directionalLimit(index) * fraction;
        if (!feasibleValue(index, value)) {
          rejectedBeforeEvaluation++;
          continue;
        }
        const candidate = evaluate(changedProfile(centre.profile, new Map([[index, value]])));
        if (!candidate) break;
        all.push(candidate);
      }
      if (evaluations >= options.maxEvaluations || expired()) break;
    }
  }
  frontier = paretoSet(all).slice(0, 4);
  if (!frontier.length) frontier = [baseline];
  const stepSizes = [0.5, 0.25, 0.12, 0.06];
  for (let stage = 0; stage < stepSizes.length; stage++) {
    if (evaluations >= options.maxEvaluations || expired()) break;
    const step = stepSizes[stage]!;
    options.onProgress?.({
      phase: 'search',
      stage: `pattern-step-${step}`,
      evaluations,
      maximumEvaluations: options.maxEvaluations
    });
    const generated: AnalyticalEvaluation[] = [];
    for (const centre of frontier) {
      for (const index of variables.indices) {
        for (const direction of [-1, 1] as const) {
          const value = centre.profile.anchors[index]!.lateral + direction * step;
          if (!feasibleValue(index, value)) {
            rejectedBeforeEvaluation++;
            continue;
          }
          const candidate = evaluate(changedProfile(centre.profile, new Map([[index, value]])));
          if (!candidate) break;
          generated.push(candidate);
        }
        if (evaluations >= options.maxEvaluations || expired()) break;
      }
      if (evaluations >= options.maxEvaluations || expired()) break;
    }
    const restartBase = [...all, ...generated].sort(analyticalOrder)[0] ?? baseline;
    for (let restart = 0; restart < 6 && evaluations < options.maxEvaluations && !expired(); restart++) {
      const changes = new Map<number, number>();
      let feasible = true;
      for (const index of variables.indices) {
        const value = restartBase.profile.anchors[index]!.lateral + (random() * 2 - 1) * step;
        if (!feasibleValue(index, value)) {
          feasible = false;
          break;
        }
        changes.set(index, value);
      }
      if (!feasible) {
        rejectedBeforeEvaluation++;
        continue;
      }
      const candidate = evaluate(changedProfile(restartBase.profile, changes));
      if (candidate) generated.push(candidate);
    }
    all.push(...generated);
    const pareto = paretoSet(all);
    const survivorCount = Math.max(1, 4 >> stage);
    frontier = pareto.slice(0, survivorCount);
    if (!frontier.length) frontier = [baseline];
  }
  const ranked = [...new Map(all.map(candidate => [candidate.id, candidate])).values()]
    .sort(analyticalOrder);
  return {
    variableCount: variables.indices.length,
    totalMutableAnchors: variables.total,
    evaluations,
    rejectedBeforeEvaluation,
    cacheHits,
    deadlineReached: expired(),
    evaluationCapReached: evaluations >= options.maxEvaluations,
    simplifications,
    pareto: paretoSet(ranked),
    ranked
  };
}

export function optimizeTrackProfile(
  built: BuiltTrack,
  incumbent: TrackProfile,
  options: ProfileSearchOptions
): ProfileOptimizationResult {
  const searchStarted = performance.now();
  const search = searchTrackProfile(built, incumbent, options);
  const searchFinished = performance.now();
  const baseline = evaluateProfileAnalytically(built, incumbent);
  const candidates = [baseline, ...search.pareto, ...search.ranked]
    .filter((candidate, index, values) =>
      values.findIndex(other => other.id === candidate.id) === index && candidate.valid
    );
  const nonBaseline = candidates.filter(candidate => candidate.id !== baseline.id)
    .sort(analyticalOrder).slice(0, 7);
  const finalistsToValidate = [baseline, ...nonBaseline];
  const finalists: FinalistEvaluation[] = [];
  for (let index = 0; index < finalistsToValidate.length; index++) {
    const candidate = finalistsToValidate[index]!;
    options.onProgress?.({
      phase: 'validation',
      stage: `finalist-${index + 1}/${finalistsToValidate.length}`,
      evaluations: search.evaluations + index,
      maximumEvaluations: options.maxEvaluations,
      candidateId: candidate.id,
      valid: candidate.valid
    });
    const finalist = validateProfileFinalist(built, candidate, {
      seed: options.seed + index * 17,
      ...(options.validationDeadlineAt === undefined
        ? {}
        : { deadlineAt: options.validationDeadlineAt }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    finalists.push(finalist);
    if (options.validationDeadlineAt !== undefined &&
        (options.now ?? performance.now.bind(performance))() >= options.validationDeadlineAt) break;
  }
  const incumbentFinalist = finalists[0]!;
  if (!incumbentFinalist?.valid)
    throw new Error(`Safe incumbent failed final validation: ${incumbentFinalist?.rejection ?? 'unknown'}`);
  const acceptableNominalLap = incumbentFinalist.measuredLapTime *
    PROFILE_LAP_TIME_RATIO_ACCEPTABLE;
  for (const finalist of finalists.slice(1)) {
    if (!finalist.valid || finalist.measuredLapTime <= acceptableNominalLap + 1e-9) continue;
    finalist.valid = false;
    finalist.rejection =
      `nominal lap-time ratio exceeds acceptable ${PROFILE_LAP_TIME_RATIO_ACCEPTABLE} boundary`;
  }
  const selected = [...finalists].sort(finalistOrder)[0]!;
  const validationFinished = performance.now();
  const totalEvaluations = search.evaluations + finalists.length;
  return {
    incumbent: incumbentFinalist,
    selected,
    selectedProfile: profileFromFinalist(selected, {
      seed: options.seed,
      budgetSeconds: options.budgetSeconds,
      evaluations: totalEvaluations
    }),
    finalists,
    search,
    verifiedImprovementSeconds: incumbentFinalist.measuredLapTime - selected.measuredLapTime,
    predictedImprovementSeconds: baseline.predictedLapTime - selected.analytical.predictedLapTime,
    bestFoundNotGlobal: true,
    timings: {
      searchMilliseconds: searchFinished - searchStarted,
      validationMilliseconds: validationFinished - searchFinished
    }
  };
}
