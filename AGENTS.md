---
summary: Chrome extension for journal TOC parsing, metadata export, and open-access PDF download. Non-OA/subscription items are metadata-only.
status: active
agent: admin
---

# journal-downloader

Chrome extension (Manifest V3) that automates journal table-of-contents parsing, metadata export, and open-access PDF download. GitHub-tracked at `copper0722/journal-downloader`.

## Layout

- `manifest.json` — extension manifest (v3).
- `content.js` — page-injected script (TOC parser, link enumerator).
- `popup.html`, `popup.js` — extension UI (target list, batch run).
- `icon{16,48}.png` — toolbar icons.
- `LICENSE`.

## Owner

admin (Copper).

## Usage

- Install in Chrome from this repo (developer mode).
- Open journal TOC page → click extension → export metadata and download only entries marked open-access/free by explicit page signals.

## Cross-refs

- Public-safe crawler policy: metadata-first; non-OA/subscription items remain metadata-only.

## TODO

- [ ] Drift audit: `content.js` selectors may break on journal-website redesigns — review:manual (2026-04-25)

## Notes

- `*.crx` and `*.pem` build artifacts are not tracked.
