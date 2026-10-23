// 每日记录：基于对象模型的 CRUD、任务线程、项目列表
// 对外返回结构与对象化前完全一致（camelCase 字段名）
const { getDb } = require('./connection');
const { isoNow, today } = require('./util');
const obj = require('./objects');

// 记录对象 → 对外的 camelCase 结构
function toNote(o) {
  const v = o.values || {};
  const status = v.status || 'todo';
  return {
    id: o.id,
    date: v.date || '',
    project: v.project || '',
    title: o.title || '',
    content: v.content || '',
    contentHtml: v.content_html || '',
    done: status === 'done',
    status,
    dueDate: v.due_date || '',
    rootId: Number(v.root_id) || 0,
    startTime: v.start_time || '',
    finishTime: v.finish_time || '',
    remark: v.remark || '',
    contentJson: v.content_json || '',
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

const NOTE_KEYS = ['date', 'project', 'content', 'content_html', 'content_json',
  'status', 'due_date', 'start_time', 'finish_time', 'remark', 'root_id'];

function noteValues(n) {
  const status = n.status || (n.done ? 'done' : 'todo');
  return {
    date: n.date || today(),
    project: n.project || '',
    content: n.content || '',
    content_html: n.contentHtml || '',
    content_json: n.contentJson || '',
    status,
    due_date: n.dueDate || '',
    start_time: n.startTime || '',
    finish_time: n.finishTime || '',
    remark: n.remark || '',
    root_id: String(Number(n.rootId) || 0),
  };
}

function listNotes(f = {}) {
  const all = obj.listWithValues('note', { deletedOnly: !!f.trash });
  const q = (f.q || '').trim().toLowerCase();
  const allowed = { title: 'title', content: 'content', project: 'project', remark: 'remark' };
  const field = allowed[f.field];

  const filtered = all.filter((o) => {
    const v = o.values;
    const status = v.status || 'todo';
    if (q) {
      const hit = field
        ? field === 'title'
          ? (o.title || '').toLowerCase().includes(q)
          : (v[field] || '').toLowerCase().includes(q)
        : obj.likeMatch({ ...v, title: o.title }, ['title', 'project', 'content', 'remark', 'date'], q);
      if (!hit) return false;
    }
    if (f.project && (v.project || '') !== f.project) return false;
    if (f.status === 'open' && !['todo', 'doing', 'blocked'].includes(status)) return false;
    if (f.status && f.status !== 'open' && status !== f.status) return false;
    if (f.dueBefore && !((v.due_date || '') && v.due_date <= f.dueBefore && status !== 'done')) return false;
    if (f.dateFrom && (v.date || '') < f.dateFrom) return false;
    if (f.dateTo && (v.date || '') > f.dateTo) return false;
    if (f.done === 'done' && status !== 'done') return false;
    if (f.done === 'todo' && status === 'done') return false;
    return true;
  });

  const mapped = filtered.map(toNote);
  mapped.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date) || a.id - b.id;
    return f.sort === 'oldest' ? cmp : -cmp;
  });
  return mapped;
}

function getNote(id) {
  const o = obj.getObject(id);
  if (!o || o.type_key !== 'note') return null;
  return toNote({ ...o, values: obj.getValues(o.id) });
}

function saveNote(n) {
  const now = isoNow();
  const values = noteValues(n);
  // 首条记录自关联为任务根
  if (!Number(values.root_id)) values.root_id = '';

  if (n.id) {
    const prev = obj.getObject(n.id);
    if (!prev) return null;
    const before = obj.getValues(n.id);
    const changed = ['content', 'project', 'remark', 'date', 'content_html'].some((k) => (before[k] || '') !== values[k])
      || (prev.title || '') !== (n.title || '');
    if (changed) {
      getDb().prepare('INSERT INTO note_versions (note_id, snapshot, saved_at) VALUES (?, ?, ?)')
        .run(n.id, JSON.stringify({ ...serializeSnapshot(prev, before) }), isoNow());
      // 每条记录最多保留 20 个历史版本
      getDb().prepare(`DELETE FROM note_versions WHERE note_id = ? AND id NOT IN
        (SELECT id FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 20)`).run(n.id, n.id);
    }
    obj.updateObject(n.id, { title: n.title || '', updatedAt: now });
    obj.setValues(n.id, values);
    // 更新时必须清掉空值（setValue 对空串即删除）
    for (const k of NOTE_KEYS) if (!values[k]) obj.setValue(n.id, k, '');
    return getNote(n.id);
  }

  const id = obj.createObject({ typeKey: 'note', title: n.title || '', createdAt: now, updatedAt: now });
  obj.setValues(id, values);
  for (const k of NOTE_KEYS) if (!values[k]) obj.setValue(id, k, '');
  if (!Number(n.rootId)) obj.setValue(id, 'root_id', String(id));
  return getNote(id);
}

// 版本快照以旧扁平结构存储，恢复时按列名回填
function serializeSnapshot(o, v) {
  return {
    id: o.id, date: v.date || '', project: v.project || '', title: o.title || '',
    content: v.content || '', content_html: v.content_html || '', done: (v.status || '') === 'done' ? 1 : 0,
    status: v.status || 'todo', due_date: v.due_date || '',
    start_time: v.start_time || '', finish_time: v.finish_time || '',
    remark: v.remark || '', content_json: v.content_json || '',
    root_id: Number(v.root_id) || o.id,
    created_at: o.created_at, updated_at: o.updated_at,
  };
}

// 任务时间线：同一 root_id 的所有记录按日期排列
function taskThread(rootId) {
  const rows = listNotes({}).filter((n) => (n.rootId || n.id) === Number(rootId));
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
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

// 按任务（root 分组）列表
function listTasks({ project = '', status = '', q = '' } = {}) {
  const notes = listNotes({});
  const roots = [...new Set(notes.map((n) => n.rootId || n.id))];
  const out = [];
  for (const r of roots) {
    const t = taskThread(r);
    if (project && t.project !== project) continue;
    if (status && t.status !== status) continue;
    if (q && !(t.title.includes(q) || t.records.some((x) => x.content.includes(q)))) continue;
    out.push(t);
  }
  // 最近活动倒序；同日按 root 升序（与旧 GROUP BY 顺序一致）
  out.sort((a, b) => b.lastActive.localeCompare(a.lastActive) || a.rootId - b.rootId);
  return out;
}

// 对外保持 { project, count } 结构，与对象化前一致
function listProjects() {
  return obj.countByValue('note', 'project').map((r) => ({ project: r.value, count: r.count }));
}

module.exports = { listNotes, getNote, saveNote, taskThread, listTasks, listProjects, toNote, noteValues, NOTE_KEYS };
