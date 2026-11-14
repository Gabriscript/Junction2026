import { SubstitutionPolicySchema } from '@junction/shared';
import { hotelMandate } from '@junction/shared/fixtures';
import { clean, runAgent } from './agent.js';
import { MockGateway, MOCK_ISSUER } from './gateway.js';
import { syntheticHistory, usualFromHistory } from './history.js';
import { HttpGateway } from './http-client.js';
import { createProvider } from './llm.js';

// usual order sizes from a synthetic 12-week history: the dataset has no order history
const DEMO_USUAL = usualFromHistory(syntheticHistory(7, 12, '2026-11-16'));
const text = process.argv.slice(2).join(' ') || 'I need 1,000 litres of lactose-free milk by Monday';

try {
  // LLM_PROVIDER defaults to none. GATEWAY_URL=http://localhost:8787 talks to the real gateway, otherwise the in-process mock.
  // The trust root is configuration: TRUST_JWKS_URL is both the pinned issuer and where its keys live. It must equal the
  // gateway's GATEWAY_PUBLIC_URL + /.well-known/jwks.json (localhost vs 127.0.0.1 counts), or every offer is rejected.
  // shortcut: the default derives it from GATEWAY_URL, so whoever answers there is trusted; fine for the local demo only,
  // which is why a non-local gateway must be HTTPS and should come with its own TRUST_JWKS_URL.
  const url = process.env.GATEWAY_URL?.replace(/\/+$/, '');
  if (url && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new Error('GATEWAY_URL must be https:// unless it is localhost');
  const jwksUrl = url && (process.env.TRUST_JWKS_URL || `${url}/.well-known/jwks.json`);
  const mock = new MockGateway();
  const gateway = url ? new HttpGateway(url) : mock;
  // SUBSTITUTION_POLICY=same_category shows step 8: a short cheap product topped up with a substitute
  const mandate = { ...hotelMandate, substitutionPolicy: SubstitutionPolicySchema.parse(process.env.SUBSTITUTION_POLICY ?? hotelMandate.substitutionPolicy) };
  const trust = jwksUrl ? { issuer: jwksUrl, jwks: new URL(jwksUrl) } : { issuer: MOCK_ISSUER, jwks: await mock.getJwks() };
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
