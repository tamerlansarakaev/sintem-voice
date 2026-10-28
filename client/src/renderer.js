const DEFAULT_PAGE = 'live-translation';

const pages = document.querySelectorAll('.page');
const navLinks = document.querySelectorAll('.nav-link');
const subtitlesToggle = document.getElementById('subtitles-toggle');

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

// The button stays highlighted while the subtitles window is open.
subtitlesToggle.addEventListener('click', () => {
  window.subtitles.open();
  subtitlesToggle.setAttribute('aria-pressed', 'true');
});

window.subtitles.onClosed(() => {
  subtitlesToggle.setAttribute('aria-pressed', 'false');
});

window.addEventListener('hashchange', showPage);
showPage();
