import {
  derivePathGeometry,
  type IdealLinePreview
} from '../core/racing-line';
import { PHYS } from '../core/physics';
import type { LegacyCorner, Track } from '../core/model';
import { TEAM_DEFS } from '../data/teams';
import { TRACK_DEFS } from '../data/tracks';
import {
  analyzeTrackDraft,
  definitionFromCandidate,
  evaluateTrackQualityFromDraft,
  generateTier0Candidate,
  knotsForGroup,
  normalizeRhythmSignature,
  scrambleRhythmSignatureV2,
  signatureV2ForArchetype,
  TRACKGEN_PASS_SPOT_SCORE,
  type RhythmGroupSpec,
  type RhythmSignatureInput,
  type RhythmSignatureV2,
  type RhythmScrambleMode,
  type TrackArchetype,
  type TrackgenCandidate,
  type TrackgenQualityEvaluation
} from '../game/trackgen';
import { stableFingerprint } from '../shared/stable-json';
import type { TrackDefinition } from '../shared/types';
import { buildTrackRenderCache, type TrackRenderCache } from './render';

interface StudioAnalysis {
  definition: TrackDefinition;
  track: Track;
  corners: readonly LegacyCorner[];
  draft: IdealLinePreview | null;
  cache: TrackRenderCache;
  straight: TrackSpan;
}

interface TrackSpan {
  start: number;
  count: number;
  metres: number;
  seconds: number;
}

interface StudioSelection {
  analysis: StudioAnalysis;
  candidate: TrackgenCandidate | null;
  quality: TrackgenQualityEvaluation | null;
  elapsedMilliseconds: number;
}

export interface TrackStudioApi {
  readonly ready: true;
  readonly existingTrackCount: number;
  generateSnapshot(archetype: TrackArchetype, seed: number): TrackgenCandidate;
  generate(archetype: TrackArchetype, seed: number): {
    fingerprint: string;
    elapsedMilliseconds: number;
    accepted: boolean;
  };
  scrambleSnapshot(
    archetype: TrackArchetype,
    seed: number,
    revision: number,
    mode: RhythmScrambleMode
  ): RhythmSignatureV2;
  importExisting(index: number): {
    id: string;
    samples: number;
    lengthMetres: number;
    corners: number;
    valid: boolean;
  };
}

interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

const viewTransform: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
let active: StudioSelection | null = null;
let comparison: StudioSelection | null = null;
let signature: RhythmSignatureV2 = cloneSignature(signatureV2ForArchetype('balanced'));
let draggedGroup = -1;
let scrambleRevision = 0;

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Track Studio is missing #${id}`);
  return value as T;
}

const archetypeInput = element<HTMLSelectElement>('archetype');
const seedInput = element<HTMLInputElement>('seed');
const signatureEditor = element<HTMLDivElement>('signature-editor');
const mainCanvas = element<HTMLCanvasElement>('track-view');
const compareCanvas = element<HTMLCanvasElement>('compare-view');
const rhythmCanvas = element<HTMLCanvasElement>('rhythm-strip');
const gateList = element<HTMLDivElement>('gate-list');
const metrics = element<HTMLDivElement>('studio-metrics');
const definitionOutput = element<HTMLTextAreaElement>('definition-output');
const artifactOutput = element<HTMLTextAreaElement>('artifact-output');
const importInput = element<HTMLTextAreaElement>('import-input');
const deepArtifactInput = element<HTMLTextAreaElement>('deep-artifact-input');
const deepArtifactStatus = element<HTMLDivElement>('deep-artifact-status');
const signatureJson = element<HTMLTextAreaElement>('signature-json');
const histogram = element<HTMLDivElement>('corner-histogram');
const existingInput = element<HTMLSelectElement>('existing-track');
const statusLine = element<HTMLDivElement>('status-line');
const overlayLine = element<HTMLInputElement>('overlay-line');
const overlayCorners = element<HTMLInputElement>('overlay-corners');
const overlayPass = element<HTMLInputElement>('overlay-pass');
const overlayBraking = element<HTMLInputElement>('overlay-braking');
const overlayStraight = element<HTMLInputElement>('overlay-straight');
const overlayGeometry = element<HTMLInputElement>('overlay-geometry');

function cloneSignature(source: RhythmSignatureV2): RhythmSignatureV2 {
  return JSON.parse(JSON.stringify(source)) as RhythmSignatureV2;
}

function longestStraight(track: Track): TrackSpan {
  const qualifying = Array.from(track.kSm, value => Math.abs(value) <= 1 / 420);
  let bestStart = 0;
  let bestCount = 0;
  let runStart = 0;
  let runCount = 0;
  for (let index = 0; index < qualifying.length * 2; index++) {
    if (qualifying[index % qualifying.length]) {
      if (runCount === 0) runStart = index;
      runCount++;
      if (runCount > qualifying.length) {
        runStart++;
        runCount--;
      }
      if (runCount > bestCount) {
        bestStart = runStart % qualifying.length;
        bestCount = runCount;
      }
    } else {
      runCount = 0;
    }
  }
  const metres = bestCount * track.step;
  return { start: bestStart, count: bestCount, metres, seconds: metres / PHYS.vTop };
}

