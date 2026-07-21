import { botStep } from './core/autopilot';
import { collideCars } from './core/collision';
import type {
  BuiltTrack, PathGeometry, PathTiming, SampledPath, SpeedProfile, Track
} from './core/model';
import { PHYS } from './core/physics';
import { makeCar, stepCar, trackSense } from './core/physics-engine';
import {
  buildCorners,
  derivePathGeometry,
  nextCorner,
  racingLine,
  speedProfile
} from './core/racing-line';
import { buildTrack } from './core/track';
import { DRIVERS } from './data/personnel';
import { TEAM_DEFS } from './data/teams';
import { TRACK_DEFS } from './data/tracks';
import type { GameState } from './game/model';
import { runFocusedSession, runSingleCar } from './game/headless-sim';
import { raceLapsFor as profileRaceLapsFor } from './game/weekend';
import type { Entry, Session } from './session/model';
import {
  evaluateLaneEta,
  evaluateLaneProgram,
  laneProgramTargetAbs,
  setLaneProgram
} from './session/racecraft/lane-program';
import { owes } from './session/racecraft/relations';
import { entryMargin as sessionEntryMargin } from './session/strategy';
import type { CalendarEventDefinition } from './shared/types';
import type { ControlsController } from './ui/controls';
import type { HudController } from './ui/hud';
import type { Renderer, TrackRenderCache } from './ui/render';
import type { ApplicationRuntime } from './ui/runtime';
import type { SheetActionData, SheetController } from './ui/sheets';

export interface LegacySampledPath extends SampledPath, PathGeometry, PathTiming {}
export type LegacyTrack = Track & { rline: LegacySampledPath };
export interface LegacyBuiltTrack extends Omit<BuiltTrack, 'tr'> {
  tr: LegacyTrack;
  rd: TrackRenderCache;
}

export interface GoldenLapTestApi {
  G: GameState;
  TEAM_DEFS: typeof TEAM_DEFS;
  DRIVERS: typeof DRIVERS;
  BUILT: LegacyBuiltTrack[];
  CALENDAR: CalendarEventDefinition[];
  pickTeam(teamIndex: number): void;
  sheetAction(action: string, data: SheetActionData): void;
  qualiSend(carIndex: number): void;
  qualiBox(carIndex: number): void;
  qualiEnd(): void;
  startRace(): void;
  setScale(scale: number, force?: boolean): void;
  playerEntry(carIndex: number): Entry | null;
  entryMargin(entry: Entry, wet: number): number;
  stepSession(step: number): void;
  startWeekend(): void;
  compileResults(session: Session): void;
  raceLapsFor(event: CalendarEventDefinition): number;
  buildTrack: typeof buildTrack;
  racingLine(track: Track): LegacySampledPath;
  speedProfile(track: Track, path?: Pick<SampledPath, 'k' | 'ds'>): SpeedProfile;
  buildCorners: typeof buildCorners;
  nextCorner: typeof nextCorner;
  makeCar: typeof makeCar;
  trackSense: typeof trackSense;
  stepCar: typeof stepCar;
  botStep: typeof botStep;
  collideCars: typeof collideCars;
  PHYS: typeof PHYS;
  TRACK_DEFS: typeof TRACK_DEFS;
  readonly S: Session | null;
  debugLine?: boolean;
}

interface TestApiOptions {
  state: GameState;
  tracks: readonly BuiltTrack[];
  renderer: Renderer;
  sheets: SheetController;
  hud: HudController;
  controls: ControlsController;
  runtime: ApplicationRuntime;
}

