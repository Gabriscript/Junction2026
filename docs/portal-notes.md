# Valio Aimo Junction 2026 — Resource Portal Digest

Researched 2026-11-13 (read-only). Portal: https://junction26.valioaimo.fi/ (event-password gated; password and API key are deliberately NOT recorded here — both are on the Junction platform / given by organisers).

---

## 1. Portal map

The portal is a **single page** behind a password gate (`/login`, session cookie, 12 h). No team/rules/submission pages exist on it. Everything on it:

| Section | Resource | Link (relative to portal) | Format / size |
|---|---|---|---|
| General | Bullet list of the 6 challenge materials (pricing API, availability API, product data, JSON schema, delivery reliability, carbon footprint) | `/` | HTML |
| Data → Product data | Full product data set | `/files/32825daf25fcd6023c3b43028cf0b191/valio_aimo_junction26_product_data.json` | JSON array, **87.1 MB**, 17 546 products |
| Data → Product data | JSON Schema for the above | `/files/008f9a50ba9a6538d2e5bdf29d592af8/valio_aimo_junction26_product_data_schema.json` | JSON Schema, 30 KB |
| Data → Delivery reliability | Reliability per product, 0–1 | `/files/fc0b960c5db8a49fb3b85e02a7f70b78/valio_aimo_junction26_delivery_reliability.csv` | CSV, 57 KB, 4 425 rows |
| Data → Carbon footprint | Avg kg CO2-eq/kg per product (product-group average) | `/files/6d3b5d4ee6de9b5153b70beb27812efe/valio_aimo_junction26_carbon_footprint.csv` | CSV, 157 KB, 11 033 rows |
| API documentation | Swagger UI | `/docs` | Swagger shell loading `/openapi.json` |
| API documentation | ReDoc | `/redoc` | ReDoc shell loading `/openapi.json` |
| API documentation | OpenAPI 3.1 JSON | `/openapi.json` | JSON (GET only; HEAD returns 405) |
| Authentication | Note: everything under `/api` needs `X-API-Key` header; key is on the Junction platform | `/` | — |
| Logout | `/logout` | — | — |

All `/files/...` links are served with `Content-Disposition: attachment` (browser downloads them; they do not render inline). The same files are also reachable via the API's `/api/*/download` redirect endpoints (see below).

Portal statements worth quoting: "While inspired by real world, this dataset does not contain fully accurate product information and it must not be used for anything outside of this challenge." Files "do not change during the challenge unless announced separately."

No AI-directed instructions / prompt-injection content was found anywhere in the portal, OpenAPI spec, schema or data headers.

---

## 2. API reference

- **Base URL:** `https://junction26.valioaimo.fi`
- **Auth:** API key in HTTP header `X-API-Key: <key>` (OpenAPI security scheme `APIKeyHeader`). Missing/invalid key → `401 {"detail":"Invalid or missing API key"}` with `WWW-Authenticate: ApiKey`.
- **Rate limits:** "Undisclosed rate limits are in place." No rate-limit headers are returned (only Cloudflare headers, `cache-control: no-store`). Organisers explicitly say: **do not poll prices/availability for all products**; narrow down via static product data first, then query only the shortlist.
- **Pagination:** none. Batch size is the only paging mechanism: 1–1 000 product codes per request; >1 000 → HTTP 422.
- **Customer parameter:** required string, but **ignored by the mock** ("customer number does not affect response so you can pass in whatever"). In reality prices and availability are customer-specific.
- **Dates:** `requestedDate` = desired delivery date, ISO `YYYY-MM-DD`. Timestamps come back as Helsinki local time with offset (`+0200`/`+0300`).
- **Errors:** FastAPI/pydantic style `422 {"detail":[{"type","loc","msg","input","ctx"}]}` for malformed body (bad date string, empty list, >1000 items). Unknown product IDs do NOT error at HTTP level: price returns the product with `error: true` and no price blocks; availability returns it with `scheduleLines: []`.
- **No order / checkout / quote / cart / customer endpoints exist.** Fixed-price ordering, mandates, approvals etc. must be built entirely by the team on top of the read APIs. Prices do carry `validFrom`/`validTo` windows, which is the only "fixed price" primitive the backend offers.

### Endpoints

