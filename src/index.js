'use strict';
/* YowisBen Bot Controller — entry point (parent).
 * Express (web admin + API) selalu hidup; proses bot Telegram dijalankan
 * sebagai child process sehingga start / restart / stop bisa dikendalikan
 * realtime dari web tanpa mematikan web admin. */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { loadEnv, readJson, writeJson, ensureDir, ts } = require('./util');
const gemini = require('./ai/gemini');
const templates = require('./ai/templates');
const pluginLoader = require('./bot/pluginLoader');

loadEnv();

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const VERIFIED_FILE = path.join(DATA_DIR, 'verified.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const PLUGIN_STATE_FILE = path.join(DATA_DIR, 'plugin_state.json');
ensureDir(DATA_DIR);
ensureDir(pluginLoader.PLUGINS_DIR);

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'yowisben').trim();
const SESSION_TOKEN = crypto.createHmac('sha256', ADMIN_PASSWORD).update('yowisben-admin-v1').digest('hex');
const AUTOSTART = process.env.BOT_AUTOSTART !== 'false';
const MOCK = process.env.MOCK_BOT === '1';

/* ---------------- ring buffer log + SSE ---------------- */
const logs = [];
let logSeq = 0;
const sseClients = new Set();
const MAX_LOGS = 800;

function addLog(level, msg) {
  const entry = { seq: ++logSeq, t: ts(), level, msg: String(msg) };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { /* klien putus */ }
  }
}

/* ---------------- statistik ---------------- */
const stats = readJson(STATS_FILE, { apkDeploys: 0, webDeploys: 0, videoDownloads: 0, audioDownloads: 0, verifications: 0, aiFeatures: 0 });
const saveStats = () => writeJson(STATS_FILE, stats);

/* ---------------- process manager bot ---------------- */
const WORKER_PATH = path.join(__dirname, 'bot', 'worker.js');
const botState = {
  child: null,
  state: 'stopped', // stopped | starting | running | stopping
  pid: null,
  startedAt: null,
  crashes: 0,
  manualStop: false,
  botUsername: null,
  lastError: null, // alasan terakhir proses bot mati (ditampilkan di dashboard)
};

function startBot() {
  if (botState.child) return;
  botState.manualStop = false;
  botState.state = 'starting';
  addLog('system', 'Menjalankan proses bot…');
  const child = spawn(process.execPath, [WORKER_PATH], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: process.env });
  botState.child = child;
  botState.pid = child.pid;
  child.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => addLog('info', `[pid] ${l}`)));
  child.stderr.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => addLog('warn', `[pid] ${l}`)));
  child.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'log') {
      if (m.level === 'error') botState.lastError = m.msg;
      addLog(m.level || 'info', m.msg);
    }
    else if (m.type === 'stat') { stats[m.key] = (stats[m.key] || 0) + (m.n || 1); saveStats(); }
    else if (m.type === 'ready') {
      botState.state = 'running';
      botState.startedAt = Date.now();
      botState.crashes = 0;
      botState.lastError = null;
      botState.botUsername = m.username || botState.botUsername;
      addLog('system', `Bot online${m.username ? ` sebagai @${m.username}` : ''}.`);
    }
  });
  child.on('exit', (code, sig) => {
    botState.child = null;
    botState.pid = null;
    const wasRunning = botState.state === 'running';
    botState.state = 'stopped';
    botState.startedAt = null;
    addLog(wasRunning ? 'warn' : 'error', `Proses bot berhenti (code=${code === null ? '-' : code}${sig ? `, sig=${sig}` : ''}).`);
    // Error konfigurasi (mis. BOT_TOKEN kosong) tidak perlu di-restart otomatis —
    // restart berulang tidak akan menyembuhkan, biar admin yang memperbaiki.
    const configError = botState.lastError && /BOT_TOKEN|ADMIN_ID/i.test(botState.lastError);
    if (!botState.manualStop && AUTOSTART && !configError && botState.crashes < 5) {
      botState.crashes++;
      addLog('system', `Auto-restart dalam 3 detik (percobaan ${botState.crashes}/5).`);
      setTimeout(() => { if (!botState.child && !botState.manualStop) startBot(); }, 3000);
    }
  });
}

function stopBot() {
  botState.manualStop = true;
  if (!botState.child) { botState.state = 'stopped'; return; }
  botState.state = 'stopping';
  addLog('system', 'Menghentikan proses bot…');
  const c = botState.child;
  const killer = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* sudah mati */ } }, 8000);
  c.once('exit', () => clearTimeout(killer));
  try { c.kill('SIGTERM'); } catch { /* diam */ }
}

