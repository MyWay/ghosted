<script lang="ts">
  import { profileUrl } from './format';
  import type { UserRow } from '../db/schema';

  let { handle, user, sub }: { handle: string; user?: UserRow; sub?: string } = $props();
</script>

<div class="row">
  {#if user?.avatarUrl}<img class="avatar" src={user.avatarUrl} alt="" loading="lazy" />{:else}<div class="avatar"></div>{/if}
  <div class="grow">
    <div class="ellipsis"><strong>{user?.name || handle}</strong></div>
    <div class="ellipsis"><a href={profileUrl(handle)} target="_blank" rel="noopener">@{handle}</a>{#if sub} <span class="muted">· {sub}</span>{/if}</div>
  </div>
</div>
