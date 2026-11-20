/* ============ YowisBen Controller — logika antarmuka ============ */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  view: 'dashboard',
  status: null,
  logs: [],
  logFilter: 'all',
  sse: null,
  lastSeq: 0,
  uptimeTimer: null,
  statusTimer: null,
};

/* ---------- util ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtUptime(sec) {
  if (!sec || sec < 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}j ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
}
function fmtNum(n) { return String(n == null ? 0 : n); }

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* bukan json */ }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------- toast ---------- */
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const ico = type === 'err'
    ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#f87171" stroke-width="2"/><path d="M12 8v5M12 16.5v.01" stroke="#f87171" stroke-width="2" stroke-linecap="round"/></svg>'
    : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#34d399" stroke-width="2"/><path d="M8.5 12.5l2.4 2.4 4.6-5.3" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  el.innerHTML = `${ico}<span>${esc(msg)}</span>`;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 3800);
}

/* ---------- ripple ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('.btn, .ctrl-btn, .filter-chip');
  if (!b) return;
  const r = b.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.width = s.style.height = `${d}px`;
  s.style.left = `${e.clientX - r.left - d / 2}px`;
  s.style.top = `${e.clientY - r.top - d / 2}px`;
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
  b.appendChild(s);
  setTimeout(() => s.remove(), 600);
});

/* ---------- ikon ---------- */
const ICONS = {
  grid: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
  power: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.2 6.5a8 8 0 1 0 11.6 0"/></svg>',
  spark: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>',
  term: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M7.5 10l3 2.5-3 2.5M12.8 15h3.7"/></svg>',
  users: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.7-3 3-4.5 5.5-4.5S13.8 16 14.5 19"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M16 14.6c2.3.2 4 1.6 4.5 4.4"/></svg>',
  play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 5.5v13l11-6.5z"/></svg>',
  restart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/></svg>',
  stop: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
};

/* ---------- modal ---------- */
function openModal(html) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  $('#modal-root').appendChild(back);
  return back;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

/* ---------- status ---------- */
function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  $('#login-pass').focus();
}
function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
}

async function refreshStatus() {
  try {
    const s = await api('/api/status');
    state.status = s;
    showApp();
    renderStatusPill(s);
    renderDiag(s);
    $('#bot-chip').textContent = '@' + (s.bot.username || 'bot');
    if (state.view === 'dashboard') renderDashboard(s);
    if (state.view === 'kontrol') syncControlButtons(s);
  } catch (e) {
    showLogin();
  }
}

/* Banner diagnosis: muncul saat bot mati dan penyebabnya diketahui. */
function renderDiag(s) {
  const b = $('#diag-banner');
  if (!b) return;
  const show = s.bot.state !== 'running' && s.bot.lastError;
  if (!show) { b.classList.add('hidden'); b.innerHTML = ''; return; }
  b.classList.remove('hidden');
  b.innerHTML =
    '<div class="diag-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 8.5v4.5M12 16.4v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></div>' +
    `<div><b>Bot tidak bisa hidup — ${esc(s.bot.lastError)}</b>` +
    '<span>Buka halaman Log Realtime untuk detail. Setelah variabel diperbaiki (Railway &gt; Variables), klik Start / Restart.</span></div>';
}

function renderStatusPill(s) {
  const st = s.bot.state;
  const pill = $('#status-pill');
  const map = {
    running: ['on', 'Bot berjalan'],
    starting: ['mid', 'Menyalakan…'],
    stopping: ['mid', 'Menghentikan…'],
    stopped: ['off', 'Bot berhenti'],
  };
  const [cls, label] = map[st] || ['off', st];
  pill.className = `status-pill ${cls}`;
  $('#status-text').textContent = label + (s.mock ? ' (mock)' : '');
  clearInterval(state.uptimeTimer);
  const base = s.bot.uptimeSec;
  const t0 = Date.now();
  state.uptimeTimer = setInterval(() => {
    $('#uptime').textContent = st === 'running' ? `uptime ${fmtUptime(Math.floor(base + (Date.now() - t0) / 1000))}` : 'uptime —';
  }, 1000);
  $('#uptime').textContent = st === 'running' ? `uptime ${fmtUptime(base)}` : 'uptime —';
}

