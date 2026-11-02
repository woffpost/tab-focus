# Chrome Web Store: Privacy tab and test instructions

## Single purpose

```
Tab Focus helps the user stay on one topic: it groups the tabs that match a topic the user names and collapses the other tabs into a separate group.
```

## Permission justification

**tabs**
```
Reads the titles and URLs of tabs so the local language model can compare each title with the user's topic. URLs detect navigation and exclude browser pages. Also opens a tab the user picks in the popup. This data is processed only on the device.
```

**tabGroups**
```
Creates, names, counts and collapses the two groups of a focus session, and removes them when the user exits. This is the core function of the extension.
```

**storage**
```
Keeps the focus session state (topic, threshold, tab scores) in chrome.storage.session, because the service worker can restart at any time. It is cleared when the browser closes.
```

**offscreen**
```
Runs the WebAssembly language model, included in the package, in an offscreen document, because a service worker cannot run it. The document is closed when focus ends.
```

**Host permissions:** none requested.

## Remote code

Choose **No, I am not using remote code**.

Everything executed is in the package, including the ONNX Runtime WebAssembly files and the model. The manifest's content security policy has `connect-src 'self'`, so the extension cannot fetch anything external.

## Data usage

Tick the categories below. The store requires disclosing data handled even when it stays on the device. Check the labels against the dashboard.

- **Web history:** tab URLs and titles
- **Website content:** page titles

Leave the others unticked. Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/woffpost/tab-focus/blob/main/PRIVACY.md

## Test instructions

No account or credentials are needed.

```
1. Open several tabs: three or more about one subject (for example, pages about cooking) and a few about others.
2. Click the extension icon, type the subject and click "Start focus". Loading the model takes a few seconds.
3. Matching tabs move into a blue group, and the others into a collapsed grey group.
4. Open a new off-topic page. It stays open with a "!" badge, and moves into the grey group when you switch to another tab.
5. Open the popup and click any tab in the list to go to it.
6. Click "Exit". The groups disappear and no tabs are closed.
```

The extension makes no network requests. The model is in `models/` inside the package. Source code: https://github.com/woffpost/tab-focus
