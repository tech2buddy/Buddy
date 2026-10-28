const sections = new Set(['overview', 'application', 'prepare', 'activity']);
const sectionNames = { overview: 'Home', application: 'Application', prepare: 'Documents', activity: 'Activity' };
const steps = ['Choose an amount', 'Get your documents ready', 'Understand the checks', 'Review before deciding'];
const headings = [['Choose an ', 'amount.'], ['Get your ', 'documents ready.'], ['Understand ', 'the checks.'], ['Review ', 'before deciding.']];
const amountStorageKey = 'buddy.application.amount';
let activeSection = 'overview';
let activeStep = 1;
let renderedRouteKey = null;

function readRoute() {
  const [section, step] = window.location.hash.slice(1).split('/');
  return {
    section: sections.has(section) ? section : 'overview',
    step: section === 'application' ? Math.min(4, Math.max(1, Number(step) || 1)) : 1
  };
}

function renderRoute({ focus = false, scroll = false } = {}) {
  const route = readRoute();
  const routeKey = `${route.section}/${route.step}`;
  if (routeKey === renderedRouteKey) return;
  renderedRouteKey = routeKey;
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
  if (scroll) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
}

function navigate(section, step = 1) {
  if (!sections.has(section)) return;
  const hash = section === 'application' ? `#application/${step}` : `#${section}`;
  const current = readRoute();
  if (current.section === section && (section !== 'application' || current.step === step)) return;
  window.history.pushState(null, '', hash);
  renderRoute({ focus: true, scroll: true });
}

document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
  navigate(button.dataset.go, Number(button.dataset.stepGo) || 1);
}));
document.querySelectorAll('[data-view-link]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  navigate(link.dataset.viewLink, 1);
}));
window.addEventListener('hashchange', () => renderRoute({ focus: true, scroll: true }));
window.addEventListener('popstate', () => renderRoute({ focus: true, scroll: true }));
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

const amountRange = document.querySelector('#amount-range');
const amountOutput = document.querySelector('#amount-output');
const reviewAmount = document.querySelector('#review-amount');
function formatRand(value) { return `R${Math.round(value).toLocaleString('en-ZA')}`; }
let currentLoanHistory = null;
function southAfricanYear(value = new Date()) {
  return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric' }).format(value);
}
function deriveLoanHistory(account) {
  if (!account || account.authenticated !== true || !Array.isArray(account.loans)) return null;
  const year = southAfricanYear();
  const disbursedThisYear = account.loans.some(loan => {
    if (loan?.status !== 'disbursed' || !loan.disbursedAt) return false;
    const date = new Date(loan.disbursedAt);
    return Number.isFinite(date.getTime()) && date.getTime() <= Date.now() && southAfricanYear(date) === year;
  });
  return disbursedThisYear ? 'repeat' : 'first';
}
function calculateEstimate(amount, repeat) {
  const interestRate = repeat ? 0.03 : 0.05;
  const serviceRate = repeat ? 0.22 : 0.20;
  const interest = Math.round(amount * interestRate);
  const initiation = Math.round(amount * 0.15);
  const service = Math.min(60, Math.round(amount * serviceRate));
  return { interestRate, interest, initiation, service, total: amount + interest + initiation + service };
}
function updateEstimate(amount) {
  const label = document.querySelector('#loan-history-label');
  const note = document.querySelector('#pricing-note');
  const breakdown = document.querySelector('#estimate-breakdown');
  const legal = document.querySelector('#pricing-legal');
  const total = document.querySelector('#estimate-total');
  if (!currentLoanHistory) {
    label.textContent = 'ACCOUNT CHECK';
    document.querySelector('#estimate-caption').textContent = 'Your estimate appears after sign-in';
    total.textContent = '—';
    breakdown.hidden = true;
    legal.hidden = true;
    note.hidden = false;
    note.textContent = 'Once you are signed in, Buddy checks your loan history and shows one rate: first-loan pricing if no loan was disbursed this calendar year, or repeat-loan pricing if one was.';
    return;
  }
  const repeat = currentLoanHistory === 'repeat';
  const { interestRate, interest, initiation, service, total: repaymentTotal } = calculateEstimate(amount, repeat);
  label.textContent = repeat ? 'REPEAT LOAN THIS YEAR' : 'FIRST LOAN THIS YEAR';
  document.querySelector('#estimate-caption').textContent = 'Total due if approved';
  document.querySelector('#quote-principal').textContent = formatRand(amount);
  document.querySelector('#quote-interest-label').textContent = `Interest · ${Math.round(interestRate * 100)}% monthly`;
  document.querySelector('#quote-interest').textContent = formatRand(interest);
  document.querySelector('#quote-initiation').textContent = formatRand(initiation);
  document.querySelector('#quote-service').textContent = formatRand(service);
  total.textContent = formatRand(repaymentTotal);
  document.querySelector('#quote-total').textContent = total.textContent;
  breakdown.hidden = false;
  legal.hidden = false;
  note.hidden = true;
}
window.BuddyLoansDashboard = Object.freeze({
  setAccountContext(account) {
    currentLoanHistory = deriveLoanHistory(account);
    updateEstimate(Number(amountRange.value));
  }
});
function updateAmount() {
  const amount = Number(amountRange.value);
  amountOutput.value = String(amount);
  updateEstimate(amount);
  reviewAmount.textContent = `R${amount}`;
  sessionStorage.setItem(amountStorageKey, String(amount));
  const percentage = ((amount - Number(amountRange.min)) / (Number(amountRange.max) - Number(amountRange.min))) * 100;
  amountRange.style.setProperty('--range-fill', `${percentage}%`);
}
const savedAmount = Number(sessionStorage.getItem(amountStorageKey));
if (savedAmount >= 100 && savedAmount <= 700) amountRange.value = String(Math.round(savedAmount / 100) * 100);
amountRange.addEventListener('input', updateAmount);
updateAmount();
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
  document.querySelector('#step-index').textContent = `0${activeStep} / 04`;
  document.querySelector('#step-description').textContent = ['Choose an amount and see one clear repayment estimate.', 'Get your required student and income documents ready.', 'See how affordability and verification checks work.', 'Review the full amount and due date before deciding.'][activeStep - 1];
  const heading = document.querySelector('#plan-title');
  heading.replaceChildren(document.createTextNode(headings[activeStep - 1][0]));
  const accent = document.createElement('em');
  accent.textContent = headings[activeStep - 1][1];
  heading.append(accent);
  const progressTrack = document.querySelector('.application-intro .progress-track');
  progressTrack.setAttribute('aria-valuenow', String(activeStep));
  progressTrack.setAttribute('aria-valuetext', `Step ${activeStep} of 4`);
  document.querySelector('#progress-fill').style.width = `${activeStep * 25}%`;

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

renderRoute();
