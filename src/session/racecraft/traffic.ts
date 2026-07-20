import { clamp, lerp, normAng } from '../../shared/math';
import { random } from '../../shared/rng';
import { PATH_FOLLOWER_TUNING } from '../../core/autopilot';
import { carBodyCircleClearance } from '../../core/collision';
import { nextCorner } from '../../core/racing-line';
import {
  cornerSpeedForGrip,
  PHYS,
  wakeEffect
} from '../../core/physics';
import {
  entryDownforceScale,
  entryDynamicMuAt,
  entryMargin,
  START_BLEND_END,
  TRAF_DT
} from '../strategy';
import { pitTrafficReference, prunePitReservations } from '../pit';
import type { Car, LegacyCorner, Track } from '../../core/model';
import type {
  Entry,
  EntryTrafficSlowPoint,
  LegacyRoomPair,
  RacecraftDecision,
  RacecraftDecisionCertificateBreakReason,
  RacecraftLongitudinalProgram,
  Session,
  SideBySideEpisode,
  SideBySidePair
} from '../model';
import {
  alongside,
  hasSideAgreement,
  roomPairKey
} from './geometry';
import {
  lineOffAt,
  queueFollowSlowPoint,
  setTargetAbsLat,
  syncPitPaths
} from './paths';
import {
  OBSTACLE_NEIGHBOR_SCAN_METRES,
  racecraftCalibration,
  TRAFFIC_NEIGHBOR_SCAN_METRES
} from './config';
import { RACECRAFT_DECISION_INTERVAL_SECONDS } from './cadence';
import { updateStallDiagnostics } from './liveness';
import {
  editLaneEtaTarget,
  evaluateLaneProgram,
  installRacecraftPathPlan
} from './lane-program';
import {
  publishRacecraftClaimSnapshot,
  updateRacecraftSideAgreements
} from './corridor-planner';
import {
  contractIsRevoked,
  isFixedOccupancy,
  isObligationParticipant,
  obligationGeometryForcesSingleFile,
  obligationsFor
} from './relations';
import {
  observeRacecraftDecisions,
  recordTrafficFeel,
  updateAttackEpisodes
} from './feel';
import {
  UTILIZATION_MISTAKE_LIFT_SECONDS,
  utilizationMistakeProbability
} from './utilization';
import {
  evaluateRacecraftDecision,
  makeRacecraftSettledSolitudeDecision,
  maintainRacingLineZeroState,
  racecraftCurrentGripUtilization,
  racecraftCurrentLaneCurvature,
  racecraftDefensiveAttacker,
  racecraftDecisionCertificateBreakReason,
  racecraftIsInteractionNeighbor,
  racecraftLateralAuthoritySettledOnIdeal,
  racecraftSelectedLaneIsExecutable,
  renewPublishedEmergencyCertificate,
  sealRacecraftDecisionCertificate
} from './evaluator';

type ActiveEntry = Entry & { car: Car };

export { physicalLateralMoveSeconds } from './lane-program';

export function bestPassingCorner(track: Track, index: number): LegacyCorner | null {
  const first = nextCorner(track, index);
  if (!first) return null;
  const second = nextCorner(track, (first.exitI + 1) % track.n);
  if (!second || second.id === first.id) return first;
  if (second.passScore > first.passScore + 1e-9) return second;
  return first;
}

function alongsidePace(session: Session, entry: Entry): number {
  const index = Math.max(0, entry.car?.progIdx ?? 0) % session.trk.n;
  const curvature = session.trk.idealPath.k[index]!;
  const reference = session.trk.idealPath.v[index]!;
  const dynamicMu = entryDynamicMuAt(
    entry,
    session,
    reference,
    curvature
  );
  return Math.min(
    reference,
    cornerSpeedForGrip(curvature, dynamicMu, entryDownforceScale(entry))
  ) *
    entryMargin(entry, session, session.config.tuneBonus, session.wet);
}

function tickUtilizationMistakeClock(session: Session, entry: ActiveEntry): void {
  if (session.mode !== 'race' || entry.state !== 'run' || entry.cross <= 0 ||
      entry.liftT > 0) return;
  const probability = utilizationMistakeProbability(
    entry.racecraftDecision?.chosenUtilization ??
      racecraftCurrentGripUtilization(session, entry),
    entry.focusNow,
    session.wet
  );
  if (probability <= 0 || random() >= probability) return;
  entry.liftT = Math.max(entry.liftT, UTILIZATION_MISTAKE_LIFT_SECONDS);
  session.utilizationMistakes = (session.utilizationMistakes || 0) + 1;
}

function recordAlongsideEntryCanary(
  session: Session,
  entry: ActiveEntry,
  otherCode: string,
  otherPace: number,
  ownPace: number
): void {
  const curvature = Math.abs(
    racecraftCurrentLaneCurvature(session, entry)
  );
  // Braking beside another car is expected in a corner. This canary is for the
  // traffic-induced straight-line lift/brake that used to dissolve an overlap.
  const speedOwner =
    entry.racecraftLongitudinalProgram?.slowPointOwnerCode ??
    entry.trafficSlowPoint?.ownerCode;
  if (curvature < 1 / 230 && entry.inp.brake > 0.2 &&
      speedOwner === otherCode &&
      ownPace + 1e-9 >= otherPace)
    session.brakeWhileAlongsideN = (session.brakeWhileAlongsideN ?? 0) + 1;
  if (curvature < 1 / 230 && Math.abs(entry.car.slipR) > PHYS.slipPeakR)
    session.rearLossStraightN = (session.rearLossStraightN ?? 0) + 1;
}

