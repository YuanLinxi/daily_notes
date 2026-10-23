// 项目主页：基于对象模型（project 对象的 goal 为属性，记录归属用 project 属性的文本值）
const { getDb } = require('./connection');
const obj = require('./objects');
const { listNotes } = require('./notes');
const { today } = require('./util');

function projectObjectByName(name) {
  return obj.listWithValues('project').find((o) => o.title === name) || null;
}

function getProjectPage(name) {
  const meta = projectObjectByName(name);

  // 复用 listNotes 的完整字段结构，保证与对象化前的返回一致
  const notes = listNotes({ project: name }).slice(0, 200);

  const openTasks = notes.filter((n) => ['todo', 'doing', 'blocked'].includes(n.status));

  const needle = name.toLowerCase();
  const snippets = obj.listWithValues('snippet')
    .filter((o) => (o.title || '').toLowerCase().includes(needle)
      || (o.values.remark || '').toLowerCase().includes(needle))
    .map((o) => ({
      id: o.id,
      title: o.title || '',
      command: o.values.command || '',
      language: o.values.language || '',
      remark: o.values.remark || '',
      uses: Number(o.values.uses) || 0,
    }))
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 20);

  return {
    name,
    goal: meta?.values.goal || '',
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
  const existing = projectObjectByName(name);
  if (existing) {
    obj.setValue(existing.id, 'goal', goal || '');
    obj.updateObject(existing.id, { updatedAt: undefined });
    return true;
  }
  const row = getDb().prepare("INSERT INTO objects (type_key, title) VALUES ('project', ?)").run(name);
  obj.setValue(Number(row.lastInsertRowid), 'goal', goal || '');
  return true;
}

module.exports = { getProjectPage, setProjectGoal };