| Method | Path | Tag | Purpose |
|---|---|---|---|
| GET | `/api/ping` | On-demand | Health/auth check → `{"status":"ok"}` |
| POST | `/api/price` | On-demand | Prices for up to 1 000 products on a date |
| POST | `/api/availability` | On-demand | Deliverability + quantity for up to 1 000 products on a date |
| GET | `/api/products/download` | File downloads | 307 redirect to the product JSON file (use `curl -L`) |
| GET | `/api/delivery-reliability/download` | File downloads | 307 redirect to the reliability CSV |
| GET | `/api/carbon-footprint/download` | File downloads | 307 redirect to the carbon CSV |

Both POST endpoints are pure read queries (no state change) sharing one request body:

```json
{"customer": "123", "requestedDate": "2026-11-16", "products": ["460013","460063","463989","460056"]}
```

#### POST /api/price — real response (trimmed)

```json
{
  "customerId": "123", "currency": "EUR", "pricingDate": "2026-11-16T00:00:00+0200",
  "products": [
    {
      "productId": "460063", "quantity": 1.0,
      "catalogPrice":   {"value": 64.17, "valueWithTax": 80.53, "validFrom": "2026-06-01T00:00:00+0300", "validTo": "2026-12-31T00:00:00+0200", "currency": "EUR"},
      "priceWithTax":   {"value": 80.53, "validFrom": "...", "validTo": "...", "currency": "EUR"},
      "comparisonPrice":{"value": 6.42, "valueWithTax": 8.06, "...": "..."},
      "comparisonUnit": "L",
      "tax": {"taxRate": 25.5, "taxValue": 16.36},
      "listPrice":      {"value": 80.22, "valueWithTax": 100.68, "validFrom": "2026-05-01T00:00:00+0300", "validTo": "9999-12-31T00:00:00+0200", "currency": "EUR"},
      "netPriceFound": true, "error": false
    },
    {"productId": "460056", "...": "...", "comparisonPrice": null, "comparisonUnit": null, "netPriceFound": false, "error": false},
    {"productId": "000000", "quantity": 1.0, "netPriceFound": false, "error": true}
  ]
}
```

Field semantics (from spec): `quantity` always 1.0; `catalogPrice` = price per sales unit ex-tax (`value`) / incl. tax (`valueWithTax`); `listPrice` = price before customer-specific price/discount; `netPriceFound` true when a customer-specific net price was used (false → catalog price used); `comparisonPrice`/`comparisonUnit` = per KG or L (can be null, e.g. non-food); `tax.taxRate` is the official VAT source of truth (13.5 % food, 25.5 % standard, 10 % low); `validFrom`/`validTo` = validity window (`9999-12-31` = open-ended); `error` true = no price found.

Observed: the mock returned the same price for 460063 on 2027-01-05 even though its `validTo` is 2026-12-31 → **the mock does not appear to enforce validity windows against `requestedDate`**; treat `validTo` as data to reason about, not behaviour to rely on.

#### POST /api/availability — real response (trimmed)

```json
{
  "timeNow": "2026-11-13T19:59:44+0200", "requestedDate": "2026-11-16T00:00:00+0200",
  "products": [
    {"productId": "460013", "salesBlock": false, "scheduleLines": []},
    {"productId": "460063", "closingTime": "2026-11-12T15:00:00+0200", "salesBlock": false, "logisticModel": "Terminal",
     "scheduleLines": [{"salesBlock": false, "availableAmount": 999999.0, "availableDate": "2026-11-16", "salesUnit": "KI"}]},
    {"productId": "463989", "closingTime": "2026-11-13T12:30:00+0200", "salesBlock": true, "logisticModel": "Terminal",
     "scheduleLines": [{"salesBlock": true, "availableAmount": 999999.0, "availableDate": "2026-12-30", "salesUnit": "ST"}]},
    {"productId": "460056", "closingTime": "2026-11-15T17:00:00+0200", "salesBlock": false, "logisticModel": "Stock",
     "scheduleLines": [{"salesBlock": false, "availableAmount": 63.0, "availableDate": "2026-11-16", "salesUnit": "PAK"}]},
    {"productId": "460027", "closingTime": "2026-11-15T17:00:00+0200", "salesBlock": false, "logisticModel": "Stock",
     "scheduleLines": [{"salesBlock": false, "availableAmount": 9999999999.0, "availableDate": "2026-11-16", "salesUnit": "KG"}]}
  ]
}
```

