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
const sampleButton = document.getElementById('sample-ticket');
const ticketList = document.getElementById('ticket-list');
const ticketPanel = document.getElementById('ticket-panel');
const releaseButton = document.getElementById('release-ticket');
let openTicket;

function updatePreview() {
  sampleButton.disabled = !infeedEnabled.checked;
  document.getElementById('preview-hint').textContent = infeedEnabled.checked
    ? 'Local preview with sample tickets only.'
    : 'Turn on Infeed to try a sample ticket.';
}

infeedEnabled.addEventListener('change', updatePreview);

function showTicketAction(ticket) {
  const actions = {
    'Held': 'Waiting for manual release. Releasing would add the internal note “AI checked, released from block manually”.',
    'Released automatically': 'Would add the internal note “AI checked”.',
    'Released manually': 'Would add the internal note “AI checked, released from block manually”.',
  };
  document.getElementById('ticket-action').textContent = actions[ticket.state];
  releaseButton.hidden = ticket.state !== 'Held';
  ticket.status.textContent = ticket.state;
}

sampleButton.addEventListener('click', () => {
  if (!infeedEnabled.checked) return;
  const number = ticketList.children.length + 1;
  const item = document.createElement('li');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'ticket-row';
  row.setAttribute('aria-haspopup', 'dialog');
  const examples = [
    ['Support hours', 'Could you confirm the support hours for our team?'],
    ['Billing contact update', 'How can we update our billing contact?'],
    ['Account invitation', 'Could you help us resend an invitation to a teammate?'],
  ];
  const [subject, body] = examples[(number - 1) % examples.length];
  const title = number <= examples.length ? subject : subject + ' #' + number;
  const status = document.createElement('span');
  const ticket = { state: holdEnabled.checked ? 'Held' : 'Released automatically', status };
  status.textContent = ticket.state;
  row.append(title, status);
  item.append(row);
  ticketList.append(item);
  document.getElementById('no-tickets').hidden = true;
  row.addEventListener('click', () => {
    openTicket = ticket;
    document.getElementById('ticket-title').textContent = title;
    document.getElementById('ticket-body').textContent = body;
    showTicketAction(ticket);
    openDialog(ticketPanel);
  });
});

releaseButton.addEventListener('click', () => {
  if (openTicket?.state !== 'Held') return;
  openTicket.state = 'Released manually';
  showTicketAction(openTicket);
  ticketPanel.querySelector('header button').focus();
});
ticketPanel.querySelector('header button').addEventListener('click', () => dismissDialog(ticketPanel));
ticketPanel.addEventListener('close', () => { openTicket = null; });

let selectedArea;

function renderWorkspace() {
  const onInfeed = location.hash === infeedLink.hash;
  const onResponder = onInfeed || location.hash === responderLink.hash;
  responderHome.hidden = hubSpotSection.hidden || !onResponder || onInfeed;
  infeedPage.hidden = hubSpotSection.hidden || !onInfeed;
  if (infeedPage.hidden && ticketPanel.open) dismissDialog(ticketPanel);
  updatePreview();
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
    hubSpotSection.hidden = status !== 'connected';
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
