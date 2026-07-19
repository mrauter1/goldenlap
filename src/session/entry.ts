import { botStep } from '../core/autopilot';
import { PHYS } from '../core/physics';
import { makeLap, raceTick } from '../core/lap';
import { makeCar, stepCar, trackSense } from '../core/physics-engine';
import { normalLateralIsLegal, surfaceExposureAtLateral } from '../core/surface';
import { clamp } from '../shared/math';
import { random } from '../shared/rng';
import { rollMistake, stepRecovery } from './incidents';
import { initializeLineCharacter } from './racecraft/feel';
import { obligationsFor } from './racecraft/relations';
import {
  clearLaneProgram,
  editLaneEtaTarget,
  evaluateLaneProgram
} from './racecraft/lane-program';
import {
  notePitProgress, planPitMotion, releasePitReservation, requestPitBoxRelease, servePit
} from './pit';
import { emitHudDirty, emitSessionEvent, emitToast } from './events';
import {
  entryDynamicMu, entryMargin, entryMods, flowOff,
  PACE_FUEL, PACE_WEAR, REF_LAPS, rollFocus, tyreLifeLaps
} from './strategy';
import type {
  Entry, EntryModifiers, LineupEntry, Session, TyreCompound
} from './model';

export interface CreateEntryOptions {
  lineup: LineupEntry;
  teamIndex: number;
  modifiers: EntryModifiers;
}

export function createEntry(options: CreateEntryOptions): Entry {
  const lineup = options.lineup;
  return {
    lu: lineup,
    name: lineup.name,
    code: lineup.code,
    isPlayer: lineup.isPlayer,
    ci: lineup.ci,
    ti: options.teamIndex,
    mods: options.modifiers,
    style: {
      body: lineup.team.body,
      accent: lineup.team.accent,
      wing: '#221F2B',
      helmet: lineup.isPlayer ? '#E9B44C' : '#B9AFA0'
    },
    car: null,
    tyre: { c: 'S', wear: 0, fit: 0 },
    fuel: 1,
    stress: 0,
    pace: 1,
    rel: { e: 1, h: 1, c: 1 },
    wearAcc: { e: 0, h: 0, c: 0 },
    hFail: false,
    cFail: false,
    cross: 0,
    prog: 0,
    spd: 0,
    latNow: 0,
    lineT: -1,
    lastLap: 0,
    best: Infinity,
    state: 'none',
    pitArm: null,
    boxArm: false,
    pitT: 0,
    pitW: null,
    stops: 0,
    lat: 0,
    gridLat: 0,
    trafficSlowPoint: null,
    racecraftLongitudinalProgram: null,
    liftT: 0,
    tow: 0,
    dirtyT: 0,
    pressureT: 0,
    underPressure: false,
    brakingEffort: 0.82,
    brakingPrudenceOffset: 0,
    recT: 0,
    avoidT: 0,
    _avoidWith: '',
    _avoidSide: 0,
    _alongsideWith: '',
    mistT: 0.6 + random() * 1.4,
    battle: false,
    _battleLapSeconds: 0,
    _recentCleanLap: 0,
    focusNow: 0.6,
    flow: null,
    lineBiasByCorner: null,
    lapLive: false,
    hotLeft: 0,
    plan: null,
    synth: false,
    rlap: makeLap(),
    notes: [],
    finPos: 0,
    finT: 0,
    finLaps: 0,
    gridP: 0,
    inp: { steer: 0, throttle: 0, brake: 0, hand: false },
    botTick: 0,
    laneProgram: { points: [], reason: 'ideal', binding: null, bias: 0 }
  };
}

export function spawnOnTrack(
  entry: Entry,
  session: Session,
  backMeters: number,
  lateralOffset: number,
  initialSpeed: number
): void {
  const track = session.trk;
  const index = (track.n - Math.max(2, Math.round(backMeters / track.step))) % track.n;
  entry.car = makeCar(
    track.x[index]! + track.nx[index]! * (lateralOffset || 0),
    track.y[index]! + track.ny[index]! * (lateralOffset || 0),
    Math.atan2(track.ty[index]!, track.tx[index]!)
  );
  entry.car.vx = initialSpeed || 0;
  entry.car.progIdx = index;
  entry.car.s = (index * track.step) % track.len;
  entry.rlap = makeLap();
  entry.pitW = null;
  delete entry.pitPhase;
  entry.pitQueueW = null;
  entry.pitQueueOff = null;
  entry.pitWaitReason = null;
  entry.pitWaitOwner = null;
  entry.trafficSlowPoint = null;
  entry.racecraftLongitudinalProgram = null;
  entry.lat = lateralOffset || 0;
  entry.latNow = lateralOffset || 0;
  clearLaneProgram(entry, 'spawn');
  initializeLineCharacter(entry, track);
  editLaneEtaTarget(
    session,
    entry,
    0,
    'spawn-release',
    true
  );
  rollFocus(entry, track);
}

