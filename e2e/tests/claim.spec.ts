import { createItem, expect, getEvents, getItem, openItem, test, toasts, unique, USERS } from './fixtures';

test.describe('claiming work', () => {
  test('two people claim the same item at the same moment: exactly one wins, the other is told who', async ({ openAs }) => {
    const bob = await openAs('bob');
    const erin = await openAs('erin');
    const item = await createItem(bob, { title: unique('Claim race') });
    await Promise.all([openItem(bob, item.id), openItem(erin, item.id)]);

    // Hold both claim requests until both browsers have sent one, then release them together, so
    // they genuinely race at the server. (Clicking "at the same time" alone is not enough under
    // load: the first claim's realtime update can hide the second button before it is clicked.)
    let release!: () => void;
    const bothSent = new Promise<void>((resolve) => (release = resolve));
    let sent = 0;
    for (const p of [bob, erin]) {
      await p.route('**/api/items/*/claim', async (route) => {
        if (++sent === 2) release();
        await bothSent;
        await route.continue();
      });
    }

    const buttons = [bob, erin].map((p) => p.getByRole('button', { name: 'Take ownership' }));
    for (const b of buttons) await expect(b).toBeEnabled();
    await Promise.all(buttons.map((b) => b.click()));

    // Each browser gets a definitive answer (the loser's optimistic "you own it" is rolled back).
    const outcomes = await Promise.all(
      [bob, erin].map(async (p) => {
        const toast = toasts(p).getByText(/You own this item now|Already taken/);
        await expect(toast).toBeVisible();
        return (await toast.textContent())!;
      }),
    );
    expect([...outcomes].sort()).toEqual(['Already taken', 'You own this item now']);

    const winner = outcomes[0] === 'You own this item now' ? USERS.bob : USERS.erin;
    const loserPage = winner === USERS.bob ? erin : bob;
    await expect(toasts(loserPage)).toContainText(`Already owned by ${winner.name}`);
    for (const p of [bob, erin]) await expect(p.locator('.owner-name')).toContainText(winner.name);

    // The server recorded exactly one owner and one assignment.
    expect((await getItem(bob, item.id)).assignee_name).toBe(winner.name);
    expect((await getEvents(bob, item.id)).filter((e) => e.type === 'assigned')).toHaveLength(1);
  });

  test('a claim whose response is lost is retried with the same idempotency key and applied once', async ({ openAs }) => {
    const bob = await openAs('bob');
    const item = await createItem(bob, { title: unique('Flaky network claim') });
    await openItem(bob, item.id);

    // First attempt reaches the server and succeeds, but the browser never sees the response
    // (as on a dropped connection). The client must retry, and the retry must not claim twice.
    const keys: string[] = [];
    await bob.route('**/api/items/*/claim', async (route) => {
      keys.push(route.request().headers()['idempotency-key']);
      if (keys.length === 1) {
        await route.fetch();
        await route.abort('connectionreset');
      } else {
        await route.continue();
      }
    });
    const replay = bob.waitForResponse((r) => r.url().endsWith('/claim') && r.status() === 200);

    await bob.getByRole('button', { name: 'Take ownership' }).click();
    const response = await replay;

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(response.headers()['idempotent-replayed']).toBe('true');
    await expect(toasts(bob)).toContainText('You own this item now');
    await expect(bob.locator('.owner-name')).toContainText(USERS.bob.name);
    expect((await getEvents(bob, item.id)).filter((e) => e.type === 'assigned')).toHaveLength(1);
  });
});
