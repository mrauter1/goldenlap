import {
  sampleCornerLineEtaAnalytic,
  type CornerLineEtaSample
} from '../../core/corner-lines';
import type {
  Car,
  Corner,
  CornerLineKind,
  CornerLineTerminal,
  Track
} from '../../core/model';
import { compactLateralGeometryAtProgress } from
  '../../core/lateral-program';
import {
  availableDeceleration,
  cornerSpeedForGrip,
  PHYS
} from '../../core/physics';
import {
  emergencyLateralEnvelope,
  normalLateralEnvelope,
  normalLateralIsLegal
} from '../../core/surface';
import { clamp, normAng } from '../../shared/math';
import type {
  Entry,
  LanePoint,
  RacecraftSideAgreementFamilyCertificate,
  Session,
  SurfaceAuthorization
} from '../model';
import { entryDownforceScale, entryMu } from '../strategy';
import {
  sampleHermiteSegment,
  sampleSmootherstepSegment
} from './interpolation';

type ActiveEntry = Entry & { car: Car };

export interface LateralBounds {
  minimum: number;
  maximum: number;
  lowerSeparators?: Array<{
    eta: number;
    centreClearance: number;
  }>;
  upperSeparators?: Array<{
    eta: number;
    centreClearance: number;
  }>;
  viable?: boolean;
}

export interface LaneEvaluation {
  eta: number;
  firstDerivative: number;
  secondDerivative: number;
}

export interface LongitudinalBodyProjection {
  signedDistance: number;
  firstHalfExtent: number;
  secondHalfExtent: number;
  clearance: number;
  overlap: boolean;
}

export function signedTrackDistance(
  track: Track,
  from: number,
  to: number
): number {
  let distance = (to - from + track.len) % track.len;
  if (distance > track.len / 2) distance -= track.len;
  return distance;
}

export function idxAheadM(track: Track, from: number, to: number): number {
  return ((to - from + track.n) % track.n) * track.step;
}

export function roomPairKey(first: Entry, second: Entry): string {
  return first.code < second.code
    ? `${first.code}|${second.code}`
    : `${second.code}|${first.code}`;
}

export function racecraftPairKey(firstCode: string, secondCode: string): string {
  return firstCode < secondCode
    ? `${firstCode}:${secondCode}`
    : `${secondCode}:${firstCode}`;
}

type AgreementFamilyKind =
  | 'ideal'
  | `${CornerLineKind}:${CornerLineTerminal}`;

interface AgreementFamilyContext {
  contextKey: string;
  originS: number;
  spanMetres: number;
  index: number;
  corners: readonly Corner[];
}

interface AgreementFamilyExtent {
  kind: AgreementFamilyKind;
  minimumEta: number;
  maximumEta: number;
}

export interface SideAgreementFamilyCertification {
  contextKey: string;
  separatorEta: number | null;
  familyCertificate: RacecraftSideAgreementFamilyCertificate | null;
}

const AGREEMENT_FAMILY_KINDS = [
  'ideal',
  'inside:ideal-rejoin',
  'inside:sustained-offset',
  'outside:ideal-rejoin',
  'outside:sustained-offset'
] as const satisfies readonly AgreementFamilyKind[];

function cornerFamilyLine(
  corner: Corner,
  kind: AgreementFamilyKind
) {
  if (kind === 'ideal' || !corner.alternateLines) return null;
  const [side, terminal] = kind.split(':') as [
    CornerLineKind,
    CornerLineTerminal
  ];
  return corner.alternateLines[side][
    terminal === 'ideal-rejoin' ? 'idealRejoin' : 'sustainedOffset'
  ];
}

function cyclicIndex(track: Track, index: number): number {
  return ((Math.round(index) % track.n) + track.n) % track.n;
}

function forwardSampleCount(track: Track, from: number, to: number): number {
  return (cyclicIndex(track, to) - cyclicIndex(track, from) + track.n) %
    track.n;
}

