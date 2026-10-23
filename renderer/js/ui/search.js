// 全局统一搜索（Ctrl+K）
import { $, h, debounce } from '../core/dom.js';
import { search as searchApi } from '../core/api.js';
import { summarize, snippetAround } from '../core/format.js';
import { openRecordModal } from '../views/database.js';

let switchViewFn = () => {};

export function initGlobalSearch(setSwitchView) {
  switchViewFn = setSwitchView;
  const input = $('#gs-q');
  const results = $('#gs-results');

  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (!q) {
      results.classList.add('hidden');
      results.innerHTML = '';
      return;
    }
    const { notes, snippets } = await searchApi.all(q);
    results.innerHTML = '';
    if (!notes.length && !snippets.length) {
      results.append(h('div', { class: 'gs-empty', text: '没有匹配结果' }));
    }

    for (const n of notes.slice(0, 8)) {
      results.append(h('div', {
        class: 'gs-item',
        onclick: () => { results.classList.add('hidden'); openRecordModal(n); },
      },
        h('span', { class: 'tag st-todo', text: '记录' }),
        h('span', { class: 'gs-t', text: n.title || summarize(n.content).slice(0, 30) }),
        h('span', { class: 'gs-snip', text: snippetAround(n.content, q, 24) }),
        h('span', { class: 'hint', text: n.date })));
    }

    for (const s of snippets.slice(0, 8)) {
      results.append(h('div', {
        class: 'gs-item',
        onclick: async () => {
          results.classList.add('hidden');
          await switchViewFn('snippets');
          $('#sn-q').value = s.title;
          $('#sn-q').dispatchEvent(new Event('input'));
        },
      },
        h('span', { class: 'tag st-doing', text: '命令' }),
        h('span', { class: 'gs-t', text: s.title || s.command.slice(0, 30) }),
        h('span', { class: 'gs-snip mono', text: snippetAround(s.command, q, 24) })));
    }
    results.classList.remove('hidden');
  }));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      results.classList.add('hidden');
      input.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#global-search')) results.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
