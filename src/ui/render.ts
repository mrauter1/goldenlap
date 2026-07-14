import { TAU, clamp, lerp } from '../shared/math';
import { mulberry32 } from '../shared/rng';
import { derivePathGeometry } from '../core/racing-line';
import type { Track } from '../core/model';
import type { EntryStyle, Session, TeamRef } from '../session/model';
import type { EffectsSystem } from './effects';

export interface CameraView {
  x: number;
  y: number;
  ppm: number;
  init: boolean;
  free: boolean;
  zoom: number;
}

export interface ViewportState {
  width: number;
  height: number;
  dpr: number;
}

interface CrowdPoint { u: number; v: number; c: string }
interface StandCache {
  x: number;
  y: number;
  ang: number;
  len: number;
  dep: number;
  crowd: CrowdPoint[];
}
interface GantryCache { ax: number; ay: number; bx: number; by: number }
interface BoxPad { x: number; y: number; h: number; color: string }

export interface TrackRenderCache {
  road: Path2D;
  edgeL: Path2D;
  edgeR: Path2D;
  curbR: Path2D;
  curbW: Path2D;
  chkD: Path2D;
  chkL: Path2D;
  pitLane: Path2D;
  pitWall: Path2D;
  pitBoxes: Path2D;
  boxPads: BoxPad[];
  stand: StandCache;
  gt: GantryCache;
  mini: HTMLCanvasElement;
  toMini(x: number, y: number): readonly [number, number];
  rlinePath: Path2D | null;
}

export interface Renderer {
  ensureTrack(track: Track): TrackRenderCache;
  render(session: Session, frameDelta: number, camera: CameraView): void;
  drawCardPreview(
    canvas: HTMLCanvasElement,
    track: Track,
    ink?: string,
    grass?: string
  ): void;
}

interface RendererOptions {
  context: CanvasRenderingContext2D;
  miniContext: CanvasRenderingContext2D;
  effects: EffectsSystem;
  teams: readonly TeamRef[];
  viewport(): ViewportState;
  debugLine(): boolean;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawCar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  steerAngle: number,
  style: EntryStyle & { alpha?: number; ghost?: boolean }
): void {
  context.save();
  context.translate(x, y);
  context.rotate(heading);
  context.globalAlpha = style.alpha ?? 1;
  if (!style.ghost) {
    context.fillStyle = 'rgba(30,25,42,0.28)';
    context.beginPath();
    context.ellipse(-0.15, 0.28, 2.75, 1.15, 0, 0, TAU);
    context.fill();
  }
  context.fillStyle = '#241F2C';
  const drawWheel = (wheelX: number, wheelY: number, angle: number): void => {
    context.save();
    context.translate(wheelX, wheelY);
    context.rotate(angle);
    roundedRect(context, -0.46, -0.20, 0.92, 0.40, 0.14);
    context.fill();
    context.restore();
  };
  drawWheel(1.62, -1.02, steerAngle);
  drawWheel(1.62, 1.02, steerAngle);
  drawWheel(-1.55, -1.08, 0);
  drawWheel(-1.55, 1.08, 0);
  context.fillStyle = style.wing;
  roundedRect(context, -2.85, -0.98, 0.55, 1.96, 0.1);
  context.fill();
  context.fillStyle = style.body;
  context.beginPath();
  context.moveTo(2.72, 0);
  context.quadraticCurveTo(2.65, -0.42, 1.7, -0.55);
  context.lineTo(-0.3, -0.72);
  context.quadraticCurveTo(-2.25, -0.66, -2.45, -0.4);
  context.lineTo(-2.45, 0.4);
  context.quadraticCurveTo(-2.25, 0.66, -0.3, 0.72);
  context.lineTo(1.7, 0.55);
  context.quadraticCurveTo(2.65, 0.42, 2.72, 0);
  context.closePath();
  context.fill();
  context.fillStyle = style.wing;
  roundedRect(context, 2.18, -1.12, 0.42, 2.24, 0.12);
  context.fill();
  context.fillStyle = style.accent;
  roundedRect(context, -1.7, -0.30, 2.5, 0.60, 0.22);
  context.fill();
  context.fillStyle = '#241F2C';
  context.beginPath();
  context.ellipse(-0.55, 0, 0.62, 0.44, 0, 0, TAU);
  context.fill();
  context.fillStyle = style.helmet;
  context.beginPath();
  context.arc(-0.55, 0, 0.3, 0, TAU);
  context.fill();
  context.restore();
  context.globalAlpha = 1;
}