function recordAlongsideCanaries(
  session: Session,
  first: ActiveEntry,
  second: ActiveEntry
): void {
  const firstPace = alongsidePace(session, first);
  const secondPace = alongsidePace(session, second);
  recordAlongsideEntryCanary(session, first, second.code, secondPace, firstPace);
  recordAlongsideEntryCanary(session, second, first.code, firstPace, secondPace);
}

function sameSlowPoint(
  first: EntryTrafficSlowPoint | null,
  second: EntryTrafficSlowPoint | null
): boolean {
  return first === second ||
    (!!first && !!second &&
      first.distance === second.distance &&
      first.speed === second.speed &&
      first.ownerCode === second.ownerCode &&
      first.reason === second.reason &&
      first.stationS === second.stationS &&
      first.publishedAt === second.publishedAt);
}

function installTrafficSlowPoint(
  entry: Entry,
  slowPoint: EntryTrafficSlowPoint | null
): boolean {
  const changed = !sameSlowPoint(entry.trafficSlowPoint, slowPoint);
  if (changed) {
    entry.trafficSlowPoint = slowPoint;
    delete entry._laneBufferRevision;
  }
  return changed;
}

function installRacecraftLongitudinalProgram(
  entry: Entry,
  program: RacecraftLongitudinalProgram | null
): void {
  if (entry.racecraftLongitudinalProgram === program) return;
  const previous = entry.racecraftLongitudinalProgram;
  const sameSpeedLaw = previous != null && program != null &&
    previous.brakingEffort === program.brakingEffort &&
    previous.progress.length === program.progress.length &&
    previous.speed.length === program.speed.length &&
    previous.progress.every((value, index) =>
      value === program.progress[index]) &&
    previous.speed.every((value, index) =>
      value === program.speed[index]);
  entry.racecraftLongitudinalProgram = program;
  // The generation names the executed speed law, not the rival that happened
  // to induce it. Equal samples are the same authority; changed samples are
  // new control even when their slow-point owner is unchanged.
  if (!sameSpeedLaw)
    entry._racecraftLongitudinalAuthorityRevision =
      (entry._racecraftLongitudinalAuthorityRevision ?? 0) + 1;
  if (!sameSpeedLaw) delete entry._laneBufferRevision;
}

function queueProgramUpdateIsDue(session: Session, entry: Entry): boolean {
  const publishedAt = entry.trafficSlowPoint?.publishedAt;
  return publishedAt == null ||
    session.t + Number.EPSILON >=
      publishedAt + RACECRAFT_DECISION_INTERVAL_SECONDS;
}

/**
 * Grass is not a revocation when it is the selected, installed publication.
 * Keep that decision closed-loop until it rejoins or tracking/control breaks.
 */
function publishedEmergencyDecision(
  session: Session,
  entry: ActiveEntry
): RacecraftDecision | null {
  if (!entry.car.offCourse || entry.recT > 0 ||
      entry.laneProgram.surfaceAuthorization !== 'emergency')
    return null;
  const decision = entry.racecraftDecision;
  const selected = decision?.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  if (!decision || !selected ||
      selected.plan.mode === 'ideal' || selected.plan.mode === 'pit' ||
      selected.plan.surfaceAuthorization !== 'emergency' ||
      entry.racecraftPathPlan !== selected.plan ||
      entry.laneProgram.reason !== `space:${selected.plan.key}`)
    return null;
  const index = Math.max(0, entry.car.progIdx) % session.trk.n;
  const roadHeading = entry._trafficRoadHeading ?? Math.atan2(
    session.trk.ty[index]!,
    session.trk.tx[index]!
  );
  if (Math.abs(normAng(entry.car.h - roadHeading)) > 0.42 ||
      Math.abs(entry.car.r) > 1 ||
      Math.abs(entry.car.slipR) > 0.28)
    return null;
  return decision;
}

function applyQueueSlowPoint(
  session: Session,
  follower: Entry,
  leader: Entry,
  distance: number,
  timeGap: number,
  reason: string
): void {
  if (!queueProgramUpdateIsDue(session, follower)) return;
  installTrafficSlowPoint(
    follower,
    queueFollowSlowPoint(
      session,
      follower,
      leader,
      distance,
      timeGap,
      reason
    )
  );
}

function laneBufferCoverageRequiresRebuild(
  session: Session,
  entry: Entry
): boolean {
  const buffer = entry.laneBuffer;
  if (!buffer || !entry.car || buffer.count <= 0) return true;
  const current = Math.max(0, entry.car.progIdx) % session.trk.n;
  const consumed = (
    current - buffer.startIndex + session.trk.n
  ) % session.trk.n;
  const lookaheadSamples = Math.ceil(
    PATH_FOLLOWER_TUNING.lookaheadMaximum / session.trk.step
  );
  return consumed >= buffer.count ||
    consumed + lookaheadSamples >= buffer.count;
}

