// PDF Batch Downloader — Content Script
// Generic PDF detection + enhanced parsers for NEJM / Nature / Science

(function () {
  function detectMode() {
    const host = location.hostname;
    const path = location.pathname;
    if (host.includes('nejm.org') && path.includes('/toc/')) return 'nejm-toc';
    if (host.includes('nejm.org') && path.includes('/doi/full/')) return 'nejm-article';
    if (host.includes('nature.com') && path.match(/\/volumes\//)) return 'nature-toc';
    if (host.includes('nature.com') && path.includes('/articles/')) return 'nature-article';
    if (host.includes('science.org') && path.includes('/toc/')) return 'science-toc';
    if (host.includes('science.org') && path.match(/\/doi\/(10\.1126\/|full\/|abs\/)/)) return 'science-article';
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

  async function fetchPageAbstract(url, mode) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(url, { credentials: 'include', signal: controller.signal });
      clearTimeout(timeout);
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const modeKey = (mode || 'generic').split('-')[0]; // nejm-toc → nejm
      const selectors = ABSTRACT_SELECTORS[modeKey] || ABSTRACT_SELECTORS.generic;
      for (const sel of selectors) {
        const els = doc.querySelectorAll(sel);
        if (els.length === 0) continue;
        // Join multi-paragraph abstracts
        const text = Array.from(els).map(p => p.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
        if (text.length > 50) return text;
      }
      return '';
    } catch (e) { return ''; }
  }

  // Hybrid fetch: Crossref first (fast, CORS-open, publisher-metadata), fall back to HTML scrape.
  // doi argument is optional — when absent, behaves like legacy v3.3 (page scrape only).
  async function fetchArticleAbstract(url, mode, doi) {
    const fromCrossref = await fetchCrossrefAbstract(doi);
    if (fromCrossref) return fromCrossref;
    return await fetchPageAbstract(url, mode);
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
      else articles = parseGeneric();
      sendResponse({ articles, mode });
    } else if (request.action === 'fetchOneAbstract') {
      // Single-article fetch (popup.js calls in parallel with its own batching).
      (async () => {
        const abs = await fetchArticleAbstract(request.url, request.mode || mode, request.doi);
        sendResponse({ abstract: abs });
      })();
      return true;
    } else if (request.action === 'fetchAbstracts') {
      // Legacy batch fetch — kept for backward compat but no longer used by popup.js v3.3+.
      const fetchMode = request.mode || mode;
      (async () => {
        const results = [];
        for (const a of (request.articles || [])) {
          if (!a.fullUrl) continue;
          const abs = await fetchArticleAbstract(a.fullUrl, fetchMode, a.doi);
          results.push({ index: a.index, abstract: abs });
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
