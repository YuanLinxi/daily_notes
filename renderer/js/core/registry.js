// 视图注册表：统一管理各视图的加载函数与刷新
import { state } from './state.js';

const loaders = new Map(); // view -> async () => void

export function registerView(name, loader) {
  loaders.set(name, loader);
}

export function getLoader(name) {
  return loaders.get(name);
}

// 刷新指定视图（仅当该视图处于激活状态）
export function refreshViews(...names) {
  for (const name of names) {
    if (state.view !== name) continue;
    const loader = loaders.get(name);
    if (loader) loader();
  }
}

// 按当前视图刷新
export function refreshCurrent() {
  refreshViews(state.view);
}
