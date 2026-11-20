import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const stylesDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'frontend',
  'src',
  'styles'
);
const baseStyles = readFileSync(resolve(stylesDirectory, 'base.css'), 'utf8');
const themeStyles = readFileSync(resolve(stylesDirectory, 'themes.css'), 'utf8');

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => route.abort());
  await page.setContent(
    '<div data-testid="primary" style="color: var(--color-primary)">Primary</div>'
  );
  // Match App.tsx's stylesheet order without starting the app or contacting an API.
  await page.addStyleTag({ content: baseStyles });
  await page.addStyleTag({ content: themeStyles });
});

test('keeps the unthemed fallback primary aligned with vivid Default blue', async ({ page }) => {
  await expect(page.getByTestId('primary')).toHaveCSS('color', 'rgb(11, 94, 215)');
});

const lightPrimaries = [
  ['default', 'rgb(11, 94, 215)'],
  ['classic', 'rgb(32, 182, 95)'],
  ['ocean', 'rgb(16, 135, 203)'],
  ['forest', 'rgb(45, 128, 53)'],
  ['purple', 'rgb(118, 32, 223)'],
  ['sunset', 'rgb(240, 104, 25)'],
] as const;

for (const [family, expectedColor] of lightPrimaries) {
  test(`resolves ${family} light primary to its intended family color`, async ({ page }) => {
    await page.evaluate((theme) => {
      document.documentElement.setAttribute('data-theme', `${theme}-light`);
    }, family);

    await expect(page.getByTestId('primary')).toHaveCSS('color', expectedColor);
  });
}

test('resolves Default dark primary to its vivid blue candidate', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'default-dark';
  });

  await expect(page.getByTestId('primary')).toHaveCSS('color', 'rgb(110, 168, 254)');
});

for (const [family, hue, saturation] of [
  ['ocean', 202, '85%'],
  ['forest', 126, '48%'],
  ['purple', 267, '75%'],
  ['sunset', 22, '88%'],
] as const) {
  test(`keeps ${family} light primary variants in its family palette`, async ({ page }) => {
    const colors = await page.evaluate(
      ({ family, hue, saturation }) => {
        document.documentElement.dataset.theme = `${family}-light`;
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        const resolved = (value: string) => {
          probe.style.color = value;
          return getComputedStyle(probe).color;
        };
        return [
          resolved('var(--color-primary-light)'),
          resolved(`hsl(${hue}, ${saturation}, 52%)`),
          resolved('var(--color-primary-dark)'),
          resolved(`hsl(${hue}, ${saturation}, 32%)`),
        ];
      },
      { family, hue, saturation }
    );
    expect(colors[0]).toBe(colors[1]);
    expect(colors[2]).toBe(colors[3]);
  });
}
