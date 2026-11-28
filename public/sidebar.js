const toggle = document.querySelector('.sidebar-toggle');
const settingsButton = document.querySelector('.sidebar-settings');
const settingsDialog = document.getElementById('settings-dialog');

const areaButton = document.querySelector('.add-area');
const areaDialog = document.getElementById('area-dialog');
const areaForm = document.getElementById('area-form');
const areaName = document.getElementById('area-name');
const areaList = document.getElementById('area-list');
const areasEmpty = document.getElementById('areas-empty');
const workspaceTitle = document.getElementById('workspace-title');

const saveError = document.getElementById('save-error');
let creationId;
let saving = false;

function openDialog(dialog) {
  dialog.showModal();
  // Establish the starting geometry before animating the dialog and backdrop.
  dialog.getBoundingClientRect();
  dialog.classList.add('is-visible');
}

async function dismissDialog(dialog) {
  if (!dialog.classList.contains('is-visible')) return;
  dialog.classList.remove('is-visible');
  await Promise.allSettled(dialog.getAnimations().map(animation => animation.finished));
  dialog.close();
}

settingsButton.addEventListener('click', () => openDialog(settingsDialog));
settingsDialog.querySelector('.settings-pane-header button').addEventListener('click', () => dismissDialog(settingsDialog));

const hubSpotTest = settingsDialog.querySelector('.connection-test');
const hubSpotStatus = document.getElementById('hubspot-status');
const hubSpotSection = document.getElementById('hubspot-section');
const responderLink = hubSpotSection.querySelector('.workspace-link');
const responderHome = document.getElementById('responder-home');
const infeedLink = responderHome.querySelector('a');
const infeedPage = document.getElementById('infeed-page');
const infeedEnabled = document.getElementById('infeed-enabled');
const holdEnabled = document.getElementById('hold-enabled');
const ticketList = document.getElementById('ticket-list');
const ticketPanel = document.getElementById('ticket-panel');
const releaseButton = document.getElementById('release-ticket');
const noteSetting = document.getElementById('release-notes-enabled');
const noteStatus = {
  queued: 'AI Responder note queued.',
  verifying: 'Checking HubSpot for the release note.',
  added: 'AI Responder note verified on this ticket.',
  review: 'Check this ticket in HubSpot. Note delivery could not be verified.',
  permission: 'Check the HubSpot Service Key and its ticket permissions.',
  account: 'Delivery paused. The HubSpot account has changed.',
};
let openTicket;

const states = {
  held: ['Held', 'Waiting for manual release.'],
  automatic: ['Released automatically', 'Released automatically. No note was queued.'],
  manual: ['Released manually', 'Released locally.'],
};
let feed;
let savingFeed = false;
let feedRequest = 0;
let connected = false;
const rows = new Map();

function feedStatus(message) {
  for (const id of ['infeed-summary', 'infeed-status']) document.getElementById(id).textContent = message;
}

function showTicketAction(ticket) {
  let action = noteStatus[ticket.note] ?? states[ticket.state][1];
  if (ticket.state === 'held' && feed.notesEnabled) action = 'Release will add an AI Responder internal note to this ticket.';
  if (ticket.note && ticket.note !== 'added' && (!feed.notesEnabled || (ticket.state === 'automatic' && !feed.automaticNotes))) action += ' Note delivery is switched off.';
  document.getElementById('ticket-action').textContent = action;
  releaseButton.hidden = ticket.state !== 'held';
  releaseButton.disabled = savingFeed;
}

