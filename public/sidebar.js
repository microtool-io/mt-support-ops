const toggle = document.querySelector('.sidebar-toggle');

toggle.addEventListener('click', () => {
  const expanded = toggle.getAttribute('aria-expanded') === 'false';
  const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
});
