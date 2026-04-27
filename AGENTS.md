---
summary: Chrome extension for journal article batch download — TOC parser + PDF puller for nephrology/IM journals (NEJM/JAMA/Lancet/CJASN/etc.). Production v3.9.1 zero-token path.
status: active
agent: admin
---

# journal-downloader

Chrome extension (Manifest V3) that automates journal table-of-contents parsing + PDF download. Maintained as a production zero-token path for routine fetching; preferred over Chrome MCP for batch journal sweeps. GitHub-tracked at `copper0722/journal-downloader`.

## Layout

- `manifest.json` — extension manifest (v3).
- `content.js` — page-injected script (TOC parser, link enumerator).
- `popup.html`, `popup.js` — extension UI (target list, batch run).
- `icon{16,48}.png` — toolbar icons.
- `LICENSE`.

## Owner

admin (Copper). Dev host = PC-06 (Windows desktop, `clasp`-canonical workstation per Law §3.2).

## Usage

- Install in Chrome from this repo (developer mode).
- Open journal TOC page → click extension → batch-download visible PDFs to `~/Downloads/` → Copper drags to `~/Library/CloudStorage/Dropbox/_inbox/` for Law §9.3 pipeline.

## Cross-refs

- **Law §7.5** + admin/CLAUDE.md hard rule on `_inbox` manual trigger — this extension feeds the inbox.
- **Chrome MCP** (`chrome-devtools-mcp`) — only for authenticated one-offs / NHI-TFDA scrapes / wiki gap-fills that need JS exec. Routine TOC+PDF batches stay here (zero-token).
- **Crawler skill** (`_admin-rules/skills/crawler/SKILL.md`) — covers Safari-AppleScript scraping; this extension is the Chrome lane.

## TODO

- [ ] Drift audit: `content.js` selectors may break on journal-website redesigns — review:manual (2026-04-25)

## Notes

- `*.crx` `*.pem` build artefacts live one level up at `~/repos/` (gitignored by pseudo-repo `/*/`); not tracked here.
- Pre-split lived inside monorepo `Vault/repos/journal-downloader/`; promoted to top-level `~/repos/journal-downloader/` Phase-9c.
