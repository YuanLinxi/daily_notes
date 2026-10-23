// 代码命令记录：基于对象模型
const obj = require('./objects');
const { isoNow } = require('./util');

function toSnippet(o) {
  const v = o.values || {};
  return {
    id: o.id,
    language: v.language || '',
    title: o.title || '',
    command: v.command || '',
    remark: v.remark || '',
    tags: v.tags || '',
    uses: Number(v.uses) || 0,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

const SNIPPET_KEYS = ['language', 'command', 'remark', 'tags', 'uses'];

function listSnippets(f = {}) {
  const q = (f.q || '').trim().toLowerCase();
  return obj.listWithValues('snippet')
    .filter((o) => {
      const v = o.values;
      if (f.language && (v.language || '') !== f.language) return false;
      if (!q) return true;
      return obj.likeMatch({ ...v, title: o.title }, ['title', 'command', 'remark', 'tags', 'language'], q);
    })
    .map(toSnippet)
    .sort((a, b) => (b.uses - a.uses) || b.updatedAt.localeCompare(a.updatedAt));
}

function saveSnippet(s) {
  const now = isoNow();
  const values = {
    language: s.language || '',
    command: s.command || '',
    remark: s.remark || '',
    tags: s.tags || '',
  };
  if (s.id) {
    obj.updateObject(s.id, { title: s.title || '', updatedAt: now });
    for (const k of SNIPPET_KEYS) obj.setValue(s.id, k, values[k] || '');
    return toSnippet({ ...obj.getObject(s.id), values: obj.getValues(s.id) });
  }
  const id = obj.createObject({ typeKey: 'snippet', title: s.title || '', createdAt: now, updatedAt: now });
  for (const k of SNIPPET_KEYS) if (values[k]) obj.setValue(id, k, values[k]);
  obj.setValue(id, 'uses', '0');
  return toSnippet({ ...obj.getObject(id), values: obj.getValues(id) });
}

function deleteSnippet(id) {
  return obj.deleteObjectPermanently(id);
}

function useSnippet(id) {
  const o = obj.getObject(id);
  if (!o) return true;
  const cur = Number(obj.getValues(id).uses) || 0;
  obj.setValue(id, 'uses', String(cur + 1));
  return true;
}

module.exports = { listSnippets, saveSnippet, deleteSnippet, useSnippet, toSnippet };
