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
  jasn:         { label: 'JASN',          cadence: 'monthly',  dom: 1, color: '#1f3864', homepage: 'https://journals.lww.com/jasn/pages/currenttoc.aspx' },
  cjasn:        { label: 'CJASN',         cadence: 'monthly',  dom: 1, color: '#1f3864', homepage: 'https://journals.lww.com/cjasn/pages/currenttoc.aspx' },
};

const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 };

// Journal keys that were once seeded in JOURNAL_DEFAULTS but have been removed.
// (v3.19 dropped jasn/cjasn; v3.20 restored both via the text+image extraction
// path. This array stays empty unless another journal is later retired.)
const REMOVED_JOURNAL_KEYS = [];

function loadJournals() {
  return new Promise(resolve => {
    chrome.storage.local.get('journals', data => {
      let journals;
      if (data.journals && Object.keys(data.journals).length > 0) {
        // Merge defaults: any new built-in journal that storage doesn't have yet, add it.
        journals = { ...JSON.parse(JSON.stringify(JOURNAL_DEFAULTS)), ...data.journals };
      } else {
        journals = JSON.parse(JSON.stringify(JOURNAL_DEFAULTS));
      }
      // Prune removed journal keys.
      let pruned = false;
      for (const k of REMOVED_JOURNAL_KEYS) {
        if (k in journals) { delete journals[k]; pruned = true; }
      }
      if (pruned) {
        chrome.storage.local.set({ journals }, () => resolve(journals));
      } else {
        resolve(journals);
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
  if (['nejm', 'nature', 'science', 'lancet', 'bmj', 'aim', 'jama'].includes(base)) return base;
  // LWW (Wolters Kluwer) is multi-journal; derive slug from URL path.
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
// Escape `[`/`]` inside markdown link text. JAMA parser prepends `[Section]` to
// titles; without escaping the `### N. [Title](url)` link form would break.
function escMdLinkText(s) {
  return String(s).replace(/[\[\]]/g, '\\$&');
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
    // be able to manually tick a non-default entry (e.g. an Editorial in JAMA)
    // and download it.

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
      // v3.22.0 (Copper 2026-05-06): AIM routed through the same text+image
      // extraction path as LWW (Atypon body HTML loads in subscriber session
      // even when PDF is gated). hasPdf=true for ALL articles regardless of OA;
      // user can still uncheck individually. FREE badge is surfaced from the
      // OA marker scan in parseAIM_TOC.
      badges = a.isOA
        ? '<span class="badge oa">Free text+img</span>'
        : '<span class="badge oa">Sub. text+img</span>';
      if (a.typeName) badges += ` <span class="badge type">${escHtml(a.typeName)}</span>`;
    } else if (base === 'jama') {
      // JAMA has explicit .badge.icon-free OA flag — STRICT gate per Copper 2026-04-22
      // (non-OA articles' PDFs are server-gated via /Content/CheckPdfAccess, generic
      // grabbing produces paywall HTML). hasPdf=isOA + checkbox disabled for non-OA.
      badges = a.isOA ? '<span class="badge oa">Free</span>' : '<span class="badge closed">Metadata</span>';
      if (a.typeName) badges += ` <span class="badge type">${escHtml(a.typeName)}</span>`;
    } else if (base === 'lww') {
      // v3.20.0: LWW articles use text+image extraction path (PDF stream gated
      // server-side; v3.13–v3.18 attempts all returned text/html). hasPdf is
      // set in content.js by section blacklist (Clinical Research / Letter to
      // the Editor / About the Cover off; everything else default-on); user
      // can manually override via checkbox.
      badges = a.hasPdf ? '<span class="badge oa">Sub. text+img</span>' : '<span class="badge closed">Excluded (manual OK)</span>';
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
  // so manual override of default-off entries (e.g. a paywalled BMJ News article)
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
      if (article.kind === 'lww-text-image') {
        // v3.20.0: LWW articles — extract body markdown + figure binaries via
        // content-script same-origin fetch. Bundle saved as
        // ~/Downloads/journal-downloader/{citationKey}/raw.md + figures/*.
        await extractAndSaveLWWBundle(article, statusSpan);
      } else {
        await downloadFile(article.pdfUrl, filename);
        statusSpan.innerHTML = ' <span class="done">&#10003;</span>';
      }
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
  // Skip only if abstract already long enough (>400 chars) AND fullUrl missing.
  // EXCEPTION: kind='lww-text-image' articles (LWW JASN/CJASN, AIM since v3.22)
  // ALWAYS fetch — their TOC pre-population is just a short editor blurb that
  // must be replaced with the real on-page structured abstract regardless of
  // its length (Copper 2026-05-06: AIM TOC inline summary is the "副標", not
  // the actual abstract).
  const toFetch = articles
    .map((a, i) => ({ ...a, index: i }))
    .filter(a => a.fullUrl && (
      a.kind === 'lww-text-image' || !(a.abstract && a.abstract.length > 400)
    ));

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
      // Branch on kind:
      // - kind='lww-text-image' (LWW, AIM) → use extractLWWArticle which does a
      //   subscriber-session same-origin fetch and parses via the Atypon/LWW
      //   selector union. Crossref is BYPASSED here because for AIM Living
      //   Rapid Review articles the Crossref-deposited "abstract" is just the
      //   short editor blurb that AIM also shows on the TOC, so the
      //   `crossref || page` precedence in fetchArticleAbstract makes it win
      //   over the real on-page structured abstract. Going through
      //   extractLWWArticle reads the page DOM directly (`.hlFld-Abstract`,
      //   `section[role="doc-abstract"]`, etc.) so the click-through abstract
      //   replaces the TOC summary as Copper expects.
      // - everything else → existing fetchOneAbstract (Crossref-first hybrid).
      if (article.kind === 'lww-text-image') {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'extractLWWArticle', url: article.fullUrl },
          response => {
            if (!chrome.runtime.lastError && response && response.ok) {
              if (response.abstract && response.abstract.length > 50) {
                articles[article.index].abstract = response.abstract;
                fetched.n++;
              } else {
                console.warn('[fetchAndSaveMd] empty abstract from extractLWWArticle',
                  article.fullUrl, 'kept TOC summary');
              }
            } else {
              console.warn('[fetchAndSaveMd] extractLWWArticle failed',
                article.fullUrl, chrome.runtime.lastError, response);
            }
            completed++;
            updateUi();
            resolve();
          }
        );
      } else {
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
      }
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

    // Title — clickable link to the click-through fulltext URL when present,
    // so a JC draft that quotes the title inherits the hyperlink natively.
    // Angle-bracket destination form `(<url>)` keeps Lancet PII URLs (which
    // contain `(YY)` substrings) safe under non-CommonMark-strict renderers.
    const titleLine = a.fullUrl
      ? `### ${i + 1}. [${escMdLinkText(a.title)}](<${a.fullUrl}>)`
      : `### ${i + 1}. ${a.title}`;
    md += `${titleLine}\n\n`;

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

    // Abstract (if present) — followed by an explicit "→ 原文" trail link so
    // when the abstract paragraph is quoted into a JC draft, the source URL
    // travels with it. Angle-bracket destination form is safe with Lancet-style
    // URLs that contain parentheses.
    if (a.abstract) {
      md += `> ${a.abstract}\n\n`;
      if (a.fullUrl) md += `[→ 原文](<${a.fullUrl}>)\n\n`;
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

// ── Text+image extraction bundle (v3.20 LWW, v3.22 AIM) ──
// Function name is historical: it now handles every journal whose article body
// HTML is reachable in subscriber sessions but whose PDF stream is server-gated
// (LWW JASN/CJASN since v3.20, AIM Atypon since v3.22). Mechanism: content-
// script same-origin fetch of fulltext URL → parse body to markdown → download
// each figure binary as a separate file. Bundle output is
// ~/Downloads/journal-downloader/{citationKey}/{raw.md + figures/*} which the
// user moves into the inbox where the wikify pipeline picks it up. Routing key
// remains `kind === 'lww-text-image'` for backward compatibility.

async function extractAndSaveLWWBundle(article, statusSpan) {
  // Step 1: ask content-script (running on the active LWW tab, same-origin) to
  // fetch + parse the fulltext page.
  const result = await new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return resolve({ ok: false, error: 'no active tab' });
      chrome.tabs.sendMessage(tabs[0].id, { action: 'extractLWWArticle', url: article.fullUrl }, response => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { ok: false, error: 'no response' });
        }
      });
    });
  });
  if (!result.ok) {
    console.error('[LWW extract] failed', article.fullUrl, result.error || `status=${result.status}`);
    statusSpan.innerHTML = ' <span class="fail">&#10007;</span>';
    return;
  }
  console.log('[LWW extract] got bundle', article.fullUrl, `body=${(result.bodyMd || '').length}c`, `images=${result.images.length}`);

  // citationKey = {Journal}_{accession_short}_{slug}.
  const journalKey = (article.journal || 'LWW').toUpperCase();
  const accShort = article.accession ? article.accession.replace(/[^0-9]/g, '').slice(-12) : article.articleId;
  const slug = sanitize((result.title || article.title || '').substring(0, 60));
  const citationKey = `${journalKey}_${accShort}_${slug}`.replace(/_+/g, '_').replace(/_$/, '');
  const subdir = `journal-downloader/${citationKey}`;
  const today = new Date().toISOString().slice(0, 10);

  // Build raw.md
  const fmLines = [
    '---',
    'type: raw',
    `citationKey: ${citationKey}`,
    `uid: doi:${result.doi || article.doi || ''}`,
    'source_type: journal_article',
    `journal: ${article.journal || ''}`,
    `title: ${JSON.stringify(result.title || article.title || '')}`,
    `authors: ${JSON.stringify(result.authors || article.author || '')}`,
    `doi: ${result.doi || article.doi || ''}`,
    `accession_number: ${article.accession || ''}`,
    `fulltext_url: ${result.sourceUrl || article.fullUrl}`,
    `section: ${JSON.stringify(article.typeName || '')}`,
    `captured_date: ${today}`,
    `extracted_via: journal-downloader-v${chrome.runtime.getManifest().version}-content-script`,
    'fidelity_notes: |',
    '  HTML body + figure binaries extracted via Chrome ext content-script same-',
    '  origin fetch (subscriber session). Publisher PDF stream is server-gated',
    '  and not feasible from ext; text+image is the substitute path. Image',
    '  vision-description + downstream wikify happens in the standard pipeline.',
    `figure_count: ${result.images.length}`,
    'sidecar: figures/',
    '---',
    '',
    `# ${result.title || article.title || ''}`,
    '',
    result.authors ? `**Authors**: ${result.authors}\n` : '',
    result.doi ? `**DOI**: <https://doi.org/${result.doi}>\n` : '',
    article.typeName ? `**Section**: ${article.typeName}\n` : '',
    '',
    '## Abstract',
    '',
    result.abstract || '(no abstract extracted)',
    '',
    '---',
    '',
    result.bodyMd || '(body extraction empty)',
    '',
    '## Figure URLs (raw)',
    '',
  ];
  result.images.forEach((img, i) => {
    fmLines.push(`- [${i + 1}] ${img.url}${img.caption ? ' — ' + img.caption.substring(0, 200) : ''}`);
  });
  const rawMd = fmLines.join('\n');

  // Save raw.md
  const rawBlob = new Blob([rawMd], { type: 'text/markdown' });
  const rawUrl = URL.createObjectURL(rawBlob);
  try {
    await downloadFile(rawUrl, `${subdir}/raw.md`);
  } finally {
    URL.revokeObjectURL(rawUrl);
  }

  // Save figure binaries (best-effort; individual failures don't abort the bundle).
  let figOk = 0, figFail = 0;
  for (let i = 0; i < result.images.length; i++) {
    const img = result.images[i];
    const extM = img.url.match(/\.(jpe?g|png|gif|webp|svg|tiff?)(\?|#|$)/i);
    const ext = extM ? extM[1].toLowerCase() : 'jpg';
    const capSlug = img.caption ? '_' + sanitize(img.caption.substring(0, 30)) : '';
    const name = String(i + 1).padStart(2, '0') + capSlug + '.' + ext;
    try {
      await downloadFile(img.url, `${subdir}/figures/${name}`);
      figOk++;
    } catch (e) {
      console.warn('[LWW extract] figure download failed', img.url, e);
      figFail++;
    }
  }
  console.log(`[LWW extract] bundle saved: ${subdir}/  (raw.md + ${figOk}/${result.images.length} figures, ${figFail} failed)`);
  statusSpan.innerHTML = ` <span class="done">&#10003;</span> <span style="font-size:10px;color:#888">${figOk}f</span>`;
}

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify' }, id => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      // Mime sanity check: warn (don't block) when server returns text/html
      // instead of a PDF — typical of paywall/interstitial responses.
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
                'url=', it.url, 'filename=', it.filename);
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