function analysisFor(definition: TrackDefinition): StudioAnalysis {
  const analysis = analyzeTrackDraft(definition);
  const { track, corners, draft } = analysis;
  track.idealPath = draft.path;
  return {
    definition,
    track,
    corners,
    draft,
    cache: buildTrackRenderCache(track, TEAM_DEFS),
    straight: longestStraight(track)
  };
}

function canvasSize(canvas: HTMLCanvasElement): {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
} {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Track Studio canvas has no 2D context');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(320, canvas.clientWidth || 900);
  const height = Math.max(220, canvas.clientHeight || 620);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  return { context, width, height, dpr };
}

function cornerClass(track: Track, corner: LegacyCorner): string {
  const radius = 1 / Math.max(1e-9, Math.abs(track.kSm[corner.apexI]!));
  return radius < 30 ? 'H' : radius < 60 ? 'S' : radius < 120 ? 'M' :
    radius < 250 ? 'F' : 'K';
}

function cornerHistogram(
  track: Track,
  corners: readonly LegacyCorner[]
): { hairpin: number; slow: number; medium: number; fast: number; kink: number } {
  const result = { hairpin: 0, slow: 0, medium: 0, fast: 0, kink: 0 };
  for (const corner of corners) {
    const radius = 1 / Math.max(1e-9, Math.abs(track.kSm[corner.apexI]!));
    const key = radius < 30 ? 'hairpin' : radius < 60 ? 'slow' :
      radius < 120 ? 'medium' : radius < 250 ? 'fast' : 'kink';
    result[key]++;
  }
  return result;
}

function strokeSpan(
  context: CanvasRenderingContext2D,
  track: Track,
  start: number,
  count: number
): void {
  context.beginPath();
  for (let offset = 0; offset <= count; offset++) {
    const index = (start + offset) % track.n;
    if (offset === 0) context.moveTo(track.x[index]!, track.y[index]!);
    else context.lineTo(track.x[index]!, track.y[index]!);
  }
  context.stroke();
}

