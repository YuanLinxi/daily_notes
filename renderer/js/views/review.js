// 回顾视图：统计、热力图、时段分布、时间轴、周报
import { $, h, toast } from '../core/dom.js';
import { meta, report, notes as notesApi } from '../core/api.js';
import { todayStr, pad, weekdayOf, statCard } from '../core/format.js';
import { showModal, closeModal } from '../ui/modal.js';
import { openRecordModal } from './database.js';
import { fillProjectSelect } from './database.js';

let yearSel;
let switchViewFn = () => {};

export async function loadReview() {
  const year = Number(yearSel.value);
  const [stats, hm, tl] = await Promise.all([
    meta.stats(),
    meta.heatmap({ year }),
    meta.timeline({ limit: 200, project: $('#rv-project').value }),
  ]);
  await fillProjectSelect($('#rv-project'));

  const statsHost = $('#rv-stats');
  statsHost.innerHTML = '';
  for (const [k, v] of [
    ['总记录', stats.total], ['已完成', stats.done], ['活跃天数', stats.activeDays],
    ['连续天数', stats.streak], ['项目数', stats.projects], ['命令条数', stats.snippets],
  ]) {
    statsHost.append(statCard(k, v));
  }

  renderHeatmap(hm, year);
  renderHours(hm.hours);
  renderTimeline(tl);
  $('#rv-legend').innerHTML = '少 <span class="hm-legend">'
    + ['', 'l1', 'l2', 'l3', 'l4'].map((c) => `<span class="hm-cell ${c}"></span>`).join('') + '</span> 多';
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

  while (cursor.getFullYear() === year || cursor < start) {
    if (cursor >= new Date(year + 1, 0, 1)) break;
    const col = h('div', { class: 'hm-col' });
    col.append(h('div', { class: 'm', text: cursor.getDate() <= 7 ? `${cursor.getMonth() + 1}月` : '' }));
    for (let i = 0; i < 7; i++) {
      const ds = todayStr(cursor);
      const inYear = cursor.getFullYear() === year;
      const rec = map.get(ds);
      const cell = h('div', {
        class: 'hm-cell ' + (inYear ? bucketLevel(rec?.count || 0) : '') + (ds === todayS ? ' today' : ''),
        title: inYear ? `${ds}  ${rec?.count || 0} 条记录${rec?.minutes ? ' · ' + rec.minutes + ' 分钟' : ''}` : '',
        style: inYear ? {} : { opacity: 0 },
      });
      cell.addEventListener('click', () => { if (rec) switchViewFn('db'); });
      col.append(cell);
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
    const hh = parseInt(r.hour, 10);
    if (!Number.isNaN(hh)) counts[hh] = r.c;
  }
  const max = Math.max(1, ...counts);
  counts.forEach((c, i) => {
    host.append(h('div', { class: 'hour', title: `${pad(i)}:00 — ${c} 条` },
      h('div', { class: 'bar', style: { height: Math.round((c / max) * 80) + 'px', opacity: c ? 0.85 : 0.12 } }),
      h('div', { class: 'lbl', text: i % 3 === 0 ? pad(i) : '' })));
  });
}

function renderTimeline(items) {
  const host = $('#rv-timeline');
  host.innerHTML = '';
  if (!items.length) {
    host.append(h('div', { class: 'empty', text: '暂无记录。' }));
    return;
  }
  let lastDate = '';
  for (const n of items) {
    if (n.date !== lastDate) {
      lastDate = n.date;
      host.append(h('div', {
        class: 'tl-date',
        style: { fontSize: '12px', fontWeight: '600', margin: '12px 0 2px', color: 'var(--ink)' },
        text: `${n.date} ${weekdayOf(n.date)}`,
      }));
    }
    host.append(h('div', {
      class: 'tl-item', style: { cursor: 'pointer' },
      onclick: () => openRecordModal(n),
    },
      h('div', {
        class: 'd',
        text: [n.start_time && `开始 ${n.start_time}`, n.finish_time && `完成 ${n.finish_time}`].filter(Boolean).join(' · ') || '未记录时间',
      }),
      n.title ? h('div', { class: 't', text: n.title }) : null,
      h('div', { class: 'c', text: n.content }),
      h('div', { class: 'm' },
        n.project ? h('span', { class: 'tag project', text: n.project }) : null,
        h('span', { class: 'tag ' + (n.done ? 'done' : 'todo'), text: n.done ? '已完成' : '未完成' }))));
  }
}

// ---------- 周报 ----------

async function openWeeklyReport() {
  const r = await report.weekly();
  const body = h('div');
  body.append(
    h('h2', { text: `周报 ${r.start} ~ ${r.endDate}` }),
    h('p', { class: 'hint', text: `共 ${r.totals.records} 条记录，完成 ${r.totals.done} 条。条目可点击跳回原始记录。` }),
  );
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
  body.append(
    h('p', { class: 'hint', text: 'Markdown 源文本（可直接编辑，改后以你编辑的为准复制）：' }),
    ta,
    h('div', { class: 'modal-foot' },
      h('button', {
        text: '复制全文',
        onclick: async () => { await navigator.clipboard.writeText(ta.value); toast('已复制'); },
      }),
      h('button', { class: 'primary', text: '关闭', onclick: closeModal })));
  showModal(body, true);
}

// 周报条目跳回原始记录
async function jumpToRecord(it) {
  if (!it.id) return;
  closeModal();
  openRecordModal(await notesApi.get(it.id));
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

export function initReviewView(setSwitchView) {
  switchViewFn = setSwitchView;
  yearSel = $('#rv-year');
  const nowY = new Date().getFullYear();
  yearSel.innerHTML = [nowY, nowY - 1, nowY - 2].map((y) => `<option value="${y}">${y} 年</option>`).join('');
  yearSel.addEventListener('change', () => loadReview());
  $('#rv-project').addEventListener('change', () =>
    meta.timeline({ limit: 200, project: $('#rv-project').value }).then(renderTimeline));
  $('#rv-weekly').addEventListener('click', openWeeklyReport);
}
