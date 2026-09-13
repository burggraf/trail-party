import { test as base, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type LoginAccount = { email: string; password: string };
type Account = LoginAccount & { id: string };
export type ActorName = 'H' | 'A1' | 'A2' | 'B1' | 'B2' | 'X';
export type StackInfo = {
  frontend: string;
  backend: string;
  mailpit: string;
  stackFile: string;
  accounts: Record<ActorName, Account>;
  signup: { email: string; password: string };
};

export type ActorPage = { context: BrowserContext; page: Page; account: Account };
export type ActorPages = Record<ActorName, ActorPage>;

async function stackInfo(): Promise<StackInfo> {
  const path = process.env.TRAIL_PARTY_E2E_STACK;
  if (!path) throw new Error('E2E stack metadata is unavailable');
  return JSON.parse(await readFile(path, 'utf8')) as StackInfo;
}

export async function signIn(page: Page, account: LoginAccount): Promise<void> {
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await expect(page.getByTestId('authenticated-user-id')).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
}

export function extractMailLink(body: string, prefix: string): string {
  const path = prefix.includes('/_/') ? prefix.slice(prefix.indexOf('/_/')) : prefix.slice(prefix.indexOf('/api/'));
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = body.match(new RegExp(`https?://[^\\s"'<]+${escapedPath}([A-Za-z0-9._~-]+)`, 'u'));
  if (match?.[0]) return match[0];
  const start = body.indexOf(prefix);
  if (start < 0) throw new Error(`mail message did not contain expected link path: ${path}`);
  const token = body.slice(start + prefix.length).match(/^[A-Za-z0-9._~-]+/u)?.[0];
  if (!token) throw new Error('mail link did not contain a token');
  return `${prefix}${token}`;
}

export async function waitForMail(stack: StackInfo, recipient: string, count = 1): Promise<Array<{ ID: string }>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${stack.mailpit}/api/v1/messages?start=0&limit=100`);
    if (!response.ok) throw new Error(`Mailpit message API returned ${response.status}`);
    const payload = await response.json() as { messages?: Array<{ ID?: string; To?: Array<{ Address?: string }> }> };
    const messages = (payload.messages ?? [])
      .filter(message => message.To?.some(address => address.Address === recipient))
      .flatMap(message => message.ID ? [{ ID: message.ID }] : []);
    if (messages.length >= count) return messages;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Mailpit did not receive ${count} message(s) for test recipient`);
}

export async function mailBody(stack: StackInfo, id: string): Promise<string> {
  const response = await fetch(`${stack.mailpit}/api/v1/message/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Mailpit message detail returned ${response.status}`);
  const body = await response.json() as { HTML?: string; Text?: string };
  return body.HTML ?? body.Text ?? '';
}

export const test = base.extend<{
  stack: StackInfo;
  actors: ActorPages;
}>({
  stack: async ({ baseURL }, use) => {
    void baseURL;
    await use(await stackInfo());
  },
  actors: async ({ browser, stack }, use, testInfo: TestInfo) => {
    const names: ActorName[] = ['H', 'A1', 'A2', 'B1', 'B2', 'X'];
    const actors = {} as ActorPages;
    try {
      for (const name of names) {
        const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
        const page = await context.newPage();
        actors[name] = { context, page, account: stack.accounts[name] };
      }
      await use(actors);
    } finally {
      await Promise.all(Object.values(actors).map(({ context }) => context.close()));
    }
  },
});

test.beforeEach(async ({ browser }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-version', description: browser.version() });
});

export { expect };
