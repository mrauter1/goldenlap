import { PHYS } from '../../core/physics';
import { normalLateralEnvelope } from '../../core/surface';
import type {
  RacecraftClaim,
  RacecraftLongitudinalProgram,
  Session
} from '../model';
import {
  composeRacecraftFreeLongitudinalProgram,
  composeRacecraftLeaderSafeProgram,
  firstRacecraftLongitudinalBinding,
  type RacecraftLongitudinalBinding
} from './longitudinal-program';
import {
  physicalLaneMoveSeconds,
  racecraftPairKey
} from './geometry';
import type {
  RacecraftActiveEntry,
  RacecraftPlanningContext
} from './planning-order';

export type RacecraftSide = -1 | 1;

export type RacecraftSideImpossibilityReason =
  | 'live-side-constraint'
  | 'fixed-occupancy'
  | 'no-connected-normal-corridor'
  | 'physical-reach-exceeds-corridor';

export interface RacecraftSideImpossibilityCertificate {
  readonly side: RacecraftSide;
  readonly reason: RacecraftSideImpossibilityReason;
  readonly counterpartCode: string | null;
}

export type RacecraftOpportunityClassification =
  | 'direct-ideal'
  | 'direct-follow'
  | 'deliberate'
  | 'mandatory';

export interface RacecraftOpportunity {
  readonly classification: RacecraftOpportunityClassification;
  readonly reason: string;
  readonly leader: RacecraftActiveEntry | null;
  readonly leaderPublication: RacecraftClaim | null;
  readonly freeProgram: RacecraftLongitudinalProgram;
  readonly constrainedProgram: RacecraftLongitudinalProgram | null;
  readonly binding: RacecraftLongitudinalBinding | null;
  readonly negativeSideCertificate:
    RacecraftSideImpossibilityCertificate | null;
  readonly positiveSideCertificate:
    RacecraftSideImpossibilityCertificate | null;
}

function sideConstraintCertificate(
  session: Session,
  context: RacecraftPlanningContext,
  side: RacecraftSide
): RacecraftSideImpossibilityCertificate | null {
  const entry = context.entry;
  for (const counterpart of context.sideCounterparts) {
    const delta = counterpart.latNow - entry.latNow;
    if (side * delta <= 0) continue;
    if (session.sideAgreements?.has(
      racecraftPairKey(entry.code, counterpart.code)
    ))
      return {
        side,
        reason: 'live-side-constraint',
        counterpartCode: counterpart.code
      };
  }
  for (const fixed of context.fixedHazards) {
    const delta = fixed.latNow - entry.latNow;
    if (side * delta <= 0) continue;
    const longitudinal = Math.abs(
      fixed.car.s - entry.car.s
    );
    if (longitudinal <= PHYS.carLen)
      return {
        side,
        reason: 'fixed-occupancy',
        counterpartCode: fixed.code
      };
  }
  return null;
}

function currentSurfaceCertificate(
  session: Session,
  context: RacecraftPlanningContext,
  leaderPublication: RacecraftClaim,
  side: RacecraftSide
): RacecraftSideImpossibilityCertificate | null {
  const entry = context.entry;
  const currentIndex = Math.max(0, entry.car.progIdx) % session.trk.n;
  const required = leaderPublication.originCentre + side * PHYS.carWid;
  const currentEnvelope = normalLateralEnvelope(
    session.trk,
    currentIndex
  );
  const currentlyLegal = required >=
      currentEnvelope.minimum - Number.EPSILON &&
    required <= currentEnvelope.maximum + Number.EPSILON;
  const moveSeconds = physicalLaneMoveSeconds(session, entry, required);
  if (currentlyLegal && Number.isFinite(moveSeconds)) return null;

  const reachDistance = Math.max(
    PHYS.carLen,
    Math.max(0, entry.spd) * (
      Number.isFinite(moveSeconds) ? moveSeconds : 0
    )
  );
  const samples = Math.max(
    1,
    Math.ceil(reachDistance / session.trk.step)
  );
  let connectedMetres = 0;
  for (let sample = 0; sample <= samples; sample++) {
    const index = (currentIndex + sample) % session.trk.n;
    const envelope = normalLateralEnvelope(session.trk, index);
    const legal = required >= envelope.minimum - Number.EPSILON &&
      required <= envelope.maximum + Number.EPSILON;
    if (!legal) {
      if (connectedMetres > 0 &&
          connectedMetres + Number.EPSILON < reachDistance)
        return {
          side,
          reason: 'physical-reach-exceeds-corridor',
          counterpartCode: null
        };
      continue;
    }
    connectedMetres += session.trk.step;
  }
  // A finite sampled horizon cannot prove that a later corridor never opens.
  // Certify only the track-representation case where this side is absent for
  // a complete lap; every ambiguous or merely delayed side opens deliberation.
  for (let offset = 0; offset < session.trk.n; offset++) {
    const envelope = normalLateralEnvelope(
      session.trk,
      (currentIndex + offset) % session.trk.n
    );
    if (required >= envelope.minimum - Number.EPSILON &&
        required <= envelope.maximum + Number.EPSILON)
      return null;
  }
  return {
    side,
    reason: 'no-connected-normal-corridor',
    counterpartCode: null
  };
}

