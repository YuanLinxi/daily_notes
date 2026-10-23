const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

let db = null;
let dbPath = '';

function init(file) {
  if (db) close();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  dbPath = file;
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate();
}

function close() {
  if (db) {
    try { db.close(); } catch { /* 已关闭 */ }
    db = null;
  }
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_notes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT NOT NULL,
      project       TEXT NOT NULL DEFAULT '',
      title         TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      content_html  TEXT NOT NULL DEFAULT '',
      done          INTEGER NOT NULL DEFAULT 0,
      start_time    TEXT NOT NULL DEFAULT '',
      finish_time   TEXT NOT NULL DEFAULT '',
      remark        TEXT NOT NULL DEFAULT '',
      content_json  TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS snippets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      language    TEXT NOT NULL DEFAULT '',
      title       TEXT NOT NULL DEFAULT '',
      command     TEXT NOT NULL DEFAULT '',
      remark      TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '',
      uses        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_notes_date ON daily_notes(date);
    CREATE INDEX IF NOT EXISTS idx_notes_project ON daily_notes(project);
    CREATE INDEX IF NOT EXISTS idx_snip_tags ON snippets(tags);
  `);
  // 兼容旧库：补齐后续新增字段
  const cols = db.prepare('PRAGMA table_info(daily_notes)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE daily_notes ADD COLUMN ${ddl}`); };
  add('finish_time', "finish_time TEXT NOT NULL DEFAULT ''");
  add('title', "title TEXT NOT NULL DEFAULT ''");
  add('start_time', "start_time TEXT NOT NULL DEFAULT ''");
  add('remark', "remark TEXT NOT NULL DEFAULT ''");
  add('content_html', "content_html TEXT NOT NULL DEFAULT ''");
  add('content_json', "content_json TEXT NOT NULL DEFAULT ''");
  add('deleted_at', "deleted_at TEXT NOT NULL DEFAULT ''");
  add('status', "status TEXT NOT NULL DEFAULT ''");
  add('due_date', "due_date TEXT NOT NULL DEFAULT ''");
  add('root_id', "root_id INTEGER NOT NULL DEFAULT 0");

  // 数据一致性修复：孤儿记录自关联为任务根；done 与 status 同步
  db.exec("UPDATE daily_notes SET root_id = id WHERE root_id = 0 OR root_id IS NULL");
  db.exec("UPDATE daily_notes SET status = 'done' WHERE done = 1 AND status <> 'done'");
  db.exec("UPDATE daily_notes SET status = 'todo' WHERE (status = '' OR status IS NULL) AND done = 0");
  db.exec("UPDATE daily_notes SET done = 1 WHERE status = 'done' AND done = 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS note_versions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id     INTEGER NOT NULL,
      snapshot    TEXT NOT NULL,
      saved_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_versions_note ON note_versions(note_id);
    CREATE TABLE IF NOT EXISTS drafts (
      key   TEXT PRIMARY KEY,
      data  TEXT NOT NULL,
      saved_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL,
      content  TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS saved_filters (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL,
      query    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS projects (
      name     TEXT PRIMARY KEY,
      goal     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_notes_root ON daily_notes(root_id);
  `);

  seedBuiltinTemplates();
}

// 内置模板（幂等：按名称存在即跳过）
function seedBuiltinTemplates() {
  const builtins = [
    ['工作记录', '## 今日目标\n- \n\n## 实际完成\n- \n\n## 遇到的问题\n- \n\n## 下一步\n- '],
    ['问题排查', '## 现象\n\n\n## 环境\n\n\n## 尝试步骤\n- \n\n## 解决方案\n\n\n## 验证结果\n'],
    ['实验记录', '## 目的\n\n\n## 配置\n\n\n## 结果\n\n\n## 结论\n\n\n## 后续实验\n- '],
  ];
  const ins = db.prepare('INSERT INTO templates (name, content) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM templates WHERE name = ?)');
  for (const [name, content] of builtins) ins.run(name, content, name);
}

function isoNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

// ---------- 每日记录 ----------

function mapNote(r) {
  return {
    id: r.id,
    date: r.date,
    project: r.project,
    title: r.title,
    content: r.content,
    contentHtml: r.content_html,
    done: !!r.done,
    status: r.status || (r.done ? 'done' : ''),
    dueDate: r.due_date || '',
    rootId: r.root_id || 0,
    startTime: r.start_time,
    finishTime: r.finish_time,
    remark: r.remark,
    contentJson: r.content_json,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function listNotes(f = {}) {
  const where = [];
  const args = {};
  // 回收站视图：显式传入 trash 才看到已删除记录，其余场景一律排除
  if (f.trash) where.push("deleted_at <> ''");
  else where.push("deleted_at = ''");
  if (f.q) {
    const allowed = { title: 'title', content: 'content', project: 'project', remark: 'remark' };
    const col = allowed[f.field];
    args.q = `%${f.q}%`;
    where.push(col ? `${col} LIKE :q`
      : '(title LIKE :q OR project LIKE :q OR content LIKE :q OR remark LIKE :q OR date LIKE :q)');
  }
  if (f.project) { where.push('project = :project'); args.project = f.project; }
  if (f.status === 'open') where.push("status IN ('todo','doing','blocked')");
  else if (f.status) { where.push('status = :status'); args.status = f.status; }
  if (f.dueBefore) { where.push("due_date <> '' AND due_date <= :dueBefore AND status <> 'done'"); args.dueBefore = f.dueBefore; }
  if (f.dateFrom) { where.push('date >= :dateFrom'); args.dateFrom = f.dateFrom; }
  if (f.dateTo) { where.push('date <= :dateTo'); args.dateTo = f.dateTo; }
  if (f.done === 'done') where.push('done = 1');
  if (f.done === 'todo') where.push('done = 0');

  const sql = `SELECT * FROM daily_notes
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${f.sort === 'oldest' ? 'date ASC, id ASC' : 'date DESC, id DESC'}`;
  return db.prepare(sql).all(args).map(mapNote);
}

function getNote(id) {
  const r = db.prepare('SELECT * FROM daily_notes WHERE id = ?').get(id);
  return r ? mapNote(r) : null;
}

function saveNote(n) {
  const now = isoNow();
  const status = n.status || (n.done ? 'done' : (n.status === undefined ? '' : n.status));
  const done = status === 'done' ? 1 : (n.done ? 1 : 0);
  const values = {
    date: n.date || today(),
    project: n.project || '',
    title: n.title || '',
    content: n.content || '',
    content_html: n.contentHtml || '',
    done,
    status: status || (done ? 'done' : 'todo'),
    due_date: n.dueDate || '',
    root_id: Number(n.rootId) || 0,
    start_time: n.startTime || '',
    finish_time: n.finishTime || '',
    remark: n.remark || '',
    content_json: n.contentJson || '',
  };
  if (n.id) {
    const prev = db.prepare('SELECT * FROM daily_notes WHERE id = ?').get(n.id);
    if (prev && (prev.content !== values.content || prev.title !== values.title ||
        prev.project !== values.project || prev.remark !== values.remark ||
        prev.date !== values.date || prev.content_html !== values.content_html)) {
      db.prepare('INSERT INTO note_versions (note_id, snapshot, saved_at) VALUES (?, ?, ?)')
        .run(n.id, JSON.stringify({ ...prev, deleted_at: undefined }), isoNow());
      // 每条记录最多保留 20 个历史版本
      db.prepare(`DELETE FROM note_versions WHERE note_id = ? AND id NOT IN
        (SELECT id FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 20)`).run(n.id, n.id);
    }
    db.prepare(`UPDATE daily_notes SET date=:date, project=:project, title=:title, content=:content,
      content_html=:content_html, done=:done, status=:status, due_date=:due_date,
      root_id=:root_id,
      start_time=:start_time, finish_time=:finish_time,
      remark=:remark, content_json=:content_json, updated_at=:updated_at WHERE id=:id`)
      .run({ ...values, updated_at: now, id: n.id });
    return getNote(n.id);
  }
  const res = db.prepare(`INSERT INTO daily_notes
      (date, project, title, content, content_html, done, status, due_date, root_id, start_time, finish_time, remark, content_json, created_at, updated_at)
      VALUES (:date, :project, :title, :content, :content_html, :done, :status, :due_date, :root_id, :start_time, :finish_time, :remark, :content_json, :created_at, :updated_at)`)
    .run({ ...values, created_at: now, updated_at: now });
  const id = Number(res.lastInsertRowid);
  // 首条记录自关联为任务根
  if (!values.root_id) db.prepare('UPDATE daily_notes SET root_id = ? WHERE id = ?').run(id, id);
  return getNote(id);
}

// 任务时间线：同一 root_id 的所有记录按日期排列
function taskThread(rootId) {
  const rows = db.prepare(`SELECT * FROM daily_notes
    WHERE root_id = ? AND deleted_at = '' ORDER BY date ASC, id ASC`).all(rootId).map(mapNote);
  const first = rows[0];
  const doneRows = rows.filter((n) => n.status === 'done').length;
  return {
    rootId,
    title: first?.title || '',
    project: first?.project || '',
    status: rows[rows.length - 1]?.status || 'todo',
    dueDate: first?.dueDate || '',
    startedOn: first?.date || '',
    lastActive: rows[rows.length - 1]?.date || '',
    days: [...new Set(rows.map((n) => n.date))].length,
    records: rows,
    allDone: rows.length > 0 && doneRows === rows.length,
  };
}

// 按任务（root 分组）列表：一次看清每件事的推进情况
function listTasks({ project = '', status = '', q = '' } = {}) {
  const roots = db.prepare(`SELECT root_id, MAX(date) AS last_active, MIN(date) AS first_active, COUNT(*) AS records
    FROM daily_notes WHERE deleted_at = '' GROUP BY root_id`).all();
  const out = [];
  for (const r of roots) {
    const t = taskThread(r.root_id);
    if (project && t.project !== project) continue;
    if (status && t.status !== status) continue;
    if (q && !(t.title.includes(q) || t.records.some((x) => x.content.includes(q)))) continue;
    out.push(t);
  }
  out.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
  return out;
}

// ---------- 回收站 / 版本历史 ----------

function deleteNote(id) {
  db.prepare("UPDATE daily_notes SET deleted_at = ? WHERE id = ?").run(isoNow(), id);
  return true;
}

function listTrash() {
  return db.prepare("SELECT * FROM daily_notes WHERE deleted_at <> '' ORDER BY deleted_at DESC").all()
    .map((r) => ({ ...mapNote(r), deletedAt: r.deleted_at }));
}

function restoreNote(id) {
  db.prepare("UPDATE daily_notes SET deleted_at = '' WHERE id = ?").run(id);
  return getNote(id);
}

function purgeNote(id) {
  db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id);
  db.prepare('DELETE FROM daily_notes WHERE id = ?').run(id);
  return true;
}

// 物理删除超过保留期的回收站记录
function purgeExpired(days = 30) {
  const limit = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = db.prepare("SELECT id FROM daily_notes WHERE deleted_at <> '' AND deleted_at < ?").all(limit);
  for (const r of rows) purgeNote(r.id);
  return rows.length;
}

function noteVersions(noteId) {
  return db.prepare('SELECT id, saved_at, snapshot FROM note_versions WHERE note_id = ? ORDER BY id DESC').all(noteId)
    .map((v) => ({ id: v.id, savedAt: v.saved_at, note: JSON.parse(v.snapshot) }));
}

function restoreVersion(versionId) {
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

// ---------- 草稿（崩溃恢复） ----------

function saveDraft(key, data) {
  db.prepare(`INSERT INTO drafts (key, data, saved_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at`)
    .run(key, JSON.stringify(data), isoNow());
  return true;
}

function getDraft(key) {
  const r = db.prepare('SELECT * FROM drafts WHERE key = ?').get(key);
  return r ? { data: JSON.parse(r.data), savedAt: r.saved_at } : null;
}

function clearDraft(key) {
  db.prepare('DELETE FROM drafts WHERE key = ?').run(key);
  return true;
}

function listDrafts() {
  return db.prepare('SELECT key, saved_at FROM drafts ORDER BY saved_at DESC').all();
}

function listProjects() {
  return db.prepare(`SELECT project, COUNT(*) AS count FROM daily_notes
    WHERE project <> '' AND deleted_at = '' GROUP BY project ORDER BY count DESC, project ASC`).all();
}

// ---------- 代码命令记录 ----------

function mapSnippet(r) {
  return {
    id: r.id,
    language: r.language,
    title: r.title,
    command: r.command,
    remark: r.remark,
    tags: r.tags,
    uses: r.uses,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

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
  return db.prepare(sql).all(args).map(mapSnippet);
}

function saveSnippet(s) {
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
  db.prepare('DELETE FROM snippets WHERE id = ?').run(id);
  return true;
}

function useSnippet(id) {
  db.prepare('UPDATE snippets SET uses = uses + 1 WHERE id = ?').run(id);
  return true;
}

// ---------- 回顾可视化 ----------

// 按日聚合记录条数与工时（分钟）
function dailyBuckets(dateFrom, dateTo) {
  const rows = db.prepare(`SELECT date, done, start_time, finish_time FROM daily_notes
    WHERE deleted_at = '' AND date >= ? AND date <= ?`).all(dateFrom, dateTo);
  const map = new Map();
  for (const r of rows) {
    const b = map.get(r.date) || { count: 0, done: 0, minutes: 0 };
    b.count += 1;
    if (r.done) b.done += 1;
    if (r.start_time && r.finish_time) {
      const t1 = new Date(`2000-01-01T${r.start_time}`);
      const t2 = new Date(`2000-01-01T${r.finish_time}`);
      const diff = (t2 - t1) / 60000;
      if (diff > 0) b.minutes += Math.round(diff);
    }
    map.set(r.date, b);
  }
  return map;
}

function heatmap({ year, dateFrom, dateTo } = {}) {
  let from = dateFrom;
  let to = dateTo;
  if (year && !from) {
    from = `${year}-01-01`;
    to = `${year}-12-31`;
  }
  if (!from) {
    const y = new Date().getFullYear();
    from = `${y}-01-01`;
    to = `${y}-12-31`;
  }
  const map = dailyBuckets(from, to);
  const days = [...map.entries()].map(([date, b]) => ({ date, ...b }));
  const hourRows = db.prepare(`SELECT substr(start_time,1,2) AS hour, COUNT(*) AS c FROM daily_notes
    WHERE deleted_at = '' AND date >= ? AND date <= ? AND start_time <> '' GROUP BY hour`).all(from, to);
  return { from, to, days, hours: hourRows };
}

function timeline({ limit = 200, project = '', q = '' } = {}) {
  const where = ["deleted_at = ''"];
  const args = { limit };
  if (project) { where.push('project = :project'); args.project = project; }
  if (q) { where.push('(title LIKE :q OR content LIKE :q OR remark LIKE :q)'); args.q = `%${q}%`; }
  const rows = db.prepare(`SELECT id, date, project, title, content, done, start_time, finish_time, remark
    FROM daily_notes ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY date DESC, id DESC LIMIT :limit`).all(args);
  return rows;
}

// 统计口径：所有新增指标均只统计未删除记录（deleted_at = ''），回收站单独计数
function stats() {
  const live = "deleted_at = ''";
  const total = db.prepare(`SELECT COUNT(*) AS c FROM daily_notes WHERE ${live}`).get().c;
  const done = db.prepare(`SELECT COUNT(*) AS c FROM daily_notes WHERE ${live} AND done = 1`).get().c;
  const activeDays = db.prepare(`SELECT COUNT(DISTINCT date) AS c FROM daily_notes WHERE ${live}`).get().c;
  const earlier = db.prepare(`SELECT COUNT(*) AS c FROM daily_notes WHERE ${live} AND date < date('now','localtime')`).get().c;
  const projects = db.prepare(`SELECT COUNT(DISTINCT project) AS c FROM daily_notes WHERE ${live} AND project <> ''`).get().c;

  // 连续记录天数：从今天（今天无记录则从昨天）起向前连续回溯
  const dates = new Set(db.prepare(`SELECT DISTINCT date FROM daily_notes WHERE ${live} ORDER BY date DESC`).all().map((r) => r.date));
  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const cursor = new Date();
  if (!dates.has(fmt(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(fmt(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    total, done, activeDays, earlier, projects, streak,
    trash: db.prepare("SELECT COUNT(*) AS c FROM daily_notes WHERE deleted_at <> ''").get().c,
    snippets: db.prepare('SELECT COUNT(*) AS c FROM snippets').get().c,
  };
}

// ---------- 设置项 ----------

function getSetting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
  return true;
}

// 整库替换：重新打开目标库并确保表结构完整
function reopen(file) {
  init(file);
  return true;
}

// ---------- 统一搜索：记录 + 命令一起查 ----------

function searchAll(q, limit = 60) {
  if (!q || !q.trim()) return { notes: [], snippets: [] };
  const like = `%${q.trim()}%`;
  const notes = db.prepare(`SELECT id, date, project, title, content, status FROM daily_notes
    WHERE deleted_at = '' AND (title LIKE ? OR content LIKE ? OR remark LIKE ? OR project LIKE ? OR tags LIKE ?)
    ORDER BY date DESC, id DESC LIMIT ?`).all(like, like, like, like, like, limit);
  const snippets = db.prepare(`SELECT id, title, command, language, tags FROM snippets
    WHERE title LIKE ? OR command LIKE ? OR remark LIKE ? OR tags LIKE ? OR language LIKE ?
    ORDER BY uses DESC LIMIT ?`).all(like, like, like, like, like, limit);
  return { notes, snippets };
}

// 命中片段：前后各取一段便于预览
function snippetAround(text, q, width = 40) {
  const i = (text || '').indexOf(q);
  if (i < 0) return text.slice(0, width * 2);
  const start = Math.max(0, i - width);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + width) + (i + q.length + width < text.length ? '…' : '');
}

// ---------- 记录模板 ----------

function listTemplates() {
  return db.prepare('SELECT * FROM templates ORDER BY name').all();
}

function saveTemplate(t) {
  if (t.id) {
    db.prepare('UPDATE templates SET name=?, content=? WHERE id=?').run(t.name, t.content, t.id);
    return db.prepare('SELECT * FROM templates WHERE id=?').get(t.id);
  }
  const res = db.prepare('INSERT INTO templates (name, content) VALUES (?, ?)').run(t.name, t.content || '');
  return db.prepare('SELECT * FROM templates WHERE id=?').get(Number(res.lastInsertRowid));
}

function deleteTemplate(id) {
  db.prepare('DELETE FROM templates WHERE id=?').run(id);
  return true;
}

// 模板变量：{{date}} {{project}} {{time}} {{week}}
function renderTemplate(content) {
  const d = new Date();
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return (content || '')
    .replace(/\{\{\s*date\s*\}\}/g, today())
    .replace(/\{\{\s*time\s*\}\}/g, isoNow().slice(11, 16))
    .replace(/\{\{\s*week\s*\}\}/g, '周' + wd)
    .replace(/\{\{\s*project\s*\}\}/g, '');
}

// ---------- 保存的筛选 ----------

function listSavedFilters() {
  return db.prepare('SELECT * FROM saved_filters ORDER BY id DESC').all();
}

function saveSavedFilter(f) {
  if (f.id) {
    db.prepare('UPDATE saved_filters SET name=?, query=? WHERE id=?').run(f.name, f.query, f.id);
    return { id: f.id, name: f.name, query: f.query };
  }
  const res = db.prepare('INSERT INTO saved_filters (name, query) VALUES (?, ?)').run(f.name, f.query || '{}');
  return { id: Number(res.lastInsertRowid), name: f.name, query: f.query || '{}' };
}

function deleteSavedFilter(id) {
  db.prepare('DELETE FROM saved_filters WHERE id=?').run(id);
  return true;
}

// ---------- 项目主页 ----------

function getProjectPage(name) {
  const meta = db.prepare('SELECT * FROM projects WHERE name=?').get(name);
  const notes = db.prepare(`SELECT * FROM daily_notes
    WHERE project=? AND deleted_at='' ORDER BY date DESC, id DESC LIMIT 200`).all(name).map(mapNote);
  const openTasks = notes.filter((n) => ['todo', 'doing', 'blocked'].includes(n.status));
  const snippets = db.prepare(`SELECT * FROM snippets WHERE title LIKE ? OR remark LIKE ?
    ORDER BY uses DESC LIMIT 20`).all(`%${name}%`, `%${name}%`);
  return {
    name,
    goal: meta?.goal || '',
    notes,
    openTasks,
    stats: {
      total: notes.length,
      done: notes.filter((n) => n.status === 'done').length,
      overdue: openTasks.filter((n) => n.dueDate && n.dueDate < today()).length,
      activeDays: new Set(notes.map((n) => n.date)).size,
    },
    snippets,
  };
}

function setProjectGoal(name, goal) {
  db.prepare(`INSERT INTO projects (name, goal) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET goal = excluded.goal`).run(name, goal || '');
  return true;
}

// ---------- 周报 ----------

// 汇总某一周（默认本周一~今天）各项目的成果、未完成与下周计划（未完成的顺延）
function weeklyReport(weekStart) {
  const start = weekStart || (() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // 周一为 0
    d.setDate(d.getDate() - day);
    return today(d);
  })();
  const endDate = (() => {
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return today(d);
  })();
  const notes = db.prepare(`SELECT * FROM daily_notes
    WHERE deleted_at='' AND date>=? AND date<=? ORDER BY date ASC, id ASC`).all(start, endDate).map(mapNote);

  const byProject = new Map();
  for (const n of notes) {
    const key = n.project || '未分项目';
    if (!byProject.has(key)) byProject.set(key, { done: [], open: [] });
    const g = byProject.get(key);
    if (n.status === 'done') g.done.push(n);
    else if (['todo', 'doing', 'blocked'].includes(n.status)) g.open.push(n);
  }
  return {
    start, endDate,
    projects: [...byProject.entries()].map(([name, g]) => ({
      name,
      doneItems: g.done.map((n) => ({ date: n.date, title: n.title || summarizeLine(n.content), remark: n.remark, id: n.id, rootId: n.root_id })),
      openItems: g.open.map((n) => ({ title: n.title || summarizeLine(n.content), status: n.status, dueDate: n.due_date, id: n.id, rootId: n.root_id })),
    })),
    totals: { records: notes.length, done: notes.filter((n) => n.status === 'done').length },
  };
}

function summarizeLine(text) {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
}

// ---------- 通用导出：Markdown ----------

function exportMarkdown({ dateFrom = '', dateTo = '', project = '' } = {}) {
  const where = ["deleted_at = ''"];
  const args = [];
  if (dateFrom) { where.push('date >= ?'); args.push(dateFrom); }
  if (dateTo) { where.push('date <= ?'); args.push(dateTo); }
  if (project) { where.push('project = ?'); args.push(project); }
  const notes = db.prepare(`SELECT * FROM daily_notes WHERE ${where.join(' AND ')} ORDER BY date ASC, id ASC`).all(...args);

  const md = [];
  md.push('# Daily Notes 导出');
  md.push('');
  md.push(`> 导出时间：${isoNow()}　范围：${dateFrom || '最早'} ~ ${dateTo || '最新'}${project ? `　项目：${project}` : ''}`);
  md.push('');
  let lastDate = '';
  for (const n of notes) {
    if (n.date !== lastDate) {
      lastDate = n.date;
      md.push(`## ${n.date}`);
      md.push('');
    }
    const statusText = { done: '已完成', doing: '进行中', blocked: '受阻', todo: '待办' }[n.status] || '';
    md.push(`### ${n.title || '(无标题)'}${n.project ? ` ｜ ${n.project}` : ''}${statusText ? ` ｜ ${statusText}` : ''}`);
    const times = [n.start_time && `开始 ${n.start_time}`, n.finish_time && `完成 ${n.finish_time}`].filter(Boolean).join(' · ');
    const metaLine = [times, n.due_date && `截止 ${n.due_date}`, n.remark && `备注：${n.remark}`].filter(Boolean).join('　');
    if (metaLine) md.push(`*${metaLine}*`);
    md.push('');
    md.push(n.content || '(无正文)');
    md.push('');
  }
  return md.join('\n');
}

// HTML 导出（可打印为 PDF）
function exportHtml({ dateFrom = '', dateTo = '', project = '' } = {}) {
  const markdown = exportMarkdown({ dateFrom, dateTo, project });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const body = markdown.split('\n').map((line) => {
    if (line.startsWith('### ')) return `<h3>${esc(line.slice(4))}</h3>`;
    if (line.startsWith('## ')) return `<h2>${esc(line.slice(3))}</h2>`;
    if (line.startsWith('# ')) return `<h1>${esc(line.slice(2))}</h1>`;
    if (line.startsWith('> ')) return `<p class="meta">${esc(line.slice(2))}</p>`;
    if (line.startsWith('*') && line.endsWith('*')) return `<p class="meta">${esc(line.slice(1, -1))}</p>`;
    if (!line.trim()) return '';
    return `<p>${esc(line)}</p>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>Daily Notes 导出</title>
<style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#1c1b19;line-height:1.7}
h1{border-bottom:2px solid #b08d57;padding-bottom:8px}h2{margin-top:32px;color:#7d5f35}h3{margin-bottom:4px}
.meta{color:#8d877d;font-size:13px}p{white-space:pre-wrap;margin:6px 0}</style></head><body>${body}</body></html>`;
}

module.exports = {
  init, close, reopen,
  raw: () => db,
  path: () => dbPath,
  listNotes, getNote, saveNote, deleteNote, listProjects,
  taskThread, listTasks,
  listTrash, restoreNote, purgeNote, purgeExpired, noteVersions, restoreVersion,
  saveDraft, getDraft, clearDraft, listDrafts,
  getSetting, setSetting,
  listSnippets, saveSnippet, deleteSnippet, useSnippet,
  heatmap, timeline, stats,
  searchAll, snippetAround,
  listTemplates, saveTemplate, deleteTemplate, renderTemplate,
  listSavedFilters, saveSavedFilter, deleteSavedFilter,
  getProjectPage, setProjectGoal,
  weeklyReport,
  exportMarkdown, exportHtml,
  getDbPath: () => dbPath,
};