function forwardDistance(track: Track, from: number, to: number): number {
  return ((to - from) % track.len + track.len) % track.len;
}

function indexInWindow(
  track: Track,
  index: number,
  start: number,
  end: number
): boolean {
  return forwardSampleCount(track, start, index) <=
    forwardSampleCount(track, start, end);
}

function pairMidpoint(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry
): { s: number; index: number } {
  const separation = signedTrackDistance(track, first.car.s, second.car.s);
  const s = ((first.car.s + separation / 2) % track.len + track.len) %
    track.len;
  return {
    s,
    index: cyclicIndex(track, s / track.step)
  };
}

function agreementFamilyContext(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry,
  straightSpanMetres: number
): AgreementFamilyContext {
  const midpoint = pairMidpoint(track, first, second);
  const activeCorner = track.corners?.find(corner =>
    !!corner.alternateLines &&
    indexInWindow(
      track,
      midpoint.index,
      corner.approachI,
      corner.exitI
    )
  );
  if (!activeCorner) {
    return {
      contextKey: 'straight',
      originS: midpoint.s,
      spanMetres: straightSpanMetres,
      index: midpoint.index,
      corners: []
    };
  }
  const corners = activeCorner.complexId
    ? (track.corners ?? []).filter(corner =>
        corner.complexId === activeCorner.complexId &&
        !!corner.alternateLines &&
        forwardSampleCount(
          track,
          midpoint.index,
          corner.exitI
        ) <= track.n / 2
      )
    : [activeCorner];
  corners.sort((firstCorner, secondCorner) =>
    forwardSampleCount(
      track,
      midpoint.index,
      firstCorner.regionStartI
    ) -
    forwardSampleCount(
      track,
      midpoint.index,
      secondCorner.regionStartI
    )
  );
  const spanSamples = corners.reduce(
    (maximum, corner) => Math.max(
      maximum,
      forwardSampleCount(track, midpoint.index, corner.exitI)
    ),
    0
  );
  return {
    contextKey: `corner:${activeCorner.complexId ?? activeCorner.id}:` +
      corners.map(corner => corner.id).join(','),
    originS: midpoint.s,
    spanMetres: spanSamples * track.step,
    index: midpoint.index,
    corners
  };
}

function cornerFamilyRange(
  track: Track,
  contextIndex: number,
  corner: Corner
): { start: number; count: number } {
  const start = indexInWindow(
    track,
    contextIndex,
    corner.approachI,
    corner.exitI
  )
    ? contextIndex
    : corner.approachI;
  return {
    start,
    count: forwardSampleCount(track, start, corner.exitI)
  };
}

function familySpeedLawIsFinite(
  session: Session,
  entry: ActiveEntry,
  index: number,
  evaluation: CornerLineEtaSample
): boolean {
  const track = session.trk;
  const ideal = track.idealPath;
  if (!ideal) return false;
  const previous = (index - 1 + track.n) % track.n;
  const next = (index + 1) % track.n;
  const baseCurvature = track.kSm[index]!;
  const baseCurvatureDerivative =
    (track.kSm[next]! - track.kSm[previous]!) / (2 * track.step);
  const idealSlope =
    (ideal.off[next]! - ideal.off[previous]!) / (2 * track.step);
  const idealSecond =
    (ideal.off[next]! - 2 * ideal.off[index]! + ideal.off[previous]!) /
      (track.step * track.step);
  const totalOffset = ideal.off[index]! + evaluation.eta;
  const lateralSlope = idealSlope + evaluation.firstDerivative;
  const lateralSecond = idealSecond + evaluation.secondDerivative;
  const longitudinalScale = 1 - baseCurvature * totalOffset;
  const q = Math.sqrt(
    longitudinalScale * longitudinalScale +
    lateralSlope * lateralSlope
  );
  if (!Number.isFinite(q) || q <= Number.EPSILON) return false;
  const numerator = longitudinalScale * lateralSecond +
    baseCurvature * longitudinalScale * longitudinalScale +
    baseCurvatureDerivative * totalOffset * lateralSlope +
    2 * baseCurvature * lateralSlope * lateralSlope;
  const curvature = numerator / (q * q * q);
  const speed = Math.min(
    ideal.v[index]!,
    cornerSpeedForGrip(
      curvature,
      entryMu(entry, session.wet),
      entryDownforceScale(entry)
    )
  );
  return Number.isFinite(curvature) &&
    Number.isFinite(speed) &&
    speed > 0;
}