function drawSelection(canvas: HTMLCanvasElement, selection: StudioSelection | null): void {
  const { context, width, height, dpr } = canvasSize(canvas);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!selection) return;
  const { track, cache, corners, draft, straight } = selection.analysis;
  const bounds = track.bbox;
  const padding = 54;
  const baseScale = Math.min(
    (width - padding * 2) / Math.max(1, bounds.x1 - bounds.x0),
    (height - padding * 2) / Math.max(1, bounds.y1 - bounds.y0)
  );
  const scale = baseScale * viewTransform.zoom;
  const offsetX = width / 2 - (bounds.x0 + bounds.x1) / 2 * scale + viewTransform.panX;
  const offsetY = height / 2 - (bounds.y0 + bounds.y1) / 2 * scale + viewTransform.panY;
  context.fillStyle = track.def.pal.grass;
  context.fillRect(0, 0, width, height);
  context.save();
  context.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);
  context.fillStyle = track.def.pal.shadow;
  context.lineWidth = 5;
  context.stroke(cache.edgeL);
  context.stroke(cache.edgeR);
  context.fillStyle = track.def.pal.road;
  context.fill(cache.pitLane);
  context.fill(cache.road, 'evenodd');
  context.strokeStyle = track.def.pal.edge;
  context.lineWidth = 0.35;
  context.stroke(cache.edgeL);
  context.stroke(cache.edgeR);
  context.fillStyle = '#F4EFE2';
  context.fill(cache.curbW);
  context.fillStyle = '#D95B43';
  context.fill(cache.curbR);
  context.fillStyle = '#2E2938';
  context.fill(cache.chkD);
  context.fillStyle = '#F5F1E6';
  context.fill(cache.chkL);
  context.strokeStyle = 'rgba(245,241,230,.72)';
  context.lineWidth = 0.25;
  context.stroke(cache.gridSlots);
  context.strokeStyle = '#332D3C';
  context.lineWidth = 0.55;
  context.stroke(cache.pitWall);
  context.strokeStyle = 'rgba(245,241,230,.8)';
  context.lineWidth = 0.45;
  context.stroke(cache.pitBoxes);
  if (overlayStraight.checked && straight.count > 0) {
    context.strokeStyle = 'rgba(111,139,199,.88)';
    context.lineWidth = 2.4;
    strokeSpan(context, track, straight.start, straight.count);
    const midpoint = (straight.start + Math.floor(straight.count / 2)) % track.n;
    context.fillStyle = '#EEF4FF';
    context.font = `${Math.max(2.8, 12 / scale)}px ui-monospace, monospace`;
    context.textAlign = 'center';
    context.fillText(`${straight.seconds.toFixed(1)} s full throttle`,
      track.x[midpoint]!, track.y[midpoint]! - 8 / scale);
  }
  if (overlayBraking.checked) {
    context.strokeStyle = 'rgba(217,91,67,.92)';
    context.lineWidth = 1.7;
    for (const corner of corners) {
      const count = (corner.turnInI - corner.brakeI + track.n) % track.n;
      strokeSpan(context, track, corner.brakeI, count);
    }
  }
  if (overlayLine.checked && draft) {
    const geometry = derivePathGeometry(track, draft.path);
    context.beginPath();
    for (let index = 0; index <= track.n; index++) {
      const sample = index % track.n;
      if (index === 0) context.moveTo(geometry.x[sample]!, geometry.y[sample]!);
      else context.lineTo(geometry.x[sample]!, geometry.y[sample]!);
    }
    context.strokeStyle = '#E9B44C';
    context.lineWidth = 0.8;
    context.stroke();
  }
  if (overlayCorners.checked) {
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `${Math.max(2.7, 11 / scale)}px ui-monospace, monospace`;
    for (const corner of corners) {
      const index = corner.apexI;
      const x = track.x[index]!;
      const y = track.y[index]!;
      context.fillStyle = corner.passScore >= 1_000_000 ? '#7FBF6A' : '#F5F1E6';
      context.beginPath();
      context.arc(x, y, Math.max(2.2, 5 / scale), 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#221F2B';
      const radius = 1 / Math.max(1e-9, Math.abs(track.kSm[corner.apexI]!));
      const pass = overlayPass.checked ? ` · P${(corner.passScore / 1_000_000).toFixed(1)}` : '';
      context.fillText(`${cornerClass(track, corner)} · R${radius.toFixed(0)}${pass}`, x, y);
    }
  }
  if (overlayGeometry.checked && selection.candidate) {
    const generated = selection.candidate.geometry;
    const returnGroups = new Set(
      selection.candidate.tier0.metrics.closestSeparationGroups === 'none'
        ? []
        : selection.candidate.tier0.metrics.closestSeparationGroups.split(':')
    );
    for (const group of generated.groups) {
      if (!returnGroups.has(group.groupId)) continue;
      context.beginPath();
      for (let index = group.pointStart; index <= group.pointEnd; index++) {
        const point = generated.points[index];
        if (!point) continue;
        if (index === group.pointStart) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      }
      context.strokeStyle = 'rgba(127,191,106,.9)';
      context.lineWidth = Math.max(1.8, 4.5 / scale);
      context.stroke();
    }
    context.fillStyle = 'rgba(245,241,230,.55)';
    const pointStride = Math.max(1, Math.ceil(generated.points.length / 240));
    for (let index = 0; index < generated.points.length; index += pointStride) {
      const point = generated.points[index]!;
      context.beginPath();
      context.arc(point.x, point.y, Math.max(0.8, 2.2 / scale), 0, Math.PI * 2);
      context.fill();
    }
    context.textAlign = 'left';
    context.textBaseline = 'bottom';
    context.font = `${Math.max(2.5, 10 / scale)}px ui-monospace, monospace`;
    for (const group of generated.groups) {
      const entry = group.entryPose;
      const tangentLength = Math.max(14, 42 / scale);
      context.strokeStyle = group.role === 'grid-pit' ? '#7FBF6A' : '#6F8BC7';
      context.lineWidth = Math.max(0.7, 1.5 / scale);
      context.beginPath();
      context.moveTo(entry.x, entry.y);
      context.lineTo(
        entry.x + Math.cos(entry.heading) * tangentLength,
        entry.y + Math.sin(entry.heading) * tangentLength
      );
      context.stroke();
      context.fillStyle = group.role === 'grid-pit' ? '#7FBF6A' : '#6F8BC7';
      context.fillText(group.groupId, entry.x + 3 / scale, entry.y - 3 / scale);
      for (const knot of group.knots) {
        context.beginPath();
        context.arc(
          knot.pose.x,
          knot.pose.y,
          Math.max(1.4, 3.8 / scale),
          0,
          Math.PI * 2
        );
        context.fill();
      }
    }
  }
  context.restore();
}

