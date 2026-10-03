import type { Page } from '@playwright/test';
import { createItem, expect, getItem, openItem, test, toasts, unique } from './fixtures';

/** Opens the edit panel and returns its title / description inputs. */
async function startEditing(page: Page) {
  await page.getByRole('button', { name: 'Edit' }).click();
  return { title: page.getByRole('textbox', { name: 'Title' }), description: page.getByRole('textbox', { name: 'Description' }) };
}

test.describe('editing a stale view', () => {
  test('a live update while editing shows what changed, and nothing is overwritten silently', async ({ openAs }) => {
    const alice = await openAs('alice'); // lead
    const bob = await openAs('bob'); // requester
    const item = await createItem(bob, { title: unique('Settlement mismatch') });
    await Promise.all([openItem(alice, item.id), openItem(bob, item.id)]);

    const aliceForm = await startEditing(alice);
    await aliceForm.description.fill('Batch 7 is off by 12.40 EUR — ledger export attached');

    const bobForm = await startEditing(bob);
    const theirTitle = unique('Settlement mismatch (batch 7)');
    await bobForm.title.fill(theirTitle);
    await bob.getByRole('button', { name: 'Save' }).click();
    await expect(toasts(bob)).toContainText('Saved');

    // Alice is told while still editing; saving is blocked until she decides.
    const warning = alice.getByText('This item changed while you were editing');
    await expect(warning).toBeVisible();
    await expect(alice.locator('table.conflict')).toContainText(theirTitle);
    await expect(alice.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Different fields: her edit is applied on top of the latest version, keeping Bob's title.
    await alice.getByRole('button', { name: 'Apply my edits on top' }).click();
    await alice.getByRole('button', { name: 'Save' }).click();
    await expect(toasts(alice)).toContainText('Saved');

    const final = await getItem(alice, item.id);
    expect(final.title).toBe(theirTitle);
    expect(final.description).toContain('off by 12.40 EUR');
    expect(final.version).toBe(3);
  });

  test('without live updates, the server rejects the stale save and the user chooses', async ({ openAs }) => {
    const alice = await openAs('alice');
    const bob = await openAs('bob');
    // Alice's realtime stream is down, so only the server's version check can catch the conflict.
    await alice.route('**/api/stream', (route) => route.abort());
    const item = await createItem(bob, { title: unique('Payout failed') });
    await alice.goto(`/items/${item.id}`);
    await openItem(bob, item.id);

    const aliceForm = await startEditing(alice);
    await aliceForm.title.fill('Alice: payout failed — bank rejected IBAN');

    const bobForm = await startEditing(bob);
    await bobForm.title.fill('Bob: payout failed to bank');
    await bob.getByRole('button', { name: 'Save' }).click();
    await expect(toasts(bob)).toContainText('Saved');

    await alice.getByRole('button', { name: 'Save' }).click();
    await expect(toasts(alice)).toContainText('Someone else changed this item');
    await expect(alice.locator('table.conflict tr.overlap')).toContainText('Bob: payout failed to bank');
    expect((await getItem(alice, item.id)).title).toBe('Bob: payout failed to bank'); // not overwritten

    // Same field changed by both: overwriting is an explicit, labelled choice.
    await alice.getByRole('button', { name: 'Keep my edits (overwrite theirs)' }).click();
    await alice.getByRole('button', { name: 'Save' }).click();
    await expect(toasts(alice)).toContainText('Saved');
    expect((await getItem(alice, item.id)).title).toBe('Alice: payout failed — bank rejected IBAN');
  });
});
