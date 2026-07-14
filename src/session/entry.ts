import { botStep } from '../core/autopilot';
import { makeLap, raceTick } from '../core/lap';
import { makeCar, stepCar, trackSense } from '../core/physics-engine';
import { clamp } from '../shared/math';
import { rollMistake, stepRecovery } from './incidents';
import {
  notePitProgress, planPitMotion, releasePitReservation, requestPitBoxRelease, servePit
} from './pit';
import { emitHudDirty, emitSessionEvent, emitToast } from './events';
import {
  entryMargin, entryMods, entryMu, flowOff, PACE_FUEL, PACE_WEAR, REF_LAPS, rollFocus
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
    latTgt: 0,
    gridLat: 0,
    vCap: Infinity,
    trafCap: Infinity,
    liftT: 0,
    yieldT: 0,
    atkT: 0,
    atkSide: 0,
    atkCorner: -1,
    atkCd: 0,
    atkSeq: 0,
    closeT: 0,
    defT: 0,
    defCorner: -1,
    defAbs: 0,
    concedeT: 0,
    concedeV: 0,
    tuckT: 0,
    tow: 0,
    lungeT: 0,
    recT: 0,
    avoidT: 0,
    _avoidWith: '',
    _avoidSide: 0,
    _roomWith: '',
    _tuckWith: '',
    _tuckCorner: -1,
    _lungeRoll: -1,
    mistT: 0.6 + Math.random() * 1.4,
    battle: false,
    focusNow: 0.6,
    flow: null,
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
    botTick: 0
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
  entry.lat = lateralOffset || 0;
  entry.latTgt = 0;
  rollFocus(entry);
}

export function launchFromPit(
  entry: Entry,
  session: Session,
  compound: TyreCompound = 'S'
): void {
  const track = session.trk;
  const pit = track.pit;
  let longitudinal = pit.boxWAt(entry.ti);
  for (const other of session.entries) {
    if (other === entry || !other.car) continue;
    if (other.state !== 'pit' && other.state !== 'pitIn' && other.state !== 'pitOut') continue;
    const otherLongitudinal = other.pitW != null && Number.isFinite(other.pitW)
      ? other.pitW
      : pit.wOf(other.car.s);
    if (Math.abs(otherLongitudinal - longitudinal) < 9) longitudinal = otherLongitudinal - 9;
  }
  longitudinal = Math.max(6, longitudinal);
  const position = pit.posAt(longitudinal, pit.boxOff);
  entry.car = makeCar(position.x, position.y, position.h);
  entry.car.progIdx = position.i;
  entry.car.s = (position.i * track.step) % track.len;
  entry.state = 'pitOut';
  entry.pitPhase = 'egress';
  entry._pitMergeCommitted = false;
  entry.pitW = longitudinal;
  entry.pitQueueW = null;
  entry.pitQueueOff = null;
  entry.pitWaitReason = null;
  entry.pitWaitOwner = null;
  entry.rlap = makeLap();
  entry.lapLive = false;
  if (session.mode === 'quali') entry.lapPhase = 'out';
  else delete entry.lapPhase;
  entry.boxArm = false;
  entry.pitArm = null;
  entry.tyre = { c: compound || 'S', wear: 0, fit: entry.cross };
  entry.lat = pit.boxOff;
  entry.latTgt = 0;
  entry.lineT = -1;
  rollFocus(entry);
}

