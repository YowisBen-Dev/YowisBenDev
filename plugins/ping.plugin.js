// @name Ping
// @slug ping
// @description Uji kecepatan respons bot dalam milidetik.
// @usage /ping
// @engine builtin
// @created 2026-11-20
module.exports = {
  name: 'Ping',
  slug: 'ping',
  description: 'Uji kecepatan respons bot.',
  usage: '/ping',
  async run(ctx) {
    const t0 = Date.now();
    await ctx.reply('Pong!');
    const ms = Date.now() - t0;
    await ctx.replyWithHTML(`Latensi: <code>${ms} ms</code> — bot responsif.`);
  },
};
