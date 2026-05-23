const DEFAULT_ENABLED = true;

const toggle = document.getElementById('enabled-toggle');
const status = document.getElementById('status');

function setStatus(enabled) {
  toggle.checked = enabled;
  status.textContent = enabled ? 'Enabled' : 'Disabled';
  status.classList.toggle('is-disabled', !enabled);
}

chrome.storage.local.get({ enabled: DEFAULT_ENABLED }, ({ enabled }) => {
  setStatus(enabled);
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ enabled });
  setStatus(enabled);
});
