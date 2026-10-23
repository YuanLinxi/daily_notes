// 命令记录视图
import { $, h, esc, toast, debounce } from '../core/dom.js';
import { state } from '../core/state.js';
import { snippets } from '../core/api.js';
import { showModal, closeModal } from '../ui/modal.js';

export async function loadSnippets() {
  const all = await snippets.list({});
  const langs = [...new Set(all.map((s) => s.language).filter(Boolean))].sort();
  const sel = $('#sn-lang');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部语言</option>'
    + langs.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  sel.value = cur || state.snFilters.language;
  await renderSnippets();
}

export async function renderSnippets() {
  const items = await snippets.list(state.snFilters);
  const host = $('#sn-list');
  host.innerHTML = '';
  if (!items.length) {
    host.append(h('div', { class: 'empty', text: '还没有命令记录，点击右上角新增。' }));
    return;
  }
  for (const s of items) {
    const cmdEl = h('div', {
      class: 'sn-cmd', title: '单击复制',
      onclick: async () => {
        await navigator.clipboard.writeText(s.command);
        await snippets.use(s.id);
        toast('已复制到剪贴板');
        renderSnippets();
      },
    }, h('span', { text: s.command }), h('span', { class: 'copy', text: '复制' }));

    host.append(h('div', { class: 'sn-card' },
      h('div', { class: 'sn-top' },
        h('div', { class: 't', text: s.title || '(未命名)' }),
        h('div', { class: 'lang', text: s.language })),
      cmdEl,
      h('div', { class: 'sn-meta' },
        h('div', { class: 'r' },
          s.tags
            ? h('div', {}, ...s.tags.split(/[,，\s]+/).filter(Boolean)
              .map((t) => h('span', { class: 'tag', text: t, style: { marginRight: '4px' } })))
            : null,
          s.remark ? h('div', { text: s.remark }) : null,
          h('span', { class: 'hint', text: `使用 ${s.uses} 次` })),
        h('div', { class: 'sn-actions' },
          h('button', { text: '编辑', onclick: () => openSnippetModal(s) }),
          h('button', {
            text: '删除',
            onclick: async () => {
              if (!confirm('删除这条命令？')) return;
              await snippets.remove(s.id);
              loadSnippets();
            },
          }))),
    ));
  }
}

export function openSnippetModal(s) {
  const isNew = !s;
  const v = { title: '', language: '', command: '', remark: '', tags: '', ...(s || {}) };
  const body = h('div');
  const titleI = h('input', { type: 'text', value: v.title, placeholder: '例如：查看 8080 端口占用' });
  const langI = h('input', { type: 'text', value: v.language, placeholder: 'bash / powershell / sql …' });
  const tagsI = h('input', { type: 'text', value: v.tags, placeholder: '用逗号分隔，如：网络,调试' });
  const remarkI = h('input', { type: 'text', value: v.remark, placeholder: '备注' });
  const cmdT = h('textarea', { class: 'code', placeholder: '命令内容' });
  cmdT.value = v.command;

  body.append(
    h('h2', { text: isNew ? '新增命令' : '编辑命令' }),
    h('div', { class: 'field-grid' },
      h('div', { class: 'field', style: { gridColumn: '1 / span 2' } }, h('label', { text: '标题' }), titleI),
      h('div', { class: 'field' }, h('label', { text: '语言' }), langI),
      h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', { text: '命令' }), cmdT),
      h('div', { class: 'field' }, h('label', { text: '标签' }), tagsI),
      h('div', { class: 'field', style: { gridColumn: '2 / -1' } }, h('label', { text: '备注' }), remarkI),
    ),
    h('div', { class: 'modal-foot' },
      h('button', { text: '取消', onclick: closeModal }),
      h('button', {
        class: 'primary', text: '保存',
        onclick: async () => {
          if (!cmdT.value.trim()) { toast('请填写命令内容'); return; }
          await snippets.save({
            id: v.id,
            title: titleI.value.trim(),
            language: langI.value.trim(),
            command: cmdT.value,
            remark: remarkI.value.trim(),
            tags: tagsI.value.trim(),
          });
          closeModal();
          toast('已保存');
          loadSnippets();
        },
      })),
  );
  showModal(body);
  setTimeout(() => cmdT.focus(), 30);
}

export function initSnippetsView() {
  $('#sn-q').addEventListener('input', debounce((e) => {
    state.snFilters.q = e.target.value.trim();
    renderSnippets();
  }));
  $('#sn-lang').addEventListener('change', (e) => {
    state.snFilters.language = e.target.value;
    renderSnippets();
  });
  $('#sn-new').addEventListener('click', () => openSnippetModal(null));
}
