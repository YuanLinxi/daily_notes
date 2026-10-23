// 通用对象访问层：objects（内容）+ relations（属性定义）+ values（属性值）
// 所有业务模块通过这里读写数据，避免各自拼 SQL
const { getDb } = require('./connection');
const { isoNow } = require('./util');

const noteId = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);

// ---------- 对象 ----------

function createObject({ typeKey, title = '', createdAt, updatedAt, deletedAt = '' }) {
  const now = isoNow();
  const res = getDb()
    .prepare('INSERT INTO objects (type_key, title, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)')
    .run(typeKey, title || '', createdAt || now, updatedAt || now, deletedAt || '');
  return Number(res.lastInsertRowid);
}

// 保留指定 id 插入（迁移与快照恢复用）
function insertObjectWithId({ id, typeKey, title = '', createdAt, updatedAt, deletedAt = '' }) {
  getDb()
    .prepare('INSERT OR REPLACE INTO objects (id, type_key, title, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, typeKey, title || '', createdAt || isoNow(), updatedAt || isoNow(), deletedAt || '');
  return id;
}

function updateObject(id, { title, updatedAt, deletedAt }) {
  const sets = [];
  const args = [];
  if (title !== undefined) { sets.push('title = ?'); args.push(title || ''); }
  if (updatedAt !== undefined) { sets.push('updated_at = ?'); args.push(updatedAt || isoNow()); }
  if (deletedAt !== undefined) { sets.push('deleted_at = ?'); args.push(deletedAt || ''); }
  if (!sets.length) return getObject(id);
  args.push(id);
  getDb().prepare(`UPDATE objects SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return getObject(id);
}

function getObject(id) {
  return getDb().prepare('SELECT * FROM objects WHERE id = ?').get(noteId(id)) || null;
}

function deleteObjectPermanently(id) {
  const db = getDb();
  db.prepare('DELETE FROM prop_values WHERE object_id = ?').run(noteId(id));
  db.prepare('DELETE FROM objects WHERE id = ?').run(noteId(id));
  return true;
}

// ---------- 属性值 ----------

function getValues(objectId) {
  const rows = getDb().prepare('SELECT relation_key, value FROM prop_values WHERE object_id = ?').all(noteId(objectId));
  const map = {};
  for (const r of rows) map[r.relation_key] = r.value;
  return map;
}

// 批量取多个对象的值：一次查询，避免 N+1
function getValuesBatch(objectIds) {
  const ids = objectIds.filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT object_id, relation_key, value FROM prop_values WHERE object_id IN (${placeholders})`)
    .all(...ids);
  for (const r of rows) {
    if (!out.has(r.object_id)) out.set(r.object_id, {});
    out.get(r.object_id)[r.relation_key] = r.value;
  }
  return out;
}

function setValue(objectId, key, value) {
  const db = getDb();
  if (value === null || value === undefined || value === '') {
    db.prepare('DELETE FROM prop_values WHERE object_id = ? AND relation_key = ?').run(noteId(objectId), key);
    return;
  }
  db.prepare(`INSERT INTO prop_values (object_id, relation_key, value) VALUES (?, ?, ?)
    ON CONFLICT(object_id, relation_key) DO UPDATE SET value = excluded.value`)
    .run(noteId(objectId), key, String(value));
}

// 整体写入属性（未出现在 values 中的内置属性会被清空）
function setValues(objectId, values) {
  for (const [k, v] of Object.entries(values)) setValue(objectId, k, v);
}

function clearValues(objectId) {
  getDb().prepare('DELETE FROM prop_values WHERE object_id = ?').run(noteId(objectId));
}

// ---------- 查询 ----------

// 按类型查询对象，支持条件过滤（在应用层组合，避免复杂 SQL）
function queryObjects(typeKey, { includeDeleted = false, deletedOnly = false } = {}) {
  let sql = 'SELECT * FROM objects WHERE type_key = ?';
  if (deletedOnly) sql += " AND deleted_at <> ''";
  else if (!includeDeleted) sql += " AND deleted_at = ''";
  return getDb().prepare(sql).all(typeKey);
}

// 一次性取回「对象 + 属性值」的完整列表
function listWithValues(typeKey, opts = {}) {
  const objects = queryObjects(typeKey, opts);
  const valuesMap = getValuesBatch(objects.map((o) => o.id));
  return objects.map((o) => ({ ...o, values: valuesMap.get(o.id) || {} }));
}

// 按属性查询：返回符合 condition 的对象（应用层过滤）
function filterByValues(list, predicate) {
  return list.filter((o) => predicate(o.values || {}));
}

// 属性 LIKE 搜索
function likeMatch(values, keys, q) {
  const needle = q.toLowerCase();
  return keys.some((k) => (values[k] || '').toLowerCase().includes(needle));
}

// ---------- 属性定义 ----------

function listRelations() {
  return getDb().prepare('SELECT * FROM relations ORDER BY sort_order, key').all()
    .map((r) => ({ ...r, options: safeParse(r.options) }));
}

function getRelation(key) {
  const r = getDb().prepare('SELECT * FROM relations WHERE key = ?').get(key);
  return r ? { ...r, options: safeParse(r.options) } : null;
}

function saveRelation({ key, name, type = 'text', format = '', options = [], builtin = 0, sortOrder = 999 }) {
  getDb().prepare(`INSERT INTO relations (key, name, type, format, options, builtin, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET name = excluded.name, type = excluded.type,
      format = excluded.format, options = excluded.options, sort_order = excluded.sort_order`)
    .run(key, name || key, type, format, JSON.stringify(options || []), builtin ? 1 : 0, sortOrder);
  return getRelation(key);
}

function safeParse(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

// ---------- 统计辅助 ----------

function countByValue(typeKey, relationKey) {
  const db = getDb();
  return db.prepare(`SELECT v.value AS value, COUNT(*) AS count FROM objects o
    JOIN prop_values v ON v.object_id = o.id
    WHERE o.type_key = ? AND o.deleted_at = '' AND v.relation_key = ? AND v.value <> ''
    GROUP BY v.value ORDER BY count DESC, value ASC`).all(typeKey, relationKey);
}

module.exports = {
  createObject, insertObjectWithId, updateObject, getObject, deleteObjectPermanently,
  getValues, getValuesBatch, setValue, setValues, clearValues,
  queryObjects, listWithValues, filterByValues, likeMatch,
  listRelations, getRelation, saveRelation,
  countByValue,
};
