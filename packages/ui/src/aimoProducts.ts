/**
 * The demo kitchen's items, matched by hand to real products in the Valio Aimo Junction 2026 product data
 * (data/raw/products.json, delivery-reliability.csv, carbon-footprint.csv; snapshot taken 2026-11-14).
 * reliability: share of past orders delivered as ordered (0-1); co2PerKg: product-group average. null = not in the files.
 * salesUnit + packSize: what one pack is, in the kitchen unit (catalogue netContent; basil, olive oil and wurstel have none
 * there, so their size is read from the product name). price: real Aimo price API answer, EUR excl. VAT per sales unit,
 * customer 300, delivery 2026-11-16 (scripts/fetch-demo-prices.ts, taken 2026-11-14); VAT 13.5 % on all nine.
 * The challenge data is for Junction 2026 only.
 */
export interface AimoProduct {
  productId: string;
  name: string;
  vendor: string;
  reliability: number | null;
  co2PerKg: number | null;
  salesUnit: 'ST' | 'BAG' | 'KG' | 'KI' | 'SK';
  packSize: number;
  price: number;
}

export const AIMO_PRODUCTS: Record<string, AimoProduct> = {
  "milk": { productId: '463335', name: "Valio Eila® 3 % milk drink 1 l lactose free", vendor: "VALIO OY TUORE", reliability: 1.0, co2PerKg: 1.1, salesUnit: 'ST', packSize: 1, price: 1.4 },
  "mozzarella": { productId: '463383', name: "Maestrella Mozzarella grated 21% 2,5kg lactose free", vendor: "EURIAL INTERNATIONAL", reliability: 0.969, co2PerKg: 5.21, salesUnit: 'BAG', packSize: 2.5, price: 19.66 },
  "tomatoes": { productId: '460027', name: "TOMATO NL/BE/ES 1.CL", vendor: "STAAY FOOD GROOP B.V.", reliability: 0.999, co2PerKg: 1.96, salesUnit: 'KG', packSize: 1, price: 2.15 },
  "fries": { productId: '461203', name: "McCain original country style fries 2,5kg frozen", vendor: "MCCAIN FOODS EUROPE BV", reliability: 0.999, co2PerKg: 0.39, salesUnit: 'BAG', packSize: 2.5, price: 5.74 },
  "basil": { productId: '460533', name: "BASIL FRESH 1KG BOX", vendor: "STAAY FOOD GROOP B.V.", reliability: 0.938, co2PerKg: 0.38, salesUnit: 'KI', packSize: 1, price: 21.03 },
  "flour": { productId: '460091', name: "Myllärin Special Wheat flour 20 kg", vendor: "HELSINGIN MYLLY OY", reliability: null, co2PerKg: 0.77, salesUnit: 'SK', packSize: 20, price: 12.39 },
  "olive oil": { productId: '462909', name: "VOT 5L EXTRA VIRG OLIVEOIL", vendor: "VALIO OY / VALIO AIMO", reliability: 0.996, co2PerKg: 2.11, salesUnit: 'ST', packSize: 5, price: 42 },
  "salt": { productId: '460215', name: "Berner Sea salt medium coarse 25 kg", vendor: "BERNER OY /AGENTUURI", reliability: null, co2PerKg: 0.42, salesUnit: 'SK', packSize: 25, price: 11.4 },
  "wurstel": { productId: '463022', name: "SAUSAGE WIENER 1KG", vendor: "VALIO OY / VALIO AIMO", reliability: null, co2PerKg: 4.92, salesUnit: 'ST', packSize: 1, price: 10.52 },
};

/**
 * A kitchen quantity as the cart buys it: whole packs (bags, sacks, crates, bottles), or kilos to 0.01 for
 * produce sold by weight, the same rounding as the agent's packMath. undefined for items not in the list.
 */
export function toPacks(item: string, quantity: number): { product: AimoProduct; packs: number } | undefined {
  const product = AIMO_PRODUCTS[item];
  if (!product) return undefined;
  // the epsilon stops float noise (0.3 / 0.1 = 2.9999…) from adding a whole extra pack
  const packs = product.salesUnit === 'KG' ? Math.ceil(quantity * 100 - 1e-9) / 100 : Math.ceil(quantity / product.packSize - 1e-9);
  return { product, packs };
}
