const toggle = document.querySelector('.sidebar-toggle');
const settingsButton = document.querySelector('.sidebar-settings');
const settingsDialog = document.getElementById('settings-dialog');

const areaButton = document.querySelector('.add-area');
const areaDialog = document.getElementById('area-dialog');
const areaForm = document.getElementById('area-form');
const areaName = document.getElementById('area-name');
const areaList = document.getElementById('area-list');
const workspaceTitle = document.getElementById('workspace-title');

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
settingsDialog.querySelector('button').addEventListener('click', () => dismissDialog(settingsDialog));
areaButton.addEventListener('click', () => {
  areaForm.reset();
  openDialog(areaDialog);
});
areaForm.querySelector('[data-dismiss]').addEventListener('click', () => dismissDialog(areaDialog));

for (const dialog of [settingsDialog, areaDialog]) {
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dismissDialog(dialog);
  });
}

function selectArea(item) {
  areaList.querySelector('[aria-current]')?.removeAttribute('aria-current');
  item.setAttribute('aria-current', 'page');
  workspaceTitle.textContent = item.textContent;
  workspaceTitle.hidden = false;
}

areaForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!areaDialog.classList.contains('is-visible')) return;
  areaName.value = areaName.value.trim();
  if (!areaName.reportValidity()) return;

  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = areaName.value;
  item.addEventListener('click', () => selectArea(item));
  await dismissDialog(areaDialog);
  areaList.append(item);
  selectArea(item);
  item.focus();
});

toggle.addEventListener('click', () => {
  const expanded = toggle.getAttribute('aria-expanded') === 'false';
  const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
});
