import { env, pipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('ort/');
env.backends.onnx.wasm.numThreads = 1;

let extractor;

function loadExtractor() {
  extractor ??= pipeline('feature-extraction', MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: ({ status, progress }) => {
      if (status === 'progress') {
        chrome.runtime.sendMessage({ type: 'model-progress', progress: Math.round(progress) }).catch(() => {});
      }
    },
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
  if (message.type !== 'embed') return;
  embed(message.text).then(
    (vector) => respond({ vector }),
    (error) => respond({ error: String(error?.message ?? error) }),
  );
  return true;
});
