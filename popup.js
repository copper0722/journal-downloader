// PDF Batch Downloader — Popup Script
// Generic PDF detection + NEJM/Nature enhancements

let articles = [];
let pageMode = 'generic';

function sanitize(str) {
  return str.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().substring(0, 120);
}
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function modeBase() {
  if (pageMode.startsWith('nejm')) return 'nejm';
  if (pageMode.startsWith('nature')) return 'nature';
  if (pageMode.startsWith('science')) return 'science';
  return 'generic';
}

function renderList() {
  const list = document.getElementById('list');
  const countLabel = document.getElementById('countLabel');
  const header = document.getElementById('header');
  const headerTitle = document.getElementById('headerTitle');
  const btn = document.getElementById('btnDownload');
  const suppLabel = document.getElementById('suppLabel');
  const btnFetch = document.getElementById('btnFetchAbs');
  const btnSave = document.getElementById('btnSaveMd');
  const progressFill = document.getElementById('progressFill');

  const base = modeBase();
  header.className = `header ${base}`;
  progressFill.className = `fill ${base}`;
  btn.className = `btn-dl btn-${base}`;

  const titles = { nejm: 'NEJM Downloader', nature: 'Nature Downloader', science: 'Science Downloader', generic: 'PDF Batch Downloader' };
  headerTitle.textContent = titles[base];

  // Show/hide journal-specific buttons
  suppLabel.style.display = base === 'nejm' ? '' : 'none';
  // Fetch Abstracts + Save MD are now available for all journal modes (not generic)
  btnFetch.style.display = base === 'generic' ? 'none' : '';
  btnSave.style.display = base === 'generic' ? 'none' : '';

  if (articles.length === 0) {
    list.innerHTML = '<div class="empty">No PDF links found on this page.</div>';
    countLabel.textContent = '';
    btn.disabled = true;
    return;
  }

  const downloadable = articles.filter(a => a.hasPdf);
  countLabel.textContent = base === 'generic'
    ? `${articles.length} PDFs found`
    : `${articles.length} articles · ${downloadable.length} downloadable`;
  btn.disabled = downloadable.length === 0;

  let html = '';
  let lastType = null;

  articles.forEach((a, i) => {
    // Section headers for Nature
    if (base === 'nature' && a.typeName && a.typeName !== lastType) {
      html += `<div class="section-header">${escHtml(a.typeName)}</div>`;
      lastType = a.typeName;
    }

    const checked = a.hasPdf ? 'checked' : '';
    const disabled = a.hasPdf ? '' : 'disabled';

    let badges = '';
    if (base === 'nature') {
      badges = a.isOA ? '<span class="badge oa">OA</span>' : '<span class="badge closed">Closed</span>';
    } else if (base === 'science') {
      badges = a.isOA ? '<span class="badge oa">Free</span>' : '<span class="badge closed">Paywall</span>';
      if (a.typeName) badges += ` <span class="badge type">${escHtml(a.typeName)}</span>`;
    } else if (base === 'nejm' && a.typeName) {
      badges = `<span class="badge type">${escHtml(a.typeName)}</span>`;
    } else if (base === 'generic') {
      badges = '<span class="badge pdf">PDF</span>';
    }

    const abstractHtml = a.abstract
      ? `<div class="abstract" data-index="${i}">${escHtml(a.abstract)}</div>`
      : '';

    // For generic mode, show truncated URL
    const urlHtml = base === 'generic'
      ? `<div class="url">${escHtml(a.pdfUrl.substring(0, 80))}${a.pdfUrl.length > 80 ? '...' : ''}</div>`
      : '';

    const authorHtml = a.author ? `<span>${escHtml(a.author)}</span>` : '';

    html += `
    <div class="item" data-index="${i}">
      <input type="checkbox" class="articleCb" data-index="${i}" ${checked} ${disabled}>
      <div class="info">
        <div class="title">${escHtml(a.title)}</div>
        ${urlHtml}${abstractHtml}
        <div class="meta">
          ${badges} ${authorHtml}
          <span class="status" id="status-${i}"></span>
        </div>
      </div>
    </div>`;
  });

  list.innerHTML = html;
  list.querySelectorAll('.abstract').forEach(el => {
    el.addEventListener('click', () => el.classList.toggle('expanded'));
  });
}

