'use strict';

const { chromium, firefox, webkit } = require('playwright');

const browserName = process.env.GOLDENLAP_BROWSER || 'chromium';
const browserTypes = { chromium, firefox, webkit };

if (!Object.prototype.hasOwnProperty.call(browserTypes, browserName))
  throw new Error(`Unsupported GOLDENLAP_BROWSER=${browserName}; expected chromium, firefox, or webkit`);

/** Launch the selected repository-pinned Playwright engine. Chromium remains the default. */
function launchBrowser(options = {}) {
  const launchOptions = { ...options };
  // Chromium command-line flags are not portable to Firefox/WebKit.
  if (browserName !== 'chromium') delete launchOptions.args;
  return browserTypes[browserName].launch(launchOptions);
}

module.exports = { browserName, launchBrowser };