export function launchFromPit(
  entry: Entry,
  session: Session,
  compound: TyreCompound = 'S'
): void {
  const track = session.trk;
  const pit = track.pit;
  // A qualifying launch starts at its authored team box. Any live crossing
  // conflict is handled by the pit release reservation and finite egress state;
  // moving the spawn rearward can place it inside another team's reservation.
  const longitudinal = pit.boxWAt(entry.ti);
  const position = pit.posAt(longitudinal, pit.boxOff);
  entry.car = makeCar(position.x, position.y, position.h);
  entry.car.progIdx = position.i;
  entry.car.s = (position.i * track.step) % track.len;
  entry.state = 'pitOut';
  entry.pitPhase = 'egress';
  entry.pitW = longitudinal;
  entry.pitQueueW = null;
  entry.pitQueueOff = null;
  entry.pitWaitReason = null;
  entry.pitWaitOwner = null;
  entry.trafficSlowPoint = null;
  entry.racecraftLongitudinalProgram = null;
  entry.rlap = makeLap();
  entry.lapLive = false;
  if (session.mode === 'quali') entry.lapPhase = 'out';
  else delete entry.lapPhase;
  entry.boxArm = false;
  entry.pitArm = null;
  entry.tyre = { c: compound || 'S', wear: 0, fit: entry.cross };
  entry.lat = pit.boxOff;
  clearLaneProgram(entry, 'pit');
  initializeLineCharacter(entry, track);
  entry.lineT = -1;
  rollFocus(entry, track);
}