// ── Download PDFs ──
async function startDownload() {
  const btn = document.getElementById('btnDownload');
  const statusEl = document.getElementById('status');
  const progressFill = document.getElementById('progressFill');
  const inclSupp = document.getElementById('inclSupp')?.checked;

  const selected = [];
  document.querySelectorAll('.articleCb:checked').forEach(cb => {
    selected.push(articles[parseInt(cb.dataset.index)]);
  });
  if (selected.length === 0) return;

  btn.disabled = true;
  btn.textContent = 'Downloading...';
  statusEl.classList.add('active');

  let completed = 0;
  for (const article of selected) {
    const idx = articles.indexOf(article);
    const statusSpan = document.getElementById(`status-${idx}`);
    statusEl.textContent = `Downloading ${completed + 1}/${selected.length}`;
    progressFill.style.width = `${(completed / selected.length) * 100}%`;

    // Determine filename
    let filename;
    if (article.journal === 'generic') {
      filename = article.filename || `${sanitize(article.title)}.pdf`;
    } else {
      filename = `${article.articleId}_${sanitize(article.title)}.pdf`;
    }

    try {
      await downloadFile(article.pdfUrl, filename);
      statusSpan.innerHTML = ' <span class="done">&#10003;</span>';
    } catch (e) {
      statusSpan.innerHTML = ' <span class="fail">&#10007;</span>';
    }

    // NEJM supplements
    if (inclSupp && article.journal === 'NEJM' && ['oa', 'ra', 'sa'].includes(article.typeCode)) {
      try {
        const supps = await fetchSupplements(article.fullUrl);
        for (let si = 0; si < supps.length; si++) {
          await downloadFile(supps[si].url, `${article.articleId}_suppl${supps.length > 1 ? si + 1 : ''}.pdf`);
        }
        if (supps.length > 0) statusSpan.innerHTML += ` <span class="done">+${supps.length}s</span>`;
      } catch (e) { /* skip */ }
    }

    completed++;
    await sleep(1000);
  }

  progressFill.style.width = '100%';
  statusEl.textContent = `Done. ${completed} files downloaded.`;
  btn.textContent = 'Download All';
  btn.disabled = false;
}

// ── Fetch Abstracts (all modes) ──
// Fetches article page HTML via content.js, extracts abstract using per-journal selectors.
async function fetchAbstracts() {
  const btn = document.getElementById('btnFetchAbs');
  const statusEl = document.getElementById('status');
  const progressFill = document.getElementById('progressFill');
  const base = modeBase();

  // Which article types to fetch abstracts for (skip editorials/letters/images etc. that typically have no abstract)
  const shouldFetch = (a) => {
    if (!a.fullUrl) return false;
    // Skip obvious non-abstract types by name
    const tn = (a.typeName || '').toLowerCase();
    if (tn.match(/image|letter|correspond|correction|erratum|obituary|news/)) return false;
    // If already has a substantial abstract, skip
    if (a.abstract && a.abstract.length > 400) return false;
    return true;
  };

  const toFetch = articles.map((a, i) => ({ ...a, index: i })).filter(shouldFetch);
  if (toFetch.length === 0) {
    statusEl.classList.add('active');
    statusEl.textContent = 'Nothing to fetch (abstracts already present or skipped types).';
    return;
  }

  btn.disabled = true;
  statusEl.classList.add('active');
  statusEl.textContent = `Fetching abstracts from ${toFetch.length} article pages...`;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchAbstracts', articles: toFetch, mode: base }, response => {
      if (chrome.runtime.lastError || !response) {
        statusEl.textContent = 'Fetch failed. Reload page and retry.';
        btn.disabled = false;
        return;
      }
      (response.results || []).forEach(r => { if (r.abstract) articles[r.index].abstract = r.abstract; });
      const fetched = (response.results || []).filter(r => r.abstract).length;
      statusEl.textContent = `Fetched ${fetched}/${toFetch.length} abstracts.`;
      btn.textContent = 'Fetch Abstracts';
      btn.disabled = false;
      progressFill.style.width = '100%';
      renderList();
    });
  });

  let elapsed = 0;
  const poll = setInterval(() => {
    elapsed++;
    const est = Math.min(elapsed / (toFetch.length * 0.8) * 100, 95);
    progressFill.style.width = `${est}%`;
    btn.textContent = `Fetching... ~${Math.round(est)}%`;
    if (elapsed > toFetch.length * 2) clearInterval(poll);
  }, 1000);
}