function boundedInteractionNeighbors(
  session: Session,
  entries: readonly ActiveEntry[],
  entryIndex: number
): ActiveEntry[] {
  const entry = entries[entryIndex]!;
  if (entries.length <= 1) return [];
  const found: ActiveEntry[] = [];
  for (let step = 1; step < entries.length; step++) {
    const candidate = entries[(entryIndex + step) % entries.length]!;
    const distance = forwardTrackDistance(
      session.trk.len,
      entry.car.s,
      candidate.car.s
    );
    if (distance > OBSTACLE_NEIGHBOR_SCAN_METRES) break;
    appendInteractionNeighbor(session, entry, candidate, found);
  }
  for (let step = 1; step < entries.length; step++) {
    const candidate = entries[
      (entryIndex - step + entries.length) % entries.length
    ]!;
    const distance = forwardTrackDistance(
      session.trk.len,
      candidate.car.s,
      entry.car.s
    );
    if (distance > OBSTACLE_NEIGHBOR_SCAN_METRES) break;
    appendInteractionNeighbor(session, entry, candidate, found);
  }
  return found.sort(compareEntryCode);
}

interface RacecraftInteractionEpoch {
  demandedCodes: Set<string>;
  neighborsByCode: Map<string, ActiveEntry[]>;
}

function forwardTrackDistance(
  length: number,
  from: number,
  to: number
): number {
  const distance = to - from;
  return distance < 0 ? distance + length : distance;
}

function compareEntryCode(left: ActiveEntry, right: ActiveEntry): number {
  return left.code.localeCompare(right.code);
}

function appendInteractionNeighbor(
  session: Session,
  entry: ActiveEntry,
  candidate: ActiveEntry,
  found: ActiveEntry[]
): void {
  for (const existing of found)
    if (existing === candidate) return;
  if (racecraftIsInteractionNeighbor(session, entry, candidate))
    found.push(candidate);
}

function addEpochNeighbor(
  neighbors: Map<string, Set<ActiveEntry>>,
  entry: ActiveEntry,
  other: ActiveEntry
): void {
  neighbors.get(entry.code)!.add(other);
}

function buildRacecraftInteractionEpoch(
  session: Session,
  entries: readonly ActiveEntry[],
  activeByCode: ReadonlyMap<string, ActiveEntry>
): RacecraftInteractionEpoch {
  const demandedCodes = new Set<string>();
  const neighborSets = new Map<string, Set<ActiveEntry>>();
  for (const entry of entries)
    neighborSets.set(entry.code, new Set<ActiveEntry>());
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex]!;
    for (const neighbor of boundedInteractionNeighbors(
      session,
      entries,
      entryIndex
    )) {
      addEpochNeighbor(neighborSets, entry, neighbor);
      demandedCodes.add(entry.code);
      demandedCodes.add(neighbor.code);
    }
  }
  for (const entry of entries) {
    const neighbors = [...neighborSets.get(entry.code)!];
    for (const obligation of obligationsFor(
      session,
      entry,
      [entry, ...neighbors]
    )) {
      demandedCodes.add(obligation.yielding.code);
      demandedCodes.add(obligation.beneficiary.code);
      addEpochNeighbor(
        neighborSets,
        obligation.yielding,
        obligation.beneficiary
      );
      addEpochNeighbor(
        neighborSets,
        obligation.beneficiary,
        obligation.yielding
      );
    }
  }
  for (const key of session.sideAgreements?.keys() ?? []) {
    const separator = key.indexOf(':');
    const first = activeByCode.get(key.slice(0, separator));
    const second = activeByCode.get(key.slice(separator + 1));
    if (!first || !second) continue;
    demandedCodes.add(first.code);
    demandedCodes.add(second.code);
    addEpochNeighbor(neighborSets, first, second);
    addEpochNeighbor(neighborSets, second, first);
  }
  const neighborsByCode = new Map<string, ActiveEntry[]>();
  for (const entry of entries)
    neighborsByCode.set(
      entry.code,
      [...neighborSets.get(entry.code)!].sort((left, right) =>
        left.code.localeCompare(right.code))
    );
  return { demandedCodes, neighborsByCode };
}

/** Exact external-prediction demand for one immutable arbitration epoch. */
export function racecraftDemandedClaimCodes(
  session: Session,
  entries: readonly Entry[]
): Set<string> {
  const active: ActiveEntry[] = [];
  for (const entry of entries)
    if (entry.car &&
      (entry.state === 'run' ||
        entry.state === 'pitIn' ||
        entry.state === 'pitOut'))
      active.push(entry as ActiveEntry);
  active.sort((left, right) =>
    left.car.s - right.car.s || left.code.localeCompare(right.code));
  const activeByCode = new Map<string, ActiveEntry>();
  for (const entry of active) activeByCode.set(entry.code, entry);
  return buildRacecraftInteractionEpoch(
    session,
    active,
    activeByCode
  ).demandedCodes;
}

