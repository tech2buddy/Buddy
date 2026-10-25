const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if ('IntersectionObserver' in window && !reduceMotion.matches) {
  document.documentElement.classList.add('js-motion');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('#mobile-menu');
function closeMenu() { if (mobileMenu.open) mobileMenu.close(); menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Open menu'); }
menuToggle.addEventListener('click', () => { if (mobileMenu.open) { closeMenu(); return; } mobileMenu.showModal(); menuToggle.setAttribute('aria-expanded', 'true'); menuToggle.setAttribute('aria-label', 'Close menu'); });
mobileMenu.addEventListener('close', closeMenu);
document.querySelector('.menu-close').addEventListener('click', closeMenu);
mobileMenu.addEventListener('click', event => { if(event.target === mobileMenu) { const bounds = mobileMenu.getBoundingClientRect(); if(event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right) closeMenu(); } });
mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
window.matchMedia('(min-width: 761px)').addEventListener('change', event => { if (event.matches) closeMenu(); });

const scenarios = {
  everyday: { kicker: 'THE EVERYDAY', title: 'Keep your<br>day moving.', description: 'A commute. A grocery run.<br>The little things add up.', rotation: '16deg' },
  unexpected: { kicker: 'THE UNEXPECTED', title: 'Life happens.<br>Take a breath.', description: 'An unplanned expense.<br>A moment to think things through.', rotation: '-12deg' },
  opportunity: { kicker: 'THE NEXT CHAPTER', title: 'Make space<br>for possibility.', description: 'A new idea. A fresh start.<br>Something worth looking ahead to.', rotation: '30deg' }
};
document.querySelectorAll('.scenario').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.scenario').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  const selected = scenarios[button.dataset.scenario];
  document.querySelector('.demo-kicker').textContent = selected.kicker;
  document.querySelector('#scenario-title').innerHTML = selected.title;
  document.querySelector('#scenario-description').innerHTML = selected.description;
  document.querySelector('.tile-front').style.transform = `rotate(${selected.rotation})`;
  if (!reduceMotion.matches) document.querySelector('.demo-content').animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 380, easing: 'ease-out' });
}));

const dialog = document.querySelector('#intro-dialog');
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => { closeMenu(); dialog.showModal(); }));
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
document.querySelector('#explore-dialog').addEventListener('click', () => { dialog.close(); document.querySelector('#experience').scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth' }); });
document.querySelector('.motion-toggle').addEventListener('click', event => { const paused = document.body.classList.toggle('motion-paused'); event.currentTarget.textContent = paused ? '▷' : 'Ⅱ'; const label = paused ? 'Play decorative motion' : 'Pause decorative motion'; event.currentTarget.title = label; event.currentTarget.setAttribute('aria-label', label); });

// Keep the primary action reachable after the first screen, without covering
// the closing CTA. Observer callbacks avoid work on every scroll event.
const dock = document.querySelector('.mobile-dock');
let heroVisible = true;
let closingVisible = false;
const mobileViewport = window.matchMedia('(max-width: 760px)');
function updateDock() { dock.hidden = !mobileViewport.matches || heroVisible || closingVisible; }
if ('IntersectionObserver' in window) {
  const dockObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => { if(entry.target.matches('.hero')) heroVisible = entry.isIntersecting; else closingVisible = entry.isIntersecting; });
    updateDock();
  }, { threshold: 0 });
  dockObserver.observe(document.querySelector('.hero'));
  dockObserver.observe(document.querySelector('.closing'));
  const artObserver = new IntersectionObserver(entries => entries.forEach(entry => document.querySelector('.hero-art').classList.toggle('art-out-of-view', !entry.isIntersecting)));
  artObserver.observe(document.querySelector('.hero-art'));
}
mobileViewport.addEventListener('change', updateDock);
