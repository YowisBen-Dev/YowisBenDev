'use strict';
/* Worker bot Telegram YowisBen — dijalankan sebagai child process oleh src/index.js.
 * Semua log dikirim ke parent via IPC agar tampil realtime di web admin.
 * Mode MOCK_BOT=1: worker palsu untuk preview/dev (tidak menyambung Telegram). */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { loadEnv, readJson, writeJson, fmtBytes, fmtDur, esc } = require('../util');
const { Telegraf, Markup } = require('telegraf');
const gemini = require('../ai/gemini');
const netlify = require('../services/netlify');
const ytdlp = require('../services/ytdlp');
const pluginLoader = require('./pluginLoader');

loadEnv();

const MOCK = process.env.MOCK_BOT === '1';
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const ADMIN_ID = String(process.env.ADMIN_ID || '').trim();
const WA_LINK = (process.env.WA_CHANNEL_LINK || '').trim() || 'https://whatsapp.com/channel/0029VanLoUuJuyAGCiRZuL3V';
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const VERIFIED_FILE = path.join(DATA_DIR, 'verified.json');
const PLUGIN_STATE_FILE = path.join(DATA_DIR, 'plugin_state.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const MAX_DL = 20 * 1024 * 1024;   // batas unduhan Bot API Telegram
const MAX_SEND = 49 * 1024 * 1024; // batas unggah Bot API Telegram

const send = (m) => { try { if (process.connected) process.send(m); } catch { /* parent hilang */ } };
const log = (msg, level = 'info') => send({ type: 'log', level, msg });
const stat = (key, n = 1) => send({ type: 'stat', key, n });

const sessions = new Map(); // chatId -> { mode, data, pendingFileId, pendingName }
const attempts = new Map(); // userId -> jumlah percobaan verifikasi
const URL_RE = /(https?:\/\/[^\s]+)/i;

/* ---------------- penyimpanan ---------------- */
const verified = () => readJson(VERIFIED_FILE, {});
const isVerified = (id) => !!verified()[String(id)];
const setVerified = (id, name) => {
  const v = verified();
  v[String(id)] = { name: String(name || ''), verifiedAt: new Date().toISOString() };
  writeJson(VERIFIED_FILE, v);
};
const pluginEnabled = (slug) => readJson(PLUGIN_STATE_FILE, {})[slug] !== false;

/* ---------------- util pesan ---------------- */
async function downloadTgFile(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link);
  if (!res.ok) throw new Error(`Unduh file dari Telegram gagal (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DL) throw new Error('File melebihi batas 20 MB Bot API');
  return buf;
}

async function editMsg(ctx, msgId, html) {
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, msgId, null, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  } catch (e) {
    if (!/message is not modified/i.test(String(e && e.message))) log('editMsg: ' + (e && e.message), 'warn');
  }
}

async function notifyAdmin(text) {
  if (!ADMIN_ID || !bot) return;
  try { await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode: 'HTML' }); } catch { /* admin belum chat bot */ }
}

function runCmd(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { cwd, env: { ...process.env, GRADLE_USER_HOME: '/tmp/gradle' } });
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e.message) });
    }
    let out = '', err = '';
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* sudah mati */ } }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message) }); });
  });
}

/* ---------------- pesan standar ---------------- */
const MENU_TEXT =
  '🎮 <b>Menu Utama — YowisBen Dev</b>\n\n' +
  'Semua fitur sudah terbuka. Pilih lewat tombol di bawah, atau cepat:\n' +
  '• Kirim <b>tautan video</b> (TikTok / IG / YouTube / FB / X) → langsung diunduh\n' +
  '• /deployapk — kirim .zip proyek Flutter → jadi APK\n' +
  '• /deployweb — deploy .html / .zip ke subdomain sendiri\n' +
  '• /fitur — daftar fitur tambahan buatan AI\n' +
  '• /help — panduan lengkap';

const MAIN_KB = Markup.inlineKeyboard([
  [Markup.button.callback('📱 Deploy APK Flutter', 'menu:apk'), Markup.button.callback('🌐 Deploy Website', 'menu:web')],
  [Markup.button.callback('🎬 Download Video', 'menu:video'), Markup.button.callback('🧩 Fitur Tambahan', 'menu:fitur')],
  [Markup.button.callback('ℹ️ Bantuan', 'menu:help')],
]);

const sendMain = (ctx, pre = '') => ctx.replyWithHTML((pre || '') + MENU_TEXT, MAIN_KB);

const HELP_TEXT =
  '📖 <b>Panduan YowisBen Dev</b>\n\n' +
  '<b>📱 Deploy APK Flutter</b>\n' +
  '/deployapk → kirim <b>.zip</b> seluruh proyek Flutter (wajib ada <code>pubspec.yaml</code> + folder <code>android/</code>, maks 20 MB). Bot men-build APK release lalu mengirim kembali file + info (nama, package, versi, ukuran).\n\n' +
  '<b>🌐 Deploy Website</b>\n' +
  '/deployweb → minta nama subdomain → kirim <b>.zip</b> (struktur situs) atau <b>.html</b> (satu halaman). Bot deploy ke Netlify dan mengirim URL live.\n\n' +
  '<b>🎬 Download Video</b>\n' +
  'Kirim saja tautan video (TikTok, Instagram, YouTube, Facebook, X, dsb) — otomatis diunduh.\n' +
  '/audio &lt;tautan&gt; — ambil audionya saja (MP3).\n\n' +
  '<b>🧩 Fitur Tambahan</b>\n' +
  '/fitur — daftar plugin aktif. Admin bisa menambah fitur baru lewat web controller dengan AI.\n\n' +
  '/cancel — batalkan mode yang sedang aktif.';

function needVerification(ctx) {
  return ctx.replyWithHTML(
    `🔒 <b>Verifikasi Keanggotaan Diperlukan</b>\n\n` +
    `Halo <b>${esc(ctx.from.first_name || 'sobat')}</b>! Sebelum membuka semua fitur, cukup satu syarat mudah:\n\n` +
    `1️⃣ Klik tombol di bawah, lalu tekan <b>Follow</b> di saluran WhatsApp YowisBen Dev.\n` +
    `2️⃣ Screenshot bukti bahwa kamu sudah follow.\n` +
    `3️⃣ Kirim screenshot-nya ke sini — AI akan menganalisis otomatis (±5 detik).\n\n` +
    `Setelah terverifikasi, semua fitur langsung terbuka: deploy APK Flutter, deploy website, download video semua sosmed, dan fitur tambahan buatan AI.`,
    Markup.inlineKeyboard([
      [Markup.button.url('🔗 Follow Saluran WhatsApp', WA_LINK)],
      [Markup.button.callback('🔄 Cek Status Verifikasi', 'verif:status')],
    ])
  );
}

function askDomain(ctx, note = '') {
  sessions.set(ctx.chat.id, { mode: 'web_domain', data: {} });
  return ctx.replyWithHTML(
    `${note}🌐 <b>Deploy Website</b>\n\n` +
    `Balas dengan <b>nama subdomain</b> yang kamu mau (3–30 karakter: huruf kecil, angka, tanda hubung).\n` +
    `Contoh: <code>portofolio-saya</code> → nanti live di <code>https://portofolio-saya.netlify.app</code>.\n\n` +
    `Setelah itu kirim file <b>.zip</b> (struktur situs) atau <b>.html</b> (satu halaman). Ketik /cancel untuk batal.`
  );
}

