const views = new Set(['overview', 'plan', 'prepare', 'activity']);
const viewNames = { overview: 'Home', plan: 'Application preview', prepare: 'Documents', activity: 'Activity' };
let pendingStep = null;

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
  if (destination === 'plan') pendingStep = button.dataset.stepGo ? Number(button.dataset.stepGo) : 1;
}));

window.addEventListener('hashchange', showView);

const amountRange = document.querySelector('#amount-range');
function updateAmount() {
  const amount = Number(amountRange.value);
  document.querySelector('#amount-output').value = String(amount);
  document.querySelector('#review-amount').textContent = `R${amount}`;
  const percentage = ((amount - Number(amountRange.min)) / (Number(amountRange.max) - Number(amountRange.min))) * 100;
  amountRange.style.setProperty('--range-fill', `${percentage}%`);
  document.querySelectorAll('[data-amount]').forEach(button => button.classList.toggle('active', Number(button.dataset.amount) === amount));
}
amountRange.addEventListener('input', updateAmount);
document.querySelectorAll('[data-amount]').forEach(button => button.addEventListener('click', () => { amountRange.value = button.dataset.amount; updateAmount(); }));
updateAmount();

const stepNames = ['Choose an amount', 'Get your documents ready', 'Understand the checks', 'Review before deciding'];
let activeStep = 1;
function setStep(next) {
  activeStep = Math.min(4, Math.max(1, next));
  document.querySelectorAll('[data-application-step]').forEach(panel => { panel.hidden = Number(panel.dataset.applicationStep) !== activeStep; });
  document.querySelector('#step-label').textContent = stepNames[activeStep - 1];
  document.querySelector('#step-count').textContent = `Step ${activeStep} of 4`;
  document.querySelector('#step-index').textContent = `STEP 0${activeStep} / 04`;
  document.querySelector('#progress-fill').style.width = `${activeStep * 25}%`;
  document.querySelectorAll('.step-dots i').forEach((dot, index) => {
    dot.classList.toggle('active', index + 1 === activeStep);
    dot.classList.toggle('complete', index + 1 < activeStep);
  });
  document.querySelector('#back-step').disabled = activeStep === 1;
  document.querySelector('#next-step').innerHTML = activeStep === 4 ? 'Finish preview <svg><use href="#i-check"/></svg>' : 'Continue <svg><use href="#i-arrow"/></svg>';
  document.querySelector('#application-legal-note').textContent = activeStep === 4
    ? 'This is where a real application would pause so you can review a formal quote. The Buddy Loans application process is not open yet.'
    : 'Buddy Loans is preparing for launch. Applications are not open and this preview does not assess eligibility.';
  if (window.location.hash === '#plan') window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelector('#back-step').addEventListener('click', () => setStep(activeStep - 1));
document.querySelector('#next-step').addEventListener('click', () => {
  if (activeStep < 4) setStep(activeStep + 1);
  else {
    document.querySelector('#application-legal-note').textContent = 'You’ve reached the end of the demo. No account details or loan application were submitted or saved.';
    document.querySelector('#application-legal-note').classList.add('completion-note');
  }
});
document.querySelectorAll('[data-step-go]').forEach(button => button.addEventListener('click', () => setStep(Number(button.dataset.stepGo))));
window.addEventListener('hashchange', () => { if (window.location.hash === '#plan') { setStep(pendingStep ?? 1); pendingStep = null; } });
setStep(1);
showView();


