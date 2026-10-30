const sections = new Set(['overview', 'application', 'prepare', 'activity']);
const sectionNames = { overview: 'Home', application: 'Application', prepare: 'Documents', activity: 'Activity' };
const steps = ['Create your student account', 'Choose an amount', 'Prepare your documents', 'Check affordability', 'Review your offer', 'Authorise the debit order', 'Receive your funds'];
const headings = [['Create your ', 'student account.'], ['Choose an ', 'amount.'], ['Prepare your ', 'documents.'], ['Check ', 'affordability.'], ['Review your ', 'offer.'], ['Authorise the ', 'debit order.'], ['Funds are sent ', 'after acceptance.']];
const amountStorageKey = 'buddy.application.amount';
let activeSection = 'overview';
let activeStep = 1;
let renderedRouteKey = null;

function readRoute() {
  const [section, step] = window.location.hash.slice(1).split('/');
  return {
    section: sections.has(section) ? section : 'overview',
    step: section === 'application' ? Math.min(7, Math.max(1, Number(step) || 1)) : 1
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

let activeProfile = null;
let activeSession = null;
let authReady = false;
const profileDialog = document.querySelector('#profile-settings-dialog');
const profileOpenButton = document.querySelector('#profile-open-button');
const accountDialog = document.querySelector('#account-dialog');
const profileEditForm = document.querySelector('#profile-edit-form');
const profileEditMessage = document.querySelector('#profile-edit-message');
const preferencesMessage = document.querySelector('#preference-save-message');
const profilePreferenceTab = document.querySelector('#profile-tab-preferences');
const profileDetailsTab = document.querySelector('#profile-tab-details');
const profileDetailsPanel = document.querySelector('#profile-panel-details');
const profilePreferencesPanel = document.querySelector('#profile-panel-preferences');
function showProfileSettingsTab(tab) {
  const showPreferences = tab === 'preferences';
  profileDetailsTab.setAttribute('aria-selected', String(!showPreferences));
  profilePreferenceTab.setAttribute('aria-selected', String(showPreferences));
  profileDetailsPanel.hidden = showPreferences;
  profilePreferencesPanel.hidden = !showPreferences;
}
function fillProfileSettings(profile) {
  for (const [key, value] of Object.entries(profile)) {
    const field = profileEditForm.elements.namedItem(key);
    if (field) field.value = value ?? '';
  }
  const otherField = document.querySelector('#profile-edit-referral-other');
  otherField.hidden = profile.referral_source !== 'Other';
  document.querySelector('#preferred-contact-method').value = profile.preferred_contact_method || 'WhatsApp';
  document.querySelector('#profile-product-updates').checked = Boolean(profile.product_updates);
}
function updateProfileControl() {
  const signedIn = Boolean(activeSession);
  profileOpenButton.dataset.authenticated = String(signedIn);
  profileOpenButton.setAttribute('aria-label', signedIn ? 'Open profile and preferences' : 'Sign in to your student account');
  document.querySelector('#profile-header-name').textContent = signedIn ? (activeProfile?.display_name || 'My account') : 'Sign in';
  document.querySelector('#profile-header-caption').textContent = signedIn ? 'Profile & preferences' : 'Student account';
  document.querySelector('#profile-avatar').textContent = signedIn
    ? (activeProfile ? `${activeProfile.first_name?.[0] || ''}${activeProfile.last_name?.[0] || ''}`.toUpperCase() : 'ME')
    : '↗';
}
window.addEventListener('buddy-profile-ready', event => {
  const profile = event.detail?.profile;
  if (!profile) return;
  activeProfile = profile;
  const name = profile.display_name || `${profile.first_name} ${profile.last_name}`.trim();
  document.querySelector('#profile-avatar').textContent = event.detail.initials || `${profile.first_name?.[0] || ''}${profile.last_name?.[0] || ''}`.toUpperCase();
  document.querySelector('#profile-header-name').textContent = name;
  activeSession = activeSession || {};
  profileOpenButton.setAttribute('aria-label', `Signed in as ${name}. Open profile and preferences`);
  updateProfileControl();
  fillProfileSettings(profile);
});
window.addEventListener('buddy-auth-ready', async event => {
  authReady = true;
  activeSession = event.detail?.session || null;
  updateProfileControl();
  if (!activeSession || !window.BuddyAuth?.getProfile) return;
  try {
    const { data, error } = await window.BuddyAuth.getProfile();
    if (!error && data) window.dispatchEvent(new CustomEvent('buddy-profile-ready', { detail: { profile: { ...data, display_name: `${data.first_name} ${data.last_name}`.trim() } } }));
  } catch { /* Keep the account entry point available if profile loading is temporarily unavailable. */ }
});
window.addEventListener('buddy-auth-state', event => {
  if (event.detail?.event === 'SIGNED_OUT') {
    activeProfile = null;
    activeSession = null;
    authReady = true;
    updateProfileControl();
    if (profileDialog.open) profileDialog.close();
  } else if (event.detail?.session) {
    activeSession = event.detail.session;
    authReady = true;
    updateProfileControl();
  }
});
profileOpenButton.addEventListener('click', async () => {
  if (!authReady || !activeSession) {
    if (!accountDialog.open) accountDialog.showModal();
    return;
  }
  // Open synchronously inside the tap. Mobile Safari can discard the user
  // gesture after an async Supabase request, preventing showModal() from opening.
  showProfileSettingsTab('details');
  if (!profileDialog.open) profileDialog.showModal();
  const wasMissingProfile = !activeProfile;
  profileEditMessage.hidden = true;
  if (wasMissingProfile) {
    profileEditMessage.textContent = 'Loading your profile…';
    profileEditMessage.hidden = false;
  } else {
    fillProfileSettings(activeProfile);
  }

  try {
    if (!activeProfile && window.BuddyAuth?.getProfile) {
      const { data, error } = await window.BuddyAuth.getProfile();
      if (error) throw error;
      if (!data) throw new Error('Profile not found');
      const profile = { ...data, display_name: `${data.first_name} ${data.last_name}`.trim() };
      window.dispatchEvent(new CustomEvent('buddy-profile-ready', { detail: { profile } }));
    }
    const { data: userResult, error: userError } = await window.BuddyAuth.getUser();
    if (userError) throw userError;
    document.querySelector('#profile-university-email').textContent = userResult?.user?.email || 'Student email unavailable';
    if (activeProfile) fillProfileSettings(activeProfile);
    profileEditMessage.hidden = true;
  } catch {
    profileEditMessage.textContent = activeProfile
      ? 'Your profile opened, but some account details could not be refreshed.'
      : 'We couldn’t load your profile. Check your connection and try again.';
    profileEditMessage.hidden = false;
  }
});
profileDialog.querySelector('.profile-settings-close').addEventListener('click', () => profileDialog.close());
profileDetailsTab.addEventListener('click', () => showProfileSettingsTab('details'));
profilePreferenceTab.addEventListener('click', () => showProfileSettingsTab('preferences'));
profileEditForm.elements.referral_source.addEventListener('change', event => {
  document.querySelector('#profile-edit-referral-other').hidden = event.target.value !== 'Other';
});
profileEditForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!profileEditForm.reportValidity()) return;
  const changes = Object.fromEntries(new FormData(profileEditForm).entries());
  for (const key of ['first_name','last_name','hometown','home_address','phone','whatsapp_phone','personal_email','next_of_kin_name','next_of_kin_phone','referral_other']) changes[key] = String(changes[key] || '').trim();
  changes.personal_email = changes.personal_email.toLowerCase();
  changes.whatsapp_phone ||= changes.phone;
  changes.referral_other = changes.referral_source === 'Other' ? changes.referral_other : '';
  const button = profileEditForm.querySelector('.profile-save');
  button.disabled = true;
  try {
    const { data, error } = await window.BuddyAuth.updateProfile(changes);
    if (error) throw error;
    const profile = { ...data, display_name: `${data.first_name} ${data.last_name}`.trim() };
    window.dispatchEvent(new CustomEvent('buddy-profile-ready', { detail: { profile } }));
    profileEditMessage.textContent = 'Your profile has been updated.';
    profileEditMessage.hidden = false;
  } catch {
    profileEditMessage.textContent = 'We couldn’t update your profile. Please try again.';
    profileEditMessage.hidden = false;
  } finally { button.disabled = false; }
});
document.querySelector('#save-preferences-button').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  preferencesMessage.hidden = true;
  try {
    const { data, error } = await window.BuddyAuth.updateProfile({
      preferred_contact_method: document.querySelector('#preferred-contact-method').value,
      product_updates: document.querySelector('#profile-product-updates').checked
    });
    if (error) throw error;
    const profile = { ...data, display_name: `${data.first_name} ${data.last_name}`.trim() };
    window.dispatchEvent(new CustomEvent('buddy-profile-ready', { detail: { profile } }));
    preferencesMessage.textContent = 'Your preferences have been saved.';
  } catch {
    preferencesMessage.textContent = 'We couldn’t save your preferences. Please try again.';
  } finally { preferencesMessage.hidden = false; button.disabled = false; }
});
document.querySelector('#profile-signout-button').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  const { error } = await window.BuddyAuth.signOut();
  if (error) event.currentTarget.disabled = false;
  else window.location.assign('index.html?open=account');
});

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
    document.querySelector('#estimate-caption').textContent = 'Loan-history pricing is not connected yet';
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
  document.querySelector('#step-count').textContent = `Step ${activeStep} of ${steps.length}`;
  document.querySelector('#step-index').textContent = `0${activeStep} / 0${steps.length}`;
  document.querySelector('#step-description').textContent = [
    'Create an account with your university-issued email before you apply.',
    'Choose the amount you need and see the proposed repayment estimate.',
    'Prepare your ID, registration proof, residence proof and recent bank statements.',
    'Review verified income, spending and existing commitments against the amount requested.',
    'If eligible, read the complete offer, fees, total and repayment date before deciding.',
    'A separate debit-order mandate must be reviewed and explicitly accepted before funds are released.',
    'Funds can only be sent after approval, agreement and debit-order authorisation.'
  ][activeStep - 1];
  const heading = document.querySelector('#plan-title');
  heading.replaceChildren(document.createTextNode(headings[activeStep - 1][0]));
  const accent = document.createElement('em');
  accent.textContent = headings[activeStep - 1][1];
  heading.append(accent);
  const progressTrack = document.querySelector('.application-intro .progress-track');
  progressTrack.setAttribute('aria-valuenow', String(activeStep));
  progressTrack.setAttribute('aria-valuemax', String(steps.length));
  progressTrack.setAttribute('aria-valuetext', `Step ${activeStep} of ${steps.length}`);
  document.querySelector('#progress-fill').style.width = `${(activeStep / steps.length) * 100}%`;

  document.querySelector('#back-step').disabled = activeStep === 1;
  document.querySelector('#back-step').setAttribute('aria-label', activeStep === 1 ? 'Back to student space' : `Back to step ${activeStep - 1}`);
  nextButton.innerHTML = [
    'Continue to amount',
    'Continue to documents',
    'Continue to affordability',
    'Review your offer',
    'Continue to debit order',
    'See what happens next',
    'Return to student space'
  ][activeStep - 1] + ' <svg><use href="#i-arrow"/></svg>';
  document.querySelector('#application-status').textContent = [
    'Create or sign in to your SPU account first. This guided journey does not submit or save a loan application.',
    'Loan-history pricing is not connected yet, so no personalised repayment estimate is shown.',
    'Secure document upload is not open yet. Do not send personal documents through this page.',
    'Affordability and credit checks are not active here. No documents are being analysed.',
    'No lending decision or final offer is made on this page.',
    'No debit order is created or accepted here. Authorisation must be explicit and separate.',
    'No funds are requested or transferred here. Disbursement follows completed approval and acceptance.'
  ][activeStep - 1];
}

