// PDF Batch Downloader — Popup Script
// Generic PDF detection + NEJM/Nature enhancements + Journals dashboard (v3.12)

let articles = [];
let pageMode = 'generic';

// ===========================================================================
// Journals dashboard (v3.12) — last-fetched issue + cadence reminders
// State persisted in chrome.storage.local under key 'journals'.
// ===========================================================================

const JOURNAL_DEFAULTS = {
  nejm:         { label: 'NEJM',          cadence: 'weekly',   day: 4, color: '#b31b1b', homepage: 'https://www.nejm.org/toc/nejm/current' },
  nejmevidence: { label: 'NEJM Evidence', cadence: 'monthly',  dom: 1, color: '#b31b1b', homepage: 'https://evidence.nejm.org/toc/evidence/current' },
  nature:       { label: 'Nature',        cadence: 'weekly',   day: 4, color: '#005ea2', homepage: 'https://www.nature.com/nature/current-issue' },
  science:      { label: 'Science',       cadence: 'weekly',   day: 5, color: '#a60f2d', homepage: 'https://www.science.org/toc/science/current' },
  jama:         { label: 'JAMA',          cadence: 'weekly',   day: 2, color: '#b72025', homepage: 'https://jamanetwork.com/journals/jama/currentissue' },
  lancet:       { label: 'Lancet',        cadence: 'weekly',   day: 5, color: '#e6001c', homepage: 'https://www.thelancet.com/journals/lancet/issues' },
  bmj:          { label: 'BMJ',           cadence: 'weekly',   day: 5, color: '#2a6ebb', homepage: 'https://www.bmj.com/thisweek' },
  aim:          { label: 'AIM',           cadence: 'biweekly', day: 3, color: '#005e39', homepage: 'https://www.acpjournals.org/toc/aim/current' },
  jasn:         { label: 'JASN',          cadence: 'monthly',  dom: 1, color: '#005e39', homepage: 'https://journals.lww.com/jasn/pages/currenttoc.aspx' },
  cjasn:        { label: 'CJASN',         cadence: 'monthly',  dom: 1, color: '#005e39', homepage: 'https://journals.lww.com/cjasn/pages/currenttoc.aspx' },
};

const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 };

function loadJournals() {
  return new Promise(resolve => {
    chrome.storage.local.get('journals', data => {
      if (data.journals && Object.keys(data.journals).length > 0) {
        // Merge defaults: any new built-in journal that storage doesn't have yet, add it.
        const merged = { ...JSON.parse(JSON.stringify(JOURNAL_DEFAULTS)), ...data.journals };
        resolve(merged);
      } else {
        resolve(JSON.parse(JSON.stringify(JOURNAL_DEFAULTS)));
      }
    });
  });
}

function saveJournals(journals) {
  return new Promise(resolve => {
    chrome.storage.local.set({ journals }, resolve);
  });
}

function computeStatus(j) {
  if (!j.lastIssue || !j.lastIssue.date) {
    return { emoji: '⚪', label: 'BACKFILL', cls: 'muted' };
  }
  const last = new Date(j.lastIssue.date + 'T00:00:00');
  const now = new Date();
  const days = Math.floor((now - last) / 86400000);
  const cycleDays = CADENCE_DAYS[j.cadence] || 7;
  const cycles = Math.floor(days / cycleDays);
  if (cycles <= 0) return { emoji: '🟢', label: 'on schedule', cls: 'ok' };
  // within 2 days past the next-due → "DUE NOW", else overdue
  const remainder = days - cycles * cycleDays;
  if (cycles === 1 && remainder <= 2) return { emoji: '⚠', label: 'DUE NOW', cls: 'warn' };
  return { emoji: '🔴', label: `−${cycles}`, cls: '' };
}

