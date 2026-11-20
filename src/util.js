'use strict';
/* Util kecil bersama: env loader, JSON store, format. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnv(file = path.join(ROOT, '.env')) {
  try {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch (e) { console.error('loadEnv:', e.message); }
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ts(d = new Date()) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '-';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtDur(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { ROOT, loadEnv, ensureDir, readJson, writeJson, ts, fmtBytes, fmtDur, sleep, esc };
