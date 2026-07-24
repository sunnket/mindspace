'use client';

/**
 * "Bring your own key" plugin credentials. Instead of a hosted OAuth server we
 * can't provide, the user pastes their own token / webhook URL in the Connect
 * modal; it's kept in this browser (localStorage) and used directly against the
 * provider's API. No secret ever touches our servers.
 */

export type PluginId = 'github' | 'webhook';

export interface PluginConfig {
  id: PluginId;
  title: string;
  blurb: string; // one-liner shown in the panel
  fieldLabel: string;
  placeholder: string;
  help: string; // where to get the credential
  helpUrl?: string;
  kind: 'token' | 'url';
}

export const PLUGIN_CONFIGS: PluginConfig[] = [
  {
    id: 'github',
    title: 'GitHub token',
    blurb: 'Optional — unlock private repos & 5,000/hr',
    fieldLabel: 'Personal access token',
    placeholder: 'ghp_… or github_pat_…',
    help: 'Create one at github.com/settings/tokens. Public data already works without it; a token raises the rate limit from 60 to 5,000/hr and lets you view private repos.',
    helpUrl: 'https://github.com/settings/tokens',
    kind: 'token',
  },
  {
    id: 'webhook',
    title: 'Webhook',
    blurb: 'Push notes to Slack, Discord, Zapier, Make…',
    fieldLabel: 'Incoming webhook URL',
    placeholder: 'https://hooks.slack.com/… · discord.com/api/webhooks/…',
    help: 'Paste an incoming webhook URL from Slack, Discord, Zapier, Make or IFTTT. Through Zapier/Make one webhook can reach thousands of other apps.',
    kind: 'url',
  },
];

const KEY = (id: PluginId) => `canvabrains:plugin:${id}`;

export function getPluginCred(id: PluginId): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(KEY(id)) || '';
  } catch {
    return '';
  }
}

export function setPluginCred(id: PluginId, value: string): void {
  try {
    if (value) window.localStorage.setItem(KEY(id), value);
    else window.localStorage.removeItem(KEY(id));
    window.dispatchEvent(new CustomEvent('plugin-cred-changed', { detail: { id } }));
  } catch {
    /* storage disabled — nothing to do */
  }
}

export function clearPluginCred(id: PluginId): void {
  setPluginCred(id, '');
}
