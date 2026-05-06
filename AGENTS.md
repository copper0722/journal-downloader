---
summary: DEPRECATED 2026-05-06 — Chrome extension for journal TOC parsing, metadata export, and open-access PDF download. Replaced by AppleScript-driven bundler at wiki_raw/_config/scripts/journal_bundler/.
status: deprecated
agent: admin
---

# journal-downloader (deprecated 2026-05-06)

Chrome extension (Manifest V3) that automated journal table-of-contents parsing, metadata export, and open-access PDF download. GitHub-tracked at `copper0722/journal-downloader`.

**Deprecated** per Copper directive 2026-05-06「不需要 chrome extension」: replaced by an AppleScript-driven, command-triggered bundler at `wiki_raw/_config/scripts/journal_bundler/{bundler.py, extractor.js, run_in_browser.applescript, journals.json}`. The bundler subsumes every TOC parser + the `extractLWWArticleBody` text+image path that this extension carried, plus adds whole-issue mega-md output, per-article payload writing into wiki_raw, NEJM PDF binary fetch via subscriber-session sync XHR + base64 ferry, and command-line subset selection by DOI. See `personal-website/journal-toc/AGENTS.md` for the active workflow.

This repo is retained for forensic value (selector schemas DOM-verified across v3.10–v3.23 still document publisher DOM shape) and as an emergency fallback if the AppleScript bridge breaks; do not develop new features here. Selector / parser changes that the bundler needs go directly to the bundler's `extractor.js`.

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
