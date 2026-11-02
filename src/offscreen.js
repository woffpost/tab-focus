import { env, pipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
// Pinned: accuracy was measured on this exact model, and 'main' can change under it.
const MODEL_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('ort/');
env.backends.onnx.wasm.numThreads = 1;

let extractor;
let lastProgress;

// The library reports every chunk of every file, which is thousands of events per download.
function reportProgress(info) {
  if (info.status !== 'progress_total') return;
  const percent = Math.round(info.progress);
  if (percent === lastProgress) return;
  lastProgress = percent;
  chrome.runtime.sendMessage({ type: 'model-progress', progress: percent }).catch(() => {});
}

function loadExtractor() {
  extractor ??= pipeline('feature-extraction', MODEL, {
    revision: MODEL_REVISION,
    device: 'wasm',
    dtype: 'q8',
    progress_callback: reportProgress,
  }).catch((error) => {
    // Otherwise one failed download would keep failing every later attempt.
    extractor = null;
    throw error;
  });
  return extractor;
}

async function embed(text) {
  const extract = await loadExtractor();
  const output = await extract(text, { pooling: 'mean', normalize: true });
  // Rounded so vectors stay small inside chrome.storage.session.
  return Array.from(output.data, (value) => Math.round(value * 1e4) / 1e4);
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== 'embed') return undefined;
  embed(message.text).then(
    (vector) => respond({ vector }),
    (error) => respond({ error: String(error?.message ?? error) }),
  );
  return true;
});