function cornerFamilyExtent(
  session: Session,
  entry: ActiveEntry,
  corner: Corner,
  kind: AgreementFamilyKind,
  start: number,
  count: number
): AgreementFamilyExtent | null {
  const track = session.trk;
  const ideal = track.idealPath;
  if (!ideal || !corner.alternateLines) return null;
  const line = cornerFamilyLine(corner, kind);
  if (line && (
    !Number.isFinite(line.apexSpeed) ||
    line.apexSpeed <= 0 ||
    !Number.isFinite(line.cornerTimeSeconds) ||
    line.cornerTimeSeconds <= 0 ||
    !Number.isFinite(line.lapTimeLossSeconds)
  )) return null;
  let minimumEta = Infinity;
  let maximumEta = -Infinity;
  for (let delta = 0; delta <= count; delta++) {
    const index = (start + delta) % track.n;
    const evaluation = line
      ? sampleCornerLineEtaAnalytic(track, corner, line, index)
      : { eta: 0, firstDerivative: 0, secondDerivative: 0 };
    const lateral = ideal.off[index]! + evaluation.eta;
    if (!Number.isFinite(evaluation.eta) ||
        !Number.isFinite(evaluation.firstDerivative) ||
        !Number.isFinite(evaluation.secondDerivative) ||
        !normalLateralIsLegal(track, index, lateral) ||
        !familySpeedLawIsFinite(session, entry, index, evaluation))
      return null;
    minimumEta = Math.min(minimumEta, evaluation.eta);
    maximumEta = Math.max(maximumEta, evaluation.eta);
  }
  return { kind, minimumEta, maximumEta };
}

function bestCornerFamily(
  session: Session,
  entry: ActiveEntry,
  corner: Corner,
  start: number,
  count: number,
  side: 'lower' | 'upper'
): AgreementFamilyExtent | null {
  let best: AgreementFamilyExtent | null = null;
  for (const kind of AGREEMENT_FAMILY_KINDS) {
    const extent = cornerFamilyExtent(
      session,
      entry,
      corner,
      kind,
      start,
      count
    );
    if (!extent) continue;
    if (!best ||
        (side === 'lower'
          ? extent.maximumEta < best.maximumEta
          : extent.minimumEta > best.minimumEta))
      best = extent;
  }
  return best;
}

function constrainSeparatorToSurface(
  track: Track,
  start: number,
  count: number,
  halfClearance: number,
  bounds: { minimum: number; maximum: number }
): void {
  for (let delta = 0; delta <= count; delta++) {
    const index = (start + delta) % track.n;
    const ideal = track.idealPath!.off[index]!;
    bounds.minimum = Math.max(
      bounds.minimum,
      track.surface.normalMinimum[index]! - ideal + halfClearance
    );
    bounds.maximum = Math.min(
      bounds.maximum,
      track.surface.normalMaximum[index]! - ideal - halfClearance
    );
  }
}

