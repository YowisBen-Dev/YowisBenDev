'use strict';
/* Loader plugin bot: baca folder plugins/, validasi struktur module.exports.
 * Dipakai parent (metadata untuk web admin) dan worker (eksekusi). */
const fs = require('fs');
const path = require('path');

const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');

function ensurePluginsDir() { fs.mkdirSync(PLUGINS_DIR, { recursive: true }); }

function parseHeader(src) {
  const grab = (k) => {
    const m = src.match(new RegExp(`^\\/\\/\\s*@${k}\\s*(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  return {
    name: grab('name'),
    slug: grab('slug'),
    description: grab('description'),
    usage: grab('usage'),
    engine: grab('engine') || 'ai',
    createdAt: grab('created') || '',
  };
}

/* Metadata semua plugin (dipakai web admin; tidak mengeksekusi kode). */
function listPlugins() {
  ensurePluginsDir();
  const out = [];
  for (const f of fs.readdirSync(PLUGINS_DIR).sort()) {
    if (!f.endsWith('.plugin.js')) continue;
    try {
      const src = fs.readFileSync(path.join(PLUGINS_DIR, f), 'utf8');
      const h = parseHeader(src);
      const st = fs.statSync(path.join(PLUGINS_DIR, f));
      out.push({
        file: f,
        slug: h.slug || f.replace(/\.plugin\.js$/, ''),
        name: h.name || h.slug || f,
        description: h.description,
        usage: h.usage,
        engine: h.engine,
        createdAt: h.createdAt,
        sizeBytes: st.size,
        mtime: st.mtimeMs,
      });
    } catch (e) {
      out.push({ file: f, slug: f.replace(/\.plugin\.js$/, ''), name: f, error: e.message });
    }
  }
  return out;
}

function validatePlugin(mod) {
  if (!mod || typeof mod !== 'object') throw new Error('module.exports bukan objek');
  if (!mod.slug || !/^[a-z][a-z0-9_]{2,19}$/.test(mod.slug)) throw new Error('slug tidak valid (huruf kecil/angka/underscore, 3-20)');
  if (typeof mod.run !== 'function') throw new Error('run harus berupa fungsi async');
  mod.name = mod.name || mod.slug;
  mod.description = mod.description || '';
  mod.usage = mod.usage || `/${mod.slug}`;
  return mod;
}

/* Muat plugin untuk worker: require + validasi. */
function loadPlugins() {
  ensurePluginsDir();
  const out = [];
  for (const f of fs.readdirSync(PLUGINS_DIR).sort()) {
    if (!f.endsWith('.plugin.js')) continue;
    const p = path.join(PLUGINS_DIR, f);
    try {
      delete require.cache[require.resolve(p)];
      const mod = validatePlugin(require(p));
      out.push({ ok: true, file: f, path: p, mod });
    } catch (e) {
      out.push({ ok: false, file: f, error: e.message });
    }
  }
  return out;
}

function pluginPath(slug) {
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(slug)) throw new Error('slug tidak valid');
  return path.join(PLUGINS_DIR, `${slug}.plugin.js`);
}

function savePlugin(plugin) {
  ensurePluginsDir();
  const p = pluginPath(plugin.slug);
  fs.writeFileSync(p, plugin.code.endsWith('\n') ? plugin.code : `${plugin.code}\n`);
  return p;
}

function removePlugin(slug) {
  const p = pluginPath(slug);
  if (fs.existsSync(p)) fs.rmSync(p);
  return true;
}

module.exports = { listPlugins, loadPlugins, savePlugin, removePlugin, pluginPath, PLUGINS_DIR };