function drawDecorGround(context: CanvasRenderingContext2D, track: Track): void {
  const palette = track.def.pal;
  for (const decoration of track.decor) {
    if (decoration.type === 'bale') {
      context.save();
      context.translate(decoration.x, decoration.y);
      context.rotate(decoration.rot);
      context.fillStyle = 'rgba(30,25,42,0.18)';
      roundedRect(context, -0.92, -0.49, 2.2, 1.5, 0.35);
      context.fill();
      context.fillStyle = '#D9BE79';
      roundedRect(context, -1.1, -0.75, 2.2, 1.5, 0.35);
      context.fill();
      context.strokeStyle = 'rgba(122,98,48,0.55)';
      context.lineWidth = 0.14;
      context.beginPath();
      context.moveTo(-0.42, -0.75);
      context.lineTo(-0.42, 0.75);
      context.moveTo(0.42, -0.75);
      context.lineTo(0.42, 0.75);
      context.stroke();
      context.restore();
    } else if (decoration.type === 'rock') {
      context.fillStyle = 'rgba(30,25,42,0.16)';
      context.beginPath();
      context.ellipse(
        decoration.x + 0.2,
        decoration.y + 0.3,
        decoration.r * 1.05,
        decoration.r * 0.8,
        decoration.rot,
        0,
        TAU
      );
      context.fill();
      context.fillStyle = palette.rock;
      context.beginPath();
      context.ellipse(
        decoration.x,
        decoration.y,
        decoration.r,
        decoration.r * 0.78,
        decoration.rot,
        0,
        TAU
      );
      context.fill();
      context.fillStyle = 'rgba(245,241,230,0.28)';
      context.beginPath();
      context.ellipse(
        decoration.x - decoration.r * 0.25,
        decoration.y - decoration.r * 0.22,
        decoration.r * 0.45,
        decoration.r * 0.3,
        decoration.rot,
        0,
        TAU
      );
      context.fill();
    } else {
      const radius = decoration.type === 'tree' ? decoration.r : decoration.r * 1.05;
      context.fillStyle = 'rgba(30,25,42,0.15)';
      context.beginPath();
      context.ellipse(
        decoration.x + radius * 0.22,
        decoration.y + radius * 0.3,
        radius,
        radius * 0.85,
        0,
        0,
        TAU
      );
      context.fill();
    }
  }
}

function drawDecorCanopy(context: CanvasRenderingContext2D, track: Track): void {
  const palette = track.def.pal;
  for (const decoration of track.decor) {
    if (decoration.type === 'tree') {
      context.fillStyle = palette.tree;
      context.beginPath();
      context.arc(decoration.x, decoration.y, decoration.r, 0, TAU);
      context.fill();
      context.fillStyle = palette.tree2;
      context.beginPath();
      context.arc(
        decoration.x - decoration.r * 0.28,
        decoration.y - decoration.r * 0.3,
        decoration.r * 0.62,
        0,
        TAU
      );
      context.fill();
      context.fillStyle = 'rgba(245,241,230,0.13)';
      context.beginPath();
      context.arc(
        decoration.x - decoration.r * 0.38,
        decoration.y - decoration.r * 0.42,
        decoration.r * 0.3,
        0,
        TAU
      );
      context.fill();
    } else if (decoration.type === 'bush') {
      context.fillStyle = palette.bush;
      context.beginPath();
      context.arc(decoration.x, decoration.y, decoration.r, 0, TAU);
      context.arc(
        decoration.x + decoration.r * 0.7,
        decoration.y + decoration.r * 0.15,
        decoration.r * 0.7,
        0,
        TAU
      );
      context.arc(
        decoration.x - decoration.r * 0.65,
        decoration.y + decoration.r * 0.2,
        decoration.r * 0.65,
        0,
        TAU
      );
      context.fill();
    }
  }
}

