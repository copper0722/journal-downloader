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

  // ── Fetch abstract from Nature article page ──
  async function fetchNatureAbstract(url) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(url, { credentials: 'include', signal: controller.signal });
      clearTimeout(timeout);
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const absEl = doc.querySelector('#Abs1-content p, #Abs1 p, [id*="Abs"] p, .c-article-section__content p');
      return absEl ? absEl.textContent.trim().replace(/\s+/g, ' ') : '';
    } catch (e) { return ''; }
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
    } else if (request.action === 'fetchAbstracts') {
      const researchTypes = ['Article', 'Review Article', 'Perspective', 'Brief Communication'];
      (async () => {
        const results = [];
        for (const a of (request.articles || [])) {
          if (researchTypes.includes(a.typeName) && a.fullUrl) {
            const abs = await fetchNatureAbstract(a.fullUrl);
            results.push({ index: a.index, abstract: abs });
            await new Promise(r => setTimeout(r, 600));
          }
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
