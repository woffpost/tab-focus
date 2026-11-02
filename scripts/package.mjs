// Packs the built extension into the zip the Chrome Web Store takes, manifest at the root.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const { version: packageVersion } = JSON.parse(readFileSync('package.json', 'utf8'));
if (version !== packageVersion) {
  throw new Error(`manifest.json has ${version}, package.json has ${packageVersion}`);
}

const zip = resolve(`release/tab-focus-${version}.zip`);
mkdirSync('release', { recursive: true });
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.', '-x', '*.DS_Store'], { cwd: 'dist' });
console.log(`${zip} (${(statSync(zip).size / 1e6).toFixed(0)} MB)`);