Field semantics: `closingTime` = order cut-off to receive goods on `availableDate`; `salesBlock` true = cannot be ordered now; `logisticModel` `Stock` (Valio Aimo warehouse; real quantity known) vs `Terminal` (shipped from supplier; quantity unknown → `availableAmount` always 999999); `scheduleLines` has exactly 0 or 1 entries — empty = cannot be delivered on any date currently; `availableDate` may differ from `requestedDate` (earliest date). Some Stock lines show 9999999999 (effectively unlimited, e.g. variable-weight produce).

Observed: querying 460056 for 2026-11-20 returned the identical line (`availableDate` 2026-11-16, same `closingTime`) → **availability does not seem to recompute per requested date in the mock**; `closingTime` may already be in the past relative to `timeNow`. Whether stock levels drift over time was not verified (would need repeated polling).

---

## 3. Datasets

### 3.1 Product data JSON (`valio_aimo_junction26_product_data.json`) — 17 546 products, 87 MB
Array of product objects. IDs are 6-digit strings `460000`…`477545`; same IDs used by the APIs and CSVs. All products have `deleted: false`.

Top-level fields (coverage out of 17 546): `id` 100 %, `salesUnit` 100 %, `baseUnit` 100 %, `category` 100 % (349 distinct numeric codes, **names not provided**), `allowedLotSize` 100 % (0.01 for 96 %; else 1–10), `temperatureCondition` 99.7 % (codes 1–9, **meanings not provided**; 8 = 57 %, 7 = 18 %), `vendorName` 100 % (648 vendors; top: Duni, Valio Oy Tuore, Atria, HKFoods, Feelia), `countryOfOrigin` 99.9 % (ISO alpha-2 lowercase; fi 45 %, de, it, se, cn, nl, fr…), `salesUnitGtin` 99 %, `units` 100 % (packaging hierarchy with per-level GTIN and `sizeInBaseUnits`), `deposits` 2.9 % (506; returnable packaging items), `substitutions` **1.1 % (189 products, 250 rules)**, `synkkaData` 100 % (object, but sparse).

`synkkaData` sub-field coverage: `names` 100 % (fi + en, some sv), `classifications` 99.9 %, `gtin` 82.5 %, `brand` 82.4 % (1 500 brands), `countriesOfOrigin` 82.4 % (numeric ISO), `producers` 82.5 % (id = GLN + name), `unitConversions` 82.5 % (net/gross weight, dimensions, **volume** per packaging level), `variableUnit` 82.5 % (true for 632), `vatCode` 82.5 %, `keyIngredients` 80 % (free text), `nutritionalContent` **69.8 % (12 251)**, `marketingTexts` 68 %, `medias` 76 % (ids only, no files), `storageInstructions` 49 %, `minTemperature`/`maxTemperature` ~58 %, `disposalInformations` 26 %, `ingredients` (structured, with origins & %) **21 % (3 746)**, `usageInstructions` 21 %, `preparationInstructions` 20 %, `safetyData` 3.8 % (667, hazard codes for chemicals), `fishingReports` 2 % (353).

`classifications` groups (present on 17 535 products, but `values` arrays are often empty):
- `allergen` — ENUM, `unit` ∈ {CONTAINS, MAY_CONTAIN}; 93 distinct (code,relation) pairs; codes are GS1 allergen codes (AM milk 3 160 CONTAINS, AW wheat/gluten 2 794, UW gluten-containing cereals 2 550, AE egg, AN tree nuts, AY soy, SA/SH/AS…). **Code→name mapping is not provided.**
- `nonAllergen` — `FREE_FROM` declarations; 40 codes (UM, AC, NL, AU, BC, AF, AP, AS, BM, AN, AE, AY…). ~4 600 products declare something free-from.
- `nutritionalClaim` — 24 pairs: **`LACTOSE FREE_FROM` 4 178**, `GLUTEN FREE_FROM` 3 047, `VEGAN DIET` 2 959, `VEGETARIAN DIET` 2 358, preservatives/colouring/additives free-from, `SUGARS NO_ADDED`, `FIBRE HIGH`, `PROTEIN HIGH`, `SODIUM_SALT LOW`…
- `packagingMarkedLabel` — 19 labels: storage-temp markers (warm/cool/freeze) plus **certification/sustainability labels**: GOODS_FROM_FINLAND_BLUE_SWAN 2 057, MADE_IN_FINLAND_FLAG_WITH_KEY 1 772, FINNISH_HEART_SYMBOL 826, EU_ORGANIC_FARMING 456, SVANEN 362, RAINFOREST_ALLIANCE 234, EU_ECO_LABEL 195, MARINE_STEWARDSHIP_COUNCIL_LABEL 104, FAIR_TRADE_MARK 92.
- `nutritionFact` / `gda` — DECIMAL per 100 g: ENER-KJO, ENER-E14, FAT, FASAT, CHOAVL, SUGAR-, FIBTG, PRO-, SALTEQ, LACS (lactose, 3 572 products), FAPUCIS, POLYL.
- `vitamin`, `mineral`, `composition` — sparse.

