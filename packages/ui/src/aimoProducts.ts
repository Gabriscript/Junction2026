/**
 * The demo kitchen's items, matched by hand to real products in the Valio Aimo Junction 2026 product data
 * (data/raw/products.json, delivery-reliability.csv, carbon-footprint.csv; snapshot taken 2026-11-14).
 * reliability: share of past orders delivered as ordered (0-1); co2PerKg: product-group average. null = not in the files.
 * Every item has a product photo in public/products. salesUnit + packSize: what one pack is, in the kitchen unit
 * (catalogue netContent; ciabatta: 18 buns a crate, counted in pieces). price: real Aimo price API answer, EUR excl. VAT per sales unit,
 * customer 300, delivery 2026-11-16 (Aimo price API, taken 2026-11-14); VAT 13.5 % on all of them.
 * The challenge data is for Junction 2026 only.
 */
export interface AimoProduct {
  productId: string;
  name: string;
  vendor: string;
  reliability: number | null;
  co2PerKg: number | null;
  salesUnit: 'ST' | 'BAG' | 'KG' | 'KI' | 'PRK';
  packSize: number;
  price: number;
}

export const AIMO_PRODUCTS: Record<string, AimoProduct> = {
  "tomatoes": { productId: '460027', name: "TOMATO NL/BE/ES 1.CL", vendor: "STAAY FOOD GROOP B.V.", reliability: 0.999, co2PerKg: 1.96, salesUnit: 'KG', packSize: 1, price: 2.15 },
  "mozzarella": { productId: '468526', name: "Castelli mozzarella bufala 125g mozzarella cheese from buffalo milk", vendor: "CASTELLI 1892 SCANDINAVIA AB ITALIA", reliability: 0.92, co2PerKg: 3.9, salesUnit: 'BAG', packSize: 0.125, price: 2.24 },
  "fusilli": { productId: '460008', name: "Barilla 5kg Fusilli dry pasta", vendor: "OY CONAXESS TRADE FINLAND AB TEOLLI", reliability: 1.0, co2PerKg: 1.44, salesUnit: 'BAG', packSize: 5, price: 18.14 },
  "ciabatta": { productId: '468490', name: "Eesti Pagar White ciabatta sandwich bun 18 x 110g", vendor: "EESTI PAGAR AS", reliability: null, co2PerKg: 1.44, salesUnit: 'KI', packSize: 18, price: 7.58 },
  "pesto": { productId: '460979', name: "KNORR seasoning paste pesto 340g", vendor: "UNILEVER FINLAND OY SK KUIVA", reliability: 1.0, co2PerKg: 2.645, salesUnit: 'PRK', packSize: 0.34, price: 12.42 },
  "parmigiano": { productId: '471221', name: "Castelli parmigiano reggiano 12 months cheese 5x1kg", vendor: "CASTELLI 1892 SCANDINAVIA AB ITALIA", reliability: 0.948, co2PerKg: 5.115, salesUnit: 'KG', packSize: 1, price: 25.59 },
  "oregano": { productId: '467375', name: "Salliselta Oregano 800g", vendor: "MAUSTE-SALLINEN OY", reliability: null, co2PerKg: 4.975, salesUnit: 'ST', packSize: 0.8, price: 13.62 },
  "ice cream": { productId: '464967', name: "Suomen Jäätelö Vanilla ice cream 5l", vendor: "OY SUOMEN JÄÄTELÖ AB", reliability: null, co2PerKg: 0.79, salesUnit: 'ST', packSize: 5, price: 39.67 },
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
