'use strict';
/* Wrapper yt-dlp: probe info + unduh video/audio dengan batas ukuran
 * (Bot API Telegram: unduh 20 MB, unggah 50 MB — kita jaga di bawah 45 MB). */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_FILESIZE = '48M';

function bin() { return process.env.YTDLP_PATH || 'yt-dlp'; }

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(bin(), args, { cwd: os.tmpdir() });
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e.message) });
    }
    let out = '', err = '';
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* sudah mati */ } }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (out.length > 100000) out = out.slice(-50000); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 100000) err = err.slice(-50000); });
    p.on('close', (code, sig) => { clearTimeout(t); resolve({ code, sig, out, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message) }); });
  });
}

function cleanErr(e) {
  const lines = String(e || '').split('\n').filter((l) => l.trim() && !l.startsWith('['));
  const line = lines.pop() || String(e || '').split('\n').filter(Boolean).pop() || '';
  return line.replace(/^ERROR:\s*/, '').slice(0, 300);
}

/* Ambil metadata video (judul, durasi, sumber). */
async function probe(url) {
  const r = await run(['-J', '--no-playlist', '--no-warnings', '--skip-download', url], 45000);
  if (r.code !== 0) throw new Error(cleanErr(r.err) || 'Gagal membaca info video dari tautan tersebut.');
  let j;
  try { j = JSON.parse(r.out); } catch { throw new Error('Info video tidak terbaca.'); }
  return {
    title: String(j.title || 'video').slice(0, 120),
    duration: Number(j.duration) || 0,
    extractor: String(j.extractor || '').split(':')[0],
    uploader: String(j.uploader || j.channel || '').slice(0, 60),
  };
}

/* Unduh ke folder sementara, kembalikan path file hasil. */
async function download(url, { audio = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  const outTpl = path.join(dir, '%(title).80s.%(ext)s');
  const args = [
    '--no-playlist', '--no-warnings', '--no-progress', '--restrict-filenames',
    '--max-filesize', MAX_FILESIZE,
    '-o', outTpl,
  ];
  if (audio) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5');
  } else {
    args.push('-f', `bv*[filesize<${MAX_FILESIZE}]+ba/b[filesize<${MAX_FILESIZE}]/b[filesize<${MAX_FILESIZE}]`,
      '--merge-output-format', 'mp4');
  }
  args.push('--print', 'after_move:filepath', url);
  const r = await run(args, 5 * 60 * 1000);
  let file = r.out.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('[')).pop();
  if (!file || !fs.existsSync(file)) {
    const files = fs.readdirSync(dir).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).size > 0);
    if (files.length) file = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  }
  if (!file || !fs.existsSync(file)) {
    fs.rmSync(dir, { recursive: true, force: true });
    const tooBig = /larger than max-filesize|maximum file size/i.test(r.err);
    if (tooBig) throw new Error('Videonya lebih besar dari batas kirim Telegram (sekitar 45 MB). Coba tautan versi ringkas atau klip lain.');
    if (/Private video|login|cookies|Sign in/i.test(r.err)) throw new Error('Konten ini butuh login/private — bot tidak bisa mengunduhnya. Coba tautan publik.');
    throw new Error(cleanErr(r.err) || 'Gagal mengunduh. Pastikan tautan publik dan didukung yt-dlp (TikTok, Instagram, YouTube, Facebook, X, dll).');
  }
  return { file, dir, isAudio: audio };
}

module.exports = { probe, download, bin };
