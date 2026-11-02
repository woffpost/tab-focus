// Downloads the model the build packs into the extension. Runs before every build and
// does nothing when the files are already there and match their checksums.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
// Pinned: accuracy was measured on this exact revision.
const REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
const FILES = {
  'config.json': '05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7',
  'tokenizer.json': 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441',
  'tokenizer_config.json': '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2',
  'onnx/model_quantized.onnx': '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
};

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

for (const [file, expected] of Object.entries(FILES)) {
  const path = join('models', MODEL, file);
  if (existsSync(path) && sha256(readFileSync(path)) === expected) continue;

  console.log(`Downloading ${file}`);
  const response = await fetch(`https://huggingface.co/${MODEL}/resolve/${REVISION}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== expected) throw new Error(`${file}: checksum mismatch`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}
