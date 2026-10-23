// 通用模态框
import { $, h } from '../core/dom.js';

export function showModal(body, wide = false) {
  const mask = $('#modal-mask');
  const modal = $('#modal');
  modal.firstElementChild.innerHTML = '';
  modal.firstElementChild.append(body);
  modal.classList.toggle('wide', wide);
  mask.classList.remove('hidden');
  const firstInput = modal.querySelector('input[type=text], input[type=search]');
  if (firstInput) firstInput.focus();
}

export function closeModal() {
  const mask = $('#modal-mask');
  const modal = $('#modal');
  if (!mask || !modal) return;
  mask.classList.add('hidden');
  modal.classList.remove('wide');
  modal.firstElementChild.innerHTML = '';
}

export function isModalOpen() {
  const mask = $('#modal-mask');
  return mask && !mask.classList.contains('hidden');
}

// 带取消/确认按钮的弹窗骨架
export function formModal({ title, fields, onSave, wide = false, saveText = '保存' }) {
  const body = h('div', {},
    h('h2', { text: title }),
    ...fields,
    h('div', { class: 'modal-foot' },
      h('button', { text: '取消', onclick: closeModal }),
      h('button', { class: 'primary', text: saveText, onclick: onSave })),
  );
  showModal(body, wide);
  return body;
}