/* ---------- router ---------- */
const views = { dashboard: renderDashboard, kontrol, fitur, log: logView, pengguna };
function router() {
  const v = (location.hash.replace('#/', '') || 'dashboard');
  state.view = views[v] ? v : 'dashboard';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === state.view));
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('show');
  views[state.view]();
}

/* ---------- view: dashboard ---------- */
function ringSvg(pct) {
  const r = 52, c = 2 * Math.PI * r;
  const off = c * (1 - (pct || 0));
  return `
  <svg width="118" height="118" viewBox="0 0 118 118">
    <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
    <circle class="ring-bg" cx="59" cy="59" r="${r}" stroke-width="9" fill="none"/>
    <circle class="ring-fg" cx="59" cy="59" r="${r}" stroke-width="9" fill="none" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
  </svg>`;
}

function renderDashboard(s) {
  const st = s.bot.state;
  const running = st === 'running';
  const total = (s.stats.videoDownloads || 0) + (s.stats.audioDownloads || 0);
  $('#content').innerHTML = `
  <div class="page-title">Dashboard</div>
  <div class="page-sub">Ringkasan kondisi bot & aktivitas terbaru ${s.mock ? '— <b>mode mock</b>, angka contoh' : ''}.</div>
  <div class="grid-2 stagger">
    <div class="card hero">
      <div>
        <div class="stat-lbl">Status Proses Bot</div>
        <div class="stat-num" style="margin-top:8px">${running ? 'Online' : st === 'stopped' ? 'Berhenti' : 'Transisi'}</div>
        <div class="kv" style="margin-top:12px"><span>Akun bot</span><span>${esc('@' + (s.bot.username || '-'))}</span></div>
        <div class="kv"><span>Uptime</span><span id="dash-uptime">${fmtUptime(s.bot.uptimeSec)}</span></div>
        <div class="kv"><span>Auto-restart</span><span>${s.bot.autostart ? 'Aktif' : 'Mati'}</span></div>
        <div class="kv"><span>Engine AI</span><span>${s.ai.gemini ? 'Gemini' : 'Template offline'}</span></div>
      </div>
      <div class="ring-wrap">${ringSvg(running ? 1 : 0)}<div class="ring-center"><div><b>${running ? 'LIVE' : 'OFF'}</b><br><span>proses</span></div></div></div>
    </div>
    <div class="card">
      <div class="stat-lbl">Statistik Pemakaian</div>
      <div class="grid-2" style="margin-top:14px">
        <div><div class="stat-num" data-count="${s.users}">0</div><div class="stat-lbl">User Terverifikasi</div></div>
        <div><div class="stat-num" data-count="${s.stats.verifications || 0}">0</div><div class="stat-lbl">Verifikasi AI</div></div>
        <div><div class="stat-num" data-count="${s.stats.apkDeploys || 0}">0</div><div class="stat-lbl">APK Dibuild</div></div>
        <div><div class="stat-num" data-count="${s.stats.webDeploys || 0}">0</div><div class="stat-lbl">Website Deploy</div></div>
        <div><div class="stat-num" data-count="${total}">0</div><div class="stat-lbl">Unduhan Media</div></div>
        <div><div class="stat-num" data-count="${s.plugins}">0</div><div class="stat-lbl">Plugin Aktif</div></div>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="stat-lbl">Aksi Cepat</div>
    <div class="suggest" style="margin-top:12px">
      <a class="btn btn-sm" href="#/kontrol">${ICONS.power}&nbsp;Kendalikan bot</a>
      <a class="btn btn-sm" href="#/fitur">${ICONS.spark}&nbsp;Buat fitur baru</a>
      <a class="btn btn-sm" href="#/log">${ICONS.term}&nbsp;Lihat log</a>
      <a class="btn btn-sm" href="#/pengguna">${ICONS.users}&nbsp;Daftar pengguna</a>
    </div>
    <p style="color:var(--muted);font-size:13px;line-height:1.7;margin-top:14px">
      Alur bot: user <b>/start</b> → follow saluran WhatsApp → kirim screenshot → AI memverifikasi → semua fitur terbuka
      (deploy APK Flutter, deploy website, download video, plugin buatan AI).
    </p>
  </div>`;
  countUp();
  clearInterval(dashTick);
  const uBase = s.bot.uptimeSec;
  const uT0 = Date.now();
  dashTick = setInterval(() => {
    const el = $('#dash-uptime');
    if (el && s.bot.state === 'running') el.textContent = fmtUptime(Math.floor(uBase + (Date.now() - uT0) / 1000));
  }, 1000);
}
let dashTick = null;

