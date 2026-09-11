<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { ModeWatcher, userPrefersMode } from 'mode-watcher';
  import * as NativeSelect from '$lib/components/ui/native-select';

  let { children }: { children: Snippet } = $props();
</script>

<ModeWatcher />
<svelte:head><title>Trail Party</title></svelte:head>
<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-background focus:p-4">Skip to content</a>
<header class="border-b">
  <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
    <a href={resolve('/')} aria-label="Trail Party home" class="inline-flex min-h-11 items-center rounded-md text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-4">Trail Party</a>
    <div class="flex items-center gap-2">
      <label for="theme">Theme</label>
      <NativeSelect.Root id="theme" bind:value={userPrefersMode.current}>
        <NativeSelect.Option value="system">System</NativeSelect.Option>
        <NativeSelect.Option value="light">Light</NativeSelect.Option>
        <NativeSelect.Option value="dark">Dark</NativeSelect.Option>
      </NativeSelect.Root>
    </div>
  </div>
</header>
<main id="main" tabindex="-1" class="mx-auto max-w-5xl space-y-6 px-4 py-12">
  {@render children()}
</main>