function restartBot() {
  addLog('system', 'Restart bot diminta admin.');
  if (!botState.child) { startBot(); return; }
  stopBot();
  const iv = setInterval(() => {
    if (!botState.child) { clearInterval(iv); botState.manualStop = false; startBot(); }
  }, 300);
  setTimeout(() => clearInterval(iv), 15000);
}

/* ---------------- util plugin (parent) ---------------- */
const RESERVED_SLUGS = new Set(['start', 'help', 'cancel', 'deployapk', 'deployweb', 'audio', 'fitur', 'stats']);

function checkSyntax(code) {
  const tmp = path.join(os.tmpdir(), `plug-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(tmp, code.endsWith('\n') ? code : code + '\n');
  const r = spawnSync(process.execPath, ['--check', tmp], { timeout: 15000 });
  fs.rmSync(tmp, { force: true });
  return r.status === 0 ? null : String(r.stderr || 'syntax error').split('\n').slice(0, 4).join('\n');
}

function uniqueSlug(slug) {
  const existing = new Set(pluginLoader.listPlugins().map((p) => p.slug));
  if (!existing.has(slug)) return slug;
  for (let i = 2; i < 99; i++) {
    if (!existing.has(`${slug}_${i}`)) return `${slug}_${i}`;
  }
  throw new Error('Tidak ada slug unik yang tersisa');
}

function reloadBot(reason) {
  if (botState.child && botState.state === 'running') {
    try { botState.child.send({ type: 'reload' }); addLog('system', `${reason} — plugin di-hot-reload di proses bot.`); return; }
    catch { /* fallback di bawah */ }
  }
  addLog('system', `${reason} — akan aktif otomatis saat bot berikutnya start.`);
}

/* ---------------- auth ---------------- */
const loginAttempts = new Map(); // ip -> { count, ts }
function rateLimited(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, ts: now };
  if (now - rec.ts > 60000) { rec.count = 0; rec.ts = now; }
  rec.count++;
  loginAttempts.set(ip, rec);
  return rec.count > 8;
}

function requireAuth(req, res, next) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)yb_session=([^;]+)/);
  if (m && m[1] === SESSION_TOKEN) return next();
  res.status(401).json({ error: 'Tidak punya akses. Login dulu.' });
}

/* ---------------- express ---------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: 0 }));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/health', (req, res) => res.json({ ok: true, bot: botState.state, mock: MOCK }));

app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress || 'x';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Tunggu sebentar.' });
  if (String((req.body || {}).password || '') === ADMIN_PASSWORD) {
    res.setHeader('Set-Cookie', `yb_session=${SESSION_TOKEN}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
    addLog('system', 'Admin masuk ke web controller.');
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Password salah.' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'yb_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    bot: {
      state: botState.state,
      pid: botState.pid,
      uptimeSec: botState.startedAt ? Math.floor((Date.now() - botState.startedAt) / 1000) : 0,
      username: botState.botUsername,
      autostart: AUTOSTART,
      lastError: botState.lastError,
    },
    mock: MOCK,
    stats,
    users: Object.keys(readJson(VERIFIED_FILE, {})).length,
    plugins: pluginLoader.listPlugins().length,
    ai: { gemini: gemini.available() },
  });
});

app.post('/api/bot/:action', requireAuth, (req, res) => {
  const { action } = req.params;
  if (action === 'start') {
    if (botState.child) return res.status(409).json({ error: 'Bot sedang berjalan.' });
    startBot();
    return res.json({ ok: true, msg: 'Perintah start dikirim.' });
  }
  if (action === 'stop') {
    if (!botState.child) return res.status(409).json({ error: 'Bot memang sedang berhenti.' });
    stopBot();
    return res.json({ ok: true, msg: 'Perintah stop dikirim.' });
  }
  if (action === 'restart') {
    restartBot();
    return res.json({ ok: true, msg: 'Perintah restart dikirim.' });
  }
  return res.status(400).json({ error: 'Aksi tidak dikenal.' });
});

app.get('/api/logs', requireAuth, (req, res) => {
  const after = Number(req.query.after) || 0;
  res.json({ logs: logs.filter((l) => l.seq > after) });
});

app.get('/api/logs/export', requireAuth, (req, res) => {
  const body = logs.map((l) => `[${l.t}] ${l.level.toUpperCase()} ${l.msg}`).join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="yowisben-log.txt"');
  res.send(body || 'log kosong');
});

app.get('/api/logs/stream', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* diam */ } }, 15000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

app.get('/api/plugins', requireAuth, (req, res) => {
  const state = readJson(PLUGIN_STATE_FILE, {});
  const plugins = pluginLoader.listPlugins().map((p) => ({ ...p, enabled: state[p.slug] !== false }));
  res.json({ plugins });
});

