const $ = id => document.getElementById(id);
const view = $('view');
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
  device:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  connection:'<path d="m9 13 5-5m-4-2 2-2a4 4 0 0 1 6 6l-2 2m-2 6-2 2a4 4 0 0 1-6-6l2-2"/>',
  department:'<rect x="4" y="3" width="12" height="18" rx="1"/><path d="M16 10h4v11h-4M8 7h4m-4 4h4m-4 4h4"/>',
  ops:'<path d="M3 7h7m4 0h7M3 17h11m4 0h3"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  product:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8m-9 5v9"/>',
  billing:'<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 10h18M6 15h4"/>',
  success:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
  agent:'<rect x="4" y="6" width="16" height="13" rx="3"/><path d="M12 3v3M8 11h1m6 0h1m-7 4h6"/>',
  notes:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h5"/>',
  open:'<path d="m9 5 7 7-7 7"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const templates = [
  ['ops', 'Support operations', 'Track support processes, service levels, and recurring escalations.'],
  ['product', 'Product & engineering', 'Track customer-reported issues, product feedback, and engineering handoffs.'],
  ['billing', 'Finance & billing', 'Track invoice questions, payment issues, and billing escalations from customers.'],
  ['success', 'Customer success', 'Track account concerns and handoffs between support and customer success.']
];
const urlFor = id => '#/departments/' + id;
const date = iso => new Date(iso).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});
const route = () => location.hash || '#/';
let workspace, version = 0, newId;
let modelOptions = null, modelBusy = false, modelError = '';
const drafts = new Map();
for (const slot of document.querySelectorAll('[data-icon]')) slot.innerHTML = icon(slot.dataset.icon);

async function api(path, data) {
  let res;
  try {
    res = await fetch('/api/' + path, data === undefined ? {} : {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
    });
  } catch { throw new Error('The local workspace is unreachable. Check that it is running and try again.'); }
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'The request failed.');
  return result;
}
function currentLink(link, selected) {
  if (selected) link.setAttribute('aria-current', 'page');
  else link.removeAttribute('aria-current');
}
function navigation() {
  const section = route();
  currentLink($('directory-link'), section === '#/');
  currentLink($('model-link'), section === '#/connection');
  $('dept-links').innerHTML = workspace.departments.map(d => `<a class="nav-link" href="${urlFor(esc(d.id))}" ${section === urlFor(d.id) ? 'aria-current="page"' : ''}>${icon('department')}${esc(d.name)}</a>`).join('') || '<div class="nav-empty">No departments yet</div>';
}
function heading(title, subtitle, action = '') {
  $('crumb').textContent = title;
  document.title = title + ' · Support Ops';
  return `<div class="heading"><div><h1>${esc(title)}</h1><p class="lede">${esc(subtitle)}</p></div>${action}</div>`;
}
function createDialog(template) {
  const f = $('new-form');
  newId = crypto.randomUUID();
  f.reset();
  f.elements.name.value = template?.[1] || '';
  f.elements.remit.value = template?.[2] || '';
  $('form-error').textContent = '';
  $('create-dialog').showModal();
  f.elements.name.focus();
}
function directory() {
  const entries = workspace.departments;
  const intro = heading('Departments', 'Each department has a customer support remit, a record of updates, and a managing agent.',
    `<button class="primary" id="create">${icon('plus')}New department</button>`);
  const templateCards = `<div class="templates">${templates.map(([glyph, name, remit], i) => `<button class="template" data-template="${i}" aria-label="Use ${esc(name)} template"><span class="item-head"><span class="tile">${icon(glyph)}</span><span class="plus">${icon('plus')}</span></span><span><strong class="template-title">${esc(name)}</strong><span class="template-desc">${esc(remit)}</span></span></button>`).join('')}</div>`;
  const rows = entries.map(d => `<a class="list-row" href="${urlFor(esc(d.id))}"><span class="tile">${icon('department')}</span><span><strong>${esc(d.name)}</strong><small>${esc(d.remit)}</small></span><span class="row-end">${icon('open')}</span></a>`).join('');
  view.innerHTML = intro + (rows ? `<div class="list">${rows}</div>` : '') +
    `<section class="block"><div class="section-head"><h2>${entries.length ? 'Department templates' : 'Start with a template'}</h2></div>${templateCards}</section>`;
  $('create').onclick = () => createDialog();
  for (const card of view.querySelectorAll('[data-template]')) card.onclick = () => createDialog(templates[card.dataset.template]);
}
$('new-form').onsubmit = async event => {
  event.preventDefault();
  const f = event.currentTarget;
  const submit = f.querySelector('[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    const dept = await api('departments', {id:newId, ...Object.fromEntries(new FormData(f))});
    $('create-dialog').close();
    location.hash = urlFor(dept.id);
  } catch (e) { $('form-error').textContent = e.message; }
  finally { submit.disabled = false; }
};
$('nav-new').onclick = () => createDialog();
$('cancel-dialog').onclick = $('close-dialog').onclick = () => $('create-dialog').close();
function toggleMenu(open) {
  $('navigation').classList.toggle('open', open);
  $('menu').setAttribute('aria-expanded', String(open));
}
$('menu').onclick = () => toggleMenu($('menu').getAttribute('aria-expanded') !== 'true');
$('navigation').addEventListener('click', e => { if (e.target.closest('a')) toggleMenu(false); });
document.querySelector('.skip').onclick = e => { e.preventDefault(); $('content').focus(); };

