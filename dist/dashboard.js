const views = new Set(['overview', 'plan', 'prepare', 'activity']);
const viewNames = { overview: 'Overview', plan: 'Plan an amount', prepare: 'Get prepared', activity: 'Activity' };

function showView() {
  const requested = window.location.hash.slice(1);
  const current = views.has(requested) ? requested : 'overview';
  document.querySelectorAll('[data-view]').forEach(section => { section.hidden = section.dataset.view !== current; });
  document.querySelectorAll('[data-view-link]').forEach(link => {
    if (link.dataset.viewLink === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#current-section').textContent = viewNames[current];
  document.title = `${viewNames[current]} — Buddy Loans preview`;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
  const destination = button.dataset.go;
  if (!views.has(destination)) return;
  if (window.location.hash === `#${destination}`) showView();
  else window.location.hash = destination;
}));

window.addEventListener('hashchange', showView);
showView();

const amountRange = document.querySelector('#amount-range');
function updateAmount() {
  const amount = Number(amountRange.value);
  document.querySelector('#amount-output').value = String(amount);
  document.querySelector('#quote-amount').textContent = `R${amount}`;
  const percentage = ((amount - Number(amountRange.min)) / (Number(amountRange.max) - Number(amountRange.min))) * 100;
  amountRange.style.setProperty('--range-fill', `${percentage}%`);
  document.querySelectorAll('[data-amount]').forEach(button => button.classList.toggle('active', Number(button.dataset.amount) === amount));
}
amountRange.addEventListener('input', updateAmount);
document.querySelectorAll('[data-amount]').forEach(button => button.addEventListener('click', () => { amountRange.value = button.dataset.amount; updateAmount(); }));
updateAmount();
