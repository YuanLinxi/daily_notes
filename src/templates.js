// 记录模板
const { getDb } = require('./connection');
const { isoNow, today } = require('./util');

function listTemplates() {
  return getDb().prepare('SELECT * FROM templates ORDER BY name').all();
}

function saveTemplate(t) {
  const db = getDb();
  if (t.id) {
    db.prepare('UPDATE templates SET name=?, content=? WHERE id=?').run(t.name, t.content, t.id);
    return db.prepare('SELECT * FROM templates WHERE id=?').get(t.id);
  }
  const res = db.prepare('INSERT INTO templates (name, content) VALUES (?, ?)').run(t.name, t.content || '');
  return db.prepare('SELECT * FROM templates WHERE id=?').get(Number(res.lastInsertRowid));
}

function deleteTemplate(id) {
  getDb().prepare('DELETE FROM templates WHERE id=?').run(id);
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

module.exports = { listTemplates, saveTemplate, deleteTemplate, renderTemplate };