function countUp() {
  $$('#content [data-count]').forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const dur = 900;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtNum(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ---------- view: kontrol ---------- */
function kontrol() {
  $('#content').innerHTML = `
  <div class="page-title">Kontrol Bot</div>
  <div class="page-sub">Nyalakan, mulai ulang, atau hentikan proses bot Telegram. Perubahan berlaku langsung.</div>
  <div class="ctrl-row stagger">
    <button class="ctrl-btn start" id="btn-start">
      <span class="ico" style="color:#7ce9bd">${ICONS.play}</span> Start<small>Hidupkan proses bot</small>
    </button>
    <button class="ctrl-btn restart" id="btn-restart">
      <span class="ico" style="color:#ffd977">${ICONS.restart}</span> Restart<small>Mulai ulang bersih</small>
    </button>
    <button class="ctrl-btn stop" id="btn-stop">
      <span class="ico" style="color:#ff9d9d">${ICONS.stop}</span> Stop<small>Hentikan proses bot</small>
    </button>
  </div>
  <div class="card" style="margin-top:18px" id="ctrl-info">
    <div class="stat-lbl">Kondisi Saat Ini</div>
    <div id="ctrl-kv" style="margin-top:8px"></div>
  </div>`;

  $('#btn-start').addEventListener('click', () => botAction('start'));
  $('#btn-restart').addEventListener('click', () => confirmModal('Restart Bot', 'Proses bot akan dihentikan lalu dinyalakan ulang. Pesan yang sedang diproses bisa terpotong sebentar. Lanjut?', () => botAction('restart')));
  $('#btn-stop').addEventListener('click', () => confirmModal('Stop Bot', 'Semua fitur bot berhenti merespon sampai kamu menyalakannya lagi. Yakin mau berhenti?', () => botAction('stop')));
  if (state.status) syncControlButtons(state.status);
}

function syncControlButtons(s) {
  const running = ['running', 'starting', 'stopping'].includes(s.bot.state);
  const kv = $('#ctrl-kv');
  if (kv) {
    kv.innerHTML = `
      <div class="kv"><span>Status proses</span><span>${esc(s.bot.state)}</span></div>
      <div class="kv"><span>PID</span><span>${s.bot.pid || '-'}</span></div>
      <div class="kv"><span>Uptime</span><span>${s.bot.state === 'running' ? fmtUptime(s.bot.uptimeSec) : '—'}</span></div>
      <div class="kv"><span>Akun bot</span><span>@${esc(s.bot.username || '-')}</span></div>`;
  }
}

function confirmModal(title, text, onYes) {
  const back = openModal(`
    <h2>${esc(title)}</h2>
    <p class="sub">${esc(text)}</p>
    <div class="modal-actions">
      <button class="btn btn-primary" id="cf-yes">Ya, lanjut</button>
      <button class="btn btn-ghost" id="cf-no">Batal</button>
    </div>`);
  $('#cf-yes', back).addEventListener('click', () => { closeModal(); onYes(); });
  $('#cf-no', back).addEventListener('click', closeModal);
}

async function botAction(action) {
  const btn = $(`#btn-${action}`);
  if (btn) { btn.disabled = true; const ico = $('.ico svg', btn); if (ico) ico.classList.add('spin'); }
  try {
    const r = await api(`/api/bot/${action}`, { method: 'POST' });
    toast(r.msg || 'Perintah terkirim.');
    setTimeout(refreshStatus, 1200);
    setTimeout(refreshStatus, 3500);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; const ico = $('.ico svg', btn); if (ico) ico.classList.remove('spin'); }
  }
}

/* ---------- view: fitur ---------- */
async function fitur() {
  $('#content').innerHTML = `
  <div class="page-title">Fitur &amp; Plugin</div>
  <div class="page-sub">Semua perintah tambahan bot ada di sini. Buat fitur baru cukup dengan menjelaskannya — AI yang menulis kodenya.</div>
  <div class="card">
    <div style="display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div>
        <b style="font-size:15px">Generator Fitur AI</b>
        <div style="color:var(--muted);font-size:13px;margin-top:4px">Contoh: "fitur cuaca kota" · "konversi rupiah ke dolar" · "kirim fakta random"</div>
      </div>
      <button class="btn btn-primary" id="btn-new-feature">✨ Buat Fitur Baru</button>
    </div>
  </div>
  <div class="plugin-grid stagger" id="plugin-grid" style="margin-top:16px"><div class="shimmer" style="width:100%"><div class="bar" style="width:80%"></div><div class="bar" style="width:60%"></div><div class="bar" style="width:70%"></div></div></div>`;
  $('#btn-new-feature').addEventListener('click', newFeatureModal);
  loadPlugins();
}

async function loadPlugins() {
  const grid = $('#plugin-grid');
  if (!grid) return;
  try {
    const { plugins } = await api('/api/plugins');
    if (!plugins.length) {
      grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;color:var(--muted)">Belum ada plugin. Buat yang pertama lewat generator AI di atas.</div>';
      return;
    }
    grid.innerHTML = plugins.map((p) => `
      <div class="card">
        <div class="plugin-head">
          <h3>${esc(p.name || p.slug)}</h3>
          <span class="chip engine ${p.engine && p.engine !== 'ai' && p.engine !== 'gemini' ? 'tpl' : ''}">${esc(p.engine || 'ai')}</span>
        </div>
        <div class="plugin-desc">${esc(p.description || '-')}</div>
        <div><span class="chip">${esc(p.usage || '/' + p.slug)}</span></div>
        <div class="plugin-foot">
          <label class="switch" title="Aktif / nonaktif">
            <input type="checkbox" data-toggle="${esc(p.slug)}" ${p.enabled ? 'checked' : ''}>
            <span class="track"><span class="thumb"></span></span>
          </label>
          <span style="color:var(--muted);font-size:12px">${p.enabled ? 'Aktif' : 'Nonaktif'}</span>
          <button class="btn btn-danger btn-sm" style="margin-left:auto" data-del="${esc(p.slug)}">Hapus</button>
        </div>
      </div>`).join('');
    $$('[data-toggle]', grid).forEach((el) => el.addEventListener('change', async () => {
      try {
        await api(`/api/plugins/${el.dataset.toggle}/toggle`, { method: 'POST' });
        toast(`Plugin ${el.dataset.toggle} ${el.checked ? 'diaktifkan' : 'dinonaktifkan'}.`);
      } catch (e) { toast(e.message, 'err'); }
    }));
    $$('[data-del]', grid).forEach((el) => el.addEventListener('click', () => confirmModal('Hapus Plugin', `Plugin "${el.dataset.del}" akan dihapus dari bot. Lanjut?`, async () => {
      try {
        await api(`/api/plugins/${el.dataset.del}`, { method: 'DELETE' });
        toast('Plugin dihapus.');
        loadPlugins();
        refreshStatus();
      } catch (e) { toast(e.message, 'err'); }
    })));
  } catch (e) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;color:var(--err)">Gagal memuat plugin: ${esc(e.message)}</div>`;
  }
}

