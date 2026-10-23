// 建表与迁移：对象 + 属性模型
// 核心表：objects（内容）/ relations（属性定义）/ values（属性值）
// 旧表 daily_notes / snippets / projects 会在首次运行时一次性迁移并删除

// 内置属性定义（幂等：按 key 存在即跳过）
const BUILTIN_RELATIONS = [
  // key, name, type, format, options
  ['date', '日期', 'date', '', null],
  ['project', '项目', 'text', '', null],
  ['content', '正文', 'longtext', '', null],
  ['content_html', '正文 HTML', 'longtext', '', null],
  ['content_json', '富媒体数据', 'longtext', '', null],
  ['status', '状态', 'select', '', ['todo', 'doing', 'blocked', 'done']],
  ['due_date', '截止日期', 'date', '', null],
  ['start_time', '开始时间', 'datetime', 'time', null],
  ['finish_time', '完成时间', 'datetime', 'time', null],
  ['remark', '备注', 'text', '', null],
  ['root_id', '任务根', 'number', '', null],
  ['language', '语言', 'text', '', null],
  ['command', '命令', 'longtext', '', null],
  ['tags', '标签', 'multiselect', '', null],
  ['uses', '使用次数', 'number', '', null],
  ['goal', '项目目标', 'longtext', '', null],
];

function run(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS objects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type_key    TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      deleted_at  TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type_key);
    CREATE INDEX IF NOT EXISTS idx_objects_deleted ON objects(deleted_at);

    CREATE TABLE IF NOT EXISTS relations (
      key         TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'text',
      format      TEXT NOT NULL DEFAULT '',
      options     TEXT NOT NULL DEFAULT '[]',
      builtin     INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS prop_values (
      object_id     INTEGER NOT NULL,
      relation_key  TEXT NOT NULL,
      value         TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (object_id, relation_key)
    );
    CREATE INDEX IF NOT EXISTS idx_values_key ON prop_values(relation_key);
  `);

  seedRelations(db);
  ensureAuxTables(db);

  if (tableExists(db, 'daily_notes')) migrateLegacy(db);
  if (tableExists(db, 'snippets')) migrateLegacy(db, true);

  seedBuiltinTemplates(db);
}

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function seedRelations(db) {
  const ins = db.prepare(`INSERT INTO relations (key, name, type, format, options, builtin, sort_order)
    SELECT ?, ?, ?, ?, ?, 1, ?
    WHERE NOT EXISTS (SELECT 1 FROM relations WHERE key = ?)`);
  BUILTIN_RELATIONS.forEach(([key, name, type, format, options], i) => {
    ins.run(key, name, type, format, JSON.stringify(options || []), i, key);
  });
}

// 辅助表：结构保持与旧版一致
function ensureAuxTables(db) {
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
  `);
}

// 一次性迁移：旧扁平表 → objects + values，完成后删除旧表
function migrateLegacy(db, force = false) {
  const hasNotes = tableExists(db, 'daily_notes');
  if (!force && !hasNotes) return;

  const insObj = db.prepare(`INSERT INTO objects (id, type_key, title, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insVal = db.prepare('INSERT OR REPLACE INTO prop_values (object_id, relation_key, value) VALUES (?, ?, ?)');

  const put = (id, key, val) => {
    if (val === null || val === undefined) return;
    if (val === '') return;
    insVal.run(id, key, String(val));
  };

  db.exec('BEGIN');
  try {
    if (db.prepare("SELECT COUNT(*) c FROM objects").get().c === 0 && hasNotes) {
      // --- 记录 ---
      for (const r of db.prepare('SELECT * FROM daily_notes').all()) {
        insObj.run(r.id, 'note', r.title || '', r.created_at || '', r.updated_at || '', r.deleted_at || '');
        put(r.id, 'date', r.date);
        put(r.id, 'project', r.project);
        put(r.id, 'content', r.content);
        put(r.id, 'content_html', r.content_html);
        put(r.id, 'content_json', r.content_json);
        put(r.id, 'status', r.status || (r.done ? 'done' : 'todo'));
        put(r.id, 'due_date', r.due_date);
        put(r.id, 'start_time', r.start_time);
        put(r.id, 'finish_time', r.finish_time);
        put(r.id, 'remark', r.remark);
        put(r.id, 'root_id', r.root_id || r.id);
      }
    }

    if (tableExists(db, 'snippets')) {
      for (const r of db.prepare('SELECT * FROM snippets').all()) {
        // 命令与记录共用 objects 的自增空间，因此不复用旧 id（前端不依赖 id 的具体值）
        const row = db.prepare(`INSERT INTO objects (type_key, title, created_at, updated_at, deleted_at)
          VALUES ('snippet', ?, ?, ?, '')`).run(r.title || '', r.created_at || '', r.updated_at || '');
        const id = Number(row.lastInsertRowid);
        put(id, 'language', r.language);
        put(id, 'command', r.command);
        put(id, 'remark', r.remark);
        put(id, 'tags', r.tags);
        put(id, 'uses', r.uses || 0);
      }
    }

    if (tableExists(db, 'projects')) {
      for (const r of db.prepare('SELECT * FROM projects').all()) {
        const row = insObj.run(null, 'project', r.name, '', '', '');
        put(Number(row.lastInsertRowid), 'goal', r.goal);
      }
    }

    db.exec('DROP TABLE IF EXISTS daily_notes');
    db.exec('DROP TABLE IF EXISTS snippets');
    db.exec('DROP TABLE IF EXISTS projects');
    db.exec('COMMIT');
    console.log('[migrate] 旧表已迁移至对象模型并删除');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[migrate] 迁移失败，已回滚:', e.message);
    throw e;
  }
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

module.exports = { run, seedBuiltinTemplates, migrateLegacy, BUILTIN_RELATIONS };
