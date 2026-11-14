// The agent-internal need. Everything exchanged with the gateway comes from @junction/shared.
import { GS1_ALLERGEN_NAMES } from '@junction/shared';
import { z } from 'zod';

export const Unit = z.enum(['L', 'KG', 'ST']); // the net-content units of @junction/shared search_products
export type Unit = z.infer<typeof Unit>;

export const StructuredNeed = z.object({
  quantity: z.number().positive(),
  unit: Unit,
  productQuery: z.string().min(1),
  attributes: z.array(z.string().regex(/^[A-Z][A-Z_]*$/)), // codes, e.g. LACTOSE_FREE
  freeFromAllergens: z.array(z.string().refine((code) => code in GS1_ALLERGEN_NAMES, 'not a known GS1 allergen code')),
  deliveryBy: z.iso.date().nullable(), // null = the request gave no date
});
export type StructuredNeed = z.infer<typeof StructuredNeed>;
