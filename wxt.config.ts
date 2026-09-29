import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'Ghosted — Unfollower Tracker for X',
    short_name: 'Ghosted',
    description: 'See who unfollowed you on X. Tracks followers and following over time, fully local: no account, no server.',
    action: { default_title: 'Ghosted' },
    permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'cookies'],
    host_permissions: ['https://x.com/*', 'https://twitter.com/*'],
    optional_host_permissions: ['https://api.telegram.org/*', 'https://discord.com/*', 'https://discordapp.com/*'],
    browser_specific_settings: {
      // Do not change after first public upload: Firefox keys stored data to this id.
      gecko: { id: 'ghosted@fastdrop.dev', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } } as never,
    },
  },
});
