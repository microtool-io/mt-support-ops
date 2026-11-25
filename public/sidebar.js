const toggle = document.querySelector('.sidebar-toggle');
const settingsButton = document.querySelector('.sidebar-settings');
const settingsDialog = document.getElementById('settings-dialog');

settingsButton.addEventListener('click', () => {
  settingsDialog.showModal();
  // Establish the starting geometry before transitioning the dialog and backdrop in.
  settingsDialog.getBoundingClientRect();
  settingsDialog.classList.add('is-visible');
});

async function dismissSettings() {
  if (!settingsDialog.classList.contains('is-visible')) return;
  settingsDialog.classList.remove('is-visible');
  const transitions = settingsDialog.getAnimations();
  await Promise.allSettled(transitions.map(transition => transition.finished));
  settingsDialog.close();
}

settingsDialog.querySelector('button').addEventListener('click', dismissSettings);
settingsDialog.addEventListener('cancel', event => {
  event.preventDefault();
  dismissSettings();
});
settingsDialog.addEventListener('close', () => settingsButton.focus());

toggle.addEventListener('click', () => {
  const expanded = toggle.getAttribute('aria-expanded') === 'false';
  const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
});
