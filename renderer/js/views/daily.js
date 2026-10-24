// 每日记录视图：列表、编辑器、自动保存、草稿恢复、任务脉络、版本历史、回收站
import { $, $$, h, esc, toast } from '../core/dom.js';
import { state } from '../core/state.js';
import { notes as notesApi, drafts as draftsApi, versions as versionsApi, trash as trashApi, tasks as tasksApi, templates as templatesApi, meta as metaApi } from '../core/api.js';
import { todayStr, weekdayOf, summarize, statusTag, STATUS } from '../core/format.js';
import { showModal, closeModal } from '../ui/modal.js';
import { refreshViews } from '../core/registry.js';
import { createEditor } from '../richtext.js';

export function highlightActiveRow() {
  const id = state.editing?.id;
  $$('.note-row').forEach((row) => {
    row.classList.toggle('active', !!id && row.dataset.noteId === String(id));
  });
}

export async function loadDaily() {
  const list = await notesApi.list({});
  const byDate = new Map();
  for (const n of list) {
    if (!byDate.has(n.date)) byDate.set(n.date, []);
    byDate.get(n.date).push(n);
  }
  $('#daily-sub').textContent = `共 ${list.length} 条记录 · ${byDate.size} 天 · 连续 ${state.streak ?? '-'} 天`;

  const host = $('#daily-list');
  host.innerHTML = '';
  if (!byDate.size) {
    host.append(h('div', { class: 'empty', text: '还没有记录，点击右上角新建。' }));
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
        })),
    );
    for (const n of items) {
      group.append(h('div', {
        class: 'note-row' + (state.editing?.id === n.id ? ' active' : ''),
        'data-note-id': String(n.id),
        onclick: () => openNoteEditor(n),
      },
        statusTag(n),
        h('span', { class: 'note-row-title', text: n.title || summarize(n.content, 40) || '(无标题)' }),
        n.project ? h('span', { class: 'tag project', text: n.project }) : null,
        h('span', { class: 'note-row-time', text: n.startTime || '' }),
      ));
    }
    host.append(group);
  }

  const stats = await metaApi.stats();
  state.streak = stats.streak;
  $('#daily-sub').textContent = `共 ${stats.total} 条记录 · ${stats.activeDays} 天 · 连续 ${stats.streak} 天`;

  // 仅在“没有正在编辑的记录”时恢复默认视图；正在编辑新记录（id 为空）时不重建，避免打断编辑
  if (state.editing === null) {
    const todays = byDate.get(state.dailyDate);
    if (todays?.length) await openNoteEditor(todays[0], { keepList: true });
    else await startNewNote(state.dailyDate, { keepList: true });
  }
}

export async function openDateEditor(date) {
  const items = await notesApi.list({ dateFrom: date, dateTo: date });
  if (items.length) await openNoteEditor(items[0]);
  else await startNewNote(date);
}

export async function startNewNote(date, opts = {}) {
  state.editing = {
    id: null,
    date: date || state.dailyDate,
    project: '',
    title: '',
    content: '',
    contentHtml: '',
    contentJson: '',
    done: false,
    status: 'todo',
    dueDate: '',
    startTime: '',
    finishTime: '',
    remark: '',
  };
  await renderNoteEditor(opts.keepList);
}

export async function openNoteEditor(note, opts = {}) {
  state.editing = { ...note };
  await renderNoteEditor(opts.keepList);
  highlightActiveRow();
}


