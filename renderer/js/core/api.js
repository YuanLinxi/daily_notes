// 渲染进程侧的数据层门面：preload 暴露的 window.api
export const bridge = window.api;

export const notes = bridge.notes;
export const snippets = bridge.snippets;
export const meta = bridge.meta;
export const trash = bridge.trash;
export const versions = bridge.versions;
export const drafts = bridge.drafts;
export const backup = bridge.backup;
export const tasks = bridge.tasks;
export const search = bridge.search;
export const templates = bridge.templates;
export const filters = bridge.filters;
export const projectPage = bridge.projectPage;
export const report = bridge.report;
export const exporter = bridge.exporter;
export const quick = bridge.quick;
export const transfer = bridge.transfer;
export const app = bridge.app;
