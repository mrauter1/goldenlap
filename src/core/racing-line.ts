import { clamp, lerp, normAng } from '../shared/math';
import { cornerSpeedForGrip, PHYS } from './physics';
import {
  normalLateralEnvelope,
  normalLateralIsLegal,
  roadLateralEnvelope,
  roadLateralEnvelopeAt,
  surfaceExposureAtLateral
} from './surface';
import {
  denseArray, integerArray, numericArray,
  type DenseArray, type LegacyCorner, type NumericArray, type PathGeometry,
  type PathMode, type SampledPath, type SpeedProfile, type Track, type TrackProfile
} from './model';

/**
 * Frozen Phase 0 line constructor. It remains available only as the
 * deterministic candidate oracle used by the semantic-corner migration.
 * The production ideal path is built by {@link racingLine} once corners have
 * been detected.
 */
export function legacyRacingLine(track: Track): SampledPath {
  const N = track.n, S = 4;
  let off = numericArray(N);
  // Pull every sample toward the chord across its neighbours. Iterating the
  // local projection produces the familiar outside-apex-outside path while
  // the road-width clamp keeps the result usable by the physics model.
  for (let sweep = 0; sweep < 300; sweep++){
    for (let i = 0; i < N; i++){
      const p = (i - S + N) % N, q = (i + S) % N;
      const px = track.x[p]! + track.nx[p]! * off[p]!;
      const py = track.y[p]! + track.ny[p]! * off[p]!;
      const qx = track.x[q]! + track.nx[q]! * off[q]!;
      const qy = track.y[q]! + track.ny[q]! * off[q]!;
      const dx = qx - px, dy = qy - py;
      const u = clamp(((track.x[i]! - px) * dx + (track.y[i]! - py) * dy) /
        Math.max(1e-9, dx * dx + dy * dy), 0, 1);
      const tx = px + dx * u, ty = py + dy * u;
      const target = (tx - track.x[i]!) * track.nx[i]! + (ty - track.y[i]!) * track.ny[i]!;
      const envelope = normalLateralEnvelope(track, i);
      off[i] = clamp(
        off[i]! + (target - off[i]!) * 0.25,
        envelope.minimum,
        envelope.maximum
      );
    }
  }
  const sm = numericArray(N);
  for (let i = 0; i < N; i++){
    let sum = 0;
    for (let d = -3; d <= 3; d++) sum += off[(i + d + N) % N]!;
    sm[i] = sum / 7;
  }
  off = sm;

  // A cyclic interval is zero inside and eases back to one outside it.
  const fadeOutside = (s: number, a: number, b: number, ramp: number): number => {
    const span = ((b - a) % track.len + track.len) % track.len;
    const w = ((s - a) % track.len + track.len) % track.len;
    if (w <= span) return 0;
    const d = Math.min(w - span, track.len - w);
    const u = clamp(d / ramp, 0, 1);
    return u * u * (3 - 2 * u);
  };
  const pitA = ((track.pit.sEntry - 80) % track.len + track.len) % track.len;
  const pitB = (track.pit.sExit + 30) % track.len;
  const startA = track.len - 25, startB = 25;
  for (let i = 0; i < N; i++){
    const s = i * track.step;
    off[i] = off[i]! * Math.min(fadeOutside(s, pitA, pitB, 35), fadeOutside(s, startA, startB, 25));
  }

  const x = numericArray(N), y = numericArray(N);
  const tx = numericArray(N), ty = numericArray(N);
  const hd = numericArray(N), rawK = numericArray(N), k = numericArray(N);
  const ds = numericArray(N);
  for (let i = 0; i < N; i++){
    x[i] = track.x[i]! + track.nx[i]! * off[i]!;
    y[i] = track.y[i]! + track.ny[i]! * off[i]!;
  }
  for (let i = 0; i < N; i++){
    const p = (i - 1 + N) % N, q = (i + 1) % N;
    ds[i] = Math.max(0.1, Math.hypot(x[q]! - x[i]!, y[q]! - y[i]!));
    const dx = x[q]! - x[p]!, dy = y[q]! - y[p]!;
    const l = Math.max(1e-9, Math.hypot(dx, dy));
    tx[i] = dx / l; ty[i] = dy / l; hd[i] = Math.atan2(ty[i]!, tx[i]!);
  }
  for (let i = 0; i < N; i++){
    const p = (i - 1 + N) % N, q = (i + 1) % N;
    rawK[i] = normAng(hd[q]! - hd[p]!) / Math.max(0.2, ds[p]! + ds[i]!);
  }
  for (let i = 0; i < N; i++){
    let sum = 0;
    for (let d = -3; d <= 3; d++) sum += rawK[(i + d + N) % N]!;
    k[i] = sum / 7;
  }
  const profile = speedProfile(track, { k, ds, off });
  return { mode: 'ideal', off, k, ds, v: profile.v };
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

export function derivePathGeometry(track: Track, path: Pick<SampledPath, 'off'>): PathGeometry {
  const count = track.n;
  const x = numericArray(count);
  const y = numericArray(count);
  const tx = numericArray(count);
  const ty = numericArray(count);
  for (let index = 0; index < count; index++) {
    x[index] = track.x[index]! + track.nx[index]! * path.off[index]!;
    y[index] = track.y[index]! + track.ny[index]! * path.off[index]!;
  }
  for (let index = 0; index < count; index++) {
    const previous = (index - 1 + count) % count;
    const next = (index + 1) % count;
    const dx = x[next]! - x[previous]!;
    const dy = y[next]! - y[previous]!;
    const length = Math.max(1e-9, Math.hypot(dx, dy));
    tx[index] = dx / length;
    ty[index] = dy / length;
  }
  return { x, y, tx, ty };
}

export function materializePath(
  track: Track,
  off: NumericArray,
  mode: PathMode = 'ideal'
): SampledPath {
  const count = track.n;
  const x = numericArray(count);
  const y = numericArray(count);
  const heading = numericArray(count);
  const rawCurvature = numericArray(count);
  const curvature = numericArray(count);
  const distance = numericArray(count);
  for (let index = 0; index < count; index++) {
    x[index] = track.x[index]! + track.nx[index]! * off[index]!;
    y[index] = track.y[index]! + track.ny[index]! * off[index]!;
  }
  for (let index = 0; index < count; index++) {
    const previous = (index - 1 + count) % count;
    const next = (index + 1) % count;
    distance[index] = Math.max(0.1, Math.hypot(x[next]! - x[index]!, y[next]! - y[index]!));
    const dx = x[next]! - x[previous]!;
    const dy = y[next]! - y[previous]!;
    // atan2 is invariant under positive scalar division. The normalized
    // tangent arrays were not part of SampledPath, so allocating them and
    // computing a second hypot per sample had no observable purpose.
    heading[index] = Math.atan2(dy, dx);
  }
  for (let index = 0; index < count; index++) {
    const previous = (index - 1 + count) % count;
    const next = (index + 1) % count;
    rawCurvature[index] = normAng(heading[next]! - heading[previous]!) /
      Math.max(0.2, distance[previous]! + distance[index]!);
  }
  for (let index = 0; index < count; index++) {
    let sum = 0;
    for (let delta = -3; delta <= 3; delta++)
      sum += rawCurvature[(index + delta + count) % count]!;
    curvature[index] = sum / 7;
  }
  const profile = speedProfile(track, { k: curvature, ds: distance, off });
  return { mode, off, k: curvature, ds: distance, v: profile.v };
}

interface LineAnchor {
  index: number;
  offset: number;
  priority: number;
}

interface PlannedCornerAnchor {
  corner: LegacyCorner;
  turnInI: number;
  trackOutI: number;
}

interface IdealLineCandidate {
  path: SampledPath;
  timing: SpeedProfile;
  planned: DenseArray<PlannedCornerAnchor>;
  spanLimit: number;
  lateralUtilization: number;
  maxHeadingStep: number;
}

export interface IdealLinePreview {
  path: SampledPath;
  timing: SpeedProfile;
  phaseMarkers: DenseArray<{
    cornerId: string;
    turnInI: number;
    apexI: number;
    trackOutI: number;
  }>;
  spanLimit: number;
  lateralUtilization: number;
  maxHeadingStep: number;
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function distanceAhead(track: Track, from: number, to: number): number {
  return ((to - from + track.n) % track.n) * track.step;
}

function buildOffsetPath(track: Track, sourceAnchors: readonly LineAnchor[]): SampledPath {
  const byIndex = new Map<number, LineAnchor>();
  for (const source of sourceAnchors) {
    const anchor = { ...source, index: cyclicIndex(track, source.index) };
    const previous = byIndex.get(anchor.index);
    if (!previous || anchor.priority > previous.priority) byIndex.set(anchor.index, anchor);
    else if (anchor.priority === previous.priority && Math.abs(anchor.offset - previous.offset) > 1e-9)
      throw new Error(
        `Contradictory ideal-line anchors on ${track.def.id} at sample ${anchor.index}`
      );
  }
  const anchors = [...byIndex.values()].sort((left, right) => left.index - right.index);
  if (anchors.length < 2)
    throw new Error(`Track ${track.def.id} needs at least two ideal-line anchors`);
  const off = numericArray(track.n);
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex++) {
    const from = anchors[anchorIndex]!;
    const to = anchors[(anchorIndex + 1) % anchors.length]!;
    const span = (to.index - from.index + track.n) % track.n || track.n;
    for (let delta = 0; delta < span; delta++) {
      const progress = delta / span;
      off[(from.index + delta) % track.n] = lerp(
        from.offset,
        to.offset,
        smootherstep(progress)
      );
    }
  }
  for (const anchor of anchors) off[anchor.index] = anchor.offset;
  return materializePath(track, off, 'ideal');
}

export function materializeTrackProfile(track: Track, profile: TrackProfile): SampledPath {
  if (profile.schemaVersion !== 1)
    throw new Error(`Unsupported profile schema ${String(profile.schemaVersion)}`);
  if (profile.trackId !== track.def.id)
    throw new Error(`Profile ${profile.trackId} does not match track ${track.def.id}`);
  if (profile.anchors.length < 2)
    throw new Error(`Profile ${profile.trackId} needs at least two anchors`);
  const seen = new Set<number>();
  const anchors = profile.anchors.map(anchor => {
    if (!Number.isFinite(anchor.sFraction) || anchor.sFraction < 0 || anchor.sFraction >= 1)
      throw new Error(`Profile ${profile.trackId} has invalid longitudinal anchor`);
    const index = cyclicIndex(track, Math.round(anchor.sFraction * track.n));
    if (!Number.isFinite(anchor.lateral) ||
        !normalLateralIsLegal(track, index, anchor.lateral))
      throw new Error(`Profile ${profile.trackId} has out-of-bounds lateral anchor`);
    if (seen.has(index))
      throw new Error(`Profile ${profile.trackId} has duplicate sample anchor ${index}`);
    seen.add(index);
    return { index, offset: anchor.lateral, priority: 1 };
  });
  const path = buildOffsetPath(track, anchors);
  const timing = speedProfile(track, path);
  path.v = timing.v;
  return path;
}

export function applyPathAuthority(
  track: Track,
  path: SampledPath,
  timing: SpeedProfile = speedProfile(track, path)
): void {
  for (const corner of track.corners ?? []) {
    corner.entryTarget = path.off[corner.turnInI]!;
    corner.apexTarget = path.off[corner.apexI]!;
    corner.exitTarget = path.off[corner.trackOutI]!;
    corner.vApex = timing.v[corner.apexI]!;
    corner.severity = clamp(1 - corner.vApex / PHYS.vTop, 0, 1);
    let brakeI = brakingStartForCorner(track, timing.v, corner.apexI);
    const brakeToApex = distanceAhead(track, brakeI, corner.apexI);
    const turnInToApex = distanceAhead(track, corner.turnInI, corner.apexI);
    if (brakeToApex <= turnInToApex)
      brakeI = cyclicIndex(
        track,
        corner.turnInI - Math.max(2, Math.round(12 / track.step))
      );
    corner.brakeI = brakeI;
    corner.approachI = cyclicIndex(
      track,
      brakeI - Math.max(3, Math.round(40 / track.step))
    );
    corner.exitI = cyclicIndex(
      track,
      corner.trackOutI + Math.max(3, Math.round(35 / track.step))
    );
    if (!corner.reason.includes('+profile-path-authority'))
      corner.reason += '+profile-path-authority';
  }
  if (track.corners) rebuildCornerLookup(track, track.corners);
}

function neutralLineRequiredAt(track: Track, index: number): boolean {
  const pitStart = ((track.pit.sEntry - 80) % track.len + track.len) % track.len;
  const pitEnd = (track.pit.sExit + 30) % track.len;
  const pitSpan = ((pitEnd - pitStart) % track.len + track.len) % track.len;
  const s = cyclicIndex(track, index) * track.step;
  const startDistance = Math.min(s, track.len - s);
  const pitPosition = ((s - pitStart) % track.len + track.len) % track.len;
  return startDistance <= 24 ||
    (pitPosition > track.step && pitPosition < pitSpan - track.step);
}

function neutralLineAnchors(track: Track): DenseArray<LineAnchor> {
  const anchors = denseArray<LineAnchor>();
  for (let index = 0; index < track.n; index++)
    if (neutralLineRequiredAt(track, index))
      anchors.push({ index, offset: 0, priority: 100 });
  return anchors;
}

function chooseComplexPrimary(
  members: readonly LegacyCorner[],
  centerProfile: SpeedProfile
): LegacyCorner {
  let best = members[0]!;
  let bestScore = -Infinity;
  for (const corner of members) {
    // Severity protects the important apex; exit speed rewards the corner
    // whose setup carries the most time into the following acceleration zone.
    const score = corner.severity + centerProfile.v[corner.exitI]! / PHYS.vTop;
    if (score > bestScore + 1e-12 ||
        (Math.abs(score - bestScore) <= 1e-12 && corner.apexI < best.apexI)) {
      best = corner;
      bestScore = score;
    }
  }
  return best;
}

function lineRepresentatives(
  track: Track,
  centerProfile: SpeedProfile
): DenseArray<LegacyCorner> {
  const representatives = denseArray<LegacyCorner>();
  const grouped = new Map<string, DenseArray<LegacyCorner>>();
  for (const corner of track.corners || []) {
    if (!corner.complexId) {
      representatives.push(corner);
      continue;
    }
    const group = grouped.get(corner.complexId) ?? denseArray<LegacyCorner>();
    group.push(corner);
    grouped.set(corner.complexId, group);
  }
  for (const members of grouped.values())
    representatives.push(chooseComplexPrimary(members, centerProfile));
  representatives.sort((left, right) => left.apexI - right.apexI);
  return representatives;
}

function maxPathHeadingStep(track: Track, path: SampledPath): number {
  const geometry = derivePathGeometry(track, path);
  let maximum = 0;
  for (let index = 0; index < track.n; index++) {
    const next = (index + 1) % track.n;
    const currentHeading = Math.atan2(geometry.ty[index]!, geometry.tx[index]!);
    const nextHeading = Math.atan2(geometry.ty[next]!, geometry.tx[next]!);
    maximum = Math.max(maximum, Math.abs(normAng(nextHeading - currentHeading)));
  }
  return maximum;
}

function candidateIsSafe(track: Track, candidate: IdealLineCandidate): boolean {
  if (!Number.isFinite(candidate.timing.lapTime) || candidate.maxHeadingStep > 0.18) return false;
  for (let index = 0; index < track.n; index++) {
    const offset = candidate.path.off[index]!;
    const curvature = candidate.path.k[index]!;
    const distance = candidate.path.ds[index]!;
    const speed = candidate.path.v[index]!;
    if (!Number.isFinite(offset) || !Number.isFinite(curvature) ||
        !Number.isFinite(distance) || !Number.isFinite(speed)) return false;
    if (!normalLateralIsLegal(track, index, offset) || distance < 0.2) return false;
  }
  return true;
}

function buildIdealLineCandidate(
  track: Track,
  centerProfile: SpeedProfile,
  representatives: readonly LegacyCorner[],
  spanLimit: number,
  lateralUtilization: number
): IdealLineCandidate {
  const planned = denseArray<PlannedCornerAnchor>();
  const anchors = neutralLineAnchors(track);
  const envelopeTarget = (
    sample: number,
    direction: -1 | 1,
    roadFraction: number
  ): number => {
    const envelope = normalLateralEnvelope(track, sample);
    const road = roadLateralEnvelopeAt(track, sample);
    const roadTarget = (direction > 0 ? road.maximum : road.minimum) * roadFraction;
    return direction > 0
      ? Math.min(envelope.maximum, roadTarget)
      : Math.max(envelope.minimum, roadTarget);
  };
  for (let index = 0; index < representatives.length; index++) {
    const corner = representatives[index]!;
    const previous = representatives[(index - 1 + representatives.length) % representatives.length]!;
    const next = representatives[(index + 1) % representatives.length]!;
    const before = Math.min(spanLimit, distanceAhead(track, previous.apexI, corner.apexI) * 0.43);
    const after = Math.min(spanLimit, distanceAhead(track, corner.apexI, next.apexI) * 0.43);
    const turnInI = cyclicIndex(track, corner.apexI - Math.round(Math.max(24, before) / track.step));
    const trackOutI = cyclicIndex(track, corner.apexI + Math.round(Math.max(24, after) / track.step));
    planned.push({ corner, turnInI, trackOutI });
    anchors.push(
      {
        index: turnInI,
        offset: envelopeTarget(
          turnInI, -corner.side as -1 | 1, lateralUtilization
        ),
        priority: 70
      },
      {
        index: corner.apexI,
        offset: envelopeTarget(
          corner.apexI, corner.side, 1.225 * lateralUtilization
        ),
        priority: 80
      },
      {
        index: trackOutI,
        offset: envelopeTarget(
          trackOutI, -corner.side as -1 | 1, 0.78 * lateralUtilization
        ),
        priority: 70
      }
    );
  }
  const path = buildOffsetPath(track, anchors);
  const timing = speedProfile(track, path);
  path.v = timing.v;
  return {
    path,
    timing,
    planned,
    spanLimit,
    lateralUtilization,
    maxHeadingStep: maxPathHeadingStep(track, path)
  };
}

/** Pure Phase 9 tuning/validation surface; it does not mutate corner plans. */
export function previewIdealLine(
  track: Track,
  spanLimit: number,
  lateralUtilization = 0.45
): IdealLinePreview {
  if (!track.corners?.length)
    throw new Error(`Semantic corners must exist before previewing ${track.def.id}`);
  const centerProfile = speedProfile(track);
  const candidate = buildIdealLineCandidate(
    track,
    centerProfile,
    lineRepresentatives(track, centerProfile),
    spanLimit,
    lateralUtilization
  );
  return {
    path: candidate.path,
    timing: candidate.timing,
    phaseMarkers: candidate.planned.map(plan => ({
      cornerId: plan.corner.id,
      turnInI: plan.turnInI,
      apexI: plan.corner.apexI,
      trackOutI: plan.trackOutI
    })) as IdealLinePreview['phaseMarkers'],
    spanLimit: candidate.spanLimit,
    lateralUtilization: candidate.lateralUtilization,
    maxHeadingStep: candidate.maxHeadingStep
  };
}

function applyIdealLinePlan(
  track: Track,
  candidate: IdealLineCandidate,
  centerProfile: SpeedProfile
): void {
  const primaryIds = new Set(candidate.planned.map(plan => plan.corner.id));
  for (const plan of candidate.planned) {
    const corner = plan.corner;
    corner.turnInI = plan.turnInI;
    corner.trackOutI = plan.trackOutI;
    const brakeToApex = distanceAhead(track, corner.brakeI, corner.apexI);
    const turnInToApex = distanceAhead(track, corner.turnInI, corner.apexI);
    if (brakeToApex <= turnInToApex)
      corner.brakeI = cyclicIndex(track, corner.turnInI - Math.max(2, Math.round(12 / track.step)));
    corner.approachI = cyclicIndex(track, corner.brakeI - Math.max(3, Math.round(40 / track.step)));
    corner.exitI = cyclicIndex(track, corner.trackOutI + Math.max(3, Math.round(35 / track.step)));
    corner.entryTarget = candidate.path.off[corner.turnInI]!;
    corner.apexTarget = candidate.path.off[corner.apexI]!;
    corner.exitTarget = candidate.path.off[corner.trackOutI]!;
    if (corner.complexId) {
      corner.planRole = 'complex-primary';
      corner.compromised = true;
      corner.reason +=
        `+complex-primary-span-${candidate.spanLimit}m-u${candidate.lateralUtilization}`;
    } else {
      corner.planRole = 'isolated';
      corner.compromised = [
        corner.turnInI,
        corner.apexI,
        corner.trackOutI
      ].some(index => neutralLineRequiredAt(track, index));
      corner.reason += corner.compromised
        ? '+protected-neutral-line'
        : `+explicit-oao-span-${candidate.spanLimit}m-u${candidate.lateralUtilization}`;
    }
  }
  for (const corner of track.corners || []) {
    if (primaryIds.has(corner.id)) continue;
    corner.entryTarget = candidate.path.off[corner.turnInI]!;
    corner.apexTarget = candidate.path.off[corner.apexI]!;
    corner.exitTarget = candidate.path.off[corner.trackOutI]!;
    corner.planRole = 'complex-secondary';
    corner.compromised = true;
    const members = (track.corners || []).filter(item => item.complexId === corner.complexId);
    const primary = chooseComplexPrimary(members, centerProfile);
    corner.reason += `+complex-secondary-reconciled-to-${primary.id}`;
  }
}

function semanticIdealLine(track: Track): SampledPath {
  const initialEnvelope = normalLateralEnvelope(track, 0);
  if (!(initialEnvelope.maximum > 0 && initialEnvelope.minimum < 0))
    throw new Error(`Track ${track.def.id} is too narrow for a safe racing line`);
  if (!track.corners?.length) return legacyRacingLine(track);
  const centerProfile = speedProfile(track);
  const representatives = lineRepresentatives(track, centerProfile);
  if (!representatives.length) return legacyRacingLine(track);
  const spanLimits = [35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 110, 130, 160] as const;
  const lateralUtilizations = [0.45, 0.55, 0.7, 0.85, 1, 1.1, 1.2] as const;
  let selected: IdealLineCandidate | null = null;
  for (const spanLimit of spanLimits) {
    for (const lateralUtilization of lateralUtilizations) {
      const candidate = buildIdealLineCandidate(
        track,
        centerProfile,
        representatives,
        spanLimit,
        lateralUtilization
      );
      if (!candidateIsSafe(track, candidate)) continue;
      if (!selected || candidate.timing.lapTime < selected.timing.lapTime - 1e-9 ||
          (Math.abs(candidate.timing.lapTime - selected.timing.lapTime) <= 1e-9 &&
            (candidate.spanLimit < selected.spanLimit ||
              (candidate.spanLimit === selected.spanLimit &&
                candidate.lateralUtilization < selected.lateralUtilization)))) selected = candidate;
    }
  }
  if (!selected)
    throw new Error(`No safe semantic ideal-line plan for ${track.def.id}`);
  applyIdealLinePlan(track, selected, centerProfile);
  // The selected plan moves turn-in/track-out markers. Rebuild every derived
  // O(1) corner lookup from those final markers before exposing the path.
  rebuildCornerLookup(track, track.corners);
  return selected.path;
}

export function racingLine(track: Track): SampledPath {
  return track.corners?.length ? semanticIdealLine(track) : legacyRacingLine(track);
}

export function speedProfile(
  track: Track,
  path?: Pick<SampledPath, 'k' | 'ds'> & Partial<Pick<SampledPath, 'off'>>
): SpeedProfile {
  const P = PHYS, N = track.n;
  const pathK = path && path.k ? path.k : track.kSm;
  const pathDs = path && path.ds ? path.ds : null;
  const dsAt = (i: number): number => pathDs ? pathDs[i]! : track.step;
  const surfaceMu = path?.off ? numericArray(N) : null;
  const surfaceDrag = path?.off ? numericArray(N) : null;
  if (path?.off) {
    for (let index = 0; index < N; index++) {
      const exposure = surfaceExposureAtLateral(track, index, path.off[index]!);
      surfaceMu![index] = exposure.mu;
      surfaceDrag![index] = exposure.drag;
    }
  }
  const surfaceMuAt = (index: number): number => surfaceMu?.[index] ?? 1;
  const surfaceDragAt = (index: number): number => surfaceDrag?.[index] ?? 0;
  const vmax = numericArray(N), v = numericArray(N);
  for (let i = 0; i < N; i++){
    vmax[i] = cornerSpeedForGrip(pathK[i]!, surfaceMuAt(i));
  }
  v.set(vmax);
  const gEff = (index: number, speed: number): number =>
    P.mu * P.profMu * surfaceMuAt(index) *
    (P.g + Math.min(P.kDf * speed * speed, P.dfMax) / P.m);
  const fwd = (): void => {
    for (let i = 0; i < N; i++){
      const j = (i + 1) % N;
      const vi = v[i]!, aAv = gEff(i, vi), aLat = vi * vi * Math.abs(pathK[i]!);
      const room = Math.sqrt(Math.max(0, aAv * aAv - aLat * aLat));
      const eng = Math.max(0,
        (Math.min(P.Fmax * P.tc, P.power / Math.max(vi, 4)) -
          (P.kDrag * vi * vi + P.kRoll + surfaceDragAt(i) * vi)) / P.m);
      const a = Math.min(eng, room);
      v[j] = Math.min(v[j]!, Math.sqrt(vi * vi + 2 * a * dsAt(i)));
    }
  };
  const bwd = (): void => {
    for (let i = N - 1; i >= 0; i--){
      const j = (i + 1) % N;
      const vj = v[j]!, aAv = gEff(j, vj) * P.brkFrac,
        aLat = vj * vj * Math.abs(pathK[j]!);
      const room = Math.sqrt(Math.max(0, aAv * aAv - aLat * aLat));
      v[i] = Math.min(v[i]!, Math.sqrt(vj * vj + 2 * room * dsAt(i)));
    }
  };
  for (let it = 0; it < 4; it++){ fwd(); bwd(); }
  const t = numericArray(N + 1);
  for (let i = 0; i < N; i++){
    const j = (i + 1) % N;
    t[i + 1] = t[i]! + dsAt(i) / Math.max(1, (v[i]! + v[j]!) / 2);
  }
  return { v, t, lapTime: t[N]!, step: track.step, ds: pathDs };
}

interface CornerCandidate {
  apexI: number;
  vApex: number;
  side: -1 | 1;
}

interface CurvatureRegion {
  startI: number;
  endI: number;
  side: -1 | 1;
  peak: number;
  headingChange: number;
}

function candidateSide(track: Track, curvature: NumericArray, apexI: number): -1 | 1 {
  let strongest = curvature[apexI]!;
  for (let delta = -8; delta <= 8; delta++) {
    const value = curvature[cyclicIndex(track, apexI + delta)]!;
    if (Math.abs(value) > Math.abs(strongest)) strongest = value;
  }
  if (Math.abs(strongest) < 1e-9) strongest = track.kSm[apexI]!;
  return strongest < 0 ? -1 : 1;
}

/** Exact Phase 0 speed-minimum oracle used only for coverage mapping. */
export function frozenCornerCandidates(
  track: Track,
  path: Pick<SampledPath, 'v' | 'k'>
): DenseArray<CornerCandidate> {
  const candidates = denseArray<CornerCandidate>();
  for (let index = 0; index < track.n; index++) {
    if (path.v[index]! >= PHYS.vTop * 0.93) continue;
    let localMinimum = true;
    for (let delta = 1; delta <= 8; delta++) {
      if (path.v[cyclicIndex(track, index - delta)]! < path.v[index]! - 0.03 ||
          path.v[cyclicIndex(track, index + delta)]! < path.v[index]! - 0.03) {
        localMinimum = false;
        break;
      }
    }
    if (!localMinimum ||
        (path.v[cyclicIndex(track, index - 8)]! <= path.v[index]! + 0.35 &&
         path.v[cyclicIndex(track, index + 8)]! <= path.v[index]! + 0.35)) continue;
    candidates.push({
      apexI: index,
      vApex: path.v[index]!,
      side: candidateSide(track, path.k, index)
    });
  }
  candidates.sort((left, right) => left.vApex - right.vApex || left.apexI - right.apexI);
  const kept = denseArray<CornerCandidate>();
  for (const candidate of candidates) {
    const overlapsSlowerCandidate = kept.some(other => {
      const direct = Math.abs(candidate.apexI - other.apexI);
      return Math.min(direct, track.n - direct) * track.step < 30;
    });
    if (!overlapsSlowerCandidate) kept.push(candidate);
  }
  kept.sort((left, right) => left.apexI - right.apexI);
  return kept;
}

function curvatureRegionAround(
  track: Track,
  apexI: number,
  preferredSide: -1 | 1
): CurvatureRegion {
  let peak = Math.abs(track.kSm[apexI]!);
  let side = preferredSide;
  for (let delta = -10; delta <= 10; delta++) {
    const value = track.kSm[cyclicIndex(track, apexI + delta)]!;
    if (Math.abs(value) > peak) {
      peak = Math.abs(value);
      side = value < 0 ? -1 : 1;
    }
  }
  const threshold = Math.max(0.0015, peak * 0.14);
  const gapLimit = Math.max(2, Math.round(10 / track.step));
  const searchLimit = Math.min(track.n / 3, Math.ceil(240 / track.step));
  let startI = apexI;
  let misses = 0;
  for (let delta = 1; delta <= searchLimit; delta++) {
    const index = cyclicIndex(track, apexI - delta);
    const signed = side * track.kSm[index]!;
    if (signed < -threshold * 0.6) break;
    if (signed >= threshold) {
      startI = index;
      misses = 0;
    } else if (++misses > gapLimit) break;
  }
  let endI = apexI;
  misses = 0;
  for (let delta = 1; delta <= searchLimit; delta++) {
    const index = cyclicIndex(track, apexI + delta);
    const signed = side * track.kSm[index]!;
    if (signed < -threshold * 0.6) break;
    if (signed >= threshold) {
      endI = index;
      misses = 0;
    } else if (++misses > gapLimit) break;
  }
  let headingChange = 0;
  for (let index = startI;; index = (index + 1) % track.n) {
    headingChange += Math.max(0, side * track.kSm[index]!) * track.step;
    if (index === endI) break;
  }
  return { startI, endI, side, peak, headingChange };
}

export function brakingStartForCorner(
  track: Track,
  speeds: NumericArray,
  apexI: number
): number {
  let brakeI = apexI;
  const limit = Math.min(track.n / 3, Math.ceil(260 / track.step));
  for (let count = 0; count < limit; count++) {
    const previous = cyclicIndex(track, brakeI - 1);
    if (speeds[previous]! <= speeds[brakeI]! + 0.01) break;
    brakeI = previous;
  }
  return brakeI;
}

function curvatureDefinedCandidates(
  track: Track,
  centerProfile: SpeedProfile
): DenseArray<CornerCandidate> {
  const candidates = denseArray<CornerCandidate>();
  for (let index = 0; index < track.n; index++) {
    const magnitude = Math.abs(track.kSm[index]!);
    if (magnitude < 0.007 || centerProfile.v[index]! >= PHYS.vTop * 0.97) continue;
    let localPeak = true;
    for (let delta = 1; delta <= 8; delta++) {
      if (Math.abs(track.kSm[cyclicIndex(track, index - delta)]!) > magnitude + 1e-9 ||
          Math.abs(track.kSm[cyclicIndex(track, index + delta)]!) > magnitude + 1e-9) {
        localPeak = false;
        break;
      }
    }
    if (!localPeak) continue;
    const side = candidateSide(track, track.kSm, index);
    const region = curvatureRegionAround(track, index, side);
    if (region.headingChange < 0.16) continue;
    candidates.push({ apexI: index, vApex: centerProfile.v[index]!, side });
  }
  candidates.sort((left, right) => left.apexI - right.apexI);
  return candidates;
}

function rebuildCornerLookup(track: Track, corners: readonly LegacyCorner[]): void {
  const lookup = integerArray(track.n);
  const brakingThreat = numericArray(track.n);
  lookup.fill(-1);
  for (let index = 0; index < track.n; index++) {
    let bestDistance = Infinity;
    let bestCorner = -1;
    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
      const distance = (corners[cornerIndex]!.brakeI - index + track.n) % track.n;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCorner = cornerIndex;
      }
    }
    lookup[index] = bestCorner;
  }
  for (const corner of corners) {
    const approachSpan = (corner.brakeI - corner.approachI + track.n) % track.n;
    for (let delta = 0; delta <= approachSpan; delta++) {
      const u = approachSpan > 0 ? delta / approachSpan : 1;
      const eased = u * u * u * (u * (u * 6 - 15) + 10);
      const index = (corner.approachI + delta) % track.n;
      brakingThreat[index] = Math.max(brakingThreat[index]!, eased);
    }
    const brakingSpan = (corner.turnInI - corner.brakeI + track.n) % track.n;
    for (let delta = 0; delta <= brakingSpan; delta++)
      brakingThreat[(corner.brakeI + delta) % track.n] = 1;
  }
  track.cornerNext = lookup;
  track.brakingThreat = brakingThreat;
}

