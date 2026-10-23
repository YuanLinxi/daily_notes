// 统一搜索：记录与命令一起查（基于对象模型）
const obj = require('./objects');

function searchAll(q, limit = 60) {
  if (!q || !q.trim()) return { notes: [], snippets: [] };
  const needle = q.trim().toLowerCase();

  const notes = obj.listWithValues('note')
    .filter((o) => obj.likeMatch({ ...o.values, title: o.title }, ['title', 'content', 'remark', 'project'], needle))
    .map((o) => ({
      id: o.id,
      date: o.values.date || '',
      project: o.values.project || '',
      title: o.title || '',
      content: o.values.content || '',
      status: o.values.status || 'todo',
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, limit);

  const snippets = obj.listWithValues('snippet')
    .filter((o) => obj.likeMatch({ ...o.values, title: o.title }, ['title', 'command', 'remark', 'tags', 'language'], needle))
    .map((o) => ({
      id: o.id,
      title: o.title || '',
      command: o.values.command || '',
      language: o.values.language || '',
      tags: o.values.tags || '',
      uses: Number(o.values.uses) || 0,
    }))
    .sort((a, b) => b.uses - a.uses)
    .slice(0, limit);

  return { notes, snippets };
}

module.exports = { searchAll };
