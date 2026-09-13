<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { FetchError, type Client, type MultiFactorAuthToken, type User } from 'trailbase';
  import { Button } from '$lib/components/ui/button';
  import { consumeReturnTo, storeReturnTo } from '$lib/return-to-origin';
  import {
    createBrowserClient,
    logoutBrowserSession,
    persistNativeTokens,
    validateBrowserSession,
    type SessionValidation,
  } from '$lib/backend/session';

  type AuthMode = 'signin' | 'register' | 'reset';
  type View = 'checking' | 'form' | 'verification' | 'mfa' | 'profile' | 'authenticated';
  type Profile = {
    id: string;
    display_name: string;
    avatar_mime: string | null;
    avatar_revision: number;
    version: number;
    updated_at: number;
  };

  const PROFILE_PATH = '/api/trail-party/profile';
  const RESET_REQUEST_PATH = '/api/auth/v1/reset_password/request';
  const SAFE_PROFILE_KEYS = ['avatar_mime', 'avatar_revision', 'display_name', 'id', 'updated_at', 'version'];

  let mode = $state<AuthMode>('signin');
  let view = $state<View>('checking');
  let client = $state<Client>();
  let currentUser = $state<User>();
  let profile = $state<Profile>();
  let mfaToken = $state<MultiFactorAuthToken>();
  let email = $state('');
  let password = $state('');
  let passwordRepeat = $state('');
  let mfaCode = $state('');
  let displayName = $state('');
  let editingProfile = $state(false);
  let pendingEmail = $state('');
  let resetSent = $state(false);
  let busy = $state(false);
  let notice = $state('');
  let errorMessage = $state('');

  let audience = $derived(
    page.url.searchParams.get('role') === 'host'
      ? 'Host'
      : page.url.searchParams.get('role') === 'player'
        ? 'Player'
        : 'Account',
  );

  onMount(() => {
    // Role remains presentation-only. The return target is validated and stored
    // by the shared helper rather than being carried through auth requests.
    if (page.url.searchParams.has('returnTo')) {
      // An explicit query value, including an invalid or empty one, replaces
      // the prior intent. A queryless return from native verification must not
      // erase the still-valid intent waiting for successful sign-in.
      storeReturnTo(page.url.searchParams.get('returnTo'));
    }
    void restoreSession();
  });

  function clearMessages(): void {
    notice = '';
    errorMessage = '';
  }

  function authError(error: unknown, fallback: string): string {
    if (error instanceof FetchError) {
      switch (error.status) {
        case 400:
          return 'Check the form and try again.';
        case 401:
          return 'That email or password was not accepted.';
        case 403:
          return 'This account needs verification or an additional security step.';
        case 404:
          return 'The account service is unavailable at this address.';
        case 409:
          return 'That account or profile already exists.';
        case 429:
          return 'Too many attempts. Wait a moment and try again.';
        default:
          return error.status >= 500 ? 'The account service is temporarily unavailable.' : fallback;
      }
    }
    if (error instanceof TypeError) return 'The account service could not be reached. Try again.';
    return fallback;
  }

  function isSafeProfile(value: unknown): value is Profile {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== SAFE_PROFILE_KEYS.join(',')) return false;
    return typeof record.id === 'string'
      && typeof record.display_name === 'string'
      && (record.avatar_mime === null || typeof record.avatar_mime === 'string')
      && typeof record.avatar_revision === 'number'
      && Number.isSafeInteger(record.avatar_revision)
      && typeof record.version === 'number'
      && Number.isSafeInteger(record.version)
      && typeof record.updated_at === 'number'
      && Number.isSafeInteger(record.updated_at);
  }

  function uuidV7(timestamp: number): string {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const value = BigInt(timestamp);
    bytes[0] = Number(value >> 40n) & 0xff;
    bytes[1] = Number(value >> 32n) & 0xff;
    bytes[2] = Number(value >> 24n) & 0xff;
    bytes[3] = Number(value >> 16n) & 0xff;
    bytes[4] = Number(value >> 8n) & 0xff;
    bytes[5] = Number(value) & 0xff;
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function restoreSession(): Promise<void> {
    const nextClient = createBrowserClient();
    client = nextClient;
    const validation = await validateBrowserSession(nextClient);
    if (client !== nextClient) return;
    await applyValidation(validation, false);
  }

  async function applyValidation(
    validation: SessionValidation,
    fromCredentialFlow: boolean,
  ): Promise<void> {
    if (validation.kind === 'anonymous') {
      view = 'form';
      if (fromCredentialFlow) errorMessage = 'Sign-in did not establish a valid native session.';
      return;
    }
    if (validation.kind === 'invalid') {
      currentUser = undefined;
      profile = undefined;
      mode = 'signin';
      view = 'form';
      notice = 'Your session is no longer valid. Sign in again to continue.';
      return;
    }
    if (validation.kind === 'unavailable') {
      mode = 'signin';
      view = 'form';
      errorMessage = 'We could not validate the account service. Try again.';
      return;
    }

    currentUser = validation.user;
    await loadProfile(validation.client, validation.user, fromCredentialFlow);
  }

  async function loadProfile(api: Client, user: User, navigateOnSuccess: boolean): Promise<void> {
    view = 'checking';
    try {
      const value = await api.records<Profile>('profiles_public').read(user.id);
      if (!isSafeProfile(value) || value.id !== user.id) {
        view = 'form';
        mode = 'signin';
        errorMessage = 'The account service returned an invalid profile.';
        return;
      }
      profile = value;
      view = 'authenticated';
      notice = '';
      if (navigateOnSuccess) await navigateAfterAuth();
    } catch (error) {
      if (error instanceof FetchError && error.status === 404) {
        if (user.email === null) {
          await showInvalidSession(api);
          return;
        }
        profile = undefined;
        view = 'profile';
        notice = 'Your account is signed in. Choose a display name to continue.';
        return;
      }
      if (error instanceof FetchError && error.status === 403 && user.email !== null) {
        // The read projection can deny a missing self row before it exists.
        // Native status already proved this is a verified session, so continue
        // to the server-authoritative profile create command.
        profile = undefined;
        view = 'profile';
        notice = 'Your account is signed in. Choose a display name to continue.';
        return;
      }
      if (error instanceof FetchError && (error.status === 401 || error.status === 403)) {
        await showInvalidSession(api);
        return;
      }
      view = 'form';
      mode = 'signin';
      errorMessage = authError(error, 'We could not load your profile. Try signing in again.');
    }
  }

  async function navigateAfterAuth(): Promise<void> {
    // consumeReturnTo validates again and returns its fixed safe fallback. Never
    // navigate with the raw query-string value.
    const destination = consumeReturnTo();
    try {
      await goto(resolve(destination as Parameters<typeof resolve>[0]));
    } catch {
      notice = 'Signed in, but the requested destination is unavailable.';
    }
  }

  async function finishLogin(api: Client): Promise<void> {
    const validation = await validateBrowserSession(api);
    await applyValidation(validation, true);
  }

  async function handleSignIn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const api = client;
    if (!api) {
      errorMessage = 'The account service is not ready. Try again.';
      return;
    }
    clearMessages();
    const address = email.trim();
    if (!address) {
      errorMessage = 'Enter your email address.';
      return;
    }
    busy = true;
    try {
      const challenge = await api.login(address, password);
      persistNativeTokens(api.tokens());
      password = '';
      if (challenge) {
        mfaToken = challenge;
        view = 'mfa';
        notice = 'TrailBase requires an additional verification code. You are not signed in yet.';
        return;
      }
      await finishLogin(api);
    } catch (error) {
      view = 'form';
      errorMessage = authError(error, 'Sign-in failed. Try again.');
    } finally {
      busy = false;
    }
  }

  async function handleMfa(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const api = client;
    const challenge = mfaToken;
    if (!api || !challenge) {
      view = 'form';
      errorMessage = 'The MFA challenge is no longer available. Sign in again.';
      return;
    }
    clearMessages();
    busy = true;
    try {
      await api.loginSecond({ mfaToken: challenge, totpCode: mfaCode.trim() });
      persistNativeTokens(api.tokens());
      mfaToken = undefined;
      mfaCode = '';
      await finishLogin(api);
    } catch (error) {
      errorMessage = authError(error, 'The verification code was not accepted. Try again.');
    } finally {
      busy = false;
    }
  }

  async function handleRegister(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const api = client;
    if (!api) {
      errorMessage = 'The account service is not ready. Try again.';
      return;
    }
    clearMessages();
    const address = email.trim();
    if (!address) {
      errorMessage = 'Enter your email address.';
      return;
    }
    if (password !== passwordRepeat) {
      errorMessage = 'Passwords must match.';
      return;
    }
    busy = true;
    try {
      await api.register({ email: address, password, passwordRepeat });
      // Native registration is verification-first and returns no session. Treat
      // an unexpected token as a failed flow instead of claiming account access.
      if (api.tokens()) {
        await logoutBrowserSession(api);
        throw new Error('Registration returned an unexpected session.');
      }
      pendingEmail = address;
      password = '';
      passwordRepeat = '';
      view = 'verification';
      notice = 'Verification email sent. Verify your address before signing in.';
    } catch (error) {
      view = 'form';
      errorMessage = authError(error, 'Registration failed. Try again.');
    } finally {
      busy = false;
    }
  }

  async function handleReset(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !client) return;
    clearMessages();
    const address = email.trim();
    if (!address) {
      errorMessage = 'Enter your email address.';
      return;
    }
    busy = true;
    try {
      await client.fetch(RESET_REQUEST_PATH, {
        method: 'POST',
        body: JSON.stringify({ email: address }),
      });
      resetSent = true;
      notice = 'If an account matches that address, reset instructions will be sent.';
    } catch (error) {
      errorMessage = authError(error, 'We could not request a password reset. Try again.');
    } finally {
      busy = false;
    }
  }

  async function handleCreateProfile(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !client || !currentUser) return;
    clearMessages();
    const name = displayName.trim();
    if (!name) {
      errorMessage = 'Enter a display name.';
      return;
    }
    if (Array.from(name).length > 80) {
      errorMessage = 'Display names must be 80 characters or fewer.';
      return;
    }
    busy = true;
    try {
      const timestamp = Date.now();
      const issuedAt = Math.floor(timestamp / 1000);
      const response = await client.fetch(PROFILE_PATH, {
        method: 'POST',
        body: JSON.stringify({
          display_name: name,
          operation_id: uuidV7(timestamp),
          issued_at: issuedAt,
        }),
      });
      const value: unknown = await response.json();
      if (!isSafeProfile(value) || value.id !== currentUser.id) {
        throw new Error('The account service returned an invalid profile.');
      }
      profile = value;
      view = 'authenticated';
      notice = 'Profile created.';
      await navigateAfterAuth();
    } catch (error) {
      if (error instanceof FetchError && (error.status === 401 || error.status === 403)) {
        await showInvalidSession(client);
      } else if (error instanceof FetchError && error.status === 409) {
        await loadProfile(client, currentUser, true);
      } else {
        errorMessage = authError(error, 'We could not save your profile. Try again.');
      }
    } finally {
      busy = false;
    }
  }

  async function handleUpdateProfile(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !client || !currentUser || !profile) return;
    clearMessages();
    const name = displayName.trim();
    if (!name) {
      errorMessage = 'Enter a display name.';
      return;
    }
    if (Array.from(name).length > 80) {
      errorMessage = 'Display names must be 80 characters or fewer.';
      return;
    }
    busy = true;
    try {
      const timestamp = Date.now();
      const response = await client.fetch('/api/trail-party/profile/update', {
        method: 'POST',
        body: JSON.stringify({
          display_name: name,
          operation_id: uuidV7(timestamp),
          issued_at: Math.floor(timestamp / 1000),
          expected_version: profile.version,
        }),
      });
      const value: unknown = await response.json();
      if (!isSafeProfile(value) || value.id !== currentUser.id) {
        throw new Error('The account service returned an invalid profile.');
      }
      profile = value;
      editingProfile = false;
      notice = 'Profile updated.';
    } catch (error) {
      if (error instanceof FetchError && (error.status === 401 || error.status === 403)) {
        await showInvalidSession(client);
      } else if (error instanceof FetchError && error.status === 409) {
        await loadProfile(client, currentUser, false);
        errorMessage = 'Your profile changed elsewhere. Review the latest name and try again.';
      } else {
        errorMessage = authError(error, 'We could not update your profile. Try again.');
      }
    } finally {
      busy = false;
    }
  }

  async function showInvalidSession(api: Client): Promise<void> {
    await logoutBrowserSession(api);
    currentUser = undefined;
    profile = undefined;
    mfaToken = undefined;
    password = '';
    mode = 'signin';
    view = 'form';
    notice = 'Your session is no longer valid. Sign in again to continue.';
  }

  function switchMode(nextMode: AuthMode): void {
    mode = nextMode;
    view = 'form';
    resetSent = false;
    clearMessages();
    password = '';
    passwordRepeat = '';
  }

  async function handleLogout(): Promise<void> {
    if (busy || !client) return;
    busy = true;
    clearMessages();
    const result = await logoutBrowserSession(client);
    storeReturnTo(null);
    client = createBrowserClient();
    currentUser = undefined;
    profile = undefined;
    mfaToken = undefined;
    password = '';
    mode = 'signin';
    view = 'form';
    busy = false;
    notice = result.serverConfirmed
      ? 'You are signed out.'
      : 'You are signed out on this device, but the server could not confirm revocation.';
  }
