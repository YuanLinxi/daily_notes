// 项目主页
const { getDb } = require('./connection');
const { mapNote, today } = require('./util');

function getProjectPage(name) {
  const db = getDb();
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
  getDb().prepare(`INSERT INTO projects (name, goal) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET goal = excluded.goal`).run(name, goal || '');
  return true;
}

module.exports = { getProjectPage, setProjectGoal };
