const sections = new Set(['overview', 'application', 'prepare', 'activity']);
const sectionNames = { overview: 'Home', application: 'Application', prepare: 'Documents', activity: 'Activity' };
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
  if (route.section === 'application' && route.step >= 4) {
    route.section = 'activity';
    route.step = 1;
    window.history.replaceState(null, '', `#${route.section}`);
  }
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
  if (activeSection === 'application' && route.step === 3 && activeSession) loadStudentDocuments();
  if (activeSection === 'prepare' && activeSession) loadStudentDocuments();
  if ((activeSection === 'overview' || activeSection === 'activity') && activeSession) loadAccountWorkspace();
  if (focus) document.querySelector('#dashboard-main').focus({ preventScroll: true });
  if (scroll) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
}

function navigate(section, step = 1) {
  if (!sections.has(section)) return;
  if (section === 'application' && step >= 4) {
    navigate('activity');
    return;
  }
  const hash = section === 'application' ? `#application/${step}` : `#${section}`;
  const current = readRoute();
  if (current.section === section && (section !== 'application' || current.step === step)) return;
  window.history.pushState(null, '', hash);
  renderRoute({ focus: true, scroll: true });
}

let activeProfile = null;
let activeSession = null;
let activeApplication = null;
let authReady = false;
let activityUnsubscribe = null;
let activityWatchRequest = 0;
let activityReloadTimer = 0;
const documentLabels = { south_african_id: 'South African ID', proof_of_registration: 'Proof of registration', proof_of_residence: 'Proof of residence', bank_statements: 'Three months of bank statements' };
const reviewStatusLabels = { pending: 'Pending review', reviewing: 'In review', accepted: 'Accepted', action_required: 'Action needed' };
const requiredDocumentTypes = Object.keys(documentLabels);
let uploadedDocumentTypes = new Set();
const documentForm = document.querySelector('#document-upload-form');
const documentInput = document.querySelector('#document-file');
const documentConsent = document.querySelector('#document-consent');
const documentUploadButton = document.querySelector('#document-upload-button');
const documentStatus = document.querySelector('#document-upload-status');
const documentList = document.querySelector('#document-list');
const applicationSubmitStatus = document.querySelector('#application-submit-status');
const applicationReviewButton = document.querySelector('#application-review-button');
const applicationFinalSubmitButton = document.querySelector('#application-final-submit-button');
const applicationReviewSubmitStatus = document.querySelector('#application-review-submit-status');
const reviewResidenceConfirm = document.querySelector('#review-residence-confirm');
const reviewBursaryStatus = document.querySelector('#review-bursary-status');
const reviewBursaryName = document.querySelector('#review-bursary-name');
let accountWorkspaceRequest = 0;
const activityEventTitles = {
  application_started: 'Application started',
  application_progressed: 'Application progress saved',
  application_status_changed: 'Application status updated',
  application_amount_changed: 'Requested amount updated',
  document_uploaded: 'Document uploaded',
  document_reviewed: 'Document review updated',
  document_removed: 'Document removed',
  loan_disbursed: 'Loan disbursed',
  staff_reminder: 'A message from the Buddy team'
};
function displayActivityDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
function renderActivityFeed(events, listId, emptyId, limit = 50) {
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);
  if (!list || !empty) return;
  list.replaceChildren();
  const rows = (events || []).slice(0, limit);
  empty.hidden = rows.length > 0;
  for (const event of rows) {
    const item = document.createElement('li'); item.className = 'activity-feed-entry';
    const marker = document.createElement('span'); marker.className = 'activity-feed-marker'; marker.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div'); copy.className = 'activity-feed-copy';
    const title = document.createElement('strong'); title.textContent = event.title || activityEventTitles[event.event_type] || 'Account update';
    const date = document.createElement('time'); date.dateTime = event.created_at || ''; date.textContent = displayActivityDate(event.created_at);
    const detail = document.createElement('p'); detail.textContent = event.detail || '';
    copy.append(title, date, detail); item.append(marker, copy); list.append(item);
  }
}
function updateApplicationSummary(application, documentCount = null) {
  const statusLabels = { draft: 'In progress', submitted: 'Submitted · awaiting review', under_review: 'In review', action_required: 'Update requested', approved: 'Approved · mandate next', disbursed: 'Funds sent', declined: 'Unsuccessful', cancelled: 'Cancelled' };
  const status = application ? (statusLabels[application.status] || 'In progress') : 'Not started';
  const hint = application?.status === 'draft'
    ? `Amount ${application.requested_amount ? `R${application.requested_amount} · ` : ''}${Number(application.current_step) >= 3 ? 'documents next' : 'ready to continue'} · saved ${displayActivityDate(application.updated_at)}`
    : application ? `Updated ${displayActivityDate(application.updated_at)}` : 'Choose an amount to get started';
  const set = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value; };
  set('#overview-application-status', status);
  set('#overview-application-hint', hint);
  const applicationMessages = {
    draft: 'Your amount is saved. Upload all four required document types and submit when you’re ready.',
    submitted: 'Your application is with Buddy for document and affordability review. We’ll post the decision or next step here.',
    under_review: 'Buddy is reviewing your application. Check here for a decision or a request for more information.',
    action_required: 'Buddy has asked for an update before the review can continue. Check Activity for details, replace any requested documents, then resubmit.',
    approved: 'Buddy will share your final offer and debit-order mandate for you to review and accept separately. Nothing is collected until you authorise it.',
    declined: 'Your application was unsuccessful. We’ll show any update here; contact Buddy if you need help.',
    disbursed: 'Your loan has been disbursed. Your account activity will show the latest repayment and loan updates.',
    cancelled: 'This application is closed. You can contact Buddy if you need help.'
  };
  set('#activity-application-title', application ? `Application ${status.toLowerCase()}` : 'No application in progress');
  set('#activity-application-description', application ? applicationMessages[application.status] || 'Your application updates will appear here.' : 'Start an application to keep your requested amount, documents and progress together.');
  set('#activity-application-status', status);
  set('#activity-application-amount', application ? `R${application.requested_amount}` : 'Not selected');
  set('#activity-document-count', documentCount === null ? (activeSession ? 'Unable to load uploads' : 'Sign in to view your uploads') : `${documentCount} document${documentCount === 1 ? '' : 's'} uploaded`);
  const hasDraft = application?.status === 'draft';
  const awaitingUpdate = application && ['submitted', 'under_review', 'approved', 'declined', 'disbursed', 'cancelled'].includes(application.status);
  const needsStudentUpdate = application?.status === 'action_required';
  const nextStep = hasDraft ? Number(application.current_step) : 2;
  const nextDestination = nextStep >= 3 ? 'prepare' : 'application';
  for (const selector of ['#activity-continue-button', '#activity-empty-state button']) {
    const button = document.querySelector(selector);
    if (!button) continue;
    button.dataset.go = needsStudentUpdate ? 'prepare' : awaitingUpdate ? 'activity' : nextDestination;
    button.dataset.stepGo = String(nextStep);
    const text = needsStudentUpdate ? 'Upload requested updates' : hasDraft ? (nextStep >= 3 ? 'Continue to documents' : 'Continue application') : awaitingUpdate ? 'View updates' : application ? 'View application update' : 'Start application';
    button.firstChild.textContent = text + ' ';
  }
  renderApplicationJourney(application);
}
function renderApplicationJourney(application = activeApplication) {
  const list = document.querySelector('#application-journey-steps');
  const title = document.querySelector('#overview-apply-title');
  const description = document.querySelector('#journey-description');
  const statusPill = document.querySelector('#journey-status');
  const button = document.querySelector('#overview-application-button');
  const note = document.querySelector('#overview-application-cta-note');
  const meter = document.querySelector('.journey-meter');
  const confirmation = document.querySelector('#application-submitted-confirmation');
  if (!list || !button) return;

  const profileFields = ['first_name', 'last_name', 'hometown', 'home_address', 'phone', 'personal_email', 'next_of_kin_name', 'next_of_kin_phone', 'referral_source'];
  const profileReady = Boolean(activeProfile?.profile_consent_at && profileFields.every(key => String(activeProfile[key] || '').trim()));
  const docsReady = requiredDocumentTypes.every(type => uploadedDocumentTypes.has(type));
  const sent = Boolean(application && ['submitted', 'under_review', 'approved', 'declined', 'disbursed', 'cancelled'].includes(application.status));
  const status = application?.status || '';
  let titleText = 'A clear next step.';
  let descriptionText = 'Your progress is saved here, so you can continue whenever you’re ready.';
  let statusText = activeSession ? 'Getting started' : 'Sign in to begin';
  let action = !activeSession ? 'profile' : !profileReady ? 'profile' : !application ? 'amount' : status === 'action_required' ? 'activity' : sent ? 'activity' : docsReady ? 'review' : 'documents';
  let actionText = !activeSession ? 'Sign in to continue' : !profileReady ? 'Complete your profile' : !application ? 'Choose an amount' : status === 'action_required' ? 'View requested update' : sent ? 'View application update' : docsReady ? 'Review and submit' : 'Continue to documents';
  let actionNote = !activeSession ? 'Sign in to save your application to your account.' : !profileReady ? 'Add your student and contact details before you apply.' : !application ? 'Choose the amount you need. You can change it before submitting.' : status === 'action_required' ? 'Read Buddy’s note first, then update the requested information.' : sent ? 'Your latest status and next steps are in Activity.' : docsReady ? 'Your documents are in. Check your details and repayment estimate before submitting.' : `Your R${application.requested_amount} amount is saved. Upload the four required documents to continue.`;

  const rows = [
    { id: 'profile', title: 'Complete your profile', detail: 'Your name, contact details and home address', done: profileReady, current: !profileReady },
    { id: 'amount', title: 'Choose your amount', detail: application ? `R${application.requested_amount} requested` : 'Choose from R100 to R700', done: Boolean(application), current: profileReady && !application },
    { id: 'documents', title: 'Upload your documents', detail: application ? `${uploadedDocumentTypes.size} of 4 required types uploaded` : 'ID, registration, residence and bank statements', done: sent || docsReady, current: Boolean(application && !sent && !docsReady) },
    { id: 'review', title: 'Check and submit', detail: 'Confirm your details, bursary and repayment estimate', done: sent, current: Boolean(application && !sent && docsReady && profileReady) },
    { id: 'decision', title: 'Buddy review and next steps', detail: 'Review, affordability assessment and any offer update', done: ['declined', 'cancelled', 'disbursed'].includes(status), current: sent && ['submitted', 'under_review', 'action_required', 'approved'].includes(status) }
  ];
  if (!activeSession) {
    rows[0].detail = 'Sign in, then add your personal details';
    rows[0].current = true;
  } else if (!application && profileReady) {
    rows[1].current = true;
  }
  if (status === 'action_required') {
    rows[2].done = false;
    rows[2].current = true;
    rows[2].detail = 'Buddy has requested an update';
    rows[3].done = false;
    rows[3].current = false;
  }
  if (status === 'submitted' || status === 'under_review') {
    rows[4].detail = 'Buddy is reviewing your application';
    titleText = 'Your application is with Buddy.';
    descriptionText = 'We’ll post the decision or any requested update in Activity.';
    statusText = status === 'submitted' ? 'Submitted' : 'In review';
  } else if (status === 'approved') {
    rows[4].title = 'Offer and debit-order mandate';
    rows[4].detail = 'Buddy will provide both for you to review';
    titleText = 'Your application is approved.';
    descriptionText = 'Buddy will show the written offer and debit-order mandate here for you to review. Nothing is collected until you accept.';
    statusText = 'Approved';
  } else if (status === 'action_required') {
    titleText = 'One update is needed.';
    descriptionText = 'Open Buddy’s update to see what needs attention, then return to your application.';
    statusText = 'Action needed';
  } else if (status === 'declined') {
    titleText = 'Your application is complete.';
    descriptionText = 'See the latest decision and any message from Buddy in Activity.';
    statusText = 'Closed';
  } else if (status === 'cancelled') {
    titleText = 'This application is closed.';
    descriptionText = 'Your application history and the latest update remain available in Activity.';
    statusText = 'Closed';
  } else if (status === 'disbursed') {
    rows[4].title = 'Loan disbursed';
    rows[4].detail = 'Follow loan and repayment updates in Activity';
    titleText = 'Your loan is active.';
    descriptionText = 'Your disbursement and repayment updates are available in Activity.';
    statusText = 'Disbursed';
  } else if (application) {
    titleText = docsReady ? 'Your documents are ready to review.' : 'Continue where you left off.';
    descriptionText = docsReady ? 'Check your personal details and repayment estimate before you submit.' : 'Your selected amount is saved. Complete your documents when you’re ready.';
    statusText = docsReady ? 'Ready to review' : 'In progress';
  } else if (!activeSession) {
    titleText = 'Start your Buddy application.';
    descriptionText = 'Sign in, choose an amount and follow each step from your account.';
  } else if (!profileReady) {
    titleText = 'First, complete your profile.';
    descriptionText = 'We’ll keep your details with your account so you can return to your application.';
    statusText = 'Profile needed';
  } else {
    titleText = 'Your next step is choosing an amount.';
    descriptionText = 'Your application, documents and updates will stay connected here.';
  }
  title.textContent = titleText;
  description.textContent = descriptionText;
  statusPill.textContent = statusText;
  note.textContent = actionNote;
  button.dataset.journeyAction = action;
  button.firstChild.textContent = `${actionText} `;
  const completeCount = rows.filter(row => row.done).length;
  const progressValue = sent ? (status === 'disbursed' || status === 'declined' || status === 'cancelled' ? 5 : 4) : completeCount;
  meter.setAttribute('aria-valuenow', String(progressValue));
  document.querySelector('#journey-meter-fill').style.width = `${progressValue * 20}%`;
  statusPill.className = `journey-status${status === 'action_required' ? ' is-action' : sent && status !== 'action_required' ? ' is-live' : ''}`;
  if (confirmation) {
    const showConfirmation = ['submitted', 'under_review'].includes(status);
    confirmation.hidden = !showConfirmation;
    if (showConfirmation) {
      document.querySelector('#submission-confirmation-title').textContent = status === 'submitted' ? 'Your application is with Buddy.' : 'Buddy is reviewing your application.';
      document.querySelector('#submission-confirmation-copy').textContent = status === 'submitted'
        ? 'We’ll review your documents and affordability. If anything else is needed, the next step will appear here in Activity.'
        : 'There’s nothing you need to do right now. Check Activity for a decision or a request for more information.';
      document.querySelector('#submission-confirmation-amount').textContent = `R${Number(application?.requested_amount || 0).toLocaleString('en-ZA')}`;
    }
  }
  list.replaceChildren(...rows.map((row, index) => {
    const item = document.createElement('li');
    item.className = `journey-step${row.done ? ' is-complete' : ''}${row.current ? ' is-current' : ''}`;
    const task = document.createElement('button');
    task.type = 'button'; task.dataset.journeyAction = row.id;
    task.setAttribute('aria-label', `${row.title}. ${row.done ? 'Complete' : row.current ? 'Current step' : 'Up next'}. ${row.detail}`);
    const number = document.createElement('span'); number.className = 'journey-step-number'; number.textContent = row.done ? '✓' : String(index + 1).padStart(2, '0');
    const copy = document.createElement('span'); copy.className = 'journey-step-copy';
    const name = document.createElement('strong'); name.textContent = row.title;
    const detail = document.createElement('small'); detail.textContent = row.detail;
    const state = document.createElement('span'); state.className = 'journey-step-state'; state.textContent = row.done ? 'Complete' : row.current ? (row.id === 'decision' ? statusText : 'Next step') : 'Up next';
    const arrow = document.createElement('span'); arrow.className = 'journey-step-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
    copy.append(name, detail); task.append(number, copy, state, arrow); item.append(task); return item;
  }));
}
async function loadAccountWorkspace() {
  const request = ++accountWorkspaceRequest;
  const activityStatus = document.querySelector('#activity-load-status');
  const loanTitle = document.querySelector('#overview-loan-title');
  const loanDescription = document.querySelector('#overview-loan-description');
  if (loanTitle) loanTitle.textContent = activeSession ? 'Checking loan history…' : 'No active loan';
  if (loanDescription) loanDescription.textContent = activeSession ? 'Checking for a Buddy loan disbursed to your account.' : 'Your current loan and its progress will appear here after a loan is disbursed.';
  if (!activeSession || !window.BuddyAuth?.getActivityEvents) {
    if (activityStatus) activityStatus.textContent = 'Sign in to see your account updates.';
    renderActivityFeed([], 'activity-feed', 'activity-empty-state');
    renderActivityFeed([], 'overview-activity-feed', 'overview-activity-empty', 3);
    updateApplicationSummary(null, null);
    return;
  }
  if (activityStatus) activityStatus.textContent = 'Loading your account updates…';
  let applicationResult, activityResult, documentResult, loanResult;
  try {
    [applicationResult, activityResult, documentResult, loanResult] = await Promise.all([
      window.BuddyAuth.getCurrentApplication(),
      window.BuddyAuth.getActivityEvents(),
      window.BuddyAuth.listDocuments(),
      window.BuddyAuth.getLoanHistory()
    ]);
  } catch {
    if (request !== accountWorkspaceRequest) return;
    if (activityStatus) activityStatus.textContent = 'We couldn’t load your updates. Check your connection and refresh.';
    if (loanTitle) loanTitle.textContent = 'Loan history unavailable';
    if (loanDescription) loanDescription.textContent = 'We couldn’t check your disbursement history right now.';
    return;
  }
  if (request !== accountWorkspaceRequest) return;
  activeApplication = applicationResult.error ? null : applicationResult.data;
  renderApplicationReview();
  if (activeApplication && (activeSection === 'prepare' || (activeSection === 'application' && activeStep === 3))) loadStudentDocuments();
  updateDocumentWorkflowVisibility();
  if (activeApplication?.status === 'draft' && Number(amountRange?.value) !== activeApplication.requested_amount) {
    amountRange.value = String(activeApplication.requested_amount);
    amountRange.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const uploadedDocuments = documentResult.error ? null : (documentResult.data || []).filter(file => file.name && !file.name.startsWith('.')).length;
  updateApplicationSummary(activeApplication, uploadedDocuments);
  if (applicationResult.error) {
    const appStatus = document.querySelector('#overview-application-status');
    const appHint = document.querySelector('#overview-application-hint');
    const appTitle = document.querySelector('#activity-application-title');
    const appDescription = document.querySelector('#activity-application-description');
    if (appStatus) appStatus.textContent = 'Unavailable';
    if (appHint) appHint.textContent = 'Refresh to check your saved progress';
    if (appTitle) appTitle.textContent = 'Couldn’t load application';
    if (appDescription) appDescription.textContent = 'We couldn’t check your saved application right now.';
  }
  const events = activityResult.error ? [] : activityResult.data || [];
  renderActivityFeed(events, 'activity-feed', 'activity-empty-state');
  renderActivityFeed(events, 'overview-activity-feed', 'overview-activity-empty', 3);
  if (activityResult.error) {
    const activityEmpty = document.querySelector('#activity-empty-state');
    const overviewEmpty = document.querySelector('#overview-activity-empty');
    if (activityEmpty) activityEmpty.hidden = true;
    if (overviewEmpty) {
      overviewEmpty.hidden = false;
      overviewEmpty.textContent = 'We couldn’t load your updates right now.';
    }
  } else if (!events.length) {
    const overviewEmpty = document.querySelector('#overview-activity-empty');
    if (overviewEmpty) overviewEmpty.textContent = 'Your document and application updates will appear here.';
  }
  if (activityStatus) {
    if (activityResult.error) activityStatus.textContent = ['42P01', 'PGRST205'].includes(activityResult.error.code)
      ? 'Your account updates aren’t available yet. Please try again later.'
      : 'We couldn’t load your updates. Check your connection and refresh.';
    else activityStatus.textContent = events.length ? `${events.length} recent account update${events.length === 1 ? '' : 's'}` : '';
  }
  if (loanResult.error) {
    if (loanTitle) loanTitle.textContent = 'Loan history unavailable';
    if (loanDescription) loanDescription.textContent = 'We couldn’t check your disbursement history right now.';
  } else if (loanResult.data?.length) {
    const latest = loanResult.data[0];
    if (loanTitle) loanTitle.textContent = 'Latest loan disbursed';
    if (loanDescription) loanDescription.textContent = `${formatRand(latest.principal_amount)} disbursed ${displayActivityDate(latest.disbursed_at)}. Repayment details will appear when they’re recorded.`;
  } else {
    if (loanTitle) loanTitle.textContent = 'No active loan';
    if (loanDescription) loanDescription.textContent = 'Your current loan and its progress will appear here after a loan is disbursed.';
  }
}
async function connectActivityRealtime() {
  const request = ++activityWatchRequest;
  if (activityUnsubscribe) {
    activityUnsubscribe();
    activityUnsubscribe = null;
  }
  if (!activeSession || !window.BuddyAuth?.subscribeToActivity) return;
  const userId = activeSession.user?.id;
  let result;
  try {
    result = await window.BuddyAuth.subscribeToActivity(() => {
      window.clearTimeout(activityReloadTimer);
      activityReloadTimer = window.setTimeout(() => {
        loadAccountWorkspace();
        if (activeSection === 'prepare') loadStudentDocuments();
      }, 120);
    });
  } catch { return; }
  const { data, error } = result;
  if (request !== activityWatchRequest || activeSession?.user?.id !== userId) {
    data?.unsubscribe?.();
    return;
  }
  if (!error && data?.unsubscribe) activityUnsubscribe = data.unsubscribe;
}
function updateDocumentsAccess() {
  const signedIn = Boolean(activeSession);
  const gate = document.querySelector('#documents-signin-gate');
  const content = document.querySelector('#documents-authenticated');
  if (gate) gate.hidden = signedIn;
  if (content) content.hidden = !signedIn;
  if (!signedIn) {
    documentForm?.reset();
    const fileLabel = document.querySelector('#document-file-label');
    if (fileLabel) fileLabel.textContent = 'Choose a file';
    documentStatus.textContent = '';
    documentList?.replaceChildren(Object.assign(document.createElement('p'), { className: 'document-list-empty', textContent: 'Sign in to see your secure uploads.' }));
    document.querySelectorAll('[data-document-status]').forEach(badge => { badge.textContent = 'Not uploaded'; badge.className = 'doc-review-status is-missing'; });
    const progressCount = document.querySelector('#documents-progress-count');
    if (progressCount) progressCount.textContent = '0/4';
    uploadedDocumentTypes = new Set();
    updateDocumentUploadButton();
  }
  updateDocumentWorkflowVisibility();
  if (signedIn && (activeSection === 'prepare' || (activeSection === 'application' && activeStep === 3))) loadStudentDocuments();
}
function updateDocumentWorkflowVisibility() {
  const signedIn = Boolean(activeSession);
  const canPrepare = ['draft', 'action_required'].includes(activeApplication?.status);
  const startGate = document.querySelector('#documents-start-gate');
  const lockedNotice = document.querySelector('#documents-locked-notice');
  const form = document.querySelector('#document-upload-form');
  const submitPanel = document.querySelector('#application-submit-panel');
  if (startGate) startGate.hidden = !signedIn || Boolean(activeApplication);
  if (lockedNotice) lockedNotice.hidden = !signedIn || !activeApplication || canPrepare;
  if (form) form.hidden = !signedIn || !canPrepare;
  if (submitPanel) submitPanel.hidden = !signedIn || !canPrepare;
  const amountBack = document.querySelector('.documents-back');
  if (amountBack) amountBack.hidden = Boolean(activeApplication && !canPrepare);
  if (!canPrepare && signedIn) {
    const statusCopy = {
      submitted: ['Application submitted', 'Your application is with Buddy. Updates will appear in Activity.'],
      under_review: ['Application in review', 'Buddy is reviewing your application. Check Activity for updates.'],
      action_required: ['Action needed', 'Check Activity for Buddy’s request so your review can continue.'],
      approved: ['Application approved', 'Buddy will share your offer and debit-order mandate for you to review.'],
      declined: ['Application unsuccessful', 'Your application is closed. Contact Buddy if you need help.'],
      disbursed: ['Funds sent', 'Your loan and repayment updates appear in Activity.'],
      cancelled: ['Application closed', 'Contact Buddy if you need help with this application.']
    }[activeApplication?.status] || ['Application update', 'Check Activity for your latest update.'];
    const title = document.querySelector('#documents-locked-title');
    const copy = document.querySelector('#documents-locked-copy');
    if (title) title.textContent = statusCopy[0];
    if (copy) copy.textContent = statusCopy[1];
  }
  if (activeApplication && !canPrepare && activeSection === 'application' && activeStep === 3) {
    navigate('activity');
    return;
  }
  updateApplicationSubmitButton();
}
function updateApplicationSubmitButton() {
  if (!applicationReviewButton) return;
  const ready = Boolean(activeSession && activeApplication?.status === 'draft'
    && requiredDocumentTypes.every(type => uploadedDocumentTypes.has(type)));
  const canResubmit = activeApplication?.status === 'action_required'
    && requiredDocumentTypes.every(type => uploadedDocumentTypes.has(type));
  const canSubmit = ready || canResubmit;
  applicationReviewButton.disabled = !activeSession || !canSubmit;
  applicationReviewButton.firstChild.textContent = (activeApplication?.status === 'action_required' ? 'Review and resubmit ' : 'Review details ');
  if (applicationSubmitStatus && ['draft', 'action_required'].includes(activeApplication?.status)) {
    const missing = requiredDocumentTypes.filter(type => !uploadedDocumentTypes.has(type)).length;
    applicationSubmitStatus.textContent = canSubmit
      ? activeApplication.status === 'action_required' ? 'Your requested updates are uploaded. Review your details before resubmitting.' : 'All four documents are uploaded. Review your details before submitting.'
      : `Upload ${missing} more required document type${missing === 1 ? '' : 's'} to continue.`;
  }
}
function updateApplicationReviewButton() {
  if (!applicationFinalSubmitButton) return;
  const hasProfile = Boolean(activeProfile?.first_name?.trim() && activeProfile?.last_name?.trim() && activeProfile?.home_address?.trim());
  const bursaryStatus = reviewBursaryStatus?.value || '';
  const bursaryName = reviewBursaryName?.value?.trim() || '';
  const bursaryReady = bursaryStatus === 'none' || (bursaryStatus === 'using' && bursaryName.length > 0);
  const docsReady = requiredDocumentTypes.every(type => uploadedDocumentTypes.has(type));
  const applicationOpen = ['draft', 'action_required'].includes(activeApplication?.status);
  applicationFinalSubmitButton.disabled = !activeSession || !applicationOpen || !hasProfile || !reviewResidenceConfirm?.checked || !bursaryReady || !docsReady;
  if (applicationReviewSubmitStatus && !applicationReviewSubmitStatus.dataset.submitting) {
    if (!hasProfile) applicationReviewSubmitStatus.textContent = 'Complete your name and home address in your profile to continue.';
    else if (!reviewResidenceConfirm.checked) applicationReviewSubmitStatus.textContent = 'Confirm your home address above to continue.';
    else if (!bursaryStatus) applicationReviewSubmitStatus.textContent = 'Select whether you’re using a bursary.';
    else if (bursaryStatus === 'using' && !bursaryName) applicationReviewSubmitStatus.textContent = 'Enter the name of your bursary.';
    else if (!docsReady) applicationReviewSubmitStatus.textContent = 'All four required documents must be uploaded before you submit.';
    else applicationReviewSubmitStatus.textContent = '';
  }
}
function renderApplicationReview() {
  const firstName = document.querySelector('#review-first-name');
  const surname = document.querySelector('#review-surname');
  const homeAddress = document.querySelector('#review-home-address');
  const hint = document.querySelector('#review-profile-hint');
  const profileReady = Boolean(activeProfile?.first_name?.trim() && activeProfile?.last_name?.trim() && activeProfile?.home_address?.trim());
  if (firstName) firstName.textContent = activeProfile?.first_name?.trim() || (activeProfile ? 'Add your name to your profile' : 'Loading your profile…');
  if (surname) surname.textContent = activeProfile?.last_name?.trim() || (activeProfile ? 'Add your surname to your profile' : 'Loading your profile…');
  if (homeAddress) homeAddress.textContent = activeProfile?.home_address?.trim() || (activeProfile ? 'Add your current home address in your profile' : 'Loading your profile…');
  if (hint) {
    hint.hidden = profileReady;
    hint.textContent = activeProfile ? 'Some details are missing. Update your profile before you submit.' : 'We couldn’t load your profile yet. Try again or open Profile & preferences.';
  }
  if (reviewBursaryStatus && activeApplication && !reviewBursaryStatus.value && activeApplication.bursary_status) reviewBursaryStatus.value = activeApplication.bursary_status;
  if (reviewBursaryName && activeApplication && !reviewBursaryName.value && activeApplication.bursary_name) reviewBursaryName.value = activeApplication.bursary_name;
  const usingBursary = reviewBursaryStatus?.value === 'using';
  const bursaryNameField = document.querySelector('#review-bursary-name-field');
  if (bursaryNameField) bursaryNameField.hidden = !usingBursary;
  const requested = Number(activeApplication?.requested_amount || amountRange?.value || 0);
  document.querySelector('#review-requested-amount').textContent = formatRand(requested);
  const estimate = document.querySelector('#review-estimated-repayment');
  if (estimate) estimate.textContent = currentLoanHistory
    ? (document.querySelector('#estimate-total')?.textContent || 'Estimate unavailable')
    : loanHistoryState === 'loading' ? 'Checking your loan history…' : 'Confirmed in your written offer';
  updateApplicationReviewButton();
}
function updateDocumentUploadButton() {
  if (documentUploadButton) documentUploadButton.disabled = !activeSession || !['draft', 'action_required'].includes(activeApplication?.status) || !documentConsent?.checked || !documentInput?.files?.length;
}
async function loadStudentDocuments() {
  if (!documentList || !activeSession || !window.BuddyAuth?.listDocuments) return;
  documentList.replaceChildren(Object.assign(document.createElement('p'), { className: 'document-list-empty', textContent: 'Loading your documents…' }));
  try {
    const { data, error } = await window.BuddyAuth.listDocuments();
    if (error) throw error;
    const files = (data || []).filter(file => file.name && !file.name.startsWith('.')).filter(file => /^[a-z_]+-[0-9a-f-]+\.(pdf|jpg|png)$/i.test(file.name));
    const currentApplicationFiles = files.filter(file => file.review?.application_id === activeApplication?.id);
    const latestByType = new Map();
    for (const file of currentApplicationFiles) {
      const type = file.name.match(/^([a-z_]+)-/)?.[1];
      if (documentLabels[type] && !latestByType.has(type)) latestByType.set(type, file.review?.review_status || 'status_unavailable');
    }
    uploadedDocumentTypes = new Set(files
      .filter(file => file.review?.application_id === activeApplication?.id)
      .filter(file => ['pending', 'reviewing', 'accepted'].includes(file.review?.review_status))
      .map(file => file.name.match(/^([a-z_]+)-/)?.[1])
      .filter(type => documentLabels[type]));
    updateApplicationSubmitButton();
    renderApplicationJourney(activeApplication);
    let uploadedCount = 0;
    document.querySelectorAll('[data-document-status]').forEach(badge => {
      const status = latestByType.get(badge.dataset.documentStatus) || 'missing';
      const labels = { ...reviewStatusLabels, missing: 'Not uploaded', status_unavailable: 'Status unavailable' };
      badge.textContent = labels[status] || 'Status unavailable';
      badge.className = `doc-review-status is-${status}`;
      if (uploadedDocumentTypes.has(badge.dataset.documentStatus)) uploadedCount++;
    });
    document.querySelector('#documents-progress-count').textContent = `${uploadedCount}/4`;
    documentList.replaceChildren();
    if (!files.length) {
      documentList.append(Object.assign(document.createElement('p'), { className: 'document-list-empty', textContent: 'No documents uploaded yet.' }));
      return;
    }
    for (const file of files) {
      const match = file.name.match(/^([a-z_]+)-([0-9a-f-]+)\.(pdf|jpg|png)$/i);
      const type = match?.[1];
      if (!documentLabels[type]) continue;
      const row = document.createElement('div'); row.className = 'document-upload-row';
      const description = document.createElement('span'); description.className = 'document-upload-description';
      const title = document.createElement('strong'); title.textContent = documentLabels[type];
      const meta = document.createElement('small');
      const created = file.created_at ? new Date(file.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Uploaded';
      const size = Number(file.metadata?.size);
      meta.textContent = `${created}${size ? ` · ${(size / 1024 / 1024).toFixed(1)} MB` : ''}`;
      const status = file.review?.review_status || 'status_unavailable';
      const statusPill = document.createElement('span'); statusPill.className = `document-upload-state is-${status}`; statusPill.textContent = reviewStatusLabels[status] || 'Status unavailable';
      description.append(title, statusPill, meta);
      if (status === 'action_required' && file.review?.review_note) {
        const note = document.createElement('small'); note.className = 'document-review-note'; note.textContent = `Please update: ${file.review.review_note}`; description.append(note);
      }
      const actions = document.createElement('span'); actions.className = 'document-upload-actions';
      const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Open'; download.addEventListener('click', async () => {
        download.disabled = true;
        try { const result = await window.BuddyAuth.downloadDocument(`${activeSession.user.id}/${file.name}`); if (result.error) throw result.error; const url = URL.createObjectURL(result.data); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Buddy-Loans-${type}.${match[3]}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        catch { documentStatus.textContent = 'We couldn’t open that file. Refresh and try again.'; }
        finally { download.disabled = false; }
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', async () => {
        if (!window.confirm(`Remove your ${documentLabels[type].toLowerCase()} from secure uploads?`)) return;
        remove.disabled = true;
        try { const result = await window.BuddyAuth.deleteDocument(`${activeSession.user.id}/${file.name}`); if (result.error) throw result.error; documentStatus.textContent = 'Document removed.'; await loadStudentDocuments(); await loadAccountWorkspace(); }
        catch { remove.disabled = false; documentStatus.textContent = 'We couldn’t remove that file. Please try again.'; }
      });
      actions.append(download, remove); row.append(description, actions); documentList.append(row);
    }
  } catch (error) {
    const trackingNotReady = ['42P01', 'PGRST205'].includes(error?.code);
    documentList.replaceChildren(Object.assign(document.createElement('p'), { className: 'document-list-empty', textContent: trackingNotReady ? 'Document review tracking is not configured yet. Run the student document review status SQL migration, then refresh.' : 'We couldn’t load your document status. Check your connection and refresh.' }));
  }
}
const profileDialog = document.querySelector('#profile-settings-dialog');
const profileOpenButton = document.querySelector('#profile-open-button');
const accountDialog = document.querySelector('#account-dialog');
const profileEditForm = document.querySelector('#profile-edit-form');
const profileEditMessage = document.querySelector('#profile-edit-message');
const preferencesMessage = document.querySelector('#preference-save-message');
const profilePreferenceTab = document.querySelector('#profile-tab-preferences');
const profileDetailsTab = document.querySelector('#profile-tab-details');
const profileDetailsPanel = document.querySelector('#profile-edit-form');
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
  profileOpenButton.setAttribute('aria-label', `Signed in as ${name}. Open profile and preferences`);
  updateProfileControl();
  fillProfileSettings(profile);
  renderApplicationReview();
  renderApplicationJourney(activeApplication);
});
window.addEventListener('buddy-auth-ready', async event => {
  authReady = true;
  activeSession = event.detail?.session || null;
  updateProfileControl();
  updateDocumentsAccess();
  renderApplicationReview();
  loadAccountWorkspace();
  connectActivityRealtime();
  if (activeSession && window.BuddyAuth?.getLoanHistory) refreshLoanHistory();
  else window.BuddyLoansDashboard?.setAccountContext({ authenticated: false });
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
    updateDocumentsAccess();
    renderApplicationReview();
    activityUnsubscribe?.();
    activityUnsubscribe = null;
    activityWatchRequest++;
    window.BuddyLoansDashboard?.setAccountContext({ authenticated: false });
    activeApplication = null;
    loadAccountWorkspace();
    if (profileDialog.open) profileDialog.close();
  } else if (event.detail?.session) {
    activeSession = event.detail.session;
    authReady = true;
    updateProfileControl();
    updateDocumentsAccess();
    renderApplicationReview();
    loadAccountWorkspace();
    connectActivityRealtime();
    if (window.BuddyAuth?.getLoanHistory) refreshLoanHistory();
  }
});
document.querySelector('#documents-signin-button')?.addEventListener('click', () => {
  if (!accountDialog.open) accountDialog.showModal();
  document.querySelector('#auth-login-tab')?.click();
});
documentForm?.addEventListener('change', updateDocumentUploadButton);
documentInput?.addEventListener('change', () => {
  documentStatus.textContent = '';
  const file = documentInput.files?.[0];
  if (file && (file.size > 10 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))) {
    documentStatus.textContent = 'Choose a PDF, JPG or PNG file under 10 MB.';
    documentInput.value = '';
  }
  const fileLabel = document.querySelector('#document-file-label');
  if (fileLabel) fileLabel.textContent = documentInput.files?.[0]?.name || 'Choose a file';
  updateDocumentUploadButton();
});
documentForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const file = documentInput.files?.[0];
  if (!activeSession || !file || !documentConsent.checked) return;
  documentUploadButton.disabled = true;
  documentUploadButton.textContent = 'Uploading…';
  documentStatus.textContent = '';
  try {
    const { error } = await window.BuddyAuth.uploadDocument(document.querySelector('#document-type').value, file, activeApplication?.id || null);
    if (error) throw error;
    documentForm.reset();
    document.querySelector('#document-file-label').textContent = 'Choose a file';
    documentStatus.textContent = 'Uploaded securely to your account.';
    await loadStudentDocuments();
    await loadAccountWorkspace();
  } catch (error) {
    documentStatus.textContent = error?.message?.includes('10 MB') ? error.message
      : ['42P01', 'PGRST205'].includes(error?.code) ? 'Status tracking isn’t configured yet, so the document was not kept. Ask the Buddy Loans team to run the review-status SQL migration.'
        : 'We couldn’t upload this file. Check your connection and storage setup, then try again.';
  } finally {
    documentUploadButton.replaceChildren(document.createTextNode('Upload securely '));
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-arrow'); arrow.append(use); documentUploadButton.append(arrow);
    updateDocumentUploadButton();
  }
});
applicationReviewButton?.addEventListener('click', async () => {
  if (applicationReviewButton.disabled) return;
  if (!activeProfile && window.BuddyAuth?.getProfile) {
    applicationReviewButton.disabled = true;
    applicationSubmitStatus.textContent = 'Loading your profile…';
    const { data } = await window.BuddyAuth.getProfile();
    if (data) window.dispatchEvent(new CustomEvent('buddy-profile-ready', { detail: { profile: { ...data, display_name: `${data.first_name} ${data.last_name}`.trim() } } }));
  }
  applicationSubmitStatus.textContent = '';
  navigate('application', 3);
  renderApplicationReview();
});
applicationFinalSubmitButton?.addEventListener('click', async () => {
  if (applicationFinalSubmitButton.disabled) return;
  applicationFinalSubmitButton.disabled = true;
  applicationReviewSubmitStatus.dataset.submitting = 'true';
  applicationReviewSubmitStatus.textContent = 'Submitting your application…';
  try {
    const bursaryStatus = reviewBursaryStatus.value;
    const bursaryName = bursaryStatus === 'using' ? reviewBursaryName.value.trim() : null;
    const { data, error } = await window.BuddyAuth.submitApplication({
      bursaryStatus,
      bursaryName,
      residenceConfirmed: reviewResidenceConfirm.checked
    });
    if (error) throw error;
    activeApplication = Array.isArray(data) ? data[0] : data;
    if (!activeApplication) throw new Error('No application was returned');
    applicationReviewSubmitStatus.textContent = 'Application submitted. Buddy will post your next update in Activity.';
    await loadAccountWorkspace();
    updateDocumentWorkflowVisibility();
    navigate('activity');
  } catch (error) {
    const message = error?.code === '23514'
      ? (error.message?.includes('profile') ? 'Complete your name and home address in Profile & preferences before submitting.' : 'Please confirm your home address and upload all four required document types before submitting.')
      : error?.code === '42883'
        ? 'Application submission needs a database update before it can be completed. Please contact Buddy Loans.'
        : 'We couldn’t submit your application. Check your connection and try again.';
    applicationReviewSubmitStatus.dataset.submitting = '';
    updateApplicationReviewButton();
    applicationReviewSubmitStatus.textContent = message;
  }
});
reviewBursaryStatus?.addEventListener('change', () => { renderApplicationReview(); });
reviewBursaryName?.addEventListener('input', updateApplicationReviewButton);
reviewResidenceConfirm?.addEventListener('change', updateApplicationReviewButton);
document.querySelector('#review-edit-profile')?.addEventListener('click', () => profileOpenButton.click());
document.querySelector('#review-back-documents')?.addEventListener('click', () => navigate('prepare'));
document.querySelector('#review-change-amount')?.addEventListener('click', () => navigate('application', 2));
document.querySelector('#document-refresh-button')?.addEventListener('click', loadStudentDocuments);
document.querySelector('#activity-refresh-button')?.addEventListener('click', loadAccountWorkspace);
profileOpenButton.addEventListener('click', async () => {
  if (!authReady || !activeSession) {
    if (!accountDialog.open) accountDialog.showModal();
    document.querySelector('#auth-login-tab')?.click();
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
  if (button.dataset.journeyAction) {
    runJourneyAction(button.dataset.journeyAction);
    return;
  }
  navigate(button.dataset.go, Number(button.dataset.stepGo) || 1);
}));
function runJourneyAction(action) {
  if (action === 'profile') { profileOpenButton.click(); return; }
  if (action === 'amount') { navigate('application', 2); return; }
  if (action === 'documents') { navigate('prepare'); return; }
  if (action === 'review') {
    if (activeApplication?.status === 'action_required' && !uploadedDocumentTypes.size) { navigate('activity'); return; }
    navigate('application', 3);
    return;
  }
  if (action === 'decision') navigate('activity');
}
document.querySelector('#application-journey-steps')?.addEventListener('click', event => {
  const task = event.target.closest('[data-journey-action]');
  if (task) runJourneyAction(task.dataset.journeyAction);
});
document.querySelectorAll('[data-view-link]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  if (link.dataset.viewLink === 'application') {
    if (activeApplication?.status === 'action_required') {
      navigate('prepare');
      return;
    }
    const waitingOnBuddy = activeApplication && ['submitted', 'under_review', 'approved'].includes(activeApplication.status);
    if (waitingOnBuddy) {
      navigate('activity');
      return;
    }
    // Apply always opens the amount selector so students can revise a saved request.
    navigate('application', 2);
    return;
  }
  navigate(link.dataset.viewLink);
}));
window.addEventListener('hashchange', () => renderRoute({ focus: true, scroll: true }));
window.addEventListener('popstate', () => renderRoute({ focus: true, scroll: true }));
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