function certifyStraightAgreementFamily(
  session: Session,
  lower: ActiveEntry,
  upper: ActiveEntry,
  context: AgreementFamilyContext,
  halfClearance: number,
  bounds: { minimum: number; maximum: number }
): { lowerFamilyKey: string; upperFamilyKey: string } | null {
  const track = session.trk;
  const count = Math.max(
    1,
    Math.ceil(context.spanMetres / track.step)
  );
  let lowerEta = -Infinity;
  let upperEta = Infinity;
  for (let delta = 0; delta <= count; delta++) {
    const index = (context.index + delta) % track.n;
    const ideal = track.idealPath!.off[index]!;
    lowerEta = Math.max(
      lowerEta,
      track.surface.normalMinimum[index]! - ideal
    );
    upperEta = Math.min(
      upperEta,
      track.surface.normalMaximum[index]! - ideal
    );
  }
  for (let delta = 0; delta <= count; delta++) {
    const index = (context.index + delta) % track.n;
    const lowerEvaluation = {
      eta: lowerEta,
      firstDerivative: 0,
      secondDerivative: 0
    };
    const upperEvaluation = {
      eta: upperEta,
      firstDerivative: 0,
      secondDerivative: 0
    };
    if (!familySpeedLawIsFinite(
      session,
      lower,
      index,
      lowerEvaluation
    ) || !familySpeedLawIsFinite(
      session,
      upper,
      index,
      upperEvaluation
    )) return null;
  }
  constrainSeparatorToSurface(
    track,
    context.index,
    count,
    halfClearance,
    bounds
  );
  bounds.minimum = Math.max(bounds.minimum, lowerEta + halfClearance);
  bounds.maximum = Math.min(bounds.maximum, upperEta - halfClearance);
  return {
    lowerFamilyKey: 'straight:normal-minimum',
    upperFamilyKey: 'straight:normal-maximum'
  };
}

/**
 * Certify a scalar separator against complete, already-authored families.
 * Because every family is affine in λ from the common ideal member, the
 * endpoint with the smallest maximum (lower car) or largest minimum (upper
 * car) is the complete feasibility result; no online arc search is needed.
 */
export function certifySideAgreementFamily(
  session: Session,
  lower: ActiveEntry,
  upper: ActiveEntry,
  centreClearance: number,
  preferredSeparatorEta: number,
  straightSpanMetres: number
): SideAgreementFamilyCertification {
  const track = session.trk;
  const context = agreementFamilyContext(
    track,
    lower,
    upper,
    straightSpanMetres
  );
  const failed = (): SideAgreementFamilyCertification => ({
    contextKey: context.contextKey,
    separatorEta: null,
    familyCertificate: null
  });
  if (!track.idealPath ||
      !Number.isFinite(centreClearance) ||
      centreClearance <= 0 ||
      !Number.isFinite(preferredSeparatorEta))
    return failed();
  const halfClearance = centreClearance / 2;
  const bounds = { minimum: -Infinity, maximum: Infinity };
  const lowerKeys: string[] = [];
  const upperKeys: string[] = [];
  if (!context.corners.length) {
    const straight = certifyStraightAgreementFamily(
      session,
      lower,
      upper,
      context,
      halfClearance,
      bounds
    );
    if (!straight) return failed();
    lowerKeys.push(straight.lowerFamilyKey);
    upperKeys.push(straight.upperFamilyKey);
  } else {
    for (const corner of context.corners) {
      const range = cornerFamilyRange(track, context.index, corner);
      constrainSeparatorToSurface(
        track,
        range.start,
        range.count,
        halfClearance,
        bounds
      );
      const lowerFamily = bestCornerFamily(
        session,
        lower,
        corner,
        range.start,
        range.count,
        'lower'
      );
      const upperFamily = bestCornerFamily(
        session,
        upper,
        corner,
        range.start,
        range.count,
        'upper'
      );
      if (!lowerFamily || !upperFamily) return failed();
      bounds.minimum = Math.max(
        bounds.minimum,
        lowerFamily.maximumEta + halfClearance
      );
      bounds.maximum = Math.min(
        bounds.maximum,
        upperFamily.minimumEta - halfClearance
      );
      lowerKeys.push(`${corner.id}:${lowerFamily.kind}`);
      upperKeys.push(`${corner.id}:${upperFamily.kind}`);
    }
  }
  if (!Number.isFinite(bounds.minimum) ||
      !Number.isFinite(bounds.maximum) ||
      bounds.minimum > bounds.maximum)
    return failed();
  const separatorEta = clamp(
    preferredSeparatorEta,
    bounds.minimum,
    bounds.maximum
  );
  return {
    contextKey: context.contextKey,
    separatorEta,
    familyCertificate: {
      contextKey: context.contextKey,
      originS: context.originS,
      spanMetres: context.spanMetres,
      lowerFamilyKey: lowerKeys.join('+'),
      upperFamilyKey: upperKeys.join('+')
    }
  };
}

