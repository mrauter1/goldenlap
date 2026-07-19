#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const failures = [];
const productionLayers = new Set(['shared', 'data', 'core', 'session', 'game', 'ui']);
const allowed = {
  shared: new Set(['shared']),
  data: new Set(['data', 'shared']),
  core: new Set(['core', 'shared']),
  session: new Set(['session', 'core', 'shared']),
  game: new Set(['game', 'session', 'core', 'data', 'shared']),
  ui: new Set(['ui', 'game', 'session', 'core', 'data', 'shared'])
};

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function layerOf(file) {
  const rel = relative(file);
  const parts = rel.split('/');
  if (parts[0] !== 'src') return null;
  if (productionLayers.has(parts[1])) return parts[1];
  if (parts[1] === 'main.ts') return 'main';
  if (parts[1] === 'track-studio-main.ts') return 'track-studio';
  if (parts[1] === 'test-api.ts') return 'test-api';
  if (parts[1] === 'globals.d.ts') return 'globals';
  return null;
}

function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base, `${base}.ts`, `${base}.d.ts`, path.join(base, 'index.ts')];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

const files = walk(src).filter(file => file.endsWith('.ts'));
const graph = new Map(files.map(file => [file, []]));
const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

for (const file of files) {
  const rel = relative(file);
  const text = fs.readFileSync(file, 'utf8');
  const layer = layerOf(file);
  if (!layer) failures.push(`${rel}: source file is outside the documented ownership tree`);
  if (/@ts-(?:ignore|expect-error|nocheck)/.test(text))
    failures.push(`${rel}: TypeScript suppression`);
  if (/(?:\bas\s+any\b|:\s*any\b|<any>|\bany\[\]|Array\s*<\s*any\s*>)/.test(text))
    failures.push(`${rel}: explicit any escape hatch`);
  if (/\b(?:eval|Function)\s*\(/.test(text)) failures.push(`${rel}: dynamic code execution`);
  if (/\bimport\s*\(/.test(text)) failures.push(`${rel}: dynamic import`);
  if (/https?:\/\//.test(text)) failures.push(`${rel}: runtime/network URL`);
  if (/\bfetch\s*\(/.test(text)) failures.push(`${rel}: network fetch`);
  if (layer === 'shared' || layer === 'core' || layer === 'session') {
    if (/\b(?:window|document|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|Path2D|AudioContext|OscillatorType|requestAnimationFrame)\b/.test(text))
      failures.push(`${rel}: browser dependency in ${layer}`);
  }

  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier) continue;
    if (!specifier.startsWith('.')) {
      if (!specifier.startsWith('bun')) failures.push(`${rel}: runtime package import ${specifier}`);
      continue;
    }
    const target = resolveImport(file, specifier);
    if (!target) {
      failures.push(`${rel}: unresolved source import ${specifier}`);
      continue;
    }
    if (!target.startsWith(`${src}${path.sep}`)) {
      failures.push(`${rel}: import escapes src (${specifier})`);
      continue;
    }
    graph.get(file).push(target);
    const targetLayer = layerOf(target);
    if (productionLayers.has(layer) && targetLayer && !allowed[layer].has(targetLayer))
      failures.push(`${rel}: forbidden ${layer} -> ${targetLayer} import (${specifier})`);
    if (layer !== 'main' && layer !== 'globals' && targetLayer === 'test-api')
      failures.push(`${rel}: only main.ts may import test-api.ts`);
    if (layer !== 'main' && targetLayer === 'main')
      failures.push(`${rel}: production module imports the composition root`);
    if (layer !== 'track-studio' && targetLayer === 'track-studio')
      failures.push(`${rel}: production module imports the studio composition root`);
    if (layer === 'track-studio' && targetLayer !== 'ui')
      failures.push(`${rel}: studio composition root may import only the ui layer`);
  }
}

const visiting = new Set();
const visited = new Set();
function visit(file, stack) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    failures.push(`circular import: ${stack.slice(start).concat(file).map(relative).join(' -> ')}`);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const target of graph.get(file) || []) visit(target, stack);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}
for (const file of files) visit(file, []);

if (fs.existsSync(path.join(src, 'legacy-main.ts')))
  failures.push('src/legacy-main.ts: temporary migration shell still exists');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const indexScripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
if (indexScripts.length !== 1) failures.push(`index.html: expected one script tag, found ${indexScripts.length}`);
else {
  const [, attributes, body] = indexScripts[0];
  if (body.trim()) failures.push('index.html: inline executable script body');
  if (!/\bdefer\b/i.test(attributes) || !/\bsrc=["']\.\/dist\/goldenlap\.js["']/i.test(attributes))
    failures.push('index.html: script must be one deferred ./dist/goldenlap.js reference');
}
const studioHtml = fs.readFileSync(path.join(root, 'track-studio.html'), 'utf8');
const studioScripts = [...studioHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
if (studioScripts.length !== 1)
  failures.push(`track-studio.html: expected one script tag, found ${studioScripts.length}`);
else {
  const [, attributes, body] = studioScripts[0];
  if (body.trim()) failures.push('track-studio.html: inline executable script body');
  if (!/\bdefer\b/i.test(attributes) ||
      !/\bsrc=["']\.\/dist\/track-studio\.js["']/i.test(attributes))
    failures.push('track-studio.html: script must be one deferred ./dist/track-studio.js reference');
}
const redirectHtml = fs.readFileSync(path.join(root, 'golden-lap.html'), 'utf8');
if (/<script\b/i.test(redirectHtml)) failures.push('golden-lap.html: redirect must be script-free');
if (!/<meta\s+http-equiv=["']refresh["'][^>]+url=index\.html/i.test(redirectHtml))
  failures.push('golden-lap.html: missing script-free index.html redirect');

const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/);
if (!ignored.includes('dist/')) failures.push('.gitignore: dist/ must be generated and ignored');
const indexPath = path.join(root, '.git', 'index');
if (fs.existsSync(indexPath)) {
  const index = fs.readFileSync(indexPath);
  if (index.toString('ascii', 0, 4) !== 'DIRC' || index.readUInt32BE(4) !== 2) {
    failures.push('.git/index: unsupported format while checking generated artifacts');
  } else {
    const count = index.readUInt32BE(8);
    let offset = 12;
    const trackedDist = [];
    for (let entry = 0; entry < count && offset + 62 <= index.length; entry++) {
      const start = offset;
      const flags = index.readUInt16BE(offset + 60);
      offset += 62 + ((flags & 0x4000) ? 2 : 0);
      const end = index.indexOf(0, offset);
      if (end < 0) break;
      const tracked = index.toString('utf8', offset, end);
      if (tracked === 'dist' || tracked.startsWith('dist/')) trackedDist.push(tracked);
      offset = start + Math.ceil((end + 1 - start) / 8) * 8;
    }
    if (trackedDist.length)
      failures.push(`generated dist artifact is tracked: ${trackedDist.join(', ')}`);
  }
}

const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/parity/manifest.json'), 'utf8'));
const apiSource = fs.readFileSync(path.join(src, 'test-api.ts'), 'utf8');
for (const item of fixture.runtime.api) {
  const escaped = item.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`\\b${escaped}\\b`).test(apiSource))
    failures.push(`src/test-api.ts: missing frozen public API key ${item.key}`);
}

if (failures.length) {
  const unique = [...new Set(failures)];
  console.error(`Boundary check failed (${unique.length}):\n${unique.map(item => `- ${item}`).join('\n')}`);
  process.exit(1);
}
console.log(`Module boundaries OK: ${files.length} TypeScript files, acyclic imports, strict browser separation, script-free entries`);