// Extract { vol, no } from a journal TOC URL. Returns null if not recognised.
function extractIssueFromUrl(url) {
  if (!url) return null;
  const patterns = [
    /\/toc\/[^/]+\/(\d+)\/(\d+)/,                        // NEJM, Science, AIM
    /\/volumes\/(\d+)\/issues\/(\d+)/,                   // Nature
    /\/journals\/lancet\/issue\/vol(\d+)no(\d+)/,        // Lancet
    /bmj\.com\/content\/(\d+)\/(\d+)/,                   // BMJ
    /jamanetwork\.com\/journals\/jama\/issue\/(\d+)\/(\d+)/, // JAMA
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return { vol: m[1], no: m[2] };
  }
  return null;
}

// Map content.js detectMode() output ('nejm-toc', 'nature-toc', ...) → journal key.
// For multi-journal platforms (LWW), the journal slug is read from the URL path.
function modeToJournalKey(mode, url) {
  if (!mode) return null;
  const base = mode.split('-')[0];
  // detectMode never says 'nejmevidence'; evidence.nejm.org currently isn't matched in content.js.
  // Built-in mapping covers the 7 detected single-journal modes.
  if (['nejm', 'nature', 'science', 'lancet', 'bmj', 'aim', 'jama'].includes(base)) return base;
  // LWW (Wolters Kluwer) is a multi-journal platform; derive slug from URL path.
  // Built-in JOURNAL_DEFAULTS covers jasn + cjasn; other LWW journals (KI, KI Reports, ...)
  // require the user to add via the dashboard "+ Add monthly journal" modal first.
  if (base === 'lww' && url) {
    const m = url.match(/journals\.lww\.com\/([a-z]+)\//i);
    if (m) {
      const slug = m[1].toLowerCase();
      if (['jasn', 'cjasn'].includes(slug)) return slug;
    }
  }
  return null;
}

// If the active tab is a known journal TOC page, update that journal's lastIssue.
async function recordLastIssueFromTab() {
  const tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, t => r(t[0])));
  if (!tab || !tab.url) return false;
  const key = modeToJournalKey(pageMode, tab.url);
  if (!key) return false;
  const issue = extractIssueFromUrl(tab.url);
  // For "current"-style URLs we still bump the lastIssue.url + date but leave vol/no null.
  const journals = await loadJournals();
  if (!journals[key]) return false;
  const today = new Date().toISOString().slice(0, 10);
  const prev = journals[key].lastIssue || {};
  // Skip update if URL identical and recorded same day.
  if (prev.url === tab.url && prev.date === today) return false;
  journals[key].lastIssue = {
    date: today,
    vol: issue ? issue.vol : (prev.vol || null),
    no: issue ? issue.no : (prev.no || null),
    url: tab.url,
  };
  await saveJournals(journals);
  return true;
}

function renderJournals(journals) {
  const list = document.getElementById('journalList');
  if (!list) return;
  // Order: weekly first (by day), then biweekly, then monthly, then quarterly, then unknown.
  const order = ['weekly', 'biweekly', 'monthly', 'quarterly'];
  const entries = Object.entries(journals).sort((a, b) => {
    const [ka, ja] = a;
    const [kb, jb] = b;
    const ai = order.indexOf(ja.cadence);
    const bi = order.indexOf(jb.cadence);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return ka.localeCompare(kb);
  });
  let html = '';
  for (const [key, j] of entries) {
    const status = computeStatus(j);
    const url = (j.lastIssue && j.lastIssue.url) || j.homepage || '#';
    const issueLabel = j.lastIssue && j.lastIssue.date
      ? (j.lastIssue.vol && j.lastIssue.no
          ? `${j.lastIssue.date} v${j.lastIssue.vol}n${j.lastIssue.no}`
          : j.lastIssue.date)
      : '(never)';
    const cadenceShort = j.cadence === 'monthly' ? 'mo' : j.cadence === 'biweekly' ? 'biwk' : j.cadence === 'quarterly' ? 'qtr' : 'wk';
    html += `
      <div class="j-row" data-url="${escHtml(url)}" data-key="${escHtml(key)}" style="border-left-color: ${j.color || '#ccc'}">
        <span class="j-status">${status.emoji}</span>
        <span class="j-label">${escHtml(j.label)}</span>
        <span class="j-cadence">${cadenceShort}</span>
        <span class="j-last">${escHtml(issueLabel)}</span>
        <span class="j-overdue ${status.cls}">${escHtml(status.label)}</span>
      </div>`;
  }
  list.innerHTML = html;
  list.querySelectorAll('.j-row').forEach(row => {
    row.addEventListener('click', () => {
      const url = row.dataset.url;
      if (url && url !== '#') chrome.tabs.create({ url });
    });
  });
}

