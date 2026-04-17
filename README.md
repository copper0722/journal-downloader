# Journal Downloader

Chrome extension for batch-downloading PDFs from medical/science journal TOC (Table of Contents) pages.

**Enhanced parsers**: NEJM · Nature · Science
**Fallback**: generic PDF link detection on any page

## What it does

1. Visit a journal's TOC page (e.g., `https://www.nejm.org/toc/nejm/394/15`, `https://www.nature.com/nature/volumes/652/issues/8108`, `https://www.science.org/toc/science/392/6791`).
2. Click the extension icon.
3. The popup lists all articles on the issue with checkboxes, OA indicators, and per-journal metadata.
4. Click **Download All** → batch-save selected PDFs with descriptive filenames.
5. Optional: fetch abstracts (Nature) or save issue TOC as a Markdown file.

## Install (unpacked)

1. Clone this repo: `git clone https://github.com/copper0722/journal-downloader.git`
2. Open `chrome://extensions/` → enable **Developer mode** (top right).
3. Click **Load unpacked** → select the cloned folder.
4. The extension icon appears in the toolbar.

## Supported pages

| journal | URL pattern | recognized |
|---|---|---|
| NEJM TOC | `nejm.org/toc/*` | title, DOI, article type, authors, PDF, supplements, OA (NEJM non-subscription articles) |
| Nature TOC | `nature.com/*/volumes/*` | title, DOI, authors, abstract snippet, OA badge, PDF |
| Science TOC | `science.org/toc/*` | title, DOI, article type, authors, Free-Access indicator (`.icon-access-full.text-access-free`), PDF |
| any other page | — | every `.pdf` link |

OA / Free-Access detection is best-effort per journal's HTML convention; closed/paywalled items are still listed but default to unchecked.

## Extension architecture

| file | role |
|---|---|
| `manifest.json` | Chrome Extension v3 manifest |
| `content.js` | runs on each page; detects mode (nejm-toc / nature-toc / science-toc / generic) and extracts article metadata |
| `popup.html` + `popup.js` | UI shown on toolbar click; list, filter, batch-download |
| `icon*.png` | toolbar icons |

## Filename template

| journal | pattern |
|---|---|
| NEJM | `{articleId}_{sanitizedTitle}.pdf` (e.g., `NEJMoa2511920_DapagliflozinCKD.pdf`) |
| Nature | `{articleId}_{sanitizedTitle}.pdf` (e.g., `s41586-025-09896-x_MitochondrialTransfer.pdf`) |
| Science | `{articleId}_{sanitizedTitle}.pdf` (e.g., `science.aec0970_Title.pdf`) |
| generic | filename derived from URL path |

Supplements (NEJM) are appended with `_suppl`.

## Markdown export (all modes)

Every journal mode has a **Save MD** button. Exports the entire TOC as a structured Markdown file:

```markdown
---
generated: 2026-04-17
journal: Science
type: raw
source: toc
article_count: 23
oa_count: 5
---

# Science TOC — 2026-04-17 (issue 392-6791)

## Research Article

### 1. Article title here

🟢 **Open Access** · 👤 Author et al.

**DOI**: [10.1126/science.abc1234](https://doi.org/10.1126/science.abc1234)
**Full text**: <https://www.science.org/doi/10.1126/science.abc1234>
**PDF**: <https://www.science.org/doi/pdf/10.1126/science.abc1234>
**ID**: `science.abc1234`

> abstract paragraph here...

---
```

Each article gets: title, OA badge, DOI link, full-text link, PDF link, article ID, and abstract (if fetched).

### Fetch Abstracts button (all modes)

Optional step: visits each article page and extracts the abstract via per-journal selectors. Run BEFORE Save MD to enrich the export.

## Changelog

- **3.2** (2026-04-17) — Universal Markdown export across all modes (NEJM/Nature/Science/generic). Unified `fetchArticleAbstract` with per-journal selector maps. Fetch Abstracts button works for all journal modes (was Nature-only).
- **3.1** (2026-04-17) — Added Science parser. OA via `.icon-access-full.text-access-free`. Renamed from "PDF Batch Downloader" → "Journal Downloader". New brand color for Science (#a60f2d).
- **3.0** — Nature parser + abstract fetcher + TOC-to-Markdown export.
- **2.x** — NEJM TOC parser with supplements.
- **1.x** — Generic PDF batch downloader.

## Contributing

PRs welcome for additional journal parsers. Pattern for a new journal:

1. Add host/path detection to `detectMode()` in `content.js`.
2. Add `parse{Journal}_TOC()` function returning an array of article objects with keys `{doi, articleId, title, abstract, pdfUrl, fullUrl, author, typeName, hasPdf, isOA, journal}`.
3. Wire into the `getArticles` dispatch.
4. Add CSS theme class (color) in `popup.html` and update `popup.js` `modeBase()` + `titles` map.

## License

MIT
