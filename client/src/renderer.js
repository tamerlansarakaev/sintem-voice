const DEFAULT_PAGE = 'voice-translation';
const SPLASH_MS = 1000;
const HEALTH_TIMEOUT_MS = 4000;
const HEALTH_INTERVAL_MS = 15_000;

const pages = document.querySelectorAll('.page');
const navLinks = document.querySelectorAll('.sidebar .nav-link[data-page]');
const subtitlesToggle = document.getElementById('subtitles-toggle');
const splash = document.getElementById('splash');
const offline = document.getElementById('offline');
const offlineRetry = document.getElementById('offline-retry');
const offlineForm = document.getElementById('offline-form');
const offlineAddress = document.getElementById('offline-address');
const toasts = document.getElementById('toasts');

document.documentElement.classList.add(`platform-${window.config.platform}`);
applyTranslations();

// State the pages share. Each page owns some fields and the others react
// to `appstatechange`.
const appState = {
  online: true,
  hasVoice: false,
  // The connected virtual microphone device, or null.
  virtualMic: null,
  // A microphone is in use; the input device cannot change.
  recording: false,
};

function updateAppState(patch) {
  Object.assign(appState, patch);
  document.dispatchEvent(new Event('appstatechange'));
}


// The active page lives in the URL hash so a reload keeps it.
function showPage() {
  const requested = location.hash.slice(1);
  const name = document.getElementById(`page-${requested}`)
    ? requested
    : DEFAULT_PAGE;

  for (const page of pages) page.hidden = page.id !== `page-${name}`;
  for (const link of navLinks) {
    link.classList.toggle('active', link.dataset.page === name);
  }
}

// Tooltips are fixed-position, so place each next to its link on hover.
for (const link of document.querySelectorAll('.sidebar .nav-link')) {
  const tooltip = link.querySelector('.nav-tooltip');
  link.addEventListener('mouseenter', () => {
    const rect = link.getBoundingClientRect();
    tooltip.style.left = `${rect.right + 14}px`;
    tooltip.style.top = `${rect.top + rect.height / 2}px`;
  });
}

// The button stays highlighted while the subtitles window is open.
subtitlesToggle.addEventListener('click', () => {
  window.subtitles.open();
  subtitlesToggle.setAttribute('aria-pressed', 'true');
});

window.subtitles.onClosed(() => {
  subtitlesToggle.setAttribute('aria-pressed', 'false');
});

document.getElementById('window-minimize').addEventListener('click', () =>
  window.windowControls.minimize(),
);
document.getElementById('window-maximize').addEventListener('click', () =>
  window.windowControls.toggleMaximize(),
);
document.getElementById('window-close').addEventListener('click', () =>
  window.windowControls.close(),
);

// kind: 'info' | 'success' | 'error'.
function toast(message, kind = 'info') {
  const item = document.createElement('div');
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  toasts.append(item);
  setTimeout(() => {
    item.classList.add('leaving');
    item.addEventListener('animationend', () => item.remove(), { once: true });
  }, 4000);
}

// Any HTTP answer means the server is up; no-cors skips the CORS check
// the server does not need for sockets.
async function checkServer(url) {
  try {
    await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

let checking = null;

function refreshHealth() {
  checking ??= backendUrl()
    .then(checkServer)
    .then((online) => {
      setOnline(online);
      return online;
    })
    .finally(() => {
      checking = null;
    });
  return checking;
}

async function setOnline(online) {
  if (!online && offline.hidden) {
    offlineAddress.value = await backendUrl();
  }
  offline.hidden = online;
  if (appState.online !== online) updateAppState({ online });
}

offlineRetry.addEventListener('click', async () => {
  offlineRetry.disabled = true;
  offlineRetry.textContent = t('offline.checking');
  await refreshHealth();
  offlineRetry.disabled = false;
  offlineRetry.textContent = t('offline.retry');
});

offlineForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  let url;
  try {
    url = new URL(offlineAddress.value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    toast(t('offline.invalid'), 'error');
    return;
  }
  prefs.set('backendUrl', url.origin);
  offlineRetry.click();
});

createWave(document.getElementById('offline-wave'), {
  lines: 5,
  idle: 0.35,
});

async function boot() {
  const minimum = new Promise((resolve) => setTimeout(resolve, SPLASH_MS));
  await Promise.all([minimum, refreshHealth()]);
  splash.classList.add('hidden');
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  setInterval(refreshHealth, HEALTH_INTERVAL_MS);
}

window.addEventListener('hashchange', showPage);
document.addEventListener('DOMContentLoaded', () => {
  showPage();
  boot();
});
