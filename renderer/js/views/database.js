// 数据库视图：表格 / 看板 / 日历、筛选、批量修改、列显隐、记录编辑弹窗
import { $, $$, h, esc, toast, debounce } from '../core/dom.js';
import { state } from '../core/state.js';
import { notes as notesApi, meta as metaApi, filters as filtersApi } from '../core/api.js';
import { todayStr, pad, summarize, statusTag, STATUS, STATUS_SEQ } from '../core/format.js';
import { showModal, closeModal } from '../ui/modal.js';
import { askText } from '../core/prompt.js';
import { refreshViews } from '../core/registry.js';
import { loadDaily, startNewNote } from './daily.js';
import { loadProjects } from './projects.js';
import { createEditor } from '../richtext.js';

// ---------- 视图加载 ----------

export async function loadDb() {
  loadSavedFilters();
  await fillProjectSelect($('#db-project'));
  await renderDb();

  const dl = $('#project-options') || h('datalist', { id: 'project-options' });
  const projects = await metaApi.projects();
  dl.innerHTML = projects.map((p) => `<option value="${esc(p.project)}">`).join('');
  if (!dl.parentNode) document.body.append(dl);
}

async function fillProjectSelect(select, keep = true) {
  const projects = await metaApi.projects();
  const cur = select.value;
  select.innerHTML = '<option value="">全部项目</option>'
    + projects.map((p) => `<option value="${esc(p.project)}">${esc(p.project)} (${p.count})</option>`).join('');
  if (keep && cur) select.value = cur;
}

// 统一入口：按当前模式分派（原 monkey patch 已内联）
export async function renderDb() {
  const boardDimBar = $('#board-dim-bar');
  if (boardDimBar) boardDimBar.classList.toggle('hidden', state.dbMode !== 'board');

  const list = await notesApi.list(state.dbFilters);
  $('#db-count').textContent = `${list.length} 条`;
  const body = $('#db-body');
  body.innerHTML = '';

  if (state.dbMode === 'table') body.append(renderTable(list));
  else if (state.dbMode === 'board') {
    body.append(state.boardDim === 'status' ? renderBoardByStatus(list) : renderBoard(list));
  } else body.append(renderCalendar(list));
}

// ---------- 表格 ----------

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
    case 'due': return h('td', {
      class: 'nowrap' + (n.dueDate && n.dueDate < todayStr() && n.status !== 'done' ? ' overdue-text' : ''),
      text: n.dueDate,
    });
    case 'start': return h('td', { class: 'nowrap', text: n.startTime });
    case 'finish': return h('td', { class: 'nowrap', text: n.finishTime });
    case 'remark': return h('td', { class: 'content-cell', text: n.remark });
    default: return h('td');
  }
}

