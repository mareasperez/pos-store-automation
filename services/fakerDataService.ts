import { faker } from '@faker-js/faker';

export type ProductFlavor =
  | 'catalog'
  | 'inventory'
  | 'preferred'
  | 'multi-presentation'
  | 'standard';

export type SupplierFake = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
};

export type CustomerFake = {
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
};

export type ProductFake = {
  name: string;
  sku: string;
  initialStock: string;
};

const PRODUCT_SKU_PREFIX: Record<ProductFlavor, string> = {
  catalog: 'CAT',
  inventory: 'INV',
  preferred: 'PFS',
  'multi-presentation': 'MPR',
  standard: 'STD',
};

function compactTimestamp(seed: number): string {
  return String(seed).slice(-8);
}

function stableNumber(value: number): number {
  return Math.abs(Math.trunc(value)) || 1;
}

export class FakerDataService {
  buildCustomerFake(seed: number): CustomerFake {
    const normalizedSeed = stableNumber(seed);
    faker.seed(normalizedSeed + 17);

    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const stamp = compactTimestamp(normalizedSeed);
    const phoneTail = faker.string.numeric({ length: 7, allowLeadingZeros: false });

    return {
      name: `${firstName} ${lastName} ${stamp}`,
      phone: `505${phoneTail}`,
      email: faker.internet
        .email({ firstName, lastName, provider: 'example.test' })
        .toLowerCase(),
      street: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state(),
    };
  }

  buildSupplierFake(seed: number, uniqueTag?: string): SupplierFake {
    const normalizedSeed = stableNumber(seed);
    faker.seed(normalizedSeed);

    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const companyName = faker.company.name();

    const stamp = uniqueTag ?? compactTimestamp(normalizedSeed);
    const phoneTail = faker.string.numeric({ length: 7, allowLeadingZeros: false });

    return {
      name: `${companyName} ${stamp}`,
      contactName: `${firstName} ${lastName}`,
      phone: `505${phoneTail}`,
      email: faker.internet
        .email({ firstName, lastName, provider: 'example.test' })
        .toLowerCase(),
      address: faker.location.streetAddress(),
    };
  }

  buildProductFake(seed: number, flavor: ProductFlavor = 'standard', uniqueTag?: string): ProductFake {
    const normalizedSeed = stableNumber(seed);
    faker.seed(normalizedSeed + 101);

    const productTerm = faker.commerce.productName();

    const stamp = uniqueTag ?? compactTimestamp(normalizedSeed);
    const tail = faker.string.alphanumeric({ length: 4, casing: 'upper' });
    const skuPrefix = PRODUCT_SKU_PREFIX[flavor];

    return {
      name: `${productTerm} ${stamp}`,
      sku: `E2E-${skuPrefix}-${stamp}-${tail}`,
      initialStock: String(faker.number.int({ min: 3, max: 12 })),
    };
  }
}

export const fakerDataService = new FakerDataService();