export function sideAgreementFamilyCertificateIsCurrent(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry,
  certificate: RacecraftSideAgreementFamilyCertificate
): boolean {
  const context = agreementFamilyContext(track, first, second, 0);
  if (context.contextKey !== certificate.contextKey) return false;
  return forwardDistance(
    track,
    certificate.originS,
    context.originS
  ) <= certificate.spanMetres + Number.EPSILON;
}

export function sideAgreementFamilyContextKey(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry
): string {
  return agreementFamilyContext(track, first, second, 0).contextKey;
}

export interface CertifiedCornerFamilyMember {
  kind: CornerLineKind;
  terminal: CornerLineTerminal;
}

/** Exact offline member whose existence certified this car's corner corridor. */
export function sideAgreementCornerFamilyMember(
  session: Session,
  entry: Entry,
  corner: Corner
): CertifiedCornerFamilyMember | null {
  let selected: CertifiedCornerFamilyMember | null = null;
  for (const [key, agreement] of session.sideAgreements ?? []) {
    const separator = key.indexOf(':');
    const first = key.slice(0, separator);
    const second = key.slice(separator + 1);
    if (entry.code !== first && entry.code !== second) continue;
    const lower = agreement.side < 0 ? first : second;
    const authority = entry.code === lower
      ? agreement.familyCertificate.lowerFamilyKey
      : agreement.familyCertificate.upperFamilyKey;
    const prefix = `${corner.id}:`;
    const encoded = authority.split('+').find(value => value.startsWith(prefix));
    if (!encoded) continue;
    const [kind, terminal] = encoded.slice(prefix.length).split(':');
    if ((kind !== 'inside' && kind !== 'outside') ||
        (terminal !== 'ideal-rejoin' && terminal !== 'sustained-offset'))
      continue;
    const member = { kind, terminal } satisfies CertifiedCornerFamilyMember;
    if (selected &&
        (selected.kind !== member.kind || selected.terminal !== member.terminal))
      return null;
    selected = member;
  }
  return selected;
}

/**
 * A live agreement preserves the lateral order established at body overlap.
 * These bounds carry no pre-overlap right and disappear at bumper clearance.
 */
export function sideAgreementBounds(
  session: Session,
  entry: Entry
): LateralBounds | null {
  const agreements = session.sideAgreements;
  if (!agreements?.size) return null;
  const lowerSeparators: NonNullable<LateralBounds['lowerSeparators']> = [];
  const upperSeparators: NonNullable<LateralBounds['upperSeparators']> = [];
  for (const [key, agreement] of agreements) {
    const separator = key.indexOf(':');
    const first = key.slice(0, separator);
    const second = key.slice(separator + 1);
    if (entry.code !== first && entry.code !== second) continue;
    const lower = agreement.side < 0 ? first : second;
    const upper = lower === first ? second : first;
    const constraint = {
      eta: agreement.separatorEta,
      centreClearance: agreement.centreClearance
    };
    if (entry.code === lower) upperSeparators.push(constraint);
    if (entry.code === upper) lowerSeparators.push(constraint);
  }
  if (!lowerSeparators.length && !upperSeparators.length) return null;
  return {
    minimum: -Infinity,
    maximum: Infinity,
    lowerSeparators,
    upperSeparators,
    viable: true
  };
}

