// 项目主页视图
import { $, h, toast } from '../core/dom.js';
import { notes as notesApi, meta as metaApi, projectPage } from '../core/api.js';
import { todayStr, summarize, statusTag, statCard } from '../core/format.js';
import { openTaskThread } from './daily.js';
import { openRecordModal } from './database.js';
import { doExport } from './settings.js';

let currentProject = '';

export async function loadProjects() {
  const projects = await metaApi.projects();
  const list = $('#proj-list');
  list.innerHTML = '';
  if (!projects.length) {
    list.append(h('div', { class: 'empty', text: '还没有项目。在每日记录里填写「关联项目」即可创建。' }));
  }
  if (!currentProject && projects.length) currentProject = projects[0].project;
  for (const p of projects) {
    list.append(h('div', {
      class: 'proj-item' + (p.project === currentProject ? ' active' : ''),
      onclick: () => { currentProject = p.project; loadProjects(); },
    },
      h('div', { class: 't', text: p.project }),
      h('div', { class: 'hint', text: `${p.count} 条记录` })));
  }
  if (currentProject) await renderProjectPage(currentProject);
}

async function renderProjectPage(name) {
  const page = await projectPage.get(name);
  const host = $('#proj-page');
  host.innerHTML = '';

  const goalInput = h('textarea', {
    rows: 2, placeholder: '项目目标（点击编辑，自动保存）',
    onchange: async (e) => {
      await projectPage.setGoal(name, e.target.value);
      toast('已保存');
    },
  });
  goalInput.value = page.goal;

  host.append(
    h('div', { class: 'row-gap', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('h2', { text: name, style: { margin: 0 } }),
      h('button', { text: '导出该项目', onclick: () => doExport({ project: name }) })),
    goalInput,
    h('div', { class: 'stat-row', style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
      statCard('总记录', page.stats.total),
      statCard('已完成', page.stats.done),
      statCard('逾期任务', page.stats.overdue),
      statCard('活跃天数', page.stats.activeDays)),
  );

  host.append(h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', { text: `未完成任务（${page.openTasks.length}）` })),
    h('div', { style: { padding: '8px 18px 14px' } },
      ...page.openTasks.map((n) => h('div', { class: 'task-row' },
        statusTag(n),
        h('span', { class: 'task-t', text: n.title || summarize(n.content, 40) }),
        n.dueDate ? h('span', { class: 'tag' + (n.dueDate < todayStr() ? ' overdue' : ''), text: `截止 ${n.dueDate}` }) : null,
        h('span', { class: 'hint', text: n.date }),
        h('button', {
          text: '任务脉络',
          onclick: (e) => { e.stopPropagation(); openTaskThread(n.rootId || n.id); },
        }),
        h('button', {
          text: '今天继续',
          onclick: async (e) => {
            e.stopPropagation();
            // 在原任务线程上追加今天的记录：历史保留，任务向前推进
            await notesApi.save({
              date: todayStr(), project: n.project, title: n.title || '',
              content: '', contentHtml: '', contentJson: '',
              rootId: n.rootId || n.id, status: n.status || 'todo', dueDate: n.dueDate,
            });
            toast('已在任务上追加今天的记录');
            currentProject = name;
            loadProjects();
          },
        }))),
      !page.openTasks.length ? h('p', { class: 'hint', text: '全部完成。' }) : null)));

  host.append(h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', { text: '最近记录' })),
    h('div', { style: { padding: '8px 18px 14px' } },
      ...page.notes.slice(0, 10).map((n) => h('div', {
        class: 'task-row', style: { cursor: 'pointer' },
        onclick: () => openRecordModal(n),
      },
        h('span', { class: 'hint', text: n.date }),
        h('span', { class: 'task-t', text: n.title || summarize(n.content, 50) }),
        statusTag(n))))));

  if (page.snippets.length) {
    host.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: '相关命令' })),
      h('div', { style: { padding: '8px 18px 14px' } },
        ...page.snippets.slice(0, 5).map((s) => h('div', { class: 'task-row' },
          h('span', { class: 'mono', text: s.command.slice(0, 60) }),
          h('span', { class: 'hint', text: s.language }))))));
  }
}