/* ---------------- fitur: download video ---------------- */
async function handleVideo(ctx, url, audio) {
  const s = await ctx.reply(audio ? '🎧 Menyiapkan audio…' : '🚀 Mengambil info video…');
  let dir = null;
  try {
    const info = await ytdlp.probe(url);
    await editMsg(ctx, s.message_id,
      `${audio ? '🎧' : '🎬'} Mengunduh <b>${esc(info.title)}</b>…\n` +
      `Sumber: <code>${esc(info.extractor || 'web')}</code>${info.duration ? ` • Durasi ${fmtDur(info.duration)}` : ''}\n` +
      `Batas 45 MB — kualitas terbaik yang muat akan dipilih otomatis.`);
    const r = await ytdlp.download(url, { audio });
    dir = r.dir;
    const size = fs.statSync(r.file).size;
    if (size > MAX_SEND) throw new Error('File hasil melebihi batas unggah Telegram (50 MB).');
    const cap =
      `${audio ? '🎧 Audio siap!' : '🎬 Video siap!'}\n\n` +
      `<b>${esc(info.title)}</b>\n` +
      `• Ukuran: ${fmtBytes(size)}${info.duration ? `\n• Durasi: ${fmtDur(info.duration)}` : ''}` +
      `${info.uploader ? `\n• Kreator: ${esc(info.uploader)}` : ''}\n\n` +
      `<i>YowisBen Dev • All Social Downloader</i>`;
    if (audio) await ctx.replyWithAudio({ source: fs.createReadStream(r.file) }, { caption: cap, parse_mode: 'HTML', title: info.title.slice(0, 60) });
    else await ctx.replyWithVideo({ source: fs.createReadStream(r.file) }, { caption: cap, parse_mode: 'HTML' });
    stat(audio ? 'audioDownloads' : 'videoDownloads');
    await editMsg(ctx, s.message_id, '✅ Terkirim! Kirim tautan lain kapan saja.');
    log(`${audio ? 'Audio' : 'Video'} ${fmtBytes(size)} — "${info.title}" untuk user ${ctx.from.id}`);
  } catch (e) {
    await editMsg(ctx, s.message_id, `❌ ${esc(e.message || e)}`);
    log('Download gagal: ' + (e.message || e), 'warn');
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* biarkan */ } }
  }
}