async function openTicketPanel(id) {
  openTicket = id;
  document.getElementById('ticket-title').textContent = 'Ticket #' + id;
  const body = document.getElementById('ticket-body');
  body.textContent = 'Loading incoming message…';
  showTicketAction(feed.tickets.find(ticket => ticket.id === id));
  openDialog(ticketPanel);
  try {
    const response = await fetch('/api/infeed/tickets/' + id, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error();
    const { text, paused } = await response.json();
    if (openTicket === id) body.textContent = paused
      ? 'Infeed is off. Incoming message retrieval is paused.'
      : text || 'No incoming plain-text message is available.';
  } catch {
    if (openTicket === id) body.textContent = 'Could not read the message from HubSpot. Reopen this ticket to retry.';
  }
}

function renderFeed(data) {
  feed = data;
  hubSpotSection.hidden = !connected && !data.enabled && !data.tickets.length;
  renderWorkspace();
  infeedEnabled.checked = data.enabled;
  noteSetting.value = data.automaticNotes ? 'all' : data.notesEnabled ? 'on' : 'off';
  noteSetting.disabled = savingFeed || (!connected && !data.notesEnabled);
  holdEnabled.checked = data.hold;
  infeedEnabled.disabled = savingFeed || (!connected && !data.enabled);
  holdEnabled.disabled = savingFeed;
  document.getElementById('no-tickets').hidden = data.tickets.length > 0;
  let message = 'Infeed is off.';
  if (data.enabled) {
    message = data.problem || (data.busy ? 'Checking Help Desk…' : 'Waiting for the next Help Desk check.');
    if (data.checked) message = (data.problem || 'Listening for Help Desk tickets.') +
      ' Last successful check: ' + new Date(data.checked).toLocaleTimeString() + '.';
  }
  if (data.enabled && data.pending) message += ' Awaiting processing or a ticket link: ' + data.pending + '.';
  feedStatus(message);
  // Keep existing buttons in place so refreshing preserves keyboard focus.
  data.tickets.forEach((ticket, index) => {
    let row = rows.get(ticket.id);
    if (!row) {
      const item = document.createElement('li');
      row = document.createElement('button');
      row.type = 'button';
      row.className = 'ticket-row';
      row.setAttribute('aria-haspopup', 'dialog');
      row.append('Ticket #' + ticket.id, document.createElement('span'));
      row.addEventListener('click', () => openTicketPanel(ticket.id));
      item.append(row);
      ticketList.insertBefore(item, ticketList.children[index] ?? null);
      rows.set(ticket.id, row);
    }
    row.lastChild.textContent = states[ticket.state][0];
    if (openTicket === ticket.id) showTicketAction(ticket);
  });
}

async function loadFeed(path = '') {
  const sequence = ++feedRequest;
  try {
    const response = await fetch('/api/infeed' + path, {
      method: path ? 'POST' : 'GET', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (sequence === feedRequest) renderFeed(data);
  } catch {
    if (sequence !== feedRequest) return;
    if (feed) renderFeed(feed);
    feedStatus(path ? 'Could not confirm the change. Refresh to check its saved state.' : 'Could not load the infeed.');
    if (path.startsWith('/notes/')) document.getElementById('release-notes-error').textContent =
      'Could not confirm the note setting. Check the configured HubSpot account and refresh.';
    if (path && openTicket) document.getElementById('ticket-action').textContent = 'Could not confirm release. Reopen the ticket to check.';
  }
}

async function changeFeed(path) {
  if (savingFeed) return;
  savingFeed = true;
  noteSetting.disabled = true;
  document.getElementById('release-notes-error').textContent = '';
  infeedEnabled.disabled = holdEnabled.disabled = releaseButton.disabled = true;
  await loadFeed(path);
  savingFeed = false;
  if (feed) {
    infeedEnabled.disabled = !connected && !feed.enabled;
    noteSetting.disabled = !connected && !feed.notesEnabled;
    holdEnabled.disabled = releaseButton.disabled = false;
  }
}

noteSetting.addEventListener('change', () => changeFeed('/notes/' + noteSetting.value));
infeedEnabled.addEventListener('change', () => changeFeed('/enabled/' + (infeedEnabled.checked ? 'on' : 'off')));
holdEnabled.addEventListener('change', () => changeFeed('/hold/' + (holdEnabled.checked ? 'on' : 'off')));
releaseButton.addEventListener('click', () => changeFeed('/tickets/' + openTicket + '/release'));
setInterval(() => {
  if (!savingFeed && !document.hidden && (!infeedPage.hidden || !responderHome.hidden)) void loadFeed();
}, 5000);
ticketPanel.querySelector('header button').addEventListener('click', () => dismissDialog(ticketPanel));
ticketPanel.addEventListener('close', () => { openTicket = null; });

let selectedArea;

function renderWorkspace() {
  const onInfeed = location.hash === infeedLink.hash;
  const onResponder = onInfeed || location.hash === responderLink.hash;
  responderHome.hidden = hubSpotSection.hidden || !onResponder || onInfeed;
  infeedPage.hidden = hubSpotSection.hidden || !onInfeed;
  if (infeedPage.hidden && ticketPanel.open) dismissDialog(ticketPanel);
  const current = onResponder ? (hubSpotSection.hidden ? null : responderLink) : selectedArea;
  for (const link of document.querySelectorAll('.workspace-link[aria-current]')) {
    link.removeAttribute('aria-current');
  }
  current?.setAttribute('aria-current', onInfeed ? 'location' : 'page');
  workspaceTitle.textContent = current?.textContent ?? '';
  workspaceTitle.hidden = !current || !infeedPage.hidden;
}

window.addEventListener('hashchange', renderWorkspace);

const hubSpotMessages = new Map([
  ['not_configured', 'Not connected. Set HUBSPOT_SERVICE_KEY on the server.'],
  ['invalid_key', 'HubSpot rejected the Service Key.'],
  ['access_denied', 'Access denied. Check the conversations.read scope.'],
  ['rate_limited', 'HubSpot is limiting requests. Try again later.'],
  ['no_help_desk', 'HubSpot is reachable. No Help Desk inbox found.'],
  ['connected', 'Help Desk inbox found'],
  ['unavailable', 'Could not verify the HubSpot connection. Try again.'],
]);

async function refreshHubSpotConnection() {
  hubSpotTest.disabled = true;
  hubSpotStatus.textContent = 'Checking…';
  let status = 'unavailable';
  try {
    const response = await fetch('/api/connections/hubspot/check', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) ({ status } = await response.json());
  } catch {
    // A failed check leaves the sidebar connection hidden.
  } finally {
    connected = status === 'connected';
    hubSpotSection.hidden = !connected && !feed?.enabled && !feed?.tickets.length;
    if (!savingFeed) void loadFeed();
    renderWorkspace();
    const result = hubSpotMessages.get(status) ?? hubSpotMessages.get('unavailable');
    const time = new Date().toLocaleTimeString(undefined, { timeStyle: 'medium' });
    hubSpotStatus.textContent = `${result} · Last checked at ${time}`;
    hubSpotTest.disabled = false;
  }
}

if (location.protocol === 'file:') {
  hubSpotTest.disabled = true;
  hubSpotStatus.textContent = 'Start the local server to test the connection.';
} else {
  hubSpotTest.addEventListener('click', refreshHubSpotConnection);
  refreshHubSpotConnection();
}

const settingsLinks = settingsDialog.querySelectorAll('.settings-sidebar a');
const settingsTitle = document.getElementById('settings-section-title');

for (const link of settingsLinks) {
  link.addEventListener('click', event => {
    event.preventDefault();
    for (const sectionLink of settingsLinks) {
      const isCurrent = sectionLink === link;
      if (isCurrent) sectionLink.setAttribute('aria-current', 'location');
      else sectionLink.removeAttribute('aria-current');
      document.getElementById(sectionLink.hash.slice(1)).hidden = !isCurrent;
    }
    settingsTitle.textContent = link.textContent;
  });
}

function openAreaDialog() {
  areaForm.reset();
  creationId = crypto.randomUUID();
  saveError.hidden = true;
  openDialog(areaDialog);
}

areaButton.addEventListener('click', openAreaDialog);
areasEmpty.querySelector('button').addEventListener('click', openAreaDialog);
areaForm.querySelector('[data-dismiss]').addEventListener('click', () => { if (!saving) dismissDialog(areaDialog); });

for (const dialog of [settingsDialog, areaDialog, ticketPanel]) {
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (dialog !== areaDialog || !saving) dismissDialog(dialog);
  });
}

function selectArea(item) {
  selectedArea = item;
  if ([responderLink.hash, infeedLink.hash].includes(location.hash)) location.hash = '';
  renderWorkspace();
}

function appendArea(area) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'workspace-link';
  item.dataset.areaId = area.id;
  item.textContent = area.name;
  item.addEventListener('click', () => selectArea(item));
  areaList.append(item);
  return item;
}