function drawStand(context: CanvasRenderingContext2D, stand: StandCache): void {
  context.save();
  context.translate(stand.x, stand.y);
  context.rotate(stand.ang);
  context.fillStyle = 'rgba(30,25,42,0.2)';
  roundedRect(context, -stand.len / 2 + 0.5, -stand.dep / 2 + 0.7, stand.len, stand.dep, 1.6);
  context.fill();
  context.fillStyle = '#3A3547';
  roundedRect(context, -stand.len / 2, -stand.dep / 2, stand.len, stand.dep, 1.6);
  context.fill();
  context.fillStyle = '#F5F1E6';
  roundedRect(context, -stand.len / 2, -stand.dep / 2, stand.len, 1.7, 1.6);
  context.fill();
  context.fillStyle = '#D95B43';
  roundedRect(context, -stand.len / 2 + 3, stand.dep / 2 - 1.5, stand.len - 6, 1, 0.5);
  context.fill();
  for (const point of stand.crowd) {
    context.fillStyle = point.c;
    context.beginPath();
    context.arc(point.u, point.v, 0.42, 0, TAU);
    context.fill();
  }
  context.restore();
}

function drawGantry(context: CanvasRenderingContext2D, gantry: GantryCache): void {
  context.strokeStyle = '#2A2536';
  context.lineWidth = 0.55;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(gantry.ax, gantry.ay);
  context.lineTo(gantry.bx, gantry.by);
  context.stroke();
  context.fillStyle = '#2A2536';
  context.beginPath();
  context.arc(gantry.ax, gantry.ay, 0.85, 0, TAU);
  context.fill();
  context.beginPath();
  context.arc(gantry.bx, gantry.by, 0.85, 0, TAU);
  context.fill();
  context.fillStyle = '#E9B44C';
  context.beginPath();
  context.arc((gantry.ax + gantry.bx) / 2, (gantry.ay + gantry.by) / 2, 0.6, 0, TAU);
  context.fill();
}

function shadeRoad(hex: string, wet: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const factor = 1 - wet * 0.22;
  return `rgb(${Math.round(red * factor)},${Math.round(green * factor)},${Math.round(blue * factor + wet * 14)})`;
}

