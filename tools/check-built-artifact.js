#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bundle = path.join(root, 'dist', 'goldenlap.js');
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

if (!fs.existsSync(bundle)) {
  console.error('Missing dist/goldenlap.js; run bun run build first.');
  process.exit(1);
}
const inputs = [
  'index.html', 'golden-lap.html', 'package.json', 'bun.lock', 'tsconfig.json',
  ...filesBelow(path.join(root, 'src'), '.ts').map(file => path.relative(root, file))
].map(file => path.join(root, file)).filter(fs.existsSync);
const builtAt = fs.statSync(bundle).mtimeMs;
const stale = inputs.filter(file => fs.statSync(file).mtimeMs > builtAt + 1);
if (stale.length) {
  console.error(`Stale dist/goldenlap.js; newer inputs:\n${stale.map(file => `- ${path.relative(root, file)}`).join('\n')}`);
  process.exit(1);
}
const source = fs.readFileSync(bundle, 'utf8');
if (!source.trim() || !source.includes('window.__GL')) {
  console.error('Built artifact is empty or does not install window.__GL.');
  process.exit(1);
}
if (production && /sourceMappingURL\s*=/.test(source)) {
  console.error('Production artifact contains a sourceMappingURL.');
  process.exit(1);
}
console.log(`Built artifact OK: ${path.relative(root, bundle)} (${fs.statSync(bundle).size} bytes)`);