export function stepEntry(
  e: Entry,
  S: Session,
  h: number,
  onLine: (entry: Entry, session: Session, valid: boolean) => void
): void {
  const tr = S.trk, pit = tr.pit, len = tr.len;
  const c = e.car!;
  const dynamicMu = entryDynamicMu(e, S);
  const modifiers = entryMods(e, S.wet, dynamicMu);

  // ---- parked in the box ----
  if (e.state === 'pit'){
    e.pitPhase = 'stopped-box';
    e.pitT -= h;
    if (e.pitT > 0) return;
    if (S.mode === 'quali' && e.boxArm){
      // the run is over: the car disappears into the garage
      releasePitReservation(e, S);
      e.car = null; e.state = 'box'; e.boxArm = false; e.lapLive = false;
      delete e.pitPhase;
      if (e.isPlayer){ emitToast(S, `${e.code} — back in the garage`, 'info'); emitHudDirty(S, e.ci); }
      return;
    }
    // A stopped car releases only after obtaining an egress reservation.
    // Through-lane cars always have priority over a release that has not begun.
    if (!requestPitBoxRelease(e, S)){ e.pitT = 0.25; return; }
    e.state = 'pitOut';
    e.pitPhase = 'egress';
    e.lapLive = false;
    if (e.isPlayer) emitHudDirty(S, e.ci);
    return;
  }

  // The pit lane can run close to another part of a circuit. Keep its own
  // monotonic longitudinal coordinate instead of trusting nearest-centerline
  // projection, which can jump a stopped box car to the wrong track segment.
  const laneAtStart = e.state === 'pitIn' || e.state === 'pitOut';
  if (laneAtStart){
    if (e.pitW == null || !Number.isFinite(e.pitW)) e.pitW = pit.wOf(c.s);
    const pitS = ((pit.sEntry + e.pitW!) % len + len) % len;
    c.progIdx = Math.round(pitS / tr.step) % tr.n;
    c.s = pitS;
  }

  // ---- driver inputs (every other substep, as before) ----
  e.botTick ^= 1;
  if (e.botTick){
    let lat = e.lat, vCap = Infinity;
    if (e.state === 'pitIn' || e.state === 'pitOut'){
      const w = e.pitW!;
      const pitPathOwnsLateral = e.pathPlan?.mode === 'pit' && !!e.path;
      const motion = planPitMotion(e, S);
      e.pitPhase = motion.phase;
      lat = motion.lateral;
      vCap = Math.min(vCap, w < 10 ? 22 : motion.speedCap);
      if (e.state === 'pitIn'){
        if (motion.stopW != null && motion.stopW - w < 1.4 && c.spd < 1.0){
          c.vx = 0; c.vy = 0; c.r = 0;
          if (motion.queued){
            e.pitPhase = 'queued';
            e.lat = lat;
            vCap = 0;
          } else {
            releasePitReservation(e, S);
            e.state = 'pit';
            e.pitPhase = 'stopped-box';
            e.pitWaitReason = null;
            e.pitWaitOwner = null;
            if (S.mode === 'quali') e.pitT = 1.4; else servePit(e, S);
            if (e.isPlayer) emitHudDirty(S, e.ci);
            return;
          }
        }
      } else {
        // Keep pit-exit authority until the whole car has actually converged
        // into the normal road corridor.  Switching at a fixed longitudinal
        // marker can hand a still-outside car to the normal planner; nearest-
        // centreline projection may then select the wrong side of the start
        // line and turn the retained pit target into a discontinuous command.
        let roadIndex = Math.max(0, c.progIdx) % tr.n;
        let roadLateral = e.latNow;
        let pitHandoffReady = false;
        if (w >= pit.Lp - 4) {
          // Project the physical car onto the road, rather than assuming the
          // pit spline's longitudinal sample is also the nearest road sample.
          // Around the start-line bend those can differ by several car
          // lengths. Preserve pit coordinates when the handoff is not ready.
          const pitIndex = c.progIdx;
          const pitProgress = c.s;
          const pitOffCourse = c.offCourse;
          const roadSurface = trackSense(tr, c);
          roadIndex = Math.max(0, c.progIdx) % tr.n;
          roadLateral = roadSurface.lat ?? e.latNow;
          const retainedTarget = e.path
            ? e.path.off[roadIndex]!
            : pit.off(w) + e.lat;
          pitHandoffReady = normalLateralIsLegal(tr, roadIndex, roadLateral) &&
            normalLateralIsLegal(tr, roadIndex, retainedTarget);
          if (!pitHandoffReady) {
            c.progIdx = pitIndex;
            c.s = pitProgress;
            c.offCourse = pitOffCourse;
          }
        }
        if (pitHandoffReady){
          releasePitReservation(e, S);
          e.state = 'run';
          e.latNow = roadLateral;
          // A sampled pit path already expresses the absolute lane offset.
          // Keep only a residual scalar when no pit path is available, or a
          // later tuck/rejoin plan would add the lane offset twice.
          lat = pitPathOwnsLateral
            ? 0
            : pit.off(w) - (tr.idealPath?.off[roadIndex] ?? 0);
          e.lat = lat;
          editLaneEtaTarget(S, e, 0, 'pit-exit-release');
          e.pitW = null;
          delete e.pitPhase;
          e.pitQueueW = null; e.pitQueueOff = null;
          e.pitWaitReason = null; e.pitWaitOwner = null;
          // fresh lap tracker: only checkpoints still ahead of the merge count
          e.rlap = makeLap(); e.rlap.started = true;
          let ncp = 0;
          while (ncp < tr.cps.length && tr.cps[ncp]!.i * tr.step <= c.s + 4) ncp++;
          e.rlap.nextCp = ncp;
          e.lapLive = false;
          lat = e.lat; vCap = Infinity;
          if (e.isPlayer) emitHudDirty(S, e.ci);
        }
      }
      e.lat = pitPathOwnsLateral ? 0 : lat;
    }
    const inPitState = e.state === 'pitIn' || e.state === 'pitOut';
    const pitPathAuthority = e.pathPlan?.mode === 'pit' && !!e.path;
    const drivePath = inPitState
      ? e.pathPlan?.mode === 'pit' ? e.path : undefined
      : e.path ?? tr.idealPath;
    const hasLaneAuthority = e.racecraftPathPlan != null ||
      e.laneProgram.points.length > 0 ||
      Math.abs(e.laneProgram.bias) > Number.EPSILON ||
      e.laneProgram.binding != null;
    const driveLane = pitPathAuthority
      ? e.laneBuffer ?? evaluateLaneProgram(S, e)
      : !inPitState
        ? e.laneBuffer ??
          (hasLaneAuthority ? evaluateLaneProgram(S, e) : undefined)
        : undefined;
    // Outside the pit lane, the evaluated lane span is the only lateral
    // authority. Pit retains its dedicated sampled path and residual control.
    const driveLateral = inPitState && !e.path ? lat : 0;
    e.inp = botStep(tr, S.prof, c, {
      margin: clamp(entryMargin(e, S, S.config.tuneBonus, S.wet) + flowOff(e, S), 0.85, 0.985),
      muScale: dynamicMu,
      downforceScale: modifiers.df,
      brakingEffort: S.mode === 'race'
        ? e.racecraftLongitudinalProgram?.brakingEffort ??
          e.brakingEffort
        : 0.82,
      powerScale: modifiers.pw,
      controlStepSeconds: h * 2,
      lat: driveLateral, vCap,
      ...(drivePath ? { path: drivePath } : {}),
      ...(driveLane ? { lane: driveLane } : {})
    });
  }

  // ---- physics ----
  const inLane = e.state === 'pitIn' || e.state === 'pitOut';
  const pitWPrev = inLane ? e.pitW : null;
  const laneSPrev = c.s;
  let surf;
  if (inLane){
    const ts = trackSense(tr, c);   // keeps s / progIdx fresh
    e.latNow = ts.lat!;
    surf = { mu: 1, drag: 0 };      // the lane is paved
  } else {
    surf = trackSense(tr, c);
    e.latNow = surf.lat!;
  }
  const px = c.x, py = c.y, sPrev = inLane ? laneSPrev : c.s;
  stepCar(c, e.inp, surf, h, modifiers);
  if (inLane){
    const pi = Math.round((((pit.sEntry + pitWPrev!) % len + len) % len) / tr.step) % tr.n;
    const dw = (c.x - px) * tr.tx[pi]! + (c.y - py) * tr.ty[pi]!;
    // The merge controller may need road distance after the geometric end of
    // the pit spline to bring the complete car footprint into the legal road
    // corridor.  One exit-ramp length is a physical convergence allowance,
    // not a timing heuristic; the state still releases at the first legal
    // sample above.
    e.pitW = clamp(pitWPrev! + dw, -30, pit.Lp + pit.rampOut);
    const pitS = ((pit.sEntry + e.pitW!) % len + len) % len;
    c.progIdx = Math.round(pitS / tr.step) % tr.n;
    c.s = pitS;
    notePitProgress(e, S);
  }
  e.spd = c.spd;

  // ---- start-line crossings ----
  if (inLane){
    // the line passes through the lane's s-range: count the wrap by hand
    if (sPrev > len - 30 && c.s < 30) onLine(e, S, false);
  } else {
    const ev = raceTick(tr, e.rlap, c, px, py);
    if (ev) onLine(e, S, ev.type === 'lap' && ev.valid);
  }
  if (e.state === 'dnf' || !e.car) return;
  // checkpoint splits for the live flying-lap delta (quali)
  if (S.mode === 'quali' && e.lapLive && e.lineT >= 0 && e.rlap.started){
    if (e.rlap.nextCp !== e._cpSeen){
      e._cpSeen = e.rlap.nextCp;
      const tNow = S.t - e.lineT;
      if (!e._curCps) e._curCps = [];
      e._curCps[e.rlap.nextCp] = tNow;
      const bestSplit = e._bestCps?.[e.rlap.nextCp];
      if (bestSplit != null) e._dLive = tNow - bestSplit;
    }
  }

  // ---- consumption, stress, mistakes ----
  if (S.mode === 'race' && (e.state === 'run' || e.state === 'pitIn')){
    if (e.state === 'run' && e.battle) e._battleLapSeconds += h;
    const lapT = S.prof.lapTime;
    const slick = e.tyre.c !== 'W';
    const lifeLaps = tyreLifeLaps(e.tyre.c, S.laps, S.wet);
    let wr = PACE_WEAR[e.pace] / lifeLaps;
    if (e.lu.trait === 'tyre') wr *= 0.8;
    e.tyre.wear = Math.min(1.15, e.tyre.wear + wr / lapT * h);
    const hadFuel = e.fuel > 0;
    e.fuel = Math.max(0, e.fuel - (1 / (S.laps * lapT * 1.3)) * PACE_FUEL[e.pace] * h);
    if (hadFuel && e.fuel <= 0) emitToast(S, `${e.code} is OUT OF FUEL — crawling home`, 'bad');
    const lenK = REF_LAPS / S.laps;
    let dS = (e.pace === 2 ? 0.009 : e.pace === 0 ? -0.012 : -0.004) * 2.4 * lenK
      + (e.underPressure ? 0.0015 : 0)
      + (S.wet > 0.25 && slick ? 0.005 : 0);
    if (e.lu.trait === 'hot' && dS > 0) dS *= 1.5;
    e.stress = clamp(e.stress + dS * h, 0, 1);
    e.mistT -= h;
    if (e.mistT <= 0 && e.state === 'run' && e.cross > 0){ e.mistT = 1.2; rollMistake(e, S); }
  }
  if (S.mode === 'quali' && e.state === 'run'){
    // qualifying trim chews the softs
    e.tyre.wear = Math.min(1.15, e.tyre.wear + (0.16 / S.prof.lapTime) * h);
    // traffic rattles a driver's rhythm; clean air settles it (feeds focus)
    const dS = (obligationsFor(S, e, S.entries).length ? 0.025 : -0.014) *
      (e.lu.trait === 'metro' ? 0.6 : 1);
    e.stress = clamp(e.stress + dS * h, 0, 0.6);
    if (e.isPlayer && !e.boxArm && e.tyre.wear > 0.95){
      e.boxArm = true;
      e.lapLive = false;
      e.lapPhase = 'in';
      emitToast(S, `${e.code} — tyres are past their best, boxing`, 'info');
      emitHudDirty(S, e.ci);
    }
  }
  e.liftT = Math.max(0, e.liftT - h);
  e.prog = e.cross * len + c.s;
  stepRecovery(e, S, h);

  // ---- pit entry ----
  if (e.state === 'run' && (e.pitArm || e.boxArm)){
    const dIn = (pit.sEntry - c.s + len) % len;
    const entryAligned = Math.abs(e.latNow - pit.off(0)) <=
      PHYS.carWid / 2;
    if (dIn < 26 && entryAligned){
      e.state = 'pitIn';
      e.pitPhase = 'travel';
      e.pitW = -dIn;
      e.pitQueueW = null;
      e.pitQueueOff = null;
      e.pitWaitReason = null;
      e.pitWaitOwner = null;
      e.lapLive = false;
      if (S.mode === 'quali') e.lapPhase = 'in';
      if (e.isPlayer) emitHudDirty(S, e.ci);
    }
  }

  // ---- local effects: skids + dust near the camera ----
  if (c.spd > 5){
    const camE = S.entries[S.camI];
    if (camE && camE.car && Math.abs(camE.car.x - c.x) < 130 && Math.abs(camE.car.y - c.y) < 130){
      const ch2 = Math.cos(c.h), sh2 = Math.sin(c.h);
      if (Math.abs(c.slipR) > 0.13){
        const rx = c.x - 1.55 * ch2, ry = c.y - 1.55 * sh2;
        if (e._prw) emitSessionEvent(S, {
          type: 'effect', kind: 'skid', x0: e._prw[0], y0: e._prw[1], x1: rx, y1: ry,
          alpha: clamp((Math.abs(c.slipR) - 0.1) * 2.6, 0.25, 1)
        });
        e._prw = [rx, ry];
      } else e._prw = null;
      if (!inLane && trackZone(e, S) === 'grass' && random() < h * 30){
        emitSessionEvent(S, {
          type: 'effect', kind: 'dust',
          x: c.x - 1.6 * ch2,
          y: c.y - 1.6 * sh2,
          vx: -ch2 * c.spd * 0.25 + (random() - 0.5) * 3,
          vy: -sh2 * c.spd * 0.25 + (random() - 0.5) * 3,
          big: false
        });
      }
    }
  }
}
function trackZone(e: Entry, S: Session): 'road' | 'curb' | 'grass' {
  const tr = S.trk, i = e.car!.progIdx;
  if (i < 0) return 'road';
  const lat = (e.car!.x - tr.x[i]!) * tr.nx[i]! +
    (e.car!.y - tr.y[i]!) * tr.ny[i]!;
  return surfaceExposureAtLateral(tr, i, lat).zone;
}