function claimSnapshotMatchesDemand(
  session: Session,
  demandedCodes: ReadonlySet<string>
): boolean {
  const claims = session.racecraftClaims;
  if (!claims || claims.size !== demandedCodes.size) return false;
  for (const code of demandedCodes)
    if (!claims.has(code)) return false;
  return true;
}

function recordCertificateBreak(
  session: Session,
  reason: RacecraftDecisionCertificateBreakReason
): void {
  const counts = session.racecraftCertificateBreaks ??
    (session.racecraftCertificateBreaks = {});
  counts[reason] = (counts[reason] ?? 0) + 1;
}

export function unstableCar(tr: Track, e: Entry): boolean {
  if (!e.car) return false;
  const i = Math.max(0, e.car.progIdx);
  if (e.car.offCourse || Math.abs(e.car.r) > 1.0 ||
      Math.abs(e.car.slipR) > 0.28) return true;
  const roadH = e._trafficRoadHeading ?? Math.atan2(tr.ty[i]!, tr.tx[i]!);
  return Math.abs(normAng(e.car.h - roadH)) > 0.42;
}

/**
 * Claim the one permitted defensive response to one attack episode.
 *
 * Active attackers are tracked independently so an interleaved pack cannot
 * reset the one-move rule. Entries are removed when that attacker stops
 * targeting this defender.
 */
export function claimDefenseResponse(defender: Entry, attacker: Entry): boolean {
  const seen = defender._defSeenAttackers ??
    (defender._defSeenAttackers = Object.create(null) as Record<string, boolean>);
  if (seen[attacker.code]) return false;
  seen[attacker.code] = true;
  defender._defSeenKey = `${attacker.code}:active`;
  return true;
}

function refreshDefenseEpisodes(
  session: Session,
  entries: readonly ActiveEntry[]
): void {
  const active = session._racecraftDefensePairs ??
    (session._racecraftDefensePairs = new Set());
  active.clear();
  for (const attacker of entries) {
    const selected = attacker.racecraftDecision?.candidates.find(candidate =>
      candidate.planNumericId ===
        attacker.racecraftDecision?.selectedPlanNumericId);
    if (!selected || selected.kind === 'hold' ||
        selected.kind === 'brake-behind' ||
        selected.plan.mode === 'ideal' || selected.plan.mode === 'pit' ||
        !selected.plan.leaderCode) continue;
    active.add(`${selected.plan.leaderCode}:${attacker.code}`);
  }
  for (const defender of entries) {
    const seen = defender._defSeenAttackers;
    if (!seen) continue;
    for (const attackerCode of Object.keys(seen))
      if (!active.has(`${defender.code}:${attackerCode}`))
        delete seen[attackerCode];
  }
}

