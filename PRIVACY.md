# Tab Focus privacy policy

Effective date: November 2, 2026

**Tab Focus does not send your data anywhere.** It has no accounts, analytics, advertising or server of its own, and it makes no network requests once installed. Its content security policy allows connections only to the extension's own files.

## What the extension handles

To compare your tabs with your topic, Tab Focus reads the following on your computer:

- the titles and addresses of tabs in the window where you start a focus session or ask for topic suggestions;
- the topic you type;
- your "on topic" and "remove" choices, and when you last left a tab.

The language model that compares titles with the topic is included in the extension and runs in your browser.

## Where it is stored and for how long

This information is kept in `chrome.storage.session`, in your browser's memory. It disappears when you close the browser or when the extension is updated, disabled or removed. Nothing is written to a remote server, and focus sessions do not survive a browser restart.

## Who it is shared with

Nobody. The information is not sold, transferred to third parties, used for advertising, or used to determine creditworthiness.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `tabs` | To read tab titles and addresses, and to open a tab you pick in the popup |
| `tabGroups` | To create, name and collapse the two groups of a focus session |
| `storage` | To keep the session state while the browser is open |
| `offscreen` | To run the language model, which a service worker cannot do |

## Chrome Web Store Limited Use

The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes and contact

Changes to this policy are published in this file, and its history is public in this repository. Questions can be asked in the [project's issues](https://github.com/woffpost/tab-focus/issues) or by email at woffpost@gmail.com.
