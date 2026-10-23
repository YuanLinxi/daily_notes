# Daily Notes 代码拆分重构方案

> 状态：已完成（2026-10-23）
> 范围：纯重构，不改行为；顺带修复已发现的真实缺陷
> 模块方案：原生 ES 模块（`<script type="module">`），不引入构建工具

## Context

项目当前是单文件架构：`renderer/app.js` 1529 行承载全部视图逻辑，`src/db.js` 737 行承载全部数据访问，`main.js` 358 行混杂窗口、备份、配置与 IPC。功能已成型并持续迭代，单文件继续膨胀会导致：

- 修改任一视图都在同一文件中搜索定位，回归风险高
- 重复代码无法复用（记录编辑器与记录弹窗字段区 90% 相同、看板两种模式的卡片拖拽逻辑几乎一样）
- 存在 monkey patch（`renderDb` 被覆盖包装），重构前必须先消除

目标是拆成职责清晰的模块，功能与界面保持完全一致，为后续「属性化数据模型 / 多视图配置 / 高级筛选」打好地基。

## 关键约束

1. **打包白名单**：`package.json` → `build.files` 只包含 `src/**/*` 与 `renderer/**/*`。新增文件必须落在这两个目录内，否则不会进入安装包。
2. **CSP**：`script-src 'self'`，因此不能内联脚本；ES 模块 `file://` 加载需要 Electron 支持（已确认可用），HTML 改为单入口 `<script type="module" src="js/main.js">`。
3. **不引入构建步骤**：`npm run build` 流程保持不变。
4. **数据层拆分的单例问题**：各数据模块共享同一个 SQLite 连接，必须集中到 `connection.js`，避免循环依赖。

## 目标结构

```
src/                          # 主进程侧数据层
  connection.js               # 连接单例：init / close / raw / path / reopen
  migrate.js                  # 建表、补列、内置模板种子、数据一致性修复
  util.js                     # isoNow / today / mapNote / mapSnippet / summarizeLine
  notes.js                    # 记录 CRUD、任务线程、项目列表
  trash.js                    # 回收站、版本历史
  drafts.js                   # 草稿
  settings.js                 # 键值设置
  snippets.js                 # 命令库
  stats.js                    # 统计、热力图、时间轴、日聚合
  search.js                   # searchAll
  templates.js                # 模板
  filters.js                  # 保存的筛选
  projects.js                 # 项目主页
  report.js                   # 周报
  export.js                   # Markdown / HTML 导出
  transfer.js                 # 保持不变
  index.js                    # 汇总 re-export，保持 db.js 兼容层
  db.js                       # 兼容层：仅 re-export index.js（过渡期保留）

main.js                       # 保留；仅调整 require 路径
preload.js                    # 保持不变

renderer/
  index.html                  # 单入口 <script type="module" src="js/main.js">
  js/
    core/dom.js               # $ $$ h esc toast debounce（合并 richtext 的 el）
    core/state.js             # 全局 state 对象
    core/api.js               # window.api 的包装
    core/format.js            # todayStr pad weekdayOf summarize statusTag STATUS statCard optionList
    ui/modal.js               # showModal / closeModal
    ui/search.js              # 全局搜索
    views/daily.js            # 每日记录 + 编辑器 + 任务脉络 + 版本历史 + 回收站
    views/database.js         # 表格 / 看板 / 日历 / 筛选 / 批量 / 列菜单
    views/snippets.js         # 命令库
    views/projects.js         # 项目主页
    views/review.js           # 回顾 + 周报
    views/settings.js         # 设置 / 模板 / 导出 / 备份 / 导入导出
    richtext.js               # 改为 ESM，导出 createEditor / mindmapToText
    main.js                   # 路由 switchView + 初始化 + 快捷键
  styles.css                  # 按现有分节注释拆为 base.css / daily.css / database.css …
```

## 执行步骤

### 阶段一：数据层拆分（低风险，先做）