</script>

<svelte:head>
  <title>{audience} account · Trail Party</title>
</svelte:head>

<section class="mx-auto grid max-w-3xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
  <div class="space-y-4">
    <p class="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Trail Party account</p>
    {#if view === 'authenticated'}
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Welcome back</h1>
      <p class="max-w-prose text-muted-foreground">Your verified account and profile are ready.</p>
    {:else if view === 'profile'}
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Create your profile</h1>
      <p class="max-w-prose text-muted-foreground">Choose the display name your teammates will see.</p>
    {:else if view === 'verification'}
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Check your email</h1>
      <p class="max-w-prose text-muted-foreground">Registration is not complete until the native verification link is used.</p>
    {:else if view === 'mfa'}
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Additional verification</h1>
      <p class="max-w-prose text-muted-foreground">The account service requested an MFA code. No account access is claimed until it succeeds.</p>
    {:else if mode === 'register'}
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Create your account</h1>
      <p class="max-w-prose text-muted-foreground">Use a verified email address. You will sign in after verification.</p>
    {:else if mode === 'reset'}
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Reset your password</h1>
      <p class="max-w-prose text-muted-foreground">Request the native TrailBase reset email without exposing reset links here.</p>
    {:else}
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">{audience} sign in</h1>
      <p class="max-w-prose text-muted-foreground">Sign in with your verified Trail Party account to continue.</p>
    {/if}
    <p class="max-w-prose text-sm text-muted-foreground">{audience} is a presentation choice only; it does not grant permissions.</p>
  </div>

  <div class="space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-7">
    <div id="auth-feedback" class="min-h-6 space-y-2" aria-live="polite" aria-atomic="true">
      {#if notice}<p role="status" class="text-sm text-muted-foreground">{notice}</p>{/if}
      {#if errorMessage}<p role="alert" class="text-sm font-medium text-destructive">{errorMessage}</p>{/if}
    </div>

    {#if view === 'checking'}
      <p role="status" class="text-sm text-muted-foreground">Checking your native session…</p>
    {:else if view === 'verification'}
      <div class="space-y-5" aria-labelledby="verification-title">
        <h2 id="verification-title" class="text-xl font-semibold">Verification pending</h2>
        <p class="text-sm text-muted-foreground">We requested a native verification message for <strong>{pendingEmail}</strong>. No session was created.</p>
        <p class="text-sm text-muted-foreground">The pinned TrailBase flow sends one native verification message during registration; it cannot resend to a pending address.</p>
        <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={() => switchMode('signin')}>Back to sign in</Button>
      </div>
    {:else if view === 'mfa'}
      <form class="space-y-5" onsubmit={handleMfa} aria-describedby="auth-feedback" aria-busy={busy}>
        <div class="space-y-2">
          <label for="mfa-code" class="text-sm font-medium">Authenticator code</label>
          <input id="mfa-code" name="mfa-code" type="text" inputmode="numeric" autocomplete="one-time-code" required minlength="6" maxlength="12" bind:value={mfaCode} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
        <Button type="submit" disabled={busy} class="w-full">{busy ? 'Verifying…' : 'Verify and continue'}</Button>
        <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={() => { mfaToken = undefined; mfaCode = ''; view = 'form'; mode = 'signin'; clearMessages(); }}>Use another sign-in</Button>
      </form>
    {:else if view === 'profile'}
      <form class="space-y-5" onsubmit={handleCreateProfile} aria-describedby="auth-feedback" aria-busy={busy}>
        <div class="space-y-2">
          <label for="display-name" class="text-sm font-medium">Display name</label>
          <input id="display-name" name="display-name" type="text" autocomplete="nickname" required maxlength="80" bind:value={displayName} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
        <Button type="submit" disabled={busy} class="w-full">{busy ? 'Saving…' : 'Create profile'}</Button>
      </form>
      <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={handleLogout}>Sign out</Button>
    {:else if view === 'authenticated' && profile}
      {#if editingProfile}
        <form class="space-y-5" onsubmit={handleUpdateProfile} aria-describedby="auth-feedback" aria-busy={busy}>
          <div class="space-y-2">
            <label for="display-name">Display name</label>
            <input id="display-name" name="display-name" type="text" autocomplete="nickname" required maxlength="80" bind:value={displayName} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
          </div>
          <Button type="submit" disabled={busy} class="w-full">{busy ? 'Saving…' : 'Save profile'}</Button>
          <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={() => { editingProfile = false; clearMessages(); }}>Cancel</Button>
        </form>
      {:else}
        <div class="space-y-4" aria-labelledby="profile-title">
          <h2 id="profile-title" class="text-xl font-semibold">{profile.display_name}</h2>
          <p data-testid="authenticated-user-id" class="sr-only">{currentUser?.id}</p>
          <p class="text-sm text-muted-foreground">Your first profile is restored and ready.</p>
          <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={() => { displayName = profile?.display_name ?? ''; editingProfile = true; }}>Edit profile</Button>
          <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={handleLogout}>Sign out</Button>
        </div>
      {/if}
    {:else if mode === 'register'}
      <form class="space-y-5" onsubmit={handleRegister} aria-describedby="auth-feedback" aria-busy={busy}>
        <div class="space-y-2">
          <label for="register-email" class="text-sm font-medium">Email</label>
          <input id="register-email" name="email" type="email" autocomplete="email" required maxlength="254" bind:value={email} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
        <div class="space-y-2">
          <label for="register-password" class="text-sm font-medium">Password</label>
          <input id="register-password" name="password" type="password" autocomplete="new-password" required bind:value={password} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
        <div class="space-y-2">
          <label for="password-confirmation" class="text-sm font-medium">Password confirmation</label>
          <input id="password-confirmation" name="password-confirmation" type="password" autocomplete="new-password" required bind:value={passwordRepeat} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
        <p class="text-sm text-muted-foreground">The pinned TrailBase flow sends one native verification message during registration; it cannot resend to a pending address.</p>
        <Button type="submit" disabled={busy} class="w-full">{busy ? 'Creating…' : 'Create account'}</Button>
      </form>
      <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={() => switchMode('signin')}>Already have an account? Sign in</Button>
    {:else if mode === 'reset'}
      {#if resetSent}
        <div class="space-y-4" aria-labelledby="reset-sent-title">
          <h2 id="reset-sent-title" class="text-xl font-semibold">Check your email</h2>
          <p class="text-sm text-muted-foreground">If an account matches that address, the native reset instructions will arrive there. This page does not consume or display reset links.</p>
          <Button type="button" variant="outline" class="w-full" onclick={() => switchMode('signin')}>Back to sign in</Button>
        </div>
      {:else}
        <form class="space-y-5" onsubmit={handleReset} aria-describedby="auth-feedback" aria-busy={busy}>
          <div class="space-y-2">
            <label for="reset-email" class="text-sm font-medium">Email</label>
            <input id="reset-email" name="email" type="email" autocomplete="email" required maxlength="254" bind:value={email} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
          </div>
          <Button type="submit" disabled={busy} class="w-full">{busy ? 'Requesting…' : 'Request reset email'}</Button>
        </form>
        <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={() => switchMode('signin')}>Back to sign in</Button>
      {/if}
    {:else}
      <form class="space-y-5" onsubmit={handleSignIn} aria-describedby="auth-feedback" aria-busy={busy}>
        <div class="space-y-2">
          <label for="signin-email" class="text-sm font-medium">Email</label>
          <input id="signin-email" name="email" type="email" autocomplete="username" required maxlength="254" bind:value={email} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
        <div class="space-y-2">
          <label for="signin-password" class="text-sm font-medium">Password</label>
          <input id="signin-password" name="password" type="password" autocomplete="current-password" required bind:value={password} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
        <Button type="submit" disabled={busy} class="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <div class="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" disabled={busy} class="w-full" onclick={() => switchMode('register')}>Create an account</Button>
        <Button type="button" variant="ghost" disabled={busy} class="w-full" onclick={() => switchMode('reset')}>Forgot password?</Button>
      </div>
    {/if}
  </div>
</section>