/* ---------------- fitur: deploy APK Flutter ---------------- */
async function handleApk(ctx, doc) {
  const s = await ctx.reply('⬇️ Mengunduh kode sumber…');
  let tmp = null;
  try {
    const buf = await downloadTgFile(ctx, doc.file_id);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-'));
    await editMsg(ctx, s.message_id, '📂 Mengekstrak arsip…');
    const AdmZip = require('adm-zip');
    new AdmZip(buf).extractAllTo(tmp, true);

    const findPubspec = (dir, depth = 0) => {
      if (depth > 4) return null;
      if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) return dir;
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) { const r = findPubspec(path.join(dir, f.name), depth + 1); if (r) return r; }
      }
      return null;
    };
    const proj = findPubspec(tmp);
    if (!proj) throw new Error('pubspec.yaml tidak ditemukan — arsip ini bukan proyek Flutter yang valid. Zip seluruh struktur proyeknya (termasuk folder android/).');

    const pub = fs.readFileSync(path.join(proj, 'pubspec.yaml'), 'utf8');
    const name = ((pub.match(/^name:\s*(.+)$/m) || [])[1] || '').trim() || 'flutter_app';
    const version = ((pub.match(/^version:\s*(.+)$/m) || [])[1] || '').trim() || '1.0.0';
    const desc = ((pub.match(/^description:\s*(.+)$/m) || [])[1] || '').trim();

    // jaga memori gradle agar aman di container Railway
    try {
      const gp = path.join(proj, 'android', 'gradle.properties');
      if (fs.existsSync(gp)) {
        let g = fs.readFileSync(gp, 'utf8');
        if (/org\.gradle\.jvmargs/.test(g)) g = g.replace(/org\.gradle\.jvmargs=.*/g, 'org.gradle.jvmargs=-Xmx2g');
        else g += '\norg.gradle.jvmargs=-Xmx2g\n';
        fs.writeFileSync(gp, g);
      }
    } catch { /* bukan penghalang build */ }

    await editMsg(ctx, s.message_id,
      `🔨 <b>Build APK</b> — <code>${esc(name)} ${esc(version)}</code>\n\n` +
      `Menjalankan <code>flutter build apk --release</code>…\n` +
      `Biasanya 5–15 menit. Aku kabari saat selesai — jangan kirim file lain dulu ya. ☕`);
    const t0 = Date.now();
    const r = await runCmd('flutter', ['build', 'apk', '--release'], proj, 25 * 60 * 1000);
    if (r.code !== 0) {
      const tail = (r.err + '\n' + r.out).trim().split('\n').slice(-12).join('\n').slice(-1200);
      throw Object.assign(
        new Error('Build gagal.\n<pre>' + esc(tail) + '</pre>\n\n<i>Tips: pastikan proyek lengkap (folder android/ ikut di-zip), dependency valid, dan RAM container ≥ 2 GB.</i>'),
        { html: true }
      );
    }
    const apkPath = path.join(proj, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk');
    if (!fs.existsSync(apkPath)) throw new Error('APK tidak ditemukan setelah build selesai.');
    const size = fs.statSync(apkPath).size;
    const gradleFile = path.join(proj, 'android', 'app', 'build.gradle');
    const gradle = fs.existsSync(gradleFile) ? fs.readFileSync(gradleFile, 'utf8') : '';
    const appId = (gradle.match(/applicationId\s+"([^"]+)"/) || [])[1] || '-';
    const took = Math.round((Date.now() - t0) / 1000);
    stat('apkDeploys');
    await editMsg(ctx, s.message_id, `✅ Build selesai dalam ${fmtDur(took)} — mengirim APK…`);
    await ctx.replyWithDocument({ source: fs.createReadStream(apkPath), filename: `${name}-release.apk` }, {
      caption:
        `📱 <b>APK Siap!</b>\n\n` +
        `• <b>Nama:</b> <code>${esc(name)}</code>\n` +
        `• <b>Package:</b> <code>${esc(appId)}</code>\n` +
        `• <b>Versi:</b> <code>${esc(version)}</code>\n` +
        `• <b>Ukuran:</b> ${fmtBytes(size)}\n` +
        `• <b>Waktu build:</b> ${fmtDur(took)}` +
        (desc ? `\n• <b>Deskripsi:</b> ${esc(desc)}` : '') +
        `\n\n<i>YowisBen Dev • Flutter Builder</i>`,
      parse_mode: 'HTML',
    });
    log(`APK ${name} v${version} (${fmtBytes(size)}) terkirim ke user ${ctx.from.id}`);
    notifyAdmin(`📱 Build APK selesai: <b>${esc(name)}</b> v${esc(version)} (${fmtBytes(size)}) oleh user ${ctx.from.id}`);
  } catch (e) {
    log('Deploy APK gagal: ' + (e.message || e), 'error');
    const msg = e.html ? e.message : `❌ <b>Deploy APK gagal</b>\n\n${esc(e.message || e)}`;
    await editMsg(ctx, s.message_id, msg.slice(0, 3800)).catch(() => {});
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* biarkan */ } }
    sessions.delete(ctx.chat.id);
  }
}

