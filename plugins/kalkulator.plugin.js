// @name Kalkulator
// @slug kalkulator
// @description Kalkulator aman: hanya angka dan operator dasar.
// @usage /kalkulator 12*(3+4)
// @engine builtin
// @created 2026-11-20
module.exports = {
  name: 'Kalkulator',
  slug: 'kalkulator',
  description: 'Kalkulator aman: hanya angka dan operator + - * / ( ) %.',
  usage: '/kalkulator 12*(3+4)',
  async run(ctx) {
    const expr = (ctx.args || []).join(' ').trim();
    if (!expr) return ctx.replyWithHTML(`Contoh pakai:\n<code>/kalkulator 12*(3+4)</code>`);
    if (!/^[0-9+\-*/().%\s]+$/.test(expr)) return ctx.reply('Hanya angka dan operator + - * / ( ) % yang diizinkan.');
    let hasil;
    try { hasil = Function('"use strict"; return (' + expr + ')')(); }
    catch (e) { return ctx.reply('Ekspresi tidak valid, coba periksa lagi.'); }
    if (typeof hasil !== 'number' || !isFinite(hasil)) return ctx.reply('Hasilnya bukan angka yang valid.');
    await ctx.replyWithHTML(`<code>${expr}</code> = <b>${hasil}</b>`);
  },
};
