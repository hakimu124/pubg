const html = document.documentElement;
const themeToggle = document.querySelector('#theme-toggle');
const savedTheme = localStorage.getItem('gitaru-theme');
if (savedTheme) html.dataset.theme = savedTheme;
themeToggle.addEventListener('click', () => { const next = html.dataset.theme === 'dark' ? 'light' : 'dark'; html.dataset.theme = next; localStorage.setItem('gitaru-theme', next); });

const form = document.querySelector('#metadata-form');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const formats = document.querySelector('#formats');
const installButton = document.querySelector('#install-button');
const installPrompt = document.querySelector('#install-prompt');
const menuButton = document.querySelector('#menu-button');
const desktopNav = document.querySelector('.desktop-nav');
let deferredInstall;
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

function setStatus(text, busy = false) { status.textContent = text; status.classList.toggle('busy', busy); }
function formatSize(bytes) { if (!bytes) return 'Size unavailable'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
function showError(message) { result.hidden = true; setStatus(message); }
function renderFormats(data) {
  document.querySelector('#result-source').textContent = data.source.toUpperCase();
  document.querySelector('#result-title').textContent = data.title || 'Public media';
  document.querySelector('#result-note').textContent = data.note || '';
  formats.innerHTML = data.formats.map((item) => `<div class="format-row"><div class="format-meta"><div><div class="format-type">${item.type.toUpperCase()}</div><strong>${item.quality} · ${item.format.toUpperCase()}</strong><div class="muted">${formatSize(item.size)}</div></div></div><button class="primary-button" data-format-id="${item.id}">Download <b>↓</b></button></div>`).join('');
  result.hidden = false;
  formats.querySelectorAll('[data-format-id]').forEach((button) => button.addEventListener('click', () => download(button.dataset.formatId, button)));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = new FormData(form).get('url') || document.querySelector('#media-url').value;
  setStatus('Checking link…', true); result.hidden = true;
  try {
    const response = await fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Processing failed');
    setStatus('Formats verified.'); renderFormats(data);
  } catch (error) { showError(error.message === 'Failed to fetch' ? 'Server unavailable' : error.message); }
});

menuButton.addEventListener('click', () => {
  const open = desktopNav.classList.toggle('mobile-open');
  menuButton.setAttribute('aria-expanded', String(open));
});
desktopNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => desktopNav.classList.remove('mobile-open')));

async function download(formatId, button) {
  button.disabled = true; button.querySelector('b').textContent = '…'; setStatus('Preparing download…', true);
  try {
    const response = await fetch('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formatId }) });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Processing failed'); }
    setStatus('Download ready.');
    const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'gitaru-download'; link.click(); URL.revokeObjectURL(link.href);
  } catch (error) { setStatus(error.message === 'Failed to fetch' ? 'Network error' : error.message); } finally { button.disabled = false; button.querySelector('b').textContent = '↓'; }
}

window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstall = event; if (!standalone && localStorage.getItem('gitaru-install-dismissed') !== '1') installPrompt.hidden = false; });
function install() { if (deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(() => { deferredInstall = null; installPrompt.hidden = true; }); } else { alert('On iPhone or iPad, use Share, then Add to Home Screen.'); } }
installButton.addEventListener('click', install); document.querySelector('#prompt-install').addEventListener('click', install); document.querySelector('#dismiss-install').addEventListener('click', () => { installPrompt.hidden = true; localStorage.setItem('gitaru-install-dismissed', '1'); });
const offlineBanner = document.querySelector('#offline-banner');
function updateConnectionState() { offlineBanner.hidden = navigator.onLine; }
window.addEventListener('online', updateConnectionState); window.addEventListener('offline', updateConnectionState); updateConnectionState();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
