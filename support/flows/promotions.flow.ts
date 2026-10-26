import { expect, type Page } from '@playwright/test';

import { config } from '@config';
import { buildApiHeaders } from '../../utils/apiHeaders';

/** The promotion as returned by the API; sent back as-is to update it. */
export interface CreatedPromotion {
  id: number;
  name: string;
  active: boolean;
  [field: string]: unknown;
}

/**
 * Creates an active promotion on one product presentation: every `triggerQuantity` scanned units
 * give the next `rewardQuantity` scanned units `discountPercentage` off. Promotions never add units.
 * They apply tenant-wide, so tests must use a product they created and deactivate the promotion.
 */
export async function createPromotionViaApi(
  page: Page,
  input: {
    name: string;
    productId: number;
    presentationId: number;
    triggerQuantity: number;
    rewardQuantity: number;
    discountPercentage: number;
  }
): Promise<CreatedPromotion> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.post(`${config.apiRoot}/promotions`, {
    headers,
    data: {
      name: input.name,
      triggerProductId: input.productId,
      triggerPresentationId: input.presentationId,
      triggerQuantity: input.triggerQuantity,
      rewardProductId: input.productId,
      rewardPresentationId: input.presentationId,
      rewardQuantity: input.rewardQuantity,
      discountPercentage: input.discountPercentage,
      active: true,
      startDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  expect(response.ok(), `POST /promotions failed: ${await response.text()}`).toBe(true);
  return (await response.json()) as CreatedPromotion;
}

/** A promotion used by a sale or quote cannot be deleted (it is referenced), so tests deactivate it. */
export async function deactivatePromotionViaApi(
  page: Page,
  promotion: CreatedPromotion
): Promise<void> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.put(`${config.apiRoot}/promotions/${promotion.id}`, {
    headers,
    data: { ...promotion, active: false },
  });
  expect(response.ok(), `PUT /promotions/${promotion.id} failed: ${await response.text()}`).toBe(
    true
  );
}