/* ---------------- fitur: deploy website ---------------- */
async function deployWebFromId(ctx, fileId, fileName, domain) {
  const s = await ctx.reply('⬇️ Mengunduh berkas situs…');
  let tmp = null;
  try {
    if (!netlify.available()) throw new Error('NETLIFY_TOKEN belum dipasang di server. Minta admin memasangnya lewat web controller.');
    const buf = await downloadTgFile(ctx, fileId);
    let zipBuf = buf;
    if (/\.html?$/i.test(fileName || '')) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
      const AdmZip = require('adm-zip');
      const z = new AdmZip();
      z.addFile('index.html', buf);
      zipBuf = z.toBuffer();
    }
    await editMsg(ctx, s.message_id, '🌐 Membuat situs di Netlify…');
    let site;
    try {
      site = await netlify.createSite(domain);
    } catch (e) {
      if (e.status === 422 || /taken|exists|reserved/i.test(e.message)) {
        const alt = `${domain}-${Math.random().toString(36).slice(2, 6)}`;
        site = await netlify.createSite(alt);
        domain = alt;
      } else throw e;
    }
    await editMsg(ctx, s.message_id, `🚀 Mengunggah berkas ke <code>${esc(domain)}</code>…`);
    const dep = await netlify.deployZip(site.id, zipBuf);
    await editMsg(ctx, s.message_id, '⏳ Netlify sedang memproses deploy…');
    await netlify.waitReady(dep.id);
    stat('webDeploys');
    const url = site.ssl_url || site.url;
    await editMsg(ctx, s.message_id,
      `✅ <b>Website Live!</b>\n\n🔗 <a href="${url}">${url}</a>\n\n` +
      `Klik tautan untuk membuka. Deploy otomatis oleh YowisBen Dev.`);
    log(`Deploy web ${domain} sukses oleh user ${ctx.from.id}`);
    notifyAdmin(`🌐 Deploy web: <b>${esc(domain)}</b> oleh user ${ctx.from.id}`);
  } catch (e) {
    log('Deploy web gagal: ' + (e.message || e), 'error');
    await editMsg(ctx, s.message_id, `❌ <b>Deploy website gagal</b>\n\n${esc(e.message || e)}`);
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* biarkan */ } }
    sessions.delete(ctx.chat.id);
  }
}

/* ---------------- ctx untuk plugin ---------------- */
function pluginCtx(ctx) {
  const text = (ctx.message && ctx.message.text) || '';
  return {
    from: ctx.from,
    chat: ctx.chat,
    text,
    args: text.split(/\s+/).slice(1),
    env: process.env,
    reply: (t, extra) => ctx.reply(t, extra),
    replyWithHTML: (html, extra) => ctx.replyWithHTML(html, extra),
    sendTyping: () => ctx.sendChatAction('typing'),
    fetch: (url, opts) => fetch(url, opts),
  };
}

/* ---------------- membangun & menjalankan bot ---------------- */
let bot = null;