1. 新建 `src/connection.js`，把 `init/close/reopen/raw/path` 与 `db`/`dbPath` 单例移入。
2. `src/migrate.js`：搬移 `migrate`、`seedBuiltinTemplates`、一致性修复语句，接收连接参数。
3. `src/util.js`：搬移 `isoNow`、`today`、`mapNote`、`mapSnippet`、`summarizeLine`、`snippetAround`。
4. 按上表依次拆出各业务模块，每个模块 `require('./connection').getDb()` 取连接。
5. `src/index.js` 汇总所有导出；`src/db.js` 改为 `module.exports = require('./index')`，保证 `main.js`、`transfer.js` 调用点零改动。
6. **验证**：`node --check` 全通过 + 直接调用各函数对比重构前后返回值。

### 阶段二：渲染层核心层

7. `core/dom.js`：统一 `h()`（合并 richtext 的 `el`）、`$`、`$$`、`esc`、`toast`、`debounce`。
8. `core/state.js`：导出 `state` 及 `resetEditing()` 之类访问器，去掉散落的临时字段写入。
9. `core/format.js`：`STATUS`、`statusTag`、`summarize(text, max)`、`statCard`、`optionList`、`groupByDate`。
10. `core/api.js`：导出 `bridge`。

### 阶段三：视图层拆分

11. **先消除 monkey patch**：把 `renderDb` 的包装逻辑（`boardDimBar` 相关，app.js:1055-1083）内联进 `views/database.js` 的 `renderDb` 本体，删除 `_origRenderDb`。
12. 按依赖从低到高依次拆：`ui/modal.js` → `ui/search.js` → `views/snippets.js` → `views/projects.js` → `views/review.js` → `views/settings.js` → `views/daily.js` → `views/database.js`。
13. 提取重复代码：
    - `buildFieldGrid()`：合并 `renderNoteEditor` 与 `openRecordModal` 的字段区
    - `makeBoardCard()` / `bindDrop()`：合并 `renderBoard` 与 `renderBoardByStatus`
    - `refreshViews(list)`：替代 `reloadIfActive` 与 `refreshAfterTransfer`
14. `richtext.js` 改为 ESM（去掉 IIFE，`el` 改用 `dom.js` 的 `h`），导出 `createEditor`、`mindmapToText`。
15. `main.js`：实现 `switchView` 路由与初始化，替代原文件末尾的零散绑定。

### 阶段四：样式拆分

16. 按 `styles.css` 现有分节注释拆成多个 CSS 文件，`index.html` 依次 `<link>` 引入。保持选择器完全不变。

### 阶段五：清理与修复

17. 删除根目录过渡文件（仅保留必要的兼容层）。
18. 修复重构中发现的缺陷（见下节）。

## 顺带修复的缺陷

| 问题 | 位置 | 处理 |
|---|---|---|
| 全局搜索查询引用了已删除的 `tags` 列 | `src/search.js`（原 db.js:527） | 移除该条件（SQLite 中裸写列名会当字符串字面量，静默失效） |
| `main.js` 中 Alt+N 快捷键注册两次 | `main.js` 启动处与 `app:set-quick-hotkey` | 只保留一处注册，避免重复绑定 |
| 开发路径硬编码 `G:\daily notes` | `main.js` DEFAULT_DB | 保留现状（本机专用），仅在注释中标注 |
| `listDrafts` 返回 snake_case | `src/drafts.js` | 统一为 camelCase |

## 验证方式

**每阶段完成后执行：**

```bash
node --check main.js preload.js src/*.js renderer/js/**/*.js
```

**重构完成后端到端验证：**

1. `npm start` 启动，确认无控制台报错
2. 依次切换 6 个视图：每日记录 / 数据库 / 命令记录 / 项目 / 回顾 / 设置
3. 每日记录：新建记录 → 输入触发自动保存 → 确认只产生 1 条 → 重载后内容仍存在
4. 数据库：表格排序、列显隐、批量修改、看板两种分组切换、日历翻月
5. 全局搜索 `Ctrl+K` 返回记录与命令结果
6. 回顾页统计数字与数据库实际一致；周报可生成
7. 设置页：模板列表、导出、备份列表正常
8. 后台运行：隐藏到托盘后进程仍在
9. `npm run build` 打包成功，安装包可正常启动

**回归基线**：重构前后各导出一份 JSON 数据，比对内容一致。

## 不做什么

- 不引入 TypeScript、构建工具、测试框架（本次范围外）
- 不改变任何数据库表结构与已有数据
- 不调整界面样式与交互
- 不做属性化数据模型改造（后续阶段）
