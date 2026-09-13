<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { FetchError, type Client } from 'trailbase';
  import { Button } from '$lib/components/ui/button';
  import { createBrowserClient, logoutBrowserSession, validateBrowserSession } from '$lib/backend/session';

  type Profile = {
    id: string;
    display_name: string;
    avatar_mime: string | null;
    avatar_revision: number;
    version: number;
    updated_at: number;
  };

  let profiles = $state<Profile[]>([]);
  let errorMessage = $state('');
  let reader: ReadableStreamDefaultReader<unknown> | undefined;
  let client: Client | undefined;
  let currentUserId = $state('');

  function merge(profile: Profile): void {
    const index = profiles.findIndex(item => item.id === profile.id);
    if (index < 0) profiles = [...profiles, profile].sort((a, b) => a.display_name.localeCompare(b.display_name));
    else profiles = profiles.map((item, itemIndex) => itemIndex === index ? profile : item);
  }

  onMount(() => {
    void loadProfiles();
    return () => { void reader?.cancel(); };
  });

  async function loadProfiles(): Promise<void> {
    const api = createBrowserClient();
    client = api;
    const validation = await validateBrowserSession(api);
    if (validation.kind !== 'authenticated') {
      errorMessage = 'Sign in to view the lobby.';
      return;
    }
    client = validation.client;
    currentUserId = validation.user.id;
    try {
      profiles = (await client.records<Profile>('profiles_public').list({ order: ['display_name'] })).records;
      const stream = await client.records<Profile>('profiles_public').subscribeAll();
      reader = stream.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const event = next.value as { Insert?: Profile; Update?: Profile; Delete?: { id?: string } };
        if (event.Insert) merge(event.Insert);
        if (event.Update) merge(event.Update);
        if (event.Delete?.id) profiles = profiles.filter(profile => profile.id !== event.Delete?.id);
      }
    } catch (error) {
      if (error instanceof FetchError && (error.status === 401 || error.status === 403)) errorMessage = 'Your lobby access is no longer valid.';
      else errorMessage = 'The lobby could not be loaded.';
    }
  }

  async function signOut(): Promise<void> {
    if (client) await logoutBrowserSession(client);
    await goto(resolve('/auth'));
  }
</script>

<svelte:head><title>Lobby · Trail Party</title></svelte:head>
<section class="space-y-6" aria-labelledby="lobby-title">
  <div>
    <p class="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Shared lobby</p>
    <h1 id="lobby-title" class="text-3xl font-bold tracking-tight sm:text-4xl">Lobby</h1>
    <p class="text-muted-foreground">Authorized profile updates appear here without a reload.</p>
    <p data-testid="authenticated-user-id" class="sr-only">{currentUserId}</p>
    <Button type="button" variant="outline" onclick={signOut}>Sign out</Button>
  </div>
  {#if errorMessage}<p role="alert">{errorMessage}</p>{/if}
  <ul aria-label="Profiles" class="grid gap-3 sm:grid-cols-2">
    {#each profiles as profile (profile.id)}
      <li data-testid={`profile-${profile.id}`} class="rounded-lg border p-4">
        <span class="font-medium">{profile.display_name}</span>
      </li>
    {/each}
  </ul>
</section>