export function installTestApi(options: TestApiOptions): GoldenLapTestApi {
  const { state, tracks, renderer, sheets, hud, controls, runtime } = options;
  const pathFacades = new WeakMap<SampledPath, LegacySampledPath>();
  const trackFacades = new WeakMap<Track, LegacyTrack>();
  const trackTargets = new WeakMap<LegacyTrack, Track>();
  const sessionFacades = new WeakMap<Session, Session>();
  const sessionTargets = new WeakMap<Session, Session>();
  const builtByTrack = new WeakMap<Track, LegacyBuiltTrack>();

  function pathFacade(
    track: Track,
    path: SampledPath,
    timing?: PathTiming
  ): LegacySampledPath {
    const cached = pathFacades.get(path);
    if (cached) return cached;
    const geometry = derivePathGeometry(track, path);
    const resolvedTiming = timing ?? (() => {
      const profile = speedProfile(track, path);
      return { t: profile.t, lapTime: profile.lapTime };
    })();
    const facade: LegacySampledPath = {
      ...path,
      ...geometry,
      t: resolvedTiming.t,
      lapTime: resolvedTiming.lapTime
    };
    pathFacades.set(path, facade);
    return facade;
  }

  function unwrapTrack(track: Track): Track {
    return trackTargets.get(track as LegacyTrack) ?? track;
  }

  function trackFacade(track: Track): LegacyTrack {
    const cached = trackFacades.get(track);
    if (cached) return cached;
    const facade = new Proxy(track, {
      get(target, property, receiver) {
        if (property === 'rline') {
          if (!target.idealPath) return undefined;
          return pathFacade(target, target.idealPath, target.idealTiming);
        }
        return Reflect.get(target, property, receiver);
      },
      set(target, property, value, receiver) {
        if (property === 'rline') {
          const legacy = value as LegacySampledPath;
          target.idealPath = legacy;
          target.idealTiming = { t: legacy.t, lapTime: legacy.lapTime };
          return true;
        }
        return Reflect.set(target, property, value, receiver);
      },
      ownKeys(target) {
        const keys = Reflect.ownKeys(target);
        return keys.includes('rline') ? keys : [...keys, 'rline'];
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === 'rline') {
          return { configurable: true, enumerable: true, writable: true, value: undefined };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
    }) as LegacyTrack;
    trackFacades.set(track, facade);
    trackTargets.set(facade, track);
    return facade;
  }

  const builtFacade: LegacyBuiltTrack[] = tracks.map(track => {
    const facade: LegacyBuiltTrack = {
      def: track.def,
      tr: trackFacade(track.tr),
      prof: track.prof,
      rd: renderer.ensureTrack(track.tr)
    };
    builtByTrack.set(track.tr, facade);
    return facade;
  });

  function sessionFacade(session: Session): Session {
    const cached = sessionFacades.get(session);
    if (cached) return cached;
    const facade = new Proxy(session, {
      get(target, property, receiver) {
        if (property === 'trk') return trackFacade(target.trk);
        if (property === 'B') return builtByTrack.get(target.trk);
        if (property === 'rd') return builtByTrack.get(target.trk)?.rd;
        return Reflect.get(target, property, receiver);
      },
      set(target, property, value, receiver) {
        if (property === 'trk') {
          target.trk = unwrapTrack(value as Track) as Session['trk'];
          return true;
        }
        return Reflect.set(target, property, value, receiver);
      }
    }) as Session;
    sessionFacades.set(session, facade);
    sessionTargets.set(facade, session);
    return facade;
  }

  const gameFacade = new Proxy(state, {
    get(target, property, receiver) {
      if (property === 'S') return target.S ? sessionFacade(target.S) : null;
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (property === 'S') {
        const session = value as Session | null;
        target.S = session ? sessionTargets.get(session) ?? session : null;
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    }
  });
  const api: GoldenLapTestApi = {
    G: gameFacade,
    TEAM_DEFS,
    DRIVERS,
    BUILT: builtFacade,
    CALENDAR: state.calendar,
    pickTeam: teamIndex => sheets.pickTeam(teamIndex),
    sheetAction: (action, data) => sheets.action(action, data),
    qualiSend: carIndex => hud.qualifyingSend(carIndex),
    qualiBox: carIndex => hud.qualifyingBox(carIndex),
    qualiEnd: () => runtime.endQualifying(),
    startRace: () => runtime.startRace(),
    setScale: (scale, force) => controls.setScale(scale, force),
    playerEntry: carIndex => hud.playerEntry(carIndex),
    entryMargin: (entry, wet) => sessionEntryMargin(
      entry,
      state.S,
      state.tune?.bonus ?? 0,
      wet
    ),
    stepSession: step => runtime.stepSession(step),
    startWeekend: () => runtime.startWeekend(),
    compileResults: session => runtime.compileResults(session),
    raceLapsFor: event => {
      const built = tracks[event.trk];
      if (!built) throw new Error(`Unknown track index ${event.trk}`);
      return profileRaceLapsFor(built.prof);
    },
    buildTrack,
    racingLine: track => {
      const target = unwrapTrack(track);
      const path = racingLine(target);
      const profile = speedProfile(target, path);
      return pathFacade(target, path, { t: profile.t, lapTime: profile.lapTime });
    },
    speedProfile: (track, path) => speedProfile(unwrapTrack(track), path),
    buildCorners: (track, line) => buildCorners(unwrapTrack(track), line),
    nextCorner: (track, index) => nextCorner(unwrapTrack(track), index),
    makeCar,
    trackSense,
    stepCar,
    botStep,
    collideCars,
    PHYS,
    TRACK_DEFS,
    get S(): Session | null { return state.S ? sessionFacade(state.S) : null; }
  };
  Object.defineProperty(api, Symbol.for('goldenlap.headlessParity'), {
    configurable: false,
    enumerable: false,
    writable: false,
    value: (trackId = 'prado', seed = 101): object => {
      const built = tracks.find(candidate => candidate.def.id === trackId);
      if (!built) throw new Error(`Unknown parity track ${trackId}`);
      return {
        schemaVersion: 1,
        trackId,
        seed,
        clean: runSingleCar(built, { laps: 1, seed }),
        pair: runFocusedSession(built, { scenario: 'pair', seed }),
        pairSafety30: runFocusedSession(built, {
          scenario: 'pair',
          seed,
          predictiveSafetyHz: 30
        }),
        pit: runFocusedSession(built, { scenario: 'pit', seed }),
        priority: runFocusedSession(built, { scenario: 'priority', seed }),
        classification: runFocusedSession(built, { scenario: 'classification', seed })
      };
    }
  });
  Object.defineProperty(api, Symbol.for('goldenlap.racecraftDiagnostics'), {
    configurable: false,
    enumerable: false,
    writable: false,
    value: {
      owes,
      evaluateLaneEta,
      evaluateLaneProgram,
      laneProgramTargetAbs,
      setLaneProgram
    }
  });
  window.__GL = api;
  return api;
}
