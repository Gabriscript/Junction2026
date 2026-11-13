/**
 * Typed client interface for the 7 gateway tools, derived from the shared registry.
 * Step 7 adds implementations: HTTP (REST), MCP, and an in-memory mock built from
 * `@junction/shared/fixtures` so the agent runs before the real gateway is live.
 */
import { TOOLS, type ToolInput, type ToolName, type ToolOutput } from '@junction/shared';

export type GatewayClient = {
  [N in ToolName]: (input: ToolInput<N>) => Promise<ToolOutput<N>>;
};

/** Validate a tool input against the contract before sending it (throws ZodError). */
export function validateInput<N extends ToolName>(name: N, input: ToolInput<N>): void {
  TOOLS[name].input.parse(input);
}

/** Validate and parse a gateway response against the contract (throws ZodError). */
export function parseOutput<N extends ToolName>(name: N, output: unknown): ToolOutput<N> {
  return TOOLS[name].output.parse(output) as ToolOutput<N>;
}