function buildBot() {
  const b = new Telegraf(BOT_TOKEN, { handlerTimeout: 120000 });

  /* plugin tambahan (AI/template) */
  const plugins = pluginLoader.loadPlugins().filter((p) => p.ok && pluginEnabled(p.mod.slug));
  const gagal = pluginLoader.loadPlugins().filter((p) => !p.ok);
  if (gagal.length) log(`${gagal.length} plugin gagal dimuat: ${gagal.map((g) => `${g.file} (${g.error})`).join('; ')}`, 'warn');
  for (const p of plugins) {
    b.command(p.mod.slug, async (ctx) => {
      try {
        await p.mod.run(pluginCtx(ctx));
      } catch (e) {
        log(`Plugin ${p.mod.slug} error: ${e.message}`, 'error');
        try { await ctx.reply(`⚠️ Fitur ${p.mod.slug} sedang bermasalah: ${e.message}`); } catch { /* diam */ }
      }
    });
  }
  log(`Plugin dimuat: ${plugins.length} aktif, ${gagal.length} gagal.`, 'system');

  b.start(async (ctx) => {
    log(`/start dari user ${ctx.from.id} (${ctx.from.first_name || '-'})`);
    if (isVerified(ctx.from.id)) return sendMain(ctx, `Halo <b>${esc(ctx.from.first_name || 'sobat')}</b>, senang bertemu lagi!\n\n`);
    return needVerification(ctx);
  });

  b.command('help', (ctx) => ctx.replyWithHTML(HELP_TEXT, MAIN_KB));
  b.command('cancel', (ctx) => {
    sessions.delete(ctx.chat.id);
    return ctx.replyWithHTML('✋ Mode aktif dibatalkan. Ketik /help atau /start untuk mulai lagi.');
  });

  b.command('deployapk', async (ctx) => {
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    sessions.set(ctx.chat.id, { mode: 'apk' });
    return ctx.replyWithHTML(
      '📱 <b>Deploy APK Flutter</b>\n\n' +
      'Kirim <b>file .zip</b> berisi seluruh struktur proyek Flutter (wajib ada <code>pubspec.yaml</code> + folder <code>android/</code>).\n\n' +
      '• Maksimal 20 MB (batas Bot API Telegram)\n' +
      '• Build release ±5–15 menit\n' +
      '• Hasil: file APK + info lengkap (nama, package, versi, ukuran)\n\n' +
      '/cancel untuk batal.'
    );
  });

  b.command('deployweb', async (ctx) => {
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    if (!netlify.available()) return ctx.reply('⚙️ Token Netlify belum dipasang di server. Minta admin memasang NETLIFY_TOKEN lewat web controller.');
    return askDomain(ctx);
  });

  b.command('audio', async (ctx) => {
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    const url = ((ctx.message.text || '').split(/\s+/).slice(1).join(' ') || '').trim();
    if (!URL_RE.test(url)) return ctx.replyWithHTML('🎧 Pakai: <code>/audio &lt;tautan video&gt;</code>');
    return handleVideo(ctx, (url.match(URL_RE))[1], true);
  });

  b.command('fitur', async (ctx) => {
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    const ps = pluginLoader.loadPlugins();
    const aktif = ps.filter((p) => p.ok && pluginEnabled(p.mod.slug));
    if (!aktif.length) return ctx.replyWithHTML('🧩 Belum ada fitur tambahan. Admin bisa membuatnya lewat web controller dengan AI.');
    const lines = aktif.map((p) => `• <b>${esc(p.mod.name)}</b> — ${esc(p.mod.description)}\n  Pakai: <code>${esc(p.mod.usage)}</code>`);
    return ctx.replyWithHTML(`🧩 <b>Fitur Tambahan (${aktif.length})</b>\n\n${lines.join('\n')}`);
  });

  b.command('stats', async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) return ctx.reply('Perintah ini khusus admin.');
    const st = readJson(STATS_FILE, {});
    const n = Object.keys(verified()).length;
    return ctx.replyWithHTML(
      '📊 <b>Statistik YowisBen</b>\n\n' +
      `• Pengguna terverifikasi: <b>${n}</b>\n` +
      `• APK dibuild: <b>${st.apkDeploys || 0}</b>\n` +
      `• Website dideploy: <b>${st.webDeploys || 0}</b>\n` +
      `• Video diunduh: <b>${st.videoDownloads || 0}</b>\n` +
      `• Audio diunduh: <b>${st.audioDownloads || 0}</b>\n` +
      `• Verifikasi AI: <b>${st.verifications || 0}</b>`
    );
  });

  /* verifikasi manual oleh admin — penyelamat kalau AI sedang bermasalah */
  b.command('verif', async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) return ctx.reply('Perintah ini khusus admin.');
    const id = ((ctx.message.text || '').split(/\s+/)[1] || '').trim();
    if (!/^\d{4,}$/.test(id)) return ctx.replyWithHTML('Pakai: <code>/verif &lt;telegram_id_user&gt;</code>');
    setVerified(id, 'manual oleh admin');
    log(`Verifikasi manual oleh admin untuk user ${id}`, 'system');
    return ctx.replyWithHTML(`✅ User <code>${esc(id)}</code> diverifikasi manual. Semua fiturnya langsung terbuka.`);
  });

  b.command('unverif', async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) return ctx.reply('Perintah ini khusus admin.');
    const id = ((ctx.message.text || '').split(/\s+/)[1] || '').trim();
    if (!/^\d{4,}$/.test(id)) return ctx.replyWithHTML('Pakai: <code>/unverif &lt;telegram_id_user&gt;</code>');
    const v = verified();
    delete v[id];
    writeJson(VERIFIED_FILE, v);
    return ctx.replyWithHTML(`✅ Verifikasi user <code>${esc(id)}</code> dicabut.`);
  });

  /* tombol inline */
  b.action('menu:apk', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    sessions.set(ctx.chat.id, { mode: 'apk' });
    return ctx.replyWithHTML(
      '📱 <b>Deploy APK Flutter</b>\n\n' +
      'Sekarang kirim <b>file .zip</b> proyek Flutter lengkap (pubspec.yaml + android/). Maks 20 MB.\n' +
      'Build release butuh 5–15 menit — hasilnya APK + info lengkap. /cancel untuk batal.'
    );
  });

  b.action('menu:web', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    if (!netlify.available()) return ctx.reply('⚙️ Token Netlify belum dipasang di server. Minta admin memasang NETLIFY_TOKEN lewat web controller.');
    return askDomain(ctx);
  });

  b.action('menu:webzip', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    const sess = sessions.get(ctx.chat.id) || {};
    sessions.set(ctx.chat.id, { mode: 'web_domain', data: {}, pendingFileId: sess.pendingFileId, pendingName: sess.pendingName });
    return askDomain(ctx);
  });

  b.action('menu:video', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    return ctx.replyWithHTML(
      '🎬 <b>Download Video All Sosmed</b>\n\n' +
      'Tinggal kirim <b>tautannya</b> di chat ini — video otomatis diunduh dan dikirim (TikTok, Instagram, YouTube, Facebook, X, dan lainnya).\n' +
      'Mau audionya saja? Pakai <code>/audio &lt;tautan&gt;</code>. Batas ukuran 45 MB per file.'
    );
  });

  b.action('menu:fitur', async (ctx) => {
    await ctx.answerCbQuery();
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    const ps = pluginLoader.loadPlugins().filter((p) => p.ok && pluginEnabled(p.mod.slug));
    if (!ps.length) return ctx.replyWithHTML('🧩 Belum ada fitur tambahan. Admin bisa membuatnya lewat web controller dengan AI.');
    const lines = ps.map((p) => `• <b>${esc(p.mod.name)}</b> — ${esc(p.mod.description)}\n  Pakai: <code>${esc(p.mod.usage)}</code>`);
    return ctx.replyWithHTML(`🧩 <b>Fitur Tambahan (${ps.length})</b>\n\n${lines.join('\n')}`);
  });

  b.action('menu:help', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML(HELP_TEXT, MAIN_KB);
  });

  b.action('verif:status', async (ctx) => {
    await ctx.answerCbQuery();
    if (isVerified(ctx.from.id)) return sendMain(ctx, '✅ Kamu sudah terverifikasi!\n\n');
    return needVerification(ctx);
  });

  /* foto = bukti verifikasi */
  b.on('photo', async (ctx) => {
    const uid = ctx.from.id;
    if (isVerified(uid)) {
      return ctx.replyWithHTML('📸 Foto diterima, tapi tidak ada aksi untuk foto. Ketik /help untuk melihat perintah.');
    }
    const tries = (attempts.get(uid) || 0) + 1;
    attempts.set(uid, tries);
    const s = await ctx.reply('🧠 <i>AI sedang menganalisis screenshot bukti follow…</i>', { parse_mode: 'HTML' });
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const buf = await downloadTgFile(ctx, photo.file_id);
      const r = await gemini.analyzeFollowScreenshot(buf.toString('base64'), WA_LINK);
      if (r.following && r.confidence >= 55) {
        setVerified(uid, ctx.from.first_name || '');
        stat('verifications');
        attempts.delete(uid);
        await editMsg(ctx, s.message_id,
          `✅ <b>Verifikasi Berhasil!</b>\n\n${esc(r.reason || 'Bukti follow terdeteksi.')}\n\n` +
          `Selamat datang di lingkaran YowisBen Dev, <b>${esc(ctx.from.first_name || '')}</b>! Semua fitur sudah terbuka.`);
        await sendMain(ctx, '');
        log(`Verifikasi AI lolos: user ${uid} (${ctx.from.first_name || '-'}) confidence ${r.confidence}%`, 'system');
        notifyAdmin(`✅ User baru terverifikasi: <b>${esc(ctx.from.first_name || '-')}</b> (ID <code>${uid}</code>, confidence ${r.confidence}%)`);
      } else {
        await editMsg(ctx, s.message_id,
          `❌ <b>Verifikasi Gagal</b> (keyakinan AI ${r.confidence}%)\n\n${esc(r.reason || 'Bukti follow tidak terdeteksi.')}\n\n` +
          `Tips: pastikan screenshot memperlihatkan tombol <b>Follow / Joined</b> beserta nama salurannya.\n` +
          `Percobaan ${tries}/5 — kirim ulang screenshot.`);
        if (tries >= 5) await ctx.replyWithHTML('🚫 Batas percobaan tercapai. Hubungi admin untuk verifikasi manual.');
      }
    } catch (e) {
      log('Analisis verifikasi gagal: ' + (e.message || e), 'warn');
      const keyRusak = /API key not valid|GEMINI_API_KEY|ACCESS_TOKEN/i.test(String(e.message || e));
      if (keyRusak) {
        notifyAdmin(
          '⚠️ <b>GEMINI_API_KEY tidak valid.</b>\n' +
          'Cara memperbaiki:\n' +
          '1. Buka aistudio.google.com/apikey dan buat API key (berawalan <code>AIza</code>).\n' +
          '2. Pasang di Railway → Variables → GEMINI_API_KEY.\n' +
          '3. Klik Restart di web controller.\n\n' +
          'Sementara itu, verifikasi user secara manual dengan perintah: <code>/verif &lt;id_user&gt;</code>.'
        );
      }
      await editMsg(ctx, s.message_id,
        (keyRusak
          ? '⚠️ <b>Verifikasi AI sedang tidak tersedia di server</b> (API key bermasalah).\n\n'
            + 'Admin sudah diberi tahu otomatis. Kamu bisa minta admin memverifikasi akunmu secara manual — sebutkan ID Telegram-mu: <code>' + esc(String(uid)) + '</code>.\n\n'
          : `⚠️ Analisis AI bermasalah: ${esc(e.message || e)}\n\n`)
        + 'Coba kirim ulang screenshot beberapa saat lagi.');
    }
  });

  /* dokumen = zip APK / zip+html website */
  b.on('document', async (ctx) => {
    if (!isVerified(ctx.from.id)) return needVerification(ctx);
    const doc = ctx.message.document;
    const name = doc.file_name || '';
    const sess = sessions.get(ctx.chat.id) || {};
    if (doc.file_size > MAX_DL) {
      return ctx.replyWithHTML('📦 File melebihi 20 MB — itu batas unduh Bot API Telegram. Pecah arsipnya atau kurangi aset, lalu kirim lagi.');
    }
    if (sess.mode === 'web_file' && sess.data && sess.data.domain) {
      if (!/\.(zip|html?)$/i.test(name)) return ctx.replyWithHTML('🌐 Untuk deploy web, kirim file <b>.zip</b> atau <b>.html</b> ya.');
      return deployWebFromId(ctx, doc.file_id, name, sess.data.domain);
    }
    if (sess.mode === 'apk') {
      if (!/\.zip$/i.test(name)) return ctx.replyWithHTML('📱 Untuk build APK, kirim <b>.zip</b> proyek Flutter lengkap (ada pubspec.yaml di dalamnya).');
      return handleApk(ctx, doc);
    }
    if (/\.zip$/i.test(name)) {
      sessions.set(ctx.chat.id, { mode: 'choose_zip', pendingFileId: doc.file_id, pendingName: name });
      return ctx.replyWithHTML('📦 Zip terdeteksi. Mau diapakan file ini?', Markup.inlineKeyboard([
        [Markup.button.callback('📱 Build APK Flutter', 'menu:apk'), Markup.button.callback('🌐 Deploy sebagai situs', 'menu:webzip')],
        [Markup.button.callback('❌ Tidak jadi', 'menu:cancelzip')],
      ]));
    }
    if (/\.html?$/i.test(name)) {
      sessions.set(ctx.chat.id, { mode: 'web_domain', data: {}, pendingFileId: doc.file_id, pendingName: name });
      return askDomain(ctx, 'File HTML sudah diterima. ');
    }
    return ctx.replyWithHTML('🤔 Aku belum tahu file ini untuk fitur mana. Ketik /help untuk melihat cara pakai.');
  });

  b.action('menu:cancelzip', async (ctx) => {
    await ctx.answerCbQuery();
    sessions.delete(ctx.chat.id);
    return ctx.reply('Baik, tidak jadi. File zip tadi kubiarkan.');
  });

  /* teks: input subdomain / tautan video / percakapan */
  b.on('text', async (ctx) => {
    const uid = ctx.from.id;
    const chatId = ctx.chat.id;
    const text = (ctx.message.text || '').trim();

    if (text.startsWith('/')) {
      return ctx.replyWithHTML('🤔 Perintah tidak dikenal. Ketik /help untuk daftar lengkap.');
    }
    if (!isVerified(uid)) return needVerification(ctx);

    const sess = sessions.get(chatId);
    if (sess && sess.mode === 'web_domain') {
      let dom = text.toLowerCase().replace(/^https?:\/\//, '').replace(/\.netlify\.app.*$/, '').replace(/[^a-z0-9-]/g, '');
      if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(dom)) {
        return ctx.replyWithHTML('❌ Nama subdomain belum valid. Gunakan 3–30 karakter: huruf kecil, angka, tanda hubung. Contoh: <code>portofolio-saya</code>');
      }
      if (sess.pendingFileId) {
        sessions.set(chatId, { mode: 'web_file', data: { domain: dom } });
        return deployWebFromId(ctx, sess.pendingFileId, sess.pendingName, dom);
      }
      sessions.set(chatId, { mode: 'web_file', data: { domain: dom } });
      return ctx.replyWithHTML(
        `✅ Subdomain dicatat: <code>${esc(dom)}</code>\n\n` +
        `Sekarang kirim file <b>.zip</b> (struktur situs lengkap) atau <b>.html</b> (satu halaman). Maksimal 20 MB.`
      );
    }

    const m = text.match(URL_RE);
    if (m) return handleVideo(ctx, m[1], false);

    if (sess && sess.mode === 'web_file') return ctx.replyWithHTML('🌐 Aku masih menunggu file <b>.zip</b> atau <b>.html</b> untuk subdomain yang tadi. /cancel untuk batal.');
    return sendMain(ctx, 'Masih awam dengan pesan ini 😅 Pilih fitur di bawah atau kirim tautan video.\n\n');
  });

  b.catch((err) => log('Handler error: ' + (err && err.message), 'error'));
  return b;
}

