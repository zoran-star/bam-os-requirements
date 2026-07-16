// Mobile screenshot helper for the fast dev loop (no Vercel needed).
// Usage: node scripts/mobshot.mjs <url-path> <out.png>
// Example: node scripts/mobshot.mjs /client-portal.html /tmp/client.png
import { chromium } from 'playwright-core';

const path = process.argv[2] || '/client-portal.html';
const out = process.argv[3] || '/tmp/mobshot.png';
const base = 'http://localhost:5173';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 14/15 logical size
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('shot -> ' + out);
