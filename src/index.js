// 数据层统一出口：汇总各模块导出，供 main.js / transfer.js 使用
const connection = require('./connection');
const notes = require('./notes');
const trash = require('./trash');
const drafts = require('./drafts');
const settings = require('./settings');
const snippets = require('./snippets');
const stats = require('./stats');
const search = require('./search');
const templates = require('./templates');
const filters = require('./filters');
const projects = require('./projects');
const report = require('./report');
const exporter = require('./export');
const { snippetAround } = require('./util');

module.exports = {
  // 连接生命周期
  init: connection.init,
  close: connection.close,
  reopen: connection.reopen,
  raw: connection.getDb,
  path: connection.getPath,
  getDbPath: connection.getPath,

  // 记录
  listNotes: notes.listNotes,
  getNote: notes.getNote,
  saveNote: notes.saveNote,
  deleteNote: trash.deleteNote,
  listProjects: notes.listProjects,
  taskThread: notes.taskThread,
  listTasks: notes.listTasks,

  // 回收站与版本
  listTrash: trash.listTrash,
  restoreNote: trash.restoreNote,
  purgeNote: trash.purgeNote,
  purgeExpired: trash.purgeExpired,
  noteVersions: trash.noteVersions,
  restoreVersion: trash.restoreVersion,

  // 草稿与设置
  saveDraft: drafts.saveDraft,
  getDraft: drafts.getDraft,
  clearDraft: drafts.clearDraft,
  listDrafts: drafts.listDrafts,
  getSetting: settings.getSetting,
  setSetting: settings.setSetting,

  // 命令库
  listSnippets: snippets.listSnippets,
  saveSnippet: snippets.saveSnippet,
  deleteSnippet: snippets.deleteSnippet,
  useSnippet: snippets.useSnippet,

  // 统计
  heatmap: stats.heatmap,
  timeline: stats.timeline,
  stats: stats.stats,

  // 搜索
  searchAll: search.searchAll,
  snippetAround,

  // 模板与筛选
  listTemplates: templates.listTemplates,
  saveTemplate: templates.saveTemplate,
  deleteTemplate: templates.deleteTemplate,
  renderTemplate: templates.renderTemplate,
  listSavedFilters: filters.listSavedFilters,
  saveSavedFilter: filters.saveSavedFilter,
  deleteSavedFilter: filters.deleteSavedFilter,

  // 项目与周报
  getProjectPage: projects.getProjectPage,
  setProjectGoal: projects.setProjectGoal,
  weeklyReport: report.weeklyReport,

  // 导出
  exportMarkdown: exporter.exportMarkdown,
  exportHtml: exporter.exportHtml,
};
