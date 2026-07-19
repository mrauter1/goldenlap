#!/usr/bin/env node
'use strict';

// Build reproducible contact sheets from the exact motion-capture index. The
// sheets are review aids only; they do not mark the capture or release manifest
// as reviewed.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { browserName, launchBrowser } = require('./lib/browser');
const { emitAuditEvent } = require('./lib/audit-events');

const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.argv[2] ||
  path.join(root, 'output', 'playwright', 'firefox-dynamic-motion'));
const indexPath = path.join(directory, 'racecraft-capture-index.json');
const bundlePath = path.join(root, 'dist', 'goldenlap.js');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function imageData(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

(async () => {
  emitAuditEvent('motion-review', 'suite-start', {
    browser: browserName,
    directory,
    status: 'running'
  });
  if (!fs.existsSync(indexPath)) throw new Error(`Missing capture index: ${indexPath}`);
  if (!fs.existsSync(bundlePath)) throw new Error(`Missing bundle: ${bundlePath}`);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (!index.ok || !Array.isArray(index.motionCaptures) || !index.motionCaptures.length)
    throw new Error('Capture index has no successful motion matrix');

  const tracks = [...new Set(index.motionCaptures.map(capture => capture.track))];
  const categories = [...new Set(index.motionCaptures.map(capture => capture.label))];
  const speeds = [...new Set(index.motionCaptures.flatMap(capture =>
    capture.speeds.map(speed => speed.speed)))];
  const expected = tracks.length * categories.length;
  if (index.motionCaptures.length !== expected)
    throw new Error(`Expected ${expected} category/track captures, got ${index.motionCaptures.length}`);

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const outputs = [];
  for (const speed of speeds) {
    for (const category of categories) {
      const captures = tracks.map(track => index.motionCaptures.find(capture =>
        capture.track === track && capture.label === category));
      if (captures.some(capture => !capture || !capture.ok))
        throw new Error(`Incomplete ${speed}/${category} capture row`);
      const rows = captures.map(capture => {
        const speedCapture = capture.speeds.find(item => item.speed === speed);
        if (!speedCapture || !speedCapture.ok || speedCapture.files.length !== 3)
          throw new Error(`Incomplete ${speed}/${category}/${capture.track} sequence`);
        const frames = speedCapture.files.map((relative, frame) => {
          const file = path.join(directory, relative);
          if (!fs.existsSync(file)) throw new Error(`Missing frame: ${file}`);
          return `<figure><img src="${imageData(file)}"><figcaption>frame ${frame + 1}</figcaption></figure>`;
        }).join('');
        return `<section><h2>${escapeHtml(capture.track)}</h2><div class="frames">${frames}</div></section>`;
      }).join('');
      const title = `${speed} · ${category}`;
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>
        *{box-sizing:border-box}body{margin:0;padding:18px;background:#181a17;color:#f4f0df;
        font:14px system-ui,sans-serif}header{display:flex;justify-content:space-between;
        align-items:end;margin:0 0 14px}h1{margin:0;font-size:25px}header small{color:#a8ad9f}
        section{margin:0 0 14px;padding:10px;background:#252820;border:1px solid #44493c;
        border-radius:8px}h2{margin:0 0 8px;font-size:16px;text-transform:uppercase;
        letter-spacing:.08em}.frames{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        figure{margin:0}img{display:block;width:100%;height:auto;border:1px solid #555b4d}
        figcaption{text-align:center;color:#a8ad9f;margin-top:3px;font-size:11px}
      </style><header><h1>${escapeHtml(title)}</h1><small>bundle ${sha256(bundlePath).slice(0, 16)} · capture ${escapeHtml(index.generatedAt)}</small></header>${rows}`);
      await page.waitForFunction(() => [...document.images].every(image =>
        image.complete && image.naturalWidth > 0));
      const output = path.join(directory, `review-${speed}-${category}.png`);
      await page.screenshot({ path: output, fullPage: true });
      outputs.push(path.relative(root, output));
      emitAuditEvent('motion-review', 'case-result', {
        phase: speed,
        caseId: category,
        status: 'green',
        completed: outputs.length,
        total: speeds.length * categories.length,
        output: path.relative(root, output)
      });
    }
  }
  await browser.close();
  console.log(JSON.stringify({
    ok: true,
    browser: browserName,
    captureGeneratedAt: index.generatedAt,
    bundleSha256: sha256(bundlePath),
    sheets: outputs.length,
    outputs
  }, null, 2));
  emitAuditEvent('motion-review', 'suite-result', {
    browser: browserName,
    status: 'green',
    sheets: outputs.length
  });
})().catch(error => {
  emitAuditEvent('motion-review', 'failure', {
    browser: browserName,
    status: 'failed',
    message: error && error.message || String(error)
  });
  console.error(error && error.stack || error);
  process.exit(1);
});
