import { PHYS } from './physics';
import type { Car, CollisionImpact } from './model';
import { normAng } from '../shared/math';

// This is the suspension-damage boundary for both prediction and resolution.
// Lower-energy rubbing remains a physical outcome rather than a veto.
export const HARD_CONTACT_IMPULSE = 16;
export const CAR_COLLISION_AXLE_OFFSET_METRES = 1.35;
export const CAR_COLLISION_CONTACT_SLOP_METRES = 0.03;

export interface SweptCarContactInterval {
  enterFraction: number;
  leaveFraction: number;
  normalLongitudinal: number;
  normalLateral: number;
}

export interface SweptCarPosePair {
  timeSeconds: number;
  relativeLongitudinal: number;
  relativeLateral: number;
  /** Body orientation in the segment's longitudinal/lateral frame. */
  egoHeadingRadians: number;
  /** Body orientation in the segment's longitudinal/lateral frame. */
  rivalHeadingRadians: number;
}

export interface SweptCarContactEpisode {
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  initialRelativeNormalSpeed: number;
  maximumRelativeNormalSpeed: number;
  stationIndex: number;
}

export function contactSeverityFromRelativeNormalSpeed(
  relativeNormalSpeed: number
): number {
  return Number.isFinite(relativeNormalSpeed)
    ? Math.max(0, -relativeNormalSpeed)
    : 0;
}

export function isHardContactImpulse(impulse: number): boolean {
  return Number.isFinite(impulse) && impulse > HARD_CONTACT_IMPULSE;
}

/** Signed clearance between the same four-circle bodies used in production. */
export function carBodyCircleClearance(
  relativeLongitudinal: number,
  relativeLateral: number,
  egoYaw: number,
  rivalYaw: number,
  physicalMarginMetres = 0
): number {
  const egoForwardLongitudinal = Math.cos(egoYaw);
  const egoForwardLateral = Math.sin(egoYaw);
  const rivalForwardLongitudinal = Math.cos(rivalYaw);
  const rivalForwardLateral = Math.sin(rivalYaw);
  const contactRadius =
    2 * PHYS.colR2 - CAR_COLLISION_CONTACT_SLOP_METRES +
    Math.max(0, physicalMarginMetres);
  let clearance = Infinity;
  for (let egoIndex = 0; egoIndex < 2; egoIndex++) {
    const egoOffset = egoIndex === 0
      ? -CAR_COLLISION_AXLE_OFFSET_METRES
      : CAR_COLLISION_AXLE_OFFSET_METRES;
    for (let rivalIndex = 0; rivalIndex < 2; rivalIndex++) {
      const rivalOffset = rivalIndex === 0
        ? -CAR_COLLISION_AXLE_OFFSET_METRES
        : CAR_COLLISION_AXLE_OFFSET_METRES;
      const longitudinal =
        relativeLongitudinal +
        rivalForwardLongitudinal * rivalOffset -
        egoForwardLongitudinal * egoOffset;
      const lateral =
        relativeLateral +
        rivalForwardLateral * rivalOffset -
        egoForwardLateral * egoOffset;
      clearance = Math.min(
        clearance,
        Math.sqrt(
          longitudinal * longitudinal + lateral * lateral
        ) - contactRadius
      );
    }
  }
  return clearance;
}

/**
 * Minimum signed clearance over one fixed-orientation trajectory segment.
 * The returned fraction identifies where the closest circle pair binds.
 */
