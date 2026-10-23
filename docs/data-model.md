# 数据模型：对象 + 属性

从 v1.2 起，数据不再是「每类内容一张固定列的表」，而是统一的**对象 + 属性**模型。

## 三张核心表

### `objects` — 所有内容

| 字段 | 说明 |
|---|---|
| `id` | 主键，note / snippet / project 共用一个自增空间 |
| `type_key` | 对象类型：`note`（每日记录）/ `snippet`（命令）/ `project`（项目） |
| `title` | 显示名 |
| `created_at` / `updated_at` | 时间戳 |
| `deleted_at` | 软删除标记，空串表示未删除 |

### `relations` — 属性定义

| 字段 | 说明 |
|---|---|
| `key` | 属性标识，如 `date` / `status` / `project` |
| `name` | 显示名 |
| `type` | `text` / `longtext` / `number` / `date` / `datetime` / `select` / `multiselect` |
| `format` | 附加格式，如 `time`（用于开始/完成时间） |
| `options` | select 类型的可选项，JSON 数组 |
| `builtin` | 1 表示内置属性 |
| `sort_order` | 展示顺序 |

新增自定义属性只需往这张表插一行，无需改表结构。

### `prop_values` — 属性值

| 字段 | 说明 |
|---|---|
| `object_id` | 所属对象 |
| `relation_key` | 属性 |
| `value` | 统一按文本存储 |

主键为 `(object_id, relation_key)`。空值不入库（写入空串即删除该行）。

> 表名用 `prop_values` 而非 `values`，因为 `values` 是 SQL 保留字。

## 内置属性

`date` `project` `content` `content_html` `content_json` `status` `due_date`
`start_time` `finish_time` `remark` `root_id` `language` `command` `tags` `uses` `goal`

## 各类型的属性映射

| 类型 | 属性 |
|---|---|
| `note` | date, project, content, content_html, content_json, status, due_date, start_time, finish_time, remark, root_id |
| `snippet` | language, command, remark, tags, uses |
| `project` | goal |

## 访问方式

业务代码统一通过 `src/objects.js` 读写，不要在别处拼 SQL。

```js
const obj = require('./objects');

obj.createObject({ typeKey: 'note', title: '标题' });
obj.setValues(id, { date: '2026-10-23', status: 'doing' });
obj.getValues(id);                      // { date: '2026-10-23', status: 'doing' }
obj.listWithValues('note');             // [{ ...object, values: {...} }]
obj.listRelations();                    // 属性定义
```

`listWithValues` 用一次批量查询取回所有属性值（`getValuesBatch`），不会出现 N+1。

## 迁移

- 首次启动检测到旧表 `daily_notes` 时自动迁移，单事务执行
- 迁移前自动备份到 `data/backups/pre-migration-<时间戳>.db`
- 迁移失败自动回滚，旧表保留，应用可继续使用旧结构
- 迁移成功后旧表被删除

## 数据互通

- 导出的 JSON 仍为 `{ notes: [], snippets: [] }` 结构，**对旧版本软件保持兼容**
- 数据包版本号升为 `2`，导入时同时接受 version 1
- 整库快照支持两种格式：新格式（objects 表）与旧格式（daily_notes 表）都能恢复

## 后续扩展

`relations` 表已就绪，下一步可基于它实现：

- 自定义属性（用户自行增删属性）
- 动态表格列与编辑器字段
- 多视图配置（每个视图独立的筛选/分组/排序）
- Gallery 视图与高级筛选（条件树）
