const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const db = require('./src/db');
const transfer = require('./src/transfer');

const dateStamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);

const CONFIG_FILE = path.join(app.getPath('userData'), 'daily-notes.config.json');
// 打包版（其他电脑上安装）默认存到应用数据目录；开发目录版沿用本条目的固定路径
const DEFAULT_DB = app.isPackaged
  ? path.join(app.getPath('userData'), 'daily-notes.db')
  : path.join('G:', path.sep, 'daily notes', 'data', 'notes.db');

function loadConfig() {
  try {
    return { dbPath: DEFAULT_DB, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { dbPath: DEFAULT_DB };
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

const config = loadConfig();
saveConfig(config);

let win = null;
let tray = null;
let quitting = false;

function ensureTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico')));
  tray.setToolTip('Daily Notes');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Daily Notes', click: () => showWindow() },
    { type: 'separator' },
    { label: '退出（关闭软件）', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showWindow());
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

let quickWin = null;

function createQuickWindow() {
  if (quickWin) return quickWin;
  quickWin = new BrowserWindow({
    width: 520,
    height: 380,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#faf9f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  quickWin.loadFile(path.join(__dirname, 'renderer', 'quick.html'));
  quickWin.on('blur', () => { if (quickWin.isVisible()) quickWin.hide(); });
  quickWin.on('closed', () => { quickWin = null; });
  return quickWin;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#faf9f7',
    title: 'Daily Notes',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (hiddenStart) win.hide(); });

  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
}

const hiddenStart = process.argv.includes('--hidden');

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    db.init(config.dbPath);
    registerIpc();
    createWindow();
    ensureTray();
    db.purgeExpired(30);
    globalShortcut.register('Alt+N', () => {
      const q = createQuickWindow();
      if (q.isVisible()) q.hide();
      else { q.show(); q.focus(); }
    });
  });
}

// ---------- 自动备份：每天有变更时备份一次，保留最近 30 份 ----------
const BACKUP_KEEP = 30;

function backupDir() {
  return path.join(path.dirname(config.dbPath), 'backups');
}

function listBackups() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith('notes-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: path.join(dir, f), name: f, size: st.size, at: st.mtime.toISOString() };
    });
}

