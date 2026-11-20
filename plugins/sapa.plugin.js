// @name Sapa Hangat
// @slug sapa
// @description Sapa pengguna sesuai waktu Indonesia.
// @usage /sapa
// @engine builtin
// @created 2026-11-20
module.exports = {
  name: 'Sapa Hangat',
  slug: 'sapa',
  description: 'Sapa pengguna sesuai waktu dan beri semangat.',
  usage: '/sapa',
  async run(ctx) {
    const h = Number(new Date().toLocaleString('id-ID', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jakarta' }));
    const waktu = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
    const nama = (ctx.from && ctx.from.first_name) || 'sobat';
    await ctx.replyWithHTML(`${waktu}, <b>${nama}</b>! Semangat terus ya hari ini. Kalau butuh apa-apa, ketik /help.`);
  },
};
