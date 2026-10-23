// 数据导出 / 导入：应用内 JSON 交换格式，以及整库 SQLite 快照
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT = 'daily-notes';
const VERSION = 2;

const noteCols = ['date', 'project', 'title', 'content', 'content_html', 'done', 'status',
  'due_date', 'root_id', 'start_time', 'finish_time', 'remark', 'content_json',
  'created_at', 'updated_at', 'deleted_at'];
const snippetCols = ['language', 'title', 'command', 'remark', 'tags', 'uses', 'created_at', 'updated_at'];

// 内容指纹：同一软件导出的数据在任何机器上都得到相同指纹，用于导入去重
const noteSig = (r) => crypto.createHash('sha1')
  .update([r.date, r.project, r.title, r.content, r.start_time, r.finish_time, r.remark].join('\u0001'))
  .digest('hex');
const snippetSig = (r) => crypto.createHash('sha1')
  .update([r.title, r.command].join('\u0001')).digest('hex');

function toNoteDto(r) {
  return {
    date: r.date, project: r.project, title: r.title, content: r.content,
    contentHtml: r.content_html, done: !!r.done, startTime: r.start_time,
    finishTime: r.finish_time, remark: r.remark, contentJson: r.content_json,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toSnippetDto(r) {
  return {
    language: r.language, title: r.title, command: r.command, remark: r.remark,
    tags: r.tags, uses: r.uses, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function readAll(db) {
  const objects = db.prepare('SELECT * FROM objects ORDER BY id').all();
  const byObject = new Map();
  for (const v of db.prepare('SELECT * FROM prop_values').all()) {
    if (!byObject.has(v.object_id)) byObject.set(v.object_id, {});
    byObject.get(v.object_id)[v.relation_key] = v.value;
  }
  return objects.map((o) => ({ ...o, v: byObject.get(o.id) || {} }));
}

function createPackage(db) {
  const all = readAll(db);
  const notes = all.filter((o) => o.type_key === 'note');
  const snippets = all.filter((o) => o.type_key === 'snippet');
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    stats: { notes: notes.length, snippets: snippets.length },
    notes: notes.map((o) => toNoteDto({
      date: o.v.date || '', project: o.v.project || '', title: o.title || '', content: o.v.content || '',
      content_html: o.v.content_html || '', done: (o.v.status || '') === 'done' ? 1 : 0,
      start_time: o.v.start_time || '', finish_time: o.v.finish_time || '', remark: o.v.remark || '',
      content_json: o.v.content_json || '', created_at: o.created_at, updated_at: o.updated_at,
    })),
    snippets: snippets.map((o) => toSnippetDto({
      language: o.v.language || '', title: o.title || '', command: o.v.command || '',
      remark: o.v.remark || '', tags: o.v.tags || '', uses: Number(o.v.uses) || 0,
      created_at: o.created_at, updated_at: o.updated_at,
    })),
  };
}

function exportJson(db, file) {
  const data = createPackage(db);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return { file, ...data.stats };
}

// 读取并校验外部 JSON 包，返回可供预览的数据
function readPackage(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.format !== FORMAT || !Array.isArray(data.notes) || !Array.isArray(data.snippets)) {
    throw new Error('不是 Daily Notes 导出的数据文件');
  }
  if (Number(data.version) > VERSION) {
    throw new Error(`数据版本 ${data.version} 高于当前软件支持的版本 ${VERSION}，请先升级软件`);
  }
  return data;
}

// 合并导入：按内容指纹去重，已存在则跳过，不改动本机已有记录
function importJson(db, data) {
  const all = readAll(db);
  const existingNotes = new Set(all.filter((o) => o.type_key === 'note').map((o) => noteSig({
    date: o.v.date || '', project: o.v.project || '', title: o.title || '', content: o.v.content || '',
    start_time: o.v.start_time || '', finish_time: o.v.finish_time || '', remark: o.v.remark || '',
  })));
  const existingSnippets = new Set(all.filter((o) => o.type_key === 'snippet').map((o) => snippetSig({
    title: o.title || '', command: o.v.command || '',
  })));

  const insObj = db.prepare('INSERT INTO objects (type_key, title, created_at, updated_at) VALUES (?, ?, ?, ?)');
  const insVal = db.prepare('INSERT OR REPLACE INTO prop_values (object_id, relation_key, value) VALUES (?, ?, ?)');
  const put = (id, k, v) => { if (v !== '' && v !== null && v !== undefined) insVal.run(id, k, String(v)); };
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  let notesAdded = 0, notesSkipped = 0, snippetsAdded = 0, snippetsSkipped = 0;
  db.exec('BEGIN');
  try {
    for (const n of data.notes) {
      const row = {
        date: n.date || '', project: n.project || '', title: n.title || '', content: n.content || '',
        content_html: n.contentHtml || '', done: n.done ? 1 : 0, start_time: n.startTime || '',
        finish_time: n.finishTime || '', remark: n.remark || '', content_json: n.contentJson || '',
      };
      const sig = noteSig(row);
      if (existingNotes.has(sig)) { notesSkipped++; continue; }
      const res = insObj.run('note', row.title, n.createdAt || now, n.updatedAt || now);
      const id = Number(res.lastInsertRowid);
      put(id, 'date', row.date);
      put(id, 'project', row.project);
      put(id, 'content', row.content);
      put(id, 'content_html', row.content_html);
      put(id, 'content_json', row.content_json);
      put(id, 'status', n.status || (n.done ? 'done' : 'todo'));
      put(id, 'due_date', n.dueDate || '');
      put(id, 'start_time', row.start_time);
      put(id, 'finish_time', row.finish_time);
      put(id, 'remark', row.remark);
      put(id, 'root_id', n.rootId || id);
      existingNotes.add(sig);
      notesAdded++;
    }
    for (const s of data.snippets) {
      const row = {
        language: s.language || '', title: s.title || '', command: s.command || '',
        remark: s.remark || '', tags: s.tags || '', uses: Number(s.uses) || 0,
      };
      const sig = snippetSig(row);
      if (existingSnippets.has(sig)) { snippetsSkipped++; continue; }
      const res = insObj.run('snippet', row.title, s.createdAt || now, s.updatedAt || now);
      const id = Number(res.lastInsertRowid);
      put(id, 'language', row.language);
      put(id, 'command', row.command);
      put(id, 'remark', row.remark);
      put(id, 'tags', row.tags);
      put(id, 'uses', row.uses);
      existingSnippets.add(sig);
      snippetsAdded++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { notesAdded, notesSkipped, snippetsAdded, snippetsSkipped };
}

// 整库快照：生成一致性副本（合并 WAL），用于在另一台电脑上原样恢复
function exportSnapshot(db, dbPath, file) {
  if (file === dbPath) throw new Error('不能覆盖正在使用的数据库文件');
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return { file, size: fs.statSync(file).size };
}

// 读取快照：兼容新的对象模型（objects 表）与旧的扁平表
function inspectSnapshot(file) {
  const snap = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = new Set(snap.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    if (tables.has('objects')) {
      const objects = snap.prepare('SELECT * FROM objects ORDER BY id').all();
      const values = snap.prepare('SELECT * FROM prop_values').all();
      const byObject = new Map();
      for (const v of values) {
        if (!byObject.has(v.object_id)) byObject.set(v.object_id, {});
        byObject.get(v.object_id)[v.relation_key] = v.value;
      }
      return { model: 'object', objects, byObject };
    }
    if (tables.has('daily_notes') && tables.has('snippets')) {
      return {
        model: 'legacy',
        notes: snap.prepare('SELECT * FROM daily_notes ORDER BY id').all(),
        snippets: snap.prepare('SELECT * FROM snippets ORDER BY id').all(),
      };
    }
    throw new Error('不是 Daily Notes 的数据库文件');
  } finally {
    snap.close();
  }
}

// 用快照整库覆盖当前数据库（先自动备份当前库）
function restoreSnapshot(targetDb, dbPath, file) {
  const info = inspectSnapshot(file);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const backup = `${dbPath}.before-restore-${stamp}.bak`;
  targetDb.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);

  targetDb.exec('BEGIN');
  try {
    targetDb.exec('DELETE FROM prop_values; DELETE FROM objects;');
    const insObj = targetDb.prepare(`INSERT INTO objects (id, type_key, title, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const insVal = targetDb.prepare('INSERT OR REPLACE INTO prop_values (object_id, relation_key, value) VALUES (?, ?, ?)');

    if (info.model === 'object') {
      for (const o of info.objects) {
        insObj.run(o.id, o.type_key, o.title, o.created_at, o.updated_at, o.deleted_at || '');
        for (const [k, v] of Object.entries(info.byObject.get(o.id) || {})) {
          if (v !== '' && v !== null && v !== undefined) insVal.run(o.id, k, String(v));
        }
      }
    } else {
      // 旧格式快照：先按旧结构插入临时表再走迁移不可行，这里直接转换写入
      for (const n of info.notes) {
        insObj.run(n.id, 'note', n.title || '', n.created_at || '', n.updated_at || '', n.deleted_at || '');
        const pairs = {
          date: n.date, project: n.project, content: n.content, content_html: n.content_html,
          content_json: n.content_json, status: n.status || (n.done ? 'done' : 'todo'),
          due_date: n.due_date, start_time: n.start_time, finish_time: n.finish_time,
          remark: n.remark, root_id: n.root_id || n.id,
        };
        for (const [k, v] of Object.entries(pairs)) {
          if (v !== '' && v !== null && v !== undefined && v !== 0) insVal.run(n.id, k, String(v));
        }
      }
      for (const s of info.snippets) {
        const row = insObj.run(s.id, 'snippet', s.title || '', s.created_at || '', s.updated_at || '', '');
        const id = Number(row.lastInsertRowid) || s.id;
        const pairs = { language: s.language, command: s.command, remark: s.remark, tags: s.tags, uses: s.uses };
        for (const [k, v] of Object.entries(pairs)) {
          if (v !== '' && v !== null && v !== undefined) insVal.run(id, k, String(v));
        }
      }
    }
    targetDb.exec('COMMIT');
  } catch (e) {
    targetDb.exec('ROLLBACK');
    throw e;
  }
  const counts = readCounts(targetDb);
  return { ...counts, backup };
}

function readCounts(db) {
  return {
    notes: db.prepare("SELECT COUNT(*) c FROM objects WHERE type_key='note'").get().c,
    snippets: db.prepare("SELECT COUNT(*) c FROM objects WHERE type_key='snippet'").get().c,
  };
}

module.exports = {
  createPackage, exportJson, readPackage, importJson,
  exportSnapshot, inspectSnapshot, restoreSnapshot,
};
