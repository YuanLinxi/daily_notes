// 数据导出 / 导入：应用内 JSON 交换格式，以及整库 SQLite 快照
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT = 'daily-notes';
const VERSION = 1;

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

function createPackage(db) {
  const notes = db.prepare('SELECT * FROM daily_notes ORDER BY id').all();
  const snippets = db.prepare('SELECT * FROM snippets ORDER BY id').all();
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    stats: { notes: notes.length, snippets: snippets.length },
    notes: notes.map(toNoteDto),
    snippets: snippets.map(toSnippetDto),
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
  const existingNotes = new Set(db.prepare('SELECT * FROM daily_notes').all().map(noteSig));
  const existingSnippets = new Set(db.prepare('SELECT * FROM snippets').all().map(snippetSig));

  const insNote = db.prepare(`INSERT INTO daily_notes
    (date, project, title, content, content_html, done, start_time, finish_time, remark, content_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insSnip = db.prepare(`INSERT INTO snippets
    (language, title, command, remark, tags, uses, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  let notesAdded = 0, notesSkipped = 0, snippetsAdded = 0, snippetsSkipped = 0;
  db.exec('BEGIN');
  try {
    for (const n of data.notes) {
      const row = {
        date: n.date || '', project: n.project || '', title: n.title || '', content: n.content || '',
        content_html: n.contentHtml || '', done: n.done ? 1 : 0, start_time: n.startTime || '',
        finish_time: n.finishTime || '', remark: n.remark || '', content_json: n.contentJson || '',
        created_at: n.createdAt || '', updated_at: n.updatedAt || '',
      };
      const sig = noteSig(row);
      if (existingNotes.has(sig)) { notesSkipped++; continue; }
      insNote.run(row.date, row.project, row.title, row.content, row.content_html, row.done,
        row.start_time, row.finish_time, row.remark, row.content_json, row.created_at, row.updated_at);
      existingNotes.add(sig);
      notesAdded++;
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    for (const s of data.snippets) {
      const row = {
        language: s.language || '', title: s.title || '', command: s.command || '',
        remark: s.remark || '', tags: s.tags || '', uses: Number(s.uses) || 0,
        created_at: s.createdAt || now, updated_at: s.updatedAt || now,
      };
      const sig = snippetSig(row);
      if (existingSnippets.has(sig)) { snippetsSkipped++; continue; }
      insSnip.run(row.language, row.title, row.command, row.remark, row.tags, row.uses, row.created_at, row.updated_at);
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

function inspectSnapshot(file) {
  const snap = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = new Set(snap.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    if (!tables.has('daily_notes') || !tables.has('snippets')) {
      throw new Error('不是 Daily Notes 的数据库文件');
    }
    const notes = snap.prepare('SELECT * FROM daily_notes ORDER BY id').all();
    const snippets = snap.prepare('SELECT * FROM snippets ORDER BY id').all();
    return { notes, snippets };
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
    targetDb.exec('DELETE FROM daily_notes; DELETE FROM snippets;');
    const insNote = targetDb.prepare(`INSERT INTO daily_notes
      (${noteCols.join(', ')}) VALUES (${noteCols.map(() => '?').join(', ')})`);
    for (const n of info.notes) insNote.run(...noteCols.map((c) => n[c]));
    const insSnip = targetDb.prepare(`INSERT INTO snippets
      (${snippetCols.join(', ')}) VALUES (${snippetCols.map(() => '?').join(', ')})`);
    for (const s of info.snippets) insSnip.run(...snippetCols.map((c) => s[c]));
    targetDb.exec('COMMIT');
  } catch (e) {
    targetDb.exec('ROLLBACK');
    throw e;
  }
  return { notes: info.notes.length, snippets: info.snippets.length, backup };
}

module.exports = {
  createPackage, exportJson, readPackage, importJson,
  exportSnapshot, inspectSnapshot, restoreSnapshot,
};
