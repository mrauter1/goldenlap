import type { Car, LegacyCorner, Track } from '../../core/model';
import { cornerSpeedForGrip, PHYS } from '../../core/physics';
import { nextCorner } from '../../core/racing-line';
import type {
  AttackEpisode,
  Entry,
  StationGapDistribution,
  Session
} from '../model';
import {
  entryDownforceScale,
  entryDynamicMuAt,
  entryMargin,
  START_BLEND_END,
  TRAF_DT
} from '../strategy';
import {
  racecraftCalibration,
  TRAFFIC_NEIGHBOR_SCAN_METRES
} from './config';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from './cadence';
import { hasObligationRelation } from './relations';

type ActiveEntry = Entry & { car: Car };

export const ATTACK_COMPLETION_WINDOW_SECONDS = 5;
const LINE_CHARACTER_MAXIMUM_METRES = 0.35;
const observedDecisions = new WeakMap<Entry, object>();

export interface SwitchbackCompletionWindow {
  startIndex: number;
  endIndex: number;
  distance: number;
}

function distanceAhead(track: Track, from: number, to: number): number {
  return ((to - from + track.n) % track.n) * track.step;
}

/** Observer-only span for classifying an outside-line pass after corner exit. */
export function switchbackCompletionWindow(
  track: Track,
  corner: LegacyCorner
): SwitchbackCompletionWindow | null {
  const next = track.corners
    ?.filter(candidate => candidate.id !== corner.id)
    .map(candidate => ({
      candidate,
      distance: distanceAhead(track, corner.trackOutI, candidate.brakeI)
    }))
    .filter(item => item.distance > 0 && item.distance < track.len / 2)
    .sort((left, right) => left.distance - right.distance)[0];
  if (!next) return null;
  const exitSpeed = track.idealPath?.v[corner.trackOutI] ?? 0;
  const minimumDistance = PHYS.carLen +
    exitSpeed * RACECRAFT_DECISION_INTERVAL_SECONDS;
  if (next.distance < minimumDistance) return null;
  return {
    startIndex: corner.trackOutI,
    endIndex: next.candidate.brakeI,
    distance: next.distance
  };
}

function attackPairKey(attacker: Entry, target: Entry): string {
  return `${attacker.code}:${target.code}`;
}

function cornerIdForDecision(session: Session, attacker: Entry): string {
  const decision = attacker.racecraftDecision;
  const selected = decision?.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  if (selected &&
      selected.plan.mode !== 'ideal' && selected.plan.mode !== 'pit')
    return selected.plan.cornerId ?? 'straight';
  const cornerCandidate = decision?.candidates.find(candidate =>
    candidate.plan.mode !== 'ideal' &&
    candidate.plan.mode !== 'pit' &&
    candidate.plan.cornerId != null);
  return cornerCandidate &&
      cornerCandidate.plan.mode !== 'ideal' &&
      cornerCandidate.plan.mode !== 'pit'
    ? cornerCandidate.plan.cornerId ?? 'straight'
    : 'straight';
}

function recordAttackPaceOutcome(
  session: Session,
  episode: AttackEpisode,
  completed: boolean
): void {
  const pace = episode.paceDifferentialSecondsPerLap;
  if (pace == null || !Number.isFinite(pace)) return;
  const outcome = completed ? 1 : 0;
  const moments = session.attackPaceOutcomeMoments ??
    (session.attackPaceOutcomeMoments = {
      samples: 0,
      sumPace: 0,
      sumOutcome: 0,
      sumPaceSquared: 0,
      sumOutcomeSquared: 0,
      sumProduct: 0
    });
  moments.samples++;
  moments.sumPace += pace;
  moments.sumOutcome += outcome;
  moments.sumPaceSquared += pace * pace;
  moments.sumOutcomeSquared += outcome * outcome;
  moments.sumProduct += pace * outcome;
}

/**
 * Start an audit episode from an evaluator decision. This map observes
 * decisions and outcomes; no driving decision reads it.
 */
