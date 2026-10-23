const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  notes: {
    list: (f) => ipcRenderer.invoke('notes:list', f),
    get: (id) => ipcRenderer.invoke('notes:get', id),
    save: (n) => ipcRenderer.invoke('notes:save', n),
    remove: (id) => ipcRenderer.invoke('notes:delete', id),
  },
  snippets: {
    list: (f) => ipcRenderer.invoke('snippets:list', f),
    save: (s) => ipcRenderer.invoke('snippets:save', s),
    remove: (id) => ipcRenderer.invoke('snippets:delete', id),
    use: (id) => ipcRenderer.invoke('snippets:use', id),
  },
  meta: {
    projects: () => ipcRenderer.invoke('meta:projects'),
    heatmap: (range) => ipcRenderer.invoke('meta:heatmap', range),
    stats: () => ipcRenderer.invoke('meta:stats'),
    timeline: (opts) => ipcRenderer.invoke('meta:timeline', opts),
  },
  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    restore: (id) => ipcRenderer.invoke('trash:restore', id),
    purge: (id) => ipcRenderer.invoke('trash:purge', id),
  },
  versions: {
    list: (noteId) => ipcRenderer.invoke('notes:versions', noteId),
    restore: (vid) => ipcRenderer.invoke('notes:restore-version', vid),
  },
  drafts: {
    save: (key, data) => ipcRenderer.invoke('drafts:save', { key, data }),
    get: (key) => ipcRenderer.invoke('drafts:get', key),
    clear: (key) => ipcRenderer.invoke('drafts:clear', key),
    list: () => ipcRenderer.invoke('drafts:list'),
  },
  backup: {
    run: () => ipcRenderer.invoke('backup:run'),
    list: () => ipcRenderer.invoke('backup:list'),
  },
  tasks: {
    thread: (rootId) => ipcRenderer.invoke('tasks:thread', rootId),
    list: (opts) => ipcRenderer.invoke('tasks:list', opts),
  },
  search: {
    all: (q) => ipcRenderer.invoke('search:all', q),
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (t) => ipcRenderer.invoke('templates:save', t),
    remove: (id) => ipcRenderer.invoke('templates:delete', id),
    render: (c) => ipcRenderer.invoke('templates:render', c),
  },
  filters: {
    list: () => ipcRenderer.invoke('filters:list'),
    save: (f) => ipcRenderer.invoke('filters:save', f),
    remove: (id) => ipcRenderer.invoke('filters:delete', id),
  },
  projectPage: {
    get: (name) => ipcRenderer.invoke('projects:page', name),
    setGoal: (name, goal) => ipcRenderer.invoke('projects:set-goal', name, goal),
  },
  report: {
    weekly: (ws) => ipcRenderer.invoke('report:weekly', ws),
  },
  exporter: {
    markdown: (opts) => ipcRenderer.invoke('export:markdown', opts),
    html: (opts) => ipcRenderer.invoke('export:html', opts),
  },
  quick: {
    toggle: () => ipcRenderer.invoke('app:global-quick'),
    setHotkey: (on) => ipcRenderer.invoke('app:set-quick-hotkey', on),
  },
  transfer: {
    exportJson: () => ipcRenderer.invoke('transfer:export-json'),
    pickJson: () => ipcRenderer.invoke('transfer:pick-json'),
    importJson: (file) => ipcRenderer.invoke('transfer:import-json', file),
    exportSnapshot: () => ipcRenderer.invoke('transfer:export-snapshot'),
    pickSnapshot: () => ipcRenderer.invoke('transfer:pick-snapshot'),
    restoreSnapshot: (file) => ipcRenderer.invoke('transfer:restore-snapshot', file),
  },
  app: {
    saveTextFile: (opts) => ipcRenderer.invoke('app:save-text-file', opts),
    closeWindow: () => ipcRenderer.invoke('app:close-window'),
    quit: () => ipcRenderer.invoke('app:quit'),
    getConfig: () => ipcRenderer.invoke('config:get'),
    revealDb: () => ipcRenderer.invoke('config:reveal-db'),
    changeDb: () => ipcRenderer.invoke('config:change-db'),
  },
});
