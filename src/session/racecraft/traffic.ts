import { clamp, lerp, normAng } from '../../shared/math';
import { nextCorner } from '../../core/racing-line';
import { entryMargin, START_BLEND_END, TRAF_DT } from '../strategy';
import { pitTrafficReference, prunePitReservations } from '../pit';
import type { Car, Track } from '../../core/model';
import type { Entry, LegacyRoomPair, Session, SideBySideEpisode, SideBySidePair } from '../model';
import {
  applyCornerRights, cornerByApex, hasCornerRights, idxAheadM, idxInWindow,
  longitudinalBodiesOverlap, recentCorner, ROOM_SEP, roomPairKey, updateCornerRights
} from './corner-rights';
import {
  followCap, lineOffAt, setTargetAbsLat, syncRacecraftPaths, targetAbsLat
} from './paths';
import {
  applyPriorityRecords,
  applyQualifyingTrafficSafety,
  hasPriorityRelation,
  isPriorityYielding,
  updatePriorityRecords
} from './priority';

type ActiveEntry = Entry & { car: Car };

export function unstableCar(tr: Track, e: Entry): boolean {
  if (!e.car) return false;
  const i = Math.max(0, e.car.progIdx);
  const roadH = Math.atan2(tr.ty[i]!, tr.tx[i]!);
  return e.car.offCourse || Math.abs(normAng(e.car.h - roadH)) > 0.42 ||
    Math.abs(e.car.r) > 1.0 || Math.abs(e.car.slipR) > 0.28;
}
function peelingToPit(tr: Track, a: Entry): boolean {
  if (!a.car) return false;
  const dPit = (tr.pit.sEntry - a.car.s + tr.len) % tr.len;
  return (a.pitArm || a.boxArm) && dPit < 180;
}
function cornerRightsRejoining(entry: Entry): boolean {
  return (entry.tuckT > 0 && entry._tuckWith === 'corner-rights') ||
    (entry.pathPlan?.mode === 'tuck' &&
      entry.pathPlan.key.includes(':explicit:corner-rights:'));
}
function priorityRejoining(entry: Entry): boolean {
  const plan = entry.pathPlan;
  if (!plan) return false;
  if (plan.mode === 'blue-yield' || plan.mode === 'qualifying-yield') return true;
  return plan.mode === 'tuck' &&
    (plan.key.includes(':blue-yield:') || plan.key.includes(':qualifying-yield:'));
}
function isTrafficObstacle(tr: Track, e: Entry, a: Entry): boolean {
  return a.hFail || peelingToPit(tr, a) || a.spd < Math.max(8, e.spd * 0.4) ||
    e.spd - a.spd > 18 || unstableCar(tr, a);
}

