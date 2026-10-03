import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

/** Seeded demo users (server/src/seed.ts). Payments: alice lead · bob, erin members · carol viewer. */
export const USERS = {
  alice: { email: 'alice@demo.local', name: 'Alice Chen' },
  bob: { email: 'bob@demo.local', name: 'Bob Okafor' },
  carol: { email: 'carol@demo.local', name: 'Carol Diaz' },
  dan: { email: 'dan@demo.local', name: 'Dan Kowalski' },
  erin: { email: 'erin@demo.local', name: 'Erin Patel' },
  rita: { email: 'rita@demo.local', name: 'Rita Requester' },
} as const;
export type UserKey = keyof typeof USERS;

export interface CreatedItem {
  id: string;
  number: number;
  version: number;
}

interface Fixtures {
  /**
   * Opens a separate browser (own cookies, own realtime stream) signed in as a demo user — the
   * equivalent of a second person at another desk. Contexts are closed after the test.
   */
  openAs: (who: UserKey) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  openAs: async ({ browser, baseURL, viewport }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (who) => {
      const context = await browser.newContext({ baseURL, viewport });
      contexts.push(context);
      const page = await context.newPage();
      await signIn(page, who);
      return page;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export { expect };

/** API sign-in (the login screen itself is covered by smoke.spec.ts). Shares the page's cookie jar. */
export async function signIn(page: Page, who: UserKey) {
  const res = await page.request.post('/api/auth/login', { data: { email: USERS[who].email } });
  expect(res.ok(), `sign in as ${who}`).toBeTruthy();
}

/** Unique, recognisable titles so parallel tests never see each other's items. */
export const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const teamIds = new Map<string, string>();
export async function teamId(page: Page, name: string): Promise<string> {
  if (!teamIds.has(name)) {
    const { teams } = await (await page.request.get('/api/teams')).json();
    for (const t of teams) teamIds.set(t.name, t.id);
  }
  return teamIds.get(name)!;
}

/** Creates a work item through the API as the page's user (fixtures are set up via the API, flows via the UI). */
export async function createItem(
  page: Page,
  input: { title: string; team?: string; priority?: number; requiresApproval?: boolean; description?: string },
): Promise<CreatedItem> {
  const res = await page.request.post('/api/items', {
    data: {
      teamId: await teamId(page, input.team ?? 'Payments'),
      title: input.title,
      description: input.description ?? 'Created by the Playwright suite',
      type: 'payment',
      priority: input.priority ?? 2,
      requiresApproval: input.requiresApproval ?? false,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

export async function getItem(page: Page, id: string) {
  return (await page.request.get(`/api/items/${id}`)).json();
}

export async function getEvents(page: Page, id: string): Promise<{ type: string; data: Record<string, unknown> }[]> {
  return (await (await page.request.get(`/api/items/${id}/events`)).json()).events;
}

/** The toast region (role=status). */
export const toasts = (page: Page) => page.getByRole('status');

/** Opens an item and waits until its live-update stream is connected. */
export async function openItem(page: Page, id: string) {
  await page.goto(`/items/${id}`);
  await expect(page.getByText('Live updates on')).toBeVisible();
}