function renderTable(list) {
  if (!list.length) return h('div', { class: 'empty', text: '没有符合条件的记录。' });
  const wrap = h('div');
  const cols = TABLE_COLS.filter((c) => state.tableCols.includes(c.key));

  const sortCol = state.tableSort?.key;
  const sorted = sortCol
    ? [...list].sort((a, b) => {
      const def = TABLE_COLS.find((c) => c.key === sortCol);
      const va = def.sort(a);
      const vb = def.sort(b);
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'zh');
      return state.tableSort.dir === 'desc' ? -cmp : cmp;
    })
    : list;

  const headRow = h('tr', {},
    h('th', {}, h('input', {
      type: 'checkbox',
      onchange: (e) => {
        $$('.batch-check', wrap).forEach((c) => { c.checked = e.target.checked; });
        updateBatchBar();
      },
    })),
    ...cols.map((c) => h('th', {
      style: { cursor: 'pointer' },
      title: '点击排序',
      onclick: () => {
        const sameCol = state.tableSort?.key === c.key;
        state.tableSort = { key: c.key, dir: sameCol && state.tableSort.dir === 'asc' ? 'desc' : 'asc' };
        renderDb();
      },
    }, c.label, state.tableSort?.key === c.key ? (state.tableSort.dir === 'asc' ? ' ↑' : ' ↓') : '')),
    h('th', { class: 'col-menu-host' }, (() => {
      const btn = h('button', { title: '列显隐与批量', text: '⚙' });
      btn.addEventListener('click', (e) => { e.stopPropagation(); openTableMenu(e.target); });
      return btn;
    })()),
  );

  const table = h('table', { class: 'data' }, h('thead', {}, headRow));
  const tb = h('tbody');
  for (const n of sorted) {
    tb.append(h('tr', { 'data-id': n.id },
      h('td', {}, h('input', { type: 'checkbox', class: 'check batch-check', onchange: () => updateBatchBar() })),
      ...cols.map((c) => renderCell(c.key, n)),
      h('td', { class: 'row-actions' },
        h('button', { text: '编辑', onclick: () => openRecordModal(n) }),
        h('button', {
          text: '删除',
          onclick: async () => {
            if (!confirm('删除这条记录？')) return;
            await notesApi.remove(n.id);
            toast('已移入回收站');
            renderDb();
            refreshViews('daily');
          },
        }))));
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
      h('button', {
        text: '改项目',
        onclick: async () => {
          const p = await askText({ title: '目标项目名称', placeholder: '项目名称' });
          if (p === null) return;
          batchUpdate(checked, { project: p.trim() });
        },
      }),
      h('button', {
        text: '改截止日期',
        onclick: async () => {
          const d = await askText({ title: '截止日期（YYYY-MM-DD，留空清除）', placeholder: '2026-01-01' });
          if (d === null) return;
          batchUpdate(checked, { dueDate: d.trim() });
        },
      }),
      h('button', {
        class: 'danger', text: '删除',
        onclick: async () => {
          if (!confirm(`删除这 ${checked.length} 条记录？可在回收站恢复。`)) return;
          for (const id of checked) await notesApi.remove(id);
          toast(`已移入回收站 ${checked.length} 条`);
          renderDb();
        },
      }),
    );
  }

  async function batchUpdate(ids, patch) {
    for (const id of ids) {
      const n = list.find((x) => x.id === id);
      if (n) await notesApi.save({ ...n, ...patch });
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
        e.preventDefault(); // label 内 change 不可靠，手动接管
        const want = !state.tableCols.includes(c.key);
        cb.checked = want;
        state.tableCols = want
          ? TABLE_COLS.filter((x) => state.tableCols.includes(x.key) || x.key === c.key).map((x) => x.key)
          : state.tableCols.filter((k) => k !== c.key);
        renderDb();
      });
      const row = h('label', { class: 'col-menu-item' }, cb, h('span', { text: c.label }));
      row.addEventListener('click', (e) => e.stopPropagation());
      return row;
    }),
    h('button', {
      text: '恢复默认', style: { margin: '6px 8px' },
      onclick: () => {
        state.tableCols = TABLE_COLS.filter((c) => c.visible).map((c) => c.key);
        state.tableSort = null;
        closeTableMenu();
        renderDb();
      },
    }));

  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = r.bottom + 6 + 'px';
  menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('click', closeTableMenu, { once: true }), 0);
}

function closeTableMenu() {
  $('#col-menu')?.remove();
}

// ---------- 看板 ----------

// 卡片与拖拽的公共逻辑
function boardCard(n) {
  const card = h('div', { class: 'board-card', draggable: 'true', 'data-id': n.id },
    h('div', { class: 't' }, n.title || n.content.split('\n')[0] || '(无标题)'),
    h('div', { class: 'c', text: n.content }));
  card.addEventListener('click', () => openRecordModal(n));
  card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(n.id)));
  return card;
}

function bindDrop(col, onDrop) {
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drag-over');
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (!id) return;
    await onDrop(id);
  });
}