Sample product (trimmed): `{"id":"460027","salesUnit":"KG","baseUnit":"KG","category":"17401","allowedLotSize":0.01,"temperatureCondition":5,"vendorName":"STAAY FOOD GROOP B.V.","countryOfOrigin":"ma","synkkaData":{"names":[{"value":"TOMATO NL/BE/ES 1.CL","language":"en"},{"value":"TOMAATTI NL/BE/ES 1.LK","language":"fi"}],"classifications":[...],"nutritionalContent":[{"id":"ENER-E14","value":23.0,"unit":"E14","basisQuantity":100.0,"basisQuantityUnit":"GRM"}, ...]},"units":[{"unitId":"KG","gtin":"2300110100000","sizeInBaseUnits":1.0},{"unitId":"KI","sizeInBaseUnits":6.0}],"substitutions":[{"product":"460027","substituteProduct":"460065"}]}`

Sparsest products look like `{"id":"465611","salesUnit":"ST","vendorName":"FINNFROST OY","synkkaData":{"names":[{"value":"NÄYTE","language":"fi"}],"classifications":[...all empty...],"nutritionalContent":[]}, ...}` (no GTIN, no brand, no country). Non-food (Duni napkins, Tork, chemicals, glassware) is a large share of the catalogue.

Sales units (codes only, no translation): KI 8 005, ST 5 607, KG 1 068, PAK 880, BAG 697, RAS 328, PRK 320, BOT 310, SK, CS, KLE, KRT, KAN, PAL…

### 3.2 Delivery reliability CSV — 4 425 rows (25 % of products)
Header: `productId,deliveryReliability`. Values 0.0–1.0; mean 0.972, median 1.0; 3 847 rows are ≥0.95, 380 in the 0.9 band, ~200 below 0.85, 13 at 0.0. Sample: `460001,1.0`.

### 3.3 Carbon footprint CSV — 11 033 rows (63 % of products)
Header: `productId,AVG kg CO2-eq/kg`. Range 0.13–30.46, mean 3.61, median 2.11; only **177 distinct values** (it is a per-product-group average, so many products share a value, e.g. 1.44 ×482, 2.11 ×377). Sample: `460000,2.315`.

### 3.4 JSON Schema — 30 KB
Describes 3.1 field by field (summarised above). Explicitly notes: unit codes (KI etc.), category codes, temperature codes, fishing area/method codes and hazard codes have **no translations in the data set**.

---

## 4. Field availability check

