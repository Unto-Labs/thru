/* The perps actions as LLM tools.

   perpsToolDefinitions(client) gives one tool per action the deployment's
   ABI version supports, each with a JSON Schema of its input
   ({ name, description, input_schema }: the shape Anthropic's Messages API
   takes as `tools`; rename input_schema to `parameters` for others).
   callPerpsTool runs a tool call and returns JSON the model can read:
   { ok: true, result } or { ok: false, error: { message, kind, code, retryable } }.
   Transaction tools sign and send with the configured signer, or return
   the unsigned transaction when there is none (a human or another service
   signs it).

     PERPS_DEPLOYMENT=deployment.betanet.json [PERPS_KEY_FILE=key.json] npx tsx agent-tools.ts */

import { readFileSync } from 'node:fs';
import {
  createPerpsClient,
  describePerpsActions,
  keypairSignerFromJSON,
  perpsToolDefinitions,
  runPerpsAction,
  type PerpsActionResult,
  type PerpsClient,
  type PerpsSigner,
} from '@thru/programs/perps';

export async function perpsAgentTools(client: PerpsClient, signer?: PerpsSigner) {
  const takesOwner = new Set(describePerpsActions(client).filter((action) => action.parameters.properties?.owner).map((action) => action.name));
  return {
    tools: perpsToolDefinitions(client),
    /** Handles one tool_use block: name "perps_<action>", input the model's JSON. */
    async callPerpsTool(name: string, input: Record<string, unknown>): Promise<PerpsActionResult> {
      const action = name.replace(/^perps_/, '');
      /* The agent acts for the signer: default `owner` to it. */
      const params = signer && takesOwner.has(action) && !('owner' in input) ? { ...input, owner: signer.address } : input;
      return runPerpsAction(client, action, params, { signer });
    },
  };
}

const deployment = JSON.parse(readFileSync(process.env.PERPS_DEPLOYMENT ?? 'deployment.betanet.json', 'utf8'));
const signer = process.env.PERPS_KEY_FILE ? keypairSignerFromJSON(JSON.parse(readFileSync(process.env.PERPS_KEY_FILE, 'utf8'))) : undefined;
const client = await createPerpsClient({ deployment, indexerUrl: process.env.PERPS_INDEXER_URL });
const { tools, callPerpsTool } = await perpsAgentTools(client, signer);

console.log(`${tools.length} tools: ${tools.map((tool) => tool.name).join(', ')}`);
/* What a model's tool calls look like when passed through: */
console.log(JSON.stringify(await callPerpsTool('perps_getMarkets', {}), null, 2).slice(0, 2_000));
const first = client.deployment.markets[0]!.symbol;
console.log(JSON.stringify(await callPerpsTool('perps_getFunding', { market: first }), null, 2));
/* With an Anthropic client this is:
     const response = await anthropic.messages.create({ model, max_tokens, tools, messages });
     for (const block of response.content) if (block.type === 'tool_use')
       results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(await callPerpsTool(block.name, block.input)) }); */
