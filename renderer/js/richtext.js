// 富媒体编辑：文本 / 图片 / 视频 / 思维导图 / 手绘
// 思维导图与手绘以 <div data-widget="mindmap|draw"> 嵌入正文，数据存于 content_json，可再次编辑。
import { h as el } from './core/dom.js';
import { askText } from './core/prompt.js';

const uid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- 无限画布视口 ----------
// 支持：滚轮缩放（以指针为中心）、拖拽空白处或按住空格/中键平移、缩放按钮、适应窗口、重置
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

function createViewport({ isDraw = false, onPanStart } = {}) {
  const viewport = el('div', { class: 'canvas-viewport' + (isDraw ? ' is-draw' : '') });
  const inner = el('div', { class: 'mm-viewport-inner' });
  const badge = el('div', { class: 'zoom-badge', text: '100%' });
  viewport.append(inner, badge);

  const view = { scale: 1, x: 0, y: 0 };

  function apply() {
    inner.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    badge.textContent = Math.round(view.scale * 100) + '%';
  }

  // 内容尺寸：优先取 inner 自身；若内容为绝对定位导致塌陷，则退化为子元素最大包围盒
  const innerSize = () => {
    if (inner.offsetWidth && inner.offsetHeight) return { w: inner.offsetWidth, h: inner.offsetHeight };
    let w = 0, h = 0;
    for (const child of inner.children) {
      if (child.offsetWidth || child.offsetHeight) {
        w = Math.max(w, child.offsetLeft + child.offsetWidth);
        h = Math.max(h, child.offsetTop + child.offsetHeight);
      }
    }
    return { w, h };
  };
  // 内容原点相对 inner 边框盒左上角的偏移（padding 部分）
  const contentOffset = () => ({
    x: inner.offsetLeft - inner.clientLeft,
    y: inner.offsetTop - inner.clientTop,
  });

  // 内容参照元素：优先用显式指定的内容元素（如 canvas），否则用 inner
  let contentEl = null;
  const setContentEl = (elm) => { contentEl = elm; };

  // 屏幕坐标 → 内容坐标
  // 基准取内容元素自身的屏幕矩形：它已经包含了 translate/scale 的全部效果，
  // 因此只需 (client - rect.left) / scale 即为内容坐标，无需再单独减平移或 padding。
  function toContent(clientX, clientY) {
    const target = contentEl || inner;
    const r = target.getBoundingClientRect();
    return {
      x: (clientX - r.left) / view.scale,
      y: (clientY - r.top) / view.scale,
    };
  }

  function fitToWindow() {
    const { w, h } = innerSize();
    if (!w || !h) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((vw - 60) / w, (vh - 60) / h, 1)));
    view.x = (vw - w * view.scale) / 2;
    view.y = (vh - h * view.scale) / 2;
    apply();
  }

  function centerOnContent() {
    fitToWindow();
  }

  // 以屏幕坐标 (sx, sy) 为锚点缩放
  function zoomAt(nextScale, sx, sy) {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const r = viewport.getBoundingClientRect();
    const px = sx - r.left;
    const py = sy - r.top;
    const k = s / view.scale;
    view.x = px - (px - view.x) * k;
    view.y = py - (py - view.y) * k;
    view.scale = s;
    apply();
  }

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAt(view.scale * factor, e.clientX, e.clientY);
  }, { passive: false });

  // 平移：中键、空格+左键，或非绘图模式下的左键拖拽
  let panning = null;
  let spaceDown = false;
  const onKeyDown = (e) => { if (e.code === 'Space' && e.target === document.body) spaceDown = true; };
  const onKeyUp = (e) => { if (e.code === 'Space') spaceDown = false; };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  viewport.addEventListener('pointerdown', (e) => {
    const isMiddle = e.button === 1;
    const wantPan = isMiddle || spaceDown || (!isDraw && e.button === 0);
    if (!wantPan) return;
    e.preventDefault();
    e.stopPropagation();
    panning = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    viewport.classList.add('panning');
    try { viewport.setPointerCapture?.(e.pointerId); } catch { /* 合成事件无活动指针 */ }
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!panning) return;
    view.x = panning.ox + (e.clientX - panning.sx);
    view.y = panning.oy + (e.clientY - panning.sy);
    apply();
  });
  const endPan = (e) => {
    if (!panning) return;
    panning = null;
    viewport.classList.remove('panning');
    try { viewport.releasePointerCapture?.(e.pointerId); } catch { /* 忽略 */ }
  };
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);

  const controls = el('div', { class: 'row-gap' },
    el('button', { text: '−', title: '缩小', onclick: () => zoomAt(view.scale / 1.2, viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2) }),
    el('button', { text: '+', title: '放大', onclick: () => zoomAt(view.scale * 1.2, viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2) }),
    el('button', { text: '适应', title: '适应窗口', onclick: () => fitToWindow() }),
    el('button', { text: '100%', title: '还原比例', onclick: () => { view.scale = 1; apply(); } }),
  );

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  }

  return { viewport, inner, view, apply, controls, zoomAt, fitToWindow, centerOnContent, toContent, setContentEl, dispose };
}

