(() => {
  'use strict';
  const config = window.BuddyConfig;
  const sdk = window.supabase;
  const byId = id => document.getElementById(id);
  const loginPanel = byId('ops-login-panel');
  const workspace = byId('ops-workspace');
  const loginForm = byId('ops-login-form');
  const mfaForm = byId('ops-mfa-form');
  const enrollPanel = byId('ops-enroll-panel');
  const enrollForm = byId('ops-enroll-form');
  const authMessage = byId('ops-auth-message');
  const signOut = byId('ops-signout');
  let client = null;
  let selectedApplicationId = null;
  let currentStaffId = null;
  let currentRole = null;
  let queueOffset = 0;
  let queueHasNext = false;
  let mfaChallenge = null;
  let pendingFactorId = null;
  let searchTimer = 0;
  let userSearchTimer = 0;
  let userOffset = 0;
  let auditOffset = 0;
  let auditHasNext = false;
  let auditRows = [];
  let selectedUserId = null;
  const statusNames = { submitted:'Submitted', under_review:'In review', action_required:'Needs action', approved:'Approved', declined:'Unsuccessful', disbursed:'Disbursed', cancelled:'Cancelled', pending:'Pending', reviewing:'In review', accepted:'Accepted' };
  const esc = value => String(value ?? '—');
  const formatDate = value => { if (!value) return '—'; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-ZA',{dateStyle:'medium',timeStyle:'short'}).format(date) : '—'; };
  function setMessage(node, message, isError = false) { node.textContent = message || ''; node.classList.toggle('is-error', isError); }
  function el(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; }
  function errorMessage(error, fallback) {
    if (['42501','42883','PGRST202'].includes(error?.code)) return 'We couldn’t complete that request. Try again later.';
    return fallback || 'We couldn’t complete that request. Try again.';
  }
  function resetWorkspace() {
    loginPanel.hidden = false; workspace.hidden = true; signOut.hidden = true;
    byId('ops-session-label').textContent = 'Staff access';
    byId('ops-queue-rows').replaceChildren(); byId('ops-audit-list').replaceChildren();
    currentRole=null;currentStaffId=null;
    const empty=el('div','ops-detail-empty');empty.append(el('span','ops-detail-mark','b.'),el('h2','','Select an application'),el('p','','Applicant details and review actions appear here.'));byId('ops-detail').replaceChildren(empty);
    selectedApplicationId = null;
  }
  async function startMfaEnrollment(existingFactor = null) {
    const panel=enrollPanel, qr=byId('ops-enroll-qr'), secret=byId('ops-enroll-secret'), restart=byId('ops-enroll-restart');
    loginForm.hidden=true;mfaForm.hidden=true;panel.hidden=false;
    if (existingFactor) {
      pendingFactorId=existingFactor.id;qr.hidden=true;secret.closest('details').hidden=true;restart.hidden=false;
      setMessage(authMessage,'Enter the current code from your authenticator app.');
    } else {
      setMessage(authMessage,'Preparing your authenticator setup…');
      const {data,error}=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Buddy Operations'});
      if(error){panel.hidden=true;loginForm.hidden=false;setMessage(authMessage,'We couldn’t set up your sign-in right now. Try again later.',true);return false;}
      pendingFactorId=data.id;qr.src=data.totp.qr_code;qr.hidden=false;secret.textContent=data.totp.secret;secret.closest('details').hidden=false;restart.hidden=true;
      setMessage(authMessage,'Scan the code, then enter the six-digit number from your authenticator app.');
    }
    byId('ops-enroll-code').value='';byId('ops-enroll-code').focus();return false;
  }
  async function requireMfa() {
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    if (data.currentLevel === 'aal2') return true;
    const { data: factorsData, error: factorError } = await client.auth.mfa.listFactors();
    if (factorError) throw factorError;
    const factor = (factorsData.totp || []).find(item => item.status === 'verified');
    if (!factor) {
      const unfinished=(factorsData.totp||[]).find(item=>item.status==='unverified');
      return startMfaEnrollment(unfinished||null);
    }
    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError) throw challengeError;
    mfaChallenge = { factorId: factor.id, challengeId: challenge.id };
    loginForm.hidden = true; mfaForm.hidden = false;
    byId('ops-mfa-code').focus();
    setMessage(authMessage,'Enter the current code from your authenticator app.');
    return false;
  }
  async function showWorkspace() {
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error || !sessionResult.data.session) { resetWorkspace(); return; }
    let mfaReady=false;
    try { mfaReady = await requireMfa(); }
    catch { setMessage(authMessage,'We couldn’t continue sign-in. Try again or contact support.',true); return; }
    if (!mfaReady) return;
    const { data, error } = await client.rpc('buddy_admin_summary');
    if (error) {
      resetWorkspace();
      setMessage(authMessage,errorMessage(error,'Staff access could not be verified.'),true);
      return;
    }
    loginPanel.hidden = true; workspace.hidden = false; signOut.hidden = false;
    const { data: userData } = await client.auth.getUser(); currentStaffId = userData?.user?.id || null;
    currentRole = data.role || null;
    byId('ops-session-label').textContent = 'Verified operations session';
    byId('ops-role').textContent = String(data.role || 'Authorized staff').replaceAll('_',' ');
    byId('metric-submitted').textContent = data.submitted ?? '0';
    byId('metric-review').textContent = data.under_review ?? '0';
    byId('metric-action').textContent = data.action_required ?? '0';
    byId('metric-docs').textContent = data.pending_documents ?? '0';
    const staffPanel = byId('ops-staff-panel');
    staffPanel.hidden = currentRole !== 'owner_admin';
    byId('ops-staff-nav').hidden = currentRole !== 'owner_admin';
    const canManageUsers = ['operations_admin','owner_admin'].includes(currentRole);
    byId('ops-users-nav').hidden = !canManageUsers;
    byId('ops-activity-nav').hidden = !canManageUsers;
    byId('ops-overview-activity').hidden = !canManageUsers;
    await Promise.all([loadQueue(), canManageUsers ? loadAudit(true) : Promise.resolve(), loadDocuments(), currentRole === 'owner_admin' ? loadStaff() : Promise.resolve()]);
    setPage(window.location.hash.slice(1) || 'overview', false);
  }
  async function loadQueue() {
    const tbody = byId('ops-queue-rows');
    const empty = byId('ops-queue-empty');
    setMessage(byId('ops-queue-message'),'Loading applications…');
    const { data, error } = await client.rpc('buddy_admin_list_applications', {
      p_status: byId('ops-status-filter').value || null,
      p_query: byId('ops-search').value.trim() || null,
      p_limit: 100,
      p_offset: queueOffset
    });
    if (error) { tbody.replaceChildren(); empty.hidden = true; setMessage(byId('ops-queue-message'),errorMessage(error,'Could not load applications.'),true); return; }
    tbody.replaceChildren();
    for (const row of data || []) {
      const tr = document.createElement('tr'); tr.tabIndex = 0; tr.setAttribute('aria-selected',String(row.id === selectedApplicationId));
      const student = el('td'); student.append(el('strong','',`${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Student')); student.append(el('small','',row.email || 'No email'));
      const requested = el('td','',`R${Number(row.requested_amount || 0).toLocaleString('en-ZA')}`);
      const status = el('td'); status.append(el('span',`ops-status ${row.status}`,statusNames[row.status] || row.status));
      const updated = el('td','',formatDate(row.updated_at));
      const work = el('td');
      if (currentRole === 'application_reviewer' && !row.assigned_to) {
        const claim = el('button','ops-claim-button','Claim'); claim.type='button';
        claim.addEventListener('click',async event=>{event.stopPropagation();claim.disabled=true;const {error}=await client.rpc('buddy_admin_claim_application',{p_application_id:row.id,p_release:false});if(error){setMessage(byId('ops-queue-message'),errorMessage(error,'Could not claim this application.'),true);claim.disabled=false;return;}await Promise.all([openApplication(row.id),loadQueue(),loadAudit()]);});
        work.append(claim);
      } else work.textContent = row.assigned_to === currentStaffId ? 'Assigned to you' : '';
      tr.dataset.applicationId=row.id; tr.append(student,requested,status,updated,work);
      const open = () => openApplication(row.id);
      tr.addEventListener('click',open); tr.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
      tbody.append(tr);
    }
    empty.hidden = Boolean(data?.length);
    queueHasNext=(data?.length||0)===100;
    byId('ops-page-prev').disabled=queueOffset===0;byId('ops-page-next').disabled=!queueHasNext;byId('ops-page-label').textContent=`Page ${Math.floor(queueOffset/100)+1}`;
    setMessage(byId('ops-queue-message'),`${data?.length || 0} application${data?.length === 1 ? '' : 's'} on this page`);
  }
  function detailLine(dl, label, value) { dl.append(el('dt','',label),el('dd','',value || '—')); }
  async function openApplication(id) {
    setPage('applications');
    selectedApplicationId = id;
    const detail = byId('ops-detail'); detail.replaceChildren(el('p','ops-message','Loading application…'));
    const { data, error } = await client.rpc('buddy_admin_get_application',{p_application_id:id});
    if (error) { detail.replaceChildren(el('p','ops-message',errorMessage(error,'Could not open this application.'))); return; }
    renderDetail(data);
    for (const row of byId('ops-queue-rows').rows) row.setAttribute('aria-selected',String(row.dataset.applicationId===id));
    if (window.matchMedia('(max-width: 900px)').matches) {
      const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      detail.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});
    }
  }
  function renderDetail(data) {
    const app=data.application, student=data.student, detail=byId('ops-detail'); detail.replaceChildren();
    const header=el('header','ops-detail-head'); const top=el('div','ops-detail-head-top');
    const title=el('div'); title.append(el('span','ops-eyebrow','APPLICATION REVIEW'),el('h2','',`${student.first_name} ${student.last_name}`),el('p','',student.university_email || student.personal_email || 'Email unavailable'));
    top.append(title,el('span',`ops-status ${app.status}`,statusNames[app.status]||app.status)); header.append(top); detail.append(header);
    if (['submitted','under_review','action_required'].includes(app.status)) {
      const claim=el('button','ops-claim-button',app.assigned_to===currentStaffId?'Release assignment':app.assigned_to?'Assigned to another reviewer':'Assign to me');
      claim.type='button';claim.disabled=Boolean(app.assigned_to&&app.assigned_to!==currentStaffId);
      claim.addEventListener('click',async()=>{claim.disabled=true;const {error}=await client.rpc('buddy_admin_claim_application',{p_application_id:app.id,p_release:app.assigned_to===currentStaffId});if(error){setMessage(byId('ops-queue-message'),errorMessage(error,'Could not update assignment.'),true);claim.disabled=false;return;}await Promise.all([openApplication(app.id),loadQueue(),loadAudit()]);});
      detail.append(claim);
    }
    const profileBlock=el('section','ops-detail-block'); profileBlock.append(el('h3','','Student details')); const dl=el('dl','ops-details');
    const canViewPrivate=currentRole!=='application_reviewer'||app.assigned_to===currentStaffId;
    if (!canViewPrivate) { profileBlock.append(el('p','ops-message','Claim this application to view the student’s full details and documents.')); detail.append(profileBlock); return; }
    detailLine(dl,'Gender',student.gender); detailLine(dl,'Home address',student.home_address); detailLine(dl,'Town / city',student.hometown); detailLine(dl,'Phone',student.phone); detailLine(dl,'WhatsApp',student.whatsapp_phone); detailLine(dl,'Personal email',student.personal_email); detailLine(dl,'Next of kin',student.next_of_kin_name); detailLine(dl,'Next of kin phone',student.next_of_kin_phone); detailLine(dl,'Heard about Buddy',student.referral_source); detailLine(dl,'Bursary',app.bursary_status==='using'?app.bursary_name:'No bursary recorded'); detailLine(dl,'Requested amount',`R${Number(app.requested_amount||0).toLocaleString('en-ZA')}`); detailLine(dl,'Received',formatDate(app.created_at)); profileBlock.append(dl); detail.append(profileBlock);
    const repeatLoan=Boolean(data.loan_history?.disbursed_this_calendar_year);
    const amount=Number(app.requested_amount||0);
    const interest=Math.round(amount*(repeatLoan?0.03:0.05));
    const initiation=Math.round(amount*0.15);
    const service=Math.min(60,Math.round(amount*(repeatLoan?0.22:0.20)));
    const estimateBlock=el('section','ops-detail-block');estimateBlock.append(el('h3','','Indicative repayment estimate'));
    const estimate=el('dl','ops-details');
    detailLine(estimate,'Rate basis',repeatLoan?'Repeat loan this calendar year':'First loan this calendar year');
    detailLine(estimate,'Interest',`${repeatLoan?3:5}% · R${interest.toLocaleString('en-ZA')}`);
    detailLine(estimate,'Initiation fee',`R${initiation.toLocaleString('en-ZA')}`);
    detailLine(estimate,'Service fee',`R${service.toLocaleString('en-ZA')}`);
    detailLine(estimate,'Estimated total',`R${(amount+interest+initiation+service).toLocaleString('en-ZA')}`);
    estimateBlock.append(estimate,el('p','ops-security-note','Based on recorded Buddy disbursements in the South African calendar year. The written offer confirms the final amount.'));
    detail.append(estimateBlock);
    const docBlock=el('section','ops-detail-block'); docBlock.append(el('h3','','Documents')); const docs=data.documents||[];
    if (!docs.length) docBlock.append(el('p','ops-message','No documents are linked to this application.'));
    const canReviewDocuments=currentRole!=='application_reviewer'||app.assigned_to===currentStaffId;
    for (const doc of docs) docBlock.append(makeDocumentCard(doc,canReviewDocuments));
    if (!canReviewDocuments) docBlock.append(el('p','ops-message','Claim this application before opening or reviewing its documents.'));
    if (['submitted','under_review','action_required'].includes(app.status)&&['operations_admin','owner_admin'].includes(currentRole)) detail.append(makeDecisionBlock(app));
  }
  function makeDocumentCard(doc,canReviewDocuments) {
    const card=el('article','ops-doc'); const head=el('div','ops-doc-head');
    const label=({south_african_id:'South African ID',proof_of_registration:'Registration proof',proof_of_residence:'Proof of residence',bank_statements:'Bank statements'})[doc.document_type]||doc.document_type;
    head.append(el('strong','',label),el('span',`ops-status ${doc.review_status}`,statusNames[doc.review_status]||doc.review_status)); card.append(head);
    if (doc.review_note) card.append(el('p','ops-message',`Student note: ${doc.review_note}`));
    const actions=el('div','ops-doc-actions'); const preview=el('button','',canReviewDocuments?'Open secure preview':'Claim application to review'); preview.type='button';preview.disabled=!canReviewDocuments; preview.addEventListener('click',()=>previewDocument(doc,label));
    const controls=el('div','ops-doc-review-controls'); const select=document.createElement('select'); select.setAttribute('aria-label',`Review outcome for ${label}`);
    for (const [value,text] of [['reviewing','In review'],['accepted','Accept document'],['action_required','Request update']]) { const option=document.createElement('option'); option.value=value; option.textContent=text; select.append(option); }
    const save=el('button','','Save review'); save.type='button';save.disabled=!canReviewDocuments; save.addEventListener('click',()=>saveDocumentReview(doc.id,select.value,note.value,save));
    const note=document.createElement('textarea'); note.maxLength=500; note.placeholder='Required if requesting an update'; note.setAttribute('aria-label',`Review note for ${label}`);
    controls.append(select,note,save); actions.append(preview,controls); card.append(actions); return card;
  }
  async function previewDocument(doc,label) {
    const { error: auditError } = await client.rpc('buddy_admin_record_document_access',{p_review_id:doc.id});
    if (auditError) { setMessage(byId('ops-queue-message'),errorMessage(auditError,'Document access was denied.'),true); return; }
    const { data,error } = await client.storage.from('student-documents').createSignedUrl(doc.object_path,60);
    if (error) { setMessage(byId('ops-queue-message'),errorMessage(error,'Could not open the secure document.'),true); return; }
    byId('ops-preview-title').textContent=label; byId('ops-preview-frame').src=data.signedUrl; byId('ops-preview-dialog').showModal();
  }
  async function saveDocumentReview(id,status,note,button) {
    if (status==='action_required'&&!note.trim()) { setMessage(byId('ops-queue-message'),'Add a clear update request for the student.',true); return; }
    button.disabled=true;
    const { error } = await client.rpc('buddy_admin_review_document',{p_review_id:id,p_status:status,p_note:note.trim()||null});
    button.disabled=false;
    if (error) { setMessage(byId('ops-queue-message'),errorMessage(error,'Could not save the document review.'),true); return; }
    await Promise.all([openApplication(selectedApplicationId),loadQueue(),loadDocuments(),loadAudit(),loadSummary()]);
  }
  function makeDecisionBlock(app) {
    const section=el('section','ops-detail-block'); section.append(el('h3','','Application decision'));
    const select=document.createElement('select'); select.setAttribute('aria-label','Application review outcome');
    for (const [value,text] of [['under_review','Move to in review'],['action_required','Request more information'],['approved','Approve application'],['declined','Mark unsuccessful']]) { const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option); }
    const note=document.createElement('textarea');note.maxLength=500;note.placeholder='Required for update requests and unsuccessful decisions';note.setAttribute('aria-label','Decision note');
    const save=el('button','ops-primary','Save decision');save.type='button';save.addEventListener('click',async()=>{
      const status=select.value;if(['action_required','declined'].includes(status)&&!note.value.trim()){setMessage(byId('ops-queue-message'),'Add a clear reason before saving this outcome.',true);return;}
      save.disabled=true;const {error}=await client.rpc('buddy_admin_update_application_status',{p_application_id:app.id,p_status:status,p_reason:note.value.trim()||null});save.disabled=false;
      if(error){setMessage(byId('ops-queue-message'),errorMessage(error,'Could not save the application decision.'),true);return;}
      await Promise.all([openApplication(app.id),loadQueue(),loadDocuments(),loadAudit(),loadSummary()]);
    });
    const actions=el('div','ops-detail-actions');actions.append(select,note,save);section.append(actions,el('p','ops-security-note','Approval records a review outcome only. It does not create a debit order or move funds.'));return section;
  }
  async function loadSummary() {
    const {data,error}=await client.rpc('buddy_admin_summary');if(error)return;
    byId('metric-submitted').textContent=data.submitted??'0';byId('metric-review').textContent=data.under_review??'0';byId('metric-action').textContent=data.action_required??'0';byId('metric-docs').textContent=data.pending_documents??'0';
  }
  async function loadAudit(reset = false) {
    if(!['operations_admin','owner_admin'].includes(currentRole))return;
    if(reset)auditOffset=0;
    const list=byId('ops-audit-list');setMessage(byId('ops-audit-message'),'Loading audit events…');
    const {data,error}=await client.rpc('buddy_admin_recent_audit',{p_limit:100,p_offset:auditOffset});
    if(error){auditRows=[];list.replaceChildren();setMessage(byId('ops-audit-message'),errorMessage(error,'Could not load the audit log.'),true);return;}
    auditRows=data||[];
    auditHasNext=auditRows.length===100;
    byId('ops-audit-prev').disabled=auditOffset===0;
    byId('ops-audit-next').disabled=!auditHasNext;
    byId('ops-audit-page-label').textContent=auditOffset===0?'Latest activity':`Older activity · page ${Math.floor(auditOffset/100)+1}`;
    renderAudit();
    setMessage(byId('ops-audit-message'),data?.length?`${data.length} recent events`: 'No admin events yet.');
    const recent=byId('ops-recent-list');if(recent){recent.replaceChildren();for(const row of auditRows.slice(0,5))recent.append(makeAuditItem(row));setMessage(byId('ops-recent-message'),data?.length?`${Math.min(data.length,5)} latest events`: 'No admin events yet.');}
  }
  function makeAuditItem(row) {
    const item=el('li');
    const details=row.details||{};
    let summary='';
    if(details.from!==undefined||details.to!==undefined)summary=`${details.from||'—'} → ${details.to||'—'}`;
    else if(details.from_role||details.to_role)summary=`${details.from_role||'No prior role'} → ${details.to_role||'No role'}${details.to_active===false?' · access inactive':''}`;
    else if(details.channel)summary=`Contact opened via ${details.channel}`;
    else if(row.action==='user_reminder_added')summary='In-app reminder added to the student account';
    const context=`${row.actor_email||`Staff ${String(row.actor_id||'').slice(0,8)}`}${row.target_user_email?` · User ${row.target_user_email}`:''}${row.application_id?` · Application ${String(row.application_id).slice(0,8)}`:''}`;
    item.append(el('strong','',row.action.replaceAll('_',' ')),el('small','',context));
    if(summary)item.append(el('small','ops-audit-detail',summary));
    item.append(el('time','',formatDate(row.created_at)));
    return item;
  }
  function renderAudit() {
    const list=byId('ops-audit-list');
    list.replaceChildren();
    const filter=byId('ops-audit-filter')?.value||'all';
    const filtered=auditRows.filter(row=>{
      if(filter==='all')return true;
      if(filter==='staff')return row.action.startsWith('staff_');
      if(filter==='users')return row.action.startsWith('user_');
      if(filter==='documents')return row.action.startsWith('document_');
      if(filter==='applications')return row.action.startsWith('application_');
      return true;
    });
    for(const row of filtered)list.append(makeAuditItem(row));
    setMessage(byId('ops-audit-message'),filtered.length?`${filtered.length} event${filtered.length===1?'':'s'} shown`: 'No matching activity.');
  }
  async function loadUsers() {
    if(!['operations_admin','owner_admin'].includes(currentRole))return;
    const tbody=byId('ops-users-rows');
    const empty=byId('ops-users-empty');
    setMessage(byId('ops-users-message'),'Loading user accounts…');
    const {data,error}=await client.rpc('buddy_admin_list_users',{p_query:byId('ops-users-search').value.trim()||null,p_limit:50,p_offset:userOffset});
    if(error){tbody.replaceChildren();empty.hidden=true;byId('ops-users-next').disabled=true;setMessage(byId('ops-users-message'),errorMessage(error,'Could not load user accounts.'),true);return;}
    const users=data?.users||[];tbody.replaceChildren();
    for(const user of users){
      const row=document.createElement('tr');row.tabIndex=0;row.setAttribute('aria-selected',String(user.user_id===selectedUserId));row.dataset.userId=user.user_id;
      const name=el('td');name.append(el('strong','',`${user.first_name||''} ${user.last_name||''}`.trim()||'Profile not completed'));name.append(el('small','',user.email||'No university email'));
      const count=el('td','',String(user.application_count||0));
      const status=el('td');status.append(el('span',`ops-status ${user.latest_application?.status||'pending'}`,user.latest_application?statusNames[user.latest_application.status]||user.latest_application.status:'No application'));
      const joined=el('td','',formatDate(user.account_created_at));row.append(name,count,status,joined);
      const open=()=>openUser(user.user_id);row.addEventListener('click',open);row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});tbody.append(row);
    }
    empty.hidden=Boolean(users.length);byId('ops-users-prev').disabled=userOffset===0;byId('ops-users-next').disabled=userOffset+50>=Number(data?.total||0);byId('ops-users-page-label').textContent=`Page ${Math.floor(userOffset/50)+1}`;
    setMessage(byId('ops-users-message'),`${data?.total||0} account${data?.total===1?'':'s'} found`);
  }
  function addContactLink(container,label,href,userId,channel) {
    if(!href)return;
    const link=el('a','ops-user-contact',label);link.href=href;
    if(href.startsWith('https://')){link.target='_blank';link.rel='noopener noreferrer';}
    link.addEventListener('click',()=>{client.rpc('buddy_admin_record_user_contact',{p_user_id:userId,p_channel:channel}).then(({error})=>{const status=byId('ops-user-message');if(error&&status)setMessage(status,errorMessage(error,'Could not record this contact action.'),true);else if(!error)loadAudit(true);});});
    container.append(link);
  }
  async function openUser(userId) {
    selectedUserId=userId;const detail=byId('ops-user-detail');detail.replaceChildren(el('p','ops-message','Loading account…'));
    for(const row of byId('ops-users-rows').rows)row.setAttribute('aria-selected',String(row.dataset.userId===userId));
    const {data,error}=await client.rpc('buddy_admin_get_user',{p_user_id:userId});
    if(error){detail.replaceChildren(el('p','ops-message',errorMessage(error,'Could not open this account.')));return;}
    const account=data.account||{},profile=data.profile||{},applications=data.applications||[],loans=data.loan_history||{};
    detail.replaceChildren();
    const header=el('header','ops-user-detail-head');header.append(el('span','ops-eyebrow','STUDENT ACCOUNT'),el('h2','',`${profile.first_name||''} ${profile.last_name||''}`.trim()||'Profile not completed'),el('p','',account.email||'Email unavailable'));detail.append(header);
    const contacts=el('section','ops-user-contact-list');contacts.append(el('h3','','Contact'));const links=el('div','ops-user-contact-actions');
    const contactEmail=profile.personal_email||account.email||'';
    addContactLink(links,'Email student',/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)?`mailto:${encodeURIComponent(contactEmail)}`:null,userId,'email');
    const phone=String(profile.phone||'').replace(/[^+\d]/g,'');addContactLink(links,'Call',phone?`tel:${phone}`:null,userId,'call');
    let wa=String(profile.whatsapp_phone||'').replace(/\D/g,'');if(wa.startsWith('0'))wa=`27${wa.slice(1)}`;addContactLink(links,'WhatsApp',wa?`https://wa.me/${wa}`:null,userId,'whatsapp');
    contacts.append(links);detail.append(contacts);
    const profileBlock=el('section','ops-user-detail-block');profileBlock.append(el('h3','','Profile'));const dl=el('dl','ops-details');
    detailLine(dl,'University email',account.email);detailLine(dl,'Verified',account.email_verified?'Yes':'Not confirmed');detailLine(dl,'Personal email',profile.personal_email);detailLine(dl,'Phone',profile.phone);detailLine(dl,'WhatsApp',profile.whatsapp_phone);detailLine(dl,'Gender',profile.gender);detailLine(dl,'Home address',profile.home_address);detailLine(dl,'Town / city',profile.hometown);detailLine(dl,'Next of kin',profile.next_of_kin_name);detailLine(dl,'Next of kin phone',profile.next_of_kin_phone);detailLine(dl,'Referral source',profile.referral_source);detailLine(dl,'Account created',formatDate(account.created_at));detailLine(dl,'Last sign-in',formatDate(account.last_sign_in_at));profileBlock.append(dl);detail.append(profileBlock);
    const history=el('section','ops-user-detail-block');history.append(el('h3','','Loan history'));detailLineIn(history,'Loans disbursed',String(loans.count||0));detailLineIn(history,'Total principal',`R${Number(loans.total_principal||0).toLocaleString('en-ZA')}`);detailLineIn(history,'Last disbursement',formatDate(loans.last_disbursed_at));detail.append(history);
    const appBlock=el('section','ops-user-detail-block');appBlock.append(el('h3','','Applications'));
    if(!applications.length)appBlock.append(el('p','ops-message','No submitted applications yet.'));
    for(const application of applications){const row=el('div','ops-user-application');row.append(el('span','',`R${Number(application.requested_amount||0).toLocaleString('en-ZA')}`),el('span',`ops-status ${application.status}`,statusNames[application.status]||application.status));const button=el('button','','Open application');button.type='button';button.addEventListener('click',()=>openApplication(application.id));row.append(button);appBlock.append(row);}
    detail.append(appBlock);
    const reminder=el('form','ops-reminder-form');reminder.append(el('h3','','Add an in-app reminder'),el('p','ops-security-note','The reminder appears in the student’s Activity page. It does not send email or SMS.'));
    const title=document.createElement('input');title.required=true;title.maxLength=120;title.placeholder='Reminder title';title.setAttribute('aria-label','Reminder title');
    const message=document.createElement('textarea');message.required=true;message.maxLength=500;message.placeholder='Write a clear, helpful message';message.setAttribute('aria-label','Reminder message');
    const submit=el('button','ops-primary','Add reminder');submit.type='submit';const state=el('p','ops-message','');state.id='ops-user-message';reminder.append(title,message,submit,state);detail.append(reminder);
    reminder.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;setMessage(state,'Adding reminder…');const {error:sendError}=await client.rpc('buddy_admin_send_user_reminder',{p_user_id:userId,p_title:title.value.trim(),p_message:message.value.trim()});submit.disabled=false;if(sendError){setMessage(state,errorMessage(sendError,'Could not add the reminder.'),true);return;}title.value='';message.value='';setMessage(state,'Reminder added to the student’s Activity page.');await loadAudit(true);});
    loadAudit(true);
  }
  function detailLineIn(container,label,value){const row=el('div','ops-details-row');row.append(el('span','',label),el('strong','',value||'—'));container.append(row);}
  async function loadDocuments() {
    const rows=byId('ops-docs-rows');
    setMessage(byId('ops-docs-message'),'Loading submitted document checks…');
    const statuses=['submitted','under_review','action_required'];
    const results=await Promise.all(statuses.map(p_status=>client.rpc('buddy_admin_list_applications',{p_status,p_query:null,p_limit:100,p_offset:0})));
    const failed=results.find(result=>result.error);
    if(failed){rows.replaceChildren();byId('ops-docs-empty').hidden=true;setMessage(byId('ops-docs-message'),errorMessage(failed.error,'Could not load document checks.'),true);return;}
    const applications=results.flatMap(result=>result.data||[]).filter(app=>Number(app.open_documents||0)>0);
    applications.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
    rows.replaceChildren();
    for(const app of applications){
      const row=document.createElement('tr');
      const student=el('td');student.append(el('strong','',`${app.first_name||''} ${app.last_name||''}`.trim()||'Student'));student.append(el('small','',app.email||'Student account'));
      const count=el('td');count.append(el('span','ops-status pending',`${app.open_documents} open`));
      const status=el('td');status.append(el('span',`ops-status ${app.status}`,statusNames[app.status]||app.status));
      const updated=el('td','',formatDate(app.updated_at));
      const actionCell=el('td');const action=el('button','ops-claim-button','Open review');action.type='button';action.addEventListener('click',()=>openApplication(app.id));actionCell.append(action);
      row.append(student,count,status,updated,actionCell);rows.append(row);
    }
    byId('ops-docs-empty').hidden=Boolean(applications.length);
    const docCount=applications.reduce((total,app)=>total+Number(app.open_documents||0),0);
    const badge=byId('nav-docs-count');badge.textContent=docCount;badge.hidden=!docCount;
    setMessage(byId('ops-docs-message'),`${docCount} open document check${docCount===1?'':'s'} across ${applications.length} application${applications.length===1?'':'s'}.`);
  }
  async function loadStaff() {
    if (currentRole !== 'owner_admin') return;
    const rows = byId('ops-staff-rows');
    setMessage(byId('ops-staff-message'),'Loading authorized staff…');
    const {data,error}=await client.rpc('buddy_admin_staff_list');
    if(error){rows.replaceChildren();setMessage(byId('ops-staff-message'),errorMessage(error,'Could not load staff access.'),true);return;}
    rows.replaceChildren();
    for(const member of data||[]){
      const row=document.createElement('tr');
      const identity=el('td');identity.append(el('strong','',member.email||'Staff account'));identity.append(el('small','',String(member.user_id||'').slice(0,8)));
      const role=el('td','',String(member.role||'').replaceAll('_',' '));
      const active=Boolean(member.active);
      const state=el('td');state.append(el('span',`ops-staff-status${active?'':' inactive'}`,active?'Active':'Inactive'));
      const created=el('td','',formatDate(member.created_at));
      const actions=el('td');
      if(member.user_id!==currentStaffId){
        const toggle=el('button','ops-staff-action',active?'Deactivate':'Reactivate');toggle.type='button';
        toggle.addEventListener('click',async()=>{
          const verb=active?'deactivate':'reactivate';
          if(!window.confirm(`${verb[0].toUpperCase()+verb.slice(1)} staff access for ${member.email||'this account'}?`))return;
          toggle.disabled=true;
          const {error:updateError}=await client.rpc('buddy_admin_set_staff_role',{p_email:member.email,p_role:member.role,p_active:!active});
          toggle.disabled=false;
          if(updateError){setMessage(byId('ops-staff-message'),errorMessage(updateError,'Could not update staff access.'),true);return;}
          setMessage(byId('ops-staff-message'),`Staff access ${verb}d.`);
          await Promise.all([loadStaff(),loadAudit()]);
        });
        actions.append(toggle);
      } else actions.textContent='You';
      row.append(identity,role,state,created,actions);rows.append(row);
    }
    setMessage(byId('ops-staff-message'),`${(data||[]).length} staff account${(data||[]).length===1?'':'s'} listed.`);
  }
  byId('ops-staff-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if(currentRole!=='owner_admin'){setMessage(byId('ops-staff-message'),'Owner access is required.',true);return;}
    const email=byId('ops-staff-email').value.trim().toLowerCase();
    const role=byId('ops-staff-role').value;
    const button=byId('ops-staff-save');
    if(!window.confirm(`Grant ${role.replaceAll('_',' ')} access to ${email}? The account must already exist in Authentication and will be required to use MFA.`))return;
    button.disabled=true;setMessage(byId('ops-staff-message'),'Saving staff access…');
    const {error}=await client.rpc('buddy_admin_set_staff_role',{p_email:email,p_role:role,p_active:true});
    button.disabled=false;
    if(error){setMessage(byId('ops-staff-message'),errorMessage(error,'Could not save staff access.'),true);return;}
    byId('ops-staff-email').value='';
    setMessage(byId('ops-staff-message'),'Staff access saved.');
    await Promise.all([loadStaff(),loadAudit()]);
  });
  byId('ops-staff-refresh').addEventListener('click',loadStaff);
  function setPage(page, updateUrl = true) {
    const requestedPage=page;
    const allowed=['overview','applications','documents'];
    if(['operations_admin','owner_admin'].includes(currentRole))allowed.push('activity');
    if(['operations_admin','owner_admin'].includes(currentRole))allowed.push('users');
    if(currentRole==='owner_admin')allowed.push('staff');
    if(!allowed.includes(page))page='overview';
    document.querySelectorAll('[data-page-panel]').forEach(panel=>{const active=panel.dataset.pagePanel===page;panel.hidden=!active;panel.classList.toggle('is-active',active);});
    document.querySelectorAll('.ops-nav [data-page]').forEach(button=>{const active=button.dataset.page===page;button.classList.toggle('is-active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
    if(updateUrl)history.pushState(null,'',`#${page}`);
    else if(page!==requestedPage)history.replaceState(null,'',`#${page}`);
    if(page==='documents')loadDocuments();
    if(page==='users')loadUsers();
    if(page==='activity')loadAudit();
    if(page==='staff'&&currentRole==='owner_admin')loadStaff();
    const pageScroller=document.querySelector('.ops-pages');
    pageScroller?.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  document.querySelectorAll('.ops-nav [data-page]').forEach(button=>button.addEventListener('click',()=>setPage(button.dataset.page)));
  window.addEventListener('popstate',()=>setPage(window.location.hash.slice(1)||'overview',false));
  document.querySelectorAll('[data-go-page]').forEach(button=>button.addEventListener('click',()=>setPage(button.dataset.goPage)));
  byId('ops-docs-refresh').addEventListener('click',loadDocuments);
  byId('ops-users-refresh').addEventListener('click',()=>{userOffset=0;loadUsers();});
  byId('ops-users-search').addEventListener('input',()=>{clearTimeout(userSearchTimer);userSearchTimer=setTimeout(()=>{userOffset=0;loadUsers();},250);});
  byId('ops-users-prev').addEventListener('click',()=>{userOffset=Math.max(0,userOffset-50);loadUsers();});
  byId('ops-users-next').addEventListener('click',()=>{userOffset+=50;loadUsers();});
  byId('ops-audit-filter').addEventListener('change',renderAudit);
  byId('ops-audit-prev').addEventListener('click',()=>{auditOffset=Math.max(0,auditOffset-100);loadAudit();});
  byId('ops-audit-next').addEventListener('click',()=>{if(auditHasNext){auditOffset+=100;loadAudit();}});
  async function refresh() { await showWorkspace(); }
  if (!sdk?.createClient || !config?.supabaseUrl || !config?.supabasePublishableKey) {
    setMessage(authMessage,'Secure account services are not configured.',true); loginForm.hidden=true; return;
  }
  client=sdk.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce',persistSession:true}});
  loginForm.addEventListener('submit',async event=>{
    event.preventDefault();setMessage(authMessage,'Verifying staff sign-in…');byId('ops-login-button').disabled=true;
    const {error}=await client.auth.signInWithPassword({email:byId('ops-email').value.trim(),password:byId('ops-password').value});byId('ops-login-button').disabled=false;
    if(error){setMessage(authMessage,'Sign-in failed. Check your details and try again.',true);return;}
    await showWorkspace();
  });
  mfaForm.addEventListener('submit',async event=>{
    event.preventDefault();if(!mfaChallenge)return;setMessage(authMessage,'Checking authenticator code…');
    const {error}=await client.auth.mfa.verify({...mfaChallenge,code:byId('ops-mfa-code').value.trim()});
    if(error){setMessage(authMessage,'That code could not be verified. Try the current code again.',true);return;}
    mfaForm.hidden=true;loginForm.hidden=false;byId('ops-password').value='';await showWorkspace();
  });
  enrollForm.addEventListener('submit',async event=>{
    event.preventDefault();if(!pendingFactorId)return;const button=byId('ops-enroll-verify');button.disabled=true;setMessage(authMessage,'Checking your authenticator…');
    const {data:challenge,error:challengeError}=await client.auth.mfa.challenge({factorId:pendingFactorId});
    if(challengeError){button.disabled=false;setMessage(authMessage,'We couldn’t verify that code. Try again.',true);return;}
    const {error}=await client.auth.mfa.verify({factorId:pendingFactorId,challengeId:challenge.id,code:byId('ops-enroll-code').value.trim()});button.disabled=false;
    if(error){setMessage(authMessage,'That code didn’t work. Check your authenticator app and try again.',true);return;}
    enrollPanel.hidden=true;pendingFactorId=null;await showWorkspace();
  });
  byId('ops-enroll-restart').addEventListener('click',async()=>{
    if(!pendingFactorId)return;const {error}=await client.auth.mfa.unenroll({factorId:pendingFactorId});
    if(error){setMessage(authMessage,'Couldn’t restart setup. Try again.',true);return;}
    pendingFactorId=null;await startMfaEnrollment();
  });
  byId('ops-enroll-cancel').addEventListener('click',async()=>{await client.auth.signOut();pendingFactorId=null;enrollPanel.hidden=true;loginForm.hidden=false;byId('ops-password').value='';setMessage(authMessage,'Signed out.');});
  signOut.addEventListener('click',async()=>{await client.auth.signOut();mfaForm.hidden=true;loginForm.hidden=false;byId('ops-mfa-code').value='';setMessage(authMessage,'You are signed out.');resetWorkspace();});
  byId('ops-mfa-cancel').addEventListener('click',async()=>{await client.auth.signOut();mfaChallenge=null;mfaForm.hidden=true;loginForm.hidden=false;byId('ops-password').value='';byId('ops-mfa-code').value='';setMessage(authMessage,'Signed out. Sign in with another staff account.');});
  byId('ops-refresh').addEventListener('click',refresh);byId('ops-audit-refresh').addEventListener('click',()=>loadAudit(true));
  byId('ops-status-filter').addEventListener('change',()=>{queueOffset=0;loadQueue();});
  byId('ops-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{queueOffset=0;loadQueue();},250);});
  byId('ops-page-prev').addEventListener('click',()=>{queueOffset=Math.max(0,queueOffset-100);loadQueue();});
  byId('ops-page-next').addEventListener('click',()=>{if(queueHasNext){queueOffset+=100;loadQueue();}});
  byId('ops-preview-close').addEventListener('click',()=>byId('ops-preview-dialog').close());
  byId('ops-preview-dialog').addEventListener('close',()=>{byId('ops-preview-frame').src='about:blank';});
  client.auth.getSession().then(({data,error})=>{if(error){setMessage(authMessage,'Could not verify this session. Sign in again.',true);return;}if(data.session)showWorkspace();});
})();
