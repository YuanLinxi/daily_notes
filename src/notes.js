// 每日记录：CRUD、任务线程、项目列表
const { getDb } = require('./connection');
const { isoNow, today, mapNote } = require('./util');

function listNotes(f = {}) {
  const db = getDb();
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
  const r = getDb().prepare('SELECT * FROM daily_notes WHERE id = ?').get(id);
  return r ? mapNote(r) : null;
}

function saveNote(n) {
  const db = getDb();
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
  const rows = getDb().prepare(`SELECT * FROM daily_notes
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
  const roots = getDb().prepare(`SELECT root_id, MAX(date) AS last_active, MIN(date) AS first_active, COUNT(*) AS records
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

function listProjects() {
  return getDb().prepare(`SELECT project, COUNT(*) AS count FROM daily_notes
    WHERE project <> '' AND deleted_at = '' GROUP BY project ORDER BY count DESC, project ASC`).all();
}

module.exports = { listNotes, getNote, saveNote, taskThread, listTasks, listProjects };
