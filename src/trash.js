// 回收站与记录版本历史
const { getDb } = require('./connection');
const { isoNow, mapNote } = require('./util');
const { saveNote, getNote } = require('./notes');

function deleteNote(id) {
  getDb().prepare('UPDATE daily_notes SET deleted_at = ? WHERE id = ?').run(isoNow(), id);
  return true;
}

function listTrash() {
  return getDb().prepare("SELECT * FROM daily_notes WHERE deleted_at <> '' ORDER BY deleted_at DESC").all()
    .map((r) => ({ ...mapNote(r), deletedAt: r.deleted_at }));
}

function restoreNote(id) {
  getDb().prepare("UPDATE daily_notes SET deleted_at = '' WHERE id = ?").run(id);
  return getNote(id);
}

function purgeNote(id) {
  const db = getDb();
  db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id);
  db.prepare('DELETE FROM daily_notes WHERE id = ?').run(id);
  return true;
}

// 物理删除超过保留期的回收站记录
function purgeExpired(days = 30) {
  const limit = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = getDb().prepare("SELECT id FROM daily_notes WHERE deleted_at <> '' AND deleted_at < ?").all(limit);
  for (const r of rows) purgeNote(r.id);
  return rows.length;
}

function noteVersions(noteId) {
  return getDb().prepare('SELECT id, saved_at, snapshot FROM note_versions WHERE note_id = ? ORDER BY id DESC').all(noteId)
    .map((v) => ({ id: v.id, savedAt: v.saved_at, note: JSON.parse(v.snapshot) }));
}

function restoreVersion(versionId) {
  const db = getDb();
  const v = db.prepare('SELECT * FROM note_versions WHERE id = ?').get(versionId);
  if (!v) return null;
  const snap = JSON.parse(v.snapshot);
  // 恢复前把当前内容也存成一条历史，防止覆盖丢失
  const cur = db.prepare('SELECT * FROM daily_notes WHERE id = ?').get(snap.id);
  if (cur) {
    db.prepare('INSERT INTO note_versions (note_id, snapshot, saved_at) VALUES (?, ?, ?)')
      .run(snap.id, JSON.stringify(cur), isoNow());
  }
  const saved = saveNote({
    id: snap.id, date: snap.date, project: snap.project, title: snap.title,
    content: snap.content, contentHtml: snap.content_html, done: snap.done,
    startTime: snap.start_time, finishTime: snap.finish_time, remark: snap.remark,
    contentJson: snap.content_json,
  });
  db.prepare('DELETE FROM note_versions WHERE id = ?').run(versionId);
  return saved;
}

module.exports = { deleteNote, listTrash, restoreNote, purgeNote, purgeExpired, noteVersions, restoreVersion };
