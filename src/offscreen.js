import { env, pipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

// The model ships inside the extension, and nothing here may touch the network.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('ort/');
env.backends.onnx.wasm.numThreads = 1;

let extractor;

function loadExtractor() {
  extractor ??= pipeline('feature-extraction', MODEL, {
    device: 'wasm',
    dtype: 'q8',
  }).catch((error) => {
    // Otherwise one failed load would keep failing every later attempt.
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
