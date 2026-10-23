// 周报：按项目汇总本周成果与未完成事项（基于对象模型）
const obj = require('./objects');
const { summarizeLine, today } = require('./util');

// 汇总某一周（默认本周一~周日）各项目的成果、未完成与下周计划
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

  const notes = obj.listWithValues('note')
    .map((o) => ({
      id: o.id,
      title: o.title || '',
      date: o.values.date || '',
      project: o.values.project || '',
      content: o.values.content || '',
      status: o.values.status || 'todo',
      dueDate: o.values.due_date || '',
      remark: o.values.remark || '',
      rootId: Number(o.values.root_id) || o.id,
    }))
    .filter((n) => n.date >= start && n.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

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
      doneItems: g.done.map((n) => ({ date: n.date, title: n.title || summarizeLine(n.content), remark: n.remark, id: n.id, rootId: n.rootId })),
      openItems: g.open.map((n) => ({ title: n.title || summarizeLine(n.content), status: n.status, dueDate: n.dueDate, id: n.id, rootId: n.rootId })),
    })),
    totals: { records: notes.length, done: notes.filter((n) => n.status === 'done').length },
  };
}

module.exports = { weeklyReport };
