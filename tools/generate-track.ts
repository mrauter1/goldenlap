import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  generateAcceptedTrack,
  generateTier0Candidate,
  normalizeRhythmSignature,
  scrambleRhythmSignatureV2,
  signatureV2ForArchetype,
  type RhythmSignatureInput,
  type RhythmSignatureV2,
  type RhythmScrambleMode,
  type TrackArchetype
} from '../src/game/trackgen';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function integerArgument(name: string, fallback: number): number {
  const raw = argument(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function archetypeArgument(): TrackArchetype {
  const raw = argument('--archetype') ?? 'balanced';
  if (raw !== 'power' && raw !== 'balanced' && raw !== 'technical')
    throw new Error('--archetype must be power, balanced, or technical');
  return raw;
}

function signatureArgument(): RhythmSignatureInput | undefined {
  const file = argument('--signature');
  if (!file) return undefined;
  return JSON.parse(readFileSync(resolve(file), 'utf8')) as RhythmSignatureInput;
}

function scrambleModeArgument(): RhythmScrambleMode | null {
  const value = argument('--scramble-mode');
  if (value === null) return null;
  if (value !== 'parameters' && value !== 'ordering' && value !== 'both')
    throw new Error('--scramble-mode must be parameters, ordering, or both');
  return value;
}

function resolvedSignature(archetype: TrackArchetype): RhythmSignatureV2 {
  const input = signatureArgument();
  if (input?.schemaVersion === 1)
    process.stderr.write('Migrating schema v1 rhythm signature to schema v2.\n');
  let signature = normalizeRhythmSignature(input ?? signatureV2ForArchetype(archetype));
  const mode = scrambleModeArgument();
  if (mode !== null) {
    signature = scrambleRhythmSignatureV2({
      signature,
      seed: integerArgument('--seed', 101) >>> 0,
      revision: integerArgument('--scramble-revision', 0),
      mode
    });
  }
  return signature;
}

function sourceSnippet(value: ReturnType<typeof generateAcceptedTrack>['definition']): string {
  return `import type { TrackDefinition } from './src/shared/types';\n\n` +
    `export const GENERATED_TRACK = ${JSON.stringify(value, null, 2)} ` +
    `satisfies TrackDefinition;\n`;
}

try {
  const archetype = archetypeArgument();
  const seed = integerArgument('--seed', 101);
  const signature = resolvedSignature(archetype);
  if (process.argv.includes('--signature-only')) {
    process.stdout.write(`${JSON.stringify(
      signature,
      null,
      process.argv.includes('--json') ? 0 : 2
    )}\n`);
  } else if (process.argv.includes('--tier0-only')) {
    const candidate = generateTier0Candidate({
      archetype,
      seed,
      ...(signature === undefined ? {} : { signature })
    });
    process.stdout.write(`${JSON.stringify(candidate, null, process.argv.includes('--json') ? 0 : 2)}\n`);
    if (!candidate.tier0.accepted) process.exitCode = 1;
  } else {
    const generated = generateAcceptedTrack({
      archetype,
      seed,
      maximumAttempts: integerArgument('--max-attempts', 50),
      ...(signature === undefined ? {} : { signature }),
      ...(argument('--id') === null ? {} : { id: argument('--id')! }),
      ...(argument('--name') === null ? {} : { name: argument('--name')! })
    });
    const output = {
      schemaVersion: 2,
      attempts: generated.attempts,
      definition: generated.definition,
      artifact: generated.artifact,
      ...(process.argv.includes('--debug-json') ? {
        debug: {
          controlPoints: generated.candidate.geometry.points,
          groups: generated.candidate.geometry.groups,
          closure: generated.candidate.geometry.closure
        }
      } : {}),
      tsSnippet: sourceSnippet(generated.definition)
    };
    const outputDirectory = argument('--output-dir');
    if (outputDirectory) {
      const directory = resolve(outputDirectory);
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, 'definition.json'),
        `${JSON.stringify(generated.definition, null, 2)}\n`);
      writeFileSync(resolve(directory, 'generation-artifact.json'),
        `${JSON.stringify(generated.artifact, null, 2)}\n`);
      writeFileSync(resolve(directory, 'track-definition.ts'), sourceSnippet(generated.definition));
    }
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(output)}\n`);
    else process.stdout.write(
      `${generated.definition.id}: accepted ${archetype} seed ${generated.candidate.seed} ` +
      `in ${generated.attempts} attempt(s); ${generated.candidate.tier0.metrics.lengthMetres.toFixed(0)} m; ` +
      `${generated.quality.metrics.passSpots} pass spots\n`
    );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
