// Journal TOC metadata + OA PDF downloader — Content Script

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
    if (host.includes('acpjournals.org') && path.match(/^\/toc\/aim\//)) return 'aim-toc';
    if (host.includes('acpjournals.org') && path.match(/^\/doi\/10\.7326\//)) return 'aim-article';
    if (host.includes('jamanetwork.com') && path.match(/\/currentissue|\/issue\//)) return 'jama-toc';
    if (host.includes('jamanetwork.com') && path.match(/\/fullarticle\/|\/article-abstract\//)) return 'jama-article';
    // LWW (Wolters Kluwer) journals platform — JASN/CJASN/KI etc.
    // currenttoc.aspx is a server redirect to the latest issue TOC; /toc/ also possible.
    if (host.includes('journals.lww.com') && path.match(/\/pages\/currenttoc\.aspx|\/toc\//i)) return 'lww-toc';
    if (host.includes('journals.lww.com') && path.includes('/fulltext/')) return 'lww-article';
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
        // NEJM TOC does not provide a reliable public OA download signal here.
        // Keep entries metadata-only unless a future explicit OA marker is added.
        hasPdf: false, isOA: false, journal: 'NEJM',
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
  // OA rule (STRICT, Copper directive 2026-05-02 bug fix):
  //   Earlier permissive rule (hasPdf = !!pdfUrl) was wrong: BMJ Editorials/Comments/News
  //   that look "free" on the TOC are still subscription-gated at the PDF endpoint, so the
  //   permissive flag advertised non-downloadable items as free. Aligning with JAMA / Science
  //   / Lancet / Nature: hasPdf = isOA. Only the explicit `.open-access-flag` triggers download
  //   eligibility; everything else is metadata-only.
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
        hasPdf: isOA,               // STRICT: non-OA PDFs are subscription-gated even when URL appears (Copper 2026-05-02 bug fix)
        isOA,
        journal: 'BMJ',
      });
    });
    return articles;
  }

  // ── Annals of Internal Medicine TOC parser ──
  // DOM verified 2026-04-22 via chrome-devtools MCP against acpjournals.org/toc/aim/current
  // (Atypon-based, shares platform family with Science but distinct class schema):
  //   container:       div.issue-item (56 per current issue, Vol 179 No 4)
  //   section wrapper: h5.titled_issues__title.to-section.{slug} precedes a contiguous group
  //                    of div.issue-item in DOM order (no nesting).
  //                    18 sections observed: Original Research / Reviews / Research and
  //                    Reporting Methods / Clinical Guidelines / Beyond the Guidelines /
  //                    Position Papers / Special Articles / Ideas and Opinions / Editorials /
  //                    On Being a Doctor / Letters / Corrections / Ad Libitum / In the Clinic /
  //                    I.M. Matters News / ACP Journal Club / Web Exclusives /
  //                    Summaries for Patients
  //   title:           .issue-item__title a > h5 (main) + optional .sub-title sibling inside a
  //   DOI:             title anchor href = /doi/10.7326/{articleId}; articleId = ANNALS-YY-NNNNN
  //                    (e.g. ANNALS-25-03660) — ACP migrated from M{N}-{N}/L{N}-{N} to ANNALS-*
  //                    prefix in 2024
  //   authors:         .issue-item__authors > ul.loa > li, interspersed with separator <li>s
  //                    containing only ","/" and "/et-al read-more link — filter on length + regex
  //   TOC abstract:    .issue__item__abstract — AIM renders a 2-4 sentence summary directly on
  //                    the TOC (unlike Lancet/BMJ which require page fetch). Use as-is.
  //   PDF link:        not rendered on TOC.
  //   OA marker:       AIM TOC exposes no reliable open-access indicator. Public build keeps
  //                    AIM entries metadata-only to avoid downloading subscription-gated PDFs.
  function parseAIM_TOC() {
    // Walk h5-section-headers + issue-items together in document order so each item can be
    // tagged with its preceding section heading (same pattern as BMJ parseBMJ_TOC).
    const walked = document.querySelectorAll('h5.titled_issues__title.to-section, div.issue-item');
    const articles = [];
    const seen = new Set();
    let currentSection = '';
    walked.forEach(el => {
      if (el.tagName === 'H5') {
        currentSection = el.textContent.trim().replace(/\s+/g, ' ');
        return;
      }
      // issue-item
      const titleAnchor = el.querySelector('.issue-item__title a');
      if (!titleAnchor) return;
      const href = titleAnchor.getAttribute('href') || '';
      const doiMatch = href.match(/\/doi\/(10\.7326\/[^?#]+)/);
      if (!doiMatch) return;
      const doi = doiMatch[1];
      if (seen.has(doi)) return;
      seen.add(doi);

      // Title — main heading inside anchor, optionally followed by sub-title
      const titleEl = titleAnchor.querySelector('h5, h4, h3, h2');
      const mainTitle = (titleEl || titleAnchor).textContent.trim().replace(/\s+/g, ' ');
      const subEl = titleAnchor.querySelector('.sub-title');
      const sub = subEl ? subEl.textContent.trim().replace(/\s+/g, ' ') : '';
      // mainTitle already includes sub via textContent concatenation inside h5 block, so check suffix
      const title = sub && !mainTitle.endsWith(sub) ? `${mainTitle} — ${sub}` : mainTitle;

      // Authors from loa list — filter separator/empty/et-al items.
      // AIM loa wraps an ellipsis + et-al read-more link as one <li>; filter bare "…"/"," items
      // and strip trailing truncation ellipsis.
      const authorLis = el.querySelectorAll('.issue-item__authors ul.loa > li');
      let author = Array.from(authorLis)
        .map(li => li.textContent.trim().replace(/ /g, ' ').replace(/\s+/g, ' '))
        .filter(t => t && t.length > 2 && !/^[,\s]+$/.test(t) && !/^and$/i.test(t) && !/^…$/.test(t))
        .map(t => t.replace(/,?\s*et al\..*/i, '').replace(/\s*…\s*$/, '').replace(/,$/, '').trim())
        .filter(Boolean)
        .join(', ')
        .substring(0, 200);
      author = author.replace(/(?:,\s*)?…\s*$/, '').trim();

      const articleId = doi.replace(/^10\.7326\//, '');

      // Inline TOC abstract
      const absEl = el.querySelector('.issue__item__abstract');
      const abstract = absEl ? absEl.textContent.trim().replace(/\s+/g, ' ') : '';

      articles.push({
        doi,
        articleId,
        title,
        abstract,
        pdfUrl: '',
        fullUrl: `https://www.acpjournals.org/doi/${doi}`,
        author,
        typeCode: '',
        typeName: currentSection,  // section heading drives type
        hasPdf: false,
        isOA: false,
        journal: 'AIM',
      });
    });
    return articles;
  }

  // ── JAMA TOC parser ──
  // DOM verified 2026-04-22 via chrome-devtools MCP against jamanetwork.com/journals/jama/currentissue.
  // Bug fix context (Copper 2026-04-22): JAMA non-OA articles expose a /articlepdf/ link in DOM but
  // the server gates access via `/Content/CheckPdfAccess` AJAX endpoint. Generic parser previously
  // grabbed every .pdf link → user tried download → got paywall HTML masquerading as PDF. STRICT OA
  // gate per Copper directive: hasPdf = isOA; non-OA articles rendered with disabled checkbox in popup.
  //
  // DOM:
  //   section header:   div.issue-group.group--{slug}  (slugs: this-week-in-jama / multimedia /
  //                     original-investigation / research-letter / research-summary / viewpoint /
  //                     perspective / a-piece-of-my-mind / editorial / review / jama-insights /
  //                     jama-patient-page / medical-news / medical-news-in-brief / poetry-and-medicine /
  //                     jama-revisited / comment- / correction / jama-masthead /
  //                     jama-guide-to-statistics-and-methods / editor) — 21 sections on current issue.
  //   article wrapper:  div.issue-group-articles > div.article (46 items current)
  //   title:            h3.article--title > a (textContent, may contain span.subtitle)
  //   sub-section hint: h4.superClassification inside div.article (e.g., "Caring for the Critically Ill Patient")
  //   DOI:              div.article--citation .meta-citation text → match /10\.1001\/[^\s]+/
  //   authors:          div.article--authors (strip " et al.")
  //   abstract/excerpt: div.article--excerpt p.para (TOC-inline summary, present on most items)
  //   PDF anchor:       a.pdf.pdfaccess.js-pdfaccess[data-article-id][data-ajax-url="/Content/CheckPdfAccess"]
  //   article ID:       data-article-id attribute (e.g., 2846530) — numeric, distinct from DOI
  //   fullUrl:          title anchor href (absolute https://jamanetwork.com/journals/jama/fullarticle/{id})
  //   OA flag:          div.badges > span.badge.icon-free  (sr-text "free access") ← authoritative
  //                     All other badges (icon-online_only, icon-audio, icon-quiz_cme, ...) = metadata,
  //                     NOT access indicators. Ignore.
  function parseJAMA_TOC() {
    const walked = document.querySelectorAll('div.issue-group, div.issue-group-articles > div.article');
    const articles = [];
    const seen = new Set();
    let currentSection = '';
    walked.forEach(el => {
      if (el.classList && el.classList.contains('issue-group')) {
        const m = String(el.className || '').match(/group--([\w-]+)/);
        if (m) {
          // Slug → display name: "original-investigation" → "Original Investigation"
          currentSection = m[1].replace(/-$/, '').split('-')
            .map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ').trim();
        } else {
          currentSection = '';
        }
        return;
      }
      // div.article under issue-group-articles
      const titleAnchor = el.querySelector('.article--title a');
      if (!titleAnchor) return;
      const fullUrl = titleAnchor.href;

      // DOI extraction from citation text
      const citationEl = el.querySelector('.article--citation .meta-citation, .article--citation');
      const citationText = citationEl ? citationEl.textContent : '';
      const doiMatch = citationText.match(/10\.1001\/[^\s]+/);
      if (!doiMatch) return;
      const doi = doiMatch[0].replace(/[.,;]$/, '');
      if (seen.has(doi)) return;
      seen.add(doi);

      // Title (flatten subtitle into a single string with " — " separator)
      const subtitleEl = titleAnchor.querySelector('.subtitle');
      let title;
      if (subtitleEl) {
        const mainText = titleAnchor.childNodes[0]?.textContent?.trim() || '';
        const sub = subtitleEl.textContent.trim().replace(/^\s*:\s*/, '').replace(/\s+/g, ' ');
        title = (mainText ? mainText.trim() + ' — ' : '') + sub;
      } else {
        title = titleAnchor.textContent.trim().replace(/\s+/g, ' ');
      }
      // Optional sub-section classification (e.g., "Caring for the Critically Ill Patient")
      const superClass = el.querySelector('h4.superClassification');
      if (superClass) {
        title = `[${superClass.textContent.trim()}] ${title}`;
      }

      const authorEl = el.querySelector('.article--authors');
      const author = authorEl
        ? authorEl.textContent.trim().replace(/\s+/g, ' ').replace(/\s*;?\s*et al\.\s*$/, '').substring(0, 200)
        : '';

      const absEl = el.querySelector('.article--excerpt p.para, .article--excerpt');
      const abstract = absEl ? absEl.textContent.trim().replace(/\s+/g, ' ') : '';

      // OA gate — strict JAMA rule per Copper 2026-04-22 bug fix
      const isOA = !!el.querySelector('.badges .badge.icon-free');

      // PDF URL from explicit anchor; fall back to constructed path
      const pdfAnchor = el.querySelector('a.pdf.pdfaccess, a.pdfaccess');
      const pdfHref = pdfAnchor ? pdfAnchor.getAttribute('href') : '';
      const articleId = (pdfAnchor && pdfAnchor.getAttribute('data-article-id')) || doi.replace(/^10\.1001\//, '');

      articles.push({
        doi,
        articleId,
        title,
        abstract,
        pdfUrl: pdfHref || `https://jamanetwork.com/journals/jama/articlepdf/${articleId}`,
        fullUrl,
        author,
        typeCode: '',
        typeName: currentSection,
        hasPdf: isOA,   // STRICT: non-OA NOT downloadable — Copper 2026-04-22 bug fix
        isOA,
        journal: 'JAMA',
      });
    });
    return articles;
  }

  // ── LWW (Wolters Kluwer) TOC parser ──
  // DOM verified 2026-05-02 against journals.lww.com/jasn/pages/currenttoc.aspx
  // (snapshot saved at Dropbox/_Inbox/jasn-toc-snap-2026-05-02.html). LWW platform
  // is shared by JASN, CJASN, KI Reports, and most Wolters Kluwer journals.
  //
  // Article wrapper: HTML5 <article> element (one per article entry; 20 in JASN current).
  // Section heading: nearest preceding <h3 aria-expanded="false"> inside <section class="content-box">.
  //   Sections in JASN 2026-05: Editorial / Basic Research / Clinical Research /
  //   Mechanisms of Kidney Diseases / Clinical Nephrology Insights / Innovator Corner /
  //   Designing Clinical Trials / Perspective.
  // Title + fullUrl: <header><h4><a title="..." href="...">.
  // Authors: .js-few-authors .authors.
  // DOI: extracted from any descendant element's data-config JSON containing
  //   "Article|<journal>:<year>:<issue>:<id>|10.<prefix>/...|" — DOI prefix 10.1681 (JASN) /
  //   10.2215 (CJASN); fallback to URL-derived articleId.
  //
  // OA flag: LWW TOC has NO open-access flag at the TOC level. The platform is
  //   subscription-based by default. Per Copper directive 2026-05-02, JASN and CJASN
  //   are subscribed: the parser flags hasPdf=true for narrative-review section
  //   headings (Mechanisms of Kidney Diseases / Clinical Nephrology Insights /
  //   Innovator Corner / Designing Clinical Trials / Perspective / Review) so they
  //   are auto-checked for download in the popup. Other sections stay metadata-only.
  //
  // PDF endpoint: LWW PDFs require navigating the article fulltext page first;
  //   pdfUrl is set to fullUrl + ?Pdf=Yes as a best-guess pattern (LWW often honors
  //   this query string and 302-redirects to the actual PDF endpoint with token).
  //   TODO: verify against article page download button; if pattern fails, replace
  //   with a 2-step fetch (fetch fulltext page → extract download.lww.com signed URL).
  function parseLWW_TOC() {
    // Section blacklist — Copper directive 2026-05-02 (CJASN-led, applied to all
    // LWW journals for consistency). Subscribed JASN/CJASN articles in any
    // non-blacklisted section are auto-flagged for download. The blacklist
    // excludes high-volume non-narrative content that the user does not
    // routinely batch-download. Substring match (case-insensitive) against the
    // section heading text. The popup UI still allows manual checkbox override
    // for blacklisted articles (no `disabled` attribute applied).
    //
    // Supersedes the v3.13.0 NARRATIVE_REVIEW_SECTIONS whitelist (8 entries) —
    // blacklist is broader-default and matches Copper's actual reading workflow.
    const EXCLUDED_SECTIONS = [
      'clinical research',         // JASN / CJASN — original research articles, large volume
      'letter to the editor',      // JASN / CJASN — correspondence
      'about the cover',           // JASN / CJASN — cover image notes
    ];

    // Walk the article-list region in document order, tracking the most recent <h3>
    // section heading and emitting one record per <article>.
    const root = document.querySelector('.article-list') || document.body;
    const walked = root.querySelectorAll('h3, article');
    const articles = [];
    const seen = new Set();

    // Journal slug from URL path (jasn / cjasn / ki / etc.).
    const slugMatch = location.pathname.match(/^\/([a-z]+)\//i);
    const journalSlug = slugMatch ? slugMatch[1].toLowerCase() : 'lww';
    const journalName = journalSlug.toUpperCase();

    let currentSection = '';
    walked.forEach(el => {
      if (el.tagName === 'H3') {
        // Only treat <h3> with aria-expanded as a TOC section heading (skip in-article h3).
        if (el.hasAttribute('aria-expanded') || el.closest('section.content-box')) {
          currentSection = (el.textContent || '').trim().replace(/\s+/g, ' ');
        }
        return;
      }

      // <article>
      const titleA = el.querySelector('header h4 a, h4 > a[title]');
      if (!titleA) return;
      const title = (titleA.getAttribute('title') || titleA.textContent || '').trim().replace(/\s+/g, ' ');
      if (!title) return;
      const fullHref = titleA.getAttribute('href') || '';
      const fullUrl = fullHref.startsWith('http') ? fullHref : `https://journals.lww.com${fullHref}`;

      // DOI: scan any descendant data-config JSON for a 10.<digits>/... DOI.
      let doi = '';
      const cfgEls = el.querySelectorAll('[data-config]');
      for (const cfgEl of cfgEls) {
        const cfg = cfgEl.getAttribute('data-config') || '';
        const m = cfg.match(/(10\.\d{4,5}\/[A-Za-z][\w./-]+)/);
        if (m) { doi = m[1].toLowerCase().replace(/[.,;]+$/, ''); break; }
      }

      // articleId: derived from DOI suffix or URL slug.
      const articleId = doi
        ? doi.replace(/^10\.\d{4,5}\//, '').replace(/[^a-z0-9]/g, '_')
        : (fullUrl.split('/').pop() || '').replace(/\.aspx$/, '');

      const dedupKey = doi || fullUrl;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);

      const authorsEl = el.querySelector('.js-few-authors .authors, .authors');
      const author = authorsEl ? authorsEl.textContent.trim().replace(/\s+/g, ' ').replace(/<[^>]+>/g, '') : '';

      // Blacklist match (case-insensitive substring): hasPdf=false for excluded
      // sections, hasPdf=true for everything else. UI still permits manual
      // override (the checkbox is no longer disabled in v3.15.0).
      const sectionLc = currentSection.toLowerCase();
      const isExcluded = EXCLUDED_SECTIONS.some(s => sectionLc.includes(s));

      // PDF URL — extract from the article's PDF download button.
      // LWW issue TOC pattern (Copper 2026-05-02 verified via osascript probe of
      // hm4 Chrome Beta active CJASN tab): each article has a wk-icon-file-pdf
      // <i> wrapped by <button class="user-menu__link--download" data-config='{
      //   "eventDetail":{"url":"https://journals.lww.com/{journal}/_layouts/15/
      //   oaks.journals/downloadpdf.aspx?trckng_src_pg=ArticleDisplayControl&an=
      //   {accession_number}","gating":false},...}'>
      // The data-config "url" is the real, accession-number-bound, subscriber-
      // gated PDF endpoint. chrome.downloads.download uses Chrome's own cookie
      // jar (not ext popup-context fetch), so the LWW session cookie travels
      // automatically, and the server streams the PDF binary.
      let pdfUrl = '';
      const pdfBtn = el.querySelector('i.wk-icon-file-pdf');
      if (pdfBtn) {
        const btn = pdfBtn.closest('button[data-config], a[data-config], [data-config]');
        if (btn) {
          const cfg = btn.getAttribute('data-config');
          try {
            const parsed = JSON.parse(cfg);
            const ev = parsed && (parsed.eventDetail || parsed.detail);
            const url = ev && ev.url;
            if (url) pdfUrl = new URL(url, location.href).href;
          } catch (e) {
            // JSON.parse fail; leave pdfUrl blank, fall back below.
          }
        }
      }
      // Fallback: if no data-config extraction succeeded, use the v3.13 best-
      // guess `?Pdf=Yes` and let the v3.17 2-step resolver kick in at download
      // time. v3.18 plan = the data-config path covers the canonical case;
      // resolver-based fallback survives unmaintained / non-CJASN LWW UIs.
      if (!pdfUrl) {
        pdfUrl = fullUrl.includes('?') ? `${fullUrl}&Pdf=Yes` : `${fullUrl}?Pdf=Yes`;
      }

      articles.push({
        doi,
        articleId,
        title,
        abstract: '',                 // LWW TOC has no inline abstract preview.
        pdfUrl,
        fullUrl,
        author,
        typeCode: '',
        typeName: currentSection,
        hasPdf: !isExcluded,          // BLACKLIST: hasPdf=false only for Clinical Research / Letter to the Editor / About the Cover; everything else default-on (Copper 2026-05-02).
        isOA: false,                  // LWW TOC has no OA flag; subscription default.
        journal: journalName,
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
    aim: [
      // Atypon standard abstract locations on acpjournals.org/doi/10.7326/*
      'section[role="doc-abstract"] p',
      'section#abstract p',
      'div#abstract p',
      '.hlFld-Abstract p',
      'div[class*="abstractInFull"] p',
      'div[class*="abstract"] p',
      // Fallback: the TOC-level summary is also echoed on article page
      '.article__summary p',
    ],
    jama: [
      // JAMA Network platform (Silverchair) — article abstracts on /fullarticle/ and /article-abstract/
      'div.abstract-content p',
      'section.abstract p',
      'div.abstract p',
      '#ArticleAbstract p',
      'div[class*="abstract"] p',
      '.article-full-text .abstract p',
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
      else if (mode === 'aim-toc') articles = parseAIM_TOC();
      else if (mode === 'jama-toc') articles = parseJAMA_TOC();
      else if (mode === 'lww-toc') articles = parseLWW_TOC();
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
    } else if (request.action === 'resolveLWWPDF') {
      // v3.17.0: same-origin fetch from the LWW tab so subscriber cookies
      // travel automatically. Popup-context fetch is cross-origin and may
      // not send LWW session cookies under MV3 + SameSite policies.
      (async () => {
        try {
          const res = await fetch(request.url, { credentials: 'include', redirect: 'follow' });
          if (!res.ok) {
            sendResponse({ ok: false, status: res.status });
            return;
          }
          const html = await res.text();
          sendResponse({ ok: true, html });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
  });
})();