export function updateTraffic(S: Session): void {
  const tr = S.trk, len = tr.len;
  const calibration = racecraftCalibration();
  S.racecraftDecisionTick = (S.racecraftDecisionTick ?? -1) + 1;
  prunePitReservations(S);
  const list = (S._trafficActiveEntries ??= []) as ActiveEntry[];
  list.length = 0;
  const sbsPairs = S.sbsPairs ?? (S.sbsPairs = Object.create(null) as Record<string, SideBySidePair>);
  const sbsEpisodes = S.sbsEpisodes ?? (S.sbsEpisodes = [] as SideBySideEpisode[]);
  const roomPairs = S.roomPairs ?? (S.roomPairs = Object.create(null) as Record<string, LegacyRoomPair>);
  const activeByCode = new Map<string, ActiveEntry>();
  S._sbsStamp = (S._sbsStamp || 0) + 1;
  const sbsStamp = S._sbsStamp;
  for (let entryIndex = 0; entryIndex < S.entries.length; entryIndex++){
    const e = S.entries[entryIndex]!;
    if (!e.car ||
        (e.state !== 'run' &&
          e.state !== 'pitIn' &&
          e.state !== 'pitOut')) continue;
    list.push(e as ActiveEntry);
    activeByCode.set(e.code, e as ActiveEntry);
    e.battle = false;
    e._alongsideWith = '';
    if (queueProgramUpdateIsDue(S, e) &&
        (e.trafficSlowPoint?.reason.startsWith('traffic-comfort:') ||
          (S.mode !== 'race' &&
            e.trafficSlowPoint?.reason === 'traffic-follow:cost-candidate')))
      installTrafficSlowPoint(e, null);
    const previousLateral = e._previousTrafficLateral ?? e.latNow;
    e._trafficLateralVelocity = (e.latNow - previousLateral) / TRAF_DT;
    e._previousTrafficLateral = e.latNow;
    const trafficIndex = Math.max(0, e.car.progIdx) % tr.n;
    e._trafficRoadHeading = Math.atan2(tr.ty[trafficIndex]!, tr.tx[trafficIndex]!);
    e._previousTrafficIndex = e._trafficIndex ?? trafficIndex;
    e._trafficIndex = trafficIndex;
    e.avoidT = Math.max(0, e.avoidT - TRAF_DT);
    tickUtilizationMistakeClock(S, e as ActiveEntry);
    e.tow = 0;
    e.dirtyT = 0;
    e.pressureT = Math.max(0, (e.pressureT || 0) - TRAF_DT);
    e.underPressure = e.pressureT > 5;
  }
  const n = list.length;
  if (n > 1){
    list.sort((a, b) => a.car.s - b.car.s);
    for (let k = 0; k < n; k++){
      const e = list[k]!, a1 = list[(k + 1) % n]!;
      const a2 = n >= 3 ? list[(k + 2) % n]! : null;
      const pairAlongside = alongside(tr, e, a1);
      if (pairAlongside) {
        e._alongsideWith = a1.code;
        a1._alongsideWith = e.code;
        if (n !== 2 || k === 0) recordAlongsideCanaries(S, e, a1);
      }
      const sep1 = Math.abs(a1.latNow - e.latNow);
      const sbsKey = roomPairKey(e, a1);
      // This observer starts at geometric non-overlap. Sporting daylight is
      // enforced only by the live side-agreement partition.
      if (pairAlongside &&
          sep1 >= PHYS.carWid &&
          e.state === 'run' && a1.state === 'run'){
        let ep = sbsPairs[sbsKey];
        if (!ep) ep = sbsPairs[sbsKey] = {
          t0: S.t, contact: false, seen: sbsStamp, a: e.code, b: a1.code
        };
        ep.seen = sbsStamp;
        S.sbsT = (S.sbsT || 0) + TRAF_DT;
      }

      const eLane = e.state === 'pitIn' || e.state === 'pitOut';
      if (eLane){
        const conflict = pitTrafficReference(e, S);
        if (conflict){
          const leader = conflict.entry;
          const distance = conflict.distance;
          applyQueueSlowPoint(
            S,
            e,
            leader,
            distance,
            0.65,
            `pit:${conflict.reason}`
          );
          e.pitTrafficLeader = leader.code;
          e.pitWaitReason = conflict.reason;
          e.pitWaitOwner = leader.code;
        } else {
          e.pitTrafficLeader = null;
          if (e.pitWaitReason === 'lane-conflict' || e.pitWaitReason === 'physical-crossing') {
            e.pitWaitReason = null;
            e.pitWaitOwner = null;
          }
        }
        continue;
      }

      let ref: ActiveEntry | null = null, refDs = Infinity;
      const references = a2 ? 2 : 1;
      for (let referenceIndex = 0; referenceIndex < references; referenceIndex++) {
        const a = referenceIndex === 0 ? a1 : a2!;
        const ds = forwardTrackDistance(len, e.car.s, a.car.s);
        if (ds > 160) continue;
        const aLane = a.state === 'pitIn' || a.state === 'pitOut';
        if (aLane) continue;
        const sep = Math.abs(e.latNow - a.latNow);
        const actualOccupancy = contractIsRevoked(S, a) ||
          isFixedOccupancy(S, a);
        if (((ds <= TRAFFIC_NEIGHBOR_SCAN_METRES && sep < PHYS.carWid) ||
            (actualOccupancy && ds <= 160 &&
              sep < PHYS.carWid)) && ds < refDs){
          ref = a;
          refDs = ds;
        }
        const ii = Math.max(0, e.car.progIdx);
        if (S.mode === 'race' && ds <= TRAFFIC_NEIGHBOR_SCAN_METRES) {
          const wake = wakeEffect(ds, sep, e.spd, {
            characteristicDistance: calibration.towRangeM,
            spreadRate: calibration.wakeSpreadRate
          });
          e.tow = Math.max(e.tow, wake.drag);
          e.dirtyT = Math.max(e.dirtyT, wake.grip);
        } else if (e.spd > 30 && a.spd > 30 &&
            Math.abs(tr.idealPath?.k[ii] ?? tr.kSm[ii]!) < 1 / 230) {
          if (S.mode !== 'race' && ds < 16 && sep < 1.5) {
            e.tow = Math.max(e.tow, clamp(1 - ds / 18, 0, 0.7));
          }
        }
      }
      // A spin can have two cars already stacked behind it. Normal braking
      // awareness deliberately stops at two-ahead; emergency hazards do not.
      for (let q = 3; q < n; q++){
        const a = list[(k + q) % n]!;
        const ds = forwardTrackDistance(len, e.car.s, a.car.s);
        if (ds > 160) break;
        const aLane = a.state === 'pitIn' || a.state === 'pitOut';
        const actualOccupancy = !aLane &&
          (contractIsRevoked(S, a) || isFixedOccupancy(S, a));
        if (actualOccupancy &&
            Math.abs(e.latNow - a.latNow) < PHYS.carWid &&
            ds < refDs){
          ref = a;
          refDs = ds;
        }
      }
      if (ref) {
        stepRacecraft(S, e, ref, refDs);
      } else {
        delete e._closingWith;
        delete e._closingDistance;
        delete e._trafficClosingVelocity;
      }
    }

    for (const key in sbsPairs){
      const ep = sbsPairs[key]!;
      if (ep.seen === sbsStamp) continue;
      const ea = activeByCode.get(ep.a);
      const eb = activeByCode.get(ep.b);
      const epSep = ea && eb ? Math.abs(ea.latNow - eb.latNow) : 0;
      const epAlongside = !!ea && !!eb && alongside(tr, ea, eb);
      const reason = !ea || !eb || ea.state !== 'run' || eb.state !== 'run' ? 'state' :
        epSep < PHYS.carWid ? 'lane' : !epAlongside ? 'long' : 'order';
      if (sbsEpisodes.length >= 200) sbsEpisodes.shift();
      sbsEpisodes.push({ t: Math.max(TRAF_DT, S.t - ep.t0), contact: ep.contact, reason });
      delete sbsPairs[key];
    }

    // Contact recovery remains diagnostic state; overlap agreements and
    // evaluator feasibility own all live side-by-side lane authority.
    for (const key in roomPairs) {
      const pair = roomPairs[key]!;
      const [firstCode, secondCode] = key.split('|');
      const first = activeByCode.get(firstCode!);
      const second = activeByCode.get(secondCode!);
      if (!pair.contactSeed || !first || !second ||
          carBodyCircleClearance(
            second.car.x - first.car.x,
            second.car.y - first.car.y,
            first.car.h,
            second.car.h
          ) > 0)
        delete roomPairs[key];
    }
  }

  if (n <= 1){
    for (const key in sbsPairs){
      const ep = sbsPairs[key]!;
      if (sbsEpisodes.length >= 200) sbsEpisodes.shift();
      sbsEpisodes.push({ t: Math.max(TRAF_DT, S.t - ep.t0), contact: ep.contact, reason: 'state' });
      delete sbsPairs[key];
    }
  }
  syncPitPaths(S, list);
  updateRacecraftSideAgreements(S, list);
  const interactionEpoch = buildRacecraftInteractionEpoch(
    S,
    list,
    activeByCode
  );
  for (const entry of list) {
    const needsLane = interactionEpoch.demandedCodes.has(entry.code) ||
      !racecraftLateralAuthoritySettledOnIdeal(S, entry);
    if (!needsLane) {
      delete entry.laneBuffer;
      delete entry._laneBufferRevision;
    } else if (!entry.laneBuffer ||
      entry._laneBufferRevision !== (entry.laneEdits ?? 0) ||
      laneBufferCoverageRequiresRebuild(S, entry)) {
      evaluateLaneProgram(S, entry);
    }
  }
  const prepublishedClaims = !claimSnapshotMatchesDemand(
    S,
    interactionEpoch.demandedCodes
  );
  if (prepublishedClaims)
    publishRacecraftClaimSnapshot(
      S,
      list,
      interactionEpoch.demandedCodes
    );
  for (const entry of list) {
    const neighbors = interactionEpoch.neighborsByCode.get(entry.code) ?? [];
    const localEntries = [entry, ...neighbors];
    const obligation = obligationsFor(S, entry, localEntries)[0];
    const selected = entry.racecraftDecision?.candidates.find(candidate =>
      candidate.planNumericId ===
        entry.racecraftDecision?.selectedPlanNumericId);
    const targetCode = selected?.slowPointOwnerCode ??
      (selected?.plan.mode !== 'ideal' && selected?.plan.mode !== 'pit'
        ? selected?.plan.leaderCode
        : null) ??
      entry.racecraftDecision?.candidates.find(candidate =>
        candidate.kind === 'brake-behind')?.slowPointOwnerCode ??
      null;
    const interacting = interactionEpoch.demandedCodes.has(entry.code) &&
      (!!obligation ||
        hasSideAgreement(S, entry.code) ||
        targetCode != null);
    if (!interacting) continue;
    const cause = obligation?.reason ??
      selected?.interactionCause ??
      'ordinary';
    const samples = S.racecraftInteractionSamples ??
      (S.racecraftInteractionSamples = {});
    samples[cause] = (samples[cause] ?? 0) + 1;
    const blueForced = obligation?.reason === 'blue-flag' &&
      obligationGeometryForcesSingleFile(S, obligation);
    if (blueForced)
      S.racecraftBlueForcedSpanSamples =
        (S.racecraftBlueForcedSpanSamples ?? 0) + 1;
    if (entry.inp.throttle <= 0.01 && entry.inp.brake <= 0.04) {
      const lifts = S.racecraftLiftSamples ?? (S.racecraftLiftSamples = {});
      lifts[cause] = (lifts[cause] ?? 0) + 1;
      if (cause === 'blue-flag') {
        if (blueForced)
          S.racecraftBlueForcedLiftSamples =
            (S.racecraftBlueForcedLiftSamples ?? 0) + 1;
        else
          S.racecraftBlueLiftOutsideForcedSpan =
            (S.racecraftBlueLiftOutsideForcedSpan ?? 0) + 1;
      }
    }
  }
  refreshDefenseEpisodes(S, list);

  const stagedDecisions: Array<{
    entry: ActiveEntry;
    decision: RacecraftDecision | null;
    neighbors: ActiveEntry[];
    certificateRenewal: 'authority' | 'emergency' | null;
  }> = [];
  for (let entryIndex = 0; entryIndex < list.length; entryIndex++) {
    const entry = list[entryIndex]!;
    const neighbors = interactionEpoch.neighborsByCode.get(entry.code) ?? [];
    S.racecraftTier0Checks = (S.racecraftTier0Checks ?? 0) + 1;
    const priorDecision = entry.racecraftDecision;
    if (!interactionEpoch.demandedCodes.has(entry.code)) {
      const retainedEmergency = publishedEmergencyDecision(S, entry);
      let decision: RacecraftDecision | null = retainedEmergency;
      let certificateRenewal: 'emergency' | null = null;
      if (retainedEmergency) {
        certificateRenewal = racecraftDecisionCertificateBreakReason(
          S,
          entry,
          []
        ) != null
          ? 'emergency'
          : null;
      } else if (racecraftLateralAuthoritySettledOnIdeal(S, entry)) {
        if (priorDecision?.certificate.zeroHazardIdeal &&
            racecraftDecisionCertificateBreakReason(S, entry, []) == null) {
          decision = priorDecision;
        } else {
          decision = makeRacecraftSettledSolitudeDecision(
            S,
            entry,
            racecraftCurrentGripUtilization(S, entry)
          );
          S.racecraftTier0IdealDominance =
            (S.racecraftTier0IdealDominance ?? 0) + 1;
        }
      }
      S.racecraftTier0Accepted = (S.racecraftTier0Accepted ?? 0) + 1;
      stagedDecisions.push({
        entry,
        decision,
        neighbors: [],
        certificateRenewal
      });
      continue;
    }
    const breakReason = racecraftDecisionCertificateBreakReason(
      S,
      entry,
      neighbors
    );
    let deliberated = false;
    let retainedInstalledEmergency = false;
    let decision = priorDecision ?? null;
    if (breakReason == null) {
      S.racecraftTier0Accepted = (S.racecraftTier0Accepted ?? 0) + 1;
    } else {
      recordCertificateBreak(S, breakReason);
      const retainedEmergency = publishedEmergencyDecision(S, entry);
      if (retainedEmergency) {
        retainedInstalledEmergency = true;
        decision = retainedEmergency;
        S.racecraftTier0Accepted = (S.racecraftTier0Accepted ?? 0) + 1;
      } else {
        deliberated = true;
        S.racecraftTier1Deliberations =
          (S.racecraftTier1Deliberations ?? 0) + 1;
        decision = evaluateRacecraftDecision(S, entry, list);
      }
      if (breakReason !== 'bootstrap' && breakReason !== 'expiry')
        S.racecraftReactionEvents = (S.racecraftReactionEvents ?? 0) + 1;
    }
    if (deliberated) {
      if (priorDecision) entry.racecraftDecision = priorDecision;
      else delete entry.racecraftDecision;
    }
    stagedDecisions.push({
      entry,
      decision,
      neighbors,
      certificateRenewal: breakReason != null && decision != null
        ? retainedInstalledEmergency
          ? 'emergency'
          : 'authority'
        : null
    });
  }
  for (const staged of stagedDecisions) {
    if (staged.decision) staged.entry.racecraftDecision = staged.decision;
    else delete staged.entry.racecraftDecision;
  }

  for (const staged of stagedDecisions) {
    const { entry, decision, neighbors } = staged;
    const localEntries = [entry, ...neighbors];
    if (entry.state === 'pitIn' || entry.state === 'pitOut') {
      installRacecraftLongitudinalProgram(entry, null);
      continue;
    }
    const selected = decision?.candidates.find(candidate =>
      candidate.planNumericId === decision.selectedPlanNumericId);
    const obligationParticipant = isObligationParticipant(
      S,
      entry,
      localEntries
    );
    const pitDestination = !!(entry.pitArm || entry.boxArm) &&
      selected?.plan.mode !== 'ideal' && selected?.plan.mode !== 'pit' &&
      selected?.plan.key.includes(':pit-destination:');
    const evaluatorOwnsLane = racecraftSelectedLaneIsExecutable(
      S,
      entry,
      neighbors,
      selected
    );
    if (selected && evaluatorOwnsLane &&
        selected.plan.mode !== 'ideal' &&
        selected.plan.mode !== 'pit' &&
        (pitDestination ||
          (selected.kind !== 'hold' && selected.kind !== 'brake-behind'))) {
      const reason = `space:${selected.plan.key}`;
      const bindingTarget = selected.kind === 'recenter'
        ? 'self'
        : obligationsFor(S, entry, localEntries)[0]?.beneficiary.code ??
          selected.plan.leaderCode ??
          selected.slowPointOwnerCode ??
          'self';
      const binding = pitDestination
        ? `pit-destination:${entry.code}`
        : `racecraft:${bindingTarget}`;
      if (entry.racecraftPathPlan !== selected.plan ||
          entry.laneProgram.reason !== reason ||
          entry.laneProgram.binding !== binding) {
        const attacker = selected.kind === 'hold' ||
            selected.kind === 'brake-behind'
          ? null
          : racecraftDefensiveAttacker(
              S,
              entry,
              list,
              selected.targetLateral
            );
        if (attacker && entry._racecraftAppliedKind !== selected.kind &&
            claimDefenseResponse(entry, attacker)) {
          entry._defendingAgainst = attacker.code;
          entry._defMoveKey = `${attacker.code}:active`;
          S.defMoveN = (S.defMoveN || 0) + 1;
        }
        installRacecraftPathPlan(
          tr,
          entry,
          reason,
          selected.plan,
          binding
        );
      }
      entry._racecraftAppliedAt = S.t;
      entry._racecraftAppliedKind = selected.kind;
    } else if (selected) {
      entry._racecraftAppliedKind = selected.kind;
    }
    const racecraftOwnsSpeed =
      S.mode === 'race' &&
      S.t - S.goT >= START_BLEND_END &&
      !!selected;
    const selectedLongitudinal =
      decision?.selectedLongitudinalProgram ?? null;
    installRacecraftLongitudinalProgram(
      entry,
      racecraftOwnsSpeed
        ? selectedLongitudinal
        : null
    );
    if (entry.trafficSlowPoint?.reason === 'traffic-follow:cost-candidate')
      installTrafficSlowPoint(entry, null);
    if (selected) {
      entry._racecraftAppliedAt = S.t;
      entry._racecraftAppliedKind = selected.kind;
    }
  }
  observeRacecraftDecisions(S, list);
  for (const e of list){
    if (e.state === 'pitIn' || e.state === 'pitOut') continue;
    if (e.avoidT > 0 && !hasSideAgreement(S, e.code)){
      const avoid = Math.min(3.2, tr.hw - 2.0);
      setTargetAbsLat(S, e, e._avoidSide * avoid, 'incident-avoid');
    }
    const neighbors = interactionEpoch.neighborsByCode.get(e.code) ?? [];
    maintainRacingLineZeroState(S, e, [e, ...neighbors]);
    const index = Math.max(0, e.car.progIdx) % tr.n;
    e.lat = e.latNow - (tr.idealPath?.off[index] ?? 0);
    const settledSolitude =
      !interactionEpoch.demandedCodes.has(e.code) &&
      racecraftLateralAuthoritySettledOnIdeal(S, e);
    if (settledSolitude) {
      delete e.laneBuffer;
      delete e._laneBufferRevision;
    } else if (e.pathPlan?.mode !== 'pit' &&
      (e._laneBufferRevision !== (e.laneEdits ?? 0) ||
        laneBufferCoverageRequiresRebuild(S, e))) {
      evaluateLaneProgram(S, e);
    }
  }
  if (interactionEpoch.demandedCodes.size > 0)
    publishRacecraftClaimSnapshot(
      S,
      list,
      interactionEpoch.demandedCodes
    );
  for (const staged of stagedDecisions) {
    if (staged.certificateRenewal === 'emergency')
      renewPublishedEmergencyCertificate(
        S,
        staged.entry,
        staged.neighbors
      );
    else if (staged.certificateRenewal === 'authority')
      sealRacecraftDecisionCertificate(
        S,
        staged.entry,
        staged.neighbors
      );
  }
  updateAttackEpisodes(S);
  recordTrafficFeel(S, list);
  updateStallDiagnostics(S);
}

