// 保存的筛选条件
const { getDb } = require('./connection');

function listSavedFilters() {
  return getDb().prepare('SELECT * FROM saved_filters ORDER BY id DESC').all();
}

function saveSavedFilter(f) {
  const db = getDb();
  if (f.id) {
    db.prepare('UPDATE saved_filters SET name=?, query=? WHERE id=?').run(f.name, f.query, f.id);
    return { id: f.id, name: f.name, query: f.query };
  }
  const res = db.prepare('INSERT INTO saved_filters (name, query) VALUES (?, ?)').run(f.name, f.query || '{}');
  return { id: Number(res.lastInsertRowid), name: f.name, query: f.query || '{}' };
}

function deleteSavedFilter(id) {
  getDb().prepare('DELETE FROM saved_filters WHERE id=?').run(id);
  return true;
}

module.exports = { listSavedFilters, saveSavedFilter, deleteSavedFilter };