/**
 * Side order is a bias, not extra drivable surface. If the road moves wholly
 * past the agreed half-plane, the agreement widens to the road: collapsing to
 * one edge would preserve a width verdict while deleting every drivable arc.
 */
export function sideAgreementEnvelopeAt(
  track: Track,
  index: number,
  agreement: LateralBounds | null,
  surfaceAuthorization: SurfaceAuthorization = 'normal'
): LateralBounds {
  const surface = surfaceAuthorization === 'emergency'
    ? emergencyLateralEnvelope(track, index)
    : normalLateralEnvelope(track, index);
  if (!agreement)
    return { ...surface, viable: true };
  const ideal = track.idealPath?.off[
    ((Math.round(index) % track.n) + track.n) % track.n
  ] ?? 0;
  let minimum = surface.minimum;
  let maximum = surface.maximum;
  for (const constraint of agreement.lowerSeparators ?? []) {
    const half = constraint.centreClearance / 2;
    const separator = clamp(
      ideal + constraint.eta,
      surface.minimum + half,
      surface.maximum - half
    );
    minimum = Math.max(minimum, separator + half);
  }
  for (const constraint of agreement.upperSeparators ?? []) {
    const half = constraint.centreClearance / 2;
    const separator = clamp(
      ideal + constraint.eta,
      surface.minimum + half,
      surface.maximum - half
    );
    maximum = Math.min(maximum, separator - half);
  }
  if (minimum <= maximum)
    return { minimum, maximum, viable: true };
  const centre = clamp((minimum + maximum) / 2,
    surface.minimum, surface.maximum);
  return {
    minimum: centre,
    maximum: centre,
    viable: false
  };
}

export function hasSideAgreement(session: Session, code: string): boolean {
  for (const key of session.sideAgreements?.keys() ?? []) {
    const separator = key.indexOf(':');
    if (key.slice(0, separator) === code ||
        key.slice(separator + 1) === code) return true;
  }
  return false;
}

function projectedHalfExtent(track: Track, entry: ActiveEntry): number {
  const index = Math.max(0, entry.car.progIdx) % track.n;
  const roadHeading = entry._trafficRoadHeading ??
    Math.atan2(track.ty[index]!, track.tx[index]!);
  const yaw = normAng(entry.car.h - roadHeading);
  return Math.abs(Math.cos(yaw)) * PHYS.carLen / 2 +
    Math.abs(Math.sin(yaw)) * PHYS.carWid / 2;
}

export function longitudinalBodyProjection(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry
): LongitudinalBodyProjection {
  const signedDistance = signedTrackDistance(track, first.car.s, second.car.s);
  const firstHalfExtent = projectedHalfExtent(track, first);
  const secondHalfExtent = projectedHalfExtent(track, second);
  const clearance = Math.abs(signedDistance) -
    firstHalfExtent - secondHalfExtent;
  return {
    signedDistance,
    firstHalfExtent,
    secondHalfExtent,
    clearance,
    overlap: clearance < 0
  };
}

/** Shared racecraft definition: the projected longitudinal bodies overlap. */
export function alongside(
  track: Track,
  first: ActiveEntry,
  second: ActiveEntry
): boolean {
  return longitudinalBodyProjection(track, first, second).overlap;
}

function lanePointSlope(
  points: readonly LanePoint[],
  index: number
): number {
  const current = points[index];
  if (!current) return 0;
  if (points.length < 2) return 0;
  if (index <= 0) {
    const next = points[1]!;
    return (next.eta - current.eta) / Math.max(Number.EPSILON, next.s - current.s);
  }
  if (index >= points.length - 1) {
    const previous = points[index - 1]!;
    return (current.eta - previous.eta) /
      Math.max(Number.EPSILON, current.s - previous.s);
  }
  const previous = points[index - 1]!;
  const next = points[index + 1]!;
  return (next.eta - previous.eta) / Math.max(Number.EPSILON, next.s - previous.s);
}

