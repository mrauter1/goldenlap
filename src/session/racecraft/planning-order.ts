import type { Car } from '../../core/model';
import { PHYS } from '../../core/physics';
import type {
  Entry,
  RacecraftClaim,
  RacecraftDecision,
  RacecraftCommittedAttackView,
  RacecraftCornerOwnershipAssertion,
  RacecraftOwnershipValidationReason,
  Session
} from '../model';
import type { ValidatedCornerOwnership } from '../model';
import { TRAF_DT } from '../strategy';
import {
  OBSTACLE_NEIGHBOR_SCAN_METRES,
  TRAFFIC_NEIGHBOR_SCAN_METRES
} from './config';
import { longitudinalBodyProjection, racecraftPairKey } from './geometry';
import {
  contractIsRevoked,
  isFixedOccupancy,
  obligationsFor,
  type RacecraftObligation
} from './relations';
import {
  racecraftClaimHorizonSeconds,
  racecraftClaimStateAtTime
} from './claim';
import { validateCornerOwnership } from './corner-ownership';

export type RacecraftActiveEntry = Entry & { car: Car };

export const RACECRAFT_DIRECTIONAL_SLOT_COUNT = 3;

export interface RacecraftPlanningComponent {
  readonly entries: readonly RacecraftActiveEntry[];
  readonly cyclicFallback: boolean;
}

export interface RacecraftPlanningOrder {
  readonly components: readonly RacecraftPlanningComponent[];
  readonly orderedEntries: readonly RacecraftActiveEntry[];
}

export interface RacecraftPlanningContext {
  readonly entry: RacecraftActiveEntry;
  readonly publications: ReadonlyMap<string, RacecraftClaim>;
  readonly forwardEntries: readonly RacecraftActiveEntry[];
  readonly rearEntries: readonly RacecraftActiveEntry[];
  readonly sideCounterparts: readonly RacecraftActiveEntry[];
  readonly obligations: readonly RacecraftObligation[];
  readonly fixedHazards: readonly RacecraftActiveEntry[];
  readonly safetyEntries: readonly RacecraftActiveEntry[];
  readonly committedAttacks: readonly RacecraftCommittedAttackView[];
  readonly ownershipViews: readonly RacecraftActionableOwnershipView[];
  readonly ownershipInvalidationCount: number;
  readonly ownershipInvalidationReasons:
    readonly RacecraftOwnershipValidationReason[];
  readonly evaluationEntries: readonly RacecraftActiveEntry[];
}

export interface RacecraftActionableOwnershipView {
  readonly assertion: RacecraftCornerOwnershipAssertion;
  readonly validation: ValidatedCornerOwnership;
  readonly attacker: RacecraftActiveEntry;
}

function forwardDistance(
  session: Session,
  from: number,
  to: number
): number {
  const distance = to - from;
  return distance < 0 ? distance + session.trk.len : distance;
}

function pairScanMetres(
  session: Session,
  first: RacecraftActiveEntry,
  second: RacecraftActiveEntry
): number {
  return contractIsRevoked(session, first) ||
      contractIsRevoked(session, second) ||
      isFixedOccupancy(session, first) ||
      isFixedOccupancy(session, second)
    ? OBSTACLE_NEIGHBOR_SCAN_METRES
    : TRAFFIC_NEIGHBOR_SCAN_METRES;
}

/**
 * Components split at measured gaps and each component is traversed from its
 * physical front toward its rear. A dense cyclic field uses the largest gap
 * as a deterministic seam; no result depends on array insertion order.
 */
