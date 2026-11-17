import { config } from '@config';
import { expect, parallelDescribe, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { assertConfiguredTarget } from '../../support/flows/target.flow';

interface ReturnSummary {
  id: number;
  saleId: number;
  issuedAt: string;
  totalRefunded: number;
  status: string;
  reasonType: 'DAMAGED';
  notes: string;
  refundMethod: 'CASH';
  refundAmount: number | null;
  refundPaymentMethodId: number | null;
  itemCount: number;
}

interface HistoryPage {
  content: ReturnSummary[];
  number: number;
  size: number;
  numberOfElements: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  empty: boolean;
  sort: string[];
}

const coffeeReturn: ReturnSummary = {
  id: 12,
  saleId: 7,
  issuedAt: '2026-11-16T12:00:00.000Z',
  totalRefunded: 4.5,
  status: 'POSTED',
  reasonType: 'DAMAGED',
  notes: 'Artículo defectuoso',
  refundMethod: 'CASH',
  refundAmount: null,
  refundPaymentMethodId: null,
  itemCount: 1,
};

function historyResponse(
  page: number,
  content: ReturnSummary[],
  totalElements: number
): HistoryPage {
  const size = 20;
  const totalPages = Math.ceil(totalElements / size);
  return {
    content,
    number: page,
    size,
    numberOfElements: content.length,
    totalElements,
    totalPages,
    first: page === 0,
    last: page >= totalPages - 1,
    empty: content.length === 0,
    sort: ['issuedAt,DESC', 'id,DESC'],
  };
}

async function mockReturnHistory(page: Page): Promise<void> {
  const apiRoot = new URL(config.apiRoot);
  const apiPath = apiRoot.pathname.replace(/\/+$/, '');
  const frontendOrigin = new URL(config.baseUrl).origin;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const returnPath = url.pathname.slice(apiPath.length);
    const isReturnEndpoint = returnPath === '/returns' || /^\/returns\/\d+$/.test(returnPath);
    const isApiRequest =
      url.pathname.startsWith(`${apiPath}/`) &&
      [apiRoot.origin, frontendOrigin].includes(url.origin);

    if (
      !isApiRequest &&
      url.origin === frontendOrigin &&
      ['GET', 'HEAD'].includes(request.method())
    ) {
      await route.fallback();
      return;
    }

    if (!isApiRequest || request.method() !== 'GET' || !isReturnEndpoint) {
      await route.abort('blockedbyclient');
      return;
    }

    if (/^\/returns\/\d+$/.test(returnPath)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 12,
          saleId: 7,
          issuedAt: coffeeReturn.issuedAt,
          createdAt: coffeeReturn.issuedAt,
          totalRefunded: 4.5,
          status: 'POSTED',
          reasonType: 'DAMAGED',
          notes: coffeeReturn.notes,
          refundMethod: 'CASH',
          refundedAt: coffeeReturn.issuedAt,
          refundAmount: 4.5,
          refundFxRate: null,
          items: [
            {
              id: 31,
              saleLineId: 29,
              productName: 'Historical coffee label',
              unitAbbreviation: 'kg',
              presentationType: 'weight',
              quantity: 0.375,
              unitPrice: 12,
              subtotal: 4.5,
            },
          ],
        }),
      });
      return;
    }

    const requestedPage = Number(url.searchParams.get('page') ?? '0');
    const search = url.searchParams.get('search')?.toLowerCase();
    const matches = !search || '12 7 coffee artículo defectuoso'.includes(search);
    const results =
      search && !matches
        ? []
        : requestedPage === 0
          ? [coffeeReturn]
          : [
              {
                ...coffeeReturn,
                id: 11,
                saleId: 6,
                notes: 'Otra devolución',
              },
            ];
    const total = search ? results.length : 21;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(historyResponse(requestedPage, results, total)),
    });
  });
}

parallelDescribe('customer return history @parallel', () => {
  test('searches and pages the history, then opens read-only persisted details locally', async ({
    page,
  }) => {
    test.skip(config.environment !== 'local', 'This mocked return-history flow is local-only.');
    const releaseTarget = await assertConfiguredTarget(page, {
      requiredPermissions: ['sales:view'],
      verifyBrowserTarget: false,
    });
    await mockReturnHistory(page);

    await page.goto('/sales/returns?lng=es', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('customer-return-details-12')).toBeVisible();
    await page.getByLabel('Go to next page').click();
    await expect(page.getByTestId('customer-return-details-11')).toBeVisible();

    const search = page.getByRole('textbox', { name: 'Buscar devoluciones' });
    await search.fill('coffee');
    await expect(page.getByTestId('customer-return-details-12')).toBeVisible();
    await page.getByTestId('customer-return-details-12').click();
    await expect(page.getByRole('dialog')).toContainText('Historical coffee label');
    await expect(page.getByRole('dialog')).toContainText('0,375');
    await expect(page.getByRole('dialog')).toContainText('Subtotal registrado');

    releaseTarget();
  });
});
