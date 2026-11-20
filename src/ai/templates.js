'use strict';
/* Engine template offline: fallback agar alur "tambah fitur via AI" tetap
 * berfungsi 100% meski Gemini tidak tersedia / key tidak valid.
 * Pemilihan template berdasarkan kata kunci permintaan admin. */

function baseSlug(desc) {
  const words = String(desc).toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 2 && !['untuk', 'dengan', 'yang', 'buat', 'fitur', 'plugin', 'bot', 'telegram'].includes(w));
  const s = words.slice(0, 2).join('_').replace(/[^a-z0-9_]/g, '_').slice(0, 18);
  return /^[a-z][a-z0-9_]{2,19}$/.test(s) ? s : 'fitur_baru';
}

function header(name, slug, desc, engine) {
  const d = new Date().toISOString().slice(0, 10);
  return `// @name ${name}\n// @slug ${slug}\n// @description ${desc}\n// @usage /${slug}\n// @engine ${engine}\n// @created ${d}\n`;
}

function tplSapa(name, slug) {
  const desc = 'Sapa pengguna sesuai waktu dan beri semangat.';
  const code = header(name, slug, desc, 'template') + `module.exports = {
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  description: ${JSON.stringify(desc)},
  usage: '/${slug}',
  async run(ctx) {
    const h = new Date().getHours();
    const waktu = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
    const nama = (ctx.from && ctx.from.first_name) || 'sobat';
    await ctx.replyWithHTML(waktu + ', <b>' + nama + '</b>! Semangat terus ya hari ini. Kalau butuh bantuan, ketik /help.');
  },
};`;
  return { name, slug, description: desc, usage: `/${slug}`, code };
}

function tplPing(name, slug) {
  const desc = 'Uji kecepatan respons bot dalam milidetik.';
  const code = header(name, slug, desc, 'template') + `module.exports = {
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  description: ${JSON.stringify(desc)},
  usage: '/${slug}',
  async run(ctx) {
    const t0 = Date.now();
    await ctx.reply('Ping!');
    const ms = Date.now() - t0;
    await ctx.replyWithHTML('Latensi: <code>' + ms + ' ms</code> — bot responsif.');
  },
};`;
  return { name, slug, description: desc, usage: `/${slug}`, code };
}

function tplQuote(name, slug) {
  const desc = 'Kirim satu kutipan motivasi acak.';
  const code = header(name, slug, desc, 'template') + `module.exports = {
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  description: ${JSON.stringify(desc)},
  usage: '/${slug}',
  async run(ctx) {
    const quotes = [
      ['Kerja keras tidak akan mengkhianati hasil.', 'anonim'],
      ['Mulaileh dari yang kecil, tapi mulai hari ini.', 'anonim'],
      ['Gagal itu bagian dari proses, berhenti baru masalahnya.', 'anonim'],
      ['Kode yang baik ditulis dua kali: sekali untuk mesin, sekali untuk manusia.', 'anonim'],
      ['Konsistensi kecil setiap hari mengalahkan usaha besar sekali sebulan.', 'anonim'],
      ['Jangan tunggu sempurna, tunggu selesai.', 'anonim'],
      ['Belajar satu hal baru tiap hari, setahun kamu beda sendiri.', 'anonim'],
      ['Yang membuat ahli bukan bakat, tapi pengulangan yang sabar.', 'anonim'],
      ['Idea tanpa eksekusi hanya fantasi.', 'anonim'],
      ['Istirahat boleh, menyerah jangan.', 'anonim'],
    ];
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    await ctx.replyWithHTML('"' + q[0] + '"\\n— <i>' + q[1] + '</i>');
  },
};`;
  return { name, slug, description: desc, usage: `/${slug}`, code };
}

function tplKalkulator(name, slug) {
  const desc = 'Kalkulator aman: hanya angka dan operator dasar.';
  const code = header(name, slug, desc, 'template') + `module.exports = {
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  description: ${JSON.stringify(desc)},
  usage: '/${slug} 12*(3+4)',
  async run(ctx) {
    const expr = (ctx.args || []).join(' ').trim();
    if (!expr) return ctx.replyWithHTML('Contoh pakai:\\n<code>/${slug} 12*(3+4)</code>');
    if (!/^[0-9+\\-*/().%\\s]+$/.test(expr)) return ctx.reply('Hanya angka dan operator + - * / ( ) % yang diizinkan.');
    let hasil;
    try { hasil = Function('"use strict"; return (' + expr + ')')(); }
    catch (e) { return ctx.reply('Ekspresi tidak valid, coba periksa lagi.'); }
    if (typeof hasil !== 'number' || !isFinite(hasil)) return ctx.reply('Hasilnya bukan angka yang valid.');
    await ctx.replyWithHTML('<code>' + expr + '</code> = <b>' + hasil + '</b>');
  },
};`;
  return { name, slug, description: desc, usage: `/${slug} <ekspresi>`, code };
}

function tplWaktu(name, slug) {
  const desc = 'Tampilkan tanggal, jam, dan zona waktu server.';
  const code = header(name, slug, desc, 'template') + `module.exports = {
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  description: ${JSON.stringify(desc)},
  usage: '/${slug}',
  async run(ctx) {
    const now = new Date();
    const info = now.toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'medium', timeZone: 'Asia/Jakarta' });
    await ctx.replyWithHTML('Waktu server (WIB):\\n<b>' + info + '</b>');
  },
};`;
  return { name, slug, description: desc, usage: `/${slug}`, code };
}

function tplEcho(name, slug) {
  const desc = 'Pantulkan teks yang dikirim dengan format kartu rapi.';
  const code = header(name, slug, desc, 'template') + `module.exports = {
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  description: ${JSON.stringify(desc)},
  usage: '/${slug} <teks>',
  async run(ctx) {
    const text = (ctx.args || []).join(' ').trim();
    if (!text) return ctx.replyWithHTML('Contoh pakai:\\n<code>/${slug} halo dunia</code>');
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await ctx.replyWithHTML('Pantulan:\\n<pre>' + safe + '</pre>');
  },
};`;
  return { name, slug, description: desc, usage: `/${slug} <teks>`, code };
}

const RULES = [
  { re: /sapa|salam|greet|halo|hello|selamat/i, make: tplSapa },
  { re: /ping|laten|respons|cepat|speed/i, make: tplPing },
  { re: /quote|kutip|motiva|semangat|inspira/i, make: tplQuote },
  { re: /kalkul|hitung|matema|aritmet/i, make: tplKalkulator },
  { re: /waktu|jam|tanggal|tanggal|schedule/i, make: tplWaktu },
];

function generateFeature(description) {
  const desc = String(description || '').trim();
  const rule = RULES.find((r) => r.re.test(desc));
  const make = rule ? rule.make : tplEcho;
  const slug = baseSlug(desc) || make.name;
  const name = desc.length <= 40 ? desc.charAt(0).toUpperCase() + desc.slice(1) : 'Fitur Kustom';
  const plugin = make(name, slug);
  plugin.fallbackNote = 'Dibuat oleh engine template offline (Gemini tidak tersedia). Bisa diedit manual di folder plugins/.';
  return plugin;
}

module.exports = { generateFeature, baseSlug };
