const bridge = window.api;

async function fillProjects() {
  const projects = await bridge.meta.projects();
  document.getElementById('q-projects').innerHTML =
    projects.map((p) => `<option value="${p.project.replace(/"/g, '&quot;')}">`).join('');
}

async function save() {
  const text = document.getElementById('q-text').value.trim();
  if (!text) return;
  const project = document.getElementById('q-project').value.trim();
  await bridge.notes.save({
    date: new Date().toISOString().slice(0, 10),
    title: text.split('\n')[0].slice(0, 30),
    content: text,
    project,
    status: 'todo',
  });
  document.getElementById('q-text').value = '';
  window.close();
}

document.getElementById('q-save').addEventListener('click', save);
document.getElementById('q-close').addEventListener('click', () => window.close());
document.getElementById('q-text').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
});
fillProjects();
document.getElementById('q-text').focus();