export function sweptCarMinimumClearance(
  fromLongitudinal: number,
  fromLateral: number,
  toLongitudinal: number,
  toLateral: number,
  egoYaw: number,
  rivalYaw: number,
  physicalMarginMetres = 0
): { clearanceMetres: number; fraction: number } {
  const egoForwardLongitudinal = Math.cos(egoYaw);
  const egoForwardLateral = Math.sin(egoYaw);
  const rivalForwardLongitudinal = Math.cos(rivalYaw);
  const rivalForwardLateral = Math.sin(rivalYaw);
  const deltaLongitudinal = toLongitudinal - fromLongitudinal;
  const deltaLateral = toLateral - fromLateral;
  const quadratic = deltaLongitudinal * deltaLongitudinal +
    deltaLateral * deltaLateral;
  const contactRadius =
    2 * PHYS.colR2 - CAR_COLLISION_CONTACT_SLOP_METRES +
    Math.max(0, physicalMarginMetres);
  let clearanceMetres = Infinity;
  let fraction = 0;
  for (let egoIndex = 0; egoIndex < 2; egoIndex++) {
    const egoOffset = egoIndex === 0
      ? -CAR_COLLISION_AXLE_OFFSET_METRES
      : CAR_COLLISION_AXLE_OFFSET_METRES;
    for (let rivalIndex = 0; rivalIndex < 2; rivalIndex++) {
      const rivalOffset = rivalIndex === 0
        ? -CAR_COLLISION_AXLE_OFFSET_METRES
        : CAR_COLLISION_AXLE_OFFSET_METRES;
      const originLongitudinal =
        fromLongitudinal +
        rivalForwardLongitudinal * rivalOffset -
        egoForwardLongitudinal * egoOffset;
      const originLateral =
        fromLateral +
        rivalForwardLateral * rivalOffset -
        egoForwardLateral * egoOffset;
      const closestFraction = quadratic <= Number.EPSILON
        ? 0
        : clampUnit(-(
            originLongitudinal * deltaLongitudinal +
            originLateral * deltaLateral
          ) / quadratic);
      const closestLongitudinal =
        originLongitudinal + deltaLongitudinal * closestFraction;
      const closestLateral =
        originLateral + deltaLateral * closestFraction;
      const candidateClearance =
        Math.sqrt(
          closestLongitudinal * closestLongitudinal +
          closestLateral * closestLateral
        ) - contactRadius;
      if (candidateClearance < clearanceMetres) {
        clearanceMetres = candidateClearance;
        fraction = closestFraction;
      }
    }
  }
  return { clearanceMetres, fraction };
}

/**
 * Continuous contact intervals for the same four-circle body geometry used
 * by collideCars. Orientations are fixed over the caller's trajectory segment.
 */
export function sweptCarContactIntervals(
  fromLongitudinal: number,
  fromLateral: number,
  toLongitudinal: number,
  toLateral: number,
  egoYaw: number,
  rivalYaw: number,
  physicalMarginMetres = 0
): SweptCarContactInterval[] {
  const egoForwardLongitudinal = Math.cos(egoYaw);
  const egoForwardLateral = Math.sin(egoYaw);
  const rivalForwardLongitudinal = Math.cos(rivalYaw);
  const rivalForwardLateral = Math.sin(rivalYaw);
  const deltaLongitudinal = toLongitudinal - fromLongitudinal;
  const deltaLateral = toLateral - fromLateral;
  const quadratic = deltaLongitudinal * deltaLongitudinal +
    deltaLateral * deltaLateral;
  const contactRadius =
    2 * PHYS.colR2 - CAR_COLLISION_CONTACT_SLOP_METRES +
    Math.max(0, physicalMarginMetres);
  const raw: SweptCarContactInterval[] = [];
  for (let egoIndex = 0; egoIndex < 2; egoIndex++) {
    const egoOffset = egoIndex === 0
      ? -CAR_COLLISION_AXLE_OFFSET_METRES
      : CAR_COLLISION_AXLE_OFFSET_METRES;
    for (let rivalIndex = 0; rivalIndex < 2; rivalIndex++) {
      const rivalOffset = rivalIndex === 0
        ? -CAR_COLLISION_AXLE_OFFSET_METRES
        : CAR_COLLISION_AXLE_OFFSET_METRES;
      const originLongitudinal =
        fromLongitudinal +
        rivalForwardLongitudinal * rivalOffset -
        egoForwardLongitudinal * egoOffset;
      const originLateral =
        fromLateral +
        rivalForwardLateral * rivalOffset -
        egoForwardLateral * egoOffset;
      const constant = originLongitudinal * originLongitudinal +
        originLateral * originLateral -
        contactRadius * contactRadius;
      let enter = 0;
      let leave = 1;
      if (quadratic <= Number.EPSILON) {
        if (constant >= 0) continue;
      } else {
        const linear = 2 * (
          originLongitudinal * deltaLongitudinal +
          originLateral * deltaLateral
        );
        const discriminant =
          linear * linear - 4 * quadratic * constant;
        if (discriminant <= 0) continue;
        const root = Math.sqrt(discriminant);
        enter = Math.max(0, (-linear - root) / (2 * quadratic));
        leave = Math.min(1, (-linear + root) / (2 * quadratic));
        if (enter >= leave || leave <= 0 || enter >= 1) continue;
      }
      const contactLongitudinal =
        originLongitudinal + deltaLongitudinal * enter;
      const contactLateral =
        originLateral + deltaLateral * enter;
      const magnitude = Math.max(
        Number.EPSILON,
        Math.sqrt(
          contactLongitudinal * contactLongitudinal +
          contactLateral * contactLateral
        )
      );
      raw.push({
        enterFraction: enter,
        leaveFraction: leave,
        normalLongitudinal: contactLongitudinal / magnitude,
        normalLateral: contactLateral / magnitude
      });
    }
  }
  raw.sort((left, right) =>
    left.enterFraction - right.enterFraction ||
    left.leaveFraction - right.leaveFraction);
  const merged: SweptCarContactInterval[] = [];
  for (const interval of raw) {
    const previous = merged.at(-1);
    if (!previous ||
        interval.enterFraction > previous.leaveFraction + Number.EPSILON) {
      merged.push({ ...interval });
      continue;
    }
    previous.leaveFraction = Math.max(
      previous.leaveFraction,
      interval.leaveFraction
    );
  }
  return merged;
}

