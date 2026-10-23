// 回顾：日聚合、热力图、时间轴、总览统计
const { getDb } = require('./connection');

// 按日聚合记录条数与工时（分钟）
function dailyBuckets(dateFrom, dateTo) {
  const rows = getDb().prepare(`SELECT date, done, start_time, finish_time FROM daily_notes
    WHERE deleted_at = '' AND date >= ? AND date <= ?`).all(dateFrom, dateTo);
  const map = new Map();
  for (const r of rows) {
    const b = map.get(r.date) || { count: 0, done: 0, minutes: 0 };
    b.count += 1;
    if (r.done) b.done += 1;
    if (r.start_time && r.finish_time) {
      const t1 = new Date(`2000-01-01T${r.start_time}`);
      const t2 = new Date(`2000-01-01T${r.finish_time}`);
      const diff = (t2 - t1) / 60000;
      if (diff > 0) b.minutes += Math.round(diff);
    }
    map.set(r.date, b);
  }
  return map;
}

function heatmap({ year, dateFrom, dateTo } = {}) {
  const db = getDb();
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
  const days = [...map.entries()].map(([date, b]) => ({ date, ...b }));
  const hourRows = db.prepare(`SELECT substr(start_time,1,2) AS hour, COUNT(*) AS c FROM daily_notes
    WHERE deleted_at = '' AND date >= ? AND date <= ? AND start_time <> '' GROUP BY hour`).all(from, to);
  return { from, to, days, hours: hourRows };
}

function timeline({ limit = 200, project = '', q = '' } = {}) {
  const where = ["deleted_at = ''"];
  const args = { limit };
  if (project) { where.push('project = :project'); args.project = project; }
  if (q) { where.push('(title LIKE :q OR content LIKE :q OR remark LIKE :q)'); args.q = `%${q}%`; }
  return getDb().prepare(`SELECT id, date, project, title, content, done, start_time, finish_time, remark
    FROM daily_notes ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY date DESC, id DESC LIMIT :limit`).all(args);
}

// 统计口径：所有新增指标均只统计未删除记录（deleted_at = ''），回收站单独计数
function stats() {
  const db = getDb();
  const live = "deleted_at = ''";
  const total = db.prepare(`SELECT COUNT(*) AS c FROM daily_notes WHERE ${live}`).get().c;
  const done = db.prepare(`SELECT COUNT(*) AS c FROM daily_notes WHERE ${live} AND done = 1`).get().c;
  const activeDays = db.prepare(`SELECT COUNT(DISTINCT date) AS c FROM daily_notes WHERE ${live}`).get().c;
  const earlier = db.prepare(`SELECT COUNT(*) AS c FROM daily_notes WHERE ${live} AND date < date('now','localtime')`).get().c;
  const projects = db.prepare(`SELECT COUNT(DISTINCT project) AS c FROM daily_notes WHERE ${live} AND project <> ''`).get().c;

  // 连续记录天数：从今天（今天无记录则从昨天）起向前连续回溯
  const dates = new Set(db.prepare(`SELECT DISTINCT date FROM daily_notes WHERE ${live} ORDER BY date DESC`).all().map((r) => r.date));
  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const cursor = new Date();
  if (!dates.has(fmt(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(fmt(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    total, done, activeDays, earlier, projects, streak,
    trash: db.prepare("SELECT COUNT(*) AS c FROM daily_notes WHERE deleted_at <> ''").get().c,
    snippets: db.prepare('SELECT COUNT(*) AS c FROM snippets').get().c,
  };
}

module.exports = { dailyBuckets, heatmap, timeline, stats };