app.post('/api/plugins/preview', requireAuth, async (req, res) => {
  const desc = String((req.body || {}).description || '').trim();
  if (desc.length < 5) return res.status(400).json({ error: 'Deskripsikan fiturnya dengan lebih jelas (min. 5 karakter).' });
  addLog('system', `Admin membuat fitur baru via AI: "${desc.slice(0, 80)}"`);
  let engine = 'gemini';
  let aiError = null;
  let plugin;
  try {
    plugin = await gemini.generateFeature(desc);
  } catch (e) {
    aiError = e.message;
    engine = 'template';
    plugin = templates.generateFeature(desc);
    plugin.slug = uniqueSlug(plugin.slug);
  }
  const syntaxErr = checkSyntax(plugin.code);
  if (syntaxErr) return res.status(422).json({ error: `Kode hasil AI tidak valid: ${syntaxErr}`, engine });
  res.json({ plugin, engine, aiError: gemini.available() ? aiError : 'GEMINI_API_KEY tidak terpasang — memakai engine template offline.' });
});

app.post('/api/plugins', requireAuth, (req, res) => {
  const { name, slug, description, usage, code } = req.body || {};
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(String(slug || ''))) return res.status(400).json({ error: 'Slug tidak valid.' });
  if (RESERVED_SLUGS.has(slug)) return res.status(400).json({ error: 'Slug bentrok dengan perintah bawaan bot.' });
  const syntaxErr = checkSyntax(String(code || ''));
  if (syntaxErr) return res.status(422).json({ error: `Kode tidak valid: ${syntaxErr}` });
  const d = new Date().toISOString().slice(0, 10);
  const header =
    `// @name ${name || slug}\n// @slug ${slug}\n// @description ${String(description || '').replace(/\n/g, ' ')}\n` +
    `// @usage ${usage || '/' + slug}\n// @engine ai\n// @created ${d}\n`;
  pluginLoader.savePlugin({ slug, code: header + code });
  stats.aiFeatures = (stats.aiFeatures || 0) + 1;
  saveStats();
  addLog('system', `Plugin baru diaktifkan: ${slug} (${name || slug}).`);
  reloadBot('Plugin baru ditambahkan');
  res.json({ ok: true, slug });
});

app.post('/api/plugins/:slug/toggle', requireAuth, (req, res) => {
  const { slug } = req.params;
  try {
    const state = readJson(PLUGIN_STATE_FILE, {});
    state[slug] = state[slug] === false ? true : false;
    writeJson(PLUGIN_STATE_FILE, state);
    addLog('system', `Plugin ${slug} ${state[slug] ? 'diaktifkan' : 'dinonaktifkan'}.`);
    reloadBot('Status plugin berubah');
    res.json({ ok: true, enabled: state[slug] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/plugins/:slug', requireAuth, (req, res) => {
  const { slug } = req.params;
  try {
    const p = pluginLoader.pluginPath(slug);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Plugin tidak ditemukan.' });
    pluginLoader.removePlugin(slug);
    addLog('system', `Plugin ${slug} dihapus.`);
    reloadBot('Plugin dihapus');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/users', requireAuth, (req, res) => {
  const v = readJson(VERIFIED_FILE, {});
  const users = Object.entries(v)
    .map(([id, u]) => ({ id, name: (u && u.name) || '-', verifiedAt: u && u.verifiedAt }))
    .sort((a, b) => String(b.verifiedAt || '').localeCompare(String(a.verifiedAt || '')));
  res.json({ users });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

/* eslint-disable-next-line no-unused-vars */
app.use((err, req, res, next) => {
  addLog('error', `Server: ${err.message}`);
  res.status(500).json({ error: 'Kesalahan internal server.' });
});

app.listen(PORT, '0.0.0.0', () => {
  addLog('system', `Web controller siap di port ${PORT} (password admin: ${ADMIN_PASSWORD ? 'terpasang' : 'default "yowisben"'}, Gemini: ${gemini.available() ? 'aktif' : 'tidak ada key — generator fitur memakai engine template'}).`);
  console.log(`YowisBen Controller berjalan di :${PORT} (bot: ${botState.state})`);
});

/* ---------------- boot ---------------- */
if (AUTOSTART) setTimeout(startBot, 800);

process.on('SIGTERM', () => {
  addLog('system', 'SIGTERM — mematikan service (Railway restart/stop).');
  if (botState.child) { try { botState.child.kill('SIGTERM'); } catch { /* diam */ } }
  process.exit(0);
});
process.on('uncaughtException', (e) => addLog('error', `uncaughtException: ${e.message}`));
