const sections = new Set(['overview', 'application', 'prepare', 'activity']);
const sectionNames = { overview: 'Home', application: 'Application', prepare: 'Documents', activity: 'Activity' };
const steps = ['Choose an amount', 'Get your documents ready', 'Understand the checks', 'Review before deciding'];
const amountStorageKey = 'buddy.application.amount';
let loanHistory = 'first';
let activeSection = 'overview';
let activeStep = 1;

function readRoute() {
  const [section, step] = window.location.hash.slice(1).split('/');
  return {
    section: sections.has(section) ? section : 'overview',
    step: section === 'application' ? Math.min(4, Math.max(1, Number(step) || 1)) : 1
  };
}

function renderRoute({ focus = false } = {}) {
  const route = readRoute();
  activeSection = route.section;
  document.querySelectorAll('[data-view]').forEach(panel => { panel.hidden = panel.dataset.view !== activeSection; });
  document.querySelectorAll('[data-view-link]').forEach(link => {
    if (link.dataset.viewLink === activeSection) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#current-section').textContent = sectionNames[activeSection];
  document.title = `${sectionNames[activeSection]} — Buddy Loans`;
  if (activeSection === 'application') renderStep(route.step);
  if (focus) document.querySelector('#dashboard-main').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function navigate(section, step = 1) {
  if (!sections.has(section)) return;
  const hash = section === 'application' ? `#application/${step}` : `#${section}`;
  if (window.location.hash === hash) renderRoute({ focus: true });
  else window.location.hash = hash;
}

document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
  navigate(button.dataset.go, Number(button.dataset.stepGo) || 1);
}));
document.querySelectorAll('[data-view-link]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  navigate(link.dataset.viewLink, 1);
}));
window.addEventListener('hashchange', () => renderRoute({ focus: true }));

const amountRange = document.querySelector('#amount-range');
const amountOutput = document.querySelector('#amount-output');
const reviewAmount = document.querySelector('#review-amount');
function updateAmount() {
  const amount = Number(amountRange.value);
  amountOutput.value = String(amount);
  updateEstimate(amount);
  reviewAmount.textContent = `R${amount}`;
  sessionStorage.setItem(amountStorageKey, String(amount));
  const percentage = ((amount - Number(amountRange.min)) / (Number(amountRange.max) - Number(amountRange.min))) * 100;
  amountRange.style.setProperty('--range-fill', `${percentage}%`);
  document.querySelectorAll('[data-amount]').forEach(button => {
    const selected = Number(button.dataset.amount) === amount;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}
const savedAmount = Number(sessionStorage.getItem(amountStorageKey));
if (savedAmount >= 100 && savedAmount <= 700) amountRange.value = String(Math.round(savedAmount / 100) * 100);
amountRange.addEventListener('input', updateAmount);
document.querySelectorAll('[data-amount]').forEach(button => button.addEventListener('click', () => {
  amountRange.value = button.dataset.amount;
  updateAmount();
}));
updateAmount();
document.querySelectorAll('[data-loan-history]').forEach(button => button.addEventListener('click', () => {
  loanHistory = button.dataset.loanHistory;
  document.querySelectorAll('[data-loan-history]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
  updateEstimate(Number(amountRange.value));
}));

function updateEstimate(amount) {
  const repeat = loanHistory === 'repeat';
  const interestRate = repeat ? 0.03 : 0.05;
  const serviceRate = repeat ? 0.22 : 0.20;
  const interest = Math.round(amount * interestRate);
  const initiation = Math.round(amount * 0.15);
  const service = Math.min(60, Math.round(amount * serviceRate));
  const formatRand = value => `R${Math.round(value).toLocaleString('en-ZA')}`;
  document.querySelector('#quote-principal').textContent = formatRand(amount);
  document.querySelector('#quote-interest-label').textContent = `Interest · ${Math.round(interestRate * 100)}% monthly`;
  document.querySelector('#quote-interest').textContent = formatRand(interest);
  document.querySelector('#quote-initiation').textContent = formatRand(initiation);
  document.querySelector('#quote-service').textContent = formatRand(service);
  document.querySelector('#estimate-total').textContent = formatRand(amount + interest + initiation + service);
}
function renderStep(step) {
  activeStep = step;
  const nextButton = document.querySelector('#next-step');
  nextButton.dataset.finished = 'false';
  document.querySelector('#application-status').classList.remove('completion-note');
  document.querySelector('#application-status').textContent = 'Applications open once Buddy is registered with the NCR and secure account services are live.';
  document.querySelectorAll('[data-application-step]').forEach(panel => {
    panel.hidden = Number(panel.dataset.applicationStep) !== activeStep;
  });
  document.querySelector('#step-label').textContent = steps[activeStep - 1];
  document.querySelector('#step-count').textContent = `Step ${activeStep} of 4`;
  document.querySelector('#step-index').textContent = `STEP 0${activeStep} / 04`;
  document.querySelector('#progress-fill').style.width = `${activeStep * 25}%`;
  document.querySelectorAll('.step-dots button').forEach((dot, index) => {
    dot.classList.toggle('active', index + 1 === activeStep);
    dot.classList.toggle('complete', index + 1 < activeStep);
    if (index + 1 === activeStep) dot.setAttribute('aria-current', 'step');
    else dot.removeAttribute('aria-current');
  });
  document.querySelector('#back-step').disabled = activeStep === 1;
  document.querySelector('#back-step').setAttribute('aria-label', activeStep === 1 ? 'Back to student space' : `Back to step ${activeStep - 1}`);
  nextButton.innerHTML = [
    'Continue to documents',
    'Continue to affordability',
    'Review your application',
    'Finish'
  ][activeStep - 1] + ' <svg><use href="#i-arrow"/></svg>';
  document.querySelector('#application-status').textContent = activeStep === 4
    ? 'Account registration and applications open once Buddy is registered with the NCR and secure account services are live.'
    : 'Applications open once Buddy is registered with the NCR and secure account services are live.';
}

document.querySelector('#back-step').addEventListener('click', () => {
  if (activeStep > 1) navigate('application', activeStep - 1);
  else navigate('overview');
});
document.querySelector('#next-step').addEventListener('click', () => {
  const next = document.querySelector('#next-step');
  const status = document.querySelector('#application-status');
  if (next.dataset.finished === 'true') {
    navigate('overview');
  } else if (activeStep < 4) {
    navigate('application', activeStep + 1);
  } else {
    status.textContent = 'You’ve reached the final step. Account registration and loan applications are not open yet, so nothing has been submitted.';
    status.classList.add('completion-note');
    next.textContent = 'Return to student space';
    next.dataset.finished = 'true';
  }
});
document.querySelectorAll('.step-dots button').forEach(dot => dot.addEventListener('click', () => {
  navigate('application', Number(dot.dataset.step));
}));
renderRoute();
