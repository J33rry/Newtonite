import { createItem, expect, openItem, test, unique } from './fixtures';

/** The UI only offers what the server allows; the server tests prove the API enforces it anyway. */
test.describe('authorization in the UI', () => {
  test('a team viewer can read and comment but not take, edit or move work', async ({ openAs }) => {
    const bob = await openAs('bob');
    const carol = await openAs('carol'); // Payments viewer
    const item = await createItem(bob, { title: unique('KYC escalation') });

    await openItem(carol, item.id);
    await expect(carol.getByRole('heading', { name: /KYC escalation/ })).toBeVisible();
    await expect(carol.getByRole('button', { name: 'Take ownership' })).toHaveCount(0);
    await expect(carol.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(carol.getByText('No actions available to you in this state.')).toBeVisible();
    await expect(carol.getByPlaceholder('Add an update, decision or question…')).toBeVisible();
  });

  test('someone outside the team cannot tell the item exists', async ({ openAs }) => {
    const bob = await openAs('bob');
    const dan = await openAs('dan'); // not in Payments
    const item = await createItem(bob, { title: unique('Sanctions screening hit') });

    await dan.goto(`/items/${item.id}`);
    await expect(dan.getByText('This item does not exist, or you do not have access to it.')).toBeVisible();
    await expect(dan.getByText(/Sanctions screening hit/)).toHaveCount(0);
  });
});