| Need | Answer | Where |
|---|---|---|
| Allergens | **Yes (partial coverage)** | `synkkaData.classifications[name=allergen].values[]` (`synkkaId`/`id` code + `unit` CONTAINS/MAY_CONTAIN) and `[name=nonAllergen]` (FREE_FROM). Group present on 99.9 %, but populated mainly on packaged food; produce often empty. Codes are GS1 2-letter codes with no lookup table. |
| Nutrition | **Yes (70 %)** | `synkkaData.nutritionalContent[]` (id, value, unit, basisQuantity) and `classifications[nutritionFact/gda]` |
| Certificates / sustainability labels | **Yes** | `classifications[name=packagingMarkedLabel]`: EU_ORGANIC_FARMING, SVANEN, EU_ECO_LABEL, RAINFOREST_ALLIANCE, MSC, FAIR_TRADE_MARK, Finnish origin marks |
| Carbon footprint ranges | **Partial** | Carbon CSV `AVG kg CO2-eq/kg` for 63 % of products; group average, not a range or per-product measurement; no per-unit conversion unless you use `unitConversions.netWeight` |
| Origin / country | **Yes** | `countryOfOrigin` (alpha-2, 99.9 %), `synkkaData.countriesOfOrigin` (numeric), `ingredients[].origins[]` (stage-level, 21 %), `producers[]`, `fishingReports` |
| Delivery lead times | **Partial** | Availability API: `closingTime` (cut-off) + `availableDate` per product; no transit time / route / delivery slot data |
| Delivery reliability | **Yes (25 % of products)** | Reliability CSV, 0–1 historical fill rate |
| Supplier | **Yes** | `vendorName` (648), `synkkaData.brand`, `synkkaData.producers[]` (GLN + name); availability `logisticModel` tells Stock vs Terminal (supplier-shipped) |
| Stock / availability behaviour | **Partial** | Quantity only for `Stock` items (`availableAmount` in `salesUnit`); `Terminal` always 999999; `salesBlock`; single-warehouse view (no per-warehouse); mock appears static per product regardless of `requestedDate`; time-drift not verified; "partial stock" expressible as availableAmount < requested qty |
| Units / pack sizes (litres etc.) | **Yes** | `salesUnit`, `baseUnit`, `units[].sizeInBaseUnits`+gtin, `allowedLotSize`, `synkkaData.unitConversions[]` (netWeight, grossWeight, volume LTR/MLT, dimensions per BASE_UNIT/CASE/PALLET), `variableUnit`; price API `comparisonPrice`/`comparisonUnit` (KG or L). Unit codes untranslated. |
| Customer-specific / contract pricing | **Partial (modelled, not live)** | Price API has `listPrice` vs `catalogPrice` and `netPriceFound` flag, plus `validFrom/validTo`; but `customer` is ignored by the mock so every customer gets identical prices |
| Categories / attributes like lactose-free | **Yes** | `category` (349 numeric codes, no names); `classifications[nutritionalClaim]` LACTOSE FREE_FROM (4 178), GLUTEN FREE_FROM, VEGAN, VEGETARIAN…; `nutritionFact LACS` value; names text (786 mention lactose) |
| Substitution / related products | **Partial (very sparse)** | `substitutions[]` on only 189 products / 250 rules; otherwise derive via `category` + claims + allergens |
| Customer accounts / standing-order history | **No** | Nothing in portal, API or datasets; must be synthesised |

---

## 5. Rules, constraints, judging, deadlines, submission, webshop accounts

Stated on the portal / in the OpenAPI spec:
- Data is "inspired by real world", not accurate, and **must not be used for anything outside of this challenge**.
- Files do not change during the challenge unless announced separately; retrieve once.
- Solutions **should not be based on frequently retrieving prices and availabilities for all products**; narrow via static data first. Undisclosed rate limits exist.
- Max 1 000 products per API request (422 otherwise). All `/api` calls need the `X-API-Key` header; key is distributed via the Junction platform.
- Availability/prices are customer-specific in reality but not in the mock.

**Not stated anywhere on the portal:** judging criteria, deadlines, submission format, team rules, webshop (toimitustukku) test accounts, order endpoints, approval flows, or any evaluation rubric. Those must come from the Junction platform challenge brief, not this portal.

---

## 6. Verdict on planned ideas

