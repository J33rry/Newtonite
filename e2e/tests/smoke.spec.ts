import { expect, test, toasts, unique } from './fixtures';

test('sign in through the login screen and land on the overview', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/); // no session → redirected

  await page.getByRole('button', { name: /Alice Chen/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  await expect(page.getByText('Live updates on')).toBeVisible();
});

test('a requester with no team raises work for another team and can follow it', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Rita Requester/ }).click();
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();

  const title = unique('Refund not received');
  await page.goto('/items/new');
  await page.getByRole('combobox', { name: 'Team' }).selectOption({ label: 'Payments' });
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Context' }).fill('Customer paid twice for order 1234');
  await page.getByRole('button', { name: 'Create item' }).click();

  await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(toasts(page)).toContainText(/Created #\d+/);
  // The requester is not a Payments member, so cannot take the item themselves.
  await expect(page.getByRole('button', { name: 'Take ownership' })).toHaveCount(0);
});
