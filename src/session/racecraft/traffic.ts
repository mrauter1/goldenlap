import { clamp, lerp, normAng } from '../../shared/math';
import { random } from '../../shared/rng';
import { PATH_FOLLOWER_TUNING } from '../../core/autopilot';
import { carBodyCircleClearance } from '../../core/collision';
import { speedEnvelopesEqual } from '../../core/speed-envelope';
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
  RacecraftLongitudinalProgram,
  RacecraftPublicationMode,
  Session,
  SideBySideEpisode,
  SideBySidePair
} from '../model';
import { RacecraftPendingDecisionReason } from '../model';
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
  updateRacecraftSideAgreements
} from './corridor-planner';
import {
  contractIsRevoked,
  isFixedOccupancy,
  obligationGeometryForcesSingleFile
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
  maintainRacingLineZeroState,
  racecraftCapabilityPaceRatio,
  racecraftCurrentGripUtilization,
  racecraftCurrentLaneCurvature,
  racecraftSelectedLaneIsExecutable
} from './evaluator';
import {
  buildRacecraftPlanningContext,
  buildRacecraftPlanningOrder,
  racecraftDecisionSlotIsDue,
  selectedCommittedDefenseView,
  type RacecraftPlanningContext
} from './planning-order';
import {
  classifyRacecraftOpportunity,
  type RacecraftOpportunity
} from './opportunity';
import {
  pruneRacecraftTacticalPublications,
  publishRacecraftTacticalPublication
} from './publication';
import { runRacecraftPredictiveSafetyPass } from './reactive-safety';
import {
  recordRacecraftDeliberation,
  recordRacecraftSameSlotReopening
} from './diagnostics';

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
    speedEnvelopesEqual(previous.envelope, program.envelope);
  entry.racecraftLongitudinalProgram = program;
  // The generation names the executed speed law, not the rival that happened
  // to induce it. Equal envelopes are the same authority; a changed envelope is
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

function forwardTrackDistance(
  length: number,
  from: number,
  to: number
): number {
  const distance = to - from;
  return distance < 0 ? distance + length : distance;
}