const amountRange = document.querySelector('#amount-range');
const amountOutput = document.querySelector('#amount-output');
const reviewAmount = document.querySelector('#review-amount');
function formatRand(value) { return `R${Math.round(value).toLocaleString('en-ZA')}`; }
let currentLoanHistory = null;
let loanHistoryState = 'loading';
let loanHistoryRequest = 0;
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
    label.textContent = loanHistoryState === 'signed-out' ? 'SIGN IN REQUIRED' : loanHistoryState === 'error' || loanHistoryState === 'setup' ? 'HISTORY UNAVAILABLE' : 'CHECKING ACCOUNT';
    document.querySelector('#estimate-caption').textContent = loanHistoryState === 'error'
      ? 'We couldn’t load your loan history'
      : loanHistoryState === 'setup'
        ? 'We couldn’t verify prior loans'
      : loanHistoryState === 'signed-out'
        ? 'Sign in to see your repayment estimate'
        : 'Checking your Buddy loan history';
    total.textContent = '—';
    breakdown.hidden = true;
    legal.hidden = true;
    note.hidden = false;
    note.textContent = loanHistoryState === 'error'
      ? 'Your estimate is temporarily unavailable. Please refresh this page and try again.'
      : loanHistoryState === 'setup'
        ? 'We can’t show an interest rate or repayment total until your Buddy loan history can be checked. Please try again later.'
      : loanHistoryState === 'signed-out'
        ? 'Sign in to check whether this is your first Buddy loan this calendar year and see the matching estimate.'
        : 'We’re checking whether a Buddy loan was disbursed to you earlier this calendar year.';
    return;
  }
  const repeat = currentLoanHistory === 'repeat';
  const { interestRate, interest, initiation, service, total: repaymentTotal } = calculateEstimate(amount, repeat);
  label.textContent = repeat ? 'REPEAT LOAN THIS YEAR' : 'FIRST LOAN THIS YEAR';
  document.querySelector('#estimate-caption').textContent = 'Total due if approved';
  document.querySelector('#quote-principal').textContent = formatRand(amount);
  document.querySelector('#quote-interest-label').textContent = `Interest · ${Math.round(interestRate * 100)}%`;
  document.querySelector('#quote-interest').textContent = formatRand(interest);
  document.querySelector('#quote-initiation').textContent = formatRand(initiation);
  document.querySelector('#quote-service').textContent = formatRand(service);
  total.textContent = formatRand(repaymentTotal);
  document.querySelector('#quote-total').textContent = total.textContent;
  breakdown.hidden = false;
  legal.hidden = false;
  note.hidden = true;
}
async function refreshLoanHistory() {
  const request = ++loanHistoryRequest;
  loanHistoryState = 'loading';
  currentLoanHistory = null;
  updateEstimate(Number(amountRange.value));
  try {
    const { data, error } = await window.BuddyAuth.getLoanHistory();
    if (request !== loanHistoryRequest) return;
    if (error || !Array.isArray(data)) {
      loanHistoryState = ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error?.code) ? 'setup' : 'error';
      updateEstimate(Number(amountRange.value));
      return;
    }
    loanHistoryState = 'loaded';
    window.BuddyLoansDashboard?.setAccountContext({
      authenticated: true,
      loans: data.map(row => ({ status: 'disbursed', disbursedAt: row.disbursed_at }))
    });
  } catch {
    if (request !== loanHistoryRequest) return;
    loanHistoryState = 'error';
    updateEstimate(Number(amountRange.value));
  }
}
window.BuddyLoansDashboard = Object.freeze({
  setAccountContext(account) {
    currentLoanHistory = deriveLoanHistory(account);
    if (!account?.authenticated) loanHistoryState = 'signed-out';
    updateEstimate(Number(amountRange.value));
    renderApplicationReview();
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
async function persistApplicationProgress(nextStep) {
  if (!activeSession || !window.BuddyAuth?.saveDraftApplication) throw new Error('Sign in to save your application.');
  const { data, error } = await window.BuddyAuth.saveDraftApplication(
    activeApplication?.status === 'draft' ? activeApplication.id : null,
    Number(amountRange.value),
    nextStep
  );
  if (error || !data) throw error || new Error('Your application was not saved.');
  activeApplication = data;
  await loadAccountWorkspace();
}
function renderStep(step) {
  activeStep = step;
  const nextButton = document.querySelector('#next-step');
  const controls = document.querySelector('.application-controls');
  nextButton.dataset.finished = 'false';
  document.querySelectorAll('[data-application-step]').forEach(panel => {
    panel.hidden = Number(panel.dataset.applicationStep) !== activeStep;
  });
  const amountStage = activeStep === 2;
  const reviewStage = activeStep === 3;
  if (controls) controls.hidden = reviewStage;
  document.querySelector('#step-label').textContent = amountStage ? 'Choose an amount' : reviewStage ? 'Review your details' : 'Account access';
  document.querySelector('#step-count').textContent = amountStage ? 'Step 1 of 3' : reviewStage ? 'Step 3 of 3' : 'Account access';
  document.querySelector('#step-index').textContent = amountStage ? '01 / 03' : reviewStage ? '03 / 03' : 'ACCOUNT';
  document.querySelector('#step-description').textContent = amountStage
    ? 'Choose the amount you need. Next, upload your documents and review everything before you submit.'
    : reviewStage ? 'Confirm your details, bursary and amount before sending your application.'
      : 'Sign in to your student account before continuing.';
  const heading = document.querySelector('#plan-title');
  heading.replaceChildren(document.createTextNode(amountStage ? 'Choose an ' : reviewStage ? 'Review your ' : 'Create your '));
  const accent = document.createElement('em');
  accent.textContent = amountStage ? 'amount.' : reviewStage ? 'application.' : 'student account.';
  heading.append(accent);
  const progressTrack = document.querySelector('.application-intro .progress-track');
  progressTrack.setAttribute('aria-valuenow', amountStage ? '1' : reviewStage ? '3' : '0');
  progressTrack.setAttribute('aria-valuemax', '3');
  progressTrack.setAttribute('aria-valuetext', amountStage ? 'Step 1 of 3' : reviewStage ? 'Step 3 of 3' : 'Account access');
  document.querySelector('#progress-fill').style.width = amountStage ? '33.333%' : reviewStage ? '100%' : '0%';
  document.querySelector('#back-step').disabled = false;
  document.querySelector('#back-step').textContent = reviewStage ? '← Back to documents' : amountStage ? '← Back' : '← Back';
  document.querySelector('#back-step').setAttribute('aria-label', reviewStage ? 'Back to documents' : 'Back to previous step');
  nextButton.innerHTML = (amountStage ? 'Continue to documents' : 'Open account access') + ' <svg><use href="#i-arrow"/></svg>';
  if (reviewStage) renderApplicationReview();
  const appStatus = document.querySelector('#application-status');
  appStatus.classList.remove('completion-note');
  appStatus.textContent = amountStage
    ? 'Your amount is saved when you continue. You can return here from Docs to change it.'
    : reviewStage ? 'Your application is submitted only after you confirm the details below.'
      : 'Sign in with your SPU email to continue with your application.';
}

document.querySelector('#back-step').addEventListener('click', () => navigate(activeStep === 3 ? 'prepare' : activeStep === 2 ? 'overview' : 'overview'));
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
    navigate('application', 2);
    return;
  }
  if (next.dataset.finished === 'true') {
    navigate('overview');
    return;
  }
  if (activeApplication && activeApplication.status !== 'draft') {
    navigate('activity');
    return;
  }
  next.disabled = true;
  status.textContent = 'Saving your amount…';
  try {
    await persistApplicationProgress(3);
  } catch {
    status.textContent = 'We couldn’t save your amount. Check your connection and try again.';
    next.disabled = false;
    return;
  }
  next.disabled = false;
  navigate('prepare');
});

renderRoute();