export function createRenderer(options: RendererOptions): Renderer {
  const caches = new WeakMap<Track, TrackRenderCache>();
  const { context, miniContext, effects } = options;

  function ensureTrack(track: Track): TrackRenderCache {
    const existing = caches.get(track);
    if (existing) return existing;
    const built = buildRenderCache(track, options.teams);
    caches.set(track, built);
    return built;
  }

  function drawCardPreview(
    canvas: HTMLCanvasElement,
    track: Track,
    ink = '#221F2B',
    grass = '#D8CFBA'
  ): void {
    const preview = canvas.getContext('2d');
    if (!preview) throw new Error('Circuit preview canvas has no 2D context');
    const width = canvas.width;
    const height = canvas.height;
    preview.clearRect(0, 0, width, height);
    const bounds = track.bbox;
    const padding = 18;
    const scale = Math.min(
      (width - padding * 2) / (bounds.x1 - bounds.x0),
      (height - padding * 2) / (bounds.y1 - bounds.y0)
    );
    const offsetX = width / 2 - (bounds.x0 + bounds.x1) / 2 * scale;
    const offsetY = height / 2 - (bounds.y0 + bounds.y1) / 2 * scale;
    preview.lineJoin = 'round';
    preview.lineCap = 'round';
    preview.beginPath();
    for (let index = 0; index <= track.n; index++) {
      const sample = index % track.n;
      const x = track.x[sample]! * scale + offsetX;
      const y = track.y[sample]! * scale + offsetY;
      if (index === 0) preview.moveTo(x, y);
      else preview.lineTo(x, y);
    }
    preview.strokeStyle = grass;
    preview.lineWidth = 12;
    preview.stroke();
    preview.strokeStyle = ink;
    preview.lineWidth = 6.5;
    preview.stroke();
    preview.strokeStyle = '#E9B44C';
    preview.lineWidth = 2.6;
    preview.beginPath();
    preview.moveTo(track.line.ax * scale + offsetX, track.line.ay * scale + offsetY);
    preview.lineTo(track.line.bx * scale + offsetX, track.line.by * scale + offsetY);
    preview.stroke();
  }

  function render(session: Session, frameDelta: number, camera: CameraView): void {
    const viewport = options.viewport();
    const track = session.trk;
    const cache = ensureTrack(track);
    const palette = track.def.pal;
    let cameraEntry = session.entries[session.camI];
    if (!cameraEntry?.car || cameraEntry.state === 'dnf') {
      let alternative = session.entries.findIndex(entry =>
        entry.isPlayer && entry.car !== null && entry.state !== 'dnf'
      );
      if (alternative < 0)
        alternative = session.entries.findIndex(entry => entry.car !== null && entry.state !== 'dnf');
      if (alternative >= 0) {
        session.camI = alternative;
        cameraEntry = session.entries[alternative];
      } else cameraEntry = undefined;
    }

    let targetX: number;
    let targetY: number;
    let targetScale: number;
    if (cameraEntry?.car) {
      const car = cameraEntry.car;
      const cosine = Math.cos(car.h);
      const sine = Math.sin(car.h);
      const worldVx = car.vx * cosine - car.vy * sine;
      const worldVy = car.vx * sine + car.vy * cosine;
      targetX = car.x + worldVx * 0.5;
      targetY = car.y + worldVy * 0.5;
      const viewScale = clamp(Math.min(viewport.width, viewport.height) / 860, 0.6, 1.25);
      targetScale = lerp(3.2, 2, clamp(car.spd / 75, 0, 1)) * viewScale;
    } else {
      const bounds = track.bbox;
      targetX = (bounds.x0 + bounds.x1) / 2;
      targetY = (bounds.y0 + bounds.y1) / 2;
      targetScale = Math.min(
        viewport.width / (bounds.x1 - bounds.x0 + 140),
        viewport.height / (bounds.y1 - bounds.y0 + 140)
      );
    }
    if (!camera.init) {
      camera.x = targetX;
      camera.y = targetY;
      camera.ppm = targetScale;
      camera.init = true;
    }
    if (camera.free) camera.ppm = clamp(camera.ppm, 0.22, 8);
    else {
      const positionBlend = 1 - Math.exp(-4.2 * frameDelta);
      camera.x += (targetX - camera.x) * positionBlend;
      camera.y += (targetY - camera.y) * positionBlend;
      camera.ppm += (targetScale * camera.zoom - camera.ppm) * (1 - Math.exp(-2.4 * frameDelta));
    }

    const ppm = camera.ppm;
    context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    context.fillStyle = palette.grass;
    context.fillRect(0, 0, viewport.width, viewport.height);
    context.save();
    context.translate(viewport.width / 2, viewport.height / 2);
    context.scale(ppm, ppm);
    context.translate(-camera.x, -camera.y);
    const halfDiagonal = Math.hypot(viewport.width, viewport.height) / (2 * ppm) + 60;
    context.save();
    context.rotate(0.42);
    const cosine = Math.cos(0.42);
    const sine = Math.sin(0.42);
    const cameraU = camera.x * cosine + camera.y * sine;
    const cameraV = -camera.x * sine + camera.y * cosine;
    context.fillStyle = palette.stripe;
    const bandWidth = 40;
    const firstBand = Math.floor((cameraU - halfDiagonal) / (bandWidth * 2)) * bandWidth * 2;
    for (let band = firstBand; band < cameraU + halfDiagonal; band += bandWidth * 2)
      context.fillRect(band, cameraV - halfDiagonal, bandWidth, halfDiagonal * 2);
    context.restore();
    context.save();
    context.translate(2.4, 3.6);
    context.fillStyle = palette.shadow;
    context.fill(cache.road, 'evenodd');
    context.restore();
    context.fillStyle = '#76707F';
    context.fill(cache.pitLane);
    context.fillStyle = session.wet > 0.25 ? shadeRoad(palette.road, session.wet) : palette.road;
    context.fill(cache.road, 'evenodd');
    context.fillStyle = '#C8462F';
    context.fill(cache.curbR);
    context.fillStyle = '#F2ECDD';
    context.fill(cache.curbW);
    context.strokeStyle = palette.edge;
    context.lineWidth = 0.34;
    context.stroke(cache.edgeL);
    context.stroke(cache.edgeR);
    context.fillStyle = '#2A2536';
    context.fill(cache.chkD);
    context.fillStyle = '#F2ECDD';
    context.fill(cache.chkL);
    if (options.debugLine()) drawDebugLine(context, track, cache);
    context.strokeStyle = 'rgba(245,241,230,0.65)';
    context.lineWidth = 0.26;
    context.stroke(cache.pitBoxes);
    for (const pad of cache.boxPads) {
      context.save();
      context.translate(pad.x, pad.y);
      context.rotate(pad.h);
      context.fillStyle = pad.color;
      context.fillRect(-3.1, 1.15, 2.1, 0.5);
      context.restore();
    }
    context.strokeStyle = '#2A2536';
    context.lineWidth = 0.55;
    context.lineCap = 'round';
    context.stroke(cache.pitWall);
    effects.drawSkids(context);
    drawDecorGround(context, track);
    drawStand(context, cache.stand);
    for (const entry of session.entries) {
      if (entry.car) drawCar(context, entry.car.x, entry.car.y, entry.car.h, entry.car.steer, entry.style);
    }
    drawDecorCanopy(context, track);
    effects.drawDust(context, palette.dust);
    drawGantry(context, cache.gt);
    context.restore();
    effects.drawRain(context, session.wet, (cameraEntry?.spd ?? 0) * camera.ppm * 0.1);
    if (effects.hasConfetti()) {
      effects.stepConfetti(frameDelta);
      effects.drawConfetti(context);
    }
    miniContext.clearRect(0, 0, 400, 280);
    miniContext.drawImage(cache.mini, 0, 0);
    for (const entry of session.entries) {
      if (!entry.car || entry.state === 'dnf') continue;
      const [miniX, miniY] = cache.toMini(entry.car.x, entry.car.y);
      miniContext.fillStyle = entry.lu.team.body;
      miniContext.beginPath();
      miniContext.arc(miniX, miniY, entry.isPlayer ? 8 : 6, 0, TAU);
      miniContext.fill();
      if (entry.isPlayer) {
        miniContext.strokeStyle = 'rgba(245,241,230,0.95)';
        miniContext.lineWidth = 2.5;
        miniContext.stroke();
      }
    }
  }

  return { ensureTrack, render, drawCardPreview };
}

