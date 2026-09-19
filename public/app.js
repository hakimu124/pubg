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
const mediaUrl = document.querySelector('#media-url');
const clipboardPaste = document.querySelector('#clipboard-paste');
const clipboardStatus = document.querySelector('#clipboard-status');
const installTitle = document.querySelector('#install-title');
const installDescription = document.querySelector('#install-description');
let deferredInstall;
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function setStatus(text, busy = false) { status.textContent = text; status.classList.toggle('busy', busy); }
async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(response.status === 404 ? 'Downloader backend is not connected to this website.' : 'Server returned an unexpected response.');
  return response.json();
}
function formatSize(bytes) { if (!bytes) return 'Size unavailable'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDuration(seconds) { if (!seconds) return ''; const minutes = Math.floor(seconds / 60); const remainder = Math.round(seconds % 60).toString().padStart(2, '0'); return `${minutes}:${remainder}`; }
function showError(message) { result.hidden = true; setStatus(message); }
function isSupportedUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && (/\.(mp4|webm|mov|m4v|mp3|m4a|wav|jpg|jpeg|png|webp|gif)(?:$|[?#])/i.test(url.pathname) || /(^|\.)((youtube\.com)|(youtu\.be)|(tiktok\.com)|(instagram\.com)|(facebook\.com)|(fb\.watch)|(x\.com)|(twitter\.com)|(vimeo\.com))$/i.test(url.hostname));
  } catch { return false; }
}
function fillFromClipboard(value) {
  if (!mediaUrl.value && isSupportedUrl(value)) { mediaUrl.value = value; clipboardStatus.textContent = 'Link ready'; return true; }
  return false;
}
async function readClipboard() {
  if (!navigator.clipboard?.readText) { clipboardStatus.textContent = 'Paste manually'; return; }
  try { fillFromClipboard((await navigator.clipboard.readText()).trim()); } catch { clipboardStatus.textContent = 'Paste manually'; }
}
function renderFormats(data) {
  document.querySelector('#result-source').textContent = data.source.toUpperCase();
  document.querySelector('#result-title').textContent = data.title || 'Public media';
  document.querySelector('#result-note').textContent = [data.duration && `${formatDuration(data.duration)} duration`, data.note].filter(Boolean).join(' · ');
  const thumbnail = document.querySelector('.media-placeholder');
  if (data.thumbnail) thumbnail.innerHTML = `<img src="${data.thumbnail}" alt="" loading="lazy">`;
  const groups = ['photo', 'video', 'audio'].filter((type) => data.formats.some((item) => item.type === type));
  formats.innerHTML = groups.map((type) => `<div class="format-group"><div class="format-type">${type.toUpperCase()}</div>${data.formats.filter((item) => item.type === type).map((item) => { const highlighted = type === 'video' && ['720p', '1080p'].includes(item.quality.toLowerCase()); return `<div class="format-row${highlighted ? ' quality-featured' : ''}"><div class="format-meta"><div><strong>${item.quality} · ${item.format.toUpperCase()}</strong>${highlighted ? '<span class="quality-badge">Quality choice</span>' : ''}<div class="muted">${formatSize(item.size)}</div></div></div><button class="primary-button" data-format-id="${item.id}">Download <b>↓</b></button></div>`; }).join('')}</div>`).join('');
  result.hidden = false;
  formats.querySelectorAll('[data-format-id]').forEach((button) => button.addEventListener('click', () => download(button.dataset.formatId, button)));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = new FormData(form).get('url') || document.querySelector('#media-url').value;
  setStatus('Checking link…', true); result.hidden = true;
  try {
    const response = await fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const data = await readApiResponse(response);
    if (!response.ok || !data.success) throw new Error(data.error || 'Processing failed');
    setStatus('Formats verified.'); renderFormats(data);
  } catch (error) { showError(error.message === 'Failed to fetch' ? 'Server unavailable. Start the local server and try again.' : error.message); }
});

clipboardPaste.addEventListener('click', readClipboard);
window.addEventListener('load', () => { if (!mediaUrl.value) readClipboard(); });

menuButton.addEventListener('click', () => {
  const open = desktopNav.classList.toggle('mobile-open');
  menuButton.setAttribute('aria-expanded', String(open));
});
desktopNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => desktopNav.classList.remove('mobile-open')));

fetch('/api/sources').then(readApiResponse).then((data) => {
  data.sources?.forEach((source) => {
    const sourceStatus = document.querySelector(`[data-source-id="${source.id}"]`);
    if (!sourceStatus) return;
    sourceStatus.querySelector('strong').textContent = source.label;
    sourceStatus.querySelector('span:last-child').textContent = source.status;
    sourceStatus.classList.toggle('muted-source', source.status !== 'Supported');
  });
}).catch(() => {});

async function download(formatId, button) {
  button.disabled = true; button.querySelector('b').textContent = '…'; setStatus('Preparing download…', true);
  try {
    const response = await fetch('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formatId }) });
    if (!response.ok) { const data = await readApiResponse(response); throw new Error(data.error || 'Processing failed'); }
    setStatus('Download ready.');
    const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'gitaru-download'; link.click(); URL.revokeObjectURL(link.href);
  } catch (error) { setStatus(error.message === 'Failed to fetch' ? 'Network error' : error.message); } finally { button.disabled = false; button.querySelector('b').textContent = '↓'; }
}

function showInstallPrompt() { if (!standalone && localStorage.getItem('gitaru-install-dismissed') !== '1') installPrompt.hidden = false; }
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstall = event; showInstallPrompt(); });
function install() {
  if (deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(() => { deferredInstall = null; installPrompt.hidden = true; }); return; }
  if (isIos) { installTitle.textContent = 'Add Gitaru to your iPhone'; installDescription.textContent = 'In Safari, tap Share, then Add to Home Screen.'; return; }
  installTitle.textContent = 'Install Gitaru'; installDescription.textContent = 'Use your browser menu to add Gitaru to your home screen.';
}
function hideInstallUi() { installPrompt.hidden = true; installButton.hidden = true; }
if (standalone) hideInstallUi();
installButton.addEventListener('click', install); document.querySelector('#prompt-install').addEventListener('click', install); document.querySelector('#dismiss-install').addEventListener('click', () => { installPrompt.hidden = true; localStorage.setItem('gitaru-install-dismissed', '1'); });
window.addEventListener('load', () => { if (isIos && !standalone) { installTitle.textContent = 'Add Gitaru to your iPhone'; installDescription.textContent = 'In Safari, tap Share, then Add to Home Screen.'; showInstallPrompt(); } });
const offlineBanner = document.querySelector('#offline-banner');
function updateConnectionState() { offlineBanner.hidden = navigator.onLine; }
window.addEventListener('online', updateConnectionState); window.addEventListener('offline', updateConnectionState); updateConnectionState();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
