import { SubstitutionPolicySchema } from '@junction/shared';
import { hotelMandate } from '@junction/shared/fixtures';
import { clean, runAgent } from './agent.js';
import { MockGateway, MOCK_ISSUER } from './gateway.js';
import { createProvider } from './llm.js';

// synthetic usual order sizes: the dataset has no order history
const DEMO_USUAL = { milk: { quantity: 500, unit: 'L' as const, period: 'week' } };
const text = process.argv.slice(2).join(' ') || 'I need 1,000 litres of lactose-free milk by Monday';

try {
  // LLM_PROVIDER defaults to none; the gateway is the in-process mock until the real one exists
  const gateway = new MockGateway();
  // demo setup: the trust root is read once from the mock's published keys; a real deployment pins issuer and JWKS URL in config
  // SUBSTITUTION_POLICY=same_category shows step 8: a short cheap product topped up with a substitute
  const mandate = { ...hotelMandate, substitutionPolicy: SubstitutionPolicySchema.parse(process.env.SUBSTITUTION_POLICY ?? hotelMandate.substitutionPolicy) };
  const trust = { issuer: MOCK_ISSUER, jwks: await gateway.getJwks() };
  const result = await runAgent(text, { llm: createProvider(), gateway, now: () => new Date(), trust, mandate, usual: DEMO_USUAL, confirmUnusual: process.env.CONFIRM_QUANTITY === '1' }); // demo mandate from the shared fixtures
  console.log(`Request: ${text}\n`);
  result.trace.forEach((step, index) => {
    console.log(`${index + 1}. ${step.action}\n   in:  ${step.input}\n   out: ${step.output}`);
  });
  if (result.order?.rationale) console.log(`\nRationale for the approver:\n${result.order.rationale.split('\n').map((line) => clean(line, 300)).join('\n')}`);
  for (const warning of result.warnings ?? []) console.log(`\nQuestion for the chef: ${warning} (rerun with CONFIRM_QUANTITY=1 to order anyway)`);
  const reasons = result.decision.reasonCodes.join(', ') || 'none';
  console.log(`\nDecision: ${result.decision.status} (reason codes: ${reasons})${result.order ? `, order ${clean(result.order.orderId)}` : ', no order placed'}`);
} catch (error) {
  console.error(`Agent failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