export function updateTraffic(S: Session): void {
  const tr = S.trk, len = tr.len;
  prunePitReservations(S);
  const list: ActiveEntry[] = [];
  const sbsPairs = S.sbsPairs ?? (S.sbsPairs = Object.create(null) as Record<string, SideBySidePair>);
  const sbsEpisodes = S.sbsEpisodes ?? (S.sbsEpisodes = [] as SideBySideEpisode[]);
  const roomPairs = S.roomPairs ?? (S.roomPairs = Object.create(null) as Record<string, LegacyRoomPair>);
  S._roomStamp = (S._roomStamp || 0) + 1;
  const roomStamp = S._roomStamp;
  S._sbsStamp = (S._sbsStamp || 0) + 1;
  const sbsStamp = S._sbsStamp;
  for (const e of S.entries){
    if (!e.car || e.state === 'grid' || e.state === 'dnf' || e.state === 'pit') continue;
    list.push(e as ActiveEntry);
    e.battle = false; e.vCap = Infinity; e.trafCap = Infinity;
    const hadAttack = e.atkT > 0;
    e.atkT = Math.max(0, e.atkT - TRAF_DT);
    if (hadAttack && e.atkT <= 0) e.atkCd = Math.max(e.atkCd, 1.0);
    e.atkCd = Math.max(0, e.atkCd - TRAF_DT);
    e.closeT = Math.max(0, e.closeT - TRAF_DT * 0.35);
    e.defT = Math.max(0, e.defT - TRAF_DT);
    e.concedeT = Math.max(0, e.concedeT - TRAF_DT);
    e.yieldT = Math.max(0, e.yieldT - TRAF_DT);
    e.tuckT = Math.max(0, e.tuckT - TRAF_DT);
    e.lungeT = Math.max(0, e.lungeT - TRAF_DT);
    e.avoidT = Math.max(0, e.avoidT - TRAF_DT);
    e.tow = (e.tow || 0) * 0.8;
    if (e.state === 'run' && e.hFail){
      e.atkT = 0; e.atkCd = Math.max(e.atkCd, 1.0);
      e.defT = 0; e.defCorner = -1;
      setTargetAbsLat(tr, e, Math.min(3.2, tr.hw - 2.0));
    }
    if (e.state === 'run' && (e.pitArm || e.boxArm)){
      const dPit = (tr.pit.sEntry - e.car.s + len) % len;
      if (dPit < 180){
        e.atkT = 0; e.atkCd = Math.max(e.atkCd, 1.0);
        e.defT = 0; e.defCorner = -1;
        setTargetAbsLat(tr, e, Math.min(3.2, tr.hw - 2.0));
      }
    }
    if (e.defCorner >= 0){
      const dc = cornerByApex(tr, e.defCorner);
      if (dc && idxAheadM(tr, dc.apexI, Math.max(0, e.car.progIdx)) < 80)
        e.latTgt *= 0.82;
      else if (dc && e.defT > 0) setTargetAbsLat(tr, e, e.defAbs);
    }
    if (e.atkT > 0 && e.tuckT <= 0 && e.avoidT <= 0) setTargetAbsLat(tr, e, e.atkSide);
  }
  const n = list.length;
  updateCornerRights(S, list);
  updatePriorityRecords(S, list);
  if (n > 1){
    list.sort((a, b) => a.car.s - b.car.s);
    for (let k = 0; k < n; k++){
      const e = list[k]!, a1 = list[(k + 1) % n]!;
      const a2 = n >= 3 ? list[(k + 2) % n]! : null;
      const ds1 = (a1.car.s - e.car.s + len) % len;
      const sep1 = Math.abs(a1.latNow - e.latNow);
      const sbsKey = roomPairKey(e, a1);
      const sbsLive = sbsPairs[sbsKey];
      // Match the room-sharing hysteresis: a real episode starts only after
      // two lanes exist, then survives small suspension/steering movement.
      // This prevents one battle being split into 0.1 s fragments at 1.8 m.
      if (ds1 < 6 && (sbsLive ? sep1 > 1.6 : sep1 > 2.1) &&
          e.state === 'run' && a1.state === 'run'){
        let ep = sbsPairs[sbsKey];
        if (!ep) ep = sbsPairs[sbsKey] = {
          t0: S.t, contact: false, seen: sbsStamp, a: e.code, b: a1.code
        };
        ep.seen = sbsStamp;
        S.sbsT = (S.sbsT || 0) + TRAF_DT;
      }

      if (e.state === 'fin'){
        e.atkT = 0; e.atkCd = Math.max(e.atkCd, 2);
        setTargetAbsLat(tr, e, Math.min(3.2, tr.hw - 2.0));
        continue;
      }

      const eLane = e.state === 'pitIn' || e.state === 'pitOut';
      if (eLane){
        const conflict = pitTrafficReference(e, S);
        if (conflict){
          const leader = conflict.entry;
          const distance = conflict.distance;
          const safe = Math.sqrt(leader.spd * leader.spd + 2 * 6.0 * Math.max(0, distance - 5));
          e.trafCap = Math.max(
            0,
            Math.min(e.trafCap, safe, followCap(S, e, leader, distance, 0.65))
          );
          e.pitTrafficLeader = leader.code;
          e.pitWaitReason = conflict.reason;
        } else {
          e.pitTrafficLeader = null;
          if (e.pitWaitReason === 'lane-conflict' || e.pitWaitReason === 'physical-crossing')
            e.pitWaitReason = null;
        }
        continue;
      }

      let ref: ActiveEntry | null = null, refDs = Infinity;
      for (const a of a2 ? [a1, a2] : [a1]){
        const ds = (a.car.s - e.car.s + len) % len;
        const aLane = a.state === 'pitIn' || a.state === 'pitOut';
        if (aLane){
          if (ds < 160 && Math.abs(a.latNow) < tr.hw + tr.pit.laneOff + 2){
            // Every pit lane leaves on +normal. Commit passing traffic to the
            // road side instead of flipping with a pit car's transient yaw.
            setTargetAbsLat(tr, e, -2.8);
            if (ds < 10 && Math.abs(e.latNow - a.latNow) < 2.4)
              e.vCap = Math.min(e.vCap, followCap(S, e, a, ds, 0.40));
          }
          continue;
        }
        const sep = Math.abs(e.latNow - a.latNow);
        const obstacle = isTrafficObstacle(tr, e, a);
        const obstacleSep = peelingToPit(tr, a) ? Math.max(6.4, tr.hw) : 3.2;
        if (((ds <= 60 && sep < 2.2) || (obstacle && ds <= 160 && sep < obstacleSep)) && ds < refDs){
          ref = a; refDs = ds;
        }
        const ii = Math.max(0, e.car.progIdx);
        if (ds < 16 && sep < 1.5 && e.spd > 30 && a.spd > 30 &&
            Math.abs(tr.idealPath?.k[ii] ?? tr.kSm[ii]!) < 1 / 230)
          e.tow = Math.max(e.tow, clamp(1 - ds / 18, 0, 0.7));
      }
      // A spin can have two cars already stacked behind it. Normal braking
      // awareness deliberately stops at two-ahead; emergency hazards do not.
      for (let q = 3; q < n; q++){
        const a = list[(k + q) % n]!;
        const ds = (a.car.s - e.car.s + len) % len;
        if (ds > 160) break;
        const aLane = a.state === 'pitIn' || a.state === 'pitOut';
        const obstacleSep = peelingToPit(tr, a) ? Math.max(6.4, tr.hw) : 3.2;
        if (!aLane && isTrafficObstacle(tr, e, a) && Math.abs(e.latNow - a.latNow) < obstacleSep && ds < refDs){
          ref = a; refDs = ds;
        }
      }
      const rightsRejoin = cornerRightsRejoining(e) ||
        (ref ? cornerRightsRejoining(ref) : false);
      if (isPriorityYielding(S, e)) {
        e.atkT = 0; e.defT = 0; e.lungeT = 0; e.tow = 0;
      } else if (rightsRejoin || priorityRejoining(e)) {
        e.atkT = 0; e.atkCorner = -1;
        e.defT = 0; e.defCorner = -1;
        e.lungeT = 0;
      } else if (ref && !hasCornerRights(S, e, ref) && !hasPriorityRelation(S, e, ref)) {
        stepRacecraft(S, e, ref, refDs);
      } else if (!ref || !hasPriorityRelation(S, e, ref)) {
        e.latTgt *= 0.92;
      }
      if (e.tuckT > 0){
        const a = a1.code === e._tuckWith ? a1 : (a2 && a2.code === e._tuckWith ? a2 : null);
        if (a){
          const ds = (a.car.s - e.car.s + len) % len;
          e.latTgt = 0;
          e.vCap = Math.min(e.vCap, followCap(S, e, a, ds, 0.40));
        }
      }
    }

    for (const key in sbsPairs){
      const ep = sbsPairs[key]!;
      if (ep.seen === sbsStamp) continue;
      const ea = S.entries.find(x => x.code === ep.a), eb = S.entries.find(x => x.code === ep.b);
      const epSep = ea && eb ? Math.abs(ea.latNow - eb.latNow) : 0;
      const epAB = ea?.car && eb?.car ? ((eb.car.s - ea.car.s + len) % len) : len;
      const epDs = Math.min(epAB, len - epAB);
      const reason = !ea || !eb || ea.state !== 'run' || eb.state !== 'run' ? 'state' :
        epSep <= 1.8 ? 'lane' : epDs >= 6 ? 'long' : 'order';
      if (sbsEpisodes.length >= 200) sbsEpisodes.shift();
      sbsEpisodes.push({ t: Math.max(TRAF_DT, S.t - ep.t0), contact: ep.contact, reason });
      delete sbsPairs[key];
    }

    // Immediate neighbours negotiate room even when the car two ahead is the
    // actual braking reference. Hysteresis prevents 30 Hz lane oscillation.
    for (const e of list) e._roomActive = false;
    for (let k = 0; k < n; k++){
      const e = list[k]!;
      for (let q = 1; q < n; q++){
      const a = list[(k + q) % n]!;
      if ((e.state !== 'run' && e.state !== 'fin') ||
          (a.state !== 'run' && a.state !== 'fin')) continue;
      const ds = (a.car.s - e.car.s + len) % len;
      if (ds >= 12) break;
      const sep = Math.abs(a.latNow - e.latNow);
      const roomKey = roomPairKey(e, a);
      let forceRoom = false;
      const rightsPair = hasCornerRights(S, e, a);
      const rightsRejoin = cornerRightsRejoining(e) || cornerRightsRejoining(a);
      const nc = nextCorner(tr, Math.max(0, a.car.progIdx));
      const dBrake = nc ? idxAheadM(tr, Math.max(0, a.car.progIdx), nc.brakeI) : Infinity;
      if (!rightsPair && !rightsRejoin && nc && dBrake < 15 && e.atkT > 0 &&
          (e.atkCorner < 0 || e.atkCorner === nc.apexI)){
        if (ds < 4.5 && sep > 1.8){
          forceRoom = true;
          if (e.latNow < a.latNow)
            setTargetAbsLat(tr, a, Math.max(targetAbsLat(tr, a), e.latNow + ROOM_SEP));
          else setTargetAbsLat(tr, a, Math.min(targetAbsLat(tr, a), e.latNow - ROOM_SEP));
        } else if (ds >= 4.5){
          e.atkT = 0; e.atkCorner = -1; e.latTgt = 0;
          e.atkCd = Math.max(e.atkCd, 1.5);
          e.tuckT = 0.6; e._tuckWith = a.code;
          S.tuckFailN = (S.tuckFailN || 0) + 1;
        }
      }

      let roomState = roomPairs[roomKey] || null;
      const wasRoom = !!roomState;
      const recoveryRoom = !!(roomState && roomState.contactSeed);
      const damagedRoom = e.hFail || a.hFail;
      const releaseSep = roomState && roomState.contactSeed ? 1.05 : 1.6;
      const room = !rightsPair && !rightsRejoin && !hasPriorityRelation(S, e, a) &&
        ds < 12 && !unstableCar(tr, e) && !unstableCar(tr, a) &&
        (recoveryRoom || damagedRoom || (!e.hFail && !a.hFail &&
          (forceRoom || (wasRoom ? sep >= releaseSep : sep > 2.1))));
      if (room){
        if (!roomState) roomState = {};
        if (roomState.contactSeed && sep >= 2.3) roomState.contactSeed = false;
        if (roomState.cornerApex == null){
          const roomCorner = nextCorner(tr, Math.max(0, a.car.progIdx));
          roomState.cornerApex = roomCorner ? roomCorner.apexI : -1;
        }
        roomState.seen = roomStamp;
        roomPairs[roomKey] = roomState;
        e._roomActive = true; a._roomActive = true;
        e.battle = true; a.battle = true;
        if (sbsPairs[roomKey])
          e.vCap = Math.min(e.vCap, a.spd + 4.0 - 1.0 * S.wet);
        if (e.hFail || a.hFail){
          const damaged = e.hFail ? e : a;
          const clear = damaged === e ? a : e;
          setTargetAbsLat(tr, damaged, Math.min(3.2, tr.hw - 2.0));
          setTargetAbsLat(tr, clear, -Math.min(3.2, tr.hw - 2.0));
        } else if (e.latNow < a.latNow){
          setTargetAbsLat(tr, e, Math.min(targetAbsLat(tr, e), a.latNow - ROOM_SEP));
          setTargetAbsLat(tr, a, Math.max(targetAbsLat(tr, a), e.latNow + ROOM_SEP));
        } else {
          setTargetAbsLat(tr, e, Math.max(targetAbsLat(tr, e), a.latNow + ROOM_SEP));
          setTargetAbsLat(tr, a, Math.min(targetAbsLat(tr, a), e.latNow - ROOM_SEP));
        }
        const exitCorner = recentCorner(tr, Math.max(0, a.car.progIdx), 45);
        if (exitCorner && exitCorner.apexI === roomState.cornerApex &&
            ds > 2.7 && e._tuckCorner !== exitCorner.apexI){
          e._tuckCorner = exitCorner.apexI;
          S.tuckExitN = (S.tuckExitN || 0) + 1;
          e.atkCd = Math.max(e.atkCd, 1.0);
          e.tuckT = 0.6; e._tuckWith = a.code; e.latTgt = 0;
          e.vCap = Math.min(e.vCap, followCap(S, e, a, ds, 0.40));
          delete roomPairs[roomKey];
        } else if (roomState.cornerApex >= 0){
          const past = idxAheadM(tr, roomState.cornerApex, Math.max(0, a.car.progIdx));
          if (past > 60 && past < tr.len / 2){
            const roomCorner = nextCorner(tr, Math.max(0, a.car.progIdx));
            roomState.cornerApex = roomCorner ? roomCorner.apexI : -1;
          }
        }
      } else if (wasRoom){
        delete roomPairs[roomKey];
      }
      }
    }
    for (const key in roomPairs)
      if (roomPairs[key]!.seen !== roomStamp) delete roomPairs[key];
  }

  if (n <= 1){
    for (const key in sbsPairs){
      const ep = sbsPairs[key]!;
      if (sbsEpisodes.length >= 200) sbsEpisodes.shift();
      sbsEpisodes.push({ t: Math.max(TRAF_DT, S.t - ep.t0), contact: ep.contact, reason: 'state' });
      delete sbsPairs[key];
    }
  }
  const latMax = tr.hw - 2.0;
  applyPriorityRecords(S);
  applyCornerRights(S);
  syncRacecraftPaths(S, list);
  for (const e of list){
    if (e.state === 'pitIn' || e.state === 'pitOut') continue;
    if (e.concedeT > 0) e.vCap = Math.min(e.vCap, e.concedeV);
    if (e.avoidT > 0 && !e._roomActive){
      const avoid = Math.min(3.2, tr.hw - 2.0);
      setTargetAbsLat(tr, e, e._avoidSide * avoid);
    }
    const latRate = e.avoidT > 0 ? 0.055 : e._roomActive ? 0.052 : 0.025;
    const wetSlew = 1 - 0.18 * S.wet;
    const latStep = (e.avoidT > 0 || e._roomActive ? 0.110 : 0.070) * wetSlew;
    e.lat += clamp((e.latTgt - e.lat) * latRate, -latStep, latStep);
    const off = lineOffAt(tr, e);
    e.lat = clamp(off + e.lat, -latMax, latMax) - off;
  }
}