function assignCornerComplexes(track: Track, corners: DenseArray<LegacyCorner>): void {
  if (!corners.length) return;
  const parent = corners.map((_corner, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[value] !== value) {
      const next = parent[value]!;
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const join = (left: number, right: number): void => {
    const a = find(left), b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (let index = 0; index < corners.length; index++) {
    const nextIndex = (index + 1) % corners.length;
    const corner = corners[index]!;
    const next = corners[nextIndex]!;
    const apexGap = distanceAhead(track, corner.apexI, next.apexI);
    const phaseGap = distanceAhead(track, corner.regionEndI, next.regionStartI);
    if (apexGap < 100 || phaseGap < 35) join(index, nextIndex);
  }
  const groups = new Map<number, DenseArray<number>>();
  for (let index = 0; index < corners.length; index++) {
    const root = find(index);
    const group = groups.get(root) ?? denseArray<number>();
    group.push(index);
    groups.set(root, group);
  }
  const orderedGroups = [...groups.values()].sort(
    (left, right) => corners[left[0]!]!.apexI - corners[right[0]!]!.apexI
  );
  let complexNumber = 1;
  for (const members of orderedGroups) {
    if (members.length < 2) continue;
    const complexId = `${track.def.id}-x${String(complexNumber++).padStart(2, '0')}`;
    for (const index of members) {
      const corner = corners[index]!;
      corner.complexId = complexId;
      corner.isolated = false;
      corner.planRole = 'complex-secondary';
      corner.compromised = true;
      corner.reason += '+linked-complex';
    }
  }
}

/**
 * Phase 8 pass one: build stable semantic identities from signed centreline
 * curvature and the centreline braking profile, before any ideal line exists.
 */
export function detectSemanticCorners(
  track: Track,
  centerProfile: SpeedProfile
): DenseArray<LegacyCorner> {
  const initialEnvelope = normalLateralEnvelope(track, 0);
  if (!(initialEnvelope.maximum > 0 && initialEnvelope.minimum < 0))
    throw new Error(`Track ${track.def.id} is too narrow for semantic corner targets`);
  const centerPath = { v: centerProfile.v, k: track.kSm };
  const speedCandidates = frozenCornerCandidates(track, centerPath);
  const accepted = speedCandidates.filter(candidate => {
    const region = curvatureRegionAround(track, candidate.apexI, candidate.side);
    return region.peak >= 0.005 && region.headingChange >= 0.16;
  });
  for (const candidate of curvatureDefinedCandidates(track, centerProfile)) {
    const represented = accepted.some(other => {
      if (other.side !== candidate.side) return false;
      const direct = Math.abs(other.apexI - candidate.apexI);
      return Math.min(direct, track.n - direct) * track.step < 55;
    });
    if (!represented) accepted.push(candidate);
  }
  accepted.sort((left, right) => left.apexI - right.apexI);
  const corners = accepted.map((candidate, index) => {
    const region = curvatureRegionAround(track, candidate.apexI, candidate.side);
    const apexI = candidate.apexI;
    let brakeI = brakingStartForCorner(track, centerProfile.v, apexI);
    const initialTurnInI = cyclicIndex(track, region.startI - Math.max(2, Math.round(12 / track.step)));
    if (distanceAhead(track, brakeI, apexI) <= distanceAhead(track, initialTurnInI, apexI))
      brakeI = cyclicIndex(track, initialTurnInI - Math.max(2, Math.round(12 / track.step)));
    const trackOutI = cyclicIndex(track, region.endI + Math.max(2, Math.round(12 / track.step)));
    const side = region.side;
    const target = (sample: number, direction: -1 | 1, fraction: number): number => {
      const envelope = roadLateralEnvelopeAt(track, sample);
      return (direction > 0 ? envelope.maximum : envelope.minimum) * fraction;
    };
    return {
      id: `${track.def.id}-c${String(index + 1).padStart(2, '0')}`,
      regionStartI: region.startI,
      regionEndI: region.endI,
      approachI: cyclicIndex(track, brakeI - Math.max(3, Math.round(40 / track.step))),
      brakeI,
      turnInI: initialTurnInI,
      apexI,
      trackOutI,
      exitI: cyclicIndex(track, trackOutI + Math.max(3, Math.round(35 / track.step))),
      vApex: centerProfile.v[apexI]!,
      passScore: 0,
      side,
      severity: clamp(1 - centerProfile.v[apexI]! / PHYS.vTop, 0, 1),
      complexId: null,
      isolated: true,
      entryTarget: target(initialTurnInI, -side as -1 | 1, 0.45),
      apexTarget: target(apexI, side, 0.55),
      exitTarget: target(trackOutI, -side as -1 | 1, 0.35),
      legacyCandidateIndices: denseArray<number>(),
      planRole: 'isolated',
      compromised: false,
      reason: `centerline-speed-minimum+signed-curvature-region-${region.startI}-${region.endI}`
    } satisfies LegacyCorner;
  }) as DenseArray<LegacyCorner>;
  assignCornerComplexes(track, corners);
  track.corners = corners;
  rebuildCornerLookup(track, corners);
  return corners;
}

/** Phase 8 pass two: map every frozen legacy candidate without changing ids. */
export function refineSemanticCorners(
  track: Track,
  legacyLine: SampledPath
): DenseArray<LegacyCorner> {
  const corners = track.corners;
  if (!corners?.length)
    throw new Error(`Semantic corners must be detected before refining ${track.def.id}`);
  for (const corner of corners) corner.legacyCandidateIndices.length = 0;
  const candidates = frozenCornerCandidates(track, legacyLine);
  for (const candidate of candidates) {
    let match: LegacyCorner | null = null;
    let bestDistance = Infinity;
    for (const corner of corners) {
      if (corner.side !== candidate.side) continue;
      const direct = Math.abs(corner.apexI - candidate.apexI);
      const distance = Math.min(direct, track.n - direct) * track.step;
      if (distance < bestDistance) {
        match = corner;
        bestDistance = distance;
      }
    }
    if (!match || bestDistance > 110)
      throw new Error(
        `Frozen corner candidate ${candidate.apexI} on ${track.def.id} has no semantic mapping`
      );
    match.legacyCandidateIndices.push(candidate.apexI);
    match.vApex = Math.min(match.vApex, candidate.vApex);
  }
  const mapped = new Map<number, number>();
  for (const corner of corners)
    for (const candidateIndex of corner.legacyCandidateIndices)
      mapped.set(candidateIndex, (mapped.get(candidateIndex) ?? 0) + 1);
  for (const candidate of candidates) {
    if (mapped.get(candidate.apexI) !== 1)
      throw new Error(
        `Frozen corner candidate ${candidate.apexI} on ${track.def.id} mapped ${mapped.get(candidate.apexI) ?? 0} times`
      );
  }
  for (const corner of corners) {
    const envelope = normalLateralEnvelope(track, corner.apexI);
    const twoWideRoom = Math.max(
      0,
      envelope.maximum - envelope.minimum - 2 * PHYS.carWid
    );
    const approachSpeed = legacyLine.v[corner.brakeI]!;
    const brakingZone = distanceAhead(track, corner.brakeI, corner.turnInI);
    const brakingDelta = Math.max(0, approachSpeed - corner.vApex);
    corner.passScore = approachSpeed * brakingZone * brakingDelta * twoWideRoom;
  }
  rebuildCornerLookup(track, corners);
  return corners;
}

/** Compatibility wrapper retained for the frozen public test-API contract. */
export function buildCorners(
  track: Track,
  line: SampledPath
): DenseArray<LegacyCorner> {
  detectSemanticCorners(track, speedProfile(track));
  return refineSemanticCorners(track, line);
}

export function nextCorner(track: Track, i: number): LegacyCorner | null {
  if (!track.corners || !track.corners.length) return null;
  i = ((i | 0) % track.n + track.n) % track.n;
  const q = track.cornerNext ? track.cornerNext[i]! : -1;
  return q >= 0 ? track.corners[q]! : null;
}

export function ghostStateAt(
  track: Track,
  prof: SpeedProfile,
  tau: number
): { x: number; y: number; h: number; v: number } {
  const N = track.n, t = prof.t;
  tau = ((tau % prof.lapTime) + prof.lapTime) % prof.lapTime;
  let lo = 0, hi = N;
  while (lo + 1 < hi){
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= tau) lo = mid; else hi = mid;
  }
  const f = (tau - t[lo]!) / Math.max(1e-9, t[lo + 1]! - t[lo]!);
  const i = lo, j = (lo + 1) % N;
  const x = lerp(track.x[i]!, track.x[j]!, f);
  const y = lerp(track.y[i]!, track.y[j]!, f);
  const h0 = Math.atan2(track.ty[i]!, track.tx[i]!);
  const h1 = h0 + normAng(Math.atan2(track.ty[j]!, track.tx[j]!) - h0);
  return { x, y, h: normAng(lerp(h0, h1, f)), v: lerp(prof.v[i]!, prof.v[j]!, f) };
}

// ---------------------------------------------------------------- car
