# Daily Notes 数据模型对象化（第一步：仅数据层）

> 状态：待执行
> 范围：把扁平表 `daily_notes` / `snippets` 升级为「对象 + 属性」模型。**本步只改数据层，界面与交互保持不变**。
> 迁移策略：一次性迁移，删除旧表（迁移前自动备份数据库）

## Context

当前记录是固定列（title/project/status/due_date/timeline…），新增字段必须改表结构，进而改每一处 SQL 与前端硬编码。要支持「自定义属性 / 多视图配置 / 高级筛选」，数据必须先变成通用的对象 + 属性模型。

本轮不碰界面：数据层对外接口（`src/index.js` 的导出函数签名与返回对象结构）保持完全一致，前端零改动。这样可以用现有 6 个视图做回归验证，确认模型升级无副作用后，下一轮再改造编辑器与表格。

已完成的探索结论：

- 全库**没有 JOIN**，都是单表查询 + 应用层拼装，拆分风险可控
- `daily_notes` 被 8 个模块引用：notes、snippets、stats、search、projects、report、export、trash
- 「项目」目前是 `daily_notes.project` 纯文本，`projects` 表只有 `name` + `goal`，无外键
- 「标签」只在 `snippets.tags`（逗号分隔文本）
- `renderDb` 的 monkey patch 已在上一轮消除
- 渲染层硬编码字段 115 处，但**本轮不动**

## 目标模型

三张核心表 + 保持不变的辅助表。

### `objects` —— 所有内容统一存这里

```
id            INTEGER PK
type_key      TEXT     -- 'note' | 'snippet' | 'project'（未来可扩展）
title         TEXT     -- 用于所有类型的显示名
created_at    TEXT
updated_at    TEXT
deleted_at    TEXT     -- 软删除，空串表示未删除
```

### `relations` —— 属性定义（元数据）

```
key           TEXT PK  -- 属性标识，如 'date' / 'status' / 'project'
name          TEXT     -- 显示名
type          TEXT     -- 'text' | 'longtext' | 'number' | 'date' | 'select' | 'multiselect' | 'datetime'
format        TEXT     -- 附加值格式：'time'（用于 startTime/finishTime）
options       TEXT     -- JSON 数组，select 类型的可选项
builtin       INTEGER  -- 1 表示内置属性，不可删除
sort_order    INTEGER
```

内置属性种子：`date`、`project`、`content`、`content_html`、`content_json`、`status`、`due_date`、`start_time`、`finish_time`、`remark`、`tags`、`language`、`command`、`uses`、`root_id`、`goal`。

### `values` —— 对象属性值（横向存储）

```
object_id     INTEGER
relation_key  TEXT
value         TEXT     -- 统一按文本存；数字/日期写入时规范化
PRIMARY KEY (object_id, relation_key)
```

### 保持不变的表

`note_versions`、`drafts`、`settings`、`templates`、`saved_filters` 结构不变。
`projects` 表并入 `objects`（type='project'，`goal` 变成属性），`projects` 表删除。

## 执行步骤

### 阶段一：迁移（`src/migrate.js`）

1. 建 `objects` / `relations` / `values` 三张表及索引（`idx_objects_type`、`idx_objects_deleted`、`idx_values_key`）。
2. 检测 `daily_notes` 表是否存在：存在则执行一次性迁移
   - 每条 `daily_notes` 行 → 一个 `objects` 行（type='note'，title 取 `title`，保留原 id）
   - 其余字段写入 `values`（`project`、`content`、`content_html`、`content_json`、`status`、`due_date`、`start_time`、`finish_time`、`remark`、`done`→由 status 推导、`deleted_at` 提到 objects）
   - `snippets` 行 → `objects`（type='snippet'），`language`/`command`/`remark`/`tags`/`uses` 写入 values
   - `projects` 行 → `objects`（type='project'），`goal` 写入 values
3. 迁移在单事务内完成；成功后 `DROP TABLE daily_notes; DROP TABLE snippets; DROP TABLE projects;`
4. 迁移前由 `main.js` 自动生成一份 `pre-migration-<时间戳>.db` 备份到 backups 目录。
5. 初始化时报错则回滚事务，保留旧表，应用启动不受损。