async function refreshDashboard() {
  const journals = await loadJournals();
  renderJournals(journals);
}

// Add-journal modal
function openAddModal() {
  document.getElementById('addModal').classList.add('active');
  document.getElementById('addLabel').focus();
}
function closeAddModal() {
  document.getElementById('addModal').classList.remove('active');
  ['addLabel', 'addKey', 'addDay', 'addDom', 'addHomepage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('addCadence').value = 'monthly';
}
async function saveAddModal() {
  const label = document.getElementById('addLabel').value.trim();
  let key = document.getElementById('addKey').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cadence = document.getElementById('addCadence').value;
  const dayRaw = document.getElementById('addDay').value;
  const domRaw = document.getElementById('addDom').value;
  const homepage = document.getElementById('addHomepage').value.trim();
  if (!label) { alert('Label required'); return; }
  if (!key) key = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  const journals = await loadJournals();
  if (journals[key]) { alert(`Key '${key}' already exists`); return; }
  const j = { label, cadence, color: '#666', homepage: homepage || '#', custom: true };
  if (dayRaw !== '' && (cadence === 'weekly' || cadence === 'biweekly')) j.day = Number(dayRaw);
  if (domRaw !== '' && (cadence === 'monthly' || cadence === 'quarterly')) j.dom = Number(domRaw);
  journals[key] = j;
  await saveJournals(journals);
  closeAddModal();
  renderJournals(journals);
}

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
  if (pageMode.startsWith('lancet')) return 'lancet';
  if (pageMode.startsWith('bmj')) return 'bmj';
  if (pageMode.startsWith('aim')) return 'aim';
  if (pageMode.startsWith('jama')) return 'jama';
  if (pageMode.startsWith('lww')) return 'lww';
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

  const titles = { nejm: 'NEJM Downloader', nature: 'Nature Downloader', science: 'Science Downloader', lancet: 'Lancet Downloader', bmj: 'BMJ Downloader', aim: 'Annals of IM Downloader', jama: 'JAMA Downloader', generic: 'PDF Batch Downloader' };
  headerTitle.textContent = titles[base];

  // 2-button UI:
  //   btnFetch = "Fetch + Save MD" (combined, all journal modes)
  //   btnDownload = "Download Selected" (always)
  // btnSave (separate Save MD) hidden — merged into btnFetch action.
  suppLabel.style.display = base === 'nejm' ? '' : 'none';
  btnFetch.style.display = base === 'generic' ? 'none' : '';
  btnFetch.textContent = 'Download All Abstracts → MD';
  btnSave.style.display = 'none';

  if (articles.length === 0) {
    list.innerHTML = '<div class="empty">No PDF links found on this page.</div>';
    countLabel.textContent = '';
    btn.disabled = true;
    return;
  }

  const downloadable = articles.filter(a => a.hasPdf);
  countLabel.textContent = base === 'generic'
    ? `${articles.length} PDFs found`
    : `${articles.length} articles · ${downloadable.length} default-on (manual override allowed)`;
  // Button enable/disable is wired to actual checkbox state (see
  // updateDownloadButtonState below) — set after render + bound to change events.

  let html = '';
  let lastType = null;

  articles.forEach((a, i) => {
    // Section headers for Nature
    if (base === 'nature' && a.typeName && a.typeName !== lastType) {
      html += `<div class="section-header">${escHtml(a.typeName)}</div>`;
      lastType = a.typeName;
    }

    const checked = a.hasPdf ? 'checked' : '';
    // No `disabled` attribute — Copper directive 2026-05-02: user must always
    // be able to manually tick a non-default entry (e.g. a Clinical Research
    // article in CJASN) and download it.

    let badges = '';
    if (base === 'nature') {
      badges = a.isOA ? '<span class="badge oa">OA</span>' : '<span class="badge closed">Closed</span>';
    } else if (base === 'science') {
      badges = a.isOA ? '<span class="badge oa">Free</span>' : '<span class="badge closed">Metadata</span>';
      if (a.typeName) badges += ` <span class="badge type">${escHtml(a.typeName)}</span>`;
    } else if (base === 'nejm' && a.typeName) {
      badges = `<span class="badge type">${escHtml(a.typeName)}</span>`;
    } else if (base === 'bmj') {
      // STRICT (Copper 2026-05-02 bug fix): non-OA BMJ articles are subscription-gated even
      // when the TOC suggests "free to read" — the PDF endpoint paywalls. Only the explicit
      // .open-access-flag is downloadable; everything else is Metadata-only.
      badges = a.isOA ? '<span class="badge oa">OA</span>' : '<span class="badge closed">Metadata</span>';
      if (a.typeName) badges += ` <span class="badge type">${escHtml(a.typeName)}</span>`;
    } else if (base === 'aim') {
      // AIM has no reliable TOC-level OA flag; keep it metadata-only.
      if (a.typeName) badges = `<span class="badge type">${escHtml(a.typeName)}</span>`;
      badges += ' <span class="badge closed">Metadata</span>';
    } else if (base === 'jama') {
      // JAMA has explicit .badge.icon-free OA flag — STRICT gate per Copper 2026-04-22
      // (non-OA articles' PDFs are server-gated via /Content/CheckPdfAccess, generic
      // grabbing produces paywall HTML). hasPdf=isOA + checkbox disabled for non-OA.
      badges = a.isOA ? '<span class="badge oa">Free</span>' : '<span class="badge closed">Metadata</span>';
      if (a.typeName) badges += ` <span class="badge type">${escHtml(a.typeName)}</span>`;
    } else if (base === 'lww') {
      // LWW (JASN/CJASN/...) — TOC has no OA flag; whole platform is subscription-based.
      // hasPdf is set in content.js parser by section BLACKLIST (Copper directive
      // 2026-05-02, CJASN-led, generalised to LWW): hasPdf=false for
      // Clinical Research / Letter to the Editor / About the Cover; hasPdf=true
      // for everything else. Manual override always available (checkbox never
      // disabled in v3.15.0+).
      badges = a.hasPdf ? '<span class="badge oa">Sub. + DL</span>' : '<span class="badge closed">Excluded (manual OK)</span>';
      if (a.typeName) badges += ` <span class="badge type">${escHtml(a.typeName)}</span>`;
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
      <input type="checkbox" class="articleCb" data-index="${i}" ${checked}>
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
  // v3.15.0: download button tracks actual checkbox state (any check = enabled),
  // so manual override of default-off entries (e.g. CJASN Clinical Research)
  // re-enables the button.
  list.querySelectorAll('.articleCb').forEach(cb => {
    cb.addEventListener('change', updateDownloadButtonState);
  });
  updateDownloadButtonState();
}

function updateDownloadButtonState() {
  const btn = document.getElementById('btnDownload');
  if (!btn) return;
  const checkedCount = document.querySelectorAll('.articleCb:checked').length;
  btn.disabled = checkedCount === 0;
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
  btn.textContent = `Downloading ${selected.length} PDFs...`;
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
      let downloadUrl = article.pdfUrl;
      if (isLWWArticle(article)) {
        const resolved = await resolveLWWPDFUrl(article.fullUrl || article.pdfUrl);
        if (resolved) {
          console.log('[LWW resolver] resolved', article.fullUrl, '→', resolved);
          downloadUrl = resolved;
        } else {
          console.warn('[LWW resolver] no candidate matched, falling back to', article.pdfUrl);
        }
      }
      await downloadFile(downloadUrl, filename);
      statusSpan.innerHTML = ' <span class="done">&#10003;</span>';
    } catch (e) {
      statusSpan.innerHTML = ' <span class="fail">&#10007;</span>';
      console.error('[downloadFile] error', e, 'url=', article.pdfUrl);
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
  btn.textContent = 'Download Selected PDFs';
  btn.disabled = false;
}

// ── Fetch + Save MD (combined action, all modes) ──
// Fetches every article's abstract from its fulltext page in parallel (batched), then auto-saves the MD.
// Replaces the old "Fetch Abstracts" + separate "Save MD" workflow.
async function fetchAndSaveMd() {
  const btn = document.getElementById('btnFetchAbs');
  const statusEl = document.getElementById('status');
  const progressFill = document.getElementById('progressFill');
  const base = modeBase();

  // Target: all articles with a fullUrl; non-OA/subscription entries are metadata-only.
  // Skip only if abstract already long enough (>400 chars) AND fullUrl missing
  const toFetch = articles
    .map((a, i) => ({ ...a, index: i }))
    .filter(a => a.fullUrl && !(a.abstract && a.abstract.length > 400));

  if (toFetch.length === 0) {
    statusEl.classList.add('active');
    statusEl.textContent = 'No fetch needed — saving MD directly.';
    progressFill.style.width = '100%';
    saveToMarkdown();
    return;
  }

  btn.disabled = true;
  statusEl.classList.add('active');
  progressFill.style.width = '0%';

  // Parallel batching — 4 concurrent fetches. Each fetch has its own 8s timeout in content.js.
  const BATCH = 4;
  let completed = 0;
  const total = toFetch.length;
  const fetched = { n: 0 };

  const updateUi = () => {
    const pct = Math.round((completed / total) * 100);
    progressFill.style.width = `${pct}%`;
    btn.textContent = `Fetching ${completed}/${total} (${pct}%)`;
    statusEl.textContent = `Fetching abstracts — ${completed}/${total} done, ${fetched.n} captured`;
  };

  const doOne = (article) => new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) { resolve(); return; }
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: 'fetchOneAbstract', url: article.fullUrl, doi: article.doi, mode: base },
        response => {
          if (!chrome.runtime.lastError && response) {
            if (response.abstract) {
              articles[article.index].abstract = response.abstract;
              fetched.n++;
            }
            if (response.articleType && !articles[article.index].articleType) {
              articles[article.index].articleType = response.articleType;
            }
          }
          completed++;
          updateUi();
          resolve();
        }
      );
    });
  });

  // Run in parallel batches of BATCH
  const queue = toFetch.slice();
  const workers = [];
  for (let i = 0; i < BATCH; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const a = queue.shift();
        await doOne(a);
      }
    })());
  }
  await Promise.all(workers);

  progressFill.style.width = '100%';
  statusEl.textContent = `Fetched ${fetched.n}/${total} abstracts. Saving MD...`;

  renderList();
  // Auto-save MD immediately after fetch completes
  saveToMarkdown();

  btn.textContent = 'Download All Abstracts → MD';
  btn.disabled = false;
}

