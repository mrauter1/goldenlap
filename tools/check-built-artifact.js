#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bundles = [
  { file: path.join(root, 'dist', 'goldenlap.js'), marker: 'window.__GL' },
  { file: path.join(root, 'dist', 'track-studio.js'), marker: 'window.__GL_STUDIO' }
];
const production = process.argv.includes('--expect-production');

function filesBelow(directory, suffix) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesBelow(full, suffix));
    else if (!suffix || full.endsWith(suffix)) output.push(full);
  }
  return output;
}

const missing = bundles.filter(bundle => !fs.existsSync(bundle.file));
if (missing.length) {
  console.error(`Missing built artifact(s): ${missing.map(bundle =>
    path.relative(root, bundle.file)).join(', ')}; run bun run build first.`);
  process.exit(1);
}
const inputs = [
  'index.html', 'track-studio.html', 'golden-lap.html', 'package.json', 'bun.lock', 'tsconfig.json',
  ...filesBelow(path.join(root, 'src'), '.ts').map(file => path.relative(root, file))
].map(file => path.join(root, file)).filter(fs.existsSync);
for (const bundle of bundles) {
  const builtAt = fs.statSync(bundle.file).mtimeMs;
  const stale = inputs.filter(file => fs.statSync(file).mtimeMs > builtAt + 1);
  if (stale.length) {
    console.error(`Stale ${path.relative(root, bundle.file)}; newer inputs:\n${stale.map(file =>
      `- ${path.relative(root, file)}`).join('\n')}`);
    process.exit(1);
  }
  const source = fs.readFileSync(bundle.file, 'utf8');
  if (!source.trim() || !source.includes(bundle.marker)) {
    console.error(`${path.relative(root, bundle.file)} is empty or does not install ${bundle.marker}.`);
    process.exit(1);
  }
  if (production && /sourceMappingURL\s*=/.test(source)) {
    console.error(`Production artifact ${path.relative(root, bundle.file)} contains a sourceMappingURL.`);
    process.exit(1);
  }
}
console.log(`Built artifacts OK: ${bundles.map(bundle =>
  `${path.relative(root, bundle.file)} (${fs.statSync(bundle.file).size} bytes)`).join(', ')}`);
