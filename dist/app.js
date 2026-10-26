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
const accountDialog = document.querySelector('#account-dialog');
document.querySelector('#explore-dialog').addEventListener('click', () => { dialog.close(); accountDialog.showModal(); });
document.querySelectorAll('[data-account-open]').forEach(button => button.addEventListener('click', () => { closeMenu(); accountDialog.showModal(); }));
document.querySelector('.account-close').addEventListener('click', () => accountDialog.close());
accountDialog.addEventListener('click', event => { if (event.target === accountDialog) { const bounds = accountDialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) accountDialog.close(); } });
const accountForm = document.querySelector('#account-form');
const accountEmail = document.querySelector('#account-email');
const accountPassword = document.querySelector('#account-password');
const accountConfirm = document.querySelector('#account-confirm-password');
const accountError = document.querySelector('#account-form-error');
const accountNext = document.querySelector('#account-next');
let accountMode = 'signup';
function setAccountMode(mode) {
  accountMode = mode;
  const signup = mode === 'signup';
  document.querySelectorAll('[data-account-mode]').forEach(option => { const selected = option.dataset.accountMode === mode; option.classList.toggle('selected', selected); option.setAttribute('aria-pressed', String(selected)); });
  document.querySelector('#account-title').innerHTML = signup ? "Let's get you<br><span>started.</span>" : 'Good to see<br><span>you again.</span>';
  document.querySelector('#account-lead').textContent = signup ? 'A student space designed around what comes next.' : 'Your student space is right where you left it.';
  document.querySelector('.account-confirm').hidden = !signup;
  document.querySelector('#account-password-help').textContent = signup ? 'Use at least 8 characters.' : 'Enter your account password.';
  accountPassword.placeholder = signup ? 'Create a password' : 'Enter your password';
  accountPassword.autocomplete = signup ? 'new-password' : 'current-password';
  document.querySelector('#account-submit-label').textContent = signup ? 'Continue' : 'Log in';
  accountForm.reset();
  accountPassword.type = 'password';
  document.querySelector('#show-password').textContent = 'Show';
  document.querySelector('#show-password').setAttribute('aria-pressed', 'false');
  accountError.hidden = true;
  accountNext.hidden = true;
  accountForm.hidden = false;
}
document.querySelectorAll('[data-account-mode]').forEach(button => button.addEventListener('click', () => setAccountMode(button.dataset.accountMode)));
document.querySelector('#show-password').addEventListener('click', event => {
  const visible = accountPassword.type === 'password';
  accountPassword.type = visible ? 'text' : 'password';
  event.currentTarget.textContent = visible ? 'Hide' : 'Show';
  event.currentTarget.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  event.currentTarget.setAttribute('aria-pressed', String(visible));
});
accountForm.addEventListener('submit', event => {
  event.preventDefault();
  let message = '';
  let target = accountEmail;
  if (!accountEmail.validity.valid || !accountEmail.value.trim()) message = 'Enter a valid university email address.';
  else if (!accountPassword.value) { message = 'Enter your password.'; target = accountPassword; }
  else if (accountMode === 'signup' && accountPassword.value.length < 8) { message = 'Choose a password with at least 8 characters.'; target = accountPassword; }
  else if (accountMode === 'signup' && accountConfirm.value !== accountPassword.value) { message = 'Your passwords need to match.'; target = accountConfirm; }
  if (message) { accountError.textContent = message; accountError.hidden = false; target.focus(); return; }
  accountError.hidden = true;
  accountForm.reset();
  accountForm.hidden = true;
  accountNext.hidden = false;
  document.querySelector('#account-next-title').textContent = accountMode === 'signup' ? 'Verify your student email.' : 'Account access is coming.';
  document.querySelector('#account-next-copy').textContent = accountMode === 'signup' ? "When account access opens, Buddy will send a verification link to your university email. You'll then confirm your student details before applying." : 'This login screen is a preview. Once accounts launch, you will be able to sign in here with your verified university email.';
  accountNext.querySelector('h3').focus?.();
});
document.querySelector('#account-back').addEventListener('click', () => { accountNext.hidden = true; accountForm.hidden = false; accountEmail.focus(); });
accountDialog.addEventListener('close', () => setAccountMode('signup'));
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