### 阶段二：数据访问层重写

新增 `src/objects.js`（通用对象读写），现有模块改为调用它，**对外返回结构不变**：

- `objects.js`：`createObject`、`updateObject`、`getObject`、`queryObjects`（按类型 + 条件）、`softDelete`、`purge`、`getValues`、`setValues`、`getRelation`、`listRelations`
- `src/notes.js`：`listNotes` / `saveNote` / `getNote` 内部改为读写 objects+values，但返回的 camelCase 对象与现在**逐字段一致**
  - `listNotes` 的筛选条件翻译：`q`→title/content/remark 的 LIKE；`project`→values 过滤；`status`/`dueBefore`/`dateFrom`/`dateTo` 同理
- `src/snippets.js`：同上（`uses+1` 改为读改写）
- `src/stats.js`、`src/search.js`、`src/report.js`、`src/export.js`、`src/projects.js`、`src/trash.js`：改为基于 objects/values 查询，输出结构不变
- `src/index.js`：导出签名不变

**性能**：`values` 横向存储需要按 object 聚合。使用 `SELECT ... FROM objects o LEFT JOIN values v ON v.object_id = o.id` 单次查询 + 应用层 pivot，避免 N+1。

### 阶段三：导入导出兼容

`src/transfer.js`：

- `VERSION` 升到 2；导出 JSON 结构保持 `{ notes: [], snippets: [] }` 不变（对外兼容）
- `readPackage` 仍接受 version 1（用同一套映射逻辑，不需要转换）
- `exportSnapshot` 改用新表；`inspectSnapshot` 改为检测 `objects` 表
- 整库恢复：删除新库数据后从快照重灌，按 type 分派

### 阶段四：清理与验证

- 删除 `src/migrate.js` 中已废弃的 ALTER TABLE 逻辑（仅保留建新表 + 迁移代码）
- 更新 `REFACTOR_PLAN.md` 或新增 `docs/data-model.md` 说明新模型

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/migrate.js` | 重写：新表 + 一次性迁移 + 删旧表 |
| `src/objects.js` | **新增**：通用对象/属性/值读写 |
| `src/notes.js` | 内部改写，导出不变 |
| `src/snippets.js` | 内部改写，导出不变 |
| `src/stats.js` `search.js` `report.js` `export.js` `projects.js` `trash.js` | 内部改写 |
| `src/index.js` | 增加 relations 相关导出（新增，不删旧的） |
| `src/transfer.js` | 版本 2 + 快照读写适配 |
| `main.js` | 迁移前自动备份 |
| `renderer/` | **零改动** |

## 验证方式

1. **迁移前**：先复制一份 `data/daily-notes.db` 作为基线，记录当前 21 条记录、28 条回收站、1 条命令、3 个模板、5 个项目的完整字段快照
2. **迁移后**：逐条比对下列输出与迁移前完全一致
   - `db.listNotes({})` 的每个字段值
   - `db.stats()` 全部 8 个数字
   - `db.listProjects()`、`db.listSnippets()`、`db.listTemplates()`
   - `db.heatmap({})` 的 days 与 hours
   - `db.timeline({})`、`db.weeklyReport()`、`db.exportMarkdown({})` 的文本
   - `db.listTrash()`、`db.noteVersions(某条id)`
3. **界面回归**：`npm start` 后依次打开 6 个视图，确认无报错；新建记录 → 自动保存只产生 1 条 → 重载后仍在
4. **导入导出**：导出一份 JSON → 导入到空库 → 记录数一致；整库快照导出 → 恢复 → 一致
5. **迁移失败演练**：手动在迁移中制造一次失败，确认事务回滚且旧表完好（在副本数据库上验证）
6. `npm run build` 打包成功

## 不做什么

- 不改任何界面与交互（编辑器、表格列、看板、筛选 UI 全部保持原样）
- 不引入 TypeScript、测试框架
- 不做多视图配置 / 高级筛选 / Gallery 视图（下一轮，基于本次的 relations 基础）