export function beginAttackEpisode(
  session: Session,
  attacker: Entry,
  target: Entry
): AttackEpisode {
  const episodes = session.attackEpisodes ?? (session.attackEpisodes = new Map());
  for (const [key, episode] of episodes)
    if (episode.attacker === attacker.code && episode.target !== target.code) {
      recordAttackPaceOutcome(session, episode, false);
      episodes.delete(key);
    }
  const key = attackPairKey(attacker, target);
  const existing = episodes.get(key);
  if (existing) return existing;
  const sequence = (session.attackInitiations ?? 0) + 1;
  const economics = attacker.racecraftDecision?.economics.find(value =>
    value.role === 'attack' &&
    value.rivalCode === target.code &&
    value.opportunityPresent);
  const episode: AttackEpisode = {
    key,
    attacker: attacker.code,
    target: target.code,
    startedAt: session.t,
    expiresAt: session.t + ATTACK_COMPLETION_WINDOW_SECONDS,
    cornerId: cornerIdForDecision(session, attacker),
    paceDifferentialSecondsPerLap:
      economics?.paceDifferentialSecondsPerLap ?? null
  };
  episodes.set(key, episode);
  session.attackInitiations = sequence;
  const cornerCounts = session.cornerPassCounts ?? (session.cornerPassCounts = {});
  const corner = cornerCounts[episode.cornerId] ??
    (cornerCounts[episode.cornerId] = { attempts: 0, passes: 0 });
  corner.attempts++;
  return episode;
}

export function extendAttackEpisode(
  session: Session,
  attacker: Entry,
  target: Entry,
  additionalTravelSeconds: number
): void {
  const episode = session.attackEpisodes?.get(attackPairKey(attacker, target));
  if (!episode) return;
  episode.expiresAt = Math.max(
    episode.expiresAt,
    session.t + Math.max(0, additionalTravelSeconds)
  );
}

/** End observer attribution without altering either car's control state. */
export function cancelAttackEpisode(
  session: Session,
  attacker: Entry,
  _cause?: string,
  targetCode?: string
): void {
  if (targetCode) {
    const key = `${attacker.code}:${targetCode}`;
    const episode = session.attackEpisodes?.get(key);
    if (episode) recordAttackPaceOutcome(session, episode, false);
    session.attackEpisodes?.delete(key);
    return;
  }
  for (const [key, episode] of session.attackEpisodes ?? []) {
    if (episode.attacker !== attacker.code) continue;
    recordAttackPaceOutcome(session, episode, false);
    session.attackEpisodes?.delete(key);
  }
}

/** Derive battle and attack-funnel observers from selected evaluator motions. */
export function observeRacecraftDecisions(
  session: Session,
  entries: readonly ActiveEntry[]
): void {
  const byCode = new Map(entries.map(entry => [entry.code, entry]));
  for (const attacker of entries) {
    const decision = attacker.racecraftDecision;
    const selected = decision?.candidates.find(candidate =>
      candidate.planNumericId === decision.selectedPlanNumericId);
    if (!decision || !selected) continue;
    const brakeCandidate = decision.candidates.find(candidate =>
      candidate.kind === 'brake-behind');
    const targetCode = selected.slowPointOwnerCode ??
      (selected.plan.mode !== 'ideal' && selected.plan.mode !== 'pit'
        ? selected.plan.leaderCode
        : null) ??
      brakeCandidate?.slowPointOwnerCode ??
      null;
    const target = targetCode ? byCode.get(targetCode) : undefined;
    if (!target?.car ||
        hasObligationRelation(session, attacker, target)) continue;
    if (observedDecisions.get(attacker) !== decision) {
      observedDecisions.set(attacker, decision);
      const cornerId = cornerIdForDecision(session, attacker);
      const decisions = session.racecraftCornerDecisions ??
        (session.racecraftCornerDecisions = {});
      const counts = decisions[cornerId] ??
        (decisions[cornerId] = { inline: 0, offset: 0 });
      if (selected.kind === 'hold' || selected.kind === 'brake-behind')
        counts.inline++;
      else
        counts.offset++;
    }
    const selectedAttack =
      selected.plan.mode !== 'ideal' &&
      selected.plan.mode !== 'pit' &&
      (selected.plan.mode === 'side-inside' ||
        selected.plan.mode === 'side-outside') &&
      selected.plan.surfaceAuthorization !== 'emergency' &&
      selected.plan.leaderCode === target.code;
    if (!selectedAttack) continue;
    attacker.battle = true;
    target.battle = true;
    beginAttackEpisode(session, attacker, target);
    extendAttackEpisode(
      session,
      attacker,
      target,
      ATTACK_COMPLETION_WINDOW_SECONDS
    );
  }
}

