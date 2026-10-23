// 数据层通用工具：时间与行映射

function isoNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function mapNote(r) {
  return {
    id: r.id,
    date: r.date,
    project: r.project,
    title: r.title,
    content: r.content,
    contentHtml: r.content_html,
    done: !!r.done,
    status: r.status || (r.done ? 'done' : ''),
    dueDate: r.due_date || '',
    rootId: r.root_id || 0,
    startTime: r.start_time,
    finishTime: r.finish_time,
    remark: r.remark,
    contentJson: r.content_json,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapSnippet(r) {
  return {
    id: r.id,
    language: r.language,
    title: r.title,
    command: r.command,
    remark: r.remark,
    tags: r.tags,
    uses: r.uses,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function summarizeLine(text) {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
}

// 命中片段：前后各取一段便于预览
function snippetAround(text, q, width = 40) {
  const i = (text || '').indexOf(q);
  if (i < 0) return text.slice(0, width * 2);
  const start = Math.max(0, i - width);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + width) + (i + q.length + width < text.length ? '…' : '');
}

module.exports = { isoNow, today, mapNote, mapSnippet, summarizeLine, snippetAround };