async function loadAreas() {
  areaButton.disabled = true;
  const message = document.getElementById('load-error');
  try {
    if (location.protocol === 'file:') throw new Error('Static preview');
    const response = await fetch('/api/areas', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Load failed');
    const areas = await response.json();
    for (const area of areas) appendArea(area);
    areasEmpty.hidden = areas.length !== 0;
    areaButton.disabled = false;
  } catch {
    message.textContent = location.protocol === 'file:'
      ? 'Start the local server to use business areas.'
      : 'Could not load business areas. Refresh to retry.';
    message.hidden = false;
  }
}

loadAreas();

areaForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || !areaDialog.classList.contains('is-visible')) return;
  areaName.value = areaName.value.trim();
  if (!areaName.reportValidity()) return;

  saving = true;
  saveError.hidden = true;
  areaName.readOnly = true;
  for (const button of areaForm.querySelectorAll('button')) button.disabled = true;
  let failureMessage = 'Could not confirm the save. Try again.';
  try {
    const response = await fetch('/api/areas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: creationId, name: areaName.value }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 409) failureMessage = 'This area was already created. Refresh to see its saved name.';
    if (!response.ok) throw new Error('Save failed');
    const area = await response.json();
    await dismissDialog(areaDialog);
    const item = appendArea(area);
    areasEmpty.hidden = true;
    selectArea(item);
    item.focus();
  } catch {
    saveError.textContent = failureMessage;
    saveError.hidden = false;
  } finally {
    saving = false;
    areaName.readOnly = false;
    for (const button of areaForm.querySelectorAll('button')) button.disabled = false;
  }
});

toggle.addEventListener('click', () => {
  const expanded = toggle.getAttribute('aria-expanded') === 'false';
  const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
});