function renderConnection() {
  const c = workspace.connection;
  view.innerHTML = heading('Model connection', 'Choose the model used by department managers in this workspace.') +
    `<section class="panel connection"><div class="section-head"><h2 class="title-icon">${icon('connection')}LLM endpoint</h2>
      <span class="connection-state"><span class="dot ${c.model ? 'on' : ''}"></span>${c.model ? 'Connected' : 'Disconnected'}</span></div>
      <dl class="facts"><div><dt>Endpoint</dt><dd>${esc(c.endpoint)}</dd></div>
      <div><dt>Server API key</dt><dd>${c.credentialConfigured ? 'Configured' : 'None configured'}</dd></div>
      <div><dt>Active model</dt><dd>${esc(c.model || 'None selected')}</dd></div></dl>
      <p class="hint">Finding models contacts this endpoint. Asking a manager sends the selected department’s context and your question.</p>
      <div class="toolbar"><button id="find" ${modelBusy ? 'disabled' : ''}>${modelBusy ? 'Working…' : modelOptions ? 'Refresh models' : 'Find models'}</button>
      ${c.model ? `<button id="disconnect" ${modelBusy ? 'disabled' : ''}>Disconnect</button>` : ''}</div>
      ${modelOptions?.length ? `<label class="field-title" for="models">Available models</label><select id="models" ${modelBusy ? 'disabled' : ''}>${modelOptions.map(m => `<option ${m === c.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <div class="toolbar"><button id="connect" class="primary" ${modelBusy ? 'disabled' : ''}>Connect model</button></div>` : ''}
      ${modelOptions?.length === 0 ? '<p class="empty-note">The endpoint returned no installed models.</p>' : ''}
      <p class="error" role="alert">${esc(modelError)}</p></section>
      <div class="connection"><details><summary>Configure a different endpoint</summary>
      <p>Set <code>MT_LLM_BASE_URL</code> and, if required, <code>MT_LLM_API_KEY</code> in the server environment or a private <code>.env.local</code> file. Restart Support Ops, then find and connect a model.</p>
      <p>Use an OpenAI-compatible endpoint with model listing and chat completions. The default is a local Ollama server.</p></details></div>`;
  $('find').onclick = () => modelAction(async () => { modelOptions = (await api('connection/models', {})).models; });
  if ($('disconnect')) $('disconnect').onclick = () => modelAction(async () => { workspace.connection = await api('connection/disconnect', {}); modelOptions = null; });
  if ($('connect')) $('connect').onclick = () => {
    const model = $('models').value;
    modelAction(async () => { workspace.connection = await api('connection/connect', {model, endpoint:c.endpoint}); modelOptions = null; });
  };
}
async function modelAction(fn) {
  if (modelBusy) return;
  modelBusy = true; modelError = ''; renderConnection();
  try { await fn(); }
  catch (error) { modelError = error.message; }
  finally {
    modelBusy = false;
    if (route() === '#/connection') renderConnection();
  }
}
function departmentPage({department:d, updates, exchanges}) {
  const model = workspace.connection.model;
  const updateFeed = updates.map(u => `<li><time class="stamp" datetime="${esc(u.created)}">${esc(date(u.created))}</time><p class="prose">${esc(u.body)}</p></li>`).join('');
  const conversation = exchanges.slice().reverse().map(e => `<li><div class="speaker">You · ${esc(date(e.created))}</div><p class="prose">${esc(e.question)}</p><div class="reply"><div class="speaker">${esc(d.manager)} · ${esc(e.model)}</div><p class="prose">${esc(e.answer)}</p></div></li>`).join('');
  view.innerHTML = heading(d.name, d.remit) + `<div class="department-grid">
    <section class="panel"><div class="section-head"><h2 class="title-icon">${icon('notes')}Department updates</h2></div>
    <p class="hint">Record decisions, handoffs, and changes for this manager.</p>
    <form id="update-form"><label for="update-text">New update</label><textarea id="update-text" required maxlength="3000" rows="3" placeholder="What changed for customers?"></textarea><div class="toolbar"><button type="submit">Add update</button></div><p class="error" role="alert"></p></form>
    ${updateFeed ? `<ul class="feed">${updateFeed}</ul>` : '<p class="empty-note">No updates recorded.</p>'}</section>
    <section class="panel"><div class="section-head"><h2 class="title-icon">${icon('agent')}${esc(d.manager)}</h2></div>
    <p class="agent-meta"><span class="dot ${model ? 'on' : ''}"></span>${model ? esc(model) : 'Model disconnected'}</p>
    <p class="hint">The manager can use this remit, the 12 latest updates, and the 3 latest exchanges. Long entries are excerpted.</p>
    <form id="ask-form"><label for="ask-text">Ask the manager</label><textarea id="ask-text" required maxlength="2000" rows="3" placeholder="What needs our attention?"></textarea>
    <div class="toolbar">${model ? '' : '<a class="button" href="#/connection">Model connection</a>'}<button type="submit" class="primary">Ask manager</button></div><p class="error" role="alert"></p></form>
    ${conversation ? `<ul class="feed">${conversation}</ul>` : ''}</section></div>`;
  bindComposer(d.id, 'update', false);
  bindComposer(d.id, 'ask', !model);
}
function bindComposer(dept, kind, unavailable) {
  const key = dept + '/' + kind;
  if (!drafts.has(key)) drafts.set(key, {id:crypto.randomUUID(), value:'', busy:false, error:''});
  const draft = drafts.get(key);
  const form = $(kind + '-form'), input = $(kind + '-text'), button = form.querySelector('button');
  input.value = draft.value;
  input.readOnly = draft.busy;
  form.querySelector('.error').textContent = draft.error;
  button.disabled = unavailable || draft.busy || !draft.value.trim();
  if (draft.busy) button.textContent = kind === 'ask' ? 'Asking…' : 'Saving…';
  input.oninput = () => {
    if (input.value !== draft.value) draft.id = crypto.randomUUID();
    draft.value = input.value; button.disabled = unavailable || !input.value.trim();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (button.disabled || draft.busy) return;
    draft.busy = true; draft.error = ''; input.readOnly = true; button.disabled = true;
    button.textContent = kind === 'ask' ? 'Asking…' : 'Saving…';
    try {
      const data = kind === 'ask' ? {id:draft.id, question:draft.value} : {id:draft.id, body:draft.value};
      await api('departments/' + dept + (kind === 'ask' ? '/ask' : '/updates'), data);
      draft.value = ''; draft.id = crypto.randomUUID();
    } catch (error) { draft.error = error.message; }
    finally { draft.busy = false; if (route() === urlFor(dept)) await refresh(); }
  };
}
async function refresh() {
  const token = ++version;
  const path = route(), match = /^#\/departments\/([0-9a-f-]+)$/.exec(path);
  $('notice').textContent = ''; view.setAttribute('aria-busy', 'true');
  try {
    const [next, detail] = await Promise.all([api('workspace'), match ? api('departments/' + match[1]) : null]);
    if (token !== version) return;
    workspace = next; navigation();
    if (detail) departmentPage(detail);
    else if (path === '#/connection') renderConnection();
    else if (path === '#/' || !path) directory();
    else view.innerHTML = heading('Page not found', 'This workspace page is unavailable.') + '<a href="#/">All departments</a>';
  } catch (error) {
    if (token !== version) return;
    view.replaceChildren(); $('notice').textContent = error.message;
    const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.onclick = refresh; view.append(retry);
  } finally { if (token === version) view.setAttribute('aria-busy','false'); }
}
window.addEventListener('hashchange', () => {
  toggleMenu(false);
  view.replaceChildren();
  refresh();
});
await refresh();
