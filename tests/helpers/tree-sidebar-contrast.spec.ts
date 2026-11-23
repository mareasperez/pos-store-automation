import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const frontend = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'frontend',
  'src'
);
const css = [
  'styles/base.css',
  'styles/themes.css',
  'shared/components/ui/layout/Sidebar/tree-sidebar.css',
].map((path) => readFileSync(resolve(frontend, path), 'utf8'));

test('sidebar text and icons retain contrast in shadcn themes @auth', async ({ page }) => {
  await page.route('**/*', (route) => route.abort());
  await page.setContent(`<div class="tree-sidebar">
    <a class="tree-node-link" href="#"><div class="tree-node" data-depth="0"><span class="tree-node__icon">I</span><span class="tree-node__label">Enabled</span></div></a>
    <a class="tree-node-link tree-node-link--active" href="#"><div class="tree-node" data-depth="0"><span class="tree-node__icon">I</span><span class="tree-node__label">Active</span></div></a>
    <button class="tree-node-button tree-node-button--active"><div class="tree-node" data-depth="0"><span class="tree-node__toggle">C</span><span class="tree-node__icon">I</span><span class="tree-node__label">Ancestor</span></div></button>
    <div class="tree-sidebar__footer"><a class="tree-sidebar__footer-link tree-sidebar__footer-link--active" href="#"><svg></svg><span>Ajustes</span></a></div>
  </div>`);
  for (const content of css) await page.addStyleTag({ content });
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  for (const theme of ['shadcn-light', 'shadcn-dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const selector of [
      '.tree-node-link:not(.tree-node-link--active)',
      '.tree-node-link--active',
      '.tree-node-button--active',
    ]) {
      const link = page.locator(selector);
      for (const hover of [false, true]) {
        if (hover) await link.hover();
        else await page.mouse.move(0, 0);
        const ratios = await link.evaluate((element) => {
          const styles = (node: Element) => getComputedStyle(node);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!;
          const luminance = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            const [r, g, b] = Array.from(context.getImageData(0, 0, 1, 1).data)
              .slice(0, 3)
              .map((value) => {
                const channel = value / 255;
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
              });
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
          };
          const background =
            styles(element).backgroundColor === 'rgba(0, 0, 0, 0)'
              ? styles(element.closest('.tree-sidebar')!).backgroundColor
              : styles(element).backgroundColor;
          const contrast = (foreground: string) => {
            const [high, low] = [luminance(foreground), luminance(background)].sort(
              (a, b) => b - a
            );
            return (high + 0.05) / (low + 0.05);
          };
          return [
            contrast(styles(element.querySelector('.tree-node__label')!).color),
            contrast(styles(element.querySelector('.tree-node__icon')!).color),
          ];
        });
        expect(ratios[0], `${theme} ${selector} ${hover} text`).toBeGreaterThanOrEqual(4.5);
        expect(ratios[1], `${theme} ${selector} ${hover} icon`).toBeGreaterThanOrEqual(3);
        if (!hover && selector !== '.tree-node-link:not(.tree-node-link--active)') {
          console.log(`${theme} ${selector}: text ${ratios[0].toFixed(2)}:1, icon ${ratios[1].toFixed(2)}:1`);
        }
        if (selector === '.tree-node-button--active') {
          await expect(link).toHaveCSS(
            'background-color',
            hover
              ? theme === 'shadcn-light'
                ? 'oklch(0.97 0 0)'
                : 'oklch(0.269 0 0)'
              : 'rgba(0, 0, 0, 0)'
          );
          const ordinaryIcon = await page
            .locator('.tree-node-link:not(.tree-node-link--active) .tree-node__icon')
            .evaluate((element) => getComputedStyle(element).color);
          await expect(link.locator('.tree-node__icon')).toHaveCSS('color', ordinaryIcon);
        }
      }
    }
    await page.evaluate(() => document.body.setAttribute('data-collapsible', 'icon'));
    const parent = page.locator('.tree-node-button--active');
    await page.mouse.move(0, 0);
    await expect(parent).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const linkInk = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-link').trim()
    );
    await expect(parent.locator('.tree-node__icon')).toHaveCSS('color', linkInk);
    await page.evaluate(() => document.body.removeAttribute('data-collapsible'));
    const settings = page.locator('.tree-sidebar__footer-link--active');
    for (const hover of [false, true]) {
      if (hover) await settings.hover();
      else await page.mouse.move(0, 0);
      const colors = await settings.evaluate((element) => {
        const computed = getComputedStyle(element);
        const theme = getComputedStyle(document.documentElement);
        return {
          foreground: computed.color,
          background: computed.backgroundColor,
          expectedForeground: theme.getPropertyValue('--color-primary-foreground').trim(),
          expectedBackground: theme.getPropertyValue('--color-primary').trim(),
        };
      });
      expect(colors.foreground).toBe(colors.expectedForeground);
      expect(colors.background).toBe(colors.expectedBackground);
    }
  }
});
