<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button';
  let role = $derived(page.url.searchParams.get('role'));
</script>

<h1 class="text-3xl font-bold">{role === 'host' ? 'Host sign in' : role === 'player' ? 'Player sign in' : 'Sign in'}</h1>
<p class="max-w-prose text-muted-foreground">Accounts are not available in this foundation preview. Registration and sign in will arrive with real TrailBase authentication.</p>
<Button href="/" variant="outline">Back to home</Button>