export function buildRacecraftPlanningOrder(
  session: Session,
  activeEntries: readonly RacecraftActiveEntry[]
): RacecraftPlanningOrder {
  if (activeEntries.length === 0)
    return { components: [], orderedEntries: [] };
  if (activeEntries.length === 1) {
    const entries = [activeEntries[0]!];
    return {
      components: [{ entries, cyclicFallback: false }],
      orderedEntries: entries
    };
  }

  const sorted = [...activeEntries].sort((left, right) =>
    left.car.s - right.car.s || left.code.localeCompare(right.code));
  const breaks: number[] = [];
  let largestGapIndex = 0;
  let largestGap = -Infinity;
  for (let index = 0; index < sorted.length; index++) {
    const nextIndex = (index + 1) % sorted.length;
    const gap = forwardDistance(
      session,
      sorted[index]!.car.s,
      sorted[nextIndex]!.car.s
    );
    if (gap > largestGap + Number.EPSILON ||
        (Math.abs(gap - largestGap) <= Number.EPSILON &&
          sorted[nextIndex]!.code.localeCompare(
            sorted[(largestGapIndex + 1) % sorted.length]!.code
          ) < 0)) {
      largestGap = gap;
      largestGapIndex = index;
    }
    if (gap > pairScanMetres(
      session,
      sorted[index]!,
      sorted[nextIndex]!
    )) breaks.push(index);
  }

  const cyclicFallback = breaks.length === 0;
  const seam = cyclicFallback
    ? largestGapIndex
    : breaks.reduce((best, index) => {
        const bestNext = (best + 1) % sorted.length;
        const next = (index + 1) % sorted.length;
        const bestGap = forwardDistance(
          session,
          sorted[best]!.car.s,
          sorted[bestNext]!.car.s
        );
        const gap = forwardDistance(
          session,
          sorted[index]!.car.s,
          sorted[next]!.car.s
        );
        return gap > bestGap + Number.EPSILON ||
          (Math.abs(gap - bestGap) <= Number.EPSILON &&
            sorted[next]!.code.localeCompare(sorted[bestNext]!.code) < 0)
          ? index
          : best;
      }, breaks[0]!);

  const rotated = sorted.map((_, index) =>
    sorted[(seam + 1 + index) % sorted.length]!);
  const ascendingComponents: RacecraftActiveEntry[][] = [[]];
  for (let index = 0; index < rotated.length; index++) {
    const current = rotated[index]!;
    ascendingComponents.at(-1)!.push(current);
    const next = rotated[index + 1];
    if (!next) continue;
    if (forwardDistance(session, current.car.s, next.car.s) >
        pairScanMetres(session, current, next))
      ascendingComponents.push([]);
  }
  const components = ascendingComponents
    .filter(entries => entries.length > 0)
    .map(entries => ({
      entries: [...entries].reverse(),
      cyclicFallback
    }));
  return {
    components,
    orderedEntries: components.flatMap(component => component.entries)
  };
}

export function racecraftDecisionSlotForCode(code: string): number {
  let hash = 2166136261;
  for (let index = 0; index < code.length; index++) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % RACECRAFT_DIRECTIONAL_SLOT_COUNT;
}

export function racecraftDecisionSlotIsDue(
  trafficEpoch: number,
  entry: Entry
): boolean {
  return trafficEpoch % RACECRAFT_DIRECTIONAL_SLOT_COUNT ===
    racecraftDecisionSlotForCode(entry.code);
}

function uniqueEntries(
  entries: readonly RacecraftActiveEntry[]
): RacecraftActiveEntry[] {
  const byCode = new Map<string, RacecraftActiveEntry>();
  for (const entry of entries) byCode.set(entry.code, entry);
  return [...byCode.values()].sort((left, right) =>
    left.code.localeCompare(right.code));
}

function sideCounterparts(
  session: Session,
  entry: RacecraftActiveEntry,
  active: readonly RacecraftActiveEntry[]
): RacecraftActiveEntry[] {
  const counterparts: RacecraftActiveEntry[] = [];
  for (const candidate of active) {
    if (candidate === entry) continue;
    const constrained = session.sideAgreements?.has(
      racecraftPairKey(entry.code, candidate.code)
    ) ?? false;
    if (constrained ||
        longitudinalBodyProjection(
          session.trk,
          entry,
          candidate
        ).overlap)
      counterparts.push(candidate);
  }
  return counterparts.sort((left, right) =>
    left.code.localeCompare(right.code));
}

