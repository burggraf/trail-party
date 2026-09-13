<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { FetchError } from 'trailbase';
  import { Button } from '$lib/components/ui/button';
  import { createBrowserClient } from '$lib/backend/session';

  let password = $state('');
  let passwordRepeat = $state('');
  let busy = $state(false);
  let complete = $state(false);
  let errorMessage = $state('');

  async function updatePassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    errorMessage = '';
    if (password !== passwordRepeat) {
      errorMessage = 'Passwords must match.';
      return;
    }
    const token = page.url.searchParams.get('token');
    if (!token) {
      errorMessage = 'This password reset link is incomplete.';
      return;
    }
    busy = true;
    try {
      const response = await createBrowserClient().fetch('/api/auth/v1/reset_password/update', {
        method: 'POST',
        body: JSON.stringify({ password, password_repeat: passwordRepeat, password_reset_token: token }),
      });
      if (!response.ok) throw new Error('Password reset was not accepted.');
      password = '';
      passwordRepeat = '';
      complete = true;
    } catch (error) {
      errorMessage = error instanceof FetchError && error.status === 400
        ? 'This password reset link is invalid or expired.'
        : 'We could not update your password. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Update password · Trail Party</title></svelte:head>
<section class="mx-auto max-w-xl space-y-6" aria-labelledby="reset-title">
  <div>
    <p class="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Trail Party account</p>
    <h1 id="reset-title" class="text-3xl font-bold tracking-tight">Update password</h1>
  </div>
  {#if errorMessage}<p role="alert">{errorMessage}</p>{/if}
  {#if complete}
    <p role="status">Password reset</p>
    <Button type="button" onclick={() => goto(resolve('/auth'))}>Back to sign in</Button>
  {:else}
    <form class="space-y-5 rounded-xl border bg-card p-5" onsubmit={updatePassword}>
      <div class="space-y-2">
        <label for="reset-password">Password</label>
        <input id="reset-password" name="password" type="password" placeholder="Password" required bind:value={password} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base" />
      </div>
      <div class="space-y-2">
        <label for="reset-password-confirm">Password Confirm</label>
        <input id="reset-password-confirm" name="password_repeat" type="password" placeholder="Password Confirm" required bind:value={passwordRepeat} class="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base" />
      </div>
      <Button type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update Password'}</Button>
    </form>
  {/if}
</section>
