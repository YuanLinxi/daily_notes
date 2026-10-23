// 草稿：崩溃恢复用的临时内容
const { getDb } = require('./connection');
const { isoNow } = require('./util');

function saveDraft(key, data) {
  getDb().prepare(`INSERT INTO drafts (key, data, saved_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at`)
    .run(key, JSON.stringify(data), isoNow());
  return true;
}

function getDraft(key) {
  const r = getDb().prepare('SELECT * FROM drafts WHERE key = ?').get(key);
  return r ? { data: JSON.parse(r.data), savedAt: r.saved_at } : null;
}

function clearDraft(key) {
  getDb().prepare('DELETE FROM drafts WHERE key = ?').run(key);
  return true;
}

function listDrafts() {
  return getDb().prepare('SELECT key, saved_at AS savedAt FROM drafts ORDER BY saved_at DESC').all();
}

module.exports = { saveDraft, getDraft, clearDraft, listDrafts };
