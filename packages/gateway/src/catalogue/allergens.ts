/**
 * GS1 AllergenTypeCode → English name.
 *
 * The portal dataset ships codes only. `GS1_ALLERGEN_NAMES` in the shared contract covers
 * the common EU-14 codes; this module adds the remaining codes the loader met in the
 * dataset. Unknown codes are kept verbatim and get no name (never guessed).
 */
import { GS1_ALLERGEN_NAMES } from '@junction/shared';

const EXTRA_GS1_ALLERGEN_NAMES: Readonly<Record<string, string>> = {
  ABD: 'bovine (beef) products',
  ADQ: 'pulses / legumes',
  BF: 'beef',
  BP: 'pork',
  CM: 'cocoa',
  GK: 'kamut',
  ML: 'lactose',
  NC: 'cocoa',
  NE: 'peas',
  NK: 'coriander',
  NM: 'maize (corn)',
  NP: 'peanuts (other)',
  NW: 'carrot',
  PN: 'pine nuts',
  PO: 'poultry',
  SO: 'other seeds',
  ST: 'tree nut traces',
  UN: 'other',
  X99: 'other / unspecified',
};

export const ALL_GS1_ALLERGEN_NAMES: Readonly<Record<string, string>> = {
  ...EXTRA_GS1_ALLERGEN_NAMES,
  ...GS1_ALLERGEN_NAMES,
};

export function allergenName(code: string): string | undefined {
  return ALL_GS1_ALLERGEN_NAMES[code];
}
