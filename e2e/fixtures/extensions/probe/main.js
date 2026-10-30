// The probe's main part: answers the renderer part over the channel, using ext.xnat in main.
module.exports = {
  activate(ext) {
    ext.channel.handle(async (m) => {
      if (m && m.op === 'user') return ext.xnat.user();
      if (m && m.op === 'getJson') return ext.xnat.getJson(m.path, m.query);
      if (m && m.op === 'post') { ext.channel.post({ from: 'main', n: m.n }); return 'posted'; }
      if (m && m.op === 'throw') throw new Error('main handler failed');
      return { echo: m };
    });
  },
};
