import { createItem, expect, openItem, test, unique } from './fixtures';

test.describe('collaboration', () => {
  test('a comment appears for others viewing the item, without a reload', async ({ openAs }) => {
    const alice = await openAs('alice');
    const bob = await openAs('bob');
    const item = await createItem(bob, { title: unique('Chargeback dispute') });
    await Promise.all([openItem(alice, item.id), openItem(bob, item.id)]);

    const body = unique('Customer sent the bank statement');
    await bob.getByPlaceholder('Add an update, decision or question…').fill(body);
    await bob.getByRole('button', { name: 'Comment' }).click();

    await expect(bob.locator('.events')).toContainText(body);
    await expect(alice.locator('.events')).toContainText(body); // pushed over SSE, then refetched
  });

  test('approval flow: a member requests, the lead is notified and approves; the requester cannot self-approve', async ({ openAs }) => {
    const bob = await openAs('bob'); // Payments member
    const alice = await openAs('alice'); // Payments lead
    const item = await createItem(bob, { title: unique('Manual refund approval'), requiresApproval: true });

    await openItem(bob, item.id);
    await bob.getByRole('button', { name: 'Request approval' }).click();
    await expect(bob.getByText('Pending approval').first()).toBeVisible();
    await expect(bob.getByRole('button', { name: 'Approve' })).toHaveCount(0); // segregation of duties

    // The worker turns the event into a notification for every Payments lead.
    await alice.goto('/');
    const bell = alice.getByRole('button', { name: /^Notifications, \d+ unread/ });
    await expect(bell).toBeVisible({ timeout: 15_000 });
    await bell.click();
    const notification = alice.getByRole('link', { name: new RegExp(`requested approval for #${item.number}`) });
    await notification.click();

    await expect(alice).toHaveURL(new RegExp(`/items/${item.id}$`));
    await alice.getByRole('button', { name: 'Approve' }).click();
    await expect(alice.getByText(/Approved by/)).toContainText('Alice Chen');
  });
});
