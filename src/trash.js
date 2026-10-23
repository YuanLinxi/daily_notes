// 回收站与记录版本历史：基于对象模型
const { getDb } = require('./connection');
const { isoNow } = require('./util');
const obj = require('./objects');
const { listNotes, getNote, saveNote } = require('./notes');

function deleteNote(id) {
  obj.updateObject(id, { deletedAt: isoNow() });
  return true;
}

function listTrash() {
  return listNotes({ trash: true })
    .map((n) => ({ ...n, deletedAt: obj.getObject(n.id)?.deleted_at || '' }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id - b.id);
}

function restoreNote(id) {
  obj.updateObject(id, { deletedAt: '' });
  return getNote(id);
}

function purgeNote(id) {
  const db = getDb();
  db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id);
  obj.deleteObjectPermanently(id);
  return true;
}

// 物理删除超过保留期的回收站记录
function purgeExpired(days = 30) {
  const limit = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = getDb().prepare(`SELECT id FROM objects
    WHERE type_key = 'note' AND deleted_at <> '' AND deleted_at < ?`).all(limit);
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
  const cur = obj.getObject(snap.id);
  if (cur) {
    const curValues = obj.getValues(snap.id);
    db.prepare('INSERT INTO note_versions (note_id, snapshot, saved_at) VALUES (?, ?, ?)')
      .run(snap.id, JSON.stringify({
        id: cur.id, date: curValues.date || '', project: curValues.project || '', title: cur.title || '',
        content: curValues.content || '', content_html: curValues.content_html || '',
        done: (curValues.status || '') === 'done' ? 1 : 0, status: curValues.status || 'todo',
        due_date: curValues.due_date || '', start_time: curValues.start_time || '',
        finish_time: curValues.finish_time || '', remark: curValues.remark || '',
        content_json: curValues.content_json || '', root_id: Number(curValues.root_id) || cur.id,
        created_at: cur.created_at, updated_at: cur.updated_at,
      }), isoNow());
  }
  const saved = saveNote({
    id: snap.id, date: snap.date, project: snap.project, title: snap.title,
    content: snap.content, contentHtml: snap.content_html, done: !!snap.done,
    status: snap.status, dueDate: snap.due_date,
    startTime: snap.start_time, finishTime: snap.finish_time, remark: snap.remark,
    contentJson: snap.content_json, rootId: snap.root_id,
  });
  db.prepare('DELETE FROM note_versions WHERE id = ?').run(versionId);
  return saved;
}

module.exports = { deleteNote, listTrash, restoreNote, purgeNote, purgeExpired, noteVersions, restoreVersion };