// 按项目分列
function renderBoard(list) {
  const groups = new Map();
  for (const n of list) {
    const key = n.project || '未分项目';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const board = h('div', { class: 'board' });
  if (!groups.size) board.append(h('div', { class: 'empty', text: '没有记录。' }));

  for (const [project, items] of groups) {
    const done = items.filter((i) => i.done).length;
    const col = h('div', { class: 'board-col', 'data-project': project },
      h('h3', {}, h('span', { text: project }), h('span', { text: `${done}/${items.length}` })));
    for (const n of items) {
      const card = boardCard(n);
      card.append(h('div', { class: 'm' },
        h('span', { text: n.date }),
        h('span', { text: n.done ? '已完成' : '未完成' })));
      col.append(card);
    }
    bindDrop(col, async (id) => {
      await notesApi.save({ id, project: project === '未分项目' ? '' : project });
      toast(`已移动到「${project}」`);
      renderDb();
    });
    board.append(col);
  }
  return board;
}

// 按任务状态分列
function renderBoardByStatus(list) {
  const groups = new Map(STATUS_SEQ.map((s) => [s, []]));
  for (const n of list) {
    groups.get(STATUS_SEQ.includes(n.status) ? n.status : 'todo').push(n);
  }
  const board = h('div', { class: 'board' });

  for (const s of STATUS_SEQ) {
    const col = h('div', { class: 'board-col', 'data-status': s },
      h('h3', {}, h('span', { text: STATUS[s].label }), h('span', { text: String(groups.get(s).length) })));
    for (const n of groups.get(s)) {
      const overdue = n.dueDate && n.dueDate < todayStr() && s !== 'done';
      const card = boardCard(n);
      if (overdue) card.querySelector('.t').append(h('span', { class: 'tag overdue', text: '逾期' }));
      card.append(h('div', { class: 'm' },
        h('span', { text: n.date }),
        h('span', { text: n.dueDate ? `截止 ${n.dueDate}` : '' })));
      col.append(card);
    }
    bindDrop(col, async (id) => {
      await notesApi.save({ id, status: s, done: s === 'done' });
      toast(`已标记为「${STATUS[s].label}」`);
      renderDb();
    });
    board.append(col);
  }
  return board;
}

// ---------- 日历 ----------

function renderCalendar(list) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();

  const byDate = new Map();
  for (const n of list) {
    if (!byDate.has(n.date)) byDate.set(n.date, []);
    byDate.get(n.date).push(n);
  }

  const cal = h('div', { class: 'calendar' });
  cal.append(h('div', { class: 'cal-head' },
    h('h3', { text: `${y} 年 ${m} 月` }),
    h('div', { class: 'row-gap' },
      h('button', { text: '‹', onclick: () => shiftMonth(-1) }),
      h('button', { text: '今天', onclick: () => { state.calMonth = todayStr().slice(0, 7); renderDb(); } }),
      h('button', { text: '›', onclick: () => shiftMonth(1) }))));

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
    const day = h('div', {
      class: 'cal-day' + (c.out ? ' out' : '') + (ds === todayS ? ' today' : ''),
    }, h('div', { class: 'num', text: c.d.getDate() }));

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

// ---------- 筛选 ----------

const BUILTIN_FILTERS = [
  { id: 'bi-today', name: '今天需要处理', query: { q: '', project: '', status: 'open', dateFrom: '', dateTo: '', dueBefore: todayStr() } },
  { id: 'bi-blocked', name: '被阻塞事项', query: { q: '', project: '', status: 'blocked', dateFrom: '', dateTo: '' } },
  { id: 'bi-overdue', name: '已逾期未完成', query: { q: '', project: '', status: 'open', dateFrom: '', dateTo: '', dueBefore: todayStr() } },
];

async function loadSavedFilters() {
  const list = await filtersApi.list();
  const sel = $('#db-saved');
  const cur = sel.value;
  sel.innerHTML = '<option value="">筛选预设…</option>'
    + '<optgroup label="内置">' + BUILTIN_FILTERS.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('') + '</optgroup>'
    + (list.length
      ? `<optgroup label="我的筛选">${list.map((f) => `<option value="u${f.id}">${esc(f.name)}</option>`).join('')}</optgroup>`
      : '');
  if (cur) sel.value = cur;
}

// ---------- 记录编辑弹窗 ----------

export function openRecordModal(note) {
  const isNew = !note.id;
  const n = {
    title: '', project: '', content: '', contentHtml: '', contentJson: '',
    done: false, status: 'todo', dueDate: '', startTime: '', finishTime: '', remark: '',
    ...note,
  };
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

  const editorHost = h('div');
  const body = h('div', {},
    h('h2', { text: isNew ? '新建记录' : '编辑记录' }),
    h('div', { class: 'field' }, titleInput),
    h('div', { class: 'field-grid' },
      h('div', { class: 'field' }, h('label', { text: '日期' }), dateInput),
      h('div', { class: 'field' }, h('label', { text: '关联项目' }), projectInput),
      h('div', { class: 'field' }, h('label', { text: '任务状态' }), statusSel),
      h('div', { class: 'field' }, h('label', { text: '截止日期' }), dueInput),
      h('div', { class: 'field' }, h('label', { text: '备注' }), remarkInput),
      h('div', { class: 'field' }, h('label', { text: '开始时间' }), startInput),
      h('div', { class: 'field' }, h('label', { text: '完成时间' }), finishInput)),
    h('div', { class: 'field' }, h('label', { text: '工作内容' })), editorHost,
    h('div', { class: 'modal-foot' },
      h('button', { text: '取消', onclick: closeModal }),
      h('button', {
        class: 'primary', text: '保存',
        onclick: async () => {
          const v = editor.getValue();
          await notesApi.save({
            id: n.id,
            date: dateInput.value || todayStr(),
            project: projectInput.value.trim(),
            title: titleInput.value.trim(),
            status: statusSel.value,
            done: statusSel.value === 'done',
            dueDate: dueInput.value,
            startTime: startInput.value,
            finishTime: finishInput.value,
            remark: remarkInput.value,
            content: v.text,
            contentHtml: v.html,
            contentJson: v.json,
          });
          closeModal();
          toast('已保存');
          refreshViews('db', 'daily', 'projects');
        },
      })));

  const editor = createEditor(editorHost, { html: n.contentHtml, json: n.contentJson });
  showModal(body, true);
}

// ---------- 初始化 ----------

export function initDatabaseView() {
  $$('#db-views button').forEach((b) => b.addEventListener('click', () => {
    state.dbMode = b.dataset.mode;
    $$('#db-views button').forEach((x) => x.classList.toggle('active', x === b));
    renderDb();
  }));

  $('#db-q').addEventListener('input', debounce((e) => {
    state.dbFilters.q = e.target.value.trim();
    renderDb();
  }));
  $('#db-project').addEventListener('change', (e) => { state.dbFilters.project = e.target.value; renderDb(); });
  $('#db-status').addEventListener('change', (e) => { state.dbFilters.status = e.target.value; renderDb(); });
  $('#db-from').addEventListener('change', (e) => { state.dbFilters.dateFrom = e.target.value; renderDb(); });
  $('#db-to').addEventListener('change', (e) => { state.dbFilters.dateTo = e.target.value; renderDb(); });
  $('#db-new').addEventListener('click', () => openRecordModal({ date: todayStr(), done: false, status: 'todo' }));

  // 看板分组维度切换
  const boardDimBar = h('div', { class: 'filterbar hidden', id: 'board-dim-bar' },
    h('span', { class: 'hint', text: '看板分组：' }),
    h('div', { class: 'seg', id: 'board-dim' },
      h('button', {
        class: 'active', 'data-dim': 'project', text: '按项目',
        onclick: () => { state.boardDim = 'project'; syncBoardDim(); renderDb(); },
      }),
      h('button', {
        'data-dim': 'status', text: '按状态',
        onclick: () => { state.boardDim = 'status'; syncBoardDim(); renderDb(); },
      })));
  $('#db-filter').after(boardDimBar);

  // 筛选保存与应用
  $('#db-save-filter').addEventListener('click', async () => {
    const f = state.dbFilters;
    const desc = [
      f.q && `搜索「${f.q}」`,
      f.project && `项目 ${f.project}`,
      f.status && ({ open: '未完成', todo: '待办', doing: '进行中', blocked: '受阻', done: '已完成' }[f.status]),
      (f.dateFrom || f.dateTo) && `${f.dateFrom || '…'} ~ ${f.dateTo || '…'}`,
    ].filter(Boolean).join(' + ') || '全部记录';
    const name = await askText({ title: '筛选名称', placeholder: '为此筛选起个名字', initial: desc });
    if (!name || !name.trim()) return;
    await filtersApi.save({ name: name.trim(), query: JSON.stringify(f) });
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
      const f = (await filtersApi.list()).find((x) => x.id === id);
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
}

function syncBoardDim() {
  $$('#board-dim button').forEach((b) => b.classList.toggle('active', b.dataset.dim === state.boardDim));
}

export { BUILTIN_FILTERS, loadSavedFilters, renderBoard, renderBoardByStatus, renderCalendar, openTableMenu, closeTableMenu, fillProjectSelect };
