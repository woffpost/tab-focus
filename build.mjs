import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const ORT = 'node_modules/onnxruntime-web/dist';

rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });

await build({
  entryPoints: ['src/background.js', 'src/offscreen.js', 'src/popup.js'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome117',
  logLevel: 'warning',
});

cpSync('models', 'dist/models', { recursive: true });

mkdirSync('dist/ort');
for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  cpSync(`${ORT}/${file}`, `dist/ort/${file}`);
}
