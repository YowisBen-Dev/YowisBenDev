// @name Quote Motivasi
// @slug quote
// @description Kirim satu kutipan motivasi acak.
// @usage /quote
// @engine builtin
// @created 2026-11-20
module.exports = {
  name: 'Quote Motivasi',
  slug: 'quote',
  description: 'Kirim satu kutipan motivasi acak.',
  usage: '/quote',
  async run(ctx) {
    const quotes = [
      ['Kerja keras tidak akan mengkhianati hasil.', 'anonim'],
      ['Mulai dari yang kecil, tapi mulai hari ini.', 'anonim'],
      ['Gagal itu bagian dari proses, berhenti baru masalahnya.', 'anonim'],
      ['Kode yang baik ditulis dua kali: sekali untuk mesin, sekali untuk manusia.', 'anonim'],
      ['Konsistensi kecil setiap hari mengalahkan usaha besar sekali sebulan.', 'anonim'],
      ['Jangan tunggu sempurna, tunggu selesai.', 'anonim'],
      ['Belajar satu hal baru tiap hari, setahun kamu beda sendiri.', 'anonim'],
      ['Yang membuat ahli bukan bakat, tapi pengulangan yang sabar.', 'anonim'],
      ['Ide tanpa eksekusi hanya fantasi.', 'anonim'],
      ['Istirahat boleh, menyerah jangan.', 'anonim'],
    ];
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    await ctx.replyWithHTML(`"${q[0]}"\n— <i>${q[1]}</i>`);
  },
};
