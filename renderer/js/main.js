// 渲染进程入口：视图路由、全局快捷键、初始化
import { $, $$ } from './core/dom.js';
import { state } from './core/state.js';
import { registerView, refreshViews } from './core/registry.js';
import { app } from './core/api.js';
import { todayStr } from './core/format.js';
import { closeModal, isModalOpen } from './ui/modal.js';
import { initGlobalSearch } from './ui/search.js';
import { loadDaily, initDailyView, startNewNote } from './views/daily.js';
import { loadDb, initDatabaseView, openRecordModal } from './views/database.js';
import { loadSnippets, initSnippetsView, openSnippetModal } from './views/snippets.js';
import { loadProjects } from './views/projects.js';
import { loadReview, initReviewView } from './views/review.js';
import { loadSettings, initSettingsView } from './views/settings.js';

// 注册各视图的加载器：切视图与跨视图刷新都走这里
registerView('daily', loadDaily);
registerView('db', loadDb);
registerView('snippets', loadSnippets);
registerView('projects', loadProjects);
registerView('review', loadReview);
registerView('settings', loadSettings);

const VIEW_TITLES = {
  daily: '每日记录',
  db: '数据库',
  snippets: '命令记录',
  projects: '项目',
  review: '回顾',
  settings: '设置',
};

export async function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + view));
  const loader = {
    daily: loadDaily,
    db: loadDb,
    snippets: loadSnippets,
    projects: loadProjects,
    review: loadReview,
    settings: loadSettings,
  }[view];
  if (loader) await loader();
}

// 侧栏导航
function bindNav() {
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
}

// 全局键盘快捷键
function bindGlobalKeys() {
  // 点击遮罩关闭弹窗
  $('#modal-mask').addEventListener('click', (e) => {
    if (e.target.id === 'modal-mask') closeModal();
  });

  document.addEventListener('keydown', (e) => {
    // Esc 关闭弹窗
    if (e.key === 'Escape' && isModalOpen()) {
      closeModal();
      return;
    }
    // Ctrl+N 按当前视图新建
    const inInput = document.activeElement?.tagName === 'INPUT'
      || document.activeElement?.getAttribute?.('contenteditable') === 'true';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !inInput) {
      e.preventDefault();
      if (state.view === 'db') openRecordModal({ date: todayStr(), done: false, status: 'todo' });
      else if (state.view === 'snippets') openSnippetModal(null);
      else if (state.view === 'daily') startNewNote(todayStr());
    }
  });
}

// 侧栏隐藏/退出（保留后台运行能力）
function bindSidebarActions() {
  $('#btn-hide').addEventListener('click', () => app.closeWindow());
  $('#btn-quit').addEventListener('click', () => {
    if (confirm('关闭软件？后台进程将完全退出。')) app.quit();
  });
}

function init() {
  initDailyView();
  initDatabaseView();
  initSnippetsView();
  initReviewView(switchView);
  initSettingsView();
  initGlobalSearch(switchView);
  bindNav();
  bindGlobalKeys();
  bindSidebarActions();

  switchView('daily').catch((e) => console.error('init switchView failed:', e));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

export { refreshViews };
