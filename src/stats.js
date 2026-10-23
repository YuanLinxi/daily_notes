// 回顾：日聚合、热力图、时间轴、总览统计（基于对象模型）
const { getDb } = require('./connection');
const obj = require('./objects');
const { today } = require('./util');

// 取全部未删除记录（含属性值），供统计各函数复用
function liveNotes() {
  return obj.listWithValues('note').map((o) => ({ id: o.id, ...o.values, title: o.title }));
}

// 按日聚合记录条数与工时（分钟）
function dailyBuckets(dateFrom, dateTo) {
  const map = new Map();
  for (const r of liveNotes()) {
    const date = r.date || '';
    if (!date || date < dateFrom || date > dateTo) continue;
    const b = map.get(date) || { count: 0, done: 0, minutes: 0 };
    b.count += 1;
    if ((r.status || '') === 'done') b.done += 1;
    if (r.start_time && r.finish_time) {
      const t1 = new Date(`2000-01-01T${r.start_time}`);
      const t2 = new Date(`2000-01-01T${r.finish_time}`);
      const diff = (t2 - t1) / 60000;
      if (diff > 0) b.minutes += Math.round(diff);
    }
    map.set(date, b);
  }
  return map;
}

function heatmap({ year, dateFrom, dateTo } = {}) {
  let from = dateFrom;
  let to = dateTo;
  if (year && !from) {
    from = `${year}-01-01`;
    to = `${year}-12-31`;
  }
  if (!from) {
    const y = new Date().getFullYear();
    from = `${y}-01-01`;
    to = `${y}-12-31`;
  }
  const map = dailyBuckets(from, to);
  const days = [...map.entries()].map(([date, b]) => ({ date, ...b })).sort((a, b) => a.date.localeCompare(b.date));

  const hourCount = new Map();
  for (const r of liveNotes()) {
    const d = r.date || '';
    if (!d || d < from || d > to || !r.start_time) continue;
    const hh = String(r.start_time).slice(0, 2);
    hourCount.set(hh, (hourCount.get(hh) || 0) + 1);
  }
  const hours = [...hourCount.entries()]
    .map(([hour, c]) => ({ hour, c }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
  return { from, to, days, hours };
}

function timeline({ limit = 200, project = '', q = '' } = {}) {
  const needle = (q || '').toLowerCase();
  return liveNotes()
    .filter((r) => {
      if (project && (r.project || '') !== project) return false;
      if (needle) {
        const hay = `${r.title || ''}\n${r.content || ''}\n${r.remark || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .map((r) => ({
      id: r.id,
      date: r.date || '',
      project: r.project || '',
      title: r.title || '',
      content: r.content || '',
      done: (r.status || '') === 'done' ? 1 : 0,
      start_time: r.start_time || '',
      finish_time: r.finish_time || '',
      remark: r.remark || '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, limit);
}

// 统计口径：只统计未删除记录，回收站单独计数
function stats() {
  const live = liveNotes();
  const total = live.length;
  const done = live.filter((r) => (r.status || '') === 'done').length;
  const dates = new Set(live.map((r) => r.date).filter(Boolean));
  const activeDays = dates.size;
  const todayStr = today();
  const earlier = live.filter((r) => (r.date || '') < todayStr).length;
  const projects = new Set(live.map((r) => r.project).filter(Boolean)).size;

  // 连续记录天数：从今天（今天无记录则从昨天）起向前连续回溯
  const cursor = new Date();
  if (!dates.has(today(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(today(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    total, done, activeDays, earlier, projects, streak,
    trash: getDb().prepare("SELECT COUNT(*) AS c FROM objects WHERE type_key='note' AND deleted_at <> ''").get().c,
    snippets: getDb().prepare("SELECT COUNT(*) AS c FROM objects WHERE type_key='snippet'").get().c,
  };
}

module.exports = { dailyBuckets, heatmap, timeline, stats, liveNotes };