function runBackup(force = false) {
  try {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `notes-${stamp}.db`);
    // 当天已备份过则跳过（除非 force）
    if (!force && fs.existsSync(file)) return { ok: true, skipped: true, file };
    if (fs.existsSync(file)) fs.rmSync(file);
    db.raw().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const all = fs.readdirSync(dir).filter((f) => f.startsWith('notes-') && f.endsWith('.db')).sort();
    while (all.length > BACKUP_KEEP) fs.rmSync(path.join(dir, all.shift()));
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

let backupTimer = null;
function scheduleBackup() {
  if (backupTimer) return;
  backupTimer = setTimeout(() => {
    backupTimer = null;
    runBackup(false);
  }, 5000);
}

function registerIpc() {
  ipcMain.handle('app:close-window', () => { if (win) win.hide(); return true; });
  ipcMain.handle('app:global-quick', () => {
    if (!quickWin) createQuickWindow();
    else if (quickWin.isVisible()) quickWin.hide();
    else { quickWin.show(); quickWin.focus(); }
    return true;
  });
  ipcMain.handle('app:set-quick-hotkey', (_e, enabled) => {
    try {
      if (enabled) globalShortcut.register('Alt+N', () => {
        if (!quickWin) createQuickWindow();
        else if (quickWin.isVisible()) quickWin.hide();
        else { quickWin.show(); quickWin.focus(); }
      });
      else globalShortcut.unregister('Alt+N');
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('app:save-text-file', async (_e, { defaultName, content, filters }) => {
    const res = await dialog.showSaveDialog(win, {
      title: '导出文件',
      defaultPath: path.join(app.getPath('documents'), defaultName || 'export.txt'),
      filters: filters || [{ name: '文本', extensions: ['txt'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false };
    fs.writeFileSync(res.filePath, content, 'utf8');
    return { ok: true, file: res.filePath };
  });

  ipcMain.handle('config:get', () => ({ ...config, configFile: CONFIG_FILE }));
  ipcMain.handle('config:reveal-db', () => { shell.showItemInFolder(config.dbPath); return true; });
  ipcMain.handle('config:change-db', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: '选择数据库文件位置',
      defaultPath: config.dbPath,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false };
    db.close();
    config.dbPath = res.filePath;
    saveConfig(config);
    db.init(config.dbPath);
    return { ok: true, dbPath: config.dbPath };
  });

  ipcMain.handle('notes:list', (_e, filter) => db.listNotes(filter));
  ipcMain.handle('notes:get', (_e, id) => db.getNote(id));
  ipcMain.handle('notes:save', (_e, note) => {
    const saved = db.saveNote(note);
    scheduleBackup();
    return saved;
  });
  ipcMain.handle('notes:delete', (_e, id) => db.deleteNote(id));

  ipcMain.handle('trash:list', () => db.listTrash());
  ipcMain.handle('trash:restore', (_e, id) => db.restoreNote(id));
  ipcMain.handle('trash:purge', (_e, id) => db.purgeNote(id));
  ipcMain.handle('notes:versions', (_e, id) => db.noteVersions(id));
  ipcMain.handle('notes:restore-version', (_e, vid) => db.restoreVersion(vid));

  ipcMain.handle('drafts:save', (_e, { key, data }) => db.saveDraft(key, data));
  ipcMain.handle('drafts:get', (_e, key) => db.getDraft(key));
  ipcMain.handle('drafts:clear', (_e, key) => db.clearDraft(key));
  ipcMain.handle('drafts:list', () => db.listDrafts());

  ipcMain.handle('backup:run', () => runBackup(true));
  ipcMain.handle('backup:list', () => listBackups());


  ipcMain.handle('snippets:list', (_e, filter) => db.listSnippets(filter));
  ipcMain.handle('snippets:save', (_e, s) => db.saveSnippet(s));
  ipcMain.handle('snippets:delete', (_e, id) => db.deleteSnippet(id));
  ipcMain.handle('snippets:use', (_e, id) => db.useSnippet(id));

  ipcMain.handle('transfer:export-json', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: '导出数据（JSON）',
      defaultPath: path.join(app.getPath('documents'), `daily-notes-${dateStamp()}.json`),
      filters: [{ name: 'Daily Notes 数据', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false };
    try {
      const r = transfer.exportJson(db.raw(), res.filePath);
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('transfer:pick-json', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择要导入的数据文件',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Daily Notes 数据', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false };
    try {
      const data = transfer.readPackage(res.filePaths[0]);
      return { ok: true, file: res.filePaths[0], exportedAt: data.exportedAt, stats: data.stats };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('transfer:import-json', (_e, file) => {
    try {
      return { ok: true, ...transfer.importJson(db.raw(), transfer.readPackage(file)) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('transfer:export-snapshot', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: '导出完整数据库（可在其他电脑整体恢复）',
      defaultPath: path.join(app.getPath('documents'), `daily-notes-${dateStamp()}.db`),
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false };
    try {
      return { ok: true, ...transfer.exportSnapshot(db.raw(), config.dbPath, res.filePath) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('transfer:pick-snapshot', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择要恢复的数据库文件',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false };
    try {
      const info = transfer.inspectSnapshot(res.filePaths[0]);
      return { ok: true, file: res.filePaths[0], stats: { notes: info.notes.length, snippets: info.snippets.length } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('transfer:restore-snapshot', (_e, file) => {
    try {
      const r = transfer.restoreSnapshot(db.raw(), config.dbPath, file);
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('search:all', (_e, q) => db.searchAll(q));

  ipcMain.handle('templates:list', () => db.listTemplates());
  ipcMain.handle('templates:save', (_e, t) => db.saveTemplate(t));
  ipcMain.handle('templates:delete', (_e, id) => db.deleteTemplate(id));
  ipcMain.handle('templates:render', (_e, c) => db.renderTemplate(c));

  ipcMain.handle('filters:list', () => db.listSavedFilters());
  ipcMain.handle('filters:save', (_e, f) => db.saveSavedFilter(f));
  ipcMain.handle('filters:delete', (_e, id) => db.deleteSavedFilter(id));

  ipcMain.handle('projects:page', (_e, name) => db.getProjectPage(name));
  ipcMain.handle('projects:set-goal', (_e, name, goal) => db.setProjectGoal(name, goal));

  ipcMain.handle('report:weekly', (_e, ws) => db.weeklyReport(ws));

  ipcMain.handle('export:markdown', (_e, opts) => db.exportMarkdown(opts));
  ipcMain.handle('export:html', (_e, opts) => db.exportHtml(opts));

  ipcMain.handle('tasks:thread', (_e, rootId) => db.taskThread(rootId));
  ipcMain.handle('tasks:list', (_e, opts) => db.listTasks(opts));

  ipcMain.handle('meta:projects', () => db.listProjects());
  ipcMain.handle('meta:heatmap', (_e, range) => db.heatmap(range));
  ipcMain.handle('meta:stats', () => db.stats());
  ipcMain.handle('meta:timeline', (_e, opts) => db.timeline(opts));
}

app.on('window-all-closed', () => { /* 常驻托盘，不退出 */ });
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); db.close(); });