document.querySelector('#back-step').addEventListener('click', () => {
  if (activeStep > 1) navigate('application', activeStep - 1);
  else navigate('overview');
});
function sendToAccount(returnStep = 2) {
  const target = new URL('index.html', window.location.href);
  target.searchParams.set('open', 'account');
  target.searchParams.set('return', `/dashboard.html#application/${returnStep}`);
  window.location.assign(target.toString());
}

window.addEventListener('buddy-auth-ready', event => {
  const route = readRoute();
  if (!event.detail?.session && route.section === 'application' && route.step > 1) sendToAccount(route.step);
});
window.addEventListener('buddy-auth-state', event => {
  const route = readRoute();
  if (event.detail?.event === 'SIGNED_OUT' && route.section === 'application' && route.step > 1) sendToAccount(route.step);
});

document.querySelector('#next-step').addEventListener('click', async () => {
  const next = document.querySelector('#next-step');
  const status = document.querySelector('#application-status');
  if (activeStep === 1) {
    try {
      const { data } = await window.BuddyAuth?.getSession();
      if (!data?.session) {
        sendToAccount(2);
        return;
      }
    } catch {
      sendToAccount(2);
      return;
    }
  }
  if (next.dataset.finished === 'true') {
    navigate('overview');
  } else if (activeStep < steps.length) {
    navigate('application', activeStep + 1);
  } else {
    status.textContent = 'You’ve reached the end of the guided journey. Account sign-up, document upload, affordability checks and loan applications are not open here.';
    status.classList.add('completion-note');
    next.textContent = 'Return to student space';
    next.dataset.finished = 'true';
  }
});

renderRoute();
