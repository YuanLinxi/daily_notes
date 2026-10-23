// 内联文本输入：替代渲染进程中被禁用的 prompt()
// 在指定屏幕位置弹出一个浮动输入框，回车确认、Esc 取消，返回 Promise<string|null>

export function askText({ title = '输入', placeholder = '', x = null, y = null, initial = '' } = {}) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(28,27,25,.28)';

    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;background:#fff;border:1px solid #e7e3dc;border-radius:8px;'
      + 'padding:14px 16px;width:300px;box-shadow:0 16px 44px rgba(28,27,25,.2)';

    const label = document.createElement('div');
    label.textContent = title;
    label.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:8px';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = initial;
    input.placeholder = placeholder;
    input.style.cssText = 'width:100%;font:inherit;padding:6px 10px;border:1px solid #e7e3dc;border-radius:6px;outline:none';

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    const okBtn = document.createElement('button');
    okBtn.textContent = '确定';
    okBtn.className = 'primary';
    foot.append(cancelBtn, okBtn);
    box.append(label, input, foot);
    mask.append(box);

    document.body.append(mask);
    if (x !== null && y !== null) {
      const bw = box.offsetWidth || 300;
      const bh = box.offsetHeight || 120;
      box.style.left = Math.max(12, Math.min(window.innerWidth - bw - 12, x - bw / 2)) + 'px';
      box.style.top = Math.max(12, Math.min(window.innerHeight - bh - 12, y - bh / 2)) + 'px';
    } else {
      box.style.left = '50%';
      box.style.top = '50%';
      box.style.transform = 'translate(-50%,-50%)';
    }

    input.focus();
    input.select();

    const done = (val) => {
      document.removeEventListener('keydown', onKey, true);
      mask.remove();
      resolve(val);
    };

    cancelBtn.onclick = () => done(null);
    okBtn.onclick = () => done(input.value);
    const onInputKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
    };
    // 同时监听 keydown 与 keyup：某些环境下 Enter 只触发其中一个阶段
    input.addEventListener('keydown', onInputKey);
    input.addEventListener('keyup', onInputKey);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) done(null); });

    // 阻止画布的全局按键处理（Delete/Esc 等）干扰输入
    const onKey = (e) => {
      if (!mask.isConnected) return;
      if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
  });
}