function stepRacecraft(
  S: Session,
  e: ActiveEntry,
  a: ActiveEntry,
  ds: number
): void {
  const tr = S.trk;
  const sep = Math.abs(e.latNow - a.latNow);
  if (e._closingWith === a.code && e._closingDistance !== undefined) {
    const observed = clamp((e._closingDistance - ds) / TRAF_DT, -20, 20);
    e._trafficClosingVelocity = lerp(e._trafficClosingVelocity ?? observed, observed, 0.25);
  } else {
    e._closingWith = a.code;
    e._trafficClosingVelocity = 0;
  }
  e._closingDistance = ds;
  const startAge = S.t - S.goT;
  if (startAge < 4){
    setTargetAbsLat(S, e, e.gridLat, 'grid-hold');
    if (ds < TRAFFIC_NEIGHBOR_SCAN_METRES && sep < PHYS.carWid)
      applyQueueSlowPoint(S, e, a, ds, 0.75, 'start');
    if (ds < 12){ e.battle = true; a.battle = true; }
    return;
  }
  if (startAge < START_BLEND_END){
    const u = clamp((startAge - 4) / (START_BLEND_END - 4), 0, 1);
    editLaneEtaTarget(
      S,
      e,
      (1 - u) * (e.gridLat - lineOffAt(tr, e)),
      'start-release'
    );
    if (ds < TRAFFIC_NEIGHBOR_SCAN_METRES && sep < PHYS.carWid)
      applyQueueSlowPoint(
        S,
        e,
        a,
        ds,
        lerp(0.75, 0.45, u),
        'start-blend'
      );
    if (ds < 12){ e.battle = true; a.battle = true; }
    return;
  }
  if (ds > TRAFFIC_NEIGHBOR_SCAN_METRES) return;
  if (S.mode !== 'race')
    applyQueueSlowPoint(S, e, a, ds, 0.45, 'qualifying');

  const timeGap = ds / Math.max(1, a.spd);
  if (S.mode === 'race' && timeGap < 0.5) {
    a.pressureT = Math.min(8, a.pressureT + TRAF_DT * 2);
    a.underPressure = a.pressureT > 5;
  }
}