function buildRenderCache(track: Track, teams: readonly TeamRef[]): TrackRenderCache {
  const halfWidth = track.hw;
  const samples = track.n;
  const ring = (offset: number): Path2D => {
    const path = new Path2D();
    for (let index = 0; index < samples; index++) {
      const x = track.x[index]! + track.nx[index]! * offset;
      const y = track.y[index]! + track.ny[index]! * offset;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  };
  const road = new Path2D();
  road.addPath(ring(halfWidth));
  road.addPath(ring(-halfWidth));
  const edgeL = ring(halfWidth - 0.22);
  const edgeR = ring(-(halfWidth - 0.22));
  const curbR = new Path2D();
  const curbW = new Path2D();
  for (const curb of track.curbs) {
    const path = curb.red ? curbR : curbW;
    const point = curb.p;
    path.moveTo(point[0]!, point[1]!);
    path.lineTo(point[2]!, point[3]!);
    path.lineTo(point[4]!, point[5]!);
    path.lineTo(point[6]!, point[7]!);
    path.closePath();
  }
  const chkD = new Path2D();
  const chkL = new Path2D();
  const tangentX = track.tx[0]!;
  const tangentY = track.ty[0]!;
  const normalX = track.nx[0]!;
  const normalY = track.ny[0]!;
  const cell = 1.35;
  const columns = Math.ceil((halfWidth * 2) / cell);
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < columns; column++) {
      const path = (row + column) % 2 === 0 ? chkD : chkL;
      const x = track.line.x + tangentX * (row * cell) + normalX * (-halfWidth + column * cell);
      const y = track.line.y + tangentY * (row * cell) + normalY * (-halfWidth + column * cell);
      path.moveTo(x, y);
      path.lineTo(x + normalX * cell, y + normalY * cell);
      path.lineTo(x + normalX * cell + tangentX * cell, y + normalY * cell + tangentY * cell);
      path.lineTo(x + tangentX * cell, y + tangentY * cell);
      path.closePath();
    }
  }
  const pit = track.pit;
  const pitLane = new Path2D();
  const innerEdge: Array<{ x: number; y: number }> = [];
  const outerEdge: Array<{ x: number; y: number }> = [];
  for (let longitudinal = 0; longitudinal <= pit.Lp; longitudinal += 2) {
    const offset = pit.off(longitudinal);
    const boxZone = longitudinal > pit.rampIn + 6 && longitudinal < pit.Lp - pit.rampOut - 6;
    const inner = Math.max(halfWidth - 0.6, offset - 2.6);
    const outer = Math.max((boxZone ? pit.boxOff : offset) + 2.6, inner + 1.2);
    innerEdge.push(pit.posAt(longitudinal, inner));
    outerEdge.push(pit.posAt(longitudinal, outer));
  }
  innerEdge.forEach((point, index) => {
    if (index === 0) pitLane.moveTo(point.x, point.y);
    else pitLane.lineTo(point.x, point.y);
  });
  for (let index = outerEdge.length - 1; index >= 0; index--) {
    const point = outerEdge[index]!;
    pitLane.lineTo(point.x, point.y);
  }
  pitLane.closePath();
  const pitWall = new Path2D();
  let firstWallPoint = true;
  for (let longitudinal = pit.rampIn + 4; longitudinal <= pit.Lp - pit.rampOut - 2; longitudinal += 3) {
    const point = pit.posAt(longitudinal, halfWidth + 1.15);
    if (firstWallPoint) {
      pitWall.moveTo(point.x, point.y);
      firstWallPoint = false;
    } else pitWall.lineTo(point.x, point.y);
  }
  const pitBoxes = new Path2D();
  const boxPads: BoxPad[] = [];
  for (let box = 0; box < teams.length; box++) {
    const point = pit.posAt(pit.boxWAt(box), pit.boxOff);
    const cosine = Math.cos(point.h);
    const sine = Math.sin(point.h);
    const corner = (dx: number, dy: number): readonly [number, number] => [
      point.x + dx * cosine - dy * sine,
      point.y + dx * sine + dy * cosine
    ];
    const first = corner(-3.4, -1.8);
    const second = corner(3.4, -1.8);
    const third = corner(3.4, 1.8);
    const fourth = corner(-3.4, 1.8);
    pitBoxes.moveTo(first[0], first[1]);
    pitBoxes.lineTo(second[0], second[1]);
    pitBoxes.lineTo(third[0], third[1]);
    pitBoxes.lineTo(fourth[0], fourth[1]);
    pitBoxes.closePath();
    boxPads.push({ x: point.x, y: point.y, h: point.h, color: teams[box]!.body });
  }
  const standIndex = 14 % samples;
  const stand: StandCache = {
    x: track.x[standIndex]! - track.nx[standIndex]! * (halfWidth + 12),
    y: track.y[standIndex]! - track.ny[standIndex]! * (halfWidth + 12),
    ang: Math.atan2(track.ty[standIndex]!, track.tx[standIndex]!),
    len: 42,
    dep: 7.5,
    crowd: []
  };
  const crowdRandom = mulberry32(track.def.seed * 977 + 5);
  const crowdColors = ['#E9B44C', '#D95B43', '#F5F1E6', '#7FA0C5', '#C0748B', '#8FBF8F'] as const;
  for (let index = 0; index < 130; index++) {
    stand.crowd.push({
      u: (crowdRandom() - 0.5) * (stand.len - 3),
      v: (crowdRandom() - 0.5) * (stand.dep - 2.6),
      c: crowdColors[(crowdRandom() * crowdColors.length) | 0]!
    });
  }
  const gt: GantryCache = {
    ax: track.line.x + normalX * (halfWidth + 1.6),
    ay: track.line.y + normalY * (halfWidth + 1.6),
    bx: track.line.x - normalX * (halfWidth + 1.6),
    by: track.line.y - normalY * (halfWidth + 1.6)
  };
  const mini = document.createElement('canvas');
  mini.width = 400;
  mini.height = 280;
  const miniCache = mini.getContext('2d');
  if (!miniCache) throw new Error('Minimap cache canvas has no 2D context');
  const bounds = track.bbox;
  const padding = 26;
  const scale = Math.min(
    (400 - padding * 2) / (bounds.x1 - bounds.x0),
    (280 - padding * 2) / (bounds.y1 - bounds.y0)
  );
  const offsetX = 200 - (bounds.x0 + bounds.x1) / 2 * scale;
  const offsetY = 140 - (bounds.y0 + bounds.y1) / 2 * scale;
  miniCache.lineJoin = 'round';
  miniCache.lineCap = 'round';
  miniCache.strokeStyle = 'rgba(20,16,28,0.55)';
  miniCache.lineWidth = 13;
  miniCache.beginPath();
  for (let index = 0; index <= samples; index++) {
    const sample = index % samples;
    const x = track.x[sample]! * scale + offsetX;
    const y = track.y[sample]! * scale + offsetY;
    if (index === 0) miniCache.moveTo(x, y);
    else miniCache.lineTo(x, y);
  }
  miniCache.stroke();
  miniCache.strokeStyle = 'rgba(245,241,230,0.92)';
  miniCache.lineWidth = 6.5;
  miniCache.stroke();
  miniCache.strokeStyle = '#E9B44C';
  miniCache.lineWidth = 4;
  miniCache.beginPath();
  miniCache.moveTo(track.line.ax * scale + offsetX, track.line.ay * scale + offsetY);
  miniCache.lineTo(track.line.bx * scale + offsetX, track.line.by * scale + offsetY);
  miniCache.stroke();
  let rlinePath: Path2D | null = null;
  if (track.idealPath) {
    const geometry = derivePathGeometry(track, track.idealPath);
    rlinePath = new Path2D();
    for (let index = 0; index <= samples; index++) {
      const sample = index % samples;
      if (index === 0) rlinePath.moveTo(geometry.x[sample]!, geometry.y[sample]!);
      else rlinePath.lineTo(geometry.x[sample]!, geometry.y[sample]!);
    }
    rlinePath.closePath();
  }
  return {
    road,
    edgeL,
    edgeR,
    curbR,
    curbW,
    chkD,
    chkL,
    pitLane,
    pitWall,
    pitBoxes,
    boxPads,
    stand,
    gt,
    mini,
    toMini: (x: number, y: number) => [x * scale + offsetX, y * scale + offsetY] as const,
    rlinePath
  };
}

