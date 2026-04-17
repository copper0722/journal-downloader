// PDF Batch Downloader — Content Script
// Generic PDF detection + enhanced parsers for NEJM / Nature / Science

(function () {
  function detectMode() {
    const host = location.hostname;
    const path = location.pathname;
    if (host.includes('nejm.org') && path.includes('/toc/')) return 'nejm-toc';
    if (host.includes('nejm.org') && path.includes('/doi/full/')) return 'nejm-article';
    if (host.includes('nature.com') && (path.match(/\/volumes\//) || path.includes('/current-issue'))) return 'nature-toc';
    if (host.includes('nature.com') && path.includes('/articles/')) return 'nature-article';
    if (host.includes('science.org') && path.includes('/toc/')) return 'science-toc';
    if (host.includes('science.org') && path.match(/\/doi\/(10\.1126\/|full\/|abs\/)/)) return 'science-article';
    if (host.includes('thelancet.com') && path.match(/\/journals\/lancet\/issue\//)) return 'lancet-toc';
    if (host.includes('thelancet.com') && path.includes('/article/PIIS0140-6736')) return 'lancet-article';
    if (host.includes('bmj.com') && path.match(/^\/content\/\d+\/\d+\/?$/)) return 'bmj-toc';
    if (host.includes('bmj.com') && path.match(/^\/content\/\d+\/bmj\./)) return 'bmj-article';
    return 'generic';
  }

  // ── Generic: find all PDF links on any page ──
  function parseGeneric() {
    const links = document.querySelectorAll('a[href]');
    const articles = [];
    const seen = new Set();

    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      const abs = link.href; // resolved absolute URL

      // Match .pdf extension or /pdf/ in path
      const isPdf =
        href.match(/\.pdf(\?|#|$)/i) ||
        href.match(/\/pdf\//i) ||
        link.type === 'application/pdf';
      if (!isPdf) return;
      if (seen.has(abs)) return;
      seen.add(abs);

      // Derive a readable name from link text or URL
      let title = link.textContent.trim().replace(/\s+/g, ' ');
      if (!title || title.length < 3) {
        // Use filename from URL
        const parts = abs.split('/');
        title = decodeURIComponent(parts[parts.length - 1]).replace(/\.pdf$/i, '');
      }
      // Truncate overly long link text
      if (title.length > 200) title = title.substring(0, 200);

      // Try to get context: nearest heading or parent text
      let context = '';
      const heading = link.closest('li, tr, div, article, section');
      if (heading) {
        const h = heading.querySelector('h1, h2, h3, h4, h5, strong');
        if (h && h.textContent.trim() !== title) {
          context = h.textContent.trim().replace(/\s+/g, ' ').substring(0, 120);
        }
      }

      // Extract filename for download
      const urlPath = new URL(abs).pathname;
      const filename = decodeURIComponent(urlPath.split('/').pop());

      articles.push({
        title: context || title,
        articleId: filename.replace(/\.pdf$/i, ''),
        pdfUrl: abs,
        fullUrl: abs,
        author: '',
        abstract: '',
        typeName: '',
        doi: '',
        hasPdf: true,
        isOA: true,
        journal: 'generic',
        filename: filename,
      });
    });
    return articles;
  }

  // ── NEJM TOC parser ──
  function parseNEJM_TOC() {
    const items = document.querySelectorAll('.issue-item');
    const articles = [];
    const seen = new Set();
    items.forEach(item => {
      const doiInput = item.querySelector('input.inputDoi');
      const titleLink = item.querySelector('.issue-item_title a[href*="/doi/full/"]');
      const pdfLink = item.querySelector('a[href*="/doi/pdf/"]');
      const authorInput = item.querySelector('input.inputAuthor');
      if (!doiInput) return;
      const doi = doiInput.value.trim();
      if (seen.has(doi)) return;
      seen.add(doi);
      const articleId = doi.replace('10.1056/', '');
      const title = titleLink ? titleLink.textContent.trim().replace(/\s+/g, ' ') : articleId;
      const typeMatch = articleId.match(/^NEJM([a-z]+)/i);
      const typeCode = typeMatch ? typeMatch[1].toLowerCase() : '';
      const typeLabels = {
        oa: 'Original Article', ra: 'Review', p: 'Perspective',
        e: 'Editorial', c: 'Correspondence', cpc: 'Case Records',
        icm: 'Images', x: 'Correction', sa: 'Special Article',
      };
      articles.push({
        doi, articleId, title, abstract: '',
        pdfUrl: pdfLink ? `https://www.nejm.org${pdfLink.getAttribute('href')}` : `https://www.nejm.org/doi/pdf/${doi}`,
        fullUrl: `https://www.nejm.org/doi/full/${doi}`,
        author: authorInput ? authorInput.value.trim().replace(/\s+/g, ' ') : '',
        typeCode, typeName: typeLabels[typeCode] || typeCode.toUpperCase(),
        hasPdf: !!pdfLink, isOA: true, journal: 'NEJM',
      });
    });
    return articles;
  }

  // ── Nature TOC parser ──
  function parseNature_TOC() {
    const items = document.querySelectorAll('article');
    const articles = [];
    const seen = new Set();
    items.forEach(item => {
      const titleEl = item.querySelector('h3 a, h2 a');
      if (!titleEl) return;
      const href = titleEl.getAttribute('href') || '';
      if (seen.has(href)) return;
      seen.add(href);
      const title = titleEl.textContent.trim().replace(/\s+/g, ' ');
      const idMatch = href.match(/\/articles\/([\w-]+)/);
      const articleId = idMatch ? idMatch[1] : '';
      const absEl = item.querySelector('div[itemprop="description"], p[class*="body"]');
      const abstract = absEl ? absEl.textContent.trim().replace(/\s+/g, ' ') : '';
      const isOA = !!item.querySelector('[data-test*="open"], [class*="open-access"], img[alt*="Open Access"]');
      const typeEl = item.querySelector('[data-test="article.type"], span[class*="type"], p[class*="type"]');
      const authorEl = item.querySelector('ul[data-test="author-list"], [itemprop="author"]');
      articles.push({
        doi: articleId.startsWith('s41586') ? `10.1038/${articleId}` : (articleId.startsWith('d41586') ? `10.1038/${articleId}` : ''),
        articleId, title, abstract,
        pdfUrl: articleId ? `https://www.nature.com/articles/${articleId}.pdf` : '',
        fullUrl: `https://www.nature.com${href}`,
        author: authorEl ? authorEl.textContent.trim().replace(/\s+/g, ' ').substring(0, 150) : '',
        typeCode: '', typeName: typeEl ? typeEl.textContent.trim() : '',
        hasPdf: isOA && !!articleId, isOA, journal: 'Nature',
      });
    });
    return articles;
  }

  // ── Science TOC parser ──
  // OA indicator: <i class="icon-access-full text-access-free"> with tooltip "Free Access"
  // PDF URL: https://www.science.org/doi/reader/{DOI}  (Science uses /doi/reader/ for PDF viewer)
  // DOI pattern: 10.1126/science.{id}  OR  10.1126/sciadv.{id}
  function parseScience_TOC() {
    // Science AAAS Atypon platform uses .card or div with data-doi; also .toc__item. Multiple selectors for robustness.
    const items = document.querySelectorAll('div.card, article.card, div[data-doi], .toc__item, section.article');
    const articles = [];
    const seen = new Set();

    items.forEach(item => {
      // DOI: prefer data-doi attr; fall back to first link matching /doi/10.1126/
      let doi = item.getAttribute('data-doi') || '';
      if (!doi) {
        const doiLink = item.querySelector('a[href*="/doi/10.1126/"], a[href*="/doi/full/10.1126/"], a[href*="/doi/abs/10.1126/"]');
        if (doiLink) {
          const m = doiLink.getAttribute('href').match(/10\.1126\/[^\s?#]+/);
          if (m) doi = m[0];
        }
      }
      if (!doi) return;
      if (seen.has(doi)) return;
      seen.add(doi);

      const articleId = doi.replace(/^10\.1126\//, '');

      // Title: prefer h2/h3 link text, else any anchor inside .card-header
      const titleEl = item.querySelector('h2 a, h3 a, .card-header a, .article__headline a');
      const title = titleEl
        ? titleEl.textContent.trim().replace(/\s+/g, ' ')
        : articleId;

      // OA indicator — Copper signal 2026-04-17: <i class="icon-access-full text-access-free">
      const isOA = !!item.querySelector('i.icon-access-full.text-access-free, i.text-access-free, [aria-label*="Free Access" i], [title*="Free Access" i]');

      // Authors: Science uses .authors, .loa (List of Authors), or [data-test="authors"]
      const authorEl = item.querySelector('.authors, .loa, [data-test="authors"], ul.rlist--inline');
      const author = authorEl
        ? authorEl.textContent.trim().replace(/\s+/g, ' ').substring(0, 150)
        : '';

      // Article type: Science labels = "Research Article", "Review", "Perspective", "Editorial", "Policy Forum", "News", "Letters"
      const typeEl = item.querySelector('.card-header__meta, .meta__content-type, [data-test="article-type"], .article-type');
      const typeName = typeEl
        ? typeEl.textContent.trim().replace(/\s+/g, ' ')
        : '';

      // Abstract: Science sometimes shows abstract snippet on TOC in .card-content__abstract or .hlFld-Abstract
      const absEl = item.querySelector('.card-content__abstract, .hlFld-Abstract, .article__teaser');
      const abstract = absEl
        ? absEl.textContent.trim().replace(/\s+/g, ' ')
        : '';

      articles.push({
        doi,
        articleId,
        title,
        abstract,
        pdfUrl: `https://www.science.org/doi/pdf/${doi}`,
        // Alternative reader URL (Copper pointed): `https://www.science.org/doi/reader/${doi}`
        // Use /pdf/ as direct download target; /reader/ triggers the PDF viewer UI
        fullUrl: `https://www.science.org/doi/${doi}`,
        author,
        typeCode: '',
        typeName,
        hasPdf: isOA,   // only attempt download if OA (subscription gate otherwise)
        isOA,
        journal: 'Science',
      });
    });
    return articles;
  }

  // ── Lancet TOC parser ──
  // DOM verified on 2026-04-17 against thelancet.com/journals/lancet/issue/current:
  //   item container:  li.articleCitation
  //   section wrapper: section.toc__section → heading h2.toc__section__header
  //   title:           h3.toc__item__title > a
  //   authors:         ul.toc__item__authors.loa > li.loa__item
  //   OA marker:       span.OALabel (text "Open Access")
  //   PDF link:        a.pdfLink (href = /pdfs/journals/lancet/PIIS0140-6736(YY)NNNNN-X.pdf)
  // OA rule (Copper 2026-04-17): download only when OALabel present. No class-free fallback
  //   — "要有看到 open access 字眼" = OALabel literal match, deterministic.
  function parseLancet_TOC() {
    const items = document.querySelectorAll('li.articleCitation');
    const articles = [];
    const seen = new Set();

    items.forEach(item => {
      const titleAnchor = item.querySelector('h3.toc__item__title a, h3.toc__item__title > a');
      if (!titleAnchor) return;
      const href = titleAnchor.getAttribute('href') || '';
      const m = href.match(/PIIS0140-6736\([^)]+\)[^/?#]+/);
      if (!m) return;
      const piiFull = m[0];                            // PIIS0140-6736(26)01234-5
      const articleId = piiFull.replace(/^PII/, '');   // S0140-6736(26)01234-5
      const doi = `10.1016/${articleId}`;
      if (seen.has(doi)) return;
      seen.add(doi);

      const title = titleAnchor.textContent.trim().replace(/\s+/g, ' ');

      // OA — strict OALabel detection, matches Copper rule exactly.
      const isOA = !!item.querySelector('.OALabel');

      // Authors from loa list
      const loaItems = item.querySelectorAll('ul.toc__item__authors .loa__item, ul.loa .loa__item');
      const author = Array.from(loaItems)
        .map(li => li.textContent.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .join(', ')
        .substring(0, 200);

      // Section heading acts as article type (Editorial / Comment / Articles / Seminar / etc.)
      const sectionEl = item.closest('section.toc__section');
      const sectionHeading = sectionEl ? sectionEl.querySelector('h2.toc__section__header, h2[class*="toc__section__header"]') : null;
      const typeName = sectionHeading
        ? sectionHeading.textContent.trim().replace(/\s+/g, ' ')
        : '';

      // PDF link — prefer explicit .pdfLink anchor, fallback to constructed URL
      const pdfAnchor = item.querySelector('a.pdfLink, a[href*="/pdfs/journals/lancet/"]');
      const pdfHref = pdfAnchor ? pdfAnchor.getAttribute('href') : `/pdfs/journals/lancet/${piiFull}.pdf`;
      const pdfUrl = pdfHref.startsWith('http') ? pdfHref : `https://www.thelancet.com${pdfHref}`;

      const fullUrl = `https://www.thelancet.com/journals/lancet/article/${piiFull}/fulltext`;

      articles.push({
        doi,
        articleId,
        title,
        abstract: '',                // Lancet TOC doesn't inline abstracts; Crossref + HTML scrape will fill
        pdfUrl,
        fullUrl,
        author,
        typeCode: '',
        typeName,
        hasPdf: isOA,                // Copper rule: only OA triggers download
        isOA,
        journal: 'Lancet',
      });
    });
    return articles;
  }

  // ── BMJ TOC parser ──
  // DOM verified 2026-04-17 against bmj.com/content/{vol}/{issue} (273KB rendered DOM, osascript Chrome):
  //   item container:  li.toc-item (53 on current issue)
  //   section wrapper: h2.toc-heading[id] precedes a group of li.toc-item (no nesting; DOM order)
  //   title:           a.highwire-cite-linked-title > span.highwire-cite-title
  //   DOI anchor:      div.highwire-article-citation [data-pisa-master="bmj;bmj.{id}"]
  //                    → DOI = 10.1136/bmj.{id}; fallback = extract from .full.pdf URL
  //   PDF link:        a[href$=".full.pdf"] inside .bmj-article-links
  //   OA marker:       li.open-access-flag (text "Open Access") inside .bmj-article-links
  //   Authors:         not reliably present at TOC level on BMJ; leave blank
  // OA rule (match Lancet pattern): hasPdf = isOA ? BMJ PDFs are often free even for non-OA research,
  //   but to stay consistent with Copper's Lancet directive ("要有看到 open access 字眼"),
  //   BMJ is more permissive: BMJ Editorials/Comments/News are all free-to-read →
  //   hasPdf = !!pdfUrl (any extractable PDF URL is downloadable). isOA still reports the green-OA flag.
  function parseBMJ_TOC() {
    // Walk in document order so we can tag each toc-item with its preceding h2.toc-heading section label.
    const walked = document.querySelectorAll('h2.toc-heading, li.toc-item');
    const articles = [];
    const seen = new Set();
    let currentSection = '';
    walked.forEach(el => {
      if (el.tagName === 'H2') {
        currentSection = el.textContent.trim().replace(/\s+/g, ' ');
        return;
      }
      // toc-item
      const titleAnchor = el.querySelector('a.highwire-cite-linked-title');
      if (!titleAnchor) return;
      const titleEl = titleAnchor.querySelector('.highwire-cite-title');
      const title = (titleEl ? titleEl.textContent : titleAnchor.textContent).trim().replace(/\s+/g, ' ');
      const href = titleAnchor.getAttribute('href') || '';

      // DOI: prefer data-pisa-master attribute. BMJ uses two ID formats:
      //   - News/Comment/Editorial: "bmj;bmj.s713"       → 10.1136/bmj.s713
      //   - Research (year-keyed):  "bmj;bmj-2025-087321" → 10.1136/bmj-2025-087321
      const citationEl = el.querySelector('[data-pisa-master]');
      let doi = '';
      if (citationEl) {
        const pisa = citationEl.getAttribute('data-pisa-master') || '';
        const m = pisa.match(/bmj;(bmj[.-][\w.-]+)/);
        if (m) doi = `10.1136/${m[1]}`;
      }

      // PDF link + DOI fallback via PDF URL
      const pdfAnchor = el.querySelector('a[href*=".full.pdf"]');
      const pdfUrl = pdfAnchor ? (pdfAnchor.href || pdfAnchor.getAttribute('href')) : '';
      if (!doi && pdfUrl) {
        const m = pdfUrl.match(/\/(bmj[.-][\w.-]+)\.full\.pdf/);
        if (m) doi = `10.1136/${m[1]}`;
      }
      if (!doi) return;
      if (seen.has(doi)) return;
      seen.add(doi);

      const articleId = doi.replace(/^10\.1136\//, '');
      const fullUrl = href.startsWith('http') ? href : `https://www.bmj.com${href}`;

      // OA flag literal
      const isOA = !!el.querySelector('.open-access-flag');

      articles.push({
        doi,
        articleId,
        title,
        abstract: '',               // BMJ TOC has no inline abstract; Crossref + HTML scrape fill
        pdfUrl,
        fullUrl,
        author: '',
        typeCode: '',
        typeName: currentSection,   // section heading = article class (This Week / Research / Comment / Education / Obituaries)
        hasPdf: !!pdfUrl,           // BMJ: most articles have free PDF regardless of OA flag
        isOA,
        journal: 'BMJ',
      });
    });
    return articles;
  }

  // ── Fetch abstract from journal article page (mode-aware, all journals) ──
  // Per-journal selector maps with multiple fallbacks for HTML robustness.
  const ABSTRACT_SELECTORS = {
    nejm: [
      'section#article_body section[aria-label*="Abstract" i] p',
      '.m-article-body__section--abstract p',
      'article section#abstract p',
      'section#abstract p',
      'div[class*="abstract"] p',
    ],
    nature: [
      '#Abs1-content p',
      '#Abs1 p',
      '[id*="Abs"] p',
      '.c-article-section__content p',
      'div[data-title="Abstract"] p',
    ],
    science: [
      'section#abstract p',
      'section[role="doc-abstract"] p',
      '.hlFld-Abstract p',
      '#bodymatter section#abstract p',
      'div[class*="abstract"] p',
    ],
    lancet: [
      'div.abstract__text',
      'section.abstract p',
      'div[role="doc-abstract"] p',
      'div.summary p',
      'section[id*="abstract"] p',
      'div[class*="abstract"] p',
    ],
    bmj: [
      // Research papers — real abstract block
      'div.abstract p',
      'section.abstract p',
      'div[class*="abstract-"] p',
      'section[id^="abstract"] p',
      '#abstract-1 p',
      '.article-abstract p',
      // News / Editorial / Comment / Education — no abstract; lede = first paragraphs of fulltext-view.
      // fetchPageAbstract caps total length so we don't dump whole article.
      'div.article.fulltext-view > p',
      'div.fulltext-view > p',
      '.fulltext-view > p',
    ],
    generic: [
      'section#abstract p',
      'div#abstract p',
      'div[class*="abstract"] p',
      'p[class*="abstract"]',
    ],
  };

  // Crossref public API — open CORS, no auth, abstract deposited by publisher (best for Science ~86%).
  // Empty for publishers that don't deposit (Nature ~20%, NEJM ~0% — fall through to HTML scrape).
  async function fetchCrossrefAbstract(doi) {
    if (!doi) return '';
    const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    if (!/^10\.\d{4,9}\//.test(clean)) return '';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const resp = await fetch(`https://api.crossref.org/works/${encodeURIComponent(clean)}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'journal-downloader/3.4 (github.com/copper0722/journal-downloader)' },
      });
      clearTimeout(timeout);
      if (!resp.ok) return '';
      const data = await resp.json();
      let raw = (data && data.message && data.message.abstract) || '';
      if (!raw) return '';
      // Strip JATS XML + collapse whitespace + drop leading "Abstract" label.
      raw = raw.replace(/<[^>]+>/g, ' ')
               .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
               .replace(/\s+/g, ' ').trim()
               .replace(/^abstract[:.\s]*/i, '');
      return raw.length > 100 ? raw : '';
    } catch (e) { return ''; }
  }

  async function fetchPageData(url, mode) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(url, { credentials: 'include', signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) return { abstract: '', articleType: '' };
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // Article type — publishers embed `<meta name="citation_article_type" content="...">`
      // (also DC.Type / prism.aggregationType on some). One tag wins.
      let articleType = '';
      const typeMeta = doc.querySelector(
        'meta[name="citation_article_type"], meta[name="DC.Type"], meta[name="prism.aggregationType"]'
      );
      if (typeMeta) articleType = (typeMeta.getAttribute('content') || '').trim();

      // Abstract / lede
      const modeKey = (mode || 'generic').split('-')[0];
      const selectors = ABSTRACT_SELECTORS[modeKey] || ABSTRACT_SELECTORS.generic;
      let abstract = '';
      for (const sel of selectors) {
        const els = doc.querySelectorAll(sel);
        if (els.length === 0) continue;
        const pieces = Array.from(els).slice(0, 3).map(p => p.textContent.trim()).filter(Boolean);
        let text = pieces.join(' ').replace(/\s+/g, ' ');
        if (text.length > 1500) text = text.substring(0, 1500).replace(/\s+\S*$/, '') + '…';
        if (text.length > 50) { abstract = text; break; }
      }
      return { abstract, articleType };
    } catch (e) { return { abstract: '', articleType: '' }; }
  }

  // Hybrid fetch: Crossref first for abstract (fast, CORS-open). Page fetch supplies abstract fallback
  // + citation_article_type meta. When Crossref wins on abstract, page fetch still runs to grab type
  // (cheap — most pages' head-only section contains the meta).
  async function fetchArticleAbstract(url, mode, doi) {
    // Kick off both in parallel; decide the pair from results.
    const crossrefPromise = fetchCrossrefAbstract(doi);
    const pagePromise = fetchPageData(url, mode);
    const [fromCrossref, fromPage] = await Promise.all([crossrefPromise, pagePromise]);
    return {
      abstract: fromCrossref || fromPage.abstract || '',
      articleType: fromPage.articleType || '',
    };
  }

  // ── NEJM supplement parser ──
  function parseNEJM_Supplements(doc) {
    const supps = [];
    doc.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      const text = link.textContent.trim();
      if (href.match(/\/doi\/suppl\//) || href.match(/supplement/i) || href.match(/protocol/i) ||
          (href.endsWith('.pdf') && text.match(/supplement|protocol|appendix/i))) {
        supps.push({
          url: href.startsWith('http') ? href : `https://www.nejm.org${href}`,
          text: text.substring(0, 100),
        });
      }
    });
    return supps;
  }

  // ── Message handler ──
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const mode = detectMode();

    if (request.action === 'getArticles') {
      let articles = [];
      if (mode === 'nejm-toc') articles = parseNEJM_TOC();
      else if (mode === 'nature-toc') articles = parseNature_TOC();
      else if (mode === 'science-toc') articles = parseScience_TOC();
      else if (mode === 'lancet-toc') articles = parseLancet_TOC();
      else if (mode === 'bmj-toc') articles = parseBMJ_TOC();
      else articles = parseGeneric();
      sendResponse({ articles, mode });
    } else if (request.action === 'fetchOneAbstract') {
      // Single-article fetch (popup.js calls in parallel with its own batching).
      (async () => {
        const res = await fetchArticleAbstract(request.url, request.mode || mode, request.doi);
        sendResponse({ abstract: res.abstract, articleType: res.articleType });
      })();
      return true;
    } else if (request.action === 'fetchAbstracts') {
      // Legacy batch fetch — kept for backward compat but no longer used by popup.js v3.3+.
      const fetchMode = request.mode || mode;
      (async () => {
        const results = [];
        for (const a of (request.articles || [])) {
          if (!a.fullUrl) continue;
          const res = await fetchArticleAbstract(a.fullUrl, fetchMode, a.doi);
          results.push({ index: a.index, abstract: res.abstract, articleType: res.articleType });
          await new Promise(r => setTimeout(r, 600));
        }
        sendResponse({ results });
      })();
      return true;
    } else if (request.action === 'fetchSupplements') {
      fetch(request.url, { credentials: 'include' })
        .then(r => r.text())
        .then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          sendResponse({ supplements: parseNEJM_Supplements(doc) });
        })
        .catch(() => sendResponse({ supplements: [] }));
      return true;
    }
  });
})();
