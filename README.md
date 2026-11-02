# Tab Focus

A Chrome extension for staying on one topic. Name the topic, and its tabs gather into a coloured group while the rest fold into a separate one. Nothing gets closed. Titles are compared by a model running inside the browser, so they never leave your machine.

The interface is available in English and Russian, and it follows the browser's language.

## Getting started

Requires Node.js 22+ and Chrome 117+.

```
npm install
npm run build
```

Open `chrome://extensions`, turn on developer mode, choose "Load unpacked" and select the `dist` folder. The first focus session downloads the model (about 120 MB) from Hugging Face. After that the network is not used.

## How it works

Tab titles and the topic are turned into embeddings with `paraphrase-multilingual-MiniLM-L12-v2`, which handles mixed Russian, Romanian and English titles. A tab is on topic when it scores at least half of the best tab's score.

Pinned tabs and groups you created yourself are never touched.

| File | Role |
| --- | --- |
| `src/logic.js` | Pure decisions without Chrome APIs: scoring, thresholds, clustering, labels |
| `src/background.js` | The focus session: tab events, popup messages, the task queue |
| `src/groups.js` | Tab groups and the badge |
| `src/embedder.js` | Requests to the model from the service worker |
| `src/offscreen.js` | The model itself, in an offscreen document, since a service worker cannot run it |
| `src/popup.js` | The interface: shows state from `chrome.storage.session` and sends commands |

## Checks

- `npm run check`: lint, types and unit tests
- `npm run e2e`: builds the extension and drives it in real Chromium with the real model
- `npm run eval`: model accuracy on the labelled tabs in `eval/cases.json`

## License

[MIT](LICENSE)