function drawRhythm(selection: StudioSelection | null): void {
  const { context, width, height, dpr } = canvasSize(rhythmCanvas);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#181520';
  context.fillRect(0, 0, width, height);
  if (!selection) return;
  const track = selection.analysis.track;
  let maximum = 0;
  for (const value of track.kSm) maximum = Math.max(maximum, Math.abs(value));
  context.strokeStyle = '#E9B44C';
  context.lineWidth = 1.5;
  context.beginPath();
  for (let index = 0; index < track.n; index += Math.max(1, Math.floor(track.n / width))) {
    const x = index / track.n * width;
    const y = height / 2 - track.kSm[index]! / Math.max(1e-9, maximum) * (height * 0.42);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.strokeStyle = 'rgba(245,241,230,.25)';
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  if (selection.candidate) {
    const total = selection.candidate.geometry.groups.at(-1)?.sEnd ?? track.len;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.font = '9px ui-monospace, monospace';
    for (const group of selection.candidate.geometry.groups) {
      const x = group.sStart / Math.max(1, total) * width;
      context.strokeStyle = group.role === 'grid-pit'
        ? 'rgba(127,191,106,.8)'
        : 'rgba(127,160,197,.55)';
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
      context.fillStyle = group.role === 'grid-pit' ? '#7FBF6A' : '#AAA2B5';
      context.fillText(group.groupId, Math.min(width - 50, x + 3), 3);
    }
  }
}

function gateStatus(candidate: TrackgenCandidate, quality: TrackgenQualityEvaluation | null): void {
  gateList.replaceChildren();
  const results = [...candidate.tier0.gates, ...(quality?.gates ?? [])];
  for (const result of results) {
    const row = document.createElement('div');
    const normalStraight = result.id === 'trackgen.longest_straight_seconds' && result.value < 10;
    row.className = `gate ${result.status === 'fail' ? 'red' : normalStraight ? 'amber' : 'green'}`;
    const bounds = [
      result.minimum === undefined ? '' : `≥ ${result.minimum}`,
      result.maximum === undefined ? '' : `≤ ${result.maximum}`
    ].filter(Boolean).join(' · ');
    row.innerHTML = `<span>${result.id}</span><b>${Number.isFinite(result.value)
      ? result.value.toFixed(3) : String(result.value)} ${result.unit}</b><small>${bounds}</small>`;
    gateList.append(row);
  }
}

function legacyGateStatus(analysis: StudioAnalysis): void {
  const passSpots = analysis.corners.filter(
    corner => corner.passScore >= TRACKGEN_PASS_SPOT_SCORE
  ).length;
  const left = analysis.corners.filter(corner => corner.side > 0).length;
  const right = analysis.corners.length - left;
  const draft = analysis.draft;
  const rows = [
    { id: 'studio.draft_line', value: draft ? 1 : 0, unit: 'boolean', minimum: 1 },
    { id: 'trackgen.pass_spots', value: passSpots, unit: 'corners', minimum: 2 },
    {
      id: 'trackgen.semantic_corners', value: analysis.corners.length,
      unit: 'corners', minimum: 7
    },
    {
      id: 'trackgen.direction_balance', value: Math.min(left, right),
      unit: 'corners', minimum: 1
    },
    {
      id: 'trackgen.draft_heading_step', value: draft?.maxHeadingStep ?? Infinity,
      unit: 'rad', maximum: 0.18
    },
    {
      id: 'trackgen.draft_lap_seconds', value: draft?.timing.lapTime ?? Infinity,
      unit: 's', minimum: 55, maximum: 150
    }
  ];
  gateList.replaceChildren();
  for (const result of rows) {
    const passes = (result.minimum === undefined || result.value >= result.minimum) &&
      (result.maximum === undefined || result.value <= result.maximum);
    const row = document.createElement('div');
    row.className = `gate ${passes ? 'green' : 'red'}`;
    const bounds = [
      result.minimum === undefined ? '' : `≥ ${result.minimum}`,
      result.maximum === undefined ? '' : `≤ ${result.maximum}`
    ].filter(Boolean).join(' · ');
    row.innerHTML = `<span>${result.id}</span><b>${Number.isFinite(result.value)
      ? result.value.toFixed(3) : String(result.value)} ${result.unit}</b><small>${bounds}</small>`;
    gateList.append(row);
  }
}

function updateOutputs(selection: StudioSelection): void {
  const { definition, track, corners } = selection.analysis;
  const candidate = selection.candidate;
  const quality = selection.quality;
  const closure = candidate?.geometry.closure;
  const topology = candidate?.tier0.metrics.topology;
  const legacyPassSpots = corners.filter(
    corner => corner.passScore >= TRACKGEN_PASS_SPOT_SCORE
  ).length;
  definitionOutput.value = `export const GENERATED_TRACK = ${JSON.stringify(definition, null, 2)} ` +
    'satisfies TrackDefinition;';
  artifactOutput.value = JSON.stringify({
    schemaVersion: 2,
    generatorVersion: 'trackgen-topology-v2',
    signatureSchemaVersion: 2,
    signatureFingerprint: candidate ? stableFingerprint(signature) : null,
    definitionFingerprint: stableFingerprint(definition),
    provenanceHash: stableFingerprint({
      definition,
      tier0: candidate?.tier0.metrics ?? null,
      tier1: quality?.metrics ?? null
    }),
    seed: definition.seed,
    signatureId: candidate?.signatureId ?? definition.meta.signature ?? 'imported',
    resolvedPlan: candidate?.plan ?? null,
    realization: candidate ? {
      groups: candidate.geometry.groups,
      closure: candidate.geometry.closure
    } : null,
    tier0: candidate?.tier0 ?? null,
    tier1: quality,
    deeperValidation: { headlessProbe: 'pending', profileWorkflow: 'pending' }
  }, null, 2);
  metrics.innerHTML = [
    `<b>${definition.name}</b>`,
    `${track.len.toFixed(0)} m · ${track.n} samples`,
    `${corners.length} semantic corners`,
    `${quality?.metrics.passSpots ?? legacyPassSpots} pass spots`,
    `${(quality?.metrics.draftLapSeconds ?? selection.analysis.draft?.timing.lapTime)?.toFixed(2) ?? '—'} s draft lap`,
    `${(quality?.metrics.draftAverageSpeedKmh ?? (selection.analysis.draft
      ? track.len / selection.analysis.draft.timing.lapTime * 3.6 : undefined))?.toFixed(1) ?? '—'} km/h average`,
    closure
      ? `closure ${closure.residualAfter.positionMetres.toExponential(2)} m · ` +
        `${closure.iterations} iterations`
      : 'authored-track geometry',
    topology
      ? `hull fill ${topology.convexHullFill.toFixed(2)} · ` +
        `${topology.primaryAxisReversals}/${topology.secondaryAxisReversals} reversals · ` +
        `${topology.returnSectionPairs} returns`
      : 'topology measured by CLI for generated routes',
    `${selection.elapsedMilliseconds.toFixed(1)} ms interaction`
  ].map(value => `<span>${value}</span>`).join('');
  histogram.replaceChildren();
  const values = candidate?.tier0.metrics.cornerHistogram ?? cornerHistogram(track, corners);
  const classes = ['hairpin', 'slow', 'medium', 'fast', 'kink'] as const;
  const maximum = Math.max(1, ...classes.map(key => values[key]));
  for (const key of classes) {
    const bar = document.createElement('div');
    bar.className = 'histogram-row';
    const label = document.createElement('span');
    label.textContent = key;
    const meter = document.createElement('i');
    meter.style.width = `${values[key] / maximum * 100}%`;
    const count = document.createElement('b');
    count.textContent = String(values[key]);
    bar.append(label, meter, count);
    histogram.append(bar);
  }
}

function setSelection(selection: StudioSelection): void {
  active = selection;
  renderSignatureEditor();
  drawSelection(mainCanvas, active);
  drawSelection(compareCanvas, comparison);
  drawRhythm(active);
  updateOutputs(selection);
  if (selection.candidate) gateStatus(selection.candidate, selection.quality);
  else legacyGateStatus(selection.analysis);
}

function generate(archetype: TrackArchetype, seed: number): StudioSelection {
  const started = performance.now();
  const candidate = generateTier0Candidate({ archetype, seed, signature });
  const definition = definitionFromCandidate(candidate);
  let analysis: StudioAnalysis;
  try {
    analysis = analysisFor(definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusLine.textContent = `Draft analysis rejected this variation: ${message}. ` +
      'The last render is retained.';
    if (active) return active;
    throw error;
  }
  const quality = evaluateTrackQualityFromDraft(candidate, {
    track: analysis.track,
    corners: analysis.corners,
    draft: analysis.draft!
  });
  const selection = {
    analysis,
    candidate,
    quality,
    elapsedMilliseconds: performance.now() - started
  };
  setSelection(selection);
  statusLine.textContent = `${candidate.tier0.accepted ? 'Tier 0 accepted' : 'Tier 0 rejected'} · ` +
    `${quality.accepted ? 'Tier 1 accepted' : 'Tier 1 pending/rejected'} · ` +
    `${selection.elapsedMilliseconds.toFixed(1)} ms`;
  return selection;
}

function generateFromControls(): void {
  const raw = Number(seedInput.value);
  if (!Number.isInteger(raw)) throw new Error('Seed must be an integer');
  generate(archetypeInput.value as TrackArchetype, raw >>> 0);
}

function applyScramble(mode: RhythmScrambleMode, label: string): void {
  const raw = Number(seedInput.value);
  if (!Number.isInteger(raw)) throw new Error('Seed must be an integer');
  signature = scrambleRhythmSignatureV2({
    signature,
    seed: raw >>> 0,
    revision: scrambleRevision++,
    mode
  });
  renderSignatureEditor();
  generateFromControls();
  statusLine.textContent = `${label} · ${statusLine.textContent}`;
}

function replaceRange(
  range: readonly [number, number],
  bound: 0 | 1,
  value: number
): readonly [number, number] {
  const next: [number, number] = [range[0], range[1]];
  next[bound] = value;
  if (next[0] > next[1]) next[bound === 0 ? 1 : 0] = value;
  return next;
}

function replaceGroupLengthRange(
  groupIndex: number,
  bound: 0 | 1,
  value: number
): void {
  const groups = signature.groups.map((group, index) =>
    index === groupIndex
      ? { ...group, lengthMetres: replaceRange(group.lengthMetres, bound, value) }
      : group);
  signature = { ...signature, groups };
  renderSignatureEditor();
  generateFromControls();
}

function replaceGroupLobeRange(
  groupIndex: number,
  lobeIndex: number,
  bound: 0 | 1,
  value: number
): void {
  const groups = signature.groups.map((group, index) => {
    if (index !== groupIndex) return group;
    return {
      ...group,
      lobes: group.lobes.map((lobe, position) =>
        position === lobeIndex
          ? { ...lobe, angleDegrees: replaceRange(lobe.angleDegrees, bound, value) }
          : lobe)
    };
  });
  signature = { ...signature, groups };
  renderSignatureEditor();
  generateFromControls();
}

function replaceGroupKnotRange(
  groupIndex: number,
  knotIndex: number,
  field: 'at' | 'curvatureWeight',
  bound: 0 | 1,
  value: number
): void {
  const groups = signature.groups.map((group, index) => {
    if (index !== groupIndex) return group;
    const knots = knotsForGroup(group).map((knot, position) =>
      position === knotIndex
        ? { ...knot, [field]: replaceRange(knot[field], bound, value) }
        : { ...knot });
    return { ...group, motif: 'custom-compound' as const, knots };
  });
  signature = { ...signature, groups };
  renderSignatureEditor();
  generateFromControls();
}

function replaceGroupFlexRange(
  groupIndex: number,
  field: 'lengthDeltaMetres' | 'shallowBendBiasDelta',
  bound: 0 | 1,
  value: number
): void {
  const groups = signature.groups.map((group, index) => {
    if (index !== groupIndex || !group.flex?.[field]) return group;
    return {
      ...group,
      flex: {
        ...group.flex,
        [field]: replaceRange(group.flex[field], bound, value)
      }
    };
  });
  signature = { ...signature, groups };
  renderSignatureEditor();
  generateFromControls();
}

function replaceGroupFlexLobeRange(
  groupIndex: number,
  flexIndex: number,
  bound: 0 | 1,
  value: number
): void {
  const groups = signature.groups.map((group, index) => {
    if (index !== groupIndex || !group.flex) return group;
    return {
      ...group,
      flex: {
        ...group.flex,
        lobes: (group.flex.lobes ?? []).map((flex, position) =>
          position === flexIndex
            ? {
                ...flex,
                angleDeltaDegrees: replaceRange(flex.angleDeltaDegrees, bound, value)
              }
            : flex)
      }
    };
  });
  signature = { ...signature, groups };
  renderSignatureEditor();
  generateFromControls();
}

function rangeControl(
  range: readonly [number, number],
  minimum: number,
  maximum: number,
  step: number,
  onChange: (bound: 0 | 1, value: number) => void
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  range.forEach((value, bound) => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(minimum);
    input.max = String(maximum);
    input.step = String(step);
    input.value = String(value);
    const output = document.createElement('span');
    output.textContent = value.toFixed(step < 1 ? 2 : 0);
    input.addEventListener('input', () => { output.textContent = input.value; });
    input.addEventListener('change', () =>
      onChange(bound as 0 | 1, Number(input.value)));
    fragment.append(input, output);
  });
  return fragment;
}

function reorderMovableGroups(sourceIndex: number, targetIndex: number): void {
  const source = signature.groups[sourceIndex];
  const target = signature.groups[targetIndex];
  if (!source?.movable || source.kind === 'nominal-straight' ||
      !target?.movable || target.kind === 'nominal-straight')
    return;
  const groups = [...signature.groups];
  groups[sourceIndex] = target;
  groups[targetIndex] = source;
  signature = { ...signature, groups };
}

function groupRealizationSummary(group: RhythmGroupSpec): string {
  const realized = active?.candidate?.geometry.groups.find(item => item.groupId === group.id);
  if (!realized) return 'No current realization';
  const targetTurn = realized.lobes.reduce(
    (sum, lobe) => sum + lobe.targetAngleDegrees,
    0
  );
  const realizedTurn = realized.lobes.reduce(
    (sum, lobe) => sum + lobe.realizedAngleDegrees,
    0
  );
  const maximumCurvature = Math.max(0, ...realized.knots.map(knot => Math.abs(knot.kappa)));
  const radius = maximumCurvature > 1e-12 ? 1 / maximumCurvature : Infinity;
  const distortion = Math.abs(
    realized.realizedLengthMetres - realized.targetLengthMetres
  ) / Math.max(1, realized.targetLengthMetres);
  return `${realized.targetLengthMetres.toFixed(0)}→` +
    `${realized.realizedLengthMetres.toFixed(0)} m · turn ` +
    `${targetTurn.toFixed(1)}→${realizedTurn.toFixed(1)}° · ` +
    `Rmin ${Number.isFinite(radius) ? radius.toFixed(0) : '∞'} m · ` +
    `closure Δ ${(distortion * 100).toFixed(1)}%`;
}

function renderSignatureEditor(): void {
  signatureEditor.replaceChildren();
  signature.groups.forEach((group, index) => {
    const groupBlock = document.createElement('div');
    groupBlock.className = `group-block ${group.movable ? 'movable' : 'fixed'} ` +
      `${group.flex ? 'flex' : ''} ${group.role === 'grid-pit' ? 'grid-pit' : ''}`;
    const row = document.createElement('div');
    row.className = 'token-row';
    row.draggable = group.movable && group.kind !== 'nominal-straight';
    row.addEventListener('dragstart', () => { draggedGroup = index; });
    row.addEventListener('dragover', event => {
      if (row.draggable) event.preventDefault();
    });
    row.addEventListener('drop', event => {
      event.preventDefault();
      if (draggedGroup < 0 || draggedGroup === index) return;
      reorderMovableGroups(draggedGroup, index);
      draggedGroup = -1;
      renderSignatureEditor();
      generateFromControls();
    });
    row.addEventListener('dragend', () => { draggedGroup = -1; });
    const label = document.createElement('b');
    label.textContent = `${index + 1}. ${group.id} · ${group.motif}` +
      `${group.role ? ` · ${group.role}` : ''}${group.flex ? ' · flex' : ''}`;
    label.title = `${group.kind}; ${group.movable ? 'movable' : 'fixed'}; ` +
      `${group.lobes.length} turn lobe${group.lobes.length === 1 ? '' : 's'}`;
    row.append(
      label,
      rangeControl(group.lengthMetres, 80, 1_800, 10,
        (bound, value) => replaceGroupLengthRange(index, bound, value))
    );
    groupBlock.append(row);
    const realization = document.createElement('small');
    realization.className = 'group-realization';
    realization.textContent = groupRealizationSummary(group);
    groupBlock.append(realization);
    group.lobes.forEach((lobe, lobeIndex) => {
      const lobeRow = document.createElement('div');
      lobeRow.className = 'lobe-row';
      const lobeLabel = document.createElement('b');
      lobeLabel.textContent = `Lobe ${lobeIndex + 1} · knots ` +
        `${lobe.firstKnot}–${lobe.lastKnot}`;
      lobeRow.append(
        lobeLabel,
        rangeControl(lobe.angleDegrees, -220, 220, 1,
          (bound, value) => replaceGroupLobeRange(index, lobeIndex, bound, value))
      );
      groupBlock.append(lobeRow);
    });
    const details = document.createElement('details');
    details.className = 'group-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Knots, flow, and closure flex';
    details.append(summary);
    const knots = knotsForGroup(group);
    knots.forEach((knot, knotIndex) => {
      if (knotIndex > 0 && knotIndex < knots.length - 1) {
        const previous = knots[knotIndex - 1]!;
        const next = knots[knotIndex + 1]!;
        const atRow = document.createElement('div');
        atRow.className = 'detail-row';
        const atLabel = document.createElement('b');
        atLabel.textContent = `Knot ${knotIndex} position`;
        atRow.append(
          atLabel,
          rangeControl(
            knot.at,
            Math.min(0.99, previous.at[1] + 0.01),
            Math.max(0.01, next.at[0] - 0.01),
            0.01,
            (bound, value) =>
              replaceGroupKnotRange(index, knotIndex, 'at', bound, value)
          )
        );
        details.append(atRow);
      }
      const weightRow = document.createElement('div');
      weightRow.className = 'detail-row';
      const weightLabel = document.createElement('b');
      const flow = knotIndex === 0 ? 'entry flow' :
        knotIndex === knots.length - 1 ? 'exit flow' : 'curvature';
      weightLabel.textContent = `Knot ${knotIndex} ${flow}`;
      weightRow.append(
        weightLabel,
        rangeControl(knot.curvatureWeight, -2, 2, 0.01,
          (bound, value) =>
            replaceGroupKnotRange(index, knotIndex, 'curvatureWeight', bound, value))
      );
      details.append(weightRow);
    });
    if (group.flex?.lengthDeltaMetres) {
      const flexRow = document.createElement('div');
      flexRow.className = 'detail-row';
      const flexLabel = document.createElement('b');
      flexLabel.textContent = 'Closure length Δ m';
      flexRow.append(
        flexLabel,
        rangeControl(group.flex.lengthDeltaMetres, -600, 600, 10,
          (bound, value) =>
            replaceGroupFlexRange(index, 'lengthDeltaMetres', bound, value))
      );
      details.append(flexRow);
    }
    if (group.flex?.shallowBendBiasDelta) {
      const flexRow = document.createElement('div');
      flexRow.className = 'detail-row';
      const flexLabel = document.createElement('b');
      flexLabel.textContent = 'Shallow-bend bias Δ';
      flexRow.append(
        flexLabel,
        rangeControl(group.flex.shallowBendBiasDelta, -2, 2, 0.01,
          (bound, value) =>
            replaceGroupFlexRange(index, 'shallowBendBiasDelta', bound, value))
      );
      details.append(flexRow);
    }
    for (const [flexIndex, flex] of (group.flex?.lobes ?? []).entries()) {
      const flexRow = document.createElement('div');
      flexRow.className = 'detail-row';
      const flexLabel = document.createElement('b');
      flexLabel.textContent = `Closure lobe ${flex.lobe + 1} Δ°`;
      flexRow.append(
        flexLabel,
        rangeControl(flex.angleDeltaDegrees, -80, 80, 1,
          (bound, value) =>
            replaceGroupFlexLobeRange(index, flexIndex, bound, value))
      );
      details.append(flexRow);
    }
    groupBlock.append(details);
    signatureEditor.append(groupBlock);
  });
  signatureJson.value = JSON.stringify(signature, null, 2);
}

function importExisting(index: number): StudioSelection {
  const definition = TRACK_DEFS[index];
  if (!definition) throw new Error(`Unknown existing track index ${index}`);
  const started = performance.now();
  const selection: StudioSelection = {
    analysis: analysisFor(definition),
    candidate: null,
    quality: null,
    elapsedMilliseconds: performance.now() - started
  };
  setSelection(selection);
  statusLine.textContent = `Imported ${definition.name} · ${selection.elapsedMilliseconds.toFixed(1)} ms`;
  return selection;
}

function bindCanvasNavigation(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    viewTransform.zoom = Math.max(0.35, Math.min(5, viewTransform.zoom *
      (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
    drawSelection(mainCanvas, active);
    drawSelection(compareCanvas, comparison);
  }, { passive: false });
  let pointer: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', event => {
    pointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer) return;
    viewTransform.panX += event.clientX - pointer.x;
    viewTransform.panY += event.clientY - pointer.y;
    pointer = { x: event.clientX, y: event.clientY };
    drawSelection(mainCanvas, active);
    drawSelection(compareCanvas, comparison);
  });
  canvas.addEventListener('pointerup', () => { pointer = null; });
}

