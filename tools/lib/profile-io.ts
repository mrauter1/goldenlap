import type { TrackProfile } from '../../src/core/model';
import { stableJson } from '../../src/shared/stable-json';

function profileMarker(trackId: string): RegExp {
  const escaped = trackId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`trackId\\s*:\\s*['\"]${escaped}['\"]|['\"]trackId['\"]\\s*:\\s*['\"]${escaped}['\"]`);
}

function containingObjectStart(source: string, markerIndex: number): number {
  const stack: number[] = [];
  let quote = '';
  let escaped = false;
  for (let index = 0; index < markerIndex; index++) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') stack.push(index);
    else if (character === '}') stack.pop();
  }
  const start = stack.at(-1);
  if (start === undefined) throw new Error('Profile object start not found');
  return start;
}

function objectSpan(source: string, markerIndex: number): { start: number; end: number } {
  const start = containingObjectStart(source, markerIndex);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return { start, end: index + 1 };
  }
  throw new Error('Profile object end not found');
}

export function serializeTrackProfile(profile: TrackProfile, indentation = 2): string {
  return stableJson(profile, indentation);
}

/** Replace one generated entry while preserving every other byte in the source file. */
export function updateTrackProfileSource(source: string, profile: TrackProfile): string {
  const marker = profileMarker(profile.trackId).exec(source);
  if (!marker) throw new Error(`TrackProfile entry ${profile.trackId} not found`);
  const span = objectSpan(source, marker.index);
  const lineStart = source.lastIndexOf('\n', span.start) + 1;
  const indentation = source.slice(lineStart, span.start);
  const replacement = serializeTrackProfile(profile, 2)
    .split('\n')
    .map((line, index) => index === 0 ? line : indentation + line)
    .join('\n');
  return source.slice(0, span.start) + replacement + source.slice(span.end);
}

export function upsertTrackProfileSource(source: string, profile: TrackProfile): string {
  try {
    return updateTrackProfileSource(source, profile);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('not found')) throw error;
  }
  const closing = source.lastIndexOf('\n] as const satisfies readonly TrackProfile[];');
  if (closing < 0) throw new Error('TrackProfile array closing marker not found');
  const serialized = serializeTrackProfile(profile, 2).split('\n')
    .map(line => `  ${line}`).join('\n');
  const before = source.slice(0, closing).replace(/\s*$/, '');
  return `${before},\n${serialized}${source.slice(closing)}`;
}