function sweptCarCentresMayContact(
  fromLongitudinal: number,
  fromLateral: number,
  toLongitudinal: number,
  toLateral: number,
  physicalMarginMetres: number
): boolean {
  const deltaLongitudinal = toLongitudinal - fromLongitudinal;
  const deltaLateral = toLateral - fromLateral;
  const quadratic = deltaLongitudinal * deltaLongitudinal +
    deltaLateral * deltaLateral;
  const fraction = quadratic <= Number.EPSILON
    ? 0
    : clampUnit(-(
        fromLongitudinal * deltaLongitudinal +
        fromLateral * deltaLateral
      ) / quadratic);
  const closestLongitudinal =
    fromLongitudinal + deltaLongitudinal * fraction;
  const closestLateral = fromLateral + deltaLateral * fraction;
  const contactRadius =
    2 * CAR_COLLISION_AXLE_OFFSET_METRES +
    2 * PHYS.colR2 - CAR_COLLISION_CONTACT_SLOP_METRES +
    Math.max(0, physicalMarginMetres);
  return closestLongitudinal * closestLongitudinal +
    closestLateral * closestLateral <= contactRadius * contactRadius;
}

/**
 * Connected contact episodes over a point-trajectory sweep.
 *
 * A separation followed by re-contact starts a new episode because production
 * collision physics applies a new strike impulse. Overlapping circle-pair
 * intervals remain one body-contact episode and therefore one strike.
 */
export function sweptCarContactEpisodes(
  poses: readonly SweptCarPosePair[],
  physicalMarginMetres = 0
): SweptCarContactEpisode[] {
  const episodes: SweptCarContactEpisode[] = [];
  for (let index = 1; index < poses.length; index++) {
    const from = poses[index - 1]!;
    const to = poses[index]!;
    const dt = to.timeSeconds - from.timeSeconds;
    if (!Number.isFinite(dt) || dt <= 0)
      throw new RangeError('swept pose times must be finite and increasing');
    if (!sweptCarCentresMayContact(
      from.relativeLongitudinal,
      from.relativeLateral,
      to.relativeLongitudinal,
      to.relativeLateral,
      physicalMarginMetres
    )) continue;
    const midpointEgoHeading = normAng(
      from.egoHeadingRadians +
      normAng(to.egoHeadingRadians - from.egoHeadingRadians) / 2
    );
    const midpointRivalHeading = normAng(
      from.rivalHeadingRadians +
      normAng(to.rivalHeadingRadians - from.rivalHeadingRadians) / 2
    );
    const intervals = sweptCarContactIntervals(
      from.relativeLongitudinal,
      from.relativeLateral,
      to.relativeLongitudinal,
      to.relativeLateral,
      midpointEgoHeading,
      midpointRivalHeading,
      physicalMarginMetres
    );
    const relativeLongitudinalSpeed =
      (to.relativeLongitudinal - from.relativeLongitudinal) / dt;
    const relativeLateralSpeed =
      (to.relativeLateral - from.relativeLateral) / dt;
    for (const interval of intervals) {
      const relativeNormalSpeed = contactSeverityFromRelativeNormalSpeed(
        relativeLongitudinalSpeed * interval.normalLongitudinal +
        relativeLateralSpeed * interval.normalLateral
      );
      const intervalStart = from.timeSeconds +
        dt * interval.enterFraction;
      const intervalEnd = from.timeSeconds +
        dt * interval.leaveFraction;
      const active = episodes.at(-1);
      if (active &&
          intervalStart <= active.endTimeSeconds + Number.EPSILON) {
        const uncoveredStart = Math.max(
          intervalStart,
          active.endTimeSeconds
        );
        if (intervalEnd > uncoveredStart)
          active.durationSeconds += intervalEnd - uncoveredStart;
        active.endTimeSeconds = Math.max(
          active.endTimeSeconds,
          intervalEnd
        );
        active.maximumRelativeNormalSpeed = Math.max(
          active.maximumRelativeNormalSpeed,
          relativeNormalSpeed
        );
        continue;
      }
      // Production resolves geometric overlap but applies no impulse or
      // velocity damping until the bodies are closing.
      if (relativeNormalSpeed <= Number.EPSILON) continue;
      episodes.push({
        startTimeSeconds: intervalStart,
        endTimeSeconds: intervalEnd,
        durationSeconds: Math.max(0, intervalEnd - intervalStart),
        initialRelativeNormalSpeed: relativeNormalSpeed,
        maximumRelativeNormalSpeed: relativeNormalSpeed,
        stationIndex: index - 1
      });
    }
  }
  return episodes;
}