function bind(): void {
  for (const definition of TRACK_DEFS) {
    const option = document.createElement('option');
    option.value = String(existingInput.options.length);
    option.textContent = `${definition.no} · ${definition.name}`;
    existingInput.append(option);
  }
  archetypeInput.addEventListener('change', () => {
    signature = cloneSignature(signatureV2ForArchetype(archetypeInput.value as TrackArchetype));
    scrambleRevision = 0;
    renderSignatureEditor();
    generateFromControls();
  });
  seedInput.addEventListener('change', generateFromControls);
  element<HTMLButtonElement>('scramble-all').addEventListener('click', () =>
    applyScramble('both', 'Corner order and parameters scrambled'));
  element<HTMLButtonElement>('scramble-parameters').addEventListener('click', () =>
    applyScramble('parameters', 'Corner parameters scrambled'));
  element<HTMLButtonElement>('scramble-ordering').addEventListener('click', () =>
    applyScramble('ordering', 'Corner order scrambled'));
  element<HTMLButtonElement>('pin-compare').addEventListener('click', () => {
    comparison = active;
    compareCanvas.hidden = comparison === null;
    drawSelection(compareCanvas, comparison);
  });
  element<HTMLButtonElement>('reset-view').addEventListener('click', () => {
    Object.assign(viewTransform, { zoom: 1, panX: 0, panY: 0 });
    drawSelection(mainCanvas, active);
    drawSelection(compareCanvas, comparison);
  });
  element<HTMLButtonElement>('load-existing').addEventListener('click', () =>
    importExisting(Number(existingInput.value)));
  element<HTMLButtonElement>('import-definition').addEventListener('click', () => {
    const definition = JSON.parse(importInput.value) as TrackDefinition;
    const started = performance.now();
    setSelection({
      analysis: analysisFor(definition),
      candidate: null,
      quality: null,
      elapsedMilliseconds: performance.now() - started
    });
  });
  element<HTMLButtonElement>('load-signature').addEventListener('click', () => {
    const input = JSON.parse(signatureJson.value) as RhythmSignatureInput;
    signature = normalizeRhythmSignature(input);
    archetypeInput.value = signature.archetype;
    scrambleRevision = 0;
    renderSignatureEditor();
    generateFromControls();
    if (input.schemaVersion === 1)
      statusLine.textContent = `Migrated schema v1 signature to v2 · ${statusLine.textContent}`;
  });
  element<HTMLButtonElement>('copy-signature').addEventListener('click', () => {
    signatureJson.select();
    document.execCommand('copy');
    statusLine.textContent = 'Signature JSON selected and copied.';
  });
  element<HTMLButtonElement>('load-artifact').addEventListener('click', () => {
    const artifact = JSON.parse(deepArtifactInput.value) as {
      deeperValidation?: { headlessProbe?: string; profileWorkflow?: string };
      provenanceHash?: string;
    };
    deepArtifactStatus.textContent = `Artifact ${artifact.provenanceHash ?? 'without hash'} · ` +
      `headless ${artifact.deeperValidation?.headlessProbe ?? 'unknown'} · ` +
      `profile ${artifact.deeperValidation?.profileWorkflow ?? 'unknown'}`;
  });
  for (const toggle of [
    overlayLine, overlayCorners, overlayPass, overlayBraking, overlayStraight,
    overlayGeometry
  ])
    toggle.addEventListener('change', () => drawSelection(mainCanvas, active));
  bindCanvasNavigation(mainCanvas);
  bindCanvasNavigation(compareCanvas);
  window.addEventListener('resize', () => {
    drawSelection(mainCanvas, active);
    drawSelection(compareCanvas, comparison);
    drawRhythm(active);
  });
}