function committedAttackView(
  session: Session,
  defender: RacecraftActiveEntry,
  attacker: RacecraftActiveEntry,
  publication: RacecraftClaim
): RacecraftCommittedAttackView | null {
  if (publication.mode !== 'staged-attack' ||
      publication.targetCode !== defender.code ||
      publication.selectedFamilyNumericId == null ||
      !publication.trusted)
    return null;
  const age = Math.max(0, session.t - publication.publishedAt);
  const lastTime = racecraftClaimHorizonSeconds(publication);
  if (age > lastTime + TRAF_DT + Number.EPSILON) return null;
  const current = racecraftClaimStateAtTime(
    session.trk,
    publication,
    age
  );
  const defenderPublication = session.racecraftClaims?.get(defender.code);
  const remainingSeconds = Math.max(0, lastTime - age);
  const future = racecraftClaimStateAtTime(
    session.trk,
    publication,
    age + remainingSeconds
  );
  const defenderCurrent = defenderPublication
    ? racecraftClaimStateAtTime(
        session.trk,
        defenderPublication,
        Math.max(0, session.t - defenderPublication.publishedAt)
      )
    : {
        s: defender.car.s,
        lateral: defender.latNow,
        speed: defender.spd,
        headingOffsetRadians: 0
      };
  const defenderFuture = defenderPublication
    ? racecraftClaimStateAtTime(
        session.trk,
        defenderPublication,
        Math.max(0, session.t - defenderPublication.publishedAt) +
          remainingSeconds
      )
    : defenderCurrent;
  const currentRelative =
    current.lateral - defenderCurrent.lateral;
  const futureRelative =
    future.lateral - defenderFuture.lateral;
  const relative = Math.abs(futureRelative) > Number.EPSILON
    ? futureRelative
    : currentRelative;
  if (Math.abs(relative) <= Number.EPSILON) return null;
  const side = relative < 0 ? -1 : 1;
  const sideClear =
    Math.abs(currentRelative) >= PHYS.carWid - Number.EPSILON;
  return {
    attackerCode: attacker.code,
    targetCode: defender.code,
    publicationRevision: publication.publicationRevision,
    familyNumericId: publication.selectedFamilyNumericId,
    side,
    acquisitionProgressing:
      side * (futureRelative - currentRelative) > Number.EPSILON ||
      sideClear,
    sideClear
  };
}

/**
 * A committed rear publication opens deliberation, but it labels the
 * selected result as defense only when the leader actually covers that side
 * (or continues the same already-published cover family).
 */
export function selectedCommittedDefenseView(
  entry: RacecraftActiveEntry,
  context: RacecraftPlanningContext,
  decision: RacecraftDecision
): RacecraftCommittedAttackView | null {
  const selected = decision.candidates.find(candidate =>
    candidate.planNumericId === decision.selectedPlanNumericId);
  if (!selected ||
      selected.plan.mode === 'ideal' ||
      selected.plan.mode === 'pit' ||
      (selected.plan.mode !== 'side-inside' &&
        selected.plan.mode !== 'side-outside') ||
      selected.plan.surfaceAuthorization === 'emergency')
    return null;
  const ownPublication = context.publications.get(entry.code);
  const direction = Math.sign(selected.targetLateral - entry.latNow);
  for (const attack of context.committedAttacks) {
    const continuing =
      ownPublication?.mode === 'defense' &&
      ownPublication.targetCode === attack.attackerCode &&
      ownPublication.selectedFamilyNumericId ===
        selected.familyNumericId;
    if (continuing ||
        (direction !== 0 && direction === attack.side))
      return attack;
  }
  return null;
}

