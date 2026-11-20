'use strict';
/* Klien Netlify API: buat situs + deploy zip (untuk fitur deploy website bot). */
const API = 'https://api.netlify.com/api/v1';

function token() { return (process.env.NETLIFY_TOKEN || '').trim(); }
function available() { return token().length > 10; }

async function req(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* biarkan null */ }
  if (!res.ok) {
    const msg = (data && data.message) || String(text).slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(`Netlify ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function createSite(name) {
  return req('/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

async function deployZip(siteId, zipBuf) {
  const res = await fetch(`${API}/sites/${siteId}/deploys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/zip' },
    body: zipBuf,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Netlify deploy ${res.status}: ${data.message || 'gagal mengunggah zip'}`);
  return data;
}

async function getDeploy(deployId) { return req(`/deploys/${deployId}`); }

async function waitReady(deployId, { timeoutMs = 120000, intervalMs = 3000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = await getDeploy(deployId);
    if (d.state === 'ready') return d;
    if (d.state === 'error') throw new Error('Deploy Netlify error: ' + (d.error_message || 'tidak diketahui'));
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timeout menunggu deploy Netlify siap');
}

module.exports = { available, createSite, deployZip, waitReady, getDeploy };