// ---------- 绘图元素（笔迹 / 文字） ----------
// 统一数据结构：{ type: 'stroke', color, size, points: [[x,y],...] }
//               { type: 'text', x, y, text, color, size }
// 旧数据没有 type 字段，按笔迹处理

const isText = (it) => it.type === 'text';

function itemBBox(it) {
  if (isText(it)) {
    const fs = it.size * 4;
    const w = Math.max(fs, it.text.length * fs * 1);
    return { x0: it.x, y0: it.y - fs, x1: it.x + w, y1: it.y + fs * 0.3 };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of it.points) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  if (!Number.isFinite(x0)) return null;
  const pad = it.size / 2;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

function bboxOf(items) {
  let r = null;
  for (const it of items) {
    const b = itemBBox(it);
    if (!b) continue;
    if (!r) r = { ...b };
    else {
      r.x0 = Math.min(r.x0, b.x0); r.y0 = Math.min(r.y0, b.y0);
      r.x1 = Math.max(r.x1, b.x1); r.y1 = Math.max(r.y1, b.y1);
    }
  }
  return r;
}

function hitItem(it, x, y, tol) {
  if (isText(it)) {
    const b = itemBBox(it);
    return x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol;
  }
  const t = tol + (it.size || 1) / 2;
  for (const p of it.points) {
    const dx = p[0] - x, dy = p[1] - y;
    if (dx * dx + dy * dy <= t * t) return true;
  }
  // 线段的粗检测（点稀疏时也能命中）
  for (let i = 1; i < it.points.length; i++) {
    if (distToSegment(x, y, it.points[i - 1], it.points[i]) <= t) return true;
  }
  return false;
}

function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

// 绘制单个元素到 2D 上下文
function paintItem(ctx, it) {
  if (isText(it)) {
    ctx.fillStyle = it.color || '#1c1b19';
    ctx.font = `600 ${it.size * 4}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(it.text, it.x, it.y);
    return;
  }
  if (!it.points || !it.points.length) return;
  ctx.strokeStyle = it.color;
  ctx.lineWidth = it.size;
  if (it.points.length === 1) {
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.arc(it.points[0][0], it.points[0][1], it.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  it.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
}

function moveItem(it, dx, dy) {
  if (isText(it)) {
    it.x += dx;
    it.y += dy;
  } else {
    it.points = it.points.map((p) => [p[0] + dx, p[1] + dy]);
  }
}

// ---------- 思维导图 ----------
  function mindmapToTree(map) {
    const nodes = new Map();
    for (const n of map.nodes) nodes.set(n.id, { ...n, children: [] });
    let root = null;
    for (const n of nodes.values()) {
      if (n.parent && nodes.has(n.parent)) nodes.get(n.parent).children.push(n);
      else if (!root) root = n;
    }
    return root;
  }

  function mindmapToText(map) {
    const root = mindmapToTree(map);
    const lines = [];
    const walk = (node, depth) => {
      if (!node) return;
      lines.push('  '.repeat(depth) + node.text);
      node.children.forEach((c) => walk(c, depth + 1));
    };
    walk(root, 0);
    return lines.join('\n');
  }

  function textToMindmapData(text) {
    const nodes = [];
    let rootId = null;
    let lastAtDepth = [];
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      const depth = Math.floor((raw.match(/^ */)[0].length) / 2);
      const id = uid();
      lastAtDepth[depth] = id;
      lastAtDepth.length = depth + 1;
      const parent = depth > 0 ? lastAtDepth[depth - 1] || rootId : null;
      if (!parent) rootId = id;
      nodes.push({ id, parent, text: raw.trim() });
    }
    if (!rootId) {
      rootId = uid();
      nodes.push({ id: rootId, parent: null, text: '中心主题' });
    }
    return { id: uid(), kind: 'mindmap', nodes, rootId };
  }

  function renderMindmap(data) {
    const host = el('div', { class: 'mindmap-host', 'data-widget': data.id, 'data-kind': 'mindmap' });
    const table = el('table', { class: 'mindmap-table', style: { borderCollapse: 'collapse' } });
    const root = mindmapToTree(data);
    const walk = (node, tree) => {
      const tr = el('tr');
      tree.append(tr);
      const cell = el('td', { style: { verticalAlign: 'middle', padding: '4px 0' } });
      const box = el('div', { class: 'mm-node' + (node === root ? ' root' : ''), text: node.text });
      box.dataset.id = node.id;
      cell.append(box);
      tr.append(cell);
      if (node.children.length) {
        const kids = el('table', { style: { borderCollapse: 'collapse' } });
        node.children.forEach((c) => walk(c, kids));
        tr.append(el('td', { style: { width: '26px', borderLeft: '1px solid #d8d2c7' } }));
        tr.append(el('td', { style: { verticalAlign: 'middle' } }, kids));
      }
    };
    walk(root, table);
    host.append(table);
    return host;
  }

  // 行内编辑脑图
  function openMindmapEditor(data) {
    const state = data ? {
      nodes: data.nodes.map((n) => ({ ...n })),
      rootId: data.rootId,
    } : textToMindmapData('中心主题');
    const root = mindmapToTree({ nodes: state.nodes });
    let selected = state.rootId;

    let resolve;
    const done = new Promise((r) => (resolve = r));
    const body = el('div', { class: 'editor-shell' });

    // 无限画布：滚轮缩放、拖拽空白平移
    const vp = createViewport({ isDraw: false });

    const hint = el('p', { class: 'hint', text: '单击节点选中；双击修改文字；Tab 新建子节点，Enter 新建同级；滚轮缩放，拖拽空白平移' });
    const toolbar = el('div', { class: 'row-gap' },
      el('button', { text: '+ 子节点', onclick: () => addNode(false) }),
      el('button', { text: '+ 同级节点', onclick: () => addNode(true) }),
      el('button', { text: '删除节点', onclick: () => removeNode() }),
      el('button', { text: '从大纲粘贴', onclick: () => importOutline() }),
    );

    function draw() {
      vp.inner.innerHTML = '';
      const host = renderMindmap({ nodes: state.nodes });
      host.style.display = 'inline-block';
      host.style.margin = '40px';
      vp.inner.append(host);
      vp.inner.querySelectorAll('.mm-node').forEach((n) => {
        if (n.dataset.id === selected) n.classList.add('active');
        n.addEventListener('click', (e) => { e.stopPropagation(); selected = n.dataset.id; draw(); });
        n.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const node = state.nodes.find((x) => x.id === n.dataset.id);
          const input = el('input', { type: 'text', value: node.text, style: { width: Math.max(120, node.text.length * 14) + 'px', padding: '1px 4px' } });
          n.replaceWith(input);
          input.focus(); input.select();
          const commit = () => { node.text = input.value.trim() || node.text; draw(); };
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { input.value = node.text; input.blur(); }
            ev.stopPropagation();
          });
        });
      });
    }

    function addNode(sibling) {
      const cur = state.nodes.find((x) => x.id === selected);
      if (!cur) return;
      const n = { id: uid(), parent: sibling ? cur.parent : cur.id, text: '新节点' };
      if (!n.parent) n.parent = null;
      state.nodes.push(n);
      selected = n.id;
      draw();
    }

    function removeNode() {
      if (selected === state.rootId) return;
      const stack = [selected];
      const drop = new Set();
      while (stack.length) {
        const id = stack.pop();
        drop.add(id);
        state.nodes.filter((n) => n.parent === id).forEach((n) => stack.push(n.id));
      }
      state.nodes = state.nodes.filter((n) => !drop.has(n.id));
      selected = state.rootId;
      draw();
    }

    function importOutline() {
      const ta = el('textarea', { class: 'code', placeholder: '每行一个节点，两个空格表示层级：\n中心主题\n  分支一\n    子项\n  分支二', style: { width: '100%', marginTop: '10px' } });
      const panel = el('div');
      if (!document.getElementById('mm-import')) {
        panel.id = 'mm-import';
        panel.append(el('p', { class: 'hint', text: '将当前导图替换为以下大纲结构：' }), ta);
        body.append(panel);
      }
      ta.focus();
      ta.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.ctrlKey) {
          ev.preventDefault();
          const data2 = textToMindmapData(ta.value);
          state.nodes = data2.nodes;
          state.rootId = data2.rootId;
          selected = data2.rootId;
          panel.remove();
          draw();
        }
        ev.stopPropagation();
      });
      panels.push(ta);
    }
    const panels = [];

    body.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Tab') { e.preventDefault(); addNode(false); }
      if (e.key === 'Enter') { e.preventDefault(); addNode(true); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeNode(); }
    });

    body.append(
      el('div', { class: 'editor-shell-head' },
        el('h2', { text: '思维导图' }),
        el('div', { class: 'editor-shell-tools' }, toolbar, vp.controls)),
      el('div', { class: 'editor-shell-body' }, vp.viewport),
      el('div', { class: 'editor-shell-foot' },
        hint,
        el('div', { class: 'row-gap' },
          el('button', { text: '取消', onclick: () => close(null) }),
          el('button', { class: 'primary', text: '确定', onclick: () => close({ id: data ? data.id : uid(), kind: 'mindmap', nodes: state.nodes, rootId: state.rootId }) }))),
    );
    draw();

    const modal = document.getElementById('modal');
    const mask = document.getElementById('modal-mask');
    const hostModalBody = modal.firstElementChild;
    hostModalBody.innerHTML = '';
    hostModalBody.append(body);
    modal.classList.add('wide', 'editor-modal');
    mask.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => vp.fitToWindow()));

    function close(result) {
      vp.dispose();
      mask.classList.add('hidden');
      modal.classList.remove('wide', 'editor-modal');
      hostModalBody.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKey);
    return done;
  }

  // ---------- 手绘 ----------
  function openDrawEditor(data) {
    let resolve;
    const done = new Promise((r) => (resolve = r));

    // 无限画布：画布按内容范围动态扩展，支持滚动缩放与平移
    const vp = createViewport({ isDraw: true });

    // 背景层：绘制所有元素；叠加层：选择框、选中高亮、橡皮轨迹
    const canvas = el('canvas', { width: 1, height: 1, style: { display: 'block' } });
    const ctx = canvas.getContext('2d');
    vp.setContentEl(canvas);
    const overlay = el('canvas', { width: 1, height: 1, style: { display: 'block', pointerEvents: 'none', position: 'absolute', top: 0, left: 0 } });
    const octx = overlay.getContext('2d');
    vp.inner.append(canvas, overlay);

    // 兼容旧数据：无 type 的视为笔迹
    let items = (data && data.strokes ? JSON.parse(JSON.stringify(data.strokes)) : [])
      .map((s) => (s.type ? s : { ...s, type: 'stroke' }));
    let color = '#1c1b19';
    let size = 2.5;
    let tool = 'pen';            // pen | eraser | select | text
    let drawing = null;          // 当前笔迹
    let erasing = null;          // 橡皮轨迹
    let selection = null;        // { x0,y0,x1,y1 } 逻辑坐标
    let selected = [];           // 选中的元素引用
    let moving = null;           // { last: [x,y] }
    let marquee = null;          // 框选起点
    let bounds = { x0: 0, y0: 0, x1: 1000, y1: 600 };
    let toastTimer = null;

    const hintEl = el('p', { class: 'hint', text: '' });

    // 画布像素坐标即 toContent 的返回结果：缩放/平移后仍精确对应屏幕位置。
    // 画布原点固定 (0,0)，只按需向右/下扩展，因此左上角永不移动，坐标换算稳定。
    // 初始画布尺寸由视口决定（首屏铺满绘制区），之后只扩展不收缩；视口未就绪时用兜底值。
    let baseSize = null;
    function ensureBaseSize() {
      if (baseSize) return baseSize;
      const vw = vp.viewport.clientWidth || 1200;
      const vh = vp.viewport.clientHeight || 700;
      baseSize = {
        w: Math.max(900, Math.ceil(vw / 100) * 100),
        h: Math.max(500, Math.ceil(vh / 100) * 100),
      };
      return baseSize;
    }

    function computeBounds() {
      const b = bboxOf(items);
      const pad = 200;
      const base = ensureBaseSize();
      if (!b) bounds = { x0: 0, y0: 0, x1: base.w, y1: base.h };
      else {
        // items 里存的就是画布像素坐标，直接据此取范围
        bounds = {
          x0: 0,
          y0: 0,
          x1: Math.max(base.w, Math.ceil((b.x1 + pad) / 200) * 200),
          y1: Math.max(base.h, Math.ceil((b.y1 + pad) / 200) * 200),
        };
      }
    }

    // 屏幕 → 画布像素坐标
    const pos = (e) => {
      const p = vp.toContent(e.clientX, e.clientY);
      return [Math.round(p.x), Math.round(p.y)];
    };

    function resizeCanvases() {
      const w = Math.max(1, Math.ceil(bounds.x1 - bounds.x0));
      const h = Math.max(1, Math.ceil(bounds.y1 - bounds.y0));
      for (const c of [canvas, overlay]) {
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
          c.style.width = w + 'px';
          c.style.height = h + 'px';
        }
      }
    }

    function redraw() {
      computeBounds();
      resizeCanvases();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const it of items) paintItem(ctx, it);
      drawOverlay();
    }

    // 叠加层：选中高亮 / 框选框 / 橡皮轨迹
    function drawOverlay() {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      const s = vp.view.scale || 1;

      if (selection) {
        octx.save();
        octx.strokeStyle = '#b08d57';
        octx.lineWidth = 1.5 / s;
        octx.setLineDash([6 / s, 4 / s]);
        octx.strokeRect(selection.x0, selection.y0, selection.x1 - selection.x0, selection.y1 - selection.y0);
        octx.fillStyle = 'rgba(176,141,87,.10)';
        octx.fillRect(selection.x0, selection.y0, selection.x1 - selection.x0, selection.y1 - selection.y0);
        octx.restore();
      }
      if (marquee) {
        const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
        const w = Math.abs(marquee.x1 - marquee.x0), hh = Math.abs(marquee.y1 - marquee.y0);
        octx.save();
        octx.strokeStyle = '#33557e';
        octx.lineWidth = 1.5 / s;
        octx.setLineDash([5 / s, 3 / s]);
        octx.strokeRect(x, y, w, hh);
        octx.fillStyle = 'rgba(51,85,126,.08)';
        octx.fillRect(x, y, w, hh);
        octx.restore();
      }
      if (erasing && erasing.length) {
        octx.save();
        octx.strokeStyle = 'rgba(164,72,63,.45)';
        octx.lineWidth = 10 / s;
        octx.lineCap = 'round';
        octx.lineJoin = 'round';
        octx.beginPath();
        erasing.forEach((p, i) => (i ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1])));
        octx.stroke();
        octx.restore();
      }
    }

    const tol = () => 6 / (vp.view.scale || 1);

    function updateHint() {
      const texts = {
        pen: '滚轮缩放 · 拖拽空白处平移 · 画布随笔迹自动扩展',
        eraser: '在笔迹上拖动即可擦除',
        select: '拖拽框选 · 拖动选中区域可移动 · Delete 删除 · Esc 取消选择',
        text: '在画布上点击即可输入文字',
      };
      hintEl.textContent = texts[tool] || '';
    }

    function toastMsg(msg) {
      hintEl.textContent = msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(updateHint, 1400);
    }

    function setTool(next) {
      tool = next;
      selection = null;
      selected = [];
      vp.viewport.classList.toggle('is-draw', next === 'pen' || next === 'eraser');
      vp.viewport.style.cursor = next === 'select' ? 'default' : next === 'text' ? 'text' : '';
      toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === next));
      drawOverlay();
      updateHint();
    }

    // 选中框内包含的元素（包围盒相交即算选中）
    function itemsInRect(rect) {
      const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
      const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
      return items.filter((it) => {
        const b = itemBBox(it);
        if (!b) return false;
        return b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0;
      });
    }

    function itemsAt(x, y) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (hitItem(items[i], x, y, tol())) return items[i];
      }
      return null;
    }

    function eraseAt(x, y) {
      const before = items.length;
      items = items.filter((it) => !hitItem(it, x, y, 6 + (it.size || 1) / 2));
      if (items.length !== before) redraw();
    }

    async function addTextAt(x, y, clientX, clientY) {
      const value = await askText({ title: '输入文字', placeholder: '文字内容', x: clientX, y: clientY });
      if (value === null) return;
      const text = value.trim();
      if (!text) return;
      items.push({ type: 'text', x, y, text, color, size: Math.max(2, size) });
      redraw();
    }

    function deleteSelected() {
      if (!selected.length) return;
      const set = new Set(selected);
      items = items.filter((it) => !set.has(it));
      selected = [];
      selection = null;
      redraw();
      toastMsg('已删除');
    }

    vp.viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // 中键交给视口平移
      e.stopPropagation();
      try { vp.viewport.setPointerCapture?.(e.pointerId); } catch { /* 合成事件 */ }
      const p = pos(e);

      if (tool === 'pen') {
        drawing = { type: 'stroke', color, size, points: [p] };
        items.push(drawing);
        redraw();
        return;
      }
      if (tool === 'eraser') {
        erasing = [p];
        eraseAt(p[0], p[1]);
        return;
      }
      if (tool === 'text') {
        addTextAt(p[0], p[1], e.clientX, e.clientY);
        return;
      }

      // select
      if (selection && p[0] >= selection.x0 && p[0] <= selection.x1 && p[1] >= selection.y0 && p[1] <= selection.y1) {
        moving = { last: p };
        return;
      }
      const hit = itemsAt(p[0], p[1]);
      if (hit) {
        const b = itemBBox(hit);
        selection = { x0: b.x0 - 4, y0: b.y0 - 4, x1: b.x1 + 4, y1: b.y1 + 4 };
        selected = [hit];
        moving = { last: p };
        drawOverlay();
        return;
      }
      marquee = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
      selection = null;
      selected = [];
      drawOverlay();
    });

    vp.viewport.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (drawing) {
        drawing.points.push(p);
        redraw();
        return;
      }
      if (erasing) {
        erasing.push(p);
        eraseAt(p[0], p[1]);
        drawOverlay();
        return;
      }
      if (moving) {
        const dx = p[0] - moving.last[0];
        const dy = p[1] - moving.last[1];
        if (dx || dy) {
          for (const it of selected) moveItem(it, dx, dy);
          selection = { x0: selection.x0 + dx, y0: selection.y0 + dy, x1: selection.x1 + dx, y1: selection.y1 + dy };
          moving.last = p;
          redraw();
        }
        return;
      }
      if (marquee) {
        marquee.x1 = p[0];
        marquee.y1 = p[1];
        selected = itemsInRect(marquee);
        drawOverlay();
      }
    });

    const endPointer = () => {
      if (drawing) drawing = null;
      if (erasing) { erasing = null; drawOverlay(); }
      if (moving) moving = null;
      if (marquee) {
        const r = marquee;
        marquee = null;
        const hits = itemsInRect(r);
        const w = Math.abs(r.x1 - r.x0), hh = Math.abs(r.y1 - r.y0);
        // 太小视为单击空白 → 取消选择
        if (hits.length && (w > 3 || hh > 3)) {
          selected = hits;
          const b = bboxOf(hits);
          selection = { x0: b.x0 - 4, y0: b.y0 - 4, x1: b.x1 + 4, y1: b.y1 + 4 };
        } else {
          selected = [];
          selection = null;
        }
        drawOverlay();
      }
    };
    vp.viewport.addEventListener('pointerup', endPointer);
    vp.viewport.addEventListener('pointercancel', endPointer);

    // ---- 工具栏 ----
    const colors = ['#1c1b19', '#a4483f', '#4f7a5b', '#b08d57', '#3e5c86'];
    const swatches = el('div', { class: 'row-gap', style: { alignItems: 'center' } });
    colors.forEach((c) => {
      const b = el('button', {
        title: c,
        style: {
          width: '20px', height: '20px', borderRadius: '50%', background: c,
          border: c === color ? '2px solid var(--ink)' : '1px solid var(--line)', padding: 0,
        },
      });
      b.onclick = () => {
        color = c;
        [...swatches.children].forEach((x) => (x.style.border = '1px solid var(--line)'));
        b.style.border = '2px solid var(--ink)';
        // 选中元素时同步改色
        if (selected.length) {
          for (const it of selected) it.color = c;
          redraw();
        }
      };
      swatches.append(b);
    });

    const sizeSel = el('select', {}, ...[1.5, 2.5, 4, 7].map((s) => el('option', { value: s, text: s + ' px' })));
    sizeSel.value = String(size);
    sizeSel.onchange = () => { size = Number(sizeSel.value); };

    const toolButtons = [];
    const toolBtn = (key, label, title) => {
      const b = el('button', { 'data-tool': key, text: label, title });
      b.onclick = () => setTool(key);
      toolButtons.push(b);
      return b;
    };
    const toolGroup = el('div', { class: 'seg', style: { marginRight: '8px' } },
      toolBtn('pen', '✏️ 画笔', '画笔'),
      toolBtn('eraser', '🧽 橡皮', '橡皮擦'),
      toolBtn('select', '⬚ 框选', '框选 / 移动 / 删除'),
      toolBtn('text', 'T 文字', '添加文字'));

    const body = el('div', { class: 'editor-shell' });
    body.append(
      el('div', { class: 'editor-shell-head' },
        el('h2', { text: '手绘' }),
        el('div', { class: 'editor-shell-tools' },
          toolGroup, swatches, sizeSel,
          el('button', { text: '删除选中', onclick: () => deleteSelected() }),
          el('button', { text: '撤销', onclick: () => { if (items.length) { items.pop(); redraw(); } } }),
          el('button', {
            text: '清空',
            onclick: () => {
              if (items.length && confirm('清空全部内容？')) {
                items = [];
                selected = [];
                selection = null;
                redraw();
              }
            },
          }),
          vp.controls)),
      el('div', { class: 'editor-shell-body' }, vp.viewport),
      el('div', { class: 'editor-shell-foot' },
        hintEl,
        el('div', { class: 'row-gap' },
          el('button', { text: '取消', onclick: () => close(null) }),
          el('button', {
            class: 'primary', text: '插入',
            onclick: () => {
              computeBounds();
              close({
                id: data ? data.id : uid(), kind: 'draw', strokes: items,
                w: Math.ceil(bounds.x1 - bounds.x0), h: Math.ceil(bounds.y1 - bounds.y0),
                origin: { x: 0, y: 0 },
              });
            },
          }))),
    );
    setTool('pen');
    redraw();

    const modal = document.getElementById('modal');
    const mask = document.getElementById('modal-mask');
    const hostModalBody = modal.firstElementChild;
    hostModalBody.innerHTML = '';
    hostModalBody.append(body);
    modal.classList.add('wide', 'editor-modal');
    mask.classList.remove('hidden');
    // 等两帧确保内容完成布局后，以 100% 比例把画布起点对齐视口左上角
    requestAnimationFrame(() => requestAnimationFrame(() => {
      vp.view.scale = 1;
      vp.view.x = 0;
      vp.view.y = 0;
      vp.apply();
      drawOverlay();
    }));

    function close(result) {
      vp.dispose();
      clearTimeout(toastTimer);
      mask.classList.add('hidden');
      modal.classList.remove('wide', 'editor-modal');
      hostModalBody.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        if (selection) { selection = null; selected = []; drawOverlay(); return; }
        close(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        deleteSelected();
      }
    }
    document.addEventListener('keydown', onKey);
    return done;
  }

  function renderDraw(data) {
    const scale = 2;
    const ox = data.origin?.x || 0;
    const oy = data.origin?.y || 0;
    const canvas = el('canvas', { width: data.w * scale, height: data.h * scale, style: { width: '100%', display: 'block', borderRadius: '4px', border: '1px solid var(--line-soft)', background: '#fff' } });
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.translate(-ox, -oy);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // 兼容旧数据（无 type 视为笔迹）与新增的文字元素
    for (const it of data.strokes || []) paintItem(ctx, it.type ? it : { ...it, type: 'stroke' });
    const host = el('div', { class: 'draw-host', 'data-widget': data.id, 'data-kind': 'draw' });
    host.append(canvas);
    return host;
  }

  // ---------- 编辑器 ----------
  function createEditor(container, initial = {}) {
    const widgets = new Map(); // id -> data
    try {
      for (const w of JSON.parse(initial.json || '[]')) widgets.set(w.id, w);
    } catch { /* 忽略损坏数据 */ }

    const toolbar = el('div', { class: 'editor-toolbar' });
    const editor = el('div', { class: 'rte', contenteditable: 'true', 'data-placeholder': '记录今天做了什么…' });

    const cmd = (name, value = null) => { editor.focus(); document.execCommand(name, false, value); sync(); };
    const addBtn = (label, title, fn) => toolbar.append(el('button', { type: 'button', title, text: label, onmousedown: (e) => e.preventDefault(), onclick: fn }));
    addBtn('B', '加粗', () => cmd('bold'));
    addBtn('I', '斜体', () => cmd('italic'));
    addBtn('U', '下划线', () => cmd('underline'));
    toolbar.append(el('span', { class: 'sep' }));
    addBtn('H', '标题', () => cmd('formatBlock', '<h3>'));
    addBtn('• 列表', '无序列表', () => cmd('insertUnorderedList'));
    addBtn('1. 列表', '有序列表', () => cmd('insertOrderedList'));
    addBtn('</>', '代码块', () => cmd('formatBlock', '<pre>'));
    toolbar.append(el('span', { class: 'sep' }));
    addBtn('图片', '插入本地图片', () => insertImage());
    addBtn('视频', '插入本地视频', () => insertVideo());
    addBtn('思维导图', '插入思维导图', () => insertMindmap());
    addBtn('手绘', '鼠标手绘', () => insertDraw());

    editor.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData?.items || [])];
      const img = items.find((i) => i.type.startsWith('image/'));
      if (img) {
        e.preventDefault();
        const file = img.getAsFile();
        readImage(file).then((src) => insertImgNode(src, file.name));
        return;
      }
      // 纯文本粘贴，避免带入外部样式
      const html = e.clipboardData.getData('text/html');
      if (html && /<(img|table|div|br|p)/i.test(html)) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    editor.addEventListener('input', sync);
    editor.addEventListener('click', (e) => {
      const host = e.target.closest('[data-widget]');
      if (!host) return;
      if (e.target.tagName === 'CANVAS' || host.dataset.kind === 'mindmap' || e.target.closest('.mm-node')) {
        editWidget(host.dataset.widget);
      }
    });

    function readImage(file) {
      return new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(file);
      });
    }

    async function insertImage() {
      const [file] = await pickFile('image/png,image/jpeg,image/gif,image/webp');
      if (!file) return;
      insertImgNode(await readImage(file), file.name);
    }

    async function insertVideo() {
      const [file] = await pickFile('video/mp4,video/webm,video/ogg,video/quicktime');
      if (!file) return;
      if (file.size > 200 * 1024 * 1024) {
        alert('视频超过 200MB，建议压缩后再插入（视频会以 base64 存入数据库）。');
        return;
      }
      insertNode(el('video', {
        src: await readImage(file),
        controls: 'controls',
        preload: 'metadata',
        class: 'rte-video',
        title: file.name,
      }));
    }

    function pickFile(accept) {
      return new Promise((res) => {
        const inp = el('input', { type: 'file', accept, style: { display: 'none' } });
        document.body.append(inp);
        inp.addEventListener('change', () => { res(inp.files); inp.remove(); });
        inp.click();
      });
    }

    function insertNode(node) {
      editor.focus();
      const sel = window.getSelection();
      let range;
      if (sel.rangeCount && editor.contains(sel.anchorNode)) range = sel.getRangeAt(0);
      else {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      const block = el('div');
      block.append(node);
      const after = el('div', { html: '<br>' });
      range.deleteContents();
      range.insertNode(after);
      range.insertNode(block);
      const r2 = document.createRange();
      r2.setStart(after, 0);
      r2.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r2);
      sync();
    }

    function insertImgNode(src, alt = '') {
      insertNode(el('img', { src, alt }));
    }

    async function insertMindmap() {
      const data = await openMindmapEditor(null);
      if (!data) return;
      widgets.set(data.id, data);
      const host = renderMindmap(data);
      host.title = '双击或单击可再次编辑';
      host.dataset.json = JSON.stringify(data);
      insertNode(host);
    }

    async function insertDraw() {
      const data = await openDrawEditor(null);
      if (!data) return;
      widgets.set(data.id, data);
      const host = renderDraw(data);
      host.title = '单击可再次编辑';
      host.dataset.json = JSON.stringify(data);
      insertNode(host);
    }

    async function editWidget(id) {
      const data = widgets.get(id);
      if (!data) return;
      const updated = data.kind === 'mindmap' ? await openMindmapEditor(data) : await openDrawEditor(data);
      if (!updated) return;
      widgets.set(id, updated);
      const old = editor.querySelector(`[data-widget="${id}"]`);
      if (!old) return;
      const fresh = updated.kind === 'mindmap' ? renderMindmap(updated) : renderDraw(updated);
      fresh.title = old.title;
      fresh.dataset.json = JSON.stringify(updated);
      old.replaceWith(fresh);
      sync();
    }

    function sync() {
      const nodes = editor.querySelectorAll('[data-widget]');
      nodes.forEach((n) => {
        const d = widgets.get(n.dataset.widget);
        if (d) { n.dataset.json = JSON.stringify(d); n.dataset.kind = d.kind; }
      });
    }

    function setValue(html, json) {
      editor.innerHTML = html || '';
      widgets.clear();
      try {
        for (const w of JSON.parse(json || '[]')) widgets.set(w.id, w);
      } catch { /* 忽略 */ }
      // 依据数据重绘嵌入内容，保证可再次编辑
      editor.querySelectorAll('[data-widget]').forEach((n) => {
        const d = widgets.get(n.dataset.widget);
        if (!d) { n.remove(); return; }
        const fresh = d.kind === 'mindmap' ? renderMindmap(d) : renderDraw(d);
        fresh.title = n.title || (d.kind === 'mindmap' ? '双击或单击可再次编辑' : '单击可再次编辑');
        n.replaceWith(fresh);
      });
    }

    function getValue() {
      sync();
      const clone = editor.cloneNode(true);
      clone.querySelectorAll('.mm-node.active').forEach((n) => n.classList.remove('active'));
      const json = JSON.stringify([...widgets.values()]);
      // 纯文本：导图转大纲，手绘保留占位说明
      const textParts = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) textParts.push(child.textContent);
          else if (child.tagName === 'IMG') textParts.push('[图片]');
          else if (child.tagName === 'VIDEO') textParts.push('[视频]');
          else if (child.dataset && child.dataset.widget) {
            const d = widgets.get(child.dataset.widget);
            if (d?.kind === 'mindmap') textParts.push(mindmapToText(d));
            else textParts.push('[手绘]');
          } else if (child.tagName === 'BR') textParts.push('\n');
          else {
            walk(child);
            if (/^(DIV|P|H3|PRE|LI|UL|OL|BLOCKQUOTE)$/.test(child.tagName)) textParts.push('\n');
          }
        }
      };
      walk(clone);
      const text = textParts.join('').replace(/\n{3,}/g, '\n\n').trim();
      return { html: clone.innerHTML, json, text };
    }

    container.append(toolbar, editor);
    if (initial.html) setValue(initial.html, initial.json);

    return { getValue, setValue, insertHtml: (html) => { editor.focus(); document.execCommand('insertHTML', false, html); sync(); }, focus: () => editor.focus(), editor };
  }

export { createEditor, mindmapToText, renderMindmap, renderDraw };
