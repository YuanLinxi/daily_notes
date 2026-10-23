// 富媒体编辑：文本 / 图片 / 视频 / 思维导图 / 手绘
// 思维导图与手绘以 <div data-widget="mindmap|draw"> 嵌入正文，数据存于 content_json，可再次编辑。
import { h as el } from './core/dom.js';

const uid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
    const body = el('div');
    body.append(el('h2', { text: '思维导图' }));
    const treeWrap = el('div', {
      style: { border: '1px solid var(--line)', borderRadius: '6px', padding: '14px', minHeight: '220px', maxHeight: '52vh', overflow: 'auto', background: '#fff' },
    });
    const hint = el('p', { class: 'hint', text: '单击节点选中；双击修改文字；选中后按 Tab 新建子节点，Enter 新建同级节点，Delete 删除。' });
    const toolbar = el('div', { class: 'row-gap', style: { marginTop: '10px' } },
      el('button', { text: '+ 子节点', onclick: () => addNode(false) }),
      el('button', { text: '+ 同级节点', onclick: () => addNode(true) }),
      el('button', { text: '删除节点', onclick: () => removeNode() }),
      el('button', { text: '从大纲粘贴', onclick: () => importOutline() }),
    );

    function draw() {
      treeWrap.innerHTML = '';
      const host = renderMindmap({ nodes: state.nodes });
      treeWrap.append(host.firstChild);
      treeWrap.querySelectorAll('.mm-node').forEach((n) => {
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

    body.append(treeWrap, hint, toolbar);

    const footer = el('div', { class: 'modal-foot' },
      el('button', { text: '取消', onclick: () => close(null) }),
      el('button', { class: 'primary', text: '确定', onclick: () => close({ id: data ? data.id : uid(), kind: 'mindmap', nodes: state.nodes, rootId: state.rootId }) }),
    );
    body.append(footer);
    draw();

    const modal = document.getElementById('modal');
    const mask = document.getElementById('modal-mask');
    const hostModalBody = modal.firstElementChild;
    hostModalBody.innerHTML = '';
    hostModalBody.append(body);
    modal.classList.add('wide');
    mask.classList.remove('hidden');

    function close(result) {
      mask.classList.add('hidden');
      modal.classList.remove('wide');
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
    const W = 1000;
    const H = 620;
    const canvas = el('canvas', { width: W, height: H, style: { width: '100%', display: 'block', background: '#fff', borderRadius: '6px', cursor: 'crosshair', border: '1px solid var(--line)', touchAction: 'none' } });
    const ctx = canvas.getContext('2d');
    let strokes = data && data.strokes ? JSON.parse(JSON.stringify(data.strokes)) : [];
    let color = '#1c1b19';
    let size = 2.5;
    let drawing = null;

    function redraw() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of strokes) {
        if (!s.points.length) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.size;
        if (s.points.length === 1) {
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(s.points[0][0], s.points[0][1], s.size / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        s.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.stroke();
      }
    }

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.round((e.clientX - r.left) * (W / r.width)), Math.round((e.clientY - r.top) * (H / r.height))];
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drawing = { color, size, points: [pos(e)] };
      strokes.push(drawing);
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      drawing.points.push(pos(e));
      redraw();
    });
    const end = () => { drawing = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const colors = ['#1c1b19', '#a4483f', '#4f7a5b', '#b08d57', '#3e5c86'];
    const swatches = el('div', { class: 'row-gap', style: { alignItems: 'center' } });
    colors.forEach((c) => {
      const b = el('button', { title: c, style: { width: '20px', height: '20px', borderRadius: '50%', background: c, border: c === color ? '2px solid var(--ink)' : '1px solid var(--line)', padding: 0 } });
      b.onclick = () => { color = c; [...swatches.children].forEach((x) => (x.style.border = '1px solid var(--line)')); b.style.border = '2px solid var(--ink)'; };
      swatches.append(b);
    });
    const sizeSel = el('select', {}, ...[1.5, 2.5, 4, 7].map((s) => el('option', { value: s, text: s + ' px' })));
    sizeSel.value = String(size);
    sizeSel.onchange = () => { size = Number(sizeSel.value); };

    const body = el('div');
    body.append(
      el('h2', { text: '手绘' }),
      el('div', { class: 'row-gap', style: { marginBottom: '10px', alignItems: 'center' } }, swatches, sizeSel,
        el('button', { text: '撤销', onclick: () => { strokes.pop(); redraw(); } }),
        el('button', { text: '清空', onclick: () => { strokes = []; redraw(); } })),
      canvas,
      el('div', { class: 'modal-foot' },
        el('button', { text: '取消', onclick: () => close(null) }),
        el('button', { class: 'primary', text: '插入', onclick: () => close({ id: data ? data.id : uid(), kind: 'draw', strokes, w: W, h: H }) })),
    );
    redraw();

    const modal = document.getElementById('modal');
    const mask = document.getElementById('modal-mask');
    const hostModalBody = modal.firstElementChild;
    hostModalBody.innerHTML = '';
    hostModalBody.append(body);
    modal.classList.add('wide');
    mask.classList.remove('hidden');

    function close(result) {
      mask.classList.add('hidden');
      modal.classList.remove('wide');
      hostModalBody.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) { if (e.key === 'Escape') close(null); }
    document.addEventListener('keydown', onKey);
    return done;
  }

  function renderDraw(data) {
    const scale = 2;
    const canvas = el('canvas', { width: data.w * scale, height: data.h * scale, style: { width: '100%', display: 'block', borderRadius: '4px', border: '1px solid var(--line-soft)', background: '#fff' } });
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of data.strokes || []) {
      if (!s.points.length) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
      if (s.points.length === 1) {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.points[0][0], s.points[0][1], s.size / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      s.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
    }
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
