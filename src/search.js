// 统一搜索：记录与命令一起查
const { getDb } = require('./connection');

function searchAll(q, limit = 60) {
  const db = getDb();
  if (!q || !q.trim()) return { notes: [], snippets: [] };
  const like = `%${q.trim()}%`;
  const notes = db.prepare(`SELECT id, date, project, title, content, status FROM daily_notes
    WHERE deleted_at = '' AND (title LIKE ? OR content LIKE ? OR remark LIKE ? OR project LIKE ?)
    ORDER BY date DESC, id DESC LIMIT ?`).all(like, like, like, like, limit);
  const snippets = db.prepare(`SELECT id, title, command, language, tags FROM snippets
    WHERE title LIKE ? OR command LIKE ? OR remark LIKE ? OR tags LIKE ? OR language LIKE ?
    ORDER BY uses DESC LIMIT ?`).all(like, like, like, like, like, limit);
  return { notes, snippets };
}

module.exports = { searchAll };
