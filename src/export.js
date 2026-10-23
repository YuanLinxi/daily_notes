// 通用导出：Markdown 与 HTML（可打印为 PDF）
const { getDb } = require('./connection');
const { isoNow } = require('./util');

function exportMarkdown({ dateFrom = '', dateTo = '', project = '' } = {}) {
  const where = ["deleted_at = ''"];
  const args = [];
  if (dateFrom) { where.push('date >= ?'); args.push(dateFrom); }
  if (dateTo) { where.push('date <= ?'); args.push(dateTo); }
  if (project) { where.push('project = ?'); args.push(project); }
  const notes = getDb().prepare(`SELECT * FROM daily_notes WHERE ${where.join(' AND ')} ORDER BY date ASC, id ASC`).all(...args);

  const md = [];
  md.push('# Daily Notes 导出');
  md.push('');
  md.push(`> 导出时间：${isoNow()}　范围：${dateFrom || '最早'} ~ ${dateTo || '最新'}${project ? `　项目：${project}` : ''}`);
  md.push('');
  let lastDate = '';
  for (const n of notes) {
    if (n.date !== lastDate) {
      lastDate = n.date;
      md.push(`## ${n.date}`);
      md.push('');
    }
    const statusText = { done: '已完成', doing: '进行中', blocked: '受阻', todo: '待办' }[n.status] || '';
    md.push(`### ${n.title || '(无标题)'}${n.project ? ` ｜ ${n.project}` : ''}${statusText ? ` ｜ ${statusText}` : ''}`);
    const times = [n.start_time && `开始 ${n.start_time}`, n.finish_time && `完成 ${n.finish_time}`].filter(Boolean).join(' · ');
    const metaLine = [times, n.due_date && `截止 ${n.due_date}`, n.remark && `备注：${n.remark}`].filter(Boolean).join('　');
    if (metaLine) md.push(`*${metaLine}*`);
    md.push('');
    md.push(n.content || '(无正文)');
    md.push('');
  }
  return md.join('\n');
}

function exportHtml({ dateFrom = '', dateTo = '', project = '' } = {}) {
  const markdown = exportMarkdown({ dateFrom, dateTo, project });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const body = markdown.split('\n').map((line) => {
    if (line.startsWith('### ')) return `<h3>${esc(line.slice(4))}</h3>`;
    if (line.startsWith('## ')) return `<h2>${esc(line.slice(3))}</h2>`;
    if (line.startsWith('# ')) return `<h1>${esc(line.slice(2))}</h1>`;
    if (line.startsWith('> ')) return `<p class="meta">${esc(line.slice(2))}</p>`;
    if (line.startsWith('*') && line.endsWith('*')) return `<p class="meta">${esc(line.slice(1, -1))}</p>`;
    if (!line.trim()) return '';
    return `<p>${esc(line)}</p>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>Daily Notes 导出</title>
<style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#1c1b19;line-height:1.7}
h1{border-bottom:2px solid #b08d57;padding-bottom:8px}h2{margin-top:32px;color:#7d5f35}h3{margin-bottom:4px}
.meta{color:#8d877d;font-size:13px}p{white-space:pre-wrap;margin:6px 0}</style></head><body>${body}</body></html>`;
}

module.exports = { exportMarkdown, exportHtml };