function impossibilityCertificate(
  session: Session,
  context: RacecraftPlanningContext,
  publication: RacecraftClaim,
  side: RacecraftSide
): RacecraftSideImpossibilityCertificate | null {
  return sideConstraintCertificate(session, context, side) ??
    currentSurfaceCertificate(session, context, publication, side);
}

/**
 * Direct modes are proofs, never sticky states. In particular a binding at
 * the current progress says nothing about lateral acquisition: if either side
 * remains viable or uncertain, deliberate evaluation opens.
 */
export function classifyRacecraftOpportunity(
  session: Session,
  context: RacecraftPlanningContext
): RacecraftOpportunity {
  const freeProgram = composeRacecraftFreeLongitudinalProgram(
    session,
    context.entry
  );
  if (context.sideCounterparts.length > 0 ||
      context.obligations.length > 0 ||
      context.committedAttacks.length > 0 ||
      context.ownershipViews.length > 0 ||
      context.fixedHazards.length > 0)
    return {
      classification: 'mandatory',
      reason: 'side-ownership-obligation-or-safety',
      leader: null,
      leaderPublication: null,
      freeProgram,
      constrainedProgram: null,
      binding: null,
      negativeSideCertificate: null,
      positiveSideCertificate: null
    };

  let selected: {
    leader: RacecraftActiveEntry;
    publication: RacecraftClaim;
    constrained: RacecraftLongitudinalProgram;
    binding: RacecraftLongitudinalBinding;
  } | null = null;
  for (const leader of context.forwardEntries) {
    const publication = context.publications.get(leader.code);
    if (!publication)
      return {
        classification: 'deliberate',
        reason: 'forward-publication-unavailable',
        leader,
        leaderPublication: null,
        freeProgram,
        constrainedProgram: null,
        binding: null,
        negativeSideCertificate: null,
        positiveSideCertificate: null
      };
    const constrained = composeRacecraftLeaderSafeProgram(
      session,
      context.entry,
      leader,
      publication,
      freeProgram
    );
    const binding = firstRacecraftLongitudinalBinding(
      freeProgram,
      constrained
    );
    if (!binding) continue;
    if (!selected ||
        binding.seconds < selected.binding.seconds - Number.EPSILON ||
        (Math.abs(binding.seconds - selected.binding.seconds) <=
            Number.EPSILON &&
          leader.code.localeCompare(selected.leader.code) < 0))
      selected = { leader, publication, constrained, binding };
  }

  if (!selected)
    return {
      classification: 'direct-ideal',
      reason: 'no-forward-publication-binds',
      leader: null,
      leaderPublication: null,
      freeProgram,
      constrainedProgram: null,
      binding: null,
      negativeSideCertificate: null,
      positiveSideCertificate: null
    };

  const negative = impossibilityCertificate(
    session,
    context,
    selected.publication,
    -1
  );
  const positive = impossibilityCertificate(
    session,
    context,
    selected.publication,
    1
  );
  const directFollow = negative != null && positive != null;
  return {
    classification: directFollow ? 'direct-follow' : 'deliberate',
    reason: directFollow
      ? 'both-sides-physically-impossible'
      : 'side-viable-or-uncertain',
    leader: selected.leader,
    leaderPublication: selected.publication,
    freeProgram,
    constrainedProgram: selected.constrained,
    binding: selected.binding,
    negativeSideCertificate: negative,
    positiveSideCertificate: positive
  };
}