// ── Save TOC as Markdown (all modes) ──
// Unified MD export: each article gets full title, DOI, links (full text + PDF), type, authors, OA flag, abstract.
function saveToMarkdown() {
  const base = modeBase();
  const today = new Date().toISOString().split('T')[0];
  const journalName = base === 'nejm' ? 'NEJM' : base === 'nature' ? 'Nature' : base === 'science' ? 'Science' : 'TOC';

  // Detect issue identifier from URL path (if any)
  let issueTag = '';
  const url = (articles[0] && (articles[0].fullUrl || articles[0].pdfUrl)) || location.href;
  // NEJM: /toc/nejm/394/15  → 394_15
  // Nature: /nature/volumes/652/issues/8108 → 652_8108
  // Science: /toc/science/392/6791 → 392_6791
  const m1 = url.match(/\/toc\/[^/]+\/(\d+)\/(\d+)/);
  const m2 = url.match(/\/volumes\/(\d+)\/issues\/(\d+)/);
  if (m1) issueTag = `_${m1[1]}-${m1[2]}`;
  else if (m2) issueTag = `_${m2[1]}-${m2[2]}`;

  const oaCount = articles.filter(a => a.isOA).length;
  const totalArticles = articles.length;

  let md = `---
generated: ${today}
journal: ${journalName}
type: raw
source: toc
article_count: ${totalArticles}
oa_count: ${oaCount}
---

# ${journalName} TOC — ${today}${issueTag ? ` (issue ${issueTag.substring(1)})` : ''}

${totalArticles} articles · ${oaCount} open access / free

`;

  let lastType = null;
  articles.forEach((a, i) => {
    if (a.typeName && a.typeName !== lastType) {
      md += `\n## ${a.typeName}\n\n`;
      lastType = a.typeName;
    }

    md += `### ${i + 1}. ${a.title}\n\n`;

    // Metadata line — OA flag + author
    const meta = [];
    if (a.isOA) meta.push('🟢 **Open Access**');
    else if (a.isOA === false && base !== 'generic') meta.push('🔒 Paywall');
    if (a.author) meta.push(`👤 ${a.author}`);
    if (meta.length) md += meta.join(' · ') + '\n\n';

    // Links block — DOI, Full text, PDF
    const links = [];
    if (a.doi) links.push(`**DOI**: [${a.doi}](https://doi.org/${a.doi})`);
    if (a.fullUrl) links.push(`**Full text**: <${a.fullUrl}>`);
    if (a.pdfUrl && a.hasPdf) links.push(`**PDF**: <${a.pdfUrl}>`);
    if (a.articleId) links.push(`**ID**: \`${a.articleId}\``);
    if (links.length) md += links.join('  \n') + '\n\n';

    // Abstract (if present)
    if (a.abstract) {
      md += `> ${a.abstract}\n\n`;
    }

    md += '---\n\n';
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const urlObj = URL.createObjectURL(blob);
  chrome.downloads.download(
    { url: urlObj, filename: `${today}_${journalName}_TOC${issueTag}.md`, conflictAction: 'uniquify' },
    () => {
      URL.revokeObjectURL(urlObj);
      const statusEl = document.getElementById('status');
      statusEl.classList.add('active');
      statusEl.textContent = `Saved ${today}_${journalName}_TOC${issueTag}.md`;
    }
  );
}

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify' }, id => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
}

function fetchSupplements(articleUrl) {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return resolve([]);
      chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSupplements', url: articleUrl }, response => {
        if (chrome.runtime.lastError || !response) resolve([]);
        else resolve(response.supplements || []);
      });
    });
  });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getArticles' }, response => {
      if (chrome.runtime.lastError || !response) {
        document.getElementById('list').innerHTML = '<div class="empty">Cannot read page. Reload and try again.</div>';
        return;
      }
      articles = response.articles || [];
      pageMode = response.mode || 'generic';
      renderList();
    });
  });

  document.getElementById('btnDownload').addEventListener('click', startDownload);
  document.getElementById('btnFetchAbs').addEventListener('click', fetchAbstracts);
  document.getElementById('btnSaveMd').addEventListener('click', saveToMarkdown);
  document.getElementById('selectAll').addEventListener('change', e => {
    document.querySelectorAll('.articleCb:not(:disabled)').forEach(cb => { cb.checked = e.target.checked; });
  });
});