export async function renderNoteEditor(keepList) {
  try {
    const n = state.editing;
    const host = $('#daily-editor');
    host.innerHTML = '';
    state.autoSave = {
      timer: null,
      dirty: false,
      saving: false,
      base: JSON.stringify([n.title, n.content, n.remark]),
    };

    // ---- 头部：标题 ----
    const titleInput = h('input', {
      type: 'text', placeholder: '标题（可选）', value: n.title,
      oninput: (e) => { n.title = e.target.value; },
    });

    // ---- 元信息 ----
    const projectInput = h('input', {
      type: 'text', list: 'project-options', placeholder: '关联项目', value: n.project,
      oninput: (e) => { n.project = e.target.value; },
    });
    const dateInput = h('input', {
      type: 'date', value: n.date || todayStr(),
      onchange: (e) => { n.date = e.target.value; },
    });
    const startInput = h('input', {
      type: 'time', value: n.startTime,
      onchange: (e) => { n.startTime = e.target.value; },
    });
    const finishInput = h('input', {
      type: 'time', value: n.finishTime,
      onchange: (e) => { n.finishTime = e.target.value; },
    });
    const statusSel = h('select', {}, ...Object.entries(STATUS).map(([v, s]) => h('option', { value: v, text: s.label })));
    statusSel.value = n.status || (n.done ? 'done' : 'todo');
    statusSel.addEventListener('change', () => {
      n.status = statusSel.value;
      n.done = statusSel.value === 'done';
    });
    const dueInput = h('input', {
      type: 'date', value: n.dueDate || '',
      onchange: (e) => { n.dueDate = e.target.value; },
    });
    const templateSel = h('select', {}, h('option', { value: '', text: '插入模板…' }));
    const remarkInput = h('textarea', {
      rows: 2, placeholder: '备注',
      oninput: (e) => { n.remark = e.target.value; },
    });
    remarkInput.value = n.remark;

    // ---- 任务线程提示 ----
    let threadBar = null;
    if (n.rootId && n.rootId !== n.id) {
      threadBar = h('div', { class: 'thread-bar' },
        h('span', { text: `⤷ 延续任务「${n.title || '（加载中…）'}」` }),
        h('button', { text: '查看任务脉络', onclick: () => openTaskThread(n.rootId) }));
    } else if (n.id) {
      tasksApi.thread(n.rootId || n.id).then((th) => {
        if (th.records.length <= 1) return;
        const bar = h('div', { class: 'thread-bar' },
          h('span', { text: `⤷ 任务已延续 ${th.days} 天（${th.startedOn} → ${th.lastActive}），共 ${th.records.length} 条记录` }),
          h('button', { text: '查看任务脉络', onclick: () => openTaskThread(th.rootId) }));
        host.querySelector('.daily-editor-meta')?.prepend(bar);
      });
    }

    const metaArea = h('div', { class: 'daily-editor-meta' },
      threadBar || '',
      h('div', { class: 'field-grid' },
        h('div', { class: 'field' }, h('label', { text: '日期' }), dateInput),
        h('div', { class: 'field' }, h('label', { text: '关联项目' }), projectInput),
        h('div', { class: 'field' }, h('label', { text: '任务状态' }), statusSel),
        h('div', { class: 'field' }, h('label', { text: '截止日期' }), dueInput),
        h('div', { class: 'field' }, h('label', { text: '开始时间' }), startInput),
        h('div', { class: 'field' }, h('label', { text: '完成时间' }), finishInput),
        h('div', { class: 'field' }, h('label', { text: '模板' }), templateSel),
        h('div', { class: 'field remark-field' }, h('label', { text: '备注' }), remarkInput)));

    host.append(
      h('div', { class: 'daily-editor-head' }, h('div', { class: 'field title' }, titleInput)),
      metaArea,
    );

    // ---- 富媒体内容 ----
    const editorHost = h('div', { class: 'editor-host' });
    const editor = createEditor(editorHost, { html: n.contentHtml, json: n.contentJson });
    host.append(
      h('div', { class: 'daily-editor-body' },
        h('div', { class: 'field' }, h('label', { text: '工作内容' })),
        editorHost),
    );

    // ---- 底部操作栏 ----
    const saveStatus = h('span', {
      class: 'hint save-status',
      text: n.id ? `更新于 ${n.updatedAt}` : '新记录（输入后自动保存）',
    });
    host.append(h('div', { class: 'daily-editor-foot editor-foot' },
      h('div', { class: 'row-gap', style: { alignItems: 'center', gap: '10px' } },
        saveStatus,
        n.id ? h('button', { text: '历史版本', onclick: () => openVersionHistory(n.id) }) : null),
      h('div', { class: 'row-gap' },
        n.id
          ? h('button', {
            text: '删除',
            onclick: async () => {
              if (!confirm('删除这条记录？可在回收站恢复（保留 30 天）。')) return;
              await notesApi.remove(n.id);
              toast('已移入回收站');
              state.editing = null;
              loadDaily();
              refreshViews('db');
            },
          })
          : null,
        h('button', { text: '保存', class: 'primary', onclick: () => saveNote(true) }))));

    // 模板下拉：插入模板内容
    templatesApi.list().then((tpls) => {
      for (const t of tpls) templateSel.append(h('option', { value: t.id, text: t.name }));
    });
    templateSel.addEventListener('change', async () => {
      if (!templateSel.value) return;
      const t = (await templatesApi.list()).find((x) => String(x.id) === templateSel.value);
      templateSel.value = '';
      if (!t) return;
      const rendered = await templatesApi.render(t.content);
      editor.insertHtml(rendered.replace(/\n/g, '<br>'));
    });

    const draftKey = () => `note:${n.id || `new-${n.date}`}`;

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
        const saved = await notesApi.save(payload);
        // 关键：把新 id 回写到闭包对象 n，否则后续保存仍按“新增”处理而重复建记录
        Object.assign(n, saved);
        state.editing = n;
        state.autoSave.dirty = false;
        state.autoSave.base = JSON.stringify([n.title, n.content, n.remark]);
        saveStatus.textContent = `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
        if (manual) toast('已保存');
        await draftsApi.clear(draftKey());
        await loadDaily();
        refreshViews('db');
      } finally {
        state.autoSave.saving = false;
      }
    }

    // 停止输入 2 秒自动保存；有改动即写草稿，崩溃后可恢复
    function queueAutoSave() {
      const snapshot = JSON.stringify([n.title, n.content, n.remark, editor.getValue().html]);
      if (snapshot === state.autoSave.base) return;
      state.autoSave.dirty = true;
      saveStatus.textContent = '有未保存修改…';
      clearTimeout(state.autoSave.timer);
      draftsApi.save(draftKey(), currentPayload());
      state.autoSave.timer = setTimeout(() => saveNote(false), 2000);
    }

    for (const inp of [titleInput, remarkInput]) inp.addEventListener('input', queueAutoSave);
    for (const inp of [dateInput, startInput, finishInput, projectInput, dueInput]) inp.addEventListener('change', queueAutoSave);
    statusSel.addEventListener('change', queueAutoSave);
    editorHost.addEventListener('input', queueAutoSave);
    editorHost.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveNote(true);
      }
    });

    state.saveCurrent = saveNote;
    window.rteSave = () => state.saveCurrent?.();
    state.currentDraftKey = draftKey;

    await loadDaily();
    restoreDraftIfAny({
      n, editor,
      onAccept: queueAutoSave,
      inputs: { titleInput, remarkInput, dateInput, startInput, finishInput },
    });
  } catch (e) {
    console.error('renderNoteEditor failed:', e);
  }
}

// 崩溃/异常退出后的草稿恢复：仅当草稿与当前内容不同时提示
async function restoreDraftIfAny({ n, editor, onAccept, inputs }) {
  const key = state.currentDraftKey();
  const d = await draftsApi.get(key);
  if (!d) return;
  const same = (d.data.contentHtml || '') === (n.contentHtml || '')
    && (d.data.title || '') === (n.title || '')
    && (d.data.remark || '') === (n.remark || '');
  if (same) { await draftsApi.clear(key); return; }

  const bar = h('div', { class: 'draft-bar' },
    h('span', { text: `检测到未保存的草稿（${d.savedAt}），可能是上次未正常退出遗留。` }),
    h('div', { class: 'row-gap' },
      h('button', {
        text: '恢复草稿', class: 'primary',
        onclick: async () => {
          editor.setValue(d.data.contentHtml, d.data.contentJson);
          for (const k of ['title', 'remark', 'date', 'startTime', 'finishTime']) {
            const v = d.data[k] || '';
            const inputKey = k === 'startTime' ? 'startInput' : k === 'finishTime' ? 'finishInput' : k + 'Input';
            if (inputs[inputKey]) inputs[inputKey].value = v;
            n[k] = v;
          }
          bar.remove();
          onAccept();
        },
      }),
      h('button', { text: '丢弃', onclick: async () => { await draftsApi.clear(key); bar.remove(); } })));
  $('#daily-editor .daily-editor-head')?.after(bar);
}

export async function openVersionHistory(noteId) {
  const versions = await versionsApi.list(noteId);
  const body = h('div');
  body.append(h('h2', { text: '历史版本' }));
  if (!versions.length) {
    body.append(h('p', { class: 'hint', text: '还没有历史版本。每次修改内容后都会自动留档（保留最近 20 个）。' }));
  }
  const previewHost = h('div', { class: 'ver-preview' });
  const list = h('div', { class: 'ver-list' });

  for (const v of versions) {
    list.append(h('div', { class: 'ver-item' },
      h('div', { class: 'ver-head' },
        h('span', { class: 'mono', text: v.savedAt }),
        h('div', { class: 'row-gap' },
          h('button', {
            text: '查看',
            onclick: () => {
              previewHost.innerHTML = '';
              const clone = h('div', { class: 'rte', contenteditable: 'false' });
              clone.innerHTML = v.note.contentHtml || `<div>${esc(v.note.content)}</div>`;
              previewHost.append(clone);
            },
          }),
          h('button', {
            text: '恢复此版本',
            onclick: async () => {
              if (!confirm('恢复到该版本？当前内容会先自动存入历史，不会丢失。')) return;
              await versionsApi.restore(v.id);
              closeModal();
              toast('已恢复');
              state.editing = null;
              loadDaily();
            },
          }))),
      h('div', { class: 'ver-snip', text: (v.note.title ? v.note.title + ' — ' : '') + summarize(v.note.content).slice(0, 80) })));
  }

  if (versions.length) body.append(h('div', { class: 'ver-split' }, list, previewHost));
  else body.append(list);
  showModal(body);
}

// 任务脉络：同一任务的跨天记录时间线
export async function openTaskThread(rootId) {
  const th = await tasksApi.thread(rootId);
  const body = h('div');
  body.append(
    h('h2', { text: `任务脉络：${th.title || '(无标题)'}` }),
    h('p', { class: 'hint' },
      `${th.project || '未分项目'} · ${th.startedOn} 开始，最近活动 ${th.lastActive} · ${th.days} 天 · ${th.records.length} 条记录 · 当前${STATUS[th.status]?.label || th.status}`),
  );
  for (const r of th.records) {
    body.append(h('div', {
      class: 'task-row', style: { cursor: 'pointer' },
      onclick: async () => { closeModal(); await openNoteEditor(r); },
    },
      h('span', { class: 'hint mono', text: r.date }),
      statusTag(r),
      h('span', { class: 'task-t', text: r.title })));
  }
  body.append(h('div', { class: 'modal-foot' },
    h('button', { text: '关闭', onclick: closeModal }),
    th.status !== 'done'
      ? h('button', {
        class: 'primary', text: '今天继续记录',
        onclick: async () => {
          const last = th.records[th.records.length - 1];
          await notesApi.save({
            date: todayStr(), project: th.project, title: th.title,
            content: '', contentHtml: '', contentJson: '',
            rootId: th.rootId, status: last.status, dueDate: th.dueDate,
          });
          closeModal();
          toast('已创建今天的延续记录');
          state.editing = null;
          await loadDaily();
        },
      })
      : null));
  showModal(body);
}

// 回收站
export async function openTrash() {
  const items = await trashApi.list();
  const body = h('div');
  body.append(h('h2', { text: `回收站（${items.length}）` }),
    h('p', { class: 'hint', text: '删除的记录保留 30 天，之后自动清除。' }));
  if (!items.length) body.append(h('p', { class: 'empty', text: '回收站是空的。' }));
  const list = h('div', { class: 'trash-list' });
  for (const it of items) {
    const days = Math.floor((Date.now() - new Date(it.deletedAt.replace(' ', 'T')).getTime()) / 86400000);
    list.append(h('div', { class: 'trash-item' },
      h('div', {},
        h('div', { class: 't', text: it.title || summarize(it.content).slice(0, 40) || '(无标题)' }),
        h('div', { class: 'hint', text: `${it.date} · ${it.project || '未分项目'} · 删除于 ${it.deletedAt}（${days} 天前）` })),
      h('div', { class: 'row-gap' },
        h('button', {
          text: '恢复',
          onclick: async () => {
            await trashApi.restore(it.id);
            toast('已恢复');
            openTrash();
            state.editing = null;
            loadDaily();
          },
        }),
        h('button', {
          class: 'danger', text: '彻底删除',
          onclick: async () => {
            if (!confirm('彻底删除后无法恢复，确定？')) return;
            await trashApi.purge(it.id);
            openTrash();
          },
        }))));
  }
  body.append(list);
  showModal(body);
}

export function initDailyView() {
  $('#db-trash').addEventListener('click', openTrash);
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
}