export function collideCars(list: readonly (Car | null | undefined)[], R?: number): CollisionImpact[] {
  const cr = R || PHYS.colR2;
  const half = CAR_COLLISION_AXLE_OFFSET_METRES;
  const contactSlop = CAR_COLLISION_CONTACT_SLOP_METRES;
  const coarse = 2 * (half + cr), coarse2 = coarse * coarse;
  const out: CollisionImpact[] = [];
  for (let a = 0; a < list.length; a++){
    const A = list[a];
    if (!A) continue;
    for (let b = a + 1; b < list.length; b++){
      const B = list[b];
      if (!B) continue;
      const dx0 = B.x - A.x, dy0 = B.y - A.y;
      if (dx0 * dx0 + dy0 * dy0 > coarse2) continue;
      const ca = Math.cos(A.h), sa = Math.sin(A.h);
      const cb = Math.cos(B.h), sb = Math.sin(B.h);
      let bestPen = 0, nx = 0, ny = 0;
      for (const qa of [-half, half]){
        const ax = A.x + ca * qa, ay = A.y + sa * qa;
        for (const qb of [-half, half]){
          const bx = B.x + cb * qb, by = B.y + sb * qb;
          const dx = bx - ax, dy = by - ay, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * cr * cr) continue;
          const d = Math.sqrt(Math.max(d2, 1e-12));
          const pen = 2 * cr - d;
          if (pen > bestPen){
            bestPen = pen;
            if (d2 < 1e-12){
              const dl = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1;
              nx = dx0 / dl; ny = dy0 / dl;
            } else { nx = dx / d; ny = dy / d; }
          }
        }
      }
      if (bestPen <= contactSlop) continue;
      // Clear only numerical overlap. Racing policy, not collision physics,
      // owns any additional separation between two stable cars.
      const pen = (bestPen + contactSlop) / 2;
      A.x -= nx * pen; A.y -= ny * pen;
      B.x += nx * pen; B.y += ny * pen;
      // world velocities
      let awx = A.vx * ca - A.vy * sa, awy = A.vx * sa + A.vy * ca;
      let bwx = B.vx * cb - B.vy * sb, bwy = B.vx * sb + B.vy * cb;
      const rvx = bwx - awx, rvy = bwy - awy;
      const rel = rvx * nx + rvy * ny;
      const severity = contactSeverityFromRelativeNormalSpeed(rel);
      if (severity > 0){
        const e = 0.2, jimp = -(1 + e) * rel / 2;
        awx -= jimp * nx; awy -= jimp * ny;
        bwx += jimp * nx; bwy += jimp * ny;
        const relativeSpeed = Math.sqrt(rvx * rvx + rvy * rvy);
        const damp = 1 -
          0.015 * (Math.abs(rel) / (relativeSpeed + 1e-6));
        awx *= damp; awy *= damp; bwx *= damp; bwy *= damp;
        A.vx = awx * ca + awy * sa; A.vy = -awx * sa + awy * ca;
        B.vx = bwx * cb + bwy * sb; B.vy = -bwx * sb + bwy * cb;
        out.push({ i: a, j: b, imp: severity });
      }
    }
  }
  return out;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}