// ── Save TOC as Markdown (all modes) ──
// Unified MD export: each article gets full title, DOI, links (full text + PDF), type, authors, OA flag, abstract.
function saveToMarkdown() {
  const base = modeBase();
  const today = new Date().toISOString().split('T')[0];
  const journalName = base === 'nejm' ? 'NEJM' : base === 'nature' ? 'Nature' : base === 'science' ? 'Science' : base === 'lancet' ? 'Lancet' : base === 'bmj' ? 'BMJ' : base === 'aim' ? 'AIM' : base === 'jama' ? 'JAMA' : base === 'lww' ? ((articles[0] && articles[0].journal) || 'LWW') : 'TOC';

  // Detect issue identifier from URL path (if any)
  let issueTag = '';
  const url = (articles[0] && (articles[0].fullUrl || articles[0].pdfUrl)) || location.href;
  // NEJM: /toc/nejm/394/15  → 394_15
  // Nature: /nature/volumes/652/issues/8108 → 652_8108
  // Science: /toc/science/392/6791 → 392_6791
  // Lancet: /journals/lancet/issue/vol406no10494/... → 406_10494; /issue/current → (none)
  const m1 = url.match(/\/toc\/[^/]+\/(\d+)\/(\d+)/);
  const m2 = url.match(/\/volumes\/(\d+)\/issues\/(\d+)/);
  const m3 = location.href.match(/\/journals\/lancet\/issue\/vol(\d+)no(\d+)/);
  const m4 = location.href.match(/bmj\.com\/content\/(\d+)\/(\d+)/);
  if (m1) issueTag = `_${m1[1]}-${m1[2]}`;
  else if (m2) issueTag = `_${m2[1]}-${m2[2]}`;
  else if (m3) issueTag = `_${m3[1]}-${m3[2]}`;
  else if (m4) issueTag = `_${m4[1]}-${m4[2]}`;
  // AIM /toc/aim/current → extract Vol/No from document.title "Annals of Internal Medicine: Vol 179, No 4"
  if (!issueTag && base === 'aim') {
    const tm = document.title.match(/Vol\s+(\d+)[,\s]+No\s+(\d+)/i);
    if (tm) issueTag = `_${tm[1]}-${tm[2]}`;
  }
  // JAMA /journals/jama/currentissue → extract from first article's citation "JAMA. YYYY;VVV(II):pp-pp."
  if (!issueTag && base === 'jama') {
    const firstCit = document.querySelector('.article--citation .meta-citation');
    const ct = firstCit ? firstCit.textContent : '';
    const m = ct.match(/\d{4};(\d+)\((\d+)\)/);
    if (m) issueTag = `_${m[1]}-${m[2]}`;
  }
  // LWW /pages/currenttoc.aspx → derive issue tag from first article's fullUrl
  // path /jasn/fulltext/2026/05000/...aspx (year+issueDigit composite).
  if (!issueTag && base === 'lww') {
    const fU = articles[0] && articles[0].fullUrl ? articles[0].fullUrl : '';
    const m = fU.match(/\/[a-z]+\/fulltext\/(\d{4})\/(\d+)\//i);
    if (m) issueTag = `_${m[1]}-${m[2]}`;
  }

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

    // Metadata line — article type + OA flag + author
    const meta = [];
    // Article type: citation_article_type meta (from page fetch) trumps TOC section heading.
    const atype = a.articleType || a.typeName || '';
    if (atype) meta.push(`**${atype}**`);
    if (a.isOA) meta.push('🟢 Open Access');
    // BMJ non-OA: same treatment as JAMA/Science/Lancet — Metadata only (Copper 2026-05-02 bug fix:
    // "Free to read" was misleading because BMJ paywalls non-OA PDFs at the endpoint).
    else if (a.isOA === false && base !== 'generic') meta.push('Metadata only');
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

// ── LWW (Wolters Kluwer) PDF URL resolver (v3.16.0) ──
// LWW article fulltext pages expose the real PDF endpoint as a `data-pdf-url`
// attribute on the article-tools <div> (class "js-ejp-article-tools"), pointing
// to /{journal}/_layouts/15/oaks.journals/downloadpdf.aspx?an={accession_number}.
// The accession number ("an=" query) is the article's NLM-style identifier and
// is server-side authenticated against the user's subscriber cookie.
//
// The misleading `?Pdf=Yes&Ppt=Article|...` URL on the same page is the
// PowerPoint-slides export, NOT a PDF download. The bare `?Pdf=Yes` URL the
// v3.13.0 TOC parser constructed redirects to the article HTML page when no
// `an=` parameter is present, which Chrome then saves with a .html extension.
//
// This 2-step resolver fetches the article fulltext page with subscriber
// cookies (host_permissions <all_urls>), extracts data-pdf-url via DOM, falls
// back to regex on raw HTML, and only as last resort returns null so the
// caller falls back to the v3.13.0 ?Pdf=Yes best-guess (which still produces
// a .html — but mime sanity check warns).
//
// Reference HTML inspected: Dropbox/_inbox/cjn_0000000892_*.html (Copper
// 2026-05-02). Pattern verified against the National Prevalence Taiwan CKD
// CJASN article that was successfully downloaded as PDF manually
// (national_prevalence,_regional_distribution,_and.19.pdf).

function isLWWArticle(article) {
  if (!article) return false;
  if (article.journal === 'jasn' || article.journal === 'cjasn') return true;
  if (article.fullUrl && article.fullUrl.includes('journals.lww.com')) return true;
  if (article.pdfUrl && article.pdfUrl.includes('journals.lww.com')) return true;
  return false;
}

// Decode HTML entities such as &amp; -> & in URLs extracted from raw HTML
// (DOMParser already decodes attribute values; regex paths see escaped form).
function decodeHtmlEntities(s) {
  if (!s) return s;
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

async function resolveLWWPDFUrl(articleFullUrl) {
  if (!articleFullUrl) return null;
  // Strip ?Pdf=Yes / &Pdf=Yes; we want the article HTML page, not the redirect.
  const cleanUrl = articleFullUrl
    .replace(/[?&]Pdf=Yes\b/i, '')
    .replace(/\?$/, '')
    .replace(/&$/, '');
  try {
    const res = await fetch(cleanUrl, { credentials: 'include', redirect: 'follow' });
    if (!res.ok) {
      console.warn('[LWW resolver] fetch failed', cleanUrl, res.status);
      return null;
    }
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // DOM candidate selectors, priority order. Empirically the LWW PDF
    // endpoint lives on the article-tools <div>'s data-pdf-url attribute; the
    // earlier candidates target it most precisely, the rest are fallbacks.
    const domCandidates = [
      // Most precise: js-ejp-article-tools div with PDF enabled flag.
      '[data-pdf-url][data-pdf-enabled="true"]',
      // Broader: any element with data-pdf-url (may be div, button, or anchor).
      '[data-pdf-url]',
      // Direct PDF anchor (rare on current LWW UI but cheap to check).
      'a[href*="downloadpdf.aspx"]',
      'a[href*="/_layouts/15/oaks.journals/downloadpdf"]',
      // Generic PDF-mime alternate link.
      'link[rel="alternate"][type="application/pdf"][href]',
      // Legacy LWW CDN patterns kept as defensive fallback for other journals.
      'a[href*="download.lww.com"][href$=".pdf"]',
      'a[href*="cdn-links.lww.com"][href$=".pdf"]',
      'a[href*=".pdf"][title*="PDF" i]',
      'a[href*=".pdf"][aria-label*="PDF" i]',
    ];
    for (const sel of domCandidates) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const href = el.getAttribute('data-pdf-url') || el.getAttribute('href');
      if (!href) continue;
      const abs = new URL(href, cleanUrl).href;
      console.log('[LWW resolver] DOM candidate hit', sel, '→', abs);
      return abs;
    }

    // Regex fallbacks on raw HTML (covers JS-templated / escaped strings the
    // DOMParser path may miss because they live inside <script> blocks or
    // escaped JSON-config blobs). All candidates run through decodeHtmlEntities
    // so &amp; -> & before new URL().
    const regexCandidates = [
      // data-pdf-url attribute pointing to LWW downloadpdf.aspx (most precise).
      /data-pdf-url\s*=\s*["']([^"']*downloadpdf\.aspx[^"']*)["']/i,
      // Full LWW downloadpdf.aspx URL anywhere in the HTML (e.g. JSON config blobs).
      /["'](https?:\/\/journals\.lww\.com\/[^"']+\/_layouts\/15\/oaks\.journals\/downloadpdf\.aspx[^"']*)["']/i,
      // Legacy CDN patterns.
      /https?:\/\/download\.lww\.com\/[^"'\s<>]+\.pdf/i,
      /https?:\/\/cdn-links\.lww\.com\/[^"'\s<>]+\.pdf/i,
      /["']([^"']+wolterskluwer_vitalstream_com[^"']+\.pdf)["']/i,
      /EJ\.Tools\.downloadPDF\s*\(\s*["']([^"']+)["']/i,
    ];
    for (const re of regexCandidates) {
      const m = html.match(re);
      if (!m) continue;
      const raw = m[1] || m[0];
      const url = decodeHtmlEntities(raw);
      const abs = new URL(url, cleanUrl).href;
      console.log('[LWW resolver] regex candidate hit', re, '→', abs);
      return abs;
    }

    console.warn('[LWW resolver] no candidate matched for', cleanUrl,
      '— first 500 chars of HTML:', html.substring(0, 500));
    return null;
  } catch (e) {
    console.error('[LWW resolver] error', e, cleanUrl);
    return null;
  }
}

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify' }, id => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      // Mime sanity check: warn (don't block) when server returns text/html
      // instead of a PDF — typical of paywall/interstitial responses. Helps
      // surface the LWW best-guess fallback failure mode in console.
      const onChanged = (delta) => {
        if (delta.id !== id) return;
        if (delta.state && delta.state.current === 'complete') {
          chrome.downloads.search({ id }, items => {
            const it = items && items[0];
            if (it && it.mime
                && it.mime !== 'application/pdf'
                && it.mime !== 'binary/octet-stream'
                && it.mime !== 'application/octet-stream') {
              console.warn('[downloadFile] non-PDF mime', it.mime,
                'url=', it.url, 'filename=', it.filename,
                '(check [LWW resolver] log above for resolver state)');
            }
          });
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve(id);
        } else if (delta.state && delta.state.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(onChanged);
          reject(new Error('download interrupted: ' + ((delta.error && delta.error.current) || 'unknown')));
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
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
document.addEventListener('DOMContentLoaded', async () => {
  // Dashboard renders from storage immediately, regardless of current tab.
  await refreshDashboard();

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getArticles' }, async response => {
      if (chrome.runtime.lastError || !response) {
        document.getElementById('list').innerHTML = '<div class="empty">Cannot read page. Reload and try again.</div>';
        return;
      }
      articles = response.articles || [];
      pageMode = response.mode || 'generic';
      renderList();
      // Bump lastIssue if we landed on a TOC page; refresh dashboard if so.
      const updated = await recordLastIssueFromTab();
      if (updated) await refreshDashboard();
    });
  });

  document.getElementById('btnDownload').addEventListener('click', async () => {
    await startDownload();
    const updated = await recordLastIssueFromTab();
    if (updated) await refreshDashboard();
  });
  document.getElementById('btnFetchAbs').addEventListener('click', async () => {
    await fetchAndSaveMd();
    const updated = await recordLastIssueFromTab();
    if (updated) await refreshDashboard();
  });
  document.getElementById('btnSaveMd').addEventListener('click', saveToMarkdown);  // kept for backward compat (hidden)
  document.getElementById('selectAll').addEventListener('change', e => {
    document.querySelectorAll('.articleCb').forEach(cb => { cb.checked = e.target.checked; });
    updateDownloadButtonState();
  });

  // Add-journal modal wiring
  document.getElementById('btnAddJournal').addEventListener('click', openAddModal);
  document.getElementById('btnModalCancel').addEventListener('click', closeAddModal);
  document.getElementById('btnModalSave').addEventListener('click', saveAddModal);
  document.getElementById('addModal').addEventListener('click', e => {
    if (e.target.id === 'addModal') closeAddModal();
  });
});
