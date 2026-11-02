// Renders assets/icon.svg into the PNG sizes the manifest lists. Run after changing the icon.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SIZES = [16, 32, 48, 128];
// The store wants 128 px with 16 px of transparent padding. Smaller sizes need every pixel.
const CROPPED = 'viewBox="16 16 96 96"';
const svg = readFileSync('assets/icon.svg', 'utf8');

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const source = size === 128 ? svg : svg.replace(/viewBox="[^"]*"/, CROPPED);
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<!doctype html><style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
    await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