export function buildRacecraftPlanningContext(
  session: Session,
  entry: RacecraftActiveEntry,
  active: readonly RacecraftActiveEntry[],
  publications: ReadonlyMap<string, RacecraftClaim>
): RacecraftPlanningContext {
  const forward: Array<{
    entry: RacecraftActiveEntry;
    distance: number;
  }> = [];
  const rear: Array<{
    entry: RacecraftActiveEntry;
    distance: number;
  }> = [];
  const fixedHazards: RacecraftActiveEntry[] = [];
  const safetyEntries: RacecraftActiveEntry[] = [];
  for (const candidate of active) {
    if (candidate === entry) continue;
    const ahead = forwardDistance(
      session,
      entry.car.s,
      candidate.car.s
    );
    const behind = forwardDistance(
      session,
      candidate.car.s,
      entry.car.s
    );
    const fixed = contractIsRevoked(session, candidate) ||
      isFixedOccupancy(session, candidate);
    const scan = fixed
      ? OBSTACLE_NEIGHBOR_SCAN_METRES
      : TRAFFIC_NEIGHBOR_SCAN_METRES;
    if (Math.min(ahead, behind) <= scan)
      safetyEntries.push(candidate);
    if (fixed && Math.min(ahead, behind) <= scan)
      fixedHazards.push(candidate);
    if (ahead > 0 && ahead <= scan)
      forward.push({ entry: candidate, distance: ahead });
    if (behind > 0 && behind <= TRAFFIC_NEIGHBOR_SCAN_METRES)
      rear.push({ entry: candidate, distance: behind });
  }
  const compare = (
    left: { entry: RacecraftActiveEntry; distance: number },
    right: { entry: RacecraftActiveEntry; distance: number }
  ): number => left.distance - right.distance ||
    left.entry.code.localeCompare(right.entry.code);
  forward.sort(compare);
  rear.sort(compare);
  const forwardEntries = forward.slice(0, 2).map(value => value.entry);
  const rearEntries = rear.map(value => value.entry);
  const sides = sideCounterparts(session, entry, active);
  const obligations = obligationsFor(session, entry, active);
  const committedAttacks: RacecraftCommittedAttackView[] = [];
  for (const candidate of rearEntries) {
    const publication = publications.get(candidate.code);
    const view = publication
      ? committedAttackView(session, entry, candidate, publication)
      : null;
    if (view) committedAttacks.push(view);
  }
  committedAttacks.sort((left, right) =>
    left.attackerCode.localeCompare(right.attackerCode));
  const ownPublication = publications.get(entry.code);
  const ownershipViews: RacecraftActionableOwnershipView[] = [];
  const ownershipInvalidationReasons:
    RacecraftOwnershipValidationReason[] = [];
  if (ownPublication) {
    for (const publication of publications.values()) {
      const assertion = publication.ownershipAssertion;
      if (!assertion || assertion.targetCode !== entry.code) continue;
      const attacker = active.find(candidate =>
        candidate.code === assertion.attackerCode);
      if (!attacker) continue;
      const validation = validateCornerOwnership({
        session,
        assertion,
        attacker,
        attackerPublication: publication,
        leader: entry,
        leaderPublication: ownPublication
      });
      if (validation.reason === 'current' &&
          (validation.outcome === 'attacker-owned' ||
            validation.outcome === 'shared'))
        ownershipViews.push({ assertion, validation, attacker });
      else
        ownershipInvalidationReasons.push(validation.reason);
    }
  }
  ownershipViews.sort((left, right) =>
    left.attacker.code.localeCompare(right.attacker.code));
  const obligationEntries = obligations.flatMap(obligation => [
    obligation.yielding,
    obligation.beneficiary
  ]).filter((candidate): candidate is RacecraftActiveEntry =>
    candidate !== entry && candidate.car != null);
  const attackerEntries = committedAttacks
    .map(view => active.find(candidate =>
      candidate.code === view.attackerCode))
    .filter((candidate): candidate is RacecraftActiveEntry =>
      candidate != null);
  return {
    entry,
    publications,
    forwardEntries,
    rearEntries,
    sideCounterparts: sides,
    obligations,
    fixedHazards,
    safetyEntries: uniqueEntries(safetyEntries),
    committedAttacks,
    evaluationEntries: uniqueEntries([
      entry,
      ...forwardEntries,
      ...sides,
      ...obligationEntries,
      ...attackerEntries,
      ...ownershipViews.map(view => view.attacker),
      ...fixedHazards
    ]),
    ownershipViews,
    ownershipInvalidationCount: ownershipInvalidationReasons.length,
    ownershipInvalidationReasons
  };
}
