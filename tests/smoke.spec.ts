import { expect, test } from '@playwright/test';

test('boots the Vulture menu without browser errors', async ({ page }) => {
  const errors: string[] = [];
  await page.route('**/api/daily-crater', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ seed: 2199, date: '2026-11-18' }),
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Vulture: Lunar Mining Mission');
  await page.waitForTimeout(1500);

  await expect(page.locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('starts a run and accepts core keyboard controls', async ({ page }) => {
  const errors: string[] = [];
  await page.route('**/api/daily-crater', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ seed: 2199, date: '2026-11-18' }),
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  const callsign = page.locator('#callsign');
  await expect(callsign).toBeVisible();
  await callsign.fill('TEST-01');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);

  const sceneKeys = await page.evaluate(() => {
    const browserWindow = window as unknown as {
      game: { scene: { getScenes: (active: boolean) => unknown[] } };
    };
    return browserWindow.game.scene
      .getScenes(true)
      .map((scene: unknown) => (scene as { sys: { settings: { key: string } } }).sys.settings.key);
  });
  expect(sceneKeys).toContain('play');

  await page.keyboard.down('W');
  await page.waitForTimeout(350);
  await page.keyboard.up('W');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('Space');
  await page.keyboard.press('KeyF');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const pausedKeys = await page.evaluate(() => {
    const browserWindow = window as unknown as {
      game: { scene: { getScenes: (active: boolean) => unknown[] } };
    };
    return browserWindow.game.scene
      .getScenes(true)
      .map((scene: unknown) => (scene as { sys: { settings: { key: string } } }).sys.settings.key);
  });
  expect(pausedKeys).toContain('pause');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: 'test-results/vulture-gameplay.png',
    fullPage: true,
  });

  expect(errors).toEqual([]);
});
