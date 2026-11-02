// Client of the offscreen document that hosts the model: a service worker cannot run it itself.

// Lives as long as the worker, which keeps it small. Picking a suggestion repeats
// the titles just embedded, and this saves reloading the model for them.
const vectors = new Map();
let inFlight = 0;

export const isEmbedding = () => inFlight > 0;

async function request(text) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Runs the local embedding model that compares tab titles with the topic.',
    });
  }
  const { vector, error } = await chrome.runtime.sendMessage({ type: 'embed', text });
  if (error) throw new Error(error);
  return vector;
}

export async function embed(text) {
  if (vectors.has(text)) return vectors.get(text);
  inFlight += 1;
  try {
    const vector = await request(text);
    vectors.set(text, vector);
    return vector;
  } finally {
    inFlight -= 1;
  }
}

export async function closeModel() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
}