export function startTrackStudio(): TrackStudioApi {
  bind();
  renderSignatureEditor();
  const api: TrackStudioApi = {
    ready: true,
    existingTrackCount: TRACK_DEFS.length,
    generateSnapshot: (archetype, seed) => generateTier0Candidate({
      archetype,
      seed,
      signature: signatureV2ForArchetype(archetype)
    }),
    generate: (archetype, seed) => {
      archetypeInput.value = archetype;
      signature = cloneSignature(signatureV2ForArchetype(archetype));
      scrambleRevision = 0;
      seedInput.value = String(seed >>> 0);
      renderSignatureEditor();
      const selection = generate(archetype, seed >>> 0);
      return {
        fingerprint: stableFingerprint(selection.candidate),
        elapsedMilliseconds: selection.elapsedMilliseconds,
        accepted: selection.candidate?.tier0.accepted ?? false
      };
    },
    scrambleSnapshot: (archetype, seed, revision, mode) =>
      scrambleRhythmSignatureV2({
        signature: signatureV2ForArchetype(archetype),
        seed,
        revision,
        mode
      }),
    importExisting: index => {
      const selection = importExisting(index);
      return {
        id: selection.analysis.definition.id,
        samples: selection.analysis.track.n,
        lengthMetres: selection.analysis.track.len,
        corners: selection.analysis.corners.length,
        valid: selection.analysis.draft !== null
      };
    }
  };
  generate('balanced', Number(seedInput.value) >>> 0);
  return api;
}