| Idea | Support | Notes |
|---|---|---|
| (a) Signed verifiable offers (price + stock + origin claims) | **Well supported** | Price API gives price, tax, `validFrom/validTo`, `netPriceFound`; availability gives qty/date/cut-off; origin from product data + labels. We generate the signature layer ourselves (nothing in the backend signs anything). Caveat: mock does not enforce `validTo`, so "fixed price until X" is our contract wrapper, not backend behaviour. |
| (b) Buyer mandate + policy engine with approval reason codes | **Well supported (all ours)** | No backend support for orders or approvals, so this is pure team-built logic; the data gives good reason-code triggers: `salesBlock`, `availableAmount` < qty, `availableDate` ≠ requested, `closingTime` passed, `netPriceFound` false (no contract price), price > listPrice threshold, allergen conflict, reliability < threshold, Terminal vs Stock, `allowedLotSize` violation. |
| (c) Tiered data disclosure by agent identity | **Partial** | API has no identity tiers (one key, customer ignored). Fully simulable in our gateway: e.g. anonymous agent sees listPrice only, mandated agent sees catalog/net price, trusted agent sees stock quantities. Data supports the tiers; backend does not. |
| (d) Allergen-safe good-better-best substitution | **Partial → good with work** | Allergen CONTAINS/MAY_CONTAIN/FREE_FROM and LACTOSE/GLUTEN/VEGAN claims exist for most packaged food; native `substitutions` cover only 189 products, so candidates must be derived from `category` (codes only, no names) + claims + comparison price + nutrition. Produce/non-food have empty allergen arrays → must treat "unknown" as unsafe. Need to hand-build a small GS1 allergen code → name map (AM milk, AW wheat, AE egg, AN nuts, AY soy…). |
| (e) Delivery-reliability + sustainability ranking | **Partial** | Reliability covers only 25 % of products (and 87 % of those are ≥0.95 — little spread); carbon covers 63 % but is a group average with 177 distinct values; labels (organic, MSC, Fairtrade, Finnish origin) add signal. Works as a tie-breaker / flag, weak as a primary ranking. Handle missing values explicitly. |
| (f) Standing-order drift detection | **Not supported by data; synthesisable** | No order history, no customer accounts. We'd fabricate a standing-order basket and detect drift against live price (`listPrice` vs `catalogPrice`, validity changes), availability (`salesBlock`, qty), and product deletion. Price/availability drift over time was NOT observed in the mock (looked static), so demo drift may need to be injected. |
| (g) Recipe-based substitution | **Partial** | Nutrition per 100 g (70 %), structured `ingredients` only 21 %, `keyIngredients` free text 80 %, pack sizes/volumes available; category names missing makes "find a cream" rely on name text (fi/en) search. Feasible for a curated demo set, not catalogue-wide. |

---

## 7. Surprises / gotchas

1. **There is no order, checkout, quote, cart, customer or account endpoint.** The "order at fixed prices" and "route to human approval" parts of the challenge are entirely ours to design; the mock only answers price and availability. Plan an own backend/MCP layer that wraps these two calls.
2. **Both data endpoints are POST** (read-only queries). Fine to call; just never treat them as writes.
3. **Customer ID is ignored** by the mock — customer-specific pricing (`netPriceFound`, listPrice vs catalogPrice) is present in the shape but identical for everyone. The demo must simulate customer tiers ourselves.
4. **Mock seems date-insensitive:** same availability line returned for 2026-11-16 and 2026-11-20 (with `availableDate` earlier than requested); an expired `validTo` price still returned for 2027. Do not build the demo on the backend changing over time; inject change in our own layer if drift is a theme.
5. **Rate limits are undisclosed** and organisers explicitly discourage bulk polling. Load the 87 MB product file once, filter locally, batch ≤1 000 IDs, cache responses.
6. **Codes lack lookups:** category (349), salesUnit (KI, ST, PAK…), temperatureCondition (1–9), GS1 allergen codes, fishing areas, hazard codes all have no names. Allergen names must be hand-mapped; category names cannot be shown to users without our own mapping (use product names instead).
7. **Data sparsity is uneven:** 30 % lack nutrition, 18 % lack brand/GTIN/vendor-level Synkka data, produce and non-food typically have empty allergen arrays. Non-food (napkins, chemicals with safety data, glassware) is a big share — filter it out for food demos.
8. **Native substitutions are nearly absent** (189 products). Substitution logic must be derived, which is a feature for us, not a shortcut from them.
9. **Reliability and carbon are partial and low-variance**: 75 % of products have no reliability value; carbon is a group average. Design UI to show "no data" honestly rather than defaulting to 1.0 / 0.
10. **Terminal products always report 999999** availability — "in stock" for them is a claim about the supplier, not a verified quantity; a verifiable-offer design should mark Terminal lines as "unverified quantity".
11. Portal `/files/...` links force download (attachment); the OpenAPI `/api/*/download` endpoints 307-redirect to the same files (use `curl -L` with the key).
12. Unknown product IDs return 200 with `error: true` / empty `scheduleLines` rather than 404 — validate IDs against the product file before trusting responses.