export function stepEntry(
  e: Entry,
  S: Session,
  h: number,
  onLine: (entry: Entry, session: Session, valid: boolean) => void
): void {
  const tr = S.trk, pit = tr.pit, len = tr.len;
  const c = e.car!;

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
    e._pitMergeCommitted = false;
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
    let lat = e.lat, vCap = e.vCap;
    if (e.state === 'pitIn' || e.state === 'pitOut'){
      const w = e.pitW!;
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
        const holdW = pit.Lp - pit.rampOut - 4;
        if (motion.phase === 'merge' && !e._pitMergeCommitted && w > holdW - 28){
          let mergeBusy = false;
          let mergeOwner: Entry | null = null;
          for (const o of S.entries){
            if (o === e || !o.car || (o.state !== 'run' && o.state !== 'fin')) continue;
            const toExit = (pit.sExit - o.car.s + len) % len;
            const justPast = (o.car.s - pit.sExit + len) % len;
            if ((toExit < 170 && toExit / Math.max(8, o.spd) < 4.2) || justPast < 32){
              mergeBusy = true; mergeOwner = o; break;
            }
          }
          if (mergeBusy){
            const stopD = Math.max(0, holdW - w - 0.8);
            vCap = Math.min(vCap, Math.sqrt(2 * 5.5 * stopD));
            e.pitWaitReason = 'merge-traffic';
            e.pitWaitOwner = mergeOwner?.code ?? null;
          } else if (w >= holdW - 2){
            e._pitMergeCommitted = true;
            e.pitWaitReason = null;
            e.pitWaitOwner = null;
          }
        }
        if (e._pitMergeCommitted && w > pit.Lp - pit.rampOut * 0.55)
          vCap = Infinity; // accelerate through a merge gap already accepted
        if (w >= pit.Lp - 4){
          releasePitReservation(e, S);
          e.state = 'run';
          e.latTgt = 0; e.lat = pit.off(w); e.pitW = null; e._pitMergeCommitted = false;
          delete e.pitPhase;
          e.pitQueueW = null; e.pitQueueOff = null;
          e.pitWaitReason = null; e.pitWaitOwner = null;
          // fresh lap tracker: only checkpoints still ahead of the merge count
          e.rlap = makeLap(); e.rlap.started = true;
          let ncp = 0;
          while (ncp < tr.cps.length && tr.cps[ncp]!.i * tr.step <= c.s + 4) ncp++;
          e.rlap.nextCp = ncp;
          e.lapLive = false;
          lat = e.lat; vCap = e.vCap;
          if (e.isPlayer) emitHudDirty(S, e.ci);
        }
      }
      if (e.trafCap < vCap) vCap = e.trafCap;
      e.lat = lat;
    } else if (e.state === 'run' && (e.pitArm || e.boxArm)){
      // ease down toward pit-lane speed on the approach
      const dIn = (pit.sEntry - c.s + len) % len;
      if (dIn < 150) vCap = Math.min(vCap, Math.sqrt(pit.limit * pit.limit + 2 * 9.5 * Math.max(0, dIn - 6)));
    }
    const drivePath = e.path ??
      (e.state === 'pitIn' || e.state === 'pitOut' ? undefined : tr.idealPath);
    const driveLateral = e.path ? 0 : lat;
    e.inp = botStep(tr, S.prof, c, {
      margin: clamp(entryMargin(e, S, S.config.tuneBonus, S.wet) + flowOff(e, S), 0.85, 0.985),
      muScale: entryMu(e, S.wet),
      lat: driveLateral, vCap,
      ...(drivePath ? { path: drivePath } : {})
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
  stepCar(c, e.inp, surf, h, entryMods(e, S.wet));
  if (inLane){
    const pi = Math.round((((pit.sEntry + pitWPrev!) % len + len) % len) / tr.step) % tr.n;
    const dw = (c.x - px) * tr.tx[pi]! + (c.y - py) * tr.ty[pi]!;
    e.pitW = clamp(pitWPrev! + dw, -30, pit.Lp + 4);
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
    const lapT = S.prof.lapTime;
    const slick = e.tyre.c !== 'W';
    const lifeLaps = Math.max(2,
      e.tyre.c === 'S' ? 0.30 * S.laps :
      e.tyre.c === 'H' ? 0.55 * S.laps :
      (S.wet > 0.3 ? 0.45 * S.laps : 0.10 * S.laps));
    let wr = PACE_WEAR[e.pace] / lifeLaps;
    if (e.lu.trait === 'tyre') wr *= 0.8;
    e.tyre.wear = Math.min(1.15, e.tyre.wear + wr / lapT * h);
    const hadFuel = e.fuel > 0;
    e.fuel = Math.max(0, e.fuel - (1 / (S.laps * lapT * 1.3)) * PACE_FUEL[e.pace] * h);
    if (hadFuel && e.fuel <= 0) emitToast(S, `${e.code} is OUT OF FUEL — crawling home`, 'bad');
    const lenK = REF_LAPS / S.laps;
    let dS = (e.pace === 2 ? 0.009 : e.pace === 0 ? -0.012 : -0.004) * 2.4 * lenK
      + (e.battle ? 0.0035 : 0) + (S.wet > 0.25 && slick ? 0.005 : 0);
    if (e.lu.trait === 'hot' && dS > 0) dS *= 1.5;
    e.stress = clamp(e.stress + dS * h, 0, 1);
    e.mistT -= h;
    if (e.mistT <= 0 && e.state === 'run' && e.cross > 0){ e.mistT = 1.2; rollMistake(e, S); }
  }
  if (S.mode === 'quali' && e.state === 'run'){
    // qualifying trim chews the softs
    e.tyre.wear = Math.min(1.15, e.tyre.wear + (0.16 / S.prof.lapTime) * h);
    // traffic rattles a driver's rhythm; clean air settles it (feeds focus)
    const dS = (e.yieldT > 0 || e.battle ? 0.025 : -0.014) * (e.lu.trait === 'metro' ? 0.6 : 1);
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
    if (dIn < 26){
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
      if (!inLane && trackZone(e, S) === 'grass' && Math.random() < h * 30){
        emitSessionEvent(S, {
          type: 'effect', kind: 'dust',
          x: c.x - 1.6 * ch2,
          y: c.y - 1.6 * sh2,
          vx: -ch2 * c.spd * 0.25 + (Math.random() - 0.5) * 3,
          vy: -sh2 * c.spd * 0.25 + (Math.random() - 0.5) * 3,
          big: false
        });
      }
    }
  }
}
function trackZone(e: Entry, S: Session): 'road' | 'curb' | 'grass' {
  const tr = S.trk, i = e.car!.progIdx;
  if (i < 0) return 'road';
  const lat = Math.abs((e.car!.x - tr.x[i]!) * tr.nx[i]! + (e.car!.y - tr.y[i]!) * tr.ny[i]!);
  return lat < tr.hw - 1 ? 'road' : lat < tr.hw + 1.3 ? 'curb' : 'grass';
}
