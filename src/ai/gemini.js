'use strict';
/* Klien Gemini REST minimal (teks + vision) dengan timeout & error yang jelas.
 * Semua pemanggilan AI di proyek ini lewat modul ini. */
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash']; // dicoba bergantian kalau model 404
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function apiKey() { return (process.env.GEMINI_API_KEY || '').trim(); }
function available() { return apiKey().length > 10; }

async function callOnce(model, parts, { timeoutMs, maxTokens }) {
  const key = apiKey();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        msg = 'GEMINI_API_KEY tidak valid — buat API key baru di aistudio.google.com/apikey (berawalan AIza), lalu pasang di Railway > Variables dan restart bot.';
      }
      const err = new Error(`Gemini: ${msg}`);
      err.status = res.status;
      // API menyarankan model pengganti saat model lama usang
      const alt = String((data && data.error && data.error.message) || '').match(/use models\/([a-z0-9.\-]+)/i);
      err.altModel = alt ? alt[1] : null;
      throw err;
    }
    const c = data && data.candidates && data.candidates[0];
    const txt = c && c.content && c.content.parts
      ? c.content.parts.map((p) => p.text || '').join('').trim() : '';
    if (!txt) throw new Error('Gemini: respons kosong');
    return txt;
  } finally {
    clearTimeout(t);
  }
}

async function call(parts, { timeoutMs = 45000, maxTokens = 2048 } = {}) {
  if (!apiKey()) throw new Error('GEMINI_API_KEY belum diisi di environment');
  const chain = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];
  let lastErr = null;
  for (const m of chain) {
    try {
      return await callOnce(m, parts, { timeoutMs, maxTokens });
    } catch (e) {
      lastErr = e;
      if (e.altModel) return await callOnce(e.altModel, parts, { timeoutMs, maxTokens });
      // hanya model yang tidak ditemukan (404) yang layak dicoba dengan model lain
      if (e.status !== 404) throw e;
    }
  }
  throw lastErr;
}

function parseJsonLoose(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

/* Analisis screenshot bukti follow saluran WhatsApp. */
async function analyzeFollowScreenshot(imageB64, channelLink) {
  const prompt =
    'Kamu adalah verifier keanggotaan saluran WhatsApp untuk bot Telegram.\n' +
    `Tautan saluran: ${channelLink}\n` +
    'Tugas: periksa screenshot ini dan putuskan apakah terlihat JELAS bahwa pengguna sudah menekan tombol Follow/Bergabung (atau statusnya sudah menjadi follower) di saluran WhatsApp tersebut.\n' +
    'Ciri positif: tombol "Follow"/"Joined"/"Mengikuti" terlihat sudah ditekan, banner/nama saluran WhatsApp terlihat, jumlah follower terlihat.\n' +
    'Ciri negatif: screenshot tidak berhubungan dengan saluran, tombol belum ditekan, gambar burik yang tidak bisa dinilai dianggap negatif.\n' +
    'Balas HANYA JSON tanpa teks lain: {"following": true|false, "confidence": 0-100, "reason": "alasan singkat dalam bahasa Indonesia"}';
  const text = await call(
    [
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: imageB64 } },
    ],
    { maxTokens: 300, timeoutMs: 45000 }
  );
  const j = parseJsonLoose(text);
  return {
    following: !!j.following,
    confidence: Math.max(0, Math.min(100, Number(j.confidence) || 0)),
    reason: String(j.reason || ''),
  };
}

/* Generator fitur baru untuk bot (dipakai web admin). */
async function generateFeature(description) {
  const prompt =
    'Tulis SATU plugin fitur untuk bot Telegram YowisBen (Node.js 18+, CommonJS).\n\n' +
    '== KONTRAK PLUGIN (WAJIB dipatuhi persis) ==\n' +
    'File plugin harus mengekspor objek:\n' +
    'module.exports = {\n' +
    '  name: "Nama Fitur (bahasa Indonesia, menarik)",\n' +
    '  slug: "slug_perintah",   // lowercase_underscore, 3-20 char, unik, menjadi perintah /slug\n' +
    '  description: "Deskripsi singkat 1-2 kalimat",\n' +
    '  usage: "/slug <cara pakai>",\n' +
    '  run: async (ctx) => { ... }\n' +
    '}\n\n' +
    'Objek ctx di dalam run(ctx):\n' +
    '- ctx.from   -> { id, first_name, username }\n' +
    '- ctx.chat   -> { id, type }\n' +
    '- ctx.text   -> teks pesan penuh\n' +
    '- ctx.args   -> array argumen setelah perintah\n' +
    '- ctx.reply(text, extra?)          -> balas teks biasa\n' +
    '- ctx.replyWithHTML(html, extra?)  -> balas HTML (tag: <b> <i> <code> <pre> <a href>)\n' +
    '- ctx.sendTyping()                 -> indikator "sedang mengetik"\n' +
    '- ctx.fetch(url, options?)         -> fetch global Node 18 (untuk API publik gratis)\n' +
    '- ctx.env                          -> process.env\n\n' +
    'ATURAN KERAS:\n' +
    '1. Hindari require; jika benar-benar perlu, hanya modul bawaan node: (contoh require("node:https")).\n' +
    '2. DILARANG pakai fs, eval, child_process, atau menulis file.\n' +
    '3. Semua jalur kode WAJIB diakhiri ctx.reply / ctx.replyWithHTML (jangan balas kosong).\n' +
    '4. Bungkus fetch dalam try/catch dan beri pesan error ramah bahasa Indonesia.\n' +
    '5. Maksimal 3 emoji, gaya santai profesional.\n' +
    '6. Kode berdiri sendiri, langsung jalan, tanpa variabel di luar module.exports.\n\n' +
    '== PERMINTAAN ADMIN ==\n' +
    `"${String(description).replace(/"/g, "'").slice(0, 600)}"\n\n` +
    'Balas HANYA JSON valid tanpa penjelasan lain, format:\n' +
    '{"name":"...","slug":"...","description":"...","usage":"...","code":"..."}\n' +
    'Di dalam "code", baris baru ditulis \\n dan semua quote di-escape dengan benar.';
  const text = await call([{ text: prompt }], { maxTokens: 3000, timeoutMs: 90000 });
  const j = parseJsonLoose(text);
  const slug = String(j.slug || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(slug)) throw new Error('Slug plugin tidak valid: ' + slug);
  if (typeof j.code !== 'string' || j.code.length < 30) throw new Error('Kode plugin kosong');
  if (!j.code.includes('module.exports')) throw new Error('Kode plugin tidak mengekspor module.exports');
  return {
    name: String(j.name || slug).slice(0, 60),
    slug,
    description: String(j.description || '').slice(0, 200),
    usage: String(j.usage || `/${slug}`).slice(0, 100),
    code: j.code,
  };
}

module.exports = { available, analyzeFollowScreenshot, generateFeature, MODEL };