function stepRacecraft(S: Session, e: ActiveEntry, a: ActiveEntry, ds: number): void {
  const tr = S.trk;
  const eLat = e.latNow, aLat = a.latNow;
  const sep = Math.abs(eLat - aLat);
  const i0 = Math.max(0, e.car.progIdx);
  // Something crawling on the racing surface is an obstacle, not a leader to
  // gap-follow. Keep this explicit pass-around behaviour.
  if (isTrafficObstacle(tr, e, a)){
    if (ds < 160){
      const avoid = Math.min(3.2, tr.hw - 2.0);
      if (peelingToPit(tr, a)){
        e._avoidWith = a.code;
        e._avoidSide = -1;
      } else if (e.avoidT <= 0){
        e._avoidWith = a.code;
        e._avoidSide = aLat >= 0 ? -1 : 1;
      }
      e.avoidT = Math.max(e.avoidT, 0.8);
      setTargetAbsLat(tr, e, e._avoidSide * avoid);
      if (sep < 3.2){
        const safe = Math.sqrt(a.spd * a.spd + 2 * 9.0 * Math.max(0, ds - 7));
        e.vCap = Math.min(e.vCap, Math.max(a.spd, safe));
      }
    }
    return;
  }
  if (ds > 60){ e.latTgt *= 0.86; return; }
  if (applyQualifyingTrafficSafety(S, tr, e, a, ds, sep)) return;

  const startAge = S.t - S.goT;
  if (startAge < 4){
    setTargetAbsLat(tr, e, e.gridLat);
    if (ds < 60 && sep < 2.8)
      e.vCap = Math.min(followCap(S, e, a, ds, 0.75, 0.8), a.spd + 3.0);
    if (ds < 12){ e.battle = true; a.battle = true; }
    return;
  }
  if (startAge < START_BLEND_END){
    const u = clamp((startAge - 4) / (START_BLEND_END - 4), 0, 1);
    setTargetAbsLat(tr, e, lerp(e.gridLat, lineOffAt(tr, e), u));
    if (ds < 60 && sep < 2.8)
      e.vCap = Math.min(followCap(S, e, a, ds, lerp(0.75, 0.45, u), lerp(0.8, 1.2, u)), a.spd + 3.0);
    if (ds < 12){ e.battle = true; a.battle = true; }
    return;
  }
  // A damaged car's job is to reach the pits predictably, not contest the
  // next corner. Followers already treat it as an obstacle and pass road-side.
  if (e.hFail){
    setTargetAbsLat(tr, e, Math.min(3.2, tr.hw - 2.0));
    if (ds < 30 && sep < 2.5) e.vCap = followCap(S, e, a, ds, 0.55);
    return;
  }

  const tuneBonus = S.config.tuneBonus;
  const marginAdv = entryMargin(e, S, tuneBonus, S.wet) - entryMargin(a, S, tuneBonus, S.wet) > 0.002;
  if (e.spd - a.spd > 2.5) e.closeT = Math.min(2, e.closeT + TRAF_DT * 1.35);
  const faster = marginAdv || e.closeT > 0.55;
  if (ds < 15){ e.battle = true; a.battle = true; }
  if (ds < 8.5 && sep > 2.3){
    e.atkT = Math.max(e.atkT, 1.0);
    return;
  }
  const nc = nextCorner(tr, i0);
  const dBrake = nc ? idxAheadM(tr, i0, nc.brakeI) : Infinity;
  if (faster && ds < 30 && (e.atkT > 0 || e.atkCd <= 0)){
    if (e.atkT <= 0 || !isFinite(e.atkSide)){
      const cornerNear = nc && dBrake <= Math.max(40, e.spd * 3.2);
      e.atkSide = cornerNear ? nc.side * 2.8 : (aLat >= 0 ? -3.0 : 3.0);
      e.atkCorner = cornerNear ? nc.apexI : -1;
      e.atkT = 3.0;
      e.atkSeq = (e.atkSeq || 0) + 1;
    }
    let tight = false;
    for (let q = 6; q <= 30; q += 6){
      if (Math.abs(tr.idealPath?.k[(i0 + q) % tr.n] ?? tr.kSm[(i0 + q) % tr.n]!) > 1 / 42){
        tight = true; break;
      }
    }
    if (tight && ds > 4.5){
      e.latTgt *= 0.9;
      if (ds < 12 && sep < 2.4) e.vCap = followCap(S, e, a, ds, 0.35);
    } else {
      setTargetAbsLat(tr, e, e.atkSide);
      if (ds < 30 && sep < 2.3)
        e.vCap = followCap(S, e, a, ds, sep < 1.5 ? 0.38 : sep < 2.1 ? 0.28 : 0.18, 2.2);
    }

    const ac = cornerByApex(tr, e.atkCorner);
    if (ac && idxInWindow(tr, i0, ac.brakeI, ac.apexI)){
      e.lungeT = Math.max(e.lungeT, 0.20);
      if (e._lungeRoll !== ac.apexI){
        e._lungeRoll = ac.apexI;
        S.lungeN = (S.lungeN || 0) + 1;
        if (Math.random() < 0.06 * (1 - e.focusNow)){
          e.liftT = Math.max(e.liftT, 1.2);
          S.lockupN = (S.lockupN || 0) + 1;
        }
      }
    }

    const defKey = e.code + ':' + (e.atkSeq || 0);
    if (nc && ds >= 8 && ds <= 25 && dBrake < 120 && a.defT <= 0 &&
        !longitudinalBodiesOverlap(tr, e, a) &&
        ds >= 4.5 && a.state === 'run' && a._defSeenKey !== defKey){
      a._defSeenKey = defKey;
      a.defT = 4.0;
      if (Math.random() < 0.35 + a.lu.focus * 0.4){
        if (a._defMoveKey === defKey) S.defRepeatN = (S.defRepeatN || 0) + 1;
        a._defMoveKey = defKey;
        setTargetAbsLat(tr, a, nc.side * 2.8 * 0.8);
        a.defAbs = nc.side * 2.8 * 0.8;
        a.defCorner = nc.apexI;
        S.defMoveN = (S.defMoveN || 0) + 1;
      }
    }
    return;
  }
  if (ds < 45 && sep < 2.5) e.vCap = followCap(S, e, a, ds, 0.45);
  e.latTgt *= 0.92;
}