function transitionLaneBufferCoverageRequiresRebuild(
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

function recordSingleFileTrainDiagnostics(
  session: Session,
  entries: readonly ActiveEntry[]
): void {
  if (entries.length < 2) {
    delete session._racecraftCurrentSingleFileTrainKey;
    session._racecraftCurrentSingleFileTrainSeconds = 0;
    return;
  }
  const links = entries.map((follower, index) => {
    const leader = entries[(index + 1) % entries.length]!;
    const distance = forwardTrackDistance(
      session.trk.len,
      follower.car.s,
      leader.car.s
    );
    const inline = follower.state === 'run' &&
      leader.state === 'run' &&
      distance <= TRAFFIC_NEIGHBOR_SCAN_METRES &&
      Math.abs(follower.latNow - leader.latNow) <
        PHYS.carWid - Number.EPSILON;
    if (inline &&
        follower.racecraftLongitudinalProgram
          ?.slowPointOwnerCode === leader.code &&
        racecraftCapabilityPaceRatio(session, follower) <
          racecraftCapabilityPaceRatio(session, leader) -
            Number.EPSILON)
      session.racecraftFasterCarBlockedSeconds =
        (session.racecraftFasterCarBlockedSeconds ?? 0) + TRAF_DT;
    return inline;
  });
  let seam = links.findIndex(link => !link);
  if (seam < 0) seam = entries.length - 1;
  let currentStart = (seam + 1) % entries.length;
  let currentLength = 1;
  let bestStart = currentStart;
  let bestLength = 1;
  for (let step = 0; step < entries.length - 1; step++) {
    const from = (seam + 1 + step) % entries.length;
    const next = (from + 1) % entries.length;
    if (links[from]) {
      currentLength++;
      if (currentLength > bestLength) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
    } else {
      currentStart = next;
      currentLength = 1;
    }
  }
  if (bestLength < 2) {
    delete session._racecraftCurrentSingleFileTrainKey;
    session._racecraftCurrentSingleFileTrainSeconds = 0;
    return;
  }
  let key = entries[bestStart]!.code;
  for (let offset = 1; offset < bestLength; offset++)
    key += `>${entries[(bestStart + offset) % entries.length]!.code}`;
  const duration = session._racecraftCurrentSingleFileTrainKey === key
    ? (session._racecraftCurrentSingleFileTrainSeconds ?? 0) + TRAF_DT
    : TRAF_DT;
  session._racecraftCurrentSingleFileTrainKey = key;
  session._racecraftCurrentSingleFileTrainSeconds = duration;
  session.racecraftMaximumSingleFileTrainLength = Math.max(
    session.racecraftMaximumSingleFileTrainLength ?? 0,
    bestLength
  );
  session.racecraftLongestSingleFileTrainSeconds = Math.max(
    session.racecraftLongestSingleFileTrainSeconds ?? 0,
    duration
  );
}

export function unstableCar(tr: Track, e: Entry): boolean {
  if (!e.car) return false;
  const i = Math.max(0, e.car.progIdx);
  if (e.car.offCourse || Math.abs(e.car.r) > 1.0 ||
      Math.abs(e.car.slipR) > 0.28) return true;
  const roadH = e._trafficRoadHeading ?? Math.atan2(tr.ty[i]!, tr.tx[i]!);
  return Math.abs(normAng(e.car.h - roadH)) > 0.42;
}

function directDecision(
  session: Session,
  entry: ActiveEntry,
  opportunity: RacecraftOpportunity
): RacecraftDecision {
  const follow = opportunity.classification === 'direct-follow';
  const proofKey = follow
    ? `direct-follow:` +
      `${opportunity.negativeSideCertificate?.reason ?? 'missing'}|` +
      `${opportunity.positiveSideCertificate?.reason ?? 'missing'}`
    : `direct-ideal:${opportunity.reason}`;
  const proofs = session.racecraftDirectDecisionProofs ??
    (session.racecraftDirectDecisionProofs =
      Object.create(null) as Record<string, number>);
  proofs[proofKey] = (proofs[proofKey] ?? 0) + 1;
  if (follow) {
    session.racecraftDirectFollowDecisions =
      (session.racecraftDirectFollowDecisions ?? 0) + 1;
    if (!opportunity.negativeSideCertificate ||
        !opportunity.positiveSideCertificate)
      session.racecraftDirectFollowWithoutCertificates =
        (session.racecraftDirectFollowWithoutCertificates ?? 0) + 1;
  } else {
    session.racecraftDirectIdealDecisions =
      (session.racecraftDirectIdealDecisions ?? 0) + 1;
  }
  const index = Math.max(0, entry.car.progIdx) % session.trk.n;
  return {
    at: session.t,
    decisionMode: follow ? 'direct-follow' : 'direct-ideal',
    selectedKind: 'ideal',
    selectedPlanNumericId: null,
    selectedPlanKey: null,
    candidateCount: 0,
    targetLateral: session.trk.idealPath.off[index]!,
    interactionCause: null,
    chosenUtilization: racecraftCurrentGripUtilization(session, entry),
    selectedLongitudinalProgram: follow
      ? opportunity.constrainedProgram
      : opportunity.freeProgram,
    cornerOwnershipAssertion: null,
    economics: [],
    candidates: []
  };
}

function evaluatedPublicationMode(
  entry: ActiveEntry,
  context: RacecraftPlanningContext,
  decision: RacecraftDecision
): RacecraftPublicationMode {
  const selected = decision.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  if (!selected) return 'direct-follow';
  if (selected.plan.mode !== 'ideal' && selected.plan.mode !== 'pit' &&
      selected.plan.surfaceAuthorization === 'emergency')
    return 'emergency';
  if (decision.defenderReclaim) return 'ownership-response';
  if (context.sideCounterparts.length > 0) return 'side-by-side';
  if (decision.defensiveTargetCode != null) return 'defense';
  if (selectedCommittedDefenseView(entry, context, decision))
    return 'defense';
  if (decision.cornerOwnershipAssertion) return 'staged-attack';
  if (selected.plan.mode !== 'ideal' && selected.plan.mode !== 'pit' &&
      selected.plan.leaderCode &&
      selected.kind !== 'hold' &&
      selected.kind !== 'brake-behind' &&
      selected.kind !== 'recenter')
    return 'staged-attack';
  return 'direct-follow';
}

function updatePendingDecisionReasons(
  session: Session,
  entry: ActiveEntry,
  context: RacecraftPlanningContext
): void {
  let pending = (entry.racecraftPendingDecisionReasons ?? 0) |
    RacecraftPendingDecisionReason.MeasuredState;
  const forwardKey = context.forwardEntries.map(other =>
    `${other.code}:${context.publications.get(other.code)
      ?.publicationRevision ?? -1}`).join('|');
  if (entry._racecraftForwardPublicationKey !== forwardKey) {
    entry._racecraftForwardPublicationKey = forwardKey;
    pending |= RacecraftPendingDecisionReason.ForwardPublication;
  }
  const rearKey = context.committedAttacks.map(attack =>
    `${attack.attackerCode}:${attack.publicationRevision}`).join('|');
  if (entry._racecraftRearCommitmentKey !== rearKey) {
    entry._racecraftRearCommitmentKey = rearKey;
    pending |= RacecraftPendingDecisionReason.RearCommitment;
  }
  const sideKey = context.sideCounterparts.map(other =>
    `${other.code}:${session.sideAgreements?.has(
      roomPairKey(entry, other)
    ) ? 1 : 0}`).join('|');
  if (entry._racecraftSideGeometryKey !== sideKey) {
    entry._racecraftSideGeometryKey = sideKey;
    pending |= RacecraftPendingDecisionReason.SideGeometry;
  }
  const ownershipKey = context.ownershipViews
    .map(view => view.assertion.assertionId)
    .sort()
    .join('|');
  if (entry._racecraftOwnershipKey !== ownershipKey) {
    entry._racecraftOwnershipKey = ownershipKey;
    pending |= RacecraftPendingDecisionReason.Ownership;
  }
  const obligationKey = context.obligations.map(obligation =>
    `${obligation.reason}:${obligation.yielding.code}:` +
    obligation.beneficiary.code).sort().join('|');
  if (entry._racecraftObligationKey !== obligationKey) {
    entry._racecraftObligationKey = obligationKey;
    pending |= RacecraftPendingDecisionReason.SportingObligation;
  }
  const installed = entry.racecraftLongitudinalProgram;
  if (installed &&
      entry.prog >= installed.envelope.endProgress - Number.EPSILON)
    pending |= RacecraftPendingDecisionReason.AuthorityInfeasible;
  entry.racecraftPendingDecisionReasons = pending;
}

function installDirectionalDecision(
  session: Session,
  entry: ActiveEntry,
  context: RacecraftPlanningContext
): void {
  const decision = entry.racecraftDecision;
  if (entry.state === 'pitIn' || entry.state === 'pitOut') {
    installRacecraftLongitudinalProgram(entry, null);
    return;
  }
  const selected = decision?.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  const evaluatorOwnsLane = racecraftSelectedLaneIsExecutable(
    session,
    entry,
    context.evaluationEntries.filter(other => other !== entry),
    selected
  );
  if (selected && evaluatorOwnsLane &&
      selected.plan.mode !== 'ideal' &&
      selected.plan.mode !== 'pit' &&
      selected.kind !== 'hold' &&
      selected.kind !== 'brake-behind') {
    const reason = `space:${selected.plan.key}`;
    const bindingTarget = selected.kind === 'recenter'
      ? 'self'
      : context.obligations.find(obligation =>
          obligation.yielding === entry)?.beneficiary.code ??
        selected.plan.leaderCode ??
        selected.slowPointOwnerCode ??
        'self';
    const binding = `racecraft:${bindingTarget}`;
    if (entry.racecraftPathPlan !== selected.plan ||
        entry.laneProgram.reason !== reason ||
        entry.laneProgram.binding !== binding)
      installRacecraftPathPlan(
        session.trk,
        entry,
        reason,
        selected.plan,
        binding
      );
  }
  const ownsSpeed = session.mode === 'race' &&
    session.t - session.goT >= START_BLEND_END &&
    decision != null;
  installRacecraftLongitudinalProgram(
    entry,
    ownsSpeed ? decision.selectedLongitudinalProgram : null
  );
  if (entry.trafficSlowPoint?.reason === 'traffic-follow:cost-candidate')
    installTrafficSlowPoint(entry, null);
}

export function updateTraffic(S: Session): void {
  const tr = S.trk, len = tr.len;
  const calibration = racecraftCalibration();
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
      // This observer starts at exact-width geometric non-overlap; sub-width
      // contact remains physical while near-rub preference belongs to J.
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
    recordSingleFileTrainDiagnostics(S, list);

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
    recordSingleFileTrainDiagnostics(S, list);
    for (const key in sbsPairs){
      const ep = sbsPairs[key]!;
      if (sbsEpisodes.length >= 200) sbsEpisodes.shift();
      sbsEpisodes.push({ t: Math.max(TRAF_DT, S.t - ep.t0), contact: ep.contact, reason: 'state' });
      delete sbsPairs[key];
    }
  }
  syncPitPaths(S, list);
  updateRacecraftSideAgreements(S, list);
  S.racecraftTrafficEpoch = (S.racecraftTrafficEpoch ?? -1) + 1;
  const trafficEpoch = S.racecraftTrafficEpoch;
  pruneRacecraftTacticalPublications(
    S,
    new Set(list.map(entry => entry.code))
  );
  runRacecraftPredictiveSafetyPass(S, list, trafficEpoch);
  const order = buildRacecraftPlanningOrder(S, list);
  const evaluatedThisPass = new Set<string>();
  for (const entry of order.orderedEntries) {
    const context = buildRacecraftPlanningContext(
      S,
      entry,
      list,
      S.racecraftClaims ?? new Map()
    );
    updatePendingDecisionReasons(S, entry, context);
    const due = racecraftDecisionSlotIsDue(trafficEpoch, entry);
    if (due) {
      if (evaluatedThisPass.has(entry.code)) {
        recordRacecraftSameSlotReopening(S);
        throw new Error(
          `${entry.code} reopened in traffic epoch ${trafficEpoch}`
        );
      }
      evaluatedThisPass.add(entry.code);
      S.racecraftCommittedAttackViews =
        (S.racecraftCommittedAttackViews ?? 0) +
        context.committedAttacks.length;
      S.racecraftOwnershipInvalidations =
        (S.racecraftOwnershipInvalidations ?? 0) +
        context.ownershipInvalidationCount;
      if (context.ownershipInvalidationReasons.length > 0) {
        const byReason = S.racecraftOwnershipInvalidationsByReason ??
          (S.racecraftOwnershipInvalidationsByReason = {});
        for (const reason of context.ownershipInvalidationReasons)
          byReason[reason] = (byReason[reason] ?? 0) + 1;
      }
      if (context.ownershipViews.length > 0)
        S.racecraftOwnershipCurrentValidations =
          (S.racecraftOwnershipCurrentValidations ?? 0) +
          context.ownershipViews.length;
      if (entry.state === 'pitIn' || entry.state === 'pitOut') {
        delete entry.racecraftDecision;
      } else {
        const retainedEmergency = publishedEmergencyDecision(S, entry);
        const opportunity = classifyRacecraftOpportunity(S, context);
        let decision: RacecraftDecision | null;
        if (retainedEmergency) {
          decision = {
            ...retainedEmergency,
            at: S.t,
            decisionMode: 'emergency'
          };
        } else if (opportunity.classification === 'direct-ideal' ||
            opportunity.classification === 'direct-follow') {
          decision = directDecision(S, entry, opportunity);
        } else {
          recordRacecraftDeliberation(S, entry);
          decision = evaluateRacecraftDecision(
            S,
            entry,
            context.evaluationEntries,
            context.ownershipViews
          );
          if (decision)
            decision.decisionMode = evaluatedPublicationMode(
              entry,
              context,
              decision
            );
          if (decision?.decisionMode === 'defense' ||
              decision?.decisionMode === 'ownership-response') {
            const target = decision.decisionMode === 'defense'
              ? decision.defensiveTargetCode != null
                ? {
                    attackerCode: decision.defensiveTargetCode,
                    cornerId: decision.defensiveCornerId ?? null
                  }
                : selectedCommittedDefenseView(entry, context, decision)
              : context.ownershipViews[0]
                ? {
                    attackerCode:
                      context.ownershipViews[0].attacker.code,
                    cornerId:
                      context.ownershipViews[0].assertion.cornerId
                  }
                : null;
            if (!target)
              throw new Error(
                `${entry.code} published ${decision.decisionMode} ` +
                `without a current directional target`
              );
            decision.publicationTargetCode = target.attackerCode;
            decision.publicationCornerId = 'cornerId' in target
              ? target.cornerId
              : context.publications.get(target.attackerCode)
                  ?.cornerId ?? null;
            if (decision.decisionMode === 'defense') {
              S.racecraftDefensiveResponses =
                (S.racecraftDefensiveResponses ?? 0) + 1;
            }
          }
        }
        if (decision) entry.racecraftDecision = decision;
        else if (entry.recT > 0 || entry.car.offCourse)
          delete entry.racecraftDecision;
        else {
          throw new Error(
            `${entry.code} directional evaluator produced no authority`
          );
        }
      }
      entry._racecraftLastDecisionTrafficEpoch = trafficEpoch;
      entry.racecraftPendingDecisionReasons =
        RacecraftPendingDecisionReason.None;
      installDirectionalDecision(S, entry, context);
      if (entry.avoidT > 0 && !hasSideAgreement(S, entry.code)) {
        const avoid = Math.min(3.2, tr.hw - 2.0);
        setTargetAbsLat(
          S,
          entry,
          entry._avoidSide * avoid,
          'incident-avoid'
        );
      }
      maintainRacingLineZeroState(
        S,
        entry,
        context.evaluationEntries
      );
      publishRacecraftTacticalPublication(
        S,
        entry,
        trafficEpoch
      );
    }

    const selected = entry.racecraftDecision?.candidates.find(candidate =>
      candidate.planNumericId ===
        entry.racecraftDecision?.selectedPlanNumericId);
    const obligation = context.obligations.find(value =>
      value.yielding === entry);
    if (obligation || context.sideCounterparts.length ||
        context.forwardEntries.length) {
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
        const lifts = S.racecraftLiftSamples ??
          (S.racecraftLiftSamples = {});
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

    const index = Math.max(0, entry.car.progIdx) % tr.n;
    entry.lat = entry.latNow - (tr.idealPath.off[index] ?? 0);
    const transitionLaneAuthority = !entry.racecraftLateralProgram &&
      (entry.laneProgram.points.length > 0 ||
        Math.abs(entry.laneProgram.bias) > Number.EPSILON ||
        entry.laneProgram.binding != null);
    if (entry.pathPlan?.mode !== 'pit' && !transitionLaneAuthority) {
      delete entry.laneBuffer;
      delete entry._laneBufferRevision;
    } else if (entry.pathPlan?.mode !== 'pit' &&
        transitionLaneAuthority &&
        (!entry.laneBuffer ||
          entry._laneBufferRevision !== (entry.laneEdits ?? 0) ||
          transitionLaneBufferCoverageRequiresRebuild(S, entry))) {
      evaluateLaneProgram(S, entry);
    }
  }
  observeRacecraftDecisions(S, list);
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
