// 格式化与展示工具：日期、摘要、状态标签
import { h } from './dom.js';

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : '周' + WEEKDAY[d.getDay()];
}

// 表格/列表正文摘要：把脑图大纲、空行压成单段
export function summarize(text, max = 0) {
  const s = (text || '').split('\n').map((l) => l.trim()).filter(Boolean).join(' · ');
  return max > 0 ? s.slice(0, max) : s;
}

// 命中片段：前后各取一段便于预览
export function snippetAround(text, q, width = 40) {
  const i = (text || '').indexOf(q);
  if (i < 0) return text.slice(0, width * 2);
  const start = Math.max(0, i - width);
  const end = i + q.length + width;
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export const STATUS = {
  todo: { label: '待办', cls: 'st-todo' },
  doing: { label: '进行中', cls: 'st-doing' },
  blocked: { label: '受阻', cls: 'st-blocked' },
  done: { label: '已完成', cls: 'st-done' },
};

export const STATUS_SEQ = ['todo', 'doing', 'blocked', 'done'];

export function statusTag(n) {
  const s = STATUS[n.status] || (n.done ? STATUS.done : null);
  return s ? h('span', { class: 'tag ' + s.cls, text: s.label }) : null;
}

// 统计卡片
export function statCard(label, value) {
  return h('div', { class: 'stat' },
    h('div', { class: 'v', text: String(value) }),
    h('div', { class: 'k', text: label }));
}

// 下拉选项
export function optionList(items, valueKey = 'value', labelKey = 'label') {
  return items.map((it) => h('option', { value: it[valueKey], text: it[labelKey] }));
}

// 按日期分组
export function groupByDate(list) {
  const map = new Map();
  for (const n of list) {
    if (!map.has(n.date)) map.set(n.date, []);
    map.get(n.date).push(n);
  }
  return map;
}