export function evaluateLaneEta(
  points: readonly LanePoint[],
  progress: number
): LaneEvaluation {
  const first = points[0];
  if (!first) return { eta: 0, firstDerivative: 0, secondDerivative: 0 };
  if (progress <= first.s) return { eta: first.eta, firstDerivative: 0, secondDerivative: 0 };
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index]!;
    const to = points[index + 1]!;
    if (progress > to.s) continue;
    const span = to.s - from.s;
    const u = (progress - from.s) / span;
    const sample = points.length === 2
      ? sampleSmootherstepSegment(from.eta, to.eta, span, u)
      : sampleHermiteSegment(
          from.eta,
          to.eta,
          lanePointSlope(points, index),
          lanePointSlope(points, index + 1),
          span,
          u
        );
    return {
      eta: sample.value,
      firstDerivative: sample.firstDerivative,
      secondDerivative: sample.secondDerivative
    };
  }
  return {
    eta: points[points.length - 1]!.eta,
    firstDerivative: 0,
    secondDerivative: 0
  };
}

// For q(u)=6u^5-15u^4+10u^3, max(abs(q''))=10/sqrt(3).
const SMOOTHERSTEP_PEAK_ACCELERATION = 10 / Math.sqrt(3);

/** Time taken by the bounded lateral law used to author every lane edit. */
export function physicalLateralMoveSeconds(
  speed: number,
  lateralError: number,
  accelerationHeadroom: number
): number {
  const distance = Math.abs(lateralError);
  if (distance <= 1e-9) return 0;
  const steering = PHYS.steerMax / (1 + Math.max(0, speed) / PHYS.steerFade);
  const steeringAcceleration = speed * speed *
    Math.abs(Math.tan(steering)) / PHYS.L;
  const acceleration = Math.min(
    Math.max(0, accelerationHeadroom),
    steeringAcceleration
  );
  if (acceleration <= 1e-9) return Infinity;
  return Math.sqrt(SMOOTHERSTEP_PEAK_ACCELERATION * distance / acceleration);
}

function lateralAccelerationHeadroom(
  session: Session,
  entry: Entry,
  includeCurrentBraking: boolean
): number {
  const track = session.trk;
  const index = Math.max(0, entry.car?.progIdx ?? 0) % track.n;
  const grip = availableDeceleration(
    entry.spd,
    entryMu(entry, session.wet),
    entryDownforceScale(entry)
  );
  const curvature = entry.pathPlan?.mode === 'pit' && entry.path
    ? entry.path.k[index]!
    : entry.racecraftLateralProgram
      ? compactLateralGeometryAtProgress(
          track,
          entry.racecraftLateralProgram,
          entry.prog
        ).curvature
      : (entry.path ?? track.idealPath)?.k[index] ?? track.kSm[index]!;
  const lateral = entry.spd * entry.spd * Math.abs(curvature);
  const longitudinal = includeCurrentBraking
    ? clamp(entry.inp.brake, 0, 1) * Math.min(
        grip,
        PHYS.brakeForce * PHYS.circK / PHYS.m
      )
    : 0;
  return Math.sqrt(Math.max(
    0,
    grip * grip - lateral * lateral - longitudinal * longitudinal
  ));
}

/** Physical duration for the current car to reach one absolute lateral target. */
export function physicalLaneMoveSeconds(
  session: Session,
  entry: Entry,
  lateral: number
): number {
  return physicalLateralMoveSeconds(
    entry.spd,
    lateral - entry.latNow,
    lateralAccelerationHeadroom(session, entry, true)
  );
}

/** Physical swerve response when lateral grip is chosen instead of braking. */
export function physicalLaneEscapeSeconds(
  session: Session,
  entry: Entry,
  lateral: number
): number {
  return physicalLateralMoveSeconds(
    entry.spd,
    lateral - entry.latNow,
    lateralAccelerationHeadroom(session, entry, false)
  );
}
