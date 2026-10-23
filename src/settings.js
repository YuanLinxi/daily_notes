// 键值设置
const { getDb } = require('./connection');

function getSetting(key) {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}

function setSetting(key, value) {
  getDb().prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
  return true;
}

module.exports = { getSetting, setSetting };