function newFeatureModal() {
  const back = openModal(`
    <h2>✨ Buat Fitur Baru dengan AI</h2>
    <p class="sub">Jelaskan fitur yang kamu mau dengan bahasa bebas. AI menulis plugin, kamu tinggal aktifkan.</p>
    <textarea id="nf-desc" placeholder="Contoh: fitur cuaca, user ketik /cuaca jakarta lalu bot tampilkan cuaca Jakarta hari ini"></textarea>
    <div class="suggest">
      <button data-s="fitur cuaca kota">cuaca kota</button>
      <button data-s="fitur kirim fakta menarik random">fakta random</button>
      <button data-s="fitur konversi mata uang rupiah ke dolar">konversi uang</button>
      <button data-s="fitur font teks aesthetic untuk bio">font bio</button>
    </div>
    <div id="nf-result"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="nf-go">Rancang Fitur</button>
      <button class="btn btn-ghost" id="nf-close">Tutup</button>
    </div>`);
  $('#nf-close', back).addEventListener('click', closeModal);
  $$('[data-s]', back).forEach((b) => b.addEventListener('click', () => { $('#nf-desc', back).value = b.dataset.s; $('#nf-desc', back).focus(); }));
  $('#nf-go', back).addEventListener('click', async () => {
    const btn = $('#nf-go', back);
    const desc = $('#nf-desc', back).value.trim();
    const out = $('#nf-result', back);
    if (desc.length < 5) { out.innerHTML = '<p style="color:var(--err);font-size:13px;margin-top:12px">Jelaskan fiturnya dulu, minimal 5 karakter.</p>'; return; }
    btn.disabled = true;
    out.innerHTML = `
      <div style="margin-top:16px;display:flex;align-items:center;gap:10px">
        <span class="ai-badge gemini">AI sedang menyusun kode…</span>
      </div>
      <div class="shimmer"><div class="bar" style="width:90%"></div><div class="bar" style="width:75%"></div><div class="bar" style="width:85%"></div><div class="bar" style="width:60%"></div></div>`;
    try {
      const r = await api('/api/plugins/preview', { method: 'POST', body: { description: desc } });
      const p = r.plugin;
      out.innerHTML = `
        <div style="margin-top:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="ai-badge ${r.engine === 'gemini' ? 'gemini' : 'tpl'}">${r.engine === 'gemini' ? 'Dibuat Gemini' : 'Engine template offline'}</span>
          <span class="chip">${esc('/' + p.slug)}</span>
        </div>
        ${r.aiError ? `<p style="color:var(--warn);font-size:12px;margin-top:8px">Catatan: ${esc(r.aiError)}</p>` : ''}
        <p style="margin-top:10px"><b>${esc(p.name)}</b> — ${esc(p.description)}</p>
        <div class="code-box" style="margin-top:10px">${esc(p.code)}</div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="nf-activate">Aktifkan di Bot</button>
          <button class="btn btn-ghost" id="nf-redo">Rancang Ulang</button>
        </div>`;
      $('#nf-redo', back).addEventListener('click', () => { out.innerHTML = ''; btn.disabled = false; });
      $('#nf-activate', back).addEventListener('click', async () => {
        try {
          await api('/api/plugins', { method: 'POST', body: p });
          toast(`Fitur "${p.name}" aktif! Perintah /${p.slug} langsung bisa dipakai di bot.`);
          closeModal();
          loadPlugins();
          refreshStatus();
        } catch (e) { toast(e.message, 'err'); }
      });
    } catch (e) {
      out.innerHTML = `<p style="color:var(--err);font-size:13px;margin-top:12px">${esc(e.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- view: log ---------- */
function logView() {
  $('#content').innerHTML = `
  <div class="page-title">Log Realtime</div>
  <div class="page-sub">Aliran aktivitas bot & server, diperbarui langsung tanpa reload.</div>
  <div class="term-toolbar">
    ${['all', 'info', 'warn', 'error', 'system'].map((f) => `<button class="filter-chip ${f === 'all' ? 'active' : ''}" data-f="${f}">${f === 'all' ? 'semua' : f}</button>`).join('')}
    <div class="right">
      <label style="font-size:12.5px;color:var(--muted);display:flex;gap:7px;align-items:center;cursor:pointer"><input type="checkbox" id="autoscroll" checked> auto-scroll</label>
      <a class="btn btn-ghost btn-sm" href="/api/logs/export" download>Unduh .txt</a>
      <button class="btn btn-ghost btn-sm" id="log-clear">Bersihkan</button>
    </div>
  </div>
  <div class="term" id="term"></div>`;

  $$('.filter-chip').forEach((c) => c.addEventListener('click', () => {
    $$('.filter-chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    state.logFilter = c.dataset.f;
    repaintLogs();
  }));
  $('#log-clear').addEventListener('click', () => { state.logs = []; state.lastSeq = 0; repaintLogs(); });

  fetch('/api/logs', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => { state.logs = d.logs; state.lastSeq = d.logs.length ? d.logs[d.logs.length - 1].seq : 0; repaintLogs(); })
    .catch(() => {});
  connectSSE();
}

function repaintLogs() {
  const term = $('#term');
  if (!term) return;
  const list = state.logs.filter((l) => state.logFilter === 'all' || l.level === state.logFilter);
  term.innerHTML = list.map((l) => `<div class="line ${esc(l.level)}"><span class="t">${esc(l.t)}</span><span class="m">${esc(l.msg)}</span></div>`).join('');
  const auto = $('#autoscroll');
  if (auto && auto.checked) term.scrollTop = term.scrollHeight;
}

function appendLog(l) {
  state.logs.push(l);
  if (state.logs.length > 800) state.logs.shift();
  if (state.view !== 'log') return;
  if (state.logFilter !== 'all' && l.level !== state.logFilter) return;
  const term = $('#term');
  if (!term) return;
  term.insertAdjacentHTML('beforeend', `<div class="line ${esc(l.level)}"><span class="t">${esc(l.t)}</span><span class="m">${esc(l.msg)}</span></div>`);
  const auto = $('#autoscroll');
  if (auto && auto.checked) term.scrollTop = term.scrollHeight;
}

function connectSSE() {
  if (state.sse) { state.sse.close(); state.sse = null; }
  try {
    const es = new EventSource('/api/logs/stream');
    es.onmessage = (ev) => { try { appendLog(JSON.parse(ev.data)); } catch { /* abaikan */ } };
    es.onerror = () => { es.close(); state.sse = null; setTimeout(connectSSE, 5000); };
    state.sse = es;
  } catch { /* browser lama */ }
}

/* ---------- view: pengguna ---------- */
async function pengguna() {
  $('#content').innerHTML = `
  <div class="page-title">Pengguna</div>
  <div class="page-sub">Daftar pengguna bot yang sudah lolos verifikasi saluran WhatsApp lewat analisis AI.</div>
  <div class="tbl-wrap card" style="padding:0;overflow:hidden"><table>
    <thead><tr><th>Nama</th><th>Telegram ID</th><th>Terverifikasi</th></tr></thead>
    <tbody id="user-rows"><tr><td colspan="3" style="color:var(--muted)">Memuat…</td></tr></tbody>
  </table></div>`;
  try {
    const { users } = await api('/api/users');
    $('#user-rows').innerHTML = users.length
      ? users.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.id)}</td><td>${esc((u.verifiedAt || '').replace('T', ' ').slice(0, 19))} UTC</td></tr>`).join('')
      : '<tr><td colspan="3" style="color:var(--muted)">Belum ada pengguna terverifikasi.</td></tr>';
  } catch (e) {
    $('#user-rows').innerHTML = `<tr><td colspan="3" style="color:var(--err)">${esc(e.message)}</td></tr>`;
  }
}

/* ---------- boot ---------- */
async function boot() {
  $$('.nav-ico').forEach((el) => { if (ICONS[el.dataset.ico]) el.innerHTML = ICONS[el.dataset.ico]; });
  await refreshStatus();
  if (state.status) {
    router();
    state.statusTimer = setInterval(refreshStatus, 8000);
    window.addEventListener('hashchange', router);
    connectSSE();
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-form .btn');
  const err = $('#login-err');
  btn.disabled = true;
  $('#login-pass').disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: { password: $('#login-pass').value } });
    err.textContent = '';
    await refreshStatus();
    if (state.status) {
      router();
      if (!state.statusTimer) state.statusTimer = setInterval(refreshStatus, 8000);
      if (!window._ybHashBound) { window._ybHashBound = true; window.addEventListener('hashchange', router); }
      if (!state.sse) connectSSE();
    }
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    $('#login-pass').disabled = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* diam */ }
  location.reload();
});

$('#nav-toggle').addEventListener('click', () => {
  $('#sidebar').classList.toggle('open');
  $('#sidebar-overlay').classList.toggle('show');
});
$('#sidebar-overlay').addEventListener('click', () => {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('show');
});

boot();
