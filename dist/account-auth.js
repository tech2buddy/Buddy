(() => {
  const SUPABASE_URL = 'https://wzvlanodljoluffbpoma.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4pCer_MpDaOu25uvfANn2Q_sXUU9iWU';
  const dialog = document.querySelector('#account-dialog');
  const accountState = dialog?.querySelector('.account-access-state');
  const sdk = window.supabase;

  if (!sdk?.createClient) {
    if (accountState) {
      const message = document.createElement('p');
      message.textContent = 'Account services could not load. Please try again shortly.';
      accountState.replaceChildren(message);
    }
    return;
  }

  const client = sdk.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      persistSession: true
    }
  });

  const safeReturnPath = () => {
    const requested = new URLSearchParams(window.location.search).get('return');
    if (!requested) return '';
    try {
      const target = new URL(requested, window.location.origin);
      if (target.origin !== window.location.origin || !target.pathname.endsWith('/dashboard.html')) return '';
      if (!/^#application\/[1-7]$/.test(target.hash)) return '';
      return `${target.pathname}${target.hash}`;
    } catch {
      return '';
    }
  };

  const confirmationRedirect = () => {
    const target = new URL('index.html', window.location.origin);
    target.searchParams.set('open', 'account');
    const returnPath = safeReturnPath();
    if (returnPath) target.searchParams.set('return', returnPath);
    return target.toString();
  };

  const completeSignIn = () => {
    const returnPath = safeReturnPath();
    if (returnPath) window.location.replace(`${window.location.origin}${returnPath}`);
  };

  window.BuddyAuth = Object.freeze({
    getSession: () => client.auth.getSession(),
    getUser: () => client.auth.getUser(),
    signOut: () => client.auth.signOut()
  });

  if (!dialog || !accountState) {
    client.auth.onAuthStateChange((event, session) => {
      window.dispatchEvent(new CustomEvent('buddy-auth-state', { detail: { event, session } }));
    });
    client.auth.getSession().then(({ data, error }) => {
      window.dispatchEvent(new CustomEvent('buddy-auth-ready', { detail: { session: error ? null : data?.session ?? null } }));
    });
    return;
  }

  accountState.innerHTML = `
    <div class="auth-panel">
      <div class="account-options" role="tablist" aria-label="Account access">
        <button type="button" role="tab" id="auth-signup-tab" aria-selected="true">Sign up</button>
        <button type="button" role="tab" id="auth-login-tab" aria-selected="false">Log in</button>
      </div>
      <form id="account-form" novalidate>
        <label class="account-field" for="account-email">University email
          <input id="account-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="name@spu.ac.za" required>
          <small>Use your SPU-issued email address.</small>
        </label>
        <label class="account-field" for="account-password">Password
          <input id="account-password" name="password" type="password" autocomplete="new-password" minlength="12" required>
          <small id="password-help">Use at least 12 characters.</small>
        </label>
        <label class="account-field" id="confirm-password-field" for="account-confirm-password">Confirm password
          <input id="account-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required>
        </label>
        <p class="account-opening-note">Account access only. Loan applications are not open yet. Your email is used for verification and sign-in.</p>
        <p class="auth-message" id="account-auth-message" role="status" aria-live="polite"></p>
        <button class="button button-dark account-submit" id="account-auth-submit" type="submit">Create account <span aria-hidden="true">↗</span></button>
      </form>
      <div class="auth-signed-in" id="account-signed-in" hidden></div>
    </div>`;

  const signupTab = document.querySelector('#auth-signup-tab');
  const loginTab = document.querySelector('#auth-login-tab');
  const form = document.querySelector('#account-form');
  const emailInput = document.querySelector('#account-email');
  const passwordInput = document.querySelector('#account-password');
  const confirmField = document.querySelector('#confirm-password-field');
  const confirmInput = document.querySelector('#account-confirm-password');
  const passwordHelp = document.querySelector('#password-help');
  const message = document.querySelector('#account-auth-message');
  const submit = document.querySelector('#account-auth-submit');
  const signedIn = document.querySelector('#account-signed-in');
  let mode = 'signup';

  const setMessage = (text, kind = '') => {
    message.textContent = text;
    message.dataset.kind = kind;
  };

  const setMode = nextMode => {
    mode = nextMode;
    const signup = mode === 'signup';
    signupTab.setAttribute('aria-selected', String(signup));
    loginTab.setAttribute('aria-selected', String(!signup));
    confirmField.hidden = !signup;
    confirmInput.required = signup;
    passwordInput.autocomplete = signup ? 'new-password' : 'current-password';
    confirmInput.value = '';
    passwordHelp.textContent = signup ? 'Use at least 12 characters.' : 'Enter your password.';
    submit.innerHTML = `${signup ? 'Create account' : 'Log in'} <span aria-hidden="true">↗</span>`;
    setMessage('');
  };

  const showSignedIn = user => {
    form.hidden = true;
    document.querySelector('.account-options').hidden = true;
    signedIn.hidden = false;
    signedIn.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = 'You’re signed in.';
    const detail = document.createElement('p');
    detail.textContent = user.email ? `Account: ${user.email}` : 'Your Buddy account is ready.';
    const dashboardLink = document.createElement('a');
    dashboardLink.className = 'account-dashboard-link';
    dashboardLink.href = 'dashboard.html#overview';
    dashboardLink.textContent = 'Open your student space ↗';
    const signOutButton = document.createElement('button');
    signOutButton.className = 'auth-signout';
    signOutButton.type = 'button';
    signOutButton.textContent = 'Sign out';
    signOutButton.addEventListener('click', async () => {
      signOutButton.disabled = true;
      const { error } = await client.auth.signOut();
      if (error) {
        signOutButton.disabled = false;
        return;
      }
      showSignedOut();
    });
    signedIn.append(title, detail, dashboardLink, signOutButton);
  };

  const showSignedOut = () => {
    form.hidden = false;
    document.querySelector('.account-options').hidden = false;
    signedIn.hidden = true;
    setMessage('');
  };

  const isEmailConfirmed = user => Boolean(user?.email_confirmed_at || user?.confirmed_at);

  signupTab.addEventListener('click', () => setMode('signup'));
  loginTab.addEventListener('click', () => setMode('login'));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email.endsWith('@spu.ac.za')) {
      setMessage('Use your SPU-issued @spu.ac.za email address.', 'error');
      return;
    }
    if (password.length < 12) {
      setMessage('Choose a password with at least 12 characters.', 'error');
      return;
    }
    if (mode === 'signup' && password !== confirmInput.value) {
      setMessage('Your passwords don’t match.', 'error');
      return;
    }

    submit.disabled = true;
    setMessage(mode === 'signup' ? 'Creating your account…' : 'Signing you in…');
    try {
      if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: confirmationRedirect() }
        });
        if (error) throw error;
        if (data.session && !data.user?.email_confirmed_at) {
          await client.auth.signOut();
          setMessage('Email confirmation must be enabled in Supabase before sign-up can continue.', 'error');
        } else if (data.session) {
          setMessage('Your account is ready.', 'success');
          completeSignIn();
          showSignedIn(data.user);
        } else {
          setMessage('Check your SPU inbox for the verification link. Confirm your email to finish creating your account.', 'success');
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMessage('You’re signed in.', 'success');
        completeSignIn();
        showSignedIn(data.user);
      }
    } catch (error) {
      setMessage(error?.message || 'We couldn’t complete account access. Please try again.', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  client.auth.onAuthStateChange((event, session) => {
    window.dispatchEvent(new CustomEvent('buddy-auth-state', { detail: { event, session } }));
    if (session?.user && event === 'SIGNED_IN' && isEmailConfirmed(session.user)) {
      showSignedIn(session.user);
      window.setTimeout(completeSignIn, 0);
    }
  });

  client.auth.getSession().then(({ data, error }) => {
    if (!error && data.session?.user && isEmailConfirmed(data.session.user)) showSignedIn(data.session.user);
    else if (!error && data.session?.user) {
      setMessage('Verify your email before signing in.', 'error');
      window.setTimeout(() => client.auth.signOut(), 0);
    }
    window.dispatchEvent(new CustomEvent('buddy-auth-ready', { detail: { session: data?.session ?? null } }));
    if (!error && data.session?.user) completeSignIn();
  });

  setMode('signup');
})();
