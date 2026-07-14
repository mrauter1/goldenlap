#!/usr/bin/env node
'use strict';

// Characterization/acceptance harness for the follow-up plan. Each feature can
// be flipped independently: --accept pit,line,rights,priority. --mode
// acceptance is shorthand for accepting all four; baseline accepts none.
const path = require('path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const modeAt = args.indexOf('--mode');
const mode = modeAt >= 0 ? args[modeAt + 1] : 'baseline';
if (!['baseline', 'acceptance'].includes(mode)) {
  console.error('Usage: racecraft-followup-check.js [--mode baseline|acceptance] [--accept pit,line,rights,priority] [html]');
  process.exit(2);
}
const acceptAt = args.indexOf('--accept');
const summaryOnly = args.includes('--summary');
const accepted = new Set(mode === 'acceptance' ? ['pit', 'line', 'rights', 'priority'] :
  (acceptAt >= 0 ? args[acceptAt + 1].split(',').filter(Boolean) : []));
const html = args.find(arg => !arg.startsWith('--') && arg !== mode && !arg.includes(',')) || 'index.html';
const url = `file://${path.resolve(__dirname, '..', html)}`;

function featurePass(feature, baselineOutcome, acceptanceOutcome) {
  return accepted.has(feature) ? acceptanceOutcome : baselineOutcome;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    let t = 0xF0110;
    Math.random = () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__GL && window.__GL.G && window.__GL.BUILT);
  const result = await page.evaluate(() => {
    const GL = window.__GL;
    GL.pickTeam(0);
    GL.sheetAction('drv', { i: 0 }); GL.sheetAction('drv', { i: 1 });
    GL.sheetAction('eng', { i: 0 }); GL.sheetAction('chief', { i: 0 });
    GL.sheetAction('phil', { i: 0 }); GL.sheetAction('spon', { i: 0 });
    GL.sheetAction('startSeason');

    function beginRace(round) {
      GL.G.S = null;
      GL.G.round = round;
      GL.startWeekend();
      GL.qualiEnd();
      GL.sheetAction('startRace');
      const S = GL.S;
      S.phase = 'run'; S.goT = 0; S.t = 20; S.scale = 0;
      for (const entry of S.entries) if (entry.state === 'grid') entry.state = 'run';
      return S;
    }
    function beginQualifying(round) {
      GL.G.S = null;
      GL.G.round = round;
      GL.startWeekend();
      const S = GL.S;
      S.phase = 'run'; S.goT = 0; S.t = 20; S.scale = 0;
      return S;
    }
    function isolate(S, keep) {
      for (const entry of S.entries) {
        if (keep.includes(entry)) continue;
        entry.state = 'dnf'; entry.car = null;
      }
    }
    function place(S, entry, s, speed, lat, cross = 1) {
      const tr = S.trk;
      const sw = ((s % tr.len) + tr.len) % tr.len;
      const i = Math.round(sw / tr.step) % tr.n;
      const h = Math.atan2(tr.ty[i], tr.tx[i]);
      entry.car = GL.makeCar(tr.x[i] + tr.nx[i] * lat, tr.y[i] + tr.ny[i] * lat, h);
      entry.car.vx = speed; entry.car.s = sw; entry.car.progIdx = i;
      const pathOffset = entry.path && entry.path.off
        ? entry.path.off[i] : (tr.rline.off[i] || 0);
      entry.spd = speed; entry.lat = lat - pathOffset;
      entry.latTgt = entry.lat; entry.latNow = lat; entry.cross = cross;
      entry.prog = cross * tr.len + entry.car.s;
      entry.rlap.started = true;
      return i;
    }
    function setPitPose(S, entry, pitW, speed, lat) {
      const tr = S.trk, pit = tr.pit;
      const s = ((pit.sEntry + pitW) % tr.len + tr.len) % tr.len;
      place(S, entry, s, speed, lat, 1);
      entry.pitW = pitW; entry.car.s = s;
      entry.car.progIdx = Math.round(s / tr.step) % tr.n;
      const pathOffset = entry.path && entry.path.off
        ? entry.path.off[entry.car.progIdx] : (tr.rline.off[entry.car.progIdx] || 0);
      entry.latNow = lat; entry.lat = lat - pathOffset;
      entry.latTgt = entry.lat;
    }
    function recordCount(S, names) {
      for (const name of names) {
        const value = S[name];
        if (value instanceof Map || value instanceof Set) return value.size;
        if (Array.isArray(value)) return value.length;
        if (value && typeof value === 'object') return Object.keys(value).length;
      }
      return 0;
    }

    const line = GL.BUILT.map(B => {
      const tr = B.tr, samples = [], phases = [];
      let strict = 0;
      for (const corner of tr.corners) {
        const d = Math.max(1, Math.round(45 / tr.step));
        const entry = tr.rline.off[(corner.apexI - d + tr.n) % tr.n] * corner.side;
        const apex = tr.rline.off[corner.apexI] * corner.side;
        const exit = tr.rline.off[(corner.apexI + d) % tr.n] * corner.side;
        const ok = entry < -0.05 && apex > 0.05 && exit < -0.05;
        if (ok) strict++;
        samples.push({ entry, apex, exit, ok });
        const usable = tr.hw - GL.PHYS.carWid / 2 - 0.6;
        const semanticEntry = corner.side * tr.rline.off[corner.turnInI] / usable;
        const semanticApex = corner.side * tr.rline.off[corner.apexI] / usable;
        const semanticExit = corner.side * tr.rline.off[corner.trackOutI] / usable;
        const declaredError = Math.max(
          Math.abs(tr.rline.off[corner.turnInI] - corner.entryTarget),
          Math.abs(tr.rline.off[corner.apexI] - corner.apexTarget),
          Math.abs(tr.rline.off[corner.trackOutI] - corner.exitTarget)
        );
        const targetPass = corner.isolated
          ? semanticEntry <= -0.45 + 1e-9 && semanticApex >= 0.55 - 1e-9 &&
            semanticExit <= -0.35 + 1e-9
          : declaredError <= 1e-8 && !!corner.complexId;
        phases.push({
          id: corner.id,
          role: corner.planRole,
          complexId: corner.complexId,
          entry: semanticEntry,
          apex: semanticApex,
          exit: semanticExit,
          declaredError,
          targetPass
        });
      }
      const semantic = tr.corners.length > 0 && tr.corners.every(corner =>
        Number.isInteger(corner.turnInI) && Number.isInteger(corner.trackOutI) &&
        Number.isInteger(corner.regionStartI) && Number.isInteger(corner.regionEndI) &&
        typeof corner.id === 'string');
      const semanticStrict = semantic && phases.every(phase => phase.targetPass);
      return {
        id: B.def.id,
        corners: tr.corners.length,
        strict45m: strict,
        semantic,
        semanticStrict,
        profilePass: tr.rline.lapTime <= B.prof.lapTime + 1e-6,
        phases,
        samples
      };
    });

    function sampledPathFinite(path, n) {
      return !!path && path.off.length === n && path.k.length === n &&
        path.ds.length === n && path.v.length === n &&
        ['off', 'k', 'ds', 'v'].every(field =>
          Array.from(path[field]).every(value => Number.isFinite(value))) &&
        Array.from(path.ds).every(value => value > 0) &&
        Array.from(path.v).every(value => value >= 0);
    }
    function phasePathSnapshot(entry, track, corner) {
      const path = entry.path;
      const offsets = path
        ? [corner.turnInI, corner.apexI, corner.trackOutI].map(index => path.off[index])
        : [];
      return {
        mode: entry.pathMode || null,
        key: entry.pathPlan && entry.pathPlan.key || null,
        builds: entry.pathBuildN || 0,
        maxSlew: entry.pathMaxSlew || 0,
        finite: sampledPathFinite(path, track.n),
        offsets,
        apexSpeed: path ? path.v[corner.apexI] : null,
        inputFinite: Number.isFinite(entry.inp.steer) &&
          Number.isFinite(entry.inp.throttle) && Number.isFinite(entry.inp.brake)
      };
    }
    const pathModes = GL.BUILT.map((_, round) => {
      const PS = beginRace(round), ptr = PS.trk;
      const entry = PS.entries[0];
      isolate(PS, [entry]);
      const corner = ptr.corners.find(candidate => candidate.isolated) || ptr.corners[0];
      const approachS = corner.approachI * ptr.step;
      place(PS, entry, approachS, 30, ptr.rline.off[corner.approachI], 2);
      entry.state = 'run'; entry.atkT = 0; entry.defT = 0; entry.tuckT = 0;
      entry.avoidT = 0; entry.recT = 0; entry.car.offCourse = false;
      PS.trafT = 0;
      GL.stepSession(1 / 120);
      const idealMode = entry.pathMode === 'ideal' && !entry.path;

      entry.atkT = 3; entry.atkCorner = corner.apexI;
      entry.atkSide = corner.side * 2.8; entry.defT = 0; entry.tuckT = 0;
      PS.trafT = 0;
      GL.stepSession(1 / 120);
      const attack = phasePathSnapshot(entry, ptr, corner);
      const attackBuilds = entry.pathBuildN || 0;
      PS.trafT = 0;
      GL.stepSession(1 / 120);
      const attackCacheStable = (entry.pathBuildN || 0) === attackBuilds;

      entry.atkT = 0; entry.defT = 4; entry.defCorner = corner.apexI;
      entry.defAbs = corner.side * 2.2; entry.tuckT = 0;
      PS.trafT = 0;
      GL.stepSession(1 / 120);
      const defend = phasePathSnapshot(entry, ptr, corner);
      const defendBuilds = entry.pathBuildN || 0;
      PS.trafT = 0;
      GL.stepSession(1 / 120);
      const defendCacheStable = (entry.pathBuildN || 0) === defendBuilds;

      entry.defT = 0; entry.tuckT = 0.8; entry._tuckWith = 'TEST';
      PS.trafT = 0;
      GL.stepSession(1 / 120);
      const tuck = phasePathSnapshot(entry, ptr, corner);
      const tuckBuilds = entry.pathBuildN || 0;
      for (let tick = 0; tick < 36; tick++) GL.stepSession(1 / 120);
      const tuckCacheStable = (entry.pathBuildN || 0) === tuckBuilds;

      const differences = attack.offsets.map((value, index) => value - defend.offsets[index]);
      const phaseDiversity = differences.length === 3 &&
        Math.max(...differences) - Math.min(...differences) > 0.05;
      const attackShape = attack.offsets.length === 3 &&
        Math.max(...attack.offsets) - Math.min(...attack.offsets) > 0.05;
      const defendShape = defend.offsets.length === 3 &&
        Math.max(...defend.offsets) - Math.min(...defend.offsets) > 0.05;
      const tighterSpeed = attack.apexSpeed != null &&
        attack.apexSpeed <= ptr.rline.v[corner.apexI] + 1e-6;
      return {
        track: ptr.def.id,
        corner: corner.id,
        idealMode,
        attack,
        defend,
        tuck,
        attackCacheStable,
        defendCacheStable,
        tuckCacheStable,
        phaseDiversity,
        attackShape,
        defendShape,
        tighterSpeed,
        modeTime: entry.pathModeTime || null
      };
    });

    function placeIndex(session, entry, index, speed, lateral, longitudinal = 0, cross = 2) {
      const track = session.trk;
      const i = ((Math.round(index) % track.n) + track.n) % track.n;
      place(session, entry, i * track.step, speed, lateral, cross);
      entry.car.x += track.tx[i] * longitudinal;
      entry.car.y += track.ty[i] * longitudinal;
      entry.car.s = ((i * track.step + longitudinal) % track.len + track.len) % track.len;
      entry.prog = cross * track.len + entry.car.s;
      return i;
    }
    function betweenIndex(track, from, to, fraction) {
      const span = (to - from + track.n) % track.n;
      return (from + Math.max(0, Math.round(span * fraction))) % track.n;
    }
    function rightsFixture(side, isolated = true) {
      for (let round = 0; round < GL.BUILT.length; round++) {
        const corner = GL.BUILT[round].tr.corners.find(candidate =>
          candidate.side === side && (!isolated || candidate.isolated));
        if (corner) return { round, cornerId: corner.id };
      }
      throw new Error(`No ${side > 0 ? 'left' : 'right'} rights fixture`);
    }
    function firstRightsRecord(session) {
      return session.cornerRights instanceof Map
        ? session.cornerRights.values().next().value || null
        : null;
    }
    function pathRespectsAssignment(entry, assignment, corner) {
      if (!assignment || !entry.path || !sampledPathFinite(entry.path, entry.path.off.length))
        return false;
      return [corner.turnInI, corner.apexI, corner.trackOutI].every(index =>
        entry.path.off[index] >= assignment.minimum - 1e-6 &&
        entry.path.off[index] <= assignment.maximum + 1e-6);
    }
    function rightsMatrixTrial(side, wet, phase, attackerInside) {
      const fixture = rightsFixture(side);
      const session = beginRace(fixture.round), track = session.trk;
      const corner = track.corners.find(candidate => candidate.id === fixture.cornerId);
      const attacker = session.entries[0], defender = session.entries[1];
      isolate(session, [attacker, defender]);
      session.wet = wet;
      const index = phase === 'approach'
        ? betweenIndex(track, corner.approachI, corner.brakeI, 0.35)
        : betweenIndex(track, corner.brakeI, corner.turnInI, 0.5);
      const attackerLateral = (attackerInside ? 1 : -1) * corner.side;
      placeIndex(session, attacker, index, 32, attackerLateral, -1);
      placeIndex(session, defender, index, 31, -attackerLateral, 1);
      attacker.atkT = 3; attacker.atkCorner = corner.apexI;
      attacker.atkSide = corner.side * 2.8;
      defender.defT = 4; defender.defCorner = corner.apexI;
      defender.defAbs = corner.side * 2.2;
      const hitsAtStart = session.hitN || 0;
      session.trafT = 0;
      GL.stepSession(1 / 120);
      const record = firstRightsRecord(session);
      const assignments = session.cornerRightsAssignments;
      const insideCode = attackerInside ? attacker.code : defender.code;
      const outsideCode = attackerInside ? defender.code : attacker.code;
      const insideAssignment = assignments instanceof Map ? assignments.get(insideCode) : null;
      const outsideAssignment = assignments instanceof Map ? assignments.get(outsideCode) : null;
      const acquired = !!record && session.cornerRights.size === 1;
      const initial = {
        phase: record && record.acquiredPhase,
        rolesCorrect: !!record && record.inside.code === insideCode &&
          record.outside.code === outsideCode,
        defenseCancelled: !!record && record.defenseCancelled && defender.defT === 0,
        separation: record && record.requiredSeparation,
        targetSeparation: record && corner.side *
          (record.insideTarget - record.outsideTarget),
        assignments: assignments instanceof Map ? assignments.size : 0,
        pathSafe: pathRespectsAssignment(
          attackerInside ? attacker : defender, insideAssignment, corner
        ) && pathRespectsAssignment(
          attackerInside ? defender : attacker, outsideAssignment, corner
        ),
        modes: [attacker.pathMode, defender.pathMode].sort(),
        maxSlew: Math.max(attacker.pathMaxSlew || 0, defender.pathMaxSlew || 0)
      };
      const key = record && record.key;
      attacker.atkT = 0; defender.defT = 0;
      const flipIndex = betweenIndex(track, corner.turnInI, corner.apexI, 0.6);
      placeIndex(session, attacker, flipIndex, 31, attackerLateral, 1);
      placeIndex(session, defender, flipIndex, 32, -attackerLateral, -1);
      session.trafT = 0;
      GL.stepSession(1 / 120);
      const after = key && session.cornerRights instanceof Map
        ? session.cornerRights.get(key) : null;
      const afterAssignments = session.cornerRightsAssignments;
      const afterInside = afterAssignments instanceof Map
        ? afterAssignments.get(insideCode) : null;
      const afterOutside = afterAssignments instanceof Map
        ? afterAssignments.get(outsideCode) : null;
      const hitPair = session.hitPairs && key ? session.hitPairs[key] : null;
      return {
        track: track.def.id,
        corner: corner.id,
        side,
        wet,
        phase,
        attackerInside,
        bodyOverlap: acquired && Math.abs(record.inside.car.s - record.outside.car.s) <
          GL.PHYS.carLen,
        exactLateralSeparation: 2,
        acquired,
        initial,
        survivedOrderFlip: !!after && session.cornerRights.size === 1,
        rolesStable: !!after && after.inside.code === insideCode &&
          after.outside.code === outsideCode,
        timersExpired: attacker.atkT === 0 && defender.defT === 0,
        targetSafe: !!after && corner.side *
          (after.insideTarget - after.outsideTarget) >= after.requiredSeparation - 1e-6,
        pathSafe: pathRespectsAssignment(
          attackerInside ? attacker : defender, afterInside, corner
        ) && pathRespectsAssignment(
          attackerInside ? defender : attacker, afterOutside, corner
        ),
        violations: after ? after.violationCount || 0 : null,
        contacts: (session.hitN || 0) - hitsAtStart,
        hardContacts: hitPair ? hitPair.hard : 0
      };
    }
    const rightsMatrix = [];
    for (const side of [-1, 1])
      for (const wet of [0, 0.7])
        for (const phase of ['approach', 'brake'])
          for (const attackerInside of [false, true])
            rightsMatrix.push(rightsMatrixTrial(side, wet, phase, attackerInside));

    function physicalRightsTrial(round, wet) {
      const session = beginRace(round), track = session.trk;
      const corner = track.corners.find(candidate => candidate.isolated) || track.corners[0];
      const inside = session.entries[0], outside = session.entries[1];
      isolate(session, [inside, outside]);
      session.wet = wet;
      session.raining = false;
      session.rainAt = Infinity;
      const startIndex = corner.brakeI;
      const baseSpeed = Math.max(18, Math.min(29, track.rline.v[startIndex] + 2));
      placeIndex(session, inside, startIndex, baseSpeed + 1.5, corner.side * 1.7, -1);
      placeIndex(session, outside, startIndex, baseSpeed, -corner.side * 1.7, 1);
      for (const entry of [inside, outside]) {
        entry.pitArm = null; entry.boxArm = false; entry.hFail = false;
        entry.mistT = 1e6; entry.liftT = 0; entry.avoidT = 0; entry.recT = 0;
        entry.stress = 0; entry.fuel = 1;
        entry.tyre.c = wet > 0.42 ? 'W' : 'S';
        entry.tyre.wear = 0;
      }
      inside.atkT = 3; inside.atkCorner = corner.apexI;
      inside.atkSide = corner.side * 2.8;
      outside.defT = 4; outside.defCorner = corner.apexI;
      outside.defAbs = corner.side * 2.2;
      const startProgress = 2 * track.len + startIndex * track.step;
      const trackOutProgress = startProgress +
        ((corner.trackOutI - startIndex + track.n) % track.n) * track.step;
      const hitsAtStart = session.hitN || 0;
      session.trafT = 0;
      GL.stepSession(1 / 120);
      const acquiredRecord = firstRightsRecord(session);
      const key = acquiredRecord && acquiredRecord.key;
      let minimumSeparation = Infinity;
      let prematureDrop = false;
      let bothPassedTrackOut = false;
      let targetSafe = true;
      let pathSafe = true;
      let offCourse = false;
      let drivenTicks = 0;
      for (; drivenTicks < 3000; drivenTicks++) {
        GL.stepSession(1 / 120);
        minimumSeparation = Math.min(
          minimumSeparation,
          Math.abs(inside.latNow - outside.latNow)
        );
        offCourse ||= inside.car.offCourse || outside.car.offCourse;
        bothPassedTrackOut = inside.prog >= trackOutProgress &&
          outside.prog >= trackOutProgress;
        const record = key && session.cornerRights instanceof Map
          ? session.cornerRights.get(key) : null;
        if (!record && !bothPassedTrackOut) prematureDrop = true;
        if (record) {
          targetSafe &&= corner.side *
            (record.insideTarget - record.outsideTarget) >=
              record.requiredSeparation - 1e-6;
          const assignments = session.cornerRightsAssignments;
          const insideAssignment = assignments instanceof Map
            ? assignments.get(record.inside.code) : null;
          const outsideAssignment = assignments instanceof Map
            ? assignments.get(record.outside.code) : null;
          pathSafe &&= pathRespectsAssignment(record.inside, insideAssignment, corner) &&
            pathRespectsAssignment(record.outside, outsideAssignment, corner);
        }
        if (bothPassedTrackOut) break;
      }

      // Once the driven corner is complete, establish unambiguous physical
      // clearance on the exit and let the normal 30 Hz traffic cadence own
      // the required 0.5-second release hold.
      const releaseIndex = (corner.trackOutI + Math.ceil(25 / track.step)) % track.n;
      placeIndex(session, inside, releaseIndex, 22, inside.latNow, -5);
      placeIndex(session, outside, releaseIndex, 22, outside.latNow, 5);
      let releaseTicks = 0;
      for (; releaseTicks < 180 && session.cornerRights && session.cornerRights.size; releaseTicks++)
        GL.stepSession(1 / 120);
      const history = (session.cornerRightsHistory || []).find(item => item.key === key);
      const released = !!history && history.release === 'track-out-clear';
      const rejoinModes = [inside.pathMode, outside.pathMode];
      let rejoinTicks = 0;
      for (; rejoinTicks < 1800 &&
          (inside.pathMode !== 'ideal' || outside.pathMode !== 'ideal'); rejoinTicks++)
        GL.stepSession(1 / 120);
      const hitPair = session.hitPairs && key ? session.hitPairs[key] : null;
      const finalState = [inside, outside].map(entry => {
        const plan = entry.pathPlan;
        const first = plan && plan.anchors && plan.anchors[0];
        const last = plan && plan.anchors && plan.anchors[plan.anchors.length - 1];
        const index = Math.max(0, entry.car.progIdx);
        return {
          code: entry.code,
          state: entry.state,
          mode: entry.pathMode,
          key: plan && plan.key,
          speed: entry.spd,
          index,
          offCourse: entry.car.offCourse,
          recovery: entry.recT,
          firstAnchor: first ? first.index : null,
          lastAnchor: last ? last.index : null,
          fromFirst: first ? ((index - first.index + track.n) % track.n) * track.step : null,
          planSpan: first && last
            ? ((last.index - first.index + track.n) % track.n) * track.step : null
        };
      });
      return {
        track: track.def.id,
        corner: corner.id,
        wet,
        acquired: !!acquiredRecord,
        drivenThroughTrackOut: bothPassedTrackOut,
        drivenSeconds: drivenTicks / 120,
        prematureDrop,
        minimumSeparation: Number.isFinite(minimumSeparation) ? minimumSeparation : null,
        targetSafe,
        pathSafe,
        offCourse,
        violations: history ? history.violations || 0 :
          acquiredRecord ? acquiredRecord.violationCount || 0 : null,
        released,
        releaseSeconds: releaseTicks / 120,
        releaseReason: history ? history.release : null,
        rejoinModes,
        rejoinedIdeal: inside.pathMode === 'ideal' && outside.pathMode === 'ideal',
        rejoinSeconds: rejoinTicks / 120,
        finalState: inside.pathMode === 'ideal' && outside.pathMode === 'ideal'
          ? undefined : finalState,
        maxSlew: Math.max(inside.pathMaxSlew || 0, outside.pathMaxSlew || 0),
        contacts: (session.hitN || 0) - hitsAtStart,
        hardContacts: hitPair ? hitPair.hard : 0
      };
    }
    const physicalRights = [];
    for (let round = 0; round < GL.BUILT.length; round++)
      for (const wet of [0, 0.7]) physicalRights.push(physicalRightsTrial(round, wet));

    function linkedRightsTrial() {
      let selected = null;
      for (let round = 0; round < GL.BUILT.length && !selected; round++) {
        const track = GL.BUILT[round].tr;
        for (const first of track.corners) {
          if (!first.complexId) continue;
          const next = track.corners
            .filter(candidate => candidate.id !== first.id &&
              candidate.complexId === first.complexId)
            .map(candidate => ({ candidate, distance:
              ((candidate.turnInI - first.trackOutI + track.n) % track.n) * track.step }))
            .filter(value => value.distance > 0.5 && value.distance < track.len / 2)
            .sort((left, right) => left.distance - right.distance)[0];
          if (next) { selected = { round, firstId: first.id, nextId: next.candidate.id }; break; }
        }
      }
      if (!selected) throw new Error('No linked rights fixture');
      const session = beginRace(selected.round), track = session.trk;
      const first = track.corners.find(candidate => candidate.id === selected.firstId);
      const inside = session.entries[0], outside = session.entries[1];
      isolate(session, [inside, outside]);
      placeIndex(session, inside, first.brakeI, 31, first.side, -1);
      placeIndex(session, outside, first.brakeI, 31, -first.side, 1);
      inside.atkT = 3; inside.atkCorner = first.apexI;
      session.trafT = 0; GL.stepSession(1 / 120);
      const record = firstRightsRecord(session);
      const key = record && record.key;
      const afterTrackOut = (first.trackOutI + 1) % track.n;
      placeIndex(session, inside, afterTrackOut, 31, inside.latNow, -1);
      placeIndex(session, outside, afterTrackOut, 31, outside.latNow, 1);
      session.trafT = 0; GL.stepSession(1 / 120);
      const after = key && session.cornerRights.get(key);
      return {
        track: track.def.id,
        first: first.id,
        next: selected.nextId,
        acquired: !!record,
        retained: session.cornerRights.size === 1 && !!after,
        handedToNext: !!after && after.cornerId === selected.nextId,
        handoffs: after ? after.handoffs || 0 : 0,
        historyEmpty: !session.cornerRightsHistory || session.cornerRightsHistory.length === 0,
        violations: after ? after.violationCount || 0 : null
      };
    }

    function noOverlapTuckTrial() {
      const fixture = rightsFixture(1);
      const session = beginRace(fixture.round), track = session.trk;
      const corner = track.corners.find(candidate => candidate.id === fixture.cornerId);
      const attacker = session.entries[0], leader = session.entries[1];
      isolate(session, [attacker, leader]);
      placeIndex(session, attacker, corner.turnInI, 31, corner.side, 0);
      placeIndex(session, leader, corner.turnInI, 30, -corner.side, 9);
      attacker.atkT = 3; attacker.atkCorner = corner.apexI;
      session.trafT = 0; GL.stepSession(1 / 120);
      return {
        track: track.def.id,
        corner: corner.id,
        rights: recordCount(session, ['cornerRights']),
        attackCancelled: attacker.atkT === 0 && attacker.atkCorner === -1,
        tucked: attacker.tuckT > 0 && attacker._tuckWith === leader.code &&
          attacker.pathMode === 'tuck',
        attackerState: {
          atkT: attacker.atkT,
          atkCorner: attacker.atkCorner,
          atkCd: attacker.atkCd,
          tuckT: attacker.tuckT,
          tuckWith: attacker._tuckWith || null,
          tuckCorner: attacker._tuckCorner,
          pathMode: attacker.pathMode,
          leader: leader.code,
          attackerIndex: attacker.car.progIdx,
          leaderIndex: leader.car.progIdx
        }
      };
    }

    function threeWideRightsTrial(feasible) {
      const fixture = rightsFixture(-1);
      const session = beginRace(fixture.round), track = session.trk;
      const corner = track.corners.find(candidate => candidate.id === fixture.cornerId);
      const front = session.entries[0], middle = session.entries[1], rear = session.entries[2];
      isolate(session, [front, middle, rear]);
      const lateral = feasible
        ? [-2 * corner.side, 0, 2 * corner.side]
        : [-0.4 * corner.side, 0, 0.4 * corner.side];
      placeIndex(session, front, corner.brakeI, 31, lateral[0], 1);
      placeIndex(session, middle, corner.brakeI, 31, lateral[1], 0);
      placeIndex(session, rear, corner.brakeI, 31, lateral[2], -1);
      rear.atkT = 3; rear.atkCorner = corner.apexI;
      session.trafT = 0; GL.stepSession(1 / 120);
      const assignments = session.cornerRightsAssignments instanceof Map
        ? [...session.cornerRightsAssignments.values()] : [];
      const assignedCodes = assignments.map(assignment => assignment.code);
      const targets = assignments.map(assignment => corner.side * assignment.target)
        .sort((left, right) => left - right);
      return {
        track: track.def.id,
        corner: corner.id,
        feasible,
        assignments: assignments.length,
        targetGaps: targets.slice(1).map((target, index) => target - targets[index]),
        fallbackCount: session.cornerRightsThreeCarFallbacks || 0,
        rearTucked: rear.tuckT > 0 && rear.pathMode === 'tuck' &&
          assignedCodes.includes(rear._tuckWith) && rear._tuckWith !== rear.code,
        rearState: {
          tuckT: rear.tuckT,
          tuckWith: rear._tuckWith || null,
          assignedCodes,
          pathMode: rear.pathMode,
          atkT: rear.atkT,
          atkCorner: rear.atkCorner
        },
        livePairs: recordCount(session, ['cornerRights']),
        fallbackReleases: (session.cornerRightsHistory || [])
          .filter(item => item.release === 'three-car-tuck').length,
        violations: session.cornerRightsViolations || 0
      };
    }
    const linkedRights = linkedRightsTrial();
    const noOverlapTuck = noOverlapTuckTrial();
    const threeWideRights = [threeWideRightsTrial(true), threeWideRightsTrial(false)];
    const rights = { matrix: rightsMatrix, physical: physicalRights, linked: linkedRights,
      noOverlapTuck, threeWide: threeWideRights };

    function pitTrial(round, targetTeam, stoppedTeam, blocked) {
      const PS = beginRace(round), ptr = PS.trk, pit = ptr.pit;
      const traveller = PS.entries.find(entry => entry.ti === targetTeam) || PS.entries[0];
      const stopped = PS.entries.find(entry => entry !== traveller && entry.ti === stoppedTeam) || PS.entries[1];
      const field = PS.entries.find(entry => entry !== traveller && entry !== stopped) || PS.entries[2];
      isolate(PS, blocked ? [traveller, stopped, field] : [traveller, field]);
      const stoppedW = pit.boxWAt(stopped.ti);
      const targetW = pit.boxWAt(targetTeam);
      const ingressW = targetW - Math.max(3.8, 10 - GL.PHYS.carLen - 0.4);
      const checkpointW = Math.min(stoppedW + 7, ingressW - 1);
      const startW = Math.max(2, Math.min(stoppedW - 24, checkpointW - 28));
      traveller.state = 'pitIn'; traveller.ti = targetTeam;
      traveller.pitArm = { comp: 'H', fix: false }; traveller.pitPhase = 'travel';
      setPitPose(PS, traveller, startW, 15, pit.off(startW));
      if (blocked) {
        stopped.state = 'pit'; stopped.pitPhase = 'stopped-box'; stopped.pitT = 1e6;
        setPitPose(PS, stopped, stoppedW, 0, pit.boxOff);
        stopped.spd = 0; stopped.car.vx = 0;
      }
      field.state = 'run';
      place(PS, field, pit.sExit + 250, 28, 0, 1);
      const checkpoints = [];
      for (let part = 1; part <= 5; part++)
        checkpoints.push(startW + (checkpointW - startW) * part / 5);
      const checkpointTimes = checkpoints.map(() => null);
      let minSpeed = traveller.spd, minCap = Infinity, maxW = traveller.pitW;
      let passedAt = null, stalledFor = 0;
      for (let tick = 0; tick < 1800 && traveller.car && traveller.state !== 'dnf'; tick++) {
        GL.stepSession(1 / 120);
        minSpeed = Math.min(minSpeed, traveller.spd);
        if (Number.isFinite(traveller.trafCap)) minCap = Math.min(minCap, traveller.trafCap);
        maxW = Math.max(maxW, Number.isFinite(traveller.pitW) ? traveller.pitW : maxW);
        if (traveller.spd < 0.35) stalledFor += 1 / 120;
        for (let index = 0; index < checkpoints.length; index++)
          if (checkpointTimes[index] == null && Number.isFinite(traveller.pitW) &&
              traveller.pitW >= checkpoints[index]) checkpointTimes[index] = tick / 120;
        if (passedAt == null && Number.isFinite(traveller.pitW) && traveller.pitW >= checkpointW)
          passedAt = tick / 120;
        if (passedAt != null) break;
      }
      return {
        track: ptr.def.id,
        targetTeam,
        stoppedTeam,
        targetW,
        stoppedW,
        stoppedCode: stopped.code,
        startW,
        checkpointW,
        checkpointTimes,
        maxW,
        passed: passedAt != null,
        passedAt,
        minSpeed,
        minCap: Number.isFinite(minCap) ? minCap : null,
        stalledFor,
        waitReason: traveller.pitWaitReason || traveller.waitReason || null,
        leader: traveller.pitTrafficLeader || traveller.trafficLeader || null
      };
    }
    const pit = [];
    for (let round = 0; round < GL.BUILT.length; round++) {
      const track = GL.BUILT[round].def.id;
      const failures = [];
      let maximumDelay = 0, minimumCap = Infinity, minimumSpeed = Infinity, trials = 0;
      for (let targetTeam = 0; targetTeam < GL.TEAM_DEFS.length; targetTeam++) {
        for (let stoppedTeam = 0; stoppedTeam < GL.TEAM_DEFS.length; stoppedTeam++) {
          if (targetTeam === stoppedTeam) continue;
          trials++;
          const blocked = pitTrial(round, targetTeam, stoppedTeam, true);
          const control = pitTrial(round, targetTeam, stoppedTeam, false);
          let trialDelay = 0;
          for (let index = 0; index < blocked.checkpointTimes.length; index++) {
            const blockedAt = blocked.checkpointTimes[index];
            const controlAt = control.checkpointTimes[index];
            if (blockedAt == null || controlAt == null) trialDelay = Infinity;
            else trialDelay = Math.max(trialDelay, blockedAt - controlAt);
          }
          maximumDelay = Math.max(maximumDelay, trialDelay);
          minimumSpeed = Math.min(minimumSpeed, blocked.minSpeed);
          if (blocked.minCap != null) minimumCap = Math.min(minimumCap, blocked.minCap);
          if (!blocked.passed || !Number.isFinite(trialDelay) || trialDelay > 0.25 ||
              blocked.stalledFor > 0.25 || (blocked.minCap != null && blocked.minCap < 0) ||
              blocked.leader === blocked.stoppedCode) {
            failures.push({
              targetTeam, stoppedTeam, passed: blocked.passed, delay: trialDelay,
              stalledFor: blocked.stalledFor, minCap: blocked.minCap,
              waitReason: blocked.waitReason, leader: blocked.leader
            });
          }
        }
      }
      pit.push({ track, trials, maximumDelay, minimumSpeed,
        minimumCap: Number.isFinite(minimumCap) ? minimumCap : null, failures });
    }

    function doubleStackTrial(round) {
      const DS = beginRace(round), dtr = DS.trk, pit = dtr.pit;
      const first = DS.entries.find(entry => entry.ti === 2) || DS.entries[0];
      const second = DS.entries.find(entry => entry !== first && entry.ti === first.ti) || DS.entries[1];
      const field = DS.entries.find(entry => entry !== first && entry !== second) || DS.entries[2];
      isolate(DS, [first, second, field]);
      const boxW = pit.boxWAt(first.ti);
      first.state = 'pit'; first.pitPhase = 'stopped-box'; first.pitT = 7; first.stops = 1;
      setPitPose(DS, first, boxW, 0, pit.boxOff); first.spd = 0; first.car.vx = 0;
      second.state = 'pitIn'; second.pitPhase = 'travel'; second.pitArm = { comp: 'H', fix: false };
      setPitPose(DS, second, boxW - 24, 10, pit.off(boxW - 24));
      field.state = 'run'; place(DS, field, pit.sExit + 260, 27, 0, 1);
      const hitsAtStart = DS.hitN || 0;
      let queued = false, queueLaneClear = true, finishedAt = null;
      let minimumQueueClearance = Infinity, firstQueuePose = null;
      let observedHits = hitsAtStart;
      const contactDetails = [];
      for (let tick = 0; tick < 9600; tick++) {
        GL.stepSession(1 / 120);
        const currentHits = DS.hitN || 0;
        if (currentHits > observedHits) {
          contactDetails.push({
            time: DS.t,
            first: { code: first.code, state: first.state, phase: first.pitPhase || null,
              w: first.pitW, lat: first.latNow, speed: first.spd },
            second: { code: second.code, state: second.state, phase: second.pitPhase || null,
              w: second.pitW, lat: second.latNow, speed: second.spd },
            field: { code: field.code, state: field.state, phase: field.pitPhase || null,
              w: field.pitW, lat: field.latNow, speed: field.spd },
            hitPairs: DS.hitPairs || null
          });
          observedHits = currentHits;
        }
        if (second.pitPhase === 'queued') {
          queued = true;
          if (Number.isFinite(second.pitW)) {
            const clearance = Math.abs(second.latNow - pit.off(second.pitW));
            minimumQueueClearance = Math.min(minimumQueueClearance, clearance);
            if (!firstQueuePose) firstQueuePose = {
              w: second.pitW,
              lat: second.latNow,
              lane: pit.off(second.pitW),
              targetW: second.pitQueueW,
              targetOff: second.pitQueueOff
            };
            if (clearance < 2.15) queueLaneClear = false;
          }
        }
        if (first.state === 'run' && second.state === 'run' && second.stops >= 1) {
          finishedAt = tick / 120; break;
        }
      }
      return {
        track: dtr.def.id,
        queued,
        queueLaneClear,
        minimumQueueClearance: Number.isFinite(minimumQueueClearance) ? minimumQueueClearance : null,
        firstQueuePose,
        bothServiced: first.stops >= 1 && second.stops >= 1,
        rejoined: finishedAt != null,
        finishedAt,
        contacts: (DS.hitN || 0) - hitsAtStart,
        contactDetails,
        deadlocks: DS.pitDeadlocks || [],
        final: [first.state, second.state]
      };
    }

    function mergeTrial(round) {
      const MS = beginRace(round), mtr = MS.trk, pit = mtr.pit;
      const exiting = MS.entries[0], road = MS.entries[1];
      isolate(MS, [exiting, road]);
      const holdW = pit.Lp - pit.rampOut - 4;
      exiting.state = 'pitOut'; exiting.pitPhase = 'merge'; exiting.pitW = holdW - 24;
      setPitPose(MS, exiting, exiting.pitW, 10, pit.off(exiting.pitW));
      road.state = 'run'; place(MS, road, pit.sExit - 85, 31, 0, 1);
      const hitsAtStart = MS.hitN || 0;
      let waited = false, rejoinedAt = null;
      for (let tick = 0; tick < 3600; tick++) {
        GL.stepSession(1 / 120);
        if (exiting.pitWaitReason === 'merge-traffic') waited = true;
        if (exiting.state === 'run') { rejoinedAt = tick / 120; break; }
      }
      return {
        track: mtr.def.id,
        waited,
        rejoined: rejoinedAt != null,
        rejoinedAt,
        contacts: (MS.hitN || 0) - hitsAtStart,
        deadlocks: MS.pitDeadlocks || []
      };
    }
    const doubleStack = GL.BUILT.map((_, round) => doubleStackTrial(round));
    const merge = GL.BUILT.map((_, round) => mergeTrial(round));

    function cyclicWindow(track, index, from, to) {
      const span = (to - from + track.n) % track.n;
      const position = (index - from + track.n) % track.n;
      return position <= span;
    }
    function priorityPhaseIndex(track, corner, phase) {
      if (phase === 'approach') {
        const index = betweenIndex(track, corner.approachI, corner.turnInI, 0.35);
        return GL.nextCorner(track, index)?.id === corner.id ? index : null;
      }
      if (phase === 'corner') {
        const index = betweenIndex(track, corner.turnInI, corner.apexI, 0.35);
        return GL.nextCorner(track, index)?.id === corner.id ? index : null;
      }
      for (let distance = 70; distance <= 220; distance += 10) {
        const index = (corner.approachI - Math.round(distance / track.step) + track.n) % track.n;
        const protectedPhase = track.corners.some(candidate =>
          cyclicWindow(track, index, candidate.approachI, candidate.trackOutI));
        if (!protectedPhase && GL.nextCorner(track, index)?.id === corner.id) return index;
      }
      return null;
    }
    function priorityFixture(side, phase, minimumPitDistance = 0) {
      for (let round = 0; round < GL.BUILT.length; round++) {
        const track = GL.BUILT[round].tr;
        for (const corner of track.corners) {
          if (corner.side !== side) continue;
          const index = priorityPhaseIndex(track, corner, phase);
          if (index == null) continue;
          const distanceToPit =
            (track.pit.sEntry - index * track.step + track.len) % track.len;
          if (distanceToPit < minimumPitDistance) continue;
          return { round, cornerId: corner.id, index };
        }
      }
      throw new Error(`No priority ${phase}/${side} fixture`);
    }
    function findPriorityFixtureForRound(round, phase, minimumPitDistance = 0) {
      const track = GL.BUILT[round].tr;
      const preferredSide = round % 2 === 0 ? 1 : -1;
      const corners = [...track.corners].sort((left, right) =>
        Number(right.isolated) - Number(left.isolated) ||
        Number(right.side === preferredSide) - Number(left.side === preferredSide) ||
        left.apexI - right.apexI
      );
      for (const corner of corners) {
        const index = priorityPhaseIndex(track, corner, phase);
        if (index == null) continue;
        const distanceToPit =
          (track.pit.sEntry - index * track.step + track.len) % track.len;
        if (distanceToPit < minimumPitDistance) continue;
        return { round, cornerId: corner.id, index };
      }
      return null;
    }
    function priorityFixtureForRound(round, phase, minimumPitDistance = 0) {
      const fixture = findPriorityFixtureForRound(round, phase, minimumPitDistance);
      if (fixture) return fixture;
      throw new Error(`No round ${round} priority ${phase} fixture`);
    }
    function firstPriorityRecord(session) {
      return session.priorityRecords instanceof Map
        ? session.priorityRecords.values().next().value || null : null;
    }
    function stabilizePriorityEntry(entry) {
      entry.state = 'run'; entry.pitArm = null; entry.boxArm = false;
      entry.hFail = false; entry.cFail = false; entry.mistT = 1e6;
      entry.liftT = 0; entry.avoidT = 0; entry.recT = 0;
      entry.stress = 0; entry.fuel = 1; entry.tyre.wear = 0;
      entry.focusNow = 1; entry.flow = Array(14).fill(0);
      entry.botTick = 0; entry.vCap = Infinity; entry.trafCap = Infinity;
      entry.yieldT = 0; entry.concedeT = 0;
      entry.atkT = 0; entry.atkCorner = -1; entry.atkCd = 0;
      entry.defT = 0; entry.defCorner = -1; entry.lungeT = 0;
      entry.tow = 0; entry.tuckT = 0;
      delete entry.path;
      entry.pathPlan = { mode: 'ideal', key: 'ideal' };
      entry.pathMode = 'ideal'; entry.pathBuildN = 0; entry.pathMaxSlew = 0;
      entry.pathModeTime = {};
      if (entry.car) entry.car.offCourse = false;
    }
    function configurePriorityPhases(kind, beneficiary, yielding, yieldingPhase) {
      if (kind === 'blue') return;
      beneficiary.lapPhase = 'flying'; beneficiary.lapLive = true;
      beneficiary.boxArm = false;
      yielding.lapPhase = yieldingPhase; yielding.lapLive = false;
      yielding.boxArm = yieldingPhase === 'in';
    }
    function preparePriorityScenario(options) {
      const { kind, phase, side, wet, yieldingPhase = 'out', gap = 42,
        offLine = false } = options;
      const minimumPitDistance = kind === 'quali' && yieldingPhase === 'in' ? 220 : 0;
      const fixture = Number.isInteger(options.round)
        ? priorityFixtureForRound(options.round, phase, minimumPitDistance)
        : priorityFixture(side, phase, minimumPitDistance);
      const session = kind === 'blue'
        ? beginRace(fixture.round) : beginQualifying(fixture.round);
      const track = session.trk;
      const corner = track.corners.find(candidate => candidate.id === fixture.cornerId);
      const beneficiary = session.entries[0], yielding = session.entries[1];
      isolate(session, [beneficiary, yielding]);
      session.wet = wet;
      if (session.mode === 'race') {
        session.raining = false; session.rainAt = Infinity; session.rainEnd = -1;
      }
      stabilizePriorityEntry(beneficiary); stabilizePriorityEntry(yielding);
      beneficiary.tyre.c = wet > 0.42 ? 'W' : 'S';
      yielding.tyre.c = wet > 0.42 ? 'W' : 'S';
      session.evo = 0;
      const yieldingS = fixture.index * track.step;
      const yieldingLateral = offLine
        ? track.hw - 2.1 : track.rline.off[fixture.index];
      const beneficiaryS = yieldingS - GL.PHYS.carLen - gap;
      const beneficiaryIndex =
        ((Math.round(beneficiaryS / track.step) % track.n) + track.n) % track.n;
      place(session, yielding, yieldingS, 28, yieldingLateral, 1);
      place(session, beneficiary, beneficiaryS, 36,
        track.rline.off[beneficiaryIndex], kind === 'blue' ? 2 : 1);
      configurePriorityPhases(kind, beneficiary, yielding, yieldingPhase);
      yielding.atkT = 3; yielding.atkCorner = corner.apexI;
      yielding.defT = 3; yielding.defCorner = corner.apexI;
      yielding.lungeT = 1; yielding.tow = 0.7;
      return { session, track, corner, index: fixture.index, beneficiary, yielding,
        gap, kind, phase, side, wet, yieldingPhase };
    }
    function plannedPrioritySeparation(prepared) {
      const { track, index, beneficiary, yielding, gap } = prepared;
      const beneficiaryPath = beneficiary.path || track.rline;
      const yieldingPath = yielding.path || track.rline;
      let lastOrder = 0, crossings = 0, minimumSeparated = Infinity;
      for (let distance = 0; distance <= 240; distance += Math.max(2, track.step * 3)) {
        const sample = (index + Math.round(distance / track.step)) % track.n;
        const difference = beneficiaryPath.off[sample] - yieldingPath.off[sample];
        if (Math.abs(difference) >= 0.25) {
          const order = Math.sign(difference);
          if (lastOrder && order !== lastOrder) crossings++;
          lastOrder = order;
          minimumSeparated = Math.min(minimumSeparated, Math.abs(difference));
        }
      }
      const catchDistance = 28 * gap / 8;
      const catchIndex = (index + Math.round(catchDistance / track.step)) % track.n;
      const separationAtOverlap = Math.abs(
        beneficiaryPath.off[catchIndex] - yieldingPath.off[catchIndex]
      );
      return {
        crossings,
        minimumSeparated: Number.isFinite(minimumSeparated) ? minimumSeparated : 0,
        separationAtOverlap,
        clearBeforeOverlap: separationAtOverlap >= GL.PHYS.carWid + 0.2
      };
    }
    function staticPriorityTrial(options) {
      const prepared = preparePriorityScenario(options);
      const { session, track, corner, beneficiary, yielding, kind, phase, side, wet,
        yieldingPhase } = prepared;
      session.trafT = 0;
      GL.stepSession(1 / 120);
      const record = firstPriorityRecord(session);
      const firstYieldSide = record && record.yieldSide;
      const firstPathKey = yielding.pathPlan && yielding.pathPlan.key;
      const planned = plannedPrioritySeparation(prepared);
      session.trafT = 0;
      GL.stepSession(1 / 120);
      const after = firstPriorityRecord(session);
      return {
        kind, phase, side, wet, yieldingPhase,
        track: track.def.id, corner: corner.id,
        records: recordCount(session, ['priorityRecords']),
        reason: record && record.reason,
        beneficiary: record && record.beneficiary.code,
        detectedPhase: record && record.detectedPhase,
        yieldSide: firstYieldSide,
        stableYieldSide: !!record && !!after && after.yieldSide === firstYieldSide,
        stableRecord: !!record && !!after && after.key === record.key,
        stablePath: !!firstPathKey && yielding.pathPlan && yielding.pathPlan.key === firstPathKey,
        yieldingMode: yielding.pathMode,
        beneficiaryMode: beneficiary.pathMode,
        yieldingPathFinite: sampledPathFinite(yielding.path, track.n),
        beneficiaryPathFinite: sampledPathFinite(beneficiary.path, track.n),
        decisionsSuppressed: yielding.atkT === 0 && yielding.defT === 0 &&
          yielding.lungeT === 0 && yielding.tow === 0,
        illegalDecisions: session.priorityIllegalDecisions || 0,
        pathCrossings: planned.crossings,
        separationAtOverlap: planned.separationAtOverlap,
        clearBeforeOverlap: phase !== 'straight' || planned.clearBeforeOverlap,
        maxSlew: Math.max(yielding.pathMaxSlew || 0, beneficiary.pathMaxSlew || 0),
        offCourse: yielding.car.offCourse || beneficiary.car.offCourse
      };
    }
    const blueMatrix = [];
    for (const side of [-1, 1])
      for (const wet of [0, 0.7])
        for (const phase of ['straight', 'approach', 'corner'])
          blueMatrix.push(staticPriorityTrial({ kind: 'blue', side, wet, phase }));
    const qualifyingMatrix = [];
    for (const side of [-1, 1])
      for (const yieldingPhase of ['out', 'in'])
        for (const phase of ['straight', 'approach', 'corner'])
          qualifyingMatrix.push(staticPriorityTrial({
            kind: 'quali', side, phase, yieldingPhase,
            wet: yieldingPhase === 'in' ? 0.7 : 0
          }));

    function orderFlipPriorityTrial(kind) {
      const prepared = preparePriorityScenario({
        kind, phase: 'straight', side: 1, wet: 0,
        yieldingPhase: kind === 'quali' ? 'out' : undefined
      });
      const { session, track, beneficiary, yielding } = prepared;
      session.trafT = 0; GL.stepSession(1 / 120);
      const record = firstPriorityRecord(session);
      const key = record && record.key;
      const yieldingS = yielding.car.s;
      place(session, yielding, yieldingS, 28, record.yieldSide, 1);
      place(session, beneficiary, yieldingS + 1, 34, -Math.sign(record.yieldSide) *
        (track.hw - 2), kind === 'blue' ? 2 : 1);
      configurePriorityPhases(kind, beneficiary, yielding, 'out');
      for (let tick = 0; tick < 36; tick++) GL.stepSession(1 / 120);
      const persisted = session.priorityRecords instanceof Map &&
        session.priorityRecords.has(key);
      const recordsAfterFlip = recordCount(session, ['priorityRecords']);
      const clearBase = yielding.car.s;
      place(session, yielding, clearBase, 28, record.yieldSide, 1);
      place(session, beneficiary, clearBase + GL.PHYS.carLen + 2.5, 34,
        -Math.sign(record.yieldSide) * (track.hw - 2), kind === 'blue' ? 2 : 1);
      configurePriorityPhases(kind, beneficiary, yielding, 'out');
      let releaseTicks = 0;
      for (; releaseTicks < 120 && recordCount(session, ['priorityRecords']); releaseTicks++)
        GL.stepSession(1 / 120);
      const history = (session.priorityHistory || []).find(item => item.key === key);
      return {
        kind, track: track.def.id,
        detected: !!record,
        persisted,
        recordsAfterFlip,
        released: recordCount(session, ['priorityRecords']) === 0,
        release: history && history.release,
        releaseSeconds: releaseTicks / 120,
        pathCrossings: history && history.pathCrossings || 0,
        illegalDecisions: session.priorityIllegalDecisions || 0
      };
    }

    function offLinePriorityTrial() {
      const trial = staticPriorityTrial({
        kind: 'blue', phase: 'straight', side: -1, wet: 0, offLine: true
      });
      return { ...trial, preservedSide: trial.yieldSide > 0 };
    }
    function pitEntryPriorityTrial(kind) {
      const session = kind === 'blue' ? beginRace(0) : beginQualifying(0);
      const track = session.trk;
      const beneficiary = session.entries[0], yielding = session.entries[1];
      isolate(session, [beneficiary, yielding]);
      stabilizePriorityEntry(beneficiary); stabilizePriorityEntry(yielding);
      const yieldingS = track.pit.sEntry - 100;
      const yieldingIndex =
        ((Math.round(yieldingS / track.step) % track.n) + track.n) % track.n;
      const beneficiaryS = yieldingS - GL.PHYS.carLen - 40;
      const beneficiaryIndex =
        ((Math.round(beneficiaryS / track.step) % track.n) + track.n) % track.n;
      place(session, yielding, yieldingS, 27, track.rline.off[yieldingIndex], 1);
      place(session, beneficiary, beneficiaryS, 35, track.rline.off[beneficiaryIndex],
        kind === 'blue' ? 2 : 1);
      if (kind === 'blue') yielding.pitArm = { comp: 'H', fix: false };
      configurePriorityPhases(kind, beneficiary, yielding, 'in');
      session.trafT = 0; GL.stepSession(1 / 120);
      const record = firstPriorityRecord(session);
      return {
        kind, track: track.def.id,
        records: recordCount(session, ['priorityRecords']),
        detectedPhase: record && record.detectedPhase,
        yieldingMode: yielding.pathMode,
        yieldingPath: yielding.pathPlan && yielding.pathPlan.key,
        beneficiaryMode: beneficiary.pathMode,
        decisionsSuppressed: yielding.atkT === 0 && yielding.defT === 0 &&
          yielding.lungeT === 0
      };
    }
    function priorityRightsTrial() {
      const fixture = rightsFixture(1);
      const session = beginRace(fixture.round), track = session.trk;
      const corner = track.corners.find(candidate => candidate.id === fixture.cornerId);
      const beneficiary = session.entries[0], yielding = session.entries[1];
      isolate(session, [beneficiary, yielding]);
      stabilizePriorityEntry(beneficiary); stabilizePriorityEntry(yielding);
      placeIndex(session, beneficiary, corner.brakeI, 34, corner.side * 1.7, -1, 2);
      placeIndex(session, yielding, corner.brakeI, 29, -corner.side * 1.7, 1, 1);
      yielding.atkT = 3; yielding.defT = 3; yielding.lungeT = 1;
      session.trafT = 0; GL.stepSession(1 / 120);
      return {
        track: track.def.id,
        priorityRecords: recordCount(session, ['priorityRecords']),
        rightsRecords: recordCount(session, ['cornerRights']),
        modes: [beneficiary.pathMode, yielding.pathMode].sort(),
        decisionsSuppressed: yielding.atkT === 0 && yielding.defT === 0 &&
          yielding.lungeT === 0,
        violations: session.cornerRightsViolations || 0
      };
    }
    function sequentialPriorityTrial(kind) {
      const fixture = priorityFixture(-1, 'straight', 220);
      const session = kind === 'blue'
        ? beginRace(fixture.round) : beginQualifying(fixture.round);
      const track = session.trk;
      const first = session.entries[0], second = session.entries[1], yielding = session.entries[2];
      isolate(session, [first, second, yielding]);
      for (const entry of [first, second, yielding]) stabilizePriorityEntry(entry);
      const yieldingS = fixture.index * track.step;
      const yieldingLat = track.rline.off[fixture.index];
      place(session, yielding, yieldingS, 28, yieldingLat, 1);
      for (const [entry, gap, speed] of [[first, 25, 36], [second, 45, 37]]) {
        const s = yieldingS - GL.PHYS.carLen - gap;
        const index = ((Math.round(s / track.step) % track.n) + track.n) % track.n;
        place(session, entry, s, speed, track.rline.off[index], kind === 'blue' ? 2 : 1);
      }
      if (kind === 'quali') {
        configurePriorityPhases(kind, first, yielding, 'out');
        first.lapPhase = 'flying'; first.lapLive = true;
        second.lapPhase = 'flying'; second.lapLive = true;
      }
      session.trafT = 0; GL.stepSession(1 / 120);
      const records = session.priorityRecords instanceof Map
        ? [...session.priorityRecords.values()] : [];
      const activeBefore = yielding.priorityYield && yielding.priorityYield.beneficiary;
      const sharedSide = new Set(records.map(record => record.yieldSide)).size === 1;
      const yieldSide = records[0] && records[0].yieldSide;
      const modes = [yielding.pathMode];
      place(session, yielding, yieldingS, 28, yieldSide, 1);
      place(session, first, yieldingS + GL.PHYS.carLen + 2.5, 34, -yieldSide,
        kind === 'blue' ? 2 : 1);
      place(session, second, yieldingS - GL.PHYS.carLen - 35, 37, -yieldSide,
        kind === 'blue' ? 2 : 1);
      if (kind === 'quali') {
        configurePriorityPhases(kind, first, yielding, 'out');
        second.lapPhase = 'flying'; second.lapLive = true;
      }
      // Traffic runs at 30 Hz while the physics fixture advances at 120 Hz.
      // Allow a full 0.5 s of clearance samples plus one cadence interval for
      // the handoff to be applied to the queued beneficiary.
      for (let tick = 0; tick < 84; tick++) {
        GL.stepSession(1 / 120);
        modes.push(yielding.pathMode);
      }
      const remaining = session.priorityRecords instanceof Map
        ? [...session.priorityRecords.values()].map(record => ({
            beneficiary: record.beneficiary.code,
            clearFor: record.clearFor,
            gap: record.lastGap,
            beneficiaryS: record.beneficiary.car && record.beneficiary.car.s,
            yieldingS: record.yielding.car && record.yielding.car.s,
            beneficiaryState: record.beneficiary.state,
            yieldingState: record.yielding.state
          })) : [];
      return {
        kind, track: track.def.id,
        recordsAtDetect: records.length,
        maximumQueue: session.priorityMaximumQueue || 0,
        activeBefore,
        activeAfter: yielding.priorityYield && yielding.priorityYield.beneficiary,
        sharedSide,
        handoffs: session.priorityHandoffs || 0,
        noIdealWeave: !modes.includes('ideal'),
        yieldingMode: yielding.pathMode,
        remainingRecords: recordCount(session, ['priorityRecords']),
        pathCrossings: session.priorityPathCrossings || 0,
        remaining
      };
    }
    function bothFlyingTrial() {
      const session = beginQualifying(0), track = session.trk;
      const first = session.entries[0], second = session.entries[1];
      isolate(session, [first, second]);
      stabilizePriorityEntry(first); stabilizePriorityEntry(second);
      place(session, second, 200, 28, 0, 1);
      place(session, first, 160, 36, 0, 1);
      first.lapPhase = second.lapPhase = 'flying';
      first.lapLive = second.lapLive = true;
      session.trafT = 0; GL.stepSession(1 / 120);
      return {
        track: track.def.id,
        records: recordCount(session, ['priorityRecords']),
        yields: [first.priorityYield || null, second.priorityYield || null]
      };
    }
    function hardContactCount(session) {
      return Object.values(session.hitPairs || {}).reduce(
        (total, pair) => total + (pair && pair.hard || 0), 0
      );
    }
    function clearTrackPriorityControl(prepared, targetDistance) {
      const { kind, round, wet, startS, startSpeed, startCross } = prepared;
      const session = kind === 'blue' ? beginRace(round) : beginQualifying(round);
      const track = session.trk;
      const entry = session.entries[0];
      isolate(session, [entry]);
      session.wet = wet;
      session.evo = 0;
      if (session.mode === 'race') {
        session.raining = false; session.rainAt = Infinity; session.rainEnd = -1;
      }
      stabilizePriorityEntry(entry);
      entry.tyre.c = wet > 0.42 ? 'W' : 'S';
      const index = ((Math.round(startS / track.step) % track.n) + track.n) % track.n;
      place(session, entry, startS, startSpeed, track.rline.off[index], startCross);
      if (kind === 'quali') {
        entry.lapPhase = 'flying'; entry.lapLive = true; entry.boxArm = false;
      }
      const startProgress = entry.prog;
      const startTime = session.t;
      let ticks = 0;
      let offCourse = false;
      for (; ticks < 6000 && entry.prog - startProgress < targetDistance; ticks++) {
        GL.stepSession(1 / 120);
        offCourse ||= entry.car.offCourse;
      }
      return {
        completed: entry.prog - startProgress >= targetDistance,
        elapsed: session.t - startTime,
        ticks,
        distance: entry.prog - startProgress,
        offCourse
      };
    }
    function drivenPriorityTrial(kind, round, phase, wet, yieldingPhase = 'out') {
      const prepared = preparePriorityScenario({
        kind, round, phase, side: round % 2 === 0 ? 1 : -1,
        wet, yieldingPhase, gap: 30
      });
      const { session, track, corner, beneficiary, yielding } = prepared;
      const startProgress = beneficiary.prog;
      const startTime = session.t;
      const startS = beneficiary.car.s;
      const startSpeed = beneficiary.spd;
      const startCross = beneficiary.cross;
      const activationsAtStart = session.priorityActivations || 0;
      const hitsAtStart = session.hitN || 0;
      const hardAtStart = hardContactCount(session);
      session.trafT = 0;
      GL.stepSession(1 / 120);
      const record = firstPriorityRecord(session);
      const key = record && record.key;
      const detectedYieldSide = record && record.yieldSide;
      const yieldingPathKey = yielding.pathPlan && yielding.pathPlan.key;
      const beneficiaryPathKey = beneficiary.pathPlan && beneficiary.pathPlan.key;
      const reason = kind === 'blue' ? 'blue-flag' : 'qualifying';
      let decisionsSuppressed = true;
      let offCourse = false;
      let firstOverlapAt = null;
      let clearBeforeOverlap = true;
      let firstSafeAt = null;
      let lastLateralOrder = 0;
      const lateralOrderTrace = [];
      let releaseTicks = 0;
      let history = null;
      for (; releaseTicks < 4800; releaseTicks++) {
        const active = key && session.priorityRecords instanceof Map &&
          session.priorityRecords.has(key);
        if (active) {
          decisionsSuppressed &&= yielding.atkT === 0 && yielding.defT === 0 &&
            yielding.lungeT === 0 && yielding.tow === 0;
          const forward =
            (yielding.car.s - beneficiary.car.s + track.len) % track.len;
          const beneficiaryBehind = forward < track.len / 2;
          const lateralSeparation = Math.abs(beneficiary.latNow - yielding.latNow);
          const laterallyClear = lateralSeparation >= GL.PHYS.carWid + 0.2;
          if (lateralSeparation >= 0.25) {
            const lateralOrder = Math.sign(beneficiary.latNow - yielding.latNow);
            if (lateralOrder !== lastLateralOrder) {
              lateralOrderTrace.push({
                t: session.t - startTime,
                order: lateralOrder,
                beneficiaryLat: beneficiary.latNow,
                yieldingLat: yielding.latNow,
                forward,
                beneficiaryMode: beneficiary.pathMode,
                yieldingMode: yielding.pathMode
              });
              lastLateralOrder = lateralOrder;
            }
          }
          if (beneficiaryBehind && laterallyClear && firstSafeAt == null)
            firstSafeAt = session.t - startTime;
          if (beneficiaryBehind && forward <= GL.PHYS.carLen && firstOverlapAt == null) {
            firstOverlapAt = session.t - startTime;
            clearBeforeOverlap = laterallyClear;
          }
        }
        offCourse ||= beneficiary.car.offCourse || yielding.car.offCourse;
        history = key && (session.priorityHistory || []).find(item => item.key === key);
        if (history) break;
        GL.stepSession(1 / 120);
      }
      const trafficElapsed = session.t - startTime;
      const trafficDistance = Math.max(0, beneficiary.prog - startProgress);
      const trackOutDistance =
        ((corner.trackOutI * track.step - prepared.index * track.step + track.len) %
          track.len) + 200;
      const safePassDelay = firstSafeAt == null ? Infinity : trafficElapsed - firstSafeAt;
      let rejoinTicks = 0;
      for (; rejoinTicks < 1200 && yielding.pathMode !== 'ideal'; rejoinTicks++) {
        GL.stepSession(1 / 120);
        offCourse ||= beneficiary.car.offCourse || yielding.car.offCourse;
      }
      const contacts = (session.hitN || 0) - hitsAtStart;
      const hardContacts = hardContactCount(session) - hardAtStart;
      const control = kind === 'quali' && history
        ? clearTrackPriorityControl({
            kind, round, wet, startS, startSpeed, startCross
          }, trafficDistance)
        : null;
      const addedLoss = control ? trafficElapsed - control.elapsed : null;
      return {
        kind, round, track: track.def.id, corner: corner.id,
        phase, side: corner.side, wet, yieldingPhase,
        recordsAtDetection: record ? 1 : 0,
        reason: record && record.reason,
        beneficiary: record && record.beneficiary.code,
        detectedPhase: record && record.detectedPhase,
        detectedYieldSide,
        yieldingPathKey,
        beneficiaryPathKey,
        activations: (session.priorityActivations || 0) - activationsAtStart,
        released: !!history,
        release: history && history.release,
        releaseSeconds: trafficElapsed,
        trafficDistance,
        firstOverlapAt,
        clearBeforeOverlap: phase !== 'straight' ||
          (firstOverlapAt != null && clearBeforeOverlap),
        firstSafeAt,
        safePassDelay,
        firstSafeOpportunity: !!history && trafficDistance <= trackOutDistance + 1e-6,
        decisionsSuppressed,
        illegalDecisions: session.priorityIllegalDecisions || 0,
        pathCrossings: history ? history.pathCrossings : session.priorityPathCrossings || 0,
        lateralOrderTrace,
        cornerViolations: session.cornerRightsViolations || 0,
        contacts,
        hardContacts,
        offCourse,
        yieldingRejoined: yielding.pathMode === 'ideal',
        rejoinSeconds: rejoinTicks / 120,
        maxSlew: Math.max(yielding.pathMaxSlew || 0, beneficiary.pathMaxSlew || 0),
        control,
        addedLoss,
        lossBound: phase === 'corner' ? 1 : 0.5,
        expectedReason: reason
      };
    }
    const drivenPhases = ['straight', 'approach', 'corner'];
    function balancedDrivenPhases(kind) {
      const available = GL.BUILT.map((_, round) => {
        const yieldingPhase = kind === 'quali' && round % 2 !== 0 ? 'in' : 'out';
        const minimumPitDistance = kind === 'quali' && yieldingPhase === 'in' ? 220 : 0;
        return drivenPhases.filter(phase =>
          findPriorityFixtureForRound(round, phase, minimumPitDistance));
      });
      function assign(round, counts, selected) {
        if (round === available.length)
          return drivenPhases.every(phase => counts[phase] === 2) ? selected : null;
        const options = [...available[round]].sort((left, right) =>
          counts[left] - counts[right] || drivenPhases.indexOf(left) - drivenPhases.indexOf(right));
        for (const phase of options) {
          if (counts[phase] >= 2) continue;
          counts[phase]++;
          const result = assign(round + 1, counts, [...selected, phase]);
          counts[phase]--;
          if (result) return result;
        }
        return null;
      }
      const selected = assign(0, { straight: 0, approach: 0, corner: 0 }, []);
      if (!selected)
        throw new Error(`No balanced ${kind} driven phase assignment: ${JSON.stringify(available)}`);
      return selected;
    }
    const drivenPriority = [];
    const blueDrivenPhases = balancedDrivenPhases('blue');
    const qualifyingDrivenPhases = balancedDrivenPhases('quali');
    for (let round = 0; round < GL.BUILT.length; round++) {
      const wet = round % 2 === 0 ? 0 : 0.7;
      drivenPriority.push(drivenPriorityTrial('blue', round, blueDrivenPhases[round], wet));
      drivenPriority.push(drivenPriorityTrial(
        'quali', round, qualifyingDrivenPhases[round], wet,
        round % 2 === 0 ? 'out' : 'in'
      ));
    }
    const priority = {
      blueMatrix,
      qualifyingMatrix,
      orderFlip: [orderFlipPriorityTrial('blue'), orderFlipPriorityTrial('quali')],
      offLine: offLinePriorityTrial(),
      pitEntry: [pitEntryPriorityTrial('blue'), pitEntryPriorityTrial('quali')],
      rights: priorityRightsTrial(),
      sequential: [sequentialPriorityTrial('blue'), sequentialPriorityTrial('quali')],
      bothFlying: bothFlyingTrial(),
      driven: drivenPriority
    };
    return { line, pathModes, rights, pit, doubleStack, merge, priority };
  });
  await browser.close();

  // The checked-in source differs from the plan's evidence table at one Cerro
  // corner: its sign-only sample is outside/inside/outside. Freeze observed
  // behavior rather than disguising that discrepancy.
  const lineBaseline = result.line.every(track => !track.semantic) &&
    JSON.stringify(result.line.map(track => track.strict45m)) === JSON.stringify([0, 0, 0, 0, 0, 1]);
  const lineAcceptance = result.line.every(track =>
    track.semantic && track.semanticStrict && track.profilePass);
  const pathsAcceptance = result.pathModes.every(trial => trial.idealMode &&
    trial.attack.mode === 'attack' && trial.defend.mode === 'defend' &&
    trial.tuck.mode === 'tuck' && trial.attack.finite && trial.defend.finite && trial.tuck.finite &&
    trial.attack.inputFinite && trial.defend.inputFinite && trial.tuck.inputFinite &&
    trial.attack.maxSlew <= 0.5 && trial.defend.maxSlew <= 0.5 && trial.tuck.maxSlew <= 0.5 &&
    trial.attackCacheStable && trial.defendCacheStable && trial.tuckCacheStable &&
    trial.phaseDiversity && trial.attackShape && trial.defendShape && trial.tighterSpeed);
  const rightsBaseline = result.rights.matrix.every(trial => !trial.acquired);
  const rightsAcceptance = result.rights.matrix.length === 16 &&
    result.rights.matrix.every(trial => trial.bodyOverlap &&
      trial.exactLateralSeparation === 2 && trial.acquired &&
      trial.initial.phase === trial.phase && trial.initial.rolesCorrect &&
      trial.initial.defenseCancelled && trial.initial.separation > 0 &&
      trial.initial.separation <= 3.4 + 1e-6 &&
      Math.abs(trial.initial.targetSeparation - trial.initial.separation) <= 1e-6 &&
      trial.initial.assignments === 2 && trial.initial.pathSafe &&
      JSON.stringify(trial.initial.modes) ===
        JSON.stringify(['side-inside', 'side-outside']) &&
      trial.initial.maxSlew <= 0.5 && trial.survivedOrderFlip &&
      trial.rolesStable && trial.timersExpired && trial.targetSafe &&
      trial.pathSafe && trial.violations === 0 && trial.hardContacts === 0) &&
    result.rights.physical.length === 12 &&
    result.rights.physical.every(trial => trial.acquired &&
      trial.drivenThroughTrackOut && trial.drivenSeconds <= 25 &&
      !trial.prematureDrop && trial.minimumSeparation >= 3.2 &&
      trial.targetSafe && trial.pathSafe && !trial.offCourse &&
      trial.violations === 0 && trial.released &&
      trial.releaseReason === 'track-out-clear' &&
      trial.releaseSeconds >= 0.5 && trial.releaseSeconds <= 0.75 &&
      JSON.stringify(trial.rejoinModes) === JSON.stringify(['tuck', 'tuck']) &&
      trial.rejoinedIdeal && trial.rejoinSeconds > 0 && trial.rejoinSeconds <= 10 &&
      trial.maxSlew <= 0.5 && trial.hardContacts === 0) &&
    result.rights.linked.acquired && result.rights.linked.retained &&
    result.rights.linked.handedToNext && result.rights.linked.handoffs === 1 &&
    result.rights.linked.historyEmpty && result.rights.linked.violations === 0 &&
    result.rights.noOverlapTuck.rights === 0 &&
    result.rights.noOverlapTuck.attackCancelled && result.rights.noOverlapTuck.tucked &&
    result.rights.threeWide.length === 2 &&
    result.rights.threeWide[0].feasible &&
    result.rights.threeWide[0].assignments === 3 &&
    result.rights.threeWide[0].targetGaps.every(gap => Math.abs(gap - 3.4) <= 1e-6) &&
    result.rights.threeWide[0].fallbackCount === 0 &&
    result.rights.threeWide[0].violations === 0 &&
    !result.rights.threeWide[1].feasible &&
    result.rights.threeWide[1].assignments === 2 &&
    result.rights.threeWide[1].fallbackCount === 1 &&
    result.rights.threeWide[1].rearTucked &&
    result.rights.threeWide[1].livePairs === 1 &&
    result.rights.threeWide[1].fallbackReleases === 2 &&
    result.rights.threeWide[1].violations === 0;
  const pitBaseline = result.pit.some(track => track.failures.length > 0);
  const pitAcceptance = result.pit.every(track => track.trials > 0 && track.failures.length === 0 &&
      track.maximumDelay <= 0.25 && (track.minimumCap == null || track.minimumCap >= 0)) &&
    result.doubleStack.every(trial => trial.queued && trial.queueLaneClear && trial.bothServiced &&
      trial.rejoined && trial.contacts === 0) &&
    result.merge.every(trial => trial.waited && trial.rejoined && trial.contacts === 0);
  const priorityBaseline = result.priority.blueMatrix.every(trial => trial.records === 0) &&
    result.priority.qualifyingMatrix.every(trial => trial.records === 0);
  const priorityMatrixAcceptance = (matrix, reason, expectedMode) => matrix.every(trial =>
    trial.records === 1 && trial.reason === reason && trial.beneficiary &&
    trial.detectedPhase === trial.phase && trial.stableYieldSide && trial.stableRecord &&
    trial.stablePath && trial.yieldingMode === expectedMode &&
    trial.beneficiaryMode === 'priority-pass' && trial.yieldingPathFinite &&
    trial.beneficiaryPathFinite && trial.decisionsSuppressed &&
    trial.illegalDecisions === 0 && trial.pathCrossings === 0 &&
    trial.clearBeforeOverlap && trial.maxSlew <= 0.5 && !trial.offCourse);
  const drivenPriorityAcceptance = result.priority.driven.length === 12 &&
    new Set(result.priority.driven.map(trial => trial.track)).size === 6 &&
    ['blue', 'quali'].every(kind => {
      const trials = result.priority.driven.filter(trial => trial.kind === kind);
      return trials.length === 6 &&
        ['straight', 'approach', 'corner'].every(phase =>
          trials.filter(trial => trial.phase === phase).length === 2) &&
        trials.filter(trial => trial.wet > 0).length === 3;
    }) &&
    result.priority.driven.every(trial => trial.recordsAtDetection === 1 &&
      trial.reason === trial.expectedReason && trial.beneficiary &&
      trial.detectedPhase === trial.phase && trial.activations === 1 &&
      trial.released && trial.release === 'physical-clearance' &&
      trial.releaseSeconds > 0.5 && trial.releaseSeconds <= 30 &&
      trial.firstSafeAt != null && trial.safePassDelay <= 8 &&
      trial.clearBeforeOverlap && trial.decisionsSuppressed &&
      trial.illegalDecisions === 0 && trial.pathCrossings === 0 &&
      trial.cornerViolations === 0 && trial.hardContacts === 0 &&
      !trial.offCourse && trial.yieldingRejoined && trial.rejoinSeconds <= 10 &&
      trial.maxSlew <= 0.5 &&
      (trial.kind !== 'blue' || trial.firstSafeOpportunity) &&
      (trial.kind !== 'quali' ||
        (trial.control && trial.control.completed && !trial.control.offCourse &&
          trial.addedLoss <= trial.lossBound + 1e-9)));
  const priorityAcceptance = result.priority.blueMatrix.length === 12 &&
    result.priority.qualifyingMatrix.length === 12 &&
    priorityMatrixAcceptance(result.priority.blueMatrix, 'blue-flag', 'blue-yield') &&
    priorityMatrixAcceptance(result.priority.qualifyingMatrix, 'qualifying', 'qualifying-yield') &&
    result.priority.orderFlip.every(trial => trial.detected && trial.persisted &&
      trial.recordsAfterFlip === 1 && trial.released &&
      trial.release === 'physical-clearance' && trial.releaseSeconds >= 0.5 &&
      trial.releaseSeconds <= 0.75 && trial.pathCrossings === 0 &&
      trial.illegalDecisions === 0) &&
    result.priority.offLine.preservedSide &&
    result.priority.pitEntry.every(trial => trial.records === 1 &&
      trial.detectedPhase === 'pit-entry' && trial.yieldingMode === 'pit' &&
      trial.yieldingPath.startsWith('pit:approach:') &&
      trial.beneficiaryMode === 'priority-pass' && trial.decisionsSuppressed) &&
    result.priority.rights.priorityRecords === 1 &&
    result.priority.rights.rightsRecords === 1 &&
    JSON.stringify(result.priority.rights.modes) ===
      JSON.stringify(['side-inside', 'side-outside']) &&
    result.priority.rights.decisionsSuppressed && result.priority.rights.violations === 0 &&
    result.priority.sequential.every(trial => trial.recordsAtDetect === 2 &&
      trial.maximumQueue === 2 && trial.activeBefore && trial.activeAfter &&
      trial.activeBefore !== trial.activeAfter && trial.sharedSide &&
      trial.handoffs === 1 && trial.noIdealWeave &&
      trial.yieldingMode !== 'ideal' && trial.remainingRecords === 1 &&
      trial.pathCrossings === 0) &&
    result.priority.bothFlying.records === 0 &&
    result.priority.bothFlying.yields.every(value => value == null) &&
    drivenPriorityAcceptance;
  const checks = {
    line: featurePass('line', lineBaseline, lineAcceptance),
    paths: accepted.has('line') ? pathsAcceptance : true,
    rights: featurePass('rights', rightsBaseline, rightsAcceptance),
    pit: featurePass('pit', pitBaseline, pitAcceptance),
    priority: featurePass('priority', priorityBaseline, priorityAcceptance),
    runtime: errors.length === 0
  };
  const ok = Object.values(checks).every(Boolean);
  const outputResult = summaryOnly ? {
    pathModes: result.pathModes.map(trial => ({
      track: trial.track, idealMode: trial.idealMode,
      attack: trial.attack.mode, defend: trial.defend.mode, tuck: trial.tuck.mode,
      maxSlew: Math.max(trial.attack.maxSlew, trial.defend.maxSlew, trial.tuck.maxSlew)
    })),
    rights: {
      matrix: result.rights.matrix.length,
      physical: result.rights.physical.map(trial => ({
        track: trial.track, wet: trial.wet, acquired: trial.acquired,
        through: trial.drivenThroughTrackOut, prematureDrop: trial.prematureDrop,
        minSep: trial.minimumSeparation, targetSafe: trial.targetSafe,
        pathSafe: trial.pathSafe, offCourse: trial.offCourse,
        violations: trial.violations, released: trial.released,
        release: trial.releaseReason, releaseSeconds: trial.releaseSeconds,
        rejoined: trial.rejoinedIdeal, rejoinSeconds: trial.rejoinSeconds,
        finalState: trial.finalState,
        maxSlew: trial.maxSlew, hardContacts: trial.hardContacts
      })),
      linked: result.rights.linked,
      noOverlapTuck: result.rights.noOverlapTuck,
      threeWide: result.rights.threeWide
    },
    pit: result.pit.map(trial => ({
      track: trial.track, trials: trial.trials, maximumDelay: trial.maximumDelay,
      minimumCap: trial.minimumCap, failures: trial.failures
    })),
    doubleStack: result.doubleStack.map(trial => ({
      track: trial.track, queued: trial.queued, queueLaneClear: trial.queueLaneClear,
      bothServiced: trial.bothServiced, rejoined: trial.rejoined, contacts: trial.contacts
    })),
    merge: result.merge,
    priority: {
      blueMatrix: result.priority.blueMatrix.map(trial => ({
        phase: trial.phase, side: trial.side, wet: trial.wet,
        records: trial.records, crossing: trial.pathCrossings,
        clear: trial.clearBeforeOverlap
      })),
      qualifyingMatrix: result.priority.qualifyingMatrix.map(trial => ({
        phase: trial.phase, side: trial.side, yieldingPhase: trial.yieldingPhase,
        wet: trial.wet, records: trial.records, crossing: trial.pathCrossings,
        clear: trial.clearBeforeOverlap
      })),
      orderFlip: result.priority.orderFlip,
      offLine: result.priority.offLine,
      pitEntry: result.priority.pitEntry,
      rights: result.priority.rights,
      sequential: result.priority.sequential,
      bothFlying: result.priority.bothFlying,
      driven: result.priority.driven
    }
  } : result;
  console.log(JSON.stringify({ ok, mode, accepted: [...accepted].sort(), checks,
    result: outputResult, errors }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(2);
});
