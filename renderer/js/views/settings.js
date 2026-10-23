// 设置视图：数据库位置、自动备份、模板、导出、快捷记录、数据导入导出
import { $, h, toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { app, backup, templates as templatesApi, exporter, quick, transfer } from '../core/api.js';
import { summarize } from '../core/format.js';
import { showModal, closeModal } from '../ui/modal.js';
import { refreshViews } from '../core/registry.js';

export async function loadSettings() {
  const cfg = await app.getConfig();
  $('#set-dbpath').textContent = cfg.dbPath;
  $('#set-config').textContent = `配置文件：${cfg.configFile}`;
  await loadBackups();
  await loadTemplates();
}

// ---------- 自动备份 ----------

async function loadBackups() {
  const list = await backup.list();
  const host = $('#bk-list');
  host.innerHTML = '';
  $('#bk-info').textContent = list.length ? `已保留 ${list.length} 份` : '尚无备份';
  for (const b of list) {
    host.append(h('div', { class: 'bk-item' },
      h('div', {},
        h('div', {
          class: 't mono',
          text: b.name.replace('notes-', '').replace('.db', '')
            .replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5'),
        }),
        h('div', { class: 'hint', text: `${(b.size / 1024).toFixed(0)} KB · ${b.file}` })),
      h('button', { text: '从此备份恢复', onclick: () => restoreFromBackup(b) })));
  }
}

async function restoreFromBackup(b) {
  if (!confirm(`用备份 ${b.name} 覆盖当前数据库？\n当前数据会先自动备份为一份新的备份文件。`)) return;
  const r = await transfer.restoreSnapshot(b.file);
  if (!r.ok) { toast(`恢复失败：${r.error}`); return; }
  toast('已从备份恢复');
  tfNote(`已从备份 ${b.name} 恢复：${r.notes} 条记录、${r.snippets} 条命令。`);
  state.editing = null;
  loadSettings();
  refreshViews('daily');
}

// ---------- 模板 ----------

async function loadTemplates() {
  const list = await templatesApi.list();
  const host = $('#tpl-list');
  host.innerHTML = '';
  if (!list.length) host.append(h('p', { class: 'hint', style: { padding: '8px 18px' }, text: '还没有模板。' }));
  for (const t of list) {
    host.append(h('div', { class: 'bk-item' },
      h('div', {},
        h('div', { class: 't', text: t.name }),
        h('div', { class: 'hint', text: summarize(t.content).slice(0, 60) || '(空模板)' })),
      h('div', { class: 'row-gap' },
        h('button', { text: '编辑', onclick: () => openTemplateModal(t) }),
        h('button', {
          class: 'danger', text: '删除',
          onclick: async () => {
            if (!confirm(`删除模板「${t.name}」？`)) return;
            await templatesApi.remove(t.id);
            loadTemplates();
          },
        }))));
  }
}

function openTemplateModal(t) {
  const nameI = h('input', { type: 'text', value: t?.name || '', placeholder: '模板名称' });
  const ta = h('textarea', {
    class: 'code',
    style: { width: '100%', minHeight: '160px' },
    placeholder: '模板内容，可用变量 {{date}} {{time}} {{week}} {{project}}',
  });
  ta.value = t?.content || '';

  showModal(h('div', {},
    h('h2', { text: t ? '编辑模板' : '新建模板' }),
    h('div', { class: 'field' }, nameI),
    h('div', { class: 'field' }, ta),
    h('div', { class: 'modal-foot' },
      h('button', { text: '取消', onclick: closeModal }),
      h('button', {
        class: 'primary', text: '保存',
        onclick: async () => {
          if (!nameI.value.trim()) { toast('请填写模板名称'); return; }
          await templatesApi.save({ id: t?.id, name: nameI.value.trim(), content: ta.value });
          closeModal();
          toast('已保存');
          loadTemplates();
        },
      }))));
}

// ---------- 通用导出 ----------

export async function doExport(overrides = {}) {
  const opts = {
    dateFrom: $('#ex-from').value,
    dateTo: $('#ex-to').value,
    project: overrides.project !== undefined ? overrides.project : $('#ex-project').value,
  };
  const kind = overrides._kind || 'markdown';
  const content = kind === 'html' ? await exporter.html(opts) : await exporter.markdown(opts);
  const ext = kind === 'html' ? 'html' : 'md';
  const range = `${opts.dateFrom || 'all'}_${opts.dateTo || 'all'}`;
  const res = await app.saveTextFile({
    defaultName: `daily-notes-${range}.${ext}`,
    content,
    filters: kind === 'html'
      ? [{ name: 'HTML', extensions: ['html'] }]
      : [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (res.ok) toast(`已导出 → ${res.file}`);
}

// ---------- 数据导入导出 ----------

const tfNote = (msg) => { $('#tf-note').textContent = msg; };

function refreshAfterTransfer() {
  state.editing = null;
  refreshViews('daily', 'db', 'review', 'projects');
}

async function exportJson() {
  const r = await transfer.exportJson();
  if (!r.ok) return tfNote(r.error ? `导出失败：${r.error}` : '');
  tfNote(`已导出 ${r.notes} 条记录、${r.snippets} 条命令 → ${r.file}`);
  toast('导出完成');
}

async function importJson() {
  const picked = await transfer.pickJson();
  if (!picked.ok) return tfNote(picked.error ? `无法读取文件：${picked.error}` : '');
  if (!confirm(`将导入 ${picked.stats.notes} 条记录、${picked.stats.snippets} 条命令。\n重复内容会自动跳过，已有数据不会改动。继续？`)) return;
  const r = await transfer.importJson(picked.file);
  if (!r.ok) return tfNote(`导入失败：${r.error}`);
  tfNote(`导入完成：新增 ${r.notesAdded} 条记录（跳过重复 ${r.notesSkipped} 条）、新增 ${r.snippetsAdded} 条命令（跳过重复 ${r.snippetsSkipped} 条）。`);
  toast('导入完成');
  refreshAfterTransfer();
}

async function exportSnapshot() {
  const r = await transfer.exportSnapshot();
  if (!r.ok) return tfNote(r.error ? `导出失败：${r.error}` : '');
  tfNote(`已导出整库（${(r.size / 1024).toFixed(0)} KB）→ ${r.file}`);
  toast('整库已导出');
}

async function restoreSnapshot() {
  const picked = await transfer.pickSnapshot();
  if (!picked.ok) return tfNote(picked.error ? `无法读取文件：${picked.error}` : '');
  if (!confirm(`确定用该文件覆盖本机数据吗？\n文件内含 ${picked.stats.notes} 条记录、${picked.stats.snippets} 条命令。\n当前数据库会先自动备份，之后可手动找回。`)) return;
  const r = await transfer.restoreSnapshot(picked.file);
  if (!r.ok) return tfNote(`恢复失败：${r.error}`);
  tfNote(`整库已恢复：${r.notes} 条记录、${r.snippets} 条命令。原数据备份于 ${r.backup}`);
  toast('整库已恢复');
  refreshAfterTransfer();
}

// ---------- 初始化 ----------

export function initSettingsView() {
  $('#bk-now').addEventListener('click', async () => {
    const r = await backup.run();
    if (r.ok) { toast('备份完成'); loadBackups(); } else toast(`备份失败：${r.error}`);
  });

  $('#set-reveal').addEventListener('click', () => app.revealDb());
  $('#set-change').addEventListener('click', async () => {
    const r = await app.changeDb();
    if (!r.ok) return;
    toast('数据库位置已更改');
    loadSettings();
    state.editing = null;
    refreshViews('daily');
  });

  $('#tpl-new').addEventListener('click', () => openTemplateModal(null));
  $('#ex-md').addEventListener('click', () => doExport({ _kind: 'markdown' }));
  $('#ex-html').addEventListener('click', () => doExport({ _kind: 'html' }));

  const hotkeyBtn = $('#hotkey-toggle');
  hotkeyBtn.addEventListener('click', async () => {
    const on = hotkeyBtn.textContent.includes('已开启');
    const r = await quick.setHotkey(!on);
    if (r.ok) hotkeyBtn.textContent = on ? '快捷键：已关闭' : '快捷键：已开启';
    else toast(`设置失败：${r.error}`);
  });
  quick.setHotkey(true);

  $('#tf-export-json').addEventListener('click', exportJson);
  $('#tf-import-json').addEventListener('click', importJson);
  $('#tf-export-db').addEventListener('click', exportSnapshot);
  $('#tf-restore-db').addEventListener('click', restoreSnapshot);
}
