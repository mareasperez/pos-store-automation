import { expect, test, type APIResponse } from '@playwright/test';
import { config } from '@config';
import { createComboUi, type Fixture } from '../../support/flows/combos.flow';

test('creates a combo using the exact component decimal quantity textbox', async ({ page }) => {
  page.setDefaultTimeout(1_500);
  const fixture = {
    prefix: 'offline',
    physical: { id: 11, name: 'Coffee', basePresentation: { id: 21 } },
    service: { id: 12, name: 'Service', basePresentation: { id: 22 } },
    pack: { id: 23 },
  } as Fixture;
  const requests: string[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      await route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `
          <input aria-label="Nombre"><input aria-label="SKU">
          <button onclick="document.querySelector('#picker').hidden = false">Agregar productos</button>
          <div id="picker" hidden>
            <input data-testid="product-search-modal-input">
            <button data-testid="product-card-11-21" onclick="add(11, 'Coffee')">Coffee</button>
            <button data-testid="product-card-12-22" onclick="add(12, 'Service')">Service</button>
          </div>
          <div id="rows"></div>
          <input id="combo-fixed-price" type="number">
          <button onclick="save()">Guardar combo</button>
          <script>
            function add(id, name) {
              document.querySelector('#picker').hidden = true;
              document.querySelector('#rows').insertAdjacentHTML('beforeend', \`
                <div data-testid="combo-component-\${id}">
                  <button role="combobox" onclick="document.querySelector('#pack').hidden = false">Presentation</button>
                  <input type="text" inputmode="decimal" aria-label="Cantidad - \${name}" value="1">
                  <input type="text" aria-label="Cantidad - \${name} extra" value="8">
                </div>\`);
            }
            function save() {
              const quantity = document.querySelector('[aria-label="Cantidad - Coffee"]').value;
              const extra = document.querySelector('[aria-label="Cantidad - Coffee extra"]').value;
              fetch(${JSON.stringify(`${config.apiRoot}/combos`)}, {
                method: 'POST', body: JSON.stringify({ quantity, extra })
              }).then(() => history.pushState({}, '', '/catalog/products'));
            }
          </script>
          <button id="pack" role="option" hidden onclick="this.hidden = true">Pack ×3</button>
        `,
      });
    } else if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/combos') {
      requests.push(request.postData() ?? '');
      await route.fulfill({
        status: 201,
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: {
          product: { id: 30, basePresentation: { price: 90 } },
          components: [
            { productId: 11, presentationId: 23, quantity: 2 },
            { productId: 12, presentationId: 22, quantity: 1 },
          ],
        },
      });
    } else {
      await route.abort('blockedbyclient');
    }
  });
  Object.defineProperty(page.request, 'fetch', {
    value: async () =>
      ({
        ok: () => true,
        status: () => 200,
        text: async () => '',
        json: async () => [{ id: 31, isBasePresentation: true, price: 90 }],
      }) as APIResponse,
  });
  await page
    .context()
    .addCookies([{ name: 'access_token', value: 'offline-token', url: config.baseUrl }]);
  await createComboUi(page, fixture);
  expect(requests.map((request) => JSON.parse(request))).toEqual([{ quantity: '2', extra: '8' }]);
});