function drawDebugLine(
  context: CanvasRenderingContext2D,
  track: Track,
  cache: TrackRenderCache
): void {
  if (cache.rlinePath) {
    context.save();
    context.strokeStyle = 'rgba(233,180,76,0.9)';
    context.lineWidth = 0.7;
    context.setLineDash([4, 3]);
    context.stroke(cache.rlinePath);
    context.restore();
  }
  if (!track.corners?.length || !track.idealPath) return;
  const markers = [
    ['A', 'approachI', '#6F8BC7'],
    ['B', 'brakeI', '#D95B43'],
    ['T', 'turnInI', '#D99943'],
    ['X', 'apexI', '#E9B44C'],
    ['O', 'trackOutI', '#63A56E'],
    ['E', 'exitI', '#8E5FB8']
  ] as const;
  context.save();
  context.font = '3.2px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const corner of track.corners) {
    for (const [label, key, color] of markers) {
      const index = corner[key];
      const offset = track.idealPath.off[index]!;
      const x = track.x[index]! + track.nx[index]! * offset;
      const y = track.y[index]! + track.ny[index]! * offset;
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, label === 'X' ? 1.8 : 1.25, 0, TAU);
      context.fill();
      context.fillStyle = '#201A29';
      context.fillText(label, x, y);
    }
    const apex = corner.apexI;
    const offset = track.idealPath.off[apex]!;
    const x = track.x[apex]! + track.nx[apex]! * offset;
    const y = track.y[apex]! + track.ny[apex]! * offset;
    context.fillStyle = '#F5F1E6';
    context.fillText(corner.complexId ?? corner.id, x, y - 4.2);
  }
  context.restore();
}
