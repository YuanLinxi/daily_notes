// 代码命令记录
const { getDb } = require('./connection');
const { isoNow, mapSnippet } = require('./util');

function listSnippets(f = {}) {
  const where = [];
  const args = {};
  if (f.q) {
    where.push('(title LIKE :q OR command LIKE :q OR remark LIKE :q OR tags LIKE :q OR language LIKE :q)');
    args.q = `%${f.q}%`;
  }
  if (f.language) { where.push('language = :language'); args.language = f.language; }
  const sql = `SELECT * FROM snippets ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY uses DESC, updated_at DESC`;
  return getDb().prepare(sql).all(args).map(mapSnippet);
}

function saveSnippet(s) {
  const db = getDb();
  const now = isoNow();
  const values = {
    language: s.language || '',
    title: s.title || '',
    command: s.command || '',
    remark: s.remark || '',
    tags: s.tags || '',
  };
  if (s.id) {
    db.prepare(`UPDATE snippets SET language=:language, title=:title, command=:command,
      remark=:remark, tags=:tags, updated_at=:updated_at WHERE id=:id`)
      .run({ ...values, updated_at: now, id: s.id });
    return mapSnippet(db.prepare('SELECT * FROM snippets WHERE id = ?').get(s.id));
  }
  const res = db.prepare(`INSERT INTO snippets (language, title, command, remark, tags, created_at, updated_at)
    VALUES (:language, :title, :command, :remark, :tags, :created_at, :updated_at)`)
    .run({ ...values, created_at: now, updated_at: now });
  return mapSnippet(db.prepare('SELECT * FROM snippets WHERE id = ?').get(Number(res.lastInsertRowid)));
}

function deleteSnippet(id) {
  getDb().prepare('DELETE FROM snippets WHERE id = ?').run(id);
  return true;
}

function useSnippet(id) {
  getDb().prepare('UPDATE snippets SET uses = uses + 1 WHERE id = ?').run(id);
  return true;
}

module.exports = { listSnippets, saveSnippet, deleteSnippet, useSnippet };