/** Resolve observer outcomes after current-tick decisions have been recorded. */
export function updateAttackEpisodes(session: Session): void {
  const episodes = session.attackEpisodes;
  if (!episodes?.size) return;
  const entries = new Map(session.entries.map(entry => [entry.code, entry]));
  for (const [key, episode] of episodes) {
    const attacker = entries.get(episode.attacker);
    const target = entries.get(episode.target);
    if (!attacker?.car || !target?.car ||
        attacker.state !== 'run' || target.state !== 'run') {
      recordAttackPaceOutcome(session, episode, false);
      episodes.delete(key);
      continue;
    }
    if (attacker.prog > target.prog + 1e-6) {
      recordAttackPaceOutcome(session, episode, true);
      session.attackCompletions = (session.attackCompletions ?? 0) + 1;
      if (episode.switchback)
        session.switchbackCompletions =
          (session.switchbackCompletions ?? 0) + 1;
      const corner = session.cornerPassCounts?.[episode.cornerId];
      if (corner) corner.passes++;
      episodes.delete(key);
      continue;
    }
    if (session.t >= episode.expiresAt) {
      recordAttackPaceOutcome(session, episode, false);
      episodes.delete(key);
    }
  }
}

function emptyStationGapDistribution(): StationGapDistribution {
  return {
    samples: 0,
    sumMetres: 0,
    squaredSumMetres: 0,
    minimumMetres: Infinity,
    maximumMetres: -Infinity
  };
}

export function recordTrafficFeel(
  session: Session,
  entries: readonly ActiveEntry[]
): void {
  if (session.t - session.goT < START_BLEND_END) return;
  const byCode = new Map(entries.map(entry => [entry.code, entry]));
  const gaps = session.stationGapDistribution ??
    (session.stationGapDistribution = emptyStationGapDistribution());
  for (const entry of entries) {
    const ownerCode =
      entry.racecraftLongitudinalProgram?.slowPointOwnerCode ??
      entry.trafficSlowPoint?.ownerCode;
    if (!ownerCode) continue;
    const leader = byCode.get(ownerCode);
    if (!leader?.car) continue;
    const distance = leader.prog - entry.prog;
    if (distance <= 0 || distance > TRAFFIC_NEIGHBOR_SCAN_METRES) continue;
    const gap = distance - PHYS.carLen;
    gaps.samples++;
    gaps.sumMetres += gap;
    gaps.squaredSumMetres += gap * gap;
    gaps.minimumMetres = Math.min(gaps.minimumMetres, gap);
    gaps.maximumMetres = Math.max(gaps.maximumMetres, gap);
  }
}

function hashUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function initializeLineCharacter(entry: Entry, track: Track): void {
  entry.lineBiasByCorner = Object.fromEntries((track.corners ?? []).map(corner => [
    corner.id,
    (hashUnit(`${entry.code}:${corner.id}:line`) * 2 - 1) *
      LINE_CHARACTER_MAXIMUM_METRES
  ]));
  entry.brakingEffort = 0.82 +
    (hashUnit(`${entry.code}:braking-effort`) * 2 - 1) * 0.06;
  entry.brakingPrudenceOffset =
    (hashUnit(`${entry.code}:braking-prudence`) * 2 - 1) * 0.06;
}

export function lineCharacterBias(track: Track, entry: Entry): number {
  if (!entry.car) return 0;
  const corner = nextCorner(track, Math.max(0, entry.car.progIdx));
  return corner ? entry.lineBiasByCorner?.[corner.id] ?? 0 : 0;
}
