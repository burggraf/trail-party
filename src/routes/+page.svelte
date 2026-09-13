<script lang="ts">
  import { Button } from '$lib/components/ui/button';
</script>

<h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Trail Party</h1>
<p class="max-w-prose text-lg text-muted-foreground">A place for your next team trivia night.</p>
<nav aria-label="Get started" class="flex flex-col gap-3 sm:flex-row">
  <Button href="/auth?role=player">Join a game</Button>
  <Button href="/auth?role=host" variant="outline">Host a game</Button>
  <Button href="/display" variant="outline">Open display</Button>
</nav>
<p class="text-sm text-muted-foreground">Accounts use real verified TrailBase authentication. Games and display pairing are not available yet.</p>