async function startBot() {
  if (bot) { try { bot.stop('reload'); } catch { /* belum jalan */ } bot = null; }
  bot = buildBot();
  const me = await bot.telegram.getMe();
  log(`Terhubung sebagai @${me.username}. Menyalakan long polling…`, 'system');
  bot.launch({ dropPendingUpdates: true }, () => {
    send({ type: 'ready', username: me.username });
    log('Long polling aktif — bot siap menerima pesan.', 'system');
  }).catch((e) => {
    if (/SIGTERM|SIGINT|stopped/i.test(String(e && e.message))) return;
    log('Polling terhenti: ' + (e && e.message), 'error');
  });
}

process.on('message', (m) => {
  if (m && m.type === 'reload') {
    log('Memuat ulang plugin (hot reload)…', 'system');
    startBot().catch((e) => log('Reload gagal: ' + (e.message || e), 'error'));
  }
});
process.on('SIGTERM', () => { if (bot) { try { bot.stop('SIGTERM'); } catch { /* diam */ } } process.exit(0); });
process.on('unhandledRejection', (e) => log('unhandledRejection: ' + ((e && e.message) || e), 'warn'));
process.on('uncaughtException', (e) => log('uncaughtException: ' + ((e && e.message) || e), 'error'));

/* ---------------- mode mock (preview/dev) ---------------- */
if (MOCK) {
  send({ type: 'ready', username: 'yowisbenzzzz12_bot (mock)' });
  log('Mode MOCK aktif: tidak benar-benar menyambung ke Telegram (khusus preview/dev).', 'warn');
  if (!fs.existsSync(VERIFIED_FILE)) {
    writeJson(VERIFIED_FILE, {
      '7596781256': { name: 'sss', verifiedAt: new Date().toISOString() },
      '612334455': { name: 'Dinda', verifiedAt: new Date().toISOString() },
    });
  }
  if (!fs.existsSync(STATS_FILE)) {
    writeJson(STATS_FILE, { apkDeploys: 3, webDeploys: 7, videoDownloads: 24, audioDownloads: 9, verifications: 12, aiFeatures: 2 });
  }
  const lines = [
    ['Verifikasi screenshot user 6123*** — lolos AI (confidence 92%)', 'info'],
    ['Deploy web: yowis-demo.netlify.app → ready (3.8 detik)', 'info'],
    ['Video TikTok @dindaputri diunduh — 8.4 MB, terkirim', 'info'],
    ['Build APK mulai: proyek kasir_flutter v1.2.0', 'info'],
    ['Build APK selesai: kasir_flutter-release.apk 24.3 MB', 'info'],
    ['Plugin dimuat: 7 aktif, 0 gagal', 'system'],
    ['Pesan yang paling sering dipakai: /help', 'info'],
  ];
  let i = 0;
  const iv = setInterval(() => { log(lines[i % lines.length][0], lines[i % lines.length][1]); i++; }, 3200);
  process.on('message', (m) => { if (m && m.type === 'reload') log('Plugin dimuat ulang (mock).', 'system'); });
  process.on('SIGTERM', () => { clearInterval(iv); process.exit(0); });
} else {
  if (!BOT_TOKEN) {
    log('BOT_TOKEN kosong — bot tidak bisa jalan. Isi env BOT_TOKEN di Railway > Variables.', 'error');
    process.exit(1);
  }
  startBot().catch((e) => {
    log('Gagal start bot: ' + ((e && e.message) || e), 'error');
    process.exit(1);
  });
}

