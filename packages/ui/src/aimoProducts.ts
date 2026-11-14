/**
 * The demo kitchen's items, matched by hand to real products in the Valio Aimo Junction 2026 product data
 * (data/raw/products.json, delivery-reliability.csv, carbon-footprint.csv; snapshot taken 2026-11-14).
 * reliability: share of past orders delivered as ordered (0-1); co2PerKg: product-group average. null = not in the files.
 * The challenge data is for Junction 2026 only.
 */
export interface AimoProduct {
  productId: string;
  name: string;
  vendor: string;
  reliability: number | null;
  co2PerKg: number | null;
}

export const AIMO_PRODUCTS: Record<string, AimoProduct> = {
  "milk": { productId: '463335', name: "Valio Eila® 3 % milk drink 1 l lactose free", vendor: "VALIO OY TUORE", reliability: 1.0, co2PerKg: 1.1 },
  "mozzarella": { productId: '463383', name: "Maestrella Mozzarella grated 21% 2,5kg lactose free", vendor: "EURIAL INTERNATIONAL", reliability: 0.969, co2PerKg: 5.21 },
  "tomatoes": { productId: '460027', name: "TOMATO NL/BE/ES 1.CL", vendor: "STAAY FOOD GROOP B.V.", reliability: 0.999, co2PerKg: 1.96 },
  "fries": { productId: '461203', name: "McCain original country style fries 2,5kg frozen", vendor: "MCCAIN FOODS EUROPE BV", reliability: 0.999, co2PerKg: 0.39 },
  "basil": { productId: '460533', name: "BASIL FRESH 1KG BOX", vendor: "STAAY FOOD GROOP B.V.", reliability: 0.938, co2PerKg: 0.38 },
  "flour": { productId: '460091', name: "Myllärin Special Wheat flour 20 kg", vendor: "HELSINGIN MYLLY OY", reliability: null, co2PerKg: 0.77 },
  "olive oil": { productId: '462909', name: "VOT 5L EXTRA VIRG OLIVEOIL", vendor: "VALIO OY / VALIO AIMO", reliability: 0.996, co2PerKg: 2.11 },
  "salt": { productId: '460215', name: "Berner Sea salt medium coarse 25 kg", vendor: "BERNER OY /AGENTUURI", reliability: null, co2PerKg: 0.42 },
  "wurstel": { productId: '463022', name: "SAUSAGE WIENER 1KG", vendor: "VALIO OY / VALIO AIMO", reliability: null, co2PerKg: 4.92 },
};
