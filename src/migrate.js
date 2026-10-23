// 建表、补齐字段、内置模板种子、数据一致性修复
function run(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_notes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT NOT NULL,
      project       TEXT NOT NULL DEFAULT '',
      title         TEXT NOT NULL DEFAULT '',
      content       TEXT NOT NULL DEFAULT '',
      content_html  TEXT NOT NULL DEFAULT '',
      done          INTEGER NOT NULL DEFAULT 0,
      start_time    TEXT NOT NULL DEFAULT '',
      finish_time   TEXT NOT NULL DEFAULT '',
      remark        TEXT NOT NULL DEFAULT '',
      content_json  TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS snippets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      language    TEXT NOT NULL DEFAULT '',
      title       TEXT NOT NULL DEFAULT '',
      command     TEXT NOT NULL DEFAULT '',
      remark      TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '',
      uses        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_notes_date ON daily_notes(date);
    CREATE INDEX IF NOT EXISTS idx_notes_project ON daily_notes(project);
    CREATE INDEX IF NOT EXISTS idx_snip_tags ON snippets(tags);
  `);

  // 兼容旧库：补齐后续新增字段
  const cols = db.prepare('PRAGMA table_info(daily_notes)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE daily_notes ADD COLUMN ${ddl}`); };
  add('finish_time', "finish_time TEXT NOT NULL DEFAULT ''");
  add('title', "title TEXT NOT NULL DEFAULT ''");
  add('start_time', "start_time TEXT NOT NULL DEFAULT ''");
  add('remark', "remark TEXT NOT NULL DEFAULT ''");
  add('content_html', "content_html TEXT NOT NULL DEFAULT ''");
  add('content_json', "content_json TEXT NOT NULL DEFAULT ''");
  add('deleted_at', "deleted_at TEXT NOT NULL DEFAULT ''");
  add('status', "status TEXT NOT NULL DEFAULT ''");
  add('due_date', "due_date TEXT NOT NULL DEFAULT ''");
  add('root_id', "root_id INTEGER NOT NULL DEFAULT 0");

  // 数据一致性修复：孤儿记录自关联为任务根；done 与 status 同步
  db.exec('UPDATE daily_notes SET root_id = id WHERE root_id = 0 OR root_id IS NULL');
  db.exec("UPDATE daily_notes SET status = 'done' WHERE done = 1 AND status <> 'done'");
  db.exec("UPDATE daily_notes SET status = 'todo' WHERE (status = '' OR status IS NULL) AND done = 0");
  db.exec("UPDATE daily_notes SET done = 1 WHERE status = 'done' AND done = 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS note_versions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id     INTEGER NOT NULL,
      snapshot    TEXT NOT NULL,
      saved_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_versions_note ON note_versions(note_id);
    CREATE TABLE IF NOT EXISTS drafts (
      key   TEXT PRIMARY KEY,
      data  TEXT NOT NULL,
      saved_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL,
      content  TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS saved_filters (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL,
      query    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS projects (
      name     TEXT PRIMARY KEY,
      goal     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_notes_root ON daily_notes(root_id);
  `);

  seedBuiltinTemplates(db);
}

// 内置模板（幂等：按名称存在即跳过）
function seedBuiltinTemplates(db) {
  const builtins = [
    ['工作记录', '## 今日目标\n- \n\n## 实际完成\n- \n\n## 遇到的问题\n- \n\n## 下一步\n- '],
    ['问题排查', '## 现象\n\n\n## 环境\n\n\n## 尝试步骤\n- \n\n## 解决方案\n\n\n## 验证结果\n'],
    ['实验记录', '## 目的\n\n\n## 配置\n\n\n## 结果\n\n\n## 结论\n\n\n## 后续实验\n- '],
  ];
  const ins = db.prepare('INSERT INTO templates (name, content) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM templates WHERE name = ?)');
  for (const [name, content] of builtins) ins.run(name, content, name);
}

module.exports = { run, seedBuiltinTemplates };
