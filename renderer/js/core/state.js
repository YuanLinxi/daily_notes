// 全局界面状态
import { todayStr, pad } from './format.js';

export const state = {
  view: 'daily',
  dailyDate: todayStr(),
  editing: null,          // 当前编辑中的记录（含闭包更新）
  autoSave: null,         // 编辑器自动保存控制器
  dbMode: 'table',
  dbFilters: { q: '', project: '', done: '', status: '', dateFrom: '', dateTo: '', dueBefore: '' },
  calMonth: new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1),
  snFilters: { q: '', language: '' },
  tableCols: ['status', 'date', 'project', 'title', 'content', 'due'],
  tableSort: null,
  boardDim: 'project',
  streak: null,
  currentDraftKey: null,
  saveCurrent: null,
};

// 日期切换时的默认编辑目标
export function setDailyDate(date) {
  state.dailyDate = date;
}
