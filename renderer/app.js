const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const bridge = window.api;

const state = {
  view: 'daily',
  dailyDate: todayStr(),
  editing: null,
  dbMode: 'table',
  dbFilters: { q: '', project: '', done: '', status: '', dateFrom: '', dateTo: '', dueBefore: '' },
  calMonth: new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1),
  snFilters: { q: '', language: '' },
  dirty: false,
  tableCols: ['status', 'date', 'project', 'title', 'content', 'due', 'tags'],
  tableSort: null,
  boardDim: 'project',
};

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function h(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 1600);
}
const weekday = ['日', '一', '二', '三', '四', '五', '六'];
function weekdayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : '周' + weekday[d.getDay()];
}

// ---------- 导航 ----------
function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + view));
  if (view === 'db') loadDb();
  if (view === 'projects') loadProjects();
  if (view === 'snippets') loadSnippets();
  if (view === 'review') loadReview();
  if (view === 'settings') { loadSettings(); loadTemplates(); }
  if (view === 'daily') loadDaily();
}
$$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

// ---------- 每日记录 ----------
async function loadDaily() {
  const notes = await bridge.notes.list({});
  const byDate = new Map();
  for (const n of notes) {
    if (!byDate.has(n.date)) byDate.set(n.date, []);
    byDate.get(n.date).push(n);
  }
  $('#daily-sub').textContent = `共 ${notes.length} 条记录 · ${byDate.size} 天 · 连续 ${state.streak ?? '-'} 天`;
  const list = $('#daily-list');
  list.innerHTML = '';
  if (!byDate.size) {
    list.append(h('div', { class: 'empty', text: '还没有记录，点击右上角新建。' }));
  }
  for (const [date, items] of [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const doneCount = items.filter((i) => i.done).length;
    const group = h('div', { class: 'day-group' },
      h('div', { class: 'day-group-head' },
        h('span', { class: 'day-date' }, date, h('span', { class: 'day-weekday', text: weekdayOf(date) })),
        h('span', { class: 'day-progress', text: `${doneCount}/${items.length}` }),
        h('button', {
          class: 'day-add', title: '在这天新建记录', text: '+',
          onclick: (e) => { e.stopPropagation(); startNewNote(date); },
        }),
      ),
    );
    for (const n of items) {
      const snippet = summarize(n.content).slice(0, 40);
      const card = h('div', {
        class: 'note-row' + (state.editing?.id === n.id ? ' active' : ''),
        'data-note-id': String(n.id),
        onclick: () => openNoteEditor(n),
      },
        statusTag(n),
        h('span', { class: 'note-row-title', text: n.title || snippet || '(无标题)' }),
        n.project ? h('span', { class: 'tag project', text: n.project }) : null,
        h('span', { class: 'note-row-time', text: n.startTime || '' }),
      );
      group.append(card);
    }
    list.append(group);
  }
  const stats = await bridge.meta.stats();
  state.streak = stats.streak;
  $('#daily-sub').textContent = `共 ${stats.total} 条记录 · ${stats.activeDays} 天 · 连续 ${stats.streak} 天`;
  // 仅在“没有正在编辑的记录”时恢复默认视图；正在编辑新记录（id 为空）时不重建，避免打断编辑
  if (state.editing === null) {
    const todays = byDate.get(state.dailyDate);
    if (todays?.length) openNoteEditor(todays[0], { keepList: true });
    else startNewNote(state.dailyDate, { keepList: true });
  }
}

async function openDateEditor(date) {
  const notes = await bridge.notes.list({ dateFrom: date, dateTo: date });
  if (notes.length) openNoteEditor(notes[0]);
  else startNewNote(date);
}

async function startNewNote(date, opts = {}) {
  state.editing = {
    id: null, date: date || state.dailyDate, project: '', title: '', content: '',
    contentHtml: '', done: false, startTime: '', finishTime: '', remark: '', contentJson: '',
  };
  await renderNoteEditor(opts.keepList);
}

let rendering = false;
const STATUS = {
  todo: { label: '待办', cls: 'st-todo' },
  doing: { label: '进行中', cls: 'st-doing' },
  blocked: { label: '受阻', cls: 'st-blocked' },
  done: { label: '已完成', cls: 'st-done' },
};
function statusTag(n) {
  const s = STATUS[n.status] || (n.done ? STATUS.done : null);
  return s ? h('span', { class: 'tag ' + s.cls, text: s.label }) : null;
}

async function renderNoteEditor(keepList) {
  if (rendering) return;
  rendering = true;
  try {
    const n = state.editing;
  const host = $('#daily-editor');
  host.innerHTML = '';
  state.autoSave = { timer: null, dirty: false, base: JSON.stringify([n.title, n.content, n.remark]) };

  const projectList = $('#project-options') || document.createElement('datalist');
  const titleInput = h('input', { type: 'text', placeholder: '标题（可选）', value: n.title, oninput: (e) => (n.title = e.target.value) });
  const projectInput = h('input', { type: 'text', list: 'project-options', placeholder: '关联项目', value: n.project, oninput: (e) => (n.project = e.target.value) });
  const dateInput = h('input', { type: 'date', value: n.date || todayStr(), onchange: (e) => (n.date = e.target.value) });
  const startInput = h('input', { type: 'time', value: n.startTime, onchange: (e) => (n.startTime = e.target.value) });
  const finishInput = h('input', { type: 'time', value: n.finishTime, onchange: (e) => (n.finishTime = e.target.value) });
  const statusSel = h('select', {}, ...Object.entries(STATUS).map(([v, s]) => h('option', { value: v, text: s.label })));
  statusSel.value = n.status || (n.done ? 'done' : 'todo');
  statusSel.addEventListener('change', () => { n.status = statusSel.value; n.done = statusSel.value === 'done'; });
  const dueInput = h('input', { type: 'date', value: n.dueDate || '', onchange: (e) => (n.dueDate = e.target.value) });
  const templateSel = h('select', {}, h('option', { value: '', text: '插入模板…' }));
  const remarkInput = h('textarea', { rows: 2, placeholder: '备注', oninput: (e) => (n.remark = e.target.value) });
  remarkInput.value = n.remark;

  // 任务线程提示：该记录属于哪个跨天任务
  let threadBar = null;
  if (n.rootId && n.rootId !== n.id) {
    threadBar = h('div', { class: 'thread-bar' },
      h('span', { text: `⤷ 延续任务「${n.title || '（加载中…）'}」` }),
      h('button', { text: '查看任务脉络', onclick: () => openTaskThread(n.rootId) }),
    );
  } else if (n.id) {
    bridge.tasks.thread(n.rootId || n.id).then((th) => {
      if (th.records.length > 1) {
        const bar = h('div', { class: 'thread-bar' },
          h('span', { text: `⤷ 任务已延续 ${th.days} 天（${th.startedOn} → ${th.lastActive}），共 ${th.records.length} 条记录` }),
          h('button', { text: '查看任务脉络', onclick: () => openTaskThread(th.rootId) }),
        );
        host.querySelector('.daily-editor-meta')?.prepend(bar);
      }
    });
  }

  const metaArea = h('div', { class: 'daily-editor-meta' },
    threadBar ? threadBar : '',
    h('div', { class: 'field-grid' },
      h('div', { class: 'field' }, h('label', { text: '日期' }), dateInput),
      h('div', { class: 'field' }, h('label', { text: '关联项目' }), projectInput),
      h('div', { class: 'field' }, h('label', { text: '任务状态' }), statusSel),
      h('div', { class: 'field' }, h('label', { text: '截止日期' }), dueInput),
      h('div', { class: 'field' }, h('label', { text: '开始时间' }), startInput),
      h('div', { class: 'field' }, h('label', { text: '完成时间' }), finishInput),
      h('div', { class: 'field' }, h('label', { text: '模板' }), templateSel),
      h('div', { class: 'field remark-field' }, h('label', { text: '备注' }), remarkInput),
    ),
  );

  host.append(
    h('div', { class: 'daily-editor-head' }, h('div', { class: 'field title' }, titleInput)),
    metaArea,
  );

  bridge.templates.list().then((tpls) => {
    for (const t of tpls) templateSel.append(h('option', { value: t.id, text: t.name }));
  });
  templateSel.addEventListener('change', async () => {
    if (!templateSel.value) return;
    const t = (await bridge.templates.list()).find((x) => String(x.id) === templateSel.value);
    templateSel.value = '';
    if (!t) return;
    const rendered = await bridge.templates.render(t.content);
    editor.insertHtml(rendered.replace(/\n/g, '<br>'));
  });

  const editorHost = h('div', { class: 'editor-host' });
  const editor = window.RichMedia.createEditor(editorHost, { html: n.contentHtml, json: n.contentJson });
  host.append(h('div', { class: 'daily-editor-body' },
    h('div', { class: 'field' }, h('label', { text: '工作内容' })),
    editorHost,
  ));

  const saveStatus = h('span', { class: 'hint save-status', text: n.id ? `更新于 ${n.updatedAt}` : '新记录（输入后自动保存）' });
  host.append(h('div', { class: 'daily-editor-foot editor-foot' },
    h('div', { class: 'row-gap', style: { alignItems: 'center', gap: '10px' } },
      saveStatus,
      n.id ? h('button', { text: '历史版本', onclick: () => openVersionHistory(n.id) }) : null,
    ),
    h('div', { class: 'row-gap' },
      n.id ? h('button', { text: '删除', onclick: async () => {
        if (!confirm('删除这条记录？可在回收站恢复（保留 30 天）。')) return;
        await bridge.notes.remove(n.id);
        toast('已移入回收站');
        state.editing = null;
        loadDaily();
        reloadIfActive('db');
      } }) : null,
      h('button', { text: '保存', class: 'primary', onclick: () => saveNote(true) }),
    ),
  ));

  function currentPayload() {
    const v = editor.getValue();
    return { ...n, content: v.text, contentHtml: v.html, contentJson: v.json };
  }

  async function saveNote(manual = false) {
    // 保存进行中再次触发（如连续输入）时跳过，避免并发新增
    if (state.autoSave.saving) return;
    state.autoSave.saving = true;
    try {
      const payload = currentPayload();
      const saved = await bridge.notes.save(payload);
      // 关键：把新 id 回写到闭包对象 n，否则后续保存仍按“新增”处理而重复建记录
      Object.assign(n, saved);
      state.editing = n;
      state.autoSave.dirty = false;
      state.autoSave.base = JSON.stringify([n.title, n.content, n.remark]);
      saveStatus.textContent = `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
      if (manual) toast('已保存');
      await bridge.drafts.clear(draftKey());
      await loadDaily();
      reloadIfActive('db');
    } finally {
      state.autoSave.saving = false;
    }
  }

  const draftKey = () => `note:${n.id || `new-${n.date}`}`;

  // 停止输入 2 秒自动保存；有改动即写草稿，崩溃后可恢复
  function queueAutoSave() {
    const snapshot = JSON.stringify([n.title, n.content, n.remark, editor.getValue().html]);
    if (snapshot === state.autoSave.base) return;
    state.autoSave.dirty = true;
    saveStatus.textContent = '有未保存修改…';
    clearTimeout(state.autoSave.timer);
    bridge.drafts.save(draftKey(), currentPayload());
    state.autoSave.timer = setTimeout(() => saveNote(false), 2000);
  }
  for (const inp of [titleInput, remarkInput]) inp.addEventListener('input', queueAutoSave);
  for (const inp of [dateInput, startInput, finishInput, projectInput, dueInput]) inp.addEventListener('change', queueAutoSave);
  statusSel.addEventListener('change', queueAutoSave);
  editorHost.addEventListener('input', queueAutoSave);

  editorHost.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveNote(true); }
  });
  state.saveCurrent = saveNote;
  state.currentDraftKey = draftKey;
    await loadDaily();
    rendering = false;
    restoreDraftIfAny({ n, editor, saveStatus, onAccept: queueAutoSave, inputs: { titleInput, remarkInput, dateInput, startInput, finishInput } });
  } catch (e) { rendering = false; }
}

// 崩溃/异常退出后的草稿恢复：仅当草稿与当前内容不同时提示
async function restoreDraftIfAny({ n, editor, saveStatus, onAccept, inputs }) {
  const key = state.currentDraftKey();
  const d = await bridge.drafts.get(key);
  if (!d) return;
  const same = (d.data.contentHtml || '') === (n.contentHtml || '')
    && (d.data.title || '') === (n.title || '')
    && (d.data.remark || '') === (n.remark || '');
  if (same) { await bridge.drafts.clear(key); return; }
  const bar = h('div', { class: 'draft-bar' },
    h('span', { text: `检测到未保存的草稿（${d.savedAt}），可能是上次未正常退出遗留。` }),
    h('div', { class: 'row-gap' },
      h('button', { text: '恢复草稿', class: 'primary', onclick: async () => {
        editor.setValue(d.data.contentHtml, d.data.contentJson);
        for (const k of ['title', 'remark', 'date', 'startTime', 'finishTime']) {
          const v = d.data[k] || '';
          const inputKey = k === 'startTime' ? 'startInput' : k === 'finishTime' ? 'finishInput' : k + 'Input';
          if (inputs[inputKey]) inputs[inputKey].value = v;
          n[k] = v;
        }
        bar.remove();
        onAccept();
      } }),
      h('button', { text: '丢弃', onclick: async () => { await bridge.drafts.clear(key); bar.remove(); } }),
    ),
  );
  $('#daily-editor .daily-editor-head')?.after(bar);
}

async function openVersionHistory(noteId) {
  const versions = await bridge.versions.list(noteId);
  const body = h('div');
  body.append(h('h2', { text: '历史版本' }));
  if (!versions.length) body.append(h('p', { class: 'hint', text: '还没有历史版本。每次修改内容后都会自动留档（保留最近 20 个）。' }));
  const list = h('div', { class: 'ver-list' });
  for (const v of versions) {
    const item = h('div', { class: 'ver-item' },
      h('div', { class: 'ver-head' },
        h('span', { class: 'mono', text: v.savedAt }),
        h('div', { class: 'row-gap' },
          h('button', { text: '查看', onclick: () => {
            previewHost.innerHTML = '';
            const clone = h('div', { class: 'rte', contenteditable: 'false' });
            clone.innerHTML = v.note.contentHtml || `<div>${esc(v.note.content)}</div>`;
            previewHost.append(clone);
          } }),
          h('button', { text: '恢复此版本', onclick: async () => {
            if (!confirm('恢复到该版本？当前内容会先自动存入历史，不会丢失。')) return;
            await bridge.versions.restore(v.id);
            closeModal();
            toast('已恢复');
            state.editing = null;
            loadDaily();
          } }),
        ),
      ),
      h('div', { class: 'ver-snip', text: (v.note.title ? v.note.title + ' — ' : '') + summarize(v.note.content).slice(0, 80) }),
    );
    list.append(item);
  }
  const previewHost = h('div', { class: 'ver-preview' });
  if (versions.length) body.append(h('div', { class: 'ver-split' }, list, previewHost));
  else body.append(list);
  showModal(body);
}

// 任务脉络：同一任务的跨天记录时间线
async function openTaskThread(rootId) {
  const th = await bridge.tasks.thread(rootId);
  const body = h('div');
  body.append(
    h('h2', { text: `任务脉络：${th.title || '(无标题)'}` }),
    h('p', { class: 'hint' },
      `${th.project || '未分项目'} · ${th.startedOn} 开始，最近活动 ${th.lastActive} · ${th.days} 天 · ${th.records.length} 条记录 · 当前${STATUS[th.status]?.label || th.status}`),
  );
  for (const r of th.records) {
    body.append(h('div', { class: 'task-row', style: { cursor: 'pointer' }, onclick: () => { closeModal(); openRecordModal(r); } },
      h('span', { class: 'hint mono', text: r.date }),
      statusTag(r),
      h('span', { class: 'task-t', text: r.title }),
    ));
  }
  body.append(h('div', { class: 'modal-foot' },
    h('button', { text: '关闭', onclick: closeModal }),
    th.status !== 'done' ? h('button', { class: 'primary', text: '今天继续记录', onclick: async () => {
      const last = th.records[th.records.length - 1];
      await bridge.notes.save({
        date: todayStr(), project: th.project, title: th.title, content: '', contentHtml: '', contentJson: '',
        rootId: th.rootId, status: last.status, dueDate: th.dueDate,
      });
      closeModal();
      toast('已创建今天的延续记录');
      if (state.view === 'daily') loadDaily();
      else { switchView('daily'); }
    } }) : null,
  ));
  showModal(body);
}

async function openNoteEditor(note, opts = {}) {
  state.editing = { ...note };
  await renderNoteEditor(opts.keepList);
  highlightActiveRow();
}

// 回收站：最近 30 天内删除的记录，可恢复或彻底删除
async function openTrash() {
  const items = await bridge.trash.list();
  const body = h('div');
  body.append(h('h2', { text: `回收站（${items.length}）` }), h('p', { class: 'hint', text: '删除的记录保留 30 天，之后自动清除。' }));
  if (!items.length) body.append(h('p', { class: 'empty', text: '回收站是空的。' }));
  const list = h('div', { class: 'trash-list' });
  for (const it of items) {
    const days = Math.floor((Date.now() - new Date(it.deletedAt.replace(' ', 'T')).getTime()) / 86400000);
    list.append(h('div', { class: 'trash-item' },
      h('div', {},
        h('div', { class: 't', text: it.title || summarize(it.content).slice(0, 40) || '(无标题)' }),
        h('div', { class: 'hint', text: `${it.date} · ${it.project || '未分项目'} · 删除于 ${it.deletedAt}（${days} 天前）` })),
      h('div', { class: 'row-gap' },
        h('button', { text: '恢复', onclick: async () => {
          await bridge.trash.restore(it.id);
          toast('已恢复');
          openTrash();
          refreshAfterTransfer();
        } }),
        h('button', { class: 'danger', text: '彻底删除', onclick: async () => {
          if (!confirm('彻底删除后无法恢复，确定？')) return;
          await bridge.trash.purge(it.id);
          openTrash();
        } }),
      ),
    ));
  }
  body.append(list);
  showModal(body);
}

$('#db-trash').addEventListener('click', openTrash);

// ---------- 统一搜索（Ctrl+K） ----------
const gsInput = $('#gs-q');
const gsResults = $('#gs-results');
gsInput.addEventListener('input', debounce(async () => {
  const q = gsInput.value.trim();
  if (!q) { gsResults.classList.add('hidden'); gsResults.innerHTML = ''; return; }
  const { notes, snippets } = await bridge.search.all(q);
  gsResults.innerHTML = '';
  if (!notes.length && !snippets.length) {
    gsResults.append(h('div', { class: 'gs-empty', text: '没有匹配结果' }));
  }
  for (const n of notes.slice(0, 8)) {
    gsResults.append(h('div', { class: 'gs-item', onclick: () => { gsResults.classList.add('hidden'); openRecordModal(n); } },
      h('span', { class: 'tag st-todo', text: '记录' }),
      h('span', { class: 'gs-t', text: n.title || summarize(n.content).slice(0, 30) }),
      h('span', { class: 'gs-snip', text: snippetAround(n.content, q, 24) }),
      h('span', { class: 'hint', text: n.date }),
    ));
  }
  for (const s of snippets.slice(0, 8)) {
    gsResults.append(h('div', { class: 'gs-item', onclick: async () => {
      gsResults.classList.add('hidden');
      switchView('snippets');
      $('#sn-q').value = s.title; $('#sn-q').dispatchEvent(new Event('input'));
    } },
      h('span', { class: 'tag st-doing', text: '命令' }),
      h('span', { class: 'gs-t', text: s.title || s.command.slice(0, 30) }),
      h('span', { class: 'gs-snip mono', text: snippetAround(s.command, q, 24) }),
    ));
  }
  gsResults.classList.remove('hidden');
}));
gsInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { gsResults.classList.add('hidden'); gsInput.blur(); } });
document.addEventListener('click', (e) => { if (!e.target.closest('#global-search')) gsResults.classList.add('hidden'); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); gsInput.focus(); gsInput.select(); }
});
function snippetAround(text, q, width = 40) {
  const i = (text || '').indexOf(q);
  if (i < 0) return text.slice(0, width * 2);
  const start = Math.max(0, i - width);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + width) + (i + q.length + width < text.length ? '…' : '');
}

// ---------- 项目主页 ----------
let currentProject = '';
async function loadProjects() {
  const projects = await bridge.meta.projects();
  const list = $('#proj-list');
  list.innerHTML = '';
  if (!projects.length) list.append(h('div', { class: 'empty', text: '还没有项目。在每日记录里填写「关联项目」即可创建。' }));
  if (!currentProject && projects.length) currentProject = projects[0].project;
  for (const p of projects) {
    list.append(h('div', { class: 'proj-item' + (p.project === currentProject ? ' active' : ''), onclick: () => { currentProject = p.project; loadProjects(); } },
      h('div', { class: 't', text: p.project }),
      h('div', { class: 'hint', text: `${p.count} 条记录` }),
    ));
  }
  if (currentProject) renderProjectPage(currentProject);
}

async function renderProjectPage(name) {
  const page = await bridge.projectPage.get(name);
  const host = $('#proj-page');
  host.innerHTML = '';
  host.append(
    h('div', { class: 'row-gap', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('h2', { text: name, style: { margin: 0 } }),
      h('button', { text: '导出该项目', onclick: () => doExport({ project: name }) }),
    ),
    h('textarea', { rows: 2, placeholder: '项目目标（点击编辑，自动保存）', onchange: async (e) => { await bridge.projectPage.setGoal(name, e.target.value); toast('已保存'); } , oninput: (e) => {} }),
  );
  host.querySelector('textarea').value = page.goal;
  const statRow = h('div', { class: 'stat-row', style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
    ...[['总记录', page.stats.total], ['已完成', page.stats.done], ['逾期任务', page.stats.overdue], ['活跃天数', page.stats.activeDays]]
      .map(([k, v]) => h('div', { class: 'stat' }, h('div', { class: 'v', text: v }), h('div', { class: 'k', text: k }))),
  );
  host.append(statRow);

  const taskPanel = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', { text: `未完成任务（${page.openTasks.length}）` })),
    h('div', { style: { padding: '8px 18px 14px' } },
      ...page.openTasks.map((n) => h('div', { class: 'task-row' },
        statusTag(n),
        h('span', { class: 'task-t', text: n.title || summarize(n.content).slice(0, 40) }),
        n.dueDate ? h('span', { class: 'tag' + (n.dueDate < todayStr() ? ' overdue' : ''), text: `截止 ${n.dueDate}` }) : null,
        h('span', { class: 'hint', text: n.date }),
        h('button', { text: '任务脉络', onclick: (e) => { e.stopPropagation(); openTaskThread(n.rootId || n.id); } }),
        h('button', { text: '今天继续', onclick: async (e) => {
          e.stopPropagation();
          // 在原任务线程上追加今天的记录：历史保留，任务向前推进
          await bridge.notes.save({
            date: todayStr(), project: n.project, title: n.title || '', content: '', contentHtml: '', contentJson: '',
            rootId: n.rootId || n.id, status: n.status || 'todo', dueDate: n.dueDate,
          });
          toast('已在任务上追加今天的记录');
          currentProject = name; loadProjects();
        } }),
      )),
      !page.openTasks.length ? h('p', { class: 'hint', text: '全部完成。' }) : null,
    ),
  );
  host.append(taskPanel);

  const recent = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', { text: '最近记录' })),
    h('div', { style: { padding: '8px 18px 14px' } },
      ...page.notes.slice(0, 10).map((n) => h('div', { class: 'task-row', style: { cursor: 'pointer' }, onclick: () => openRecordModal(n) },
        h('span', { class: 'hint', text: n.date }),
        h('span', { class: 'task-t', text: n.title || summarize(n.content).slice(0, 50) }),
        statusTag(n),
      )),
    ),
  );
  host.append(recent);

  if (page.snippets.length) {
    host.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: '相关命令' })),
      h('div', { style: { padding: '8px 18px 14px' } },
        ...page.snippets.slice(0, 5).map((s) => h('div', { class: 'task-row' },
          h('span', { class: 'mono', text: s.command.slice(0, 60) }),
          h('span', { class: 'hint', text: s.language }),
        )),
      ),
    ));
  }
}

// ---------- 周报 ----------
$('#rv-weekly').addEventListener('click', async () => {
  const r = await bridge.report.weekly();
  const body = h('div');
  body.append(h('h2', { text: `周报 ${r.start} ~ ${r.endDate}` }), h('p', { class: 'hint', text: `共 ${r.totals.records} 条记录，完成 ${r.totals.done} 条。条目可点击跳回原始记录。` }));
  if (!r.projects.length) body.append(h('p', { class: 'empty', text: '本周暂无记录。' }));
  for (const p of r.projects) {
    body.append(h('h3', { text: p.name, style: { margin: '14px 0 6px' } }));
    if (p.doneItems.length) {
      body.append(h('p', { class: 'hint', text: '本周成果：' }));
      const ul = h('ul', { style: { margin: '4px 0' } });
      for (const it of p.doneItems) {
        ul.append(h('li', { style: { cursor: 'pointer' }, onclick: () => jumpToRecord(it) },
          h('span', { text: `${it.title}${it.date ? `（${it.date}）` : ''}` }),
          h('span', { class: 'hint', text: ' ↗' })));
      }
      body.append(ul);
    }
    if (p.openItems.length) {
      body.append(h('p', { class: 'hint', text: '未完成事项（可作为下周计划）：' }));
      const ul = h('ul', { style: { margin: '4px 0' } });
      for (const it of p.openItems) {
        ul.append(h('li', { style: { cursor: 'pointer' }, onclick: () => jumpToRecord(it) },
          h('span', { text: `${it.title}${it.dueDate ? `（截止 ${it.dueDate}）` : ''}` }),
          h('span', { class: 'hint', text: ' ↗' })));
      }
      body.append(ul);
    }
  }
  const ta = h('textarea', { class: 'code', style: { width: '100%', minHeight: '260px', marginTop: '10px' } });
  ta.value = weeklyToMarkdown(r);
  ta.addEventListener('input', () => { ta.dataset.edited = '1'; });
  body.append(h('p', { class: 'hint', text: 'Markdown 源文本（可直接编辑，改后以你编辑的为准复制）：' }), ta,
    h('div', { class: 'modal-foot' },
      h('button', { text: '复制全文', onclick: async () => { await navigator.clipboard.writeText(ta.value); toast('已复制'); } }),
      h('button', { class: 'primary', text: '关闭', onclick: closeModal })));
  showModal(body, true);
});

// 周报条目跳回原始记录
async function jumpToRecord(it) {
  if (!it.id) return;
  closeModal();
  openRecordModal(await bridge.notes.get(it.id));
}

function weeklyToMarkdown(r) {
  const lines = [`# 周报 ${r.start} ~ ${r.endDate}`, '', `共 ${r.totals.records} 条记录，完成 ${r.totals.done} 条。`, ''];
  for (const p of r.projects) {
    lines.push(`## ${p.name}`, '');
    if (p.doneItems.length) {
      lines.push('**本周成果**', '');
      for (const it of p.doneItems) lines.push(`- ${it.title}${it.date ? `（${it.date}）` : ''}`);
      lines.push('');
    }
    if (p.openItems.length) {
      lines.push('**未完成 / 下周计划**', '');
      for (const it of p.openItems) lines.push(`- [ ] ${it.title}${it.dueDate ? `（截止 ${it.dueDate}）` : ''}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------- 模板管理 ----------
async function loadTemplates() {
  const list = await bridge.templates.list();
  const host = $('#tpl-list');
  host.innerHTML = '';
  if (!list.length) host.append(h('p', { class: 'hint', style: { padding: '8px 18px' }, text: '还没有模板。' }));
  for (const t of list) {
    host.append(h('div', { class: 'bk-item' },
      h('div', {}, h('div', { class: 't', text: t.name }), h('div', { class: 'hint', text: summarize(t.content).slice(0, 60) || '(空模板)' })),
      h('div', { class: 'row-gap' },
        h('button', { text: '编辑', onclick: () => openTemplateModal(t) }),
        h('button', { class: 'danger', text: '删除', onclick: async () => {
          if (!confirm(`删除模板「${t.name}」？`)) return;
          await bridge.templates.remove(t.id);
          loadTemplates();
        } }),
      ),
    ));
  }
}

function openTemplateModal(t) {
  const nameI = h('input', { type: 'text', value: t?.name || '', placeholder: '模板名称' });
  const ta = h('textarea', { class: 'code', style: { width: '100%', minHeight: '160px' }, placeholder: '模板内容，可用变量 {{date}} {{time}} {{week}} {{project}}' });
  ta.value = t?.content || '';
  showModal(h('div', {},
    h('h2', { text: t ? '编辑模板' : '新建模板' }),
    h('div', { class: 'field' }, nameI),
    h('div', { class: 'field' }, ta),
    h('div', { class: 'modal-foot' },
      h('button', { text: '取消', onclick: closeModal }),
      h('button', { class: 'primary', text: '保存', onclick: async () => {
        if (!nameI.value.trim()) { toast('请填写模板名称'); return; }
        await bridge.templates.save({ id: t?.id, name: nameI.value.trim(), content: ta.value });
        closeModal(); toast('已保存'); loadTemplates();
      } })),
  ));
}
$('#tpl-new').addEventListener('click', () => openTemplateModal(null));

// ---------- 通用导出 ----------
async function doExport(overrides = {}) {
  const opts = {
    dateFrom: $('#ex-from').value,
    dateTo: $('#ex-to').value,
    project: overrides.project !== undefined ? overrides.project : $('#ex-project').value,
  };
  const kind = overrides._kind || 'markdown';
  const content = kind === 'html' ? await bridge.exporter.html(opts) : await bridge.exporter.markdown(opts);
  const ext = kind === 'html' ? 'html' : 'md';
  const range = `${opts.dateFrom || 'all'}_${opts.dateTo || 'all'}`;
  const res = await bridge.app.saveTextFile({
    defaultName: `daily-notes-${range}.${ext}`,
    content,
    filters: kind === 'html' ? [{ name: 'HTML', extensions: ['html'] }] : [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (res.ok) toast(`已导出 → ${res.file}`);
}
$('#ex-md').addEventListener('click', () => doExport({ _kind: 'markdown' }));
$('#ex-html').addEventListener('click', () => doExport({ _kind: 'html' }));

// ---------- 快捷记录开关 ----------
const hotkeyBtn = $('#hotkey-toggle');
hotkeyBtn.addEventListener('click', async () => {
  const on = hotkeyBtn.textContent.includes('已开启');
  const r = await bridge.quick.setHotkey(!on);
  if (r.ok) hotkeyBtn.textContent = on ? '快捷键：已关闭' : '快捷键：已开启';
  else toast(`设置失败：${r.error}`);
});
bridge.quick.setHotkey(true);

// ---------- 数据库 ----------
function debounce(fn, ms = 220) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function fillProjectSelect(select, keep = true) {
  const projects = await bridge.meta.projects();
  const cur = select.value;
  select.innerHTML = '<option value="">全部项目</option>' +
    projects.map((p) => `<option value="${esc(p.project)}">${esc(p.project)} (${p.count})</option>`).join('');
  if (keep && cur) select.value = cur;
}

async function loadDb() {
  loadSavedFilters();
  await fillProjectSelect($('#db-project'));
  await renderDb();
  const dl = $('#project-options') || h('datalist', { id: 'project-options' });
  const projects = await bridge.meta.projects();
  dl.innerHTML = projects.map((p) => `<option value="${esc(p.project)}">`).join('');
  if (!dl.parentNode) document.body.append(dl);
}

async function renderDb() {
  const notes = await bridge.notes.list(state.dbFilters);
  $('#db-count').textContent = `${notes.length} 条`;
  const body = $('#db-body');
  body.innerHTML = '';
  if (state.dbMode === 'table') body.append(renderTable(notes));
  else if (state.dbMode === 'board') body.append(renderBoard(notes));
  else body.append(renderCalendar(notes));
}

const statusSeq = ['todo', 'doing', 'blocked', 'done'];

// 看板第二种形态：按任务状态分列，拖拽改状态
function renderBoardByStatus(notes) {
  const board = h('div', { class: 'board' });
  const groups = new Map(statusSeq.map((s) => [s, []]));
  for (const n of notes) {
    const s = statusSeq.includes(n.status) ? n.status : 'todo';
    groups.get(s).push(n);
  }
  const statusLabels = { todo: '待办', doing: '进行中', blocked: '受阻', done: '已完成' };
  for (const s of statusSeq) {
    const col = h('div', { class: 'board-col', 'data-status': s },
      h('h3', {}, h('span', { text: statusLabels[s] }), h('span', { text: String(groups.get(s).length) })));
    for (const n of groups.get(s)) {
      const overdue = n.dueDate && n.dueDate < todayStr() && s !== 'done';
      const card = h('div', { class: 'board-card', draggable: 'true', 'data-id': n.id },
        h('div', { class: 't' }, n.title || n.content.split('\n')[0] || '(无标题)', overdue ? h('span', { class: 'tag overdue', text: '逾期' }) : null),
        h('div', { class: 'c', text: n.content }),
        h('div', { class: 'm' }, h('span', { text: n.date }), h('span', { text: n.dueDate ? `截止 ${n.dueDate}` : '' })),
      );
      card.addEventListener('click', () => openRecordModal(n));
      card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(n.id)));
      col.append(card);
    }
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      if (!id) return;
      const st = col.dataset.status;
      await bridge.notes.save({ id, status: st, done: st === 'done' });
      toast(`已标记为「${statusLabels[st]}」`);
      renderDb();
    });
    board.append(col);
  }
  return board;
}

// 表格正文列：把脑图大纲、空行压成便于阅读的单段摘要
function summarize(text) {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean).join(' · ');
}

// 表格列定义：key / 标题 / 默认可见 / 取值（排序用） / 渲染
const TABLE_COLS = [
  { key: 'status', label: '状态', visible: true, sort: (n) => n.status || '' },
  { key: 'date', label: '日期', visible: true, sort: (n) => n.date },
  { key: 'project', label: '项目', visible: true, sort: (n) => n.project || '' },
  { key: 'title', label: '标题', visible: true, sort: (n) => n.title || '' },
  { key: 'content', label: '内容', visible: true, sort: (n) => n.content || '' },
  { key: 'due', label: '截止', visible: true, sort: (n) => n.dueDate || '' },
  { key: 'start', label: '开始', visible: false, sort: (n) => n.startTime || '' },
  { key: 'finish', label: '完成', visible: false, sort: (n) => n.finishTime || '' },
  { key: 'remark', label: '备注', visible: false, sort: (n) => n.remark || '' },
];

function renderCell(colKey, n) {
  switch (colKey) {
    case 'status': return h('td', {}, statusTag(n));
    case 'date': return h('td', { class: 'nowrap', text: n.date });
    case 'project': return h('td', { class: 'nowrap' }, n.project ? h('span', { class: 'tag project', text: n.project }) : '');
    case 'title': return h('td', { text: n.title });
    case 'content': return h('td', { class: 'content-cell' }, h('div', { class: 'clamp', text: summarize(n.content), title: n.content }));
    case 'due': return h('td', { class: 'nowrap' + (n.dueDate && n.dueDate < todayStr() && n.status !== 'done' ? ' overdue-text' : ''), text: n.dueDate });
    case 'start': return h('td', { class: 'nowrap', text: n.startTime });
    case 'finish': return h('td', { class: 'nowrap', text: n.finishTime });
    case 'remark': return h('td', { class: 'content-cell', text: n.remark });
    default: return h('td');
  }
}

function renderTable(notes) {
  if (!notes.length) return h('div', { class: 'empty', text: '没有符合条件的记录。' });
  const wrap = h('div');
  const cols = TABLE_COLS.filter((c) => state.tableCols.includes(c.key));
  const sortCol = state.tableSort?.key;
  const sorted = sortCol
    ? [...notes].sort((a, b) => {
        const def = TABLE_COLS.find((c) => c.key === sortCol);
        const va = def.sort(a), vb = def.sort(b);
        const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'zh');
        return state.tableSort.dir === 'desc' ? -cmp : cmp;
      })
    : notes;
  const table = h('table', { class: 'data' });
  const headRow = h('tr', {},
    h('th', {}, (() => {
      const cb = h('input', { type: 'checkbox', onchange: (e) => {
        $$('.batch-check', wrap).forEach((c) => (c.checked = e.target.checked));
        updateBatchBar();
      } });
      return cb;
    })()),
    ...cols.map((c) => {
      const th = h('th', { style: { cursor: 'pointer' }, title: '点击排序', onclick: () => {
        state.tableSort = { key: c.key, dir: state.tableSort?.key === c.key && state.tableSort.dir === 'asc' ? 'desc' : 'asc' };
        renderDb();
      } }, c.label, state.tableSort?.key === c.key ? (state.tableSort.dir === 'asc' ? ' ↑' : ' ↓') : '');
      return th;
    }),
    h('th', { class: 'col-menu-host' }, (() => {
      const btn = h('button', { title: '列显隐与批量', text: '⚙' });
      btn.addEventListener('click', (e) => { e.stopPropagation(); openTableMenu(e.target); });
      return btn;
    })()),
  );
  table.append(h('thead', {}, headRow));
  const tb = h('tbody');
  for (const n of sorted) {
    tb.append(h('tr', { 'data-id': n.id },
      h('td', {}, h('input', { type: 'checkbox', class: 'check batch-check', onchange: () => updateBatchBar() })),
      ...cols.map((c) => renderCell(c.key, n)),
      h('td', { class: 'row-actions' },
        h('button', { text: '编辑', onclick: () => openRecordModal(n) }),
        h('button', { text: '删除', onclick: async () => {
          if (!confirm('删除这条记录？')) return;
          await bridge.notes.remove(n.id);
          toast('已移入回收站');
          renderDb();
          if (state.view === 'daily') loadDaily();
        } })),
    ));
  }
  table.append(tb);
  wrap.append(table, h('div', { class: 'batch-bar hidden', id: 'batch-bar' }));
  function updateBatchBar() {
    const checked = $$('.batch-check:checked', wrap).map((c) => Number(c.closest('tr').dataset.id));
    const bar = $('#batch-bar', wrap);
    if (!checked.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.innerHTML = '';
    bar.append(
      h('span', { text: `已选 ${checked.length} 条：` }),
      h('button', { text: '标记为完成', onclick: () => batchUpdate(checked, { status: 'done', done: true }) }),
      h('button', { text: '标记为进行中', onclick: () => batchUpdate(checked, { status: 'doing', done: false }) }),
      h('button', { text: '改项目', onclick: async () => {
        const p = prompt('目标项目名称：');
        if (p === null) return;
        batchUpdate(checked, { project: p.trim() });
      } }),
      h('button', { text: '改截止日期', onclick: async () => {
        const d = prompt('截止日期（YYYY-MM-DD，留空清除）：');
        if (d === null) return;
        batchUpdate(checked, { dueDate: d.trim() });
      } }),
      h('button', { class: 'danger', text: '删除', onclick: async () => {
        if (!confirm(`删除这 ${checked.length} 条记录？可在回收站恢复。`)) return;
        for (const id of checked) await bridge.notes.remove(id);
        toast(`已移入回收站 ${checked.length} 条`);
        renderDb();
      } }),
    );
  }
  async function batchUpdate(ids, patch) {
    for (const id of ids) {
      const n = notes.find((x) => x.id === id);
      if (n) await bridge.notes.save({ ...n, ...patch });
    }
    toast(`已批量更新 ${ids.length} 条`);
    renderDb();
  }
  return wrap;
}

// 列显隐菜单
function openTableMenu(anchor) {
  closeTableMenu();
  const menu = h('div', { class: 'col-menu', id: 'col-menu' },
    h('p', { class: 'hint', style: { margin: '4px 8px' }, text: '显示列' }),
    ...TABLE_COLS.map((c) => {
      const cb = h('input', { type: 'checkbox', checked: state.tableCols.includes(c.key) });
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault(); // 阻止默认派发（label 内 change 不可靠），完全手动接管
        const want = !state.tableCols.includes(c.key);
        cb.checked = want;
        state.tableCols = want
          ? [...TABLE_COLS.filter((x) => state.tableCols.includes(x.key) || x.key === c.key).map((x) => x.key)]
          : state.tableCols.filter((k) => k !== c.key);
        renderDb();
      });
      const row = h('label', { class: 'col-menu-item' }, cb, h('span', { text: c.label }));
      row.addEventListener('click', (e) => e.stopPropagation());
      return row;
    }),
    h('button', { text: '恢复默认', style: { margin: '6px 8px' }, onclick: () => {
      state.tableCols = TABLE_COLS.filter((c) => c.visible).map((c) => c.key);
      state.tableSort = null;
      closeTableMenu();
      renderDb();
    } }),
  );
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = r.bottom + 6 + 'px';
  menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('click', closeTableMenu, { once: true }), 0);
}
function closeTableMenu() { $('#col-menu')?.remove(); }

// ---------- 内置筛选预设 ----------
const BUILTIN_FILTERS = [
  { id: 'bi-today', name: '今天需要处理', query: { q: '', project: '', status: 'open', dateFrom: '', dateTo: '', dueBefore: todayStr() } },
  { id: 'bi-blocked', name: '被阻塞事项', query: { q: '', project: '', status: 'blocked', dateFrom: '', dateTo: '' } },
  { id: 'bi-overdue', name: '已逾期未完成', query: { q: '', project: '', status: 'open', dateFrom: '', dateTo: '', dueBefore: todayStr() } },
];

function renderBoard(notes) {
  const groups = new Map();
  for (const n of notes) {
    const key = n.project || '未分项目';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const board = h('div', { class: 'board' });
  if (!groups.size) board.append(h('div', { class: 'empty', text: '没有记录。' }));
  for (const [project, items] of groups) {
    const done = items.filter((i) => i.done).length;
    const col = h('div', { class: 'board-col', 'data-project': project },
      h('h3', {}, h('span', { text: project }), h('span', { text: `${done}/${items.length}` })),
    );
    for (const n of items) {
      const card = h('div', { class: 'board-card', draggable: 'true', 'data-id': n.id },
        h('div', { class: 't', text: n.title || n.content.split('\n')[0] || '(无标题)' }),
        h('div', { class: 'c', text: n.content }),
        h('div', { class: 'm' }, h('span', { text: n.date }), h('span', { text: n.done ? '已完成' : '未完成' })),
      );
      card.addEventListener('click', () => openRecordModal(n));
      card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(n.id)));
      col.append(card);
    }
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const target = project === '未分项目' ? '' : project;
      if (!id) return;
      await bridge.notes.save({ id, project: target });
      toast(`已移动到「${project}」`);
      renderDb();
    });
    board.append(col);
  }
  return board;
}

function renderCalendar(notes) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();
  const byDate = new Map();
  for (const n of notes) {
    if (!byDate.has(n.date)) byDate.set(n.date, []);
    byDate.get(n.date).push(n);
  }
  const cal = h('div', { class: 'calendar' });
  cal.append(h('div', { class: 'cal-head' },
    h('h3', { text: `${y} 年 ${m} 月` }),
    h('div', { class: 'row-gap' },
      h('button', { text: '‹', onclick: () => shiftMonth(-1) }),
      h('button', { text: '今天', onclick: () => { state.calMonth = todayStr().slice(0, 7); renderDb(); } }),
      h('button', { text: '›', onclick: () => shiftMonth(1) })),
  ));
  const grid = h('div', { class: 'cal-grid' });
  ['一', '二', '三', '四', '五', '六', '日'].forEach((d) => grid.append(h('div', { class: 'cal-dow', text: d })));
  const todayS = todayStr();
  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) cells.push({ d: new Date(y, m - 1, -i), out: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d: new Date(y, m - 1, d), out: false });
  while (cells.length % 7) cells.push({ d: new Date(y, m, cells.length % 7), out: true });

  for (const c of cells) {
    const ds = todayStr(c.d);
    const items = byDate.get(ds) || [];
    const day = h('div', { class: 'cal-day' + (c.out ? ' out' : '') + (ds === todayS ? ' today' : '') },
      h('div', { class: 'num', text: c.out ? (c.d.getDate()) : c.d.getDate() }));
    items.slice(0, 3).forEach((n) => {
      day.append(h('div', {
        class: 'cal-ev' + (n.done ? ' done' : ''),
        text: (n.startTime ? n.startTime + ' ' : '') + (n.title || n.content.split('\n')[0] || '(无内容)'),
        title: n.content,
        onclick: (e) => { e.stopPropagation(); openRecordModal(n); },
      }));
    });
    if (items.length > 3) day.append(h('div', { class: 'cal-more', text: `+${items.length - 3} 条` }));
    day.addEventListener('dblclick', () => startNewNote(ds));
    grid.append(day);
  }
  cal.append(grid);
  return cal;
}

function shiftMonth(delta) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  renderDb();
}

$$('#db-views button').forEach((b) => b.addEventListener('click', () => {
  state.dbMode = b.dataset.mode;
  $$('#db-views button').forEach((x) => x.classList.toggle('active', x === b));
  renderDb();
}));
$('#db-q').addEventListener('input', debounce((e) => { state.dbFilters.q = e.target.value.trim(); renderDb(); }));
$('#db-project').addEventListener('change', (e) => { state.dbFilters.project = e.target.value; renderDb(); });
$('#db-status').addEventListener('change', (e) => { state.dbFilters.status = e.target.value; renderDb(); });
$('#db-from').addEventListener('change', (e) => { state.dbFilters.dateFrom = e.target.value; renderDb(); });
$('#db-to').addEventListener('change', (e) => { state.dbFilters.dateTo = e.target.value; renderDb(); });
$('#db-new').addEventListener('click', () => {
  openRecordModal({ date: todayStr(), done: false, status: 'todo' });
});

// 看板分组维度切换：按项目 / 按状态
// （在看板视图的表头追加一个小切换）
const boardDimBar = h('div', { class: 'filterbar' },
  h('span', { class: 'hint', text: '看板分组：' }),
  h('div', { class: 'seg', id: 'board-dim' },
    h('button', { class: 'active', 'data-dim': 'project', text: '按项目', onclick: () => { state.boardDim = 'project'; syncBoardDim(); renderDb(); } }),
    h('button', { 'data-dim': 'status', text: '按状态', onclick: () => { state.boardDim = 'status'; syncBoardDim(); renderDb(); } }),
  ),
);
function syncBoardDim() {
  $$('#board-dim button').forEach((b) => b.classList.toggle('active', b.dataset.dim === state.boardDim));
}
$('#db-filter').after(boardDimBar);
boardDimBar.classList.add('hidden');
const _origRenderDb = renderDb;
renderDb = async function () {
  boardDimBar.classList.toggle('hidden', state.dbMode !== 'board');
  if (state.dbMode === 'board' && state.boardDim === 'status') {
    const notes = await bridge.notes.list(state.dbFilters);
    $('#db-count').textContent = `${notes.length} 条`;
    const body = $('#db-body');
    body.innerHTML = '';
    body.append(renderBoardByStatus(notes));
    return;
  }
  return _origRenderDb();
};

// ---------- 保存的筛选 ----------
async function loadSavedFilters() {
  const list = await bridge.filters.list();
  const sel = $('#db-saved');
  const cur = sel.value;
  sel.innerHTML = '<option value="">筛选预设…</option>'
    + '<optgroup label="内置">' + BUILTIN_FILTERS.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('') + '</optgroup>'
    + (list.length ? `<optgroup label="我的筛选">${list.map((f) => `<option value="u${f.id}">${esc(f.name)}</option>`).join('')}</optgroup>` : '');
  if (cur) sel.value = cur;
}
$('#db-save-filter').addEventListener('click', async () => {
  const f = state.dbFilters;
  const desc = [
    f.q && `搜索「${f.q}」`, f.project && `项目 ${f.project}`, f.status && ({ open: '未完成', todo: '待办', doing: '进行中', blocked: '受阻', done: '已完成' }[f.status]),
    (f.dateFrom || f.dateTo) && `${f.dateFrom || '…'} ~ ${f.dateTo || '…'}`,
  ].filter(Boolean).join(' + ') || '全部记录';
  const name = prompt('筛选名称：', desc);
  if (!name) return;
  await bridge.filters.save({ name, query: JSON.stringify(f) });
  toast('筛选已保存');
  loadSavedFilters();
});
$('#db-saved').addEventListener('change', async (e) => {
  const v = e.target.value;
  if (!v) return;
  let query;
  if (v.startsWith('bi-')) {
    query = { ...BUILTIN_FILTERS.find((f) => f.id === v)?.query };
    // 「今天需要处理」以打开当天为准
    if (v === 'bi-today' || v === 'bi-overdue') query.dueBefore = todayStr();
  } else {
    const id = Number(v);
    const f = (await bridge.filters.list()).find((x) => x.id === id);
    if (!f) return;
    query = JSON.parse(f.query);
  }
  state.dbFilters = { q: '', project: '', status: '', dateFrom: '', dateTo: '', dueBefore: '', ...query };
  $('#db-q').value = state.dbFilters.q || '';
  $('#db-project').value = state.dbFilters.project || '';
  $('#db-status').value = state.dbFilters.status || '';
  $('#db-from').value = state.dbFilters.dateFrom || '';
  $('#db-to').value = state.dbFilters.dateTo || '';
  renderDb();
});

// 通用记录编辑弹窗（复用富媒体编辑器）
function openRecordModal(note) {
  const isNew = !note.id;
  const n = { title: '', project: '', content: '', contentHtml: '', contentJson: '', done: false, status: 'todo', dueDate: '', tags: '', startTime: '', finishTime: '', remark: '', ...note };
  const body = h('div');
  const titleInput = h('input', { type: 'text', placeholder: '标题（可选）', value: n.title, style: { fontSize: '16px', fontWeight: '600' } });
  const projectInput = h('input', { type: 'text', list: 'project-options', placeholder: '关联项目', value: n.project });
  const dateInput = h('input', { type: 'date', value: n.date || todayStr() });
  const startInput = h('input', { type: 'time', value: n.startTime });
  const finishInput = h('input', { type: 'time', value: n.finishTime });
  const statusSel = h('select', {}, ...Object.entries(STATUS).map(([v, s]) => h('option', { value: v, text: s.label })));
  statusSel.value = n.status || (n.done ? 'done' : 'todo');
  const dueInput = h('input', { type: 'date', value: n.dueDate || '' });
  const remarkInput = h('textarea', { rows: 2, placeholder: '备注' });
  remarkInput.value = n.remark;

  body.append(
    h('h2', { text: isNew ? '新建记录' : '编辑记录' }),
    h('div', { class: 'field' }, titleInput),
    h('div', { class: 'field-grid' },
      h('div', { class: 'field' }, h('label', { text: '日期' }), dateInput),
      h('div', { class: 'field' }, h('label', { text: '关联项目' }), projectInput),
      h('div', { class: 'field' }, h('label', { text: '任务状态' }), statusSel),
      h('div', { class: 'field' }, h('label', { text: '截止日期' }), dueInput),
      h('div', { class: 'field' }, h('label', { text: '备注' }), remarkInput),
      h('div', { class: 'field' }, h('label', { text: '开始时间' }), startInput),
      h('div', { class: 'field' }, h('label', { text: '完成时间' }), finishInput),
    ),
  );
  const editorHost = h('div');
  body.append(h('div', { class: 'field' }, h('label', { text: '工作内容' })), editorHost);
  const editor = window.RichMedia.createEditor(editorHost, { html: n.contentHtml, json: n.contentJson });
  body.append(h('div', { class: 'modal-foot' },
    h('button', { text: '取消', onclick: closeModal }),
    h('button', {
      class: 'primary', text: '保存', onclick: async () => {
        const v = editor.getValue();
        await bridge.notes.save({
          id: n.id, date: dateInput.value || todayStr(), project: projectInput.value.trim(),
          title: titleInput.value.trim(), status: statusSel.value, done: statusSel.value === 'done',
          dueDate: dueInput.value,
          startTime: startInput.value, finishTime: finishInput.value,
          remark: remarkInput.value, content: v.text, contentHtml: v.html, contentJson: v.json,
        });
        closeModal();
        toast('已保存');
        renderDb();
        if (state.view === 'daily') loadDaily();
        if (state.view === 'projects') loadProjects();
      },
    }),
  ));
  showModal(body, true);
}

function showModal(body, wide = false) {
  const mask = $('#modal-mask');
  const modal = $('#modal');
  modal.firstElementChild.innerHTML = '';
  modal.firstElementChild.append(body);
  modal.classList.toggle('wide', wide);
  mask.classList.remove('hidden');
  const firstInput = modal.querySelector('input[type=text], input[type=search]');
  if (firstInput) firstInput.focus();
}
function closeModal() {
  $('#modal-mask').classList.add('hidden');
  $('#modal').classList.remove('wide');
  $('#modal').firstElementChild.innerHTML = '';
}
$('#modal-mask').addEventListener('click', (e) => { if (e.target.id === 'modal-mask') closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal-mask').classList.contains('hidden')) closeModal();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.getAttribute?.('contenteditable') !== 'true') {
    e.preventDefault();
    if (state.view === 'db') openRecordModal({ date: todayStr(), done: false });
    else if (state.view === 'snippets') openSnippetModal(null);
    else if (state.view === 'daily') { startNewNote(todayStr()); }
  }
});

function reloadIfActive(view) {
  if (state.view === view) {
    if (view === 'db') renderDb();
    if (view === 'review') loadReview();
  }
}

// ---------- 命令记录 ----------
async function loadSnippets() {
  const all = await bridge.snippets.list({});
  const langs = [...new Set(all.map((s) => s.language).filter(Boolean))].sort();
  const sel = $('#sn-lang');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部语言</option>' + langs.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  sel.value = cur || state.snFilters.language;
  renderSnippets();
}

async function renderSnippets() {
  const items = await bridge.snippets.list(state.snFilters);
  const host = $('#sn-list');
  host.innerHTML = '';
  if (!items.length) {
    host.append(h('div', { class: 'empty', text: '还没有命令记录，点击右上角新增。' }));
    return;
  }
  for (const s of items) {
    const cmdEl = h('div', { class: 'sn-cmd', title: '单击复制', onclick: async () => {
      await navigator.clipboard.writeText(s.command);
      await bridge.snippets.use(s.id);
      toast('已复制到剪贴板');
      renderSnippets();
    } }, h('span', { text: s.command }), h('span', { class: 'copy', text: '复制' }));
    host.append(h('div', { class: 'sn-card' },
      h('div', { class: 'sn-top' }, h('div', { class: 't', text: s.title || '(未命名)' }), h('div', { class: 'lang', text: s.language })),
      cmdEl,
      h('div', { class: 'sn-meta' },
        h('div', { class: 'r' }, s.tags ? h('div', {}, ...s.tags.split(/[,，\s]+/).filter(Boolean).map((t) => h('span', { class: 'tag', text: t, style: { marginRight: '4px' } }))) : null,
          s.remark ? h('div', { text: s.remark }) : null,
          h('span', { class: 'hint', text: `使用 ${s.uses} 次` })),
        h('div', { class: 'sn-actions' },
          h('button', { text: '编辑', onclick: () => openSnippetModal(s) }),
          h('button', { text: '删除', onclick: async () => {
            if (!confirm('删除这条命令？')) return;
            await bridge.snippets.remove(s.id);
            loadSnippets();
          } })),
      ),
    ));
  }
}

function openSnippetModal(s) {
  const isNew = !s;
  const v = { title: '', language: '', command: '', remark: '', tags: '', ...(s || {}) };
  const body = h('div');
  const titleI = h('input', { type: 'text', value: v.title, placeholder: '例如：查看 8080 端口占用' });
  const langI = h('input', { type: 'text', value: v.language, placeholder: 'bash / powershell / sql …' });
  const tagsI = h('input', { type: 'text', value: v.tags, placeholder: '用逗号分隔，如：网络,调试' });
  const remarkI = h('input', { type: 'text', value: v.remark, placeholder: '备注' });
  const cmdT = h('textarea', { class: 'code', placeholder: '命令内容' });
  cmdT.value = v.command;
  body.append(
    h('h2', { text: isNew ? '新增命令' : '编辑命令' }),
    h('div', { class: 'field-grid' },
      h('div', { class: 'field', style: { gridColumn: '1 / span 2' } }, h('label', { text: '标题' }), titleI),
      h('div', { class: 'field' }, h('label', { text: '语言' }), langI),
      h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', { text: '命令' }), cmdT),
      h('div', { class: 'field' }, h('label', { text: '标签' }), tagsI),
      h('div', { class: 'field', style: { gridColumn: '2 / -1' } }, h('label', { text: '备注' }), remarkI),
    ),
    h('div', { class: 'modal-foot' },
      h('button', { text: '取消', onclick: closeModal }),
      h('button', { class: 'primary', text: '保存', onclick: async () => {
        if (!cmdT.value.trim()) { toast('请填写命令内容'); return; }
        await bridge.snippets.save({ id: v.id, title: titleI.value.trim(), language: langI.value.trim(), command: cmdT.value, remark: remarkI.value.trim(), tags: tagsI.value.trim() });
        closeModal(); toast('已保存'); loadSnippets();
      } })),
  );
  showModal(body);
  setTimeout(() => cmdT.focus(), 30);
}

$('#sn-q').addEventListener('input', debounce((e) => { state.snFilters.q = e.target.value.trim(); renderSnippets(); }));
$('#sn-lang').addEventListener('change', (e) => { state.snFilters.language = e.target.value; renderSnippets(); });
$('#sn-new').addEventListener('click', () => openSnippetModal(null));

// ---------- 回顾 ----------
const yearSel = $('#rv-year');
const nowY = new Date().getFullYear();
yearSel.innerHTML = [nowY, nowY - 1, nowY - 2].map((y) => `<option value="${y}">${y} 年</option>`).join('');
yearSel.addEventListener('change', () => loadReview());

async function loadReview() {
  const year = Number(yearSel.value);
  const [stats, hm, tl] = await Promise.all([
    bridge.meta.stats(), bridge.meta.heatmap({ year }), bridge.meta.timeline({ limit: 200, project: $('#rv-project').value }),
  ]);
  await fillProjectSelect($('#rv-project'));

  $('#rv-stats').innerHTML = '';
  const statData = [
    ['总记录', stats.total], ['已完成', stats.done], ['活跃天数', stats.activeDays],
    ['连续天数', stats.streak], ['项目数', stats.projects], ['命令条数', stats.snippets],
  ];
  for (const [k, v] of statData) {
    $('#rv-stats').append(h('div', { class: 'stat' }, h('div', { class: 'v', text: v }), h('div', { class: 'k', text: k })));
  }

  renderHeatmap(hm, year);
  renderHours(hm.hours);
  renderTimeline(tl);
  $('#rv-legend').innerHTML = '少 <span class="hm-legend">' +
    ['', 'l1', 'l2', 'l3', 'l4'].map((c) => `<span class="hm-cell ${c}"></span>`).join('') + '</span> 多';
}

function bucketLevel(count) {
  if (!count) return '';
  if (count <= 1) return 'l1';
  if (count <= 2) return 'l2';
  if (count <= 4) return 'l3';
  return 'l4';
}

function renderHeatmap(hm, year) {
  const host = $('#rv-heatmap');
  host.innerHTML = '';
  const map = new Map(hm.days.map((d) => [d.date, d]));
  const start = new Date(year, 0, 1);
  // 从当年第一个周一开始
  const offset = (start.getDay() + 6) % 7;
  const cursor = new Date(year, 0, 1 - offset);
  const todayS = todayStr();
  const wrap = h('div', { class: 'hm-wrap' });
  const dows = h('div', { class: 'hm-dows' });
  ['一', '', '三', '', '五', '', '日'].forEach((d) => dows.append(h('span', { text: d })));
  const cols = h('div', { class: 'hm-cols' });
  let monthLabels = [];
  while (cursor.getFullYear() === year || cursor < start) {
    if (cursor >= new Date(year + 1, 0, 1)) break;
    const col = h('div', { class: 'hm-col' });
    const label = cursor.getDate() <= 7 ? `${cursor.getMonth() + 1}月` : '';
    col.append(h('div', { class: 'm', text: label }));
    for (let i = 0; i < 7; i++) {
      const ds = todayStr(cursor);
      const inYear = cursor.getFullYear() === year;
      const rec = map.get(ds);
      const c = h('div', {
        class: 'hm-cell ' + (inYear ? bucketLevel(rec?.count || 0) : '') + (ds === todayS ? ' today' : ''),
        title: inYear ? `${ds}  ${rec?.count || 0} 条记录${rec?.minutes ? ' · ' + rec.minutes + ' 分钟' : ''}` : '',
        style: inYear ? {} : { opacity: 0 },
      });
      c.addEventListener('click', () => { if (rec) switchView('db'); });
      col.append(c);
      cursor.setDate(cursor.getDate() + 1);
    }
    cols.append(col);
  }
  wrap.append(dows, cols);
  host.append(wrap);
}

function renderHours(hours) {
  const host = $('#rv-hours');
  host.innerHTML = '';
  const counts = new Array(24).fill(0);
  for (const r of hours) {
    const h = parseInt(r.hour, 10);
    if (!Number.isNaN(h)) counts[h] = r.c;
  }
  const max = Math.max(1, ...counts);
  counts.forEach((c, i) => {
    host.append(h('div', { class: 'hour', title: `${pad(i)}:00 — ${c} 条` },
      h('div', { class: 'bar', style: { height: Math.round((c / max) * 80) + 'px', opacity: c ? 0.85 : 0.12 } }),
      i % 3 === 0 ? h('div', { class: 'lbl', text: pad(i) }) : h('div', { class: 'lbl', text: '' }),
    ));
  });
}

function renderTimeline(items) {
  const host = $('#rv-timeline');
  host.innerHTML = '';
  if (!items.length) { host.append(h('div', { class: 'empty', text: '暂无记录。' })); return; }
  let lastDate = '';
  for (const n of items) {
    if (n.date !== lastDate) {
      lastDate = n.date;
      host.append(h('div', { class: 'tl-date', style: { fontSize: '12px', fontWeight: '600', margin: '12px 0 2px', color: 'var(--ink)' }, text: `${n.date} ${weekdayOf(n.date)}` }));
    }
    host.append(h('div', { class: 'tl-item', onclick: () => openRecordModal(n), style: { cursor: 'pointer' } },
      h('div', { class: 'd', text: [n.start_time && `开始 ${n.start_time}`, n.finish_time && `完成 ${n.finish_time}`].filter(Boolean).join(' · ') || '未记录时间' }),
      n.title ? h('div', { class: 't', text: n.title }) : null,
      h('div', { class: 'c', text: n.content }),
      h('div', { class: 'm' },
        n.project ? h('span', { class: 'tag project', text: n.project }) : null,
        h('span', { class: 'tag ' + (n.done ? 'done' : 'todo'), text: n.done ? '已完成' : '未完成' })),
    ));
  }
}
$('#rv-project').addEventListener('change', () => bridge.meta.timeline({ limit: 200, project: $('#rv-project').value }).then(renderTimeline));

// ---------- 设置 ----------
async function loadSettings() {
  const cfg = await bridge.app.getConfig();
  $('#set-dbpath').textContent = cfg.dbPath;
  $('#set-config').textContent = `配置文件：${cfg.configFile}`;
  loadBackups();
}
// ---------- 自动备份面板 ----------
async function loadBackups() {
  const list = await bridge.backup.list();
  const host = $('#bk-list');
  host.innerHTML = '';
  $('#bk-info').textContent = list.length ? `已保留 ${list.length} 份` : '尚无备份';
  for (const b of list) {
    const d = new Date(b.at);
    host.append(h('div', { class: 'bk-item' },
      h('div', {},
        h('div', { class: 't mono', text: b.name.replace('notes-', '').replace('.db', '').replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5') }),
        h('div', { class: 'hint', text: `${(b.size / 1024).toFixed(0)} KB · ${b.file}` })),
      h('button', { text: '从此备份恢复', onclick: () => restoreFromBackup(b) }),
    ));
  }
}

async function restoreFromBackup(b) {
  const ok = confirm(`用备份 ${b.name} 覆盖当前数据库？\n当前数据会先自动备份为一份新的备份文件。`);
  if (!ok) return;
  const r = await bridge.transfer.restoreSnapshot(b.file);
  if (!r.ok) { toast(`恢复失败：${r.error}`); return; }
  toast('已从备份恢复');
  tfNote(`已从备份 ${b.name} 恢复：${r.notes} 条记录、${r.snippets} 条命令。`);
  state.editing = null;
  loadSettings();
  if (state.view === 'daily') loadDaily();
}

$('#bk-now').addEventListener('click', async () => {
  const r = await bridge.backup.run();
  if (r.ok) { toast('备份完成'); loadBackups(); }
  else toast(`备份失败：${r.error}`);
});

$('#set-reveal').addEventListener('click', () => bridge.app.revealDb());
$('#set-change').addEventListener('click', async () => {
  const r = await bridge.app.changeDb();
  if (r.ok) { toast('数据库位置已更改'); loadSettings(); state.editing = null; loadDaily(); }
});
// ---------- 数据导入与导出 ----------
const tfNote = (msg) => { $('#tf-note').textContent = msg; };
function refreshAfterTransfer() {
  state.editing = null;
  if (state.view === 'daily') loadDaily();
}

$('#tf-export-json').addEventListener('click', async () => {
  const r = await bridge.transfer.exportJson();
  if (!r.ok) return tfNote(r.error ? `导出失败：${r.error}` : '');
  tfNote(`已导出 ${r.notes} 条记录、${r.snippets} 条命令 → ${r.file}`);
  toast('导出完成');
});

$('#tf-import-json').addEventListener('click', async () => {
  const picked = await bridge.transfer.pickJson();
  if (!picked.ok) return tfNote(picked.error ? `无法读取文件：${picked.error}` : '');
  const ok = confirm(`将导入 ${picked.stats.notes} 条记录、${picked.stats.snippets} 条命令。\n重复内容会自动跳过，已有数据不会改动。继续？`);
  if (!ok) return;
  const r = await bridge.transfer.importJson(picked.file);
  if (!r.ok) return tfNote(`导入失败：${r.error}`);
  tfNote(`导入完成：新增 ${r.notesAdded} 条记录（跳过重复 ${r.notesSkipped} 条）、新增 ${r.snippetsAdded} 条命令（跳过重复 ${r.snippetsSkipped} 条）。`);
  toast('导入完成');
  refreshAfterTransfer();
});

$('#tf-export-db').addEventListener('click', async () => {
  const r = await bridge.transfer.exportSnapshot();
  if (!r.ok) return tfNote(r.error ? `导出失败：${r.error}` : '');
  tfNote(`已导出整库（${(r.size / 1024).toFixed(0)} KB）→ ${r.file}`);
  toast('整库已导出');
});

$('#tf-restore-db').addEventListener('click', async () => {
  const picked = await bridge.transfer.pickSnapshot();
  if (!picked.ok) return tfNote(picked.error ? `无法读取文件：${picked.error}` : '');
  const ok = confirm(`确定用该文件覆盖本机数据吗？\n文件内含 ${picked.stats.notes} 条记录、${picked.stats.snippets} 条命令。\n当前数据库会先自动备份，之后可手动找回。`);
  if (!ok) return;
  const r = await bridge.transfer.restoreSnapshot(picked.file);
  if (!r.ok) return tfNote(`恢复失败：${r.error}`);
  tfNote(`整库已恢复：${r.notes} 条记录、${r.snippets} 条命令。原数据备份于 ${r.backup}`);
  toast('整库已恢复');
  refreshAfterTransfer();
});

$('#btn-hide').addEventListener('click', () => bridge.app.closeWindow());
$('#btn-quit').addEventListener('click', () => {
  if (confirm('关闭软件？后台进程将完全退出。')) bridge.app.quit();
});

// ---------- 初始化 ----------
$('#daily-date').value = state.dailyDate;
$('#daily-date').addEventListener('change', (e) => {
  state.dailyDate = e.target.value;
  openDateEditor(e.target.value);
});
$('#daily-new').addEventListener('click', () => {
  const d = $('#daily-date').value || todayStr();
  state.dailyDate = d;
  startNewNote(d);
});

switchView('daily');

// 在左侧列表中高亮当前编辑的记录
function highlightActiveRow() {
  const id = state.editing?.id;
  $$('.note-row').forEach((row, i) => {
    const active = id ? row.dataset.noteId === String(id) : false;
    row.classList.toggle('active', active);
  });
}
