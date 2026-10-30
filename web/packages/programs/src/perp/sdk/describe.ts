import type { PerpsBuilt, PerpsClient } from './client';
import { TransactionFailedError, TransactionTimeoutError } from './errors';
import { toJsonSafe, type JsonSafe } from './json';
import type { PerpsSigner } from './signers';
import { perpTransactionToJSON } from './tx';

/* The SDK's actions as tool definitions.

   describePerpsActions() lists every action with a JSON Schema of its
   parameters (draft 2020-12 subset: type, properties, required, enum,
   pattern, description), so an LLM agent can call them as tools;
   runPerpsAction(client, name, params, { signer }) validates the params,
   runs the action and returns JSON-safe output (bigints as strings).  A
   build action returns the unsigned transaction; with a signer (and
   `send: true`, the default when a signer is given) it is signed, sent and
   confirmed, and the result is its signature. */

export type JsonSchema = {
  type?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
};

export interface PerpsActionDescription {
  name: string;
  kind: 'read' | 'transaction';
  description: string;
  /** JSON Schema of the params object. */
  parameters: JsonSchema;
  /** Feature flag the deployment's ABI version must have, if any. */
  requires?: 'crossMargin' | 'funding' | 'settleFunding';
}

const address: JsonSchema = { type: 'string', pattern: '^ta[A-Za-z0-9_-]{44}$', description: 'Thru address (ta...)' };
const market: JsonSchema = { type: 'string', description: 'Market symbol (e.g. BTC-THRUSD) or seat arena address' };
const owner: JsonSchema = { ...address, description: 'Seat authority / wallet address the transaction acts for (the signer)' };
const atoms: JsonSchema = { type: 'string', pattern: '^\\d+$', description: 'Integer amount in on-chain atoms, as a decimal string' };
const decimal: JsonSchema = { type: 'string', pattern: '^\\d+(\\.\\d+)?$', description: 'Human decimal amount' };
const orderSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['side'],
  properties: {
    side: { type: 'string', enum: ['buy', 'sell'] },
    orderType: { type: 'string', enum: ['gtc', 'ioc', 'fok', 'alo', 'mtl'], description: 'gtc (default): rest; ioc: fill what crosses then drop; fok: fill all or nothing; alo: post-only; mtl: market-to-limit' },
    postOnly: { type: 'boolean', description: 'Same as orderType alo' },
    price: { ...decimal, description: 'Price in quote per base unit (give price or priceAtoms)' },
    priceAtoms: { ...atoms, description: 'Price in quote atoms per base atom, a multiple of the tick size' },
    size: { ...decimal, description: 'Size in base units (give one of size, quantityAtoms, lots)' },
    quantityAtoms: { ...atoms, description: 'Size in base atoms, a multiple of the lot size' },
    lots: { ...atoms, description: 'Size in lots' },
    clientId: { type: 'string', pattern: '^[0-9a-fA-F]{32}$', description: '16-byte client id as hex' },
    rounding: { type: 'string', enum: ['exact', 'down', 'up', 'nearest'], description: 'Round a human price/size onto the grid (default exact: fail when off-grid)' },
  },
};
const obj = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({ type: 'object', additionalProperties: false, properties, required });

const ACTIONS: readonly PerpsActionDescription[] = [
  { name: 'getMarkets', kind: 'read', description: "Every market of the deployment with its on-chain state (margins, funding, open interest).", parameters: obj({}, []) },
  { name: 'getMarket', kind: 'read', description: 'One market and its on-chain state.', parameters: obj({ market }, ['market']) },
  { name: 'getBook', kind: 'read', description: 'Aggregated order book levels (price, lots, order count) per side.', parameters: obj({ market, depth: { type: 'integer', minimum: 1, maximum: 200 } }, ['market']) },
  { name: 'getMark', kind: 'read', description: "The market's oracle mark price (quote atoms per base atom); null with an error when the feed is stale.", parameters: obj({ market }, ['market']) },
  { name: 'getFunding', kind: 'read', description: "The market's funding state: rate (ticks of 1e-6 per hour, positive: longs pay), index, next round.", parameters: obj({ market }, ['market']) },
  { name: 'getSeat', kind: 'read', description: "The owner's seat (position, collateral, open order lots) in a market, or null.", parameters: obj({ market, owner }, ['market', 'owner']) },
  { name: 'getMarginAccounts', kind: 'read', description: "The owner's cross margin accounts and their linked seats.", parameters: obj({ owner }, ['owner']), requires: 'crossMargin' },
  { name: 'getOpenOrders', kind: 'read', description: "The owner's resting orders in a market.", parameters: obj({ market, owner }, ['market', 'owner']) },
  { name: 'createSeat', kind: 'transaction', description: 'Create the owner\'s seat in a market (needed once per market before trading).', parameters: obj({ market, owner }, ['market', 'owner']) },
  {
    name: 'placeOrder',
    kind: 'transaction',
    description: 'Place one order on the owner\'s seat (isolated or cross); requests the state units the order needs.',
    parameters: { ...orderSchema, required: ['market', 'owner', 'side'], properties: { market, owner, ...orderSchema.properties } },
  },
  {
    name: 'placeOrders',
    kind: 'transaction',
    description: 'Cancel some orders then place several, atomically.',
    parameters: obj(
      {
        market,
        owner,
        orders: { type: 'array', items: orderSchema },
        cancels: { type: 'array', items: obj({ orderId: atoms, orderEntryIndex: { type: 'integer', minimum: 1 } }, ['orderId']) },
      },
      ['market', 'owner', 'orders'],
    ),
  },
  { name: 'cancel', kind: 'transaction', description: 'Cancel one resting order by id.', parameters: obj({ market, owner, orderId: atoms, orderEntryIndex: { type: 'integer', minimum: 1 } }, ['market', 'owner', 'orderId']) },
  { name: 'cancelAll', kind: 'transaction', description: "Cancel every resting order of the owner's seat in a market.", parameters: obj({ market, owner }, ['market', 'owner']) },
  {
    name: 'modify',
    kind: 'transaction',
    description: 'Reduce a resting order to a smaller size (increases are refused).',
    parameters: obj({ market, owner, orderId: atoms, orderEntryIndex: { type: 'integer', minimum: 1 }, size: decimal, quantityAtoms: atoms, lots: atoms }, ['market', 'owner', 'orderId']),
  },
  { name: 'deposit', kind: 'transaction', description: "Deposit quote collateral from the owner's token account into the seat.", parameters: obj({ market, owner, amount: decimal, amountAtoms: atoms }, ['market', 'owner']) },
  { name: 'withdraw', kind: 'transaction', description: 'Withdraw free collateral to the owner\'s token account (a cross seat draws on its account).', parameters: obj({ market, owner, amount: decimal, amountAtoms: atoms }, ['market', 'owner']) },
  { name: 'createMarginAccount', kind: 'transaction', description: "Create a cross margin account on the market's quote vault.", parameters: obj({ market, owner, accountId: { type: 'integer', minimum: 0 } }, ['market', 'owner']), requires: 'crossMargin' },
  { name: 'linkMargin', kind: 'transaction', description: "Link the owner's seat in a market into a margin account (cross margin).", parameters: obj({ market, owner, accountId: { type: 'integer', minimum: 0 } }, ['market', 'owner']), requires: 'crossMargin' },
  { name: 'unlinkMargin', kind: 'transaction', description: "Unlink the owner's flat seat from its margin account.", parameters: obj({ market, owner }, ['market', 'owner']), requires: 'crossMargin' },
  { name: 'settleFunding', kind: 'transaction', description: "Settle funding for seats of a market (by index) or the owner's seat; optional, the program settles before it reads equity.", parameters: obj({ market, owner, seatIndexes: { type: 'array', items: { type: 'integer', minimum: 1 } } }, ['market']), requires: 'settleFunding' },
  { name: 'settleAccountFunding', kind: 'transaction', description: 'Settle funding of every seat a margin account links.', parameters: obj({ owner, marginAccount: address }, ['owner']), requires: 'settleFunding' },
  { name: 'liquidate', kind: 'transaction', description: "Liquidate seat targetSeatIndex with the owner's seat in the same market.", parameters: obj({ market, owner, targetSeatIndex: { type: 'integer', minimum: 1 } }, ['market', 'owner', 'targetSeatIndex']) },
];

/** Every action with its parameter schema; with a client, only the
    actions its ABI version supports. */
export function describePerpsActions(client?: Pick<PerpsClient, 'features'>): PerpsActionDescription[] {
  return ACTIONS.filter((action) => !client || !action.requires || client.features[action.requires]).map((action) => structuredClone(action));
}

/** The actions as tool definitions in the common { name, description,
    input_schema } shape (Anthropic, and others with a rename). */
export function perpsToolDefinitions(client?: Pick<PerpsClient, 'features'>): Array<{ name: string; description: string; input_schema: JsonSchema }> {
  return describePerpsActions(client).map((action) => ({
    name: `perps_${action.name}`,
    description: `${action.description}${action.kind === 'transaction' ? ' Returns the signature once executed (or the unsigned transaction when no signer is configured).' : ''}`,
    input_schema: action.parameters,
  }));
}

/** Checks params against an action's schema (types, required, enum,
    pattern, unknown keys); returns the problems, empty when valid. */
export function validatePerpsActionParams(name: string, params: unknown): string[] {
  const action = ACTIONS.find((entry) => entry.name === name);
  if (!action) return [`unknown action ${name}`];
  return validate(action.parameters, params, 'params');
}

function validate(schema: JsonSchema, value: unknown, path: string): string[] {
  const problems: string[] = [];
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be an object`];
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (record[key] === undefined) problems.push(`${path}.${key} is required`);
    for (const [key, entry] of Object.entries(record)) {
      const property = schema.properties?.[key];
      if (!property) {
        if (schema.additionalProperties === false) problems.push(`${path}.${key} is not a parameter`);
        continue;
      }
      if (entry !== undefined) problems.push(...validate(property, entry, `${path}.${key}`));
    }
    return problems;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    value.forEach((entry, i) => problems.push(...(schema.items ? validate(schema.items, entry, `${path}[${i}]`) : [])));
    return problems;
  }
  if (schema.type === 'string' && typeof value !== 'string') return [`${path} must be a string`];
  if (schema.type === 'integer' && !(typeof value === 'number' && Number.isInteger(value))) return [`${path} must be an integer`];
  if (schema.type === 'boolean' && typeof value !== 'boolean') return [`${path} must be a boolean`];
  if (schema.enum && !schema.enum.includes(value as string | number)) problems.push(`${path} must be one of ${schema.enum.join(', ')}`);
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) problems.push(`${path} ${JSON.stringify(value)} does not match ${schema.pattern}`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) problems.push(`${path} must be >= ${schema.minimum}`);
  if (typeof value === 'number' && schema.maximum !== undefined && value > schema.maximum) problems.push(`${path} must be <= ${schema.maximum}`);
  return problems;
}

export type PerpsActionResult =
  | { ok: true; action: string; result: JsonSafe }
  | { ok: false; action: string; error: { message: string; kind?: string; code?: string | null; retryable?: boolean; details?: JsonSafe } };

/** Runs an action with JSON params and returns a JSON-safe result; never
    throws (errors come back as { ok: false, error }). */
export async function runPerpsAction(
  client: PerpsClient,
  name: string,
  params: Record<string, unknown> = {},
  options: { signer?: PerpsSigner; send?: boolean } = {},
): Promise<PerpsActionResult> {
  const problems = validatePerpsActionParams(name, params);
  if (problems.length) return { ok: false, action: name, error: { message: `invalid parameters: ${problems.join('; ')}`, kind: 'invalid-params' } };
  const action = ACTIONS.find((entry) => entry.name === name)!;
  if (action.requires && !client.features[action.requires]) {
    return { ok: false, action: name, error: { message: `${name} needs ${action.requires}, which ABI ${client.version.abiPackageVersion} does not have`, kind: 'unsupported' } };
  }
  try {
    const run = (client as unknown as Record<string, (input: unknown, ...rest: unknown[]) => Promise<unknown>>)[name]!.bind(client);
    const p = params as Record<string, never>;
    let result: unknown;
    switch (name) {
      case 'getMarkets':
        result = await client.getMarkets();
        break;
      case 'getMarket':
      case 'getMark':
      case 'getFunding':
        result = await run(p.market);
        break;
      case 'getBook':
        result = await client.getBook(p.market, p.depth);
        break;
      case 'getSeat':
      case 'getOpenOrders':
        result = await run(p.market, p.owner);
        break;
      case 'getMarginAccounts':
        result = await client.getMarginAccounts(p.owner);
        break;
      default: {
        const built = (await run(params)) as PerpsBuilt;
        const send = options.send ?? !!options.signer;
        if (!send) {
          result = { transaction: perpTransactionToJSON(built.transaction), meta: built.meta };
          break;
        }
        if (!options.signer) throw new Error('send needs a signer');
        if (options.signer.address !== built.meta.owner && built.meta.owner) {
          throw new Error(`the signer ${options.signer.address} is not the owner ${built.meta.owner}`);
        }
        result = { ...(await client.send(built, options.signer)), meta: built.meta };
      }
    }
    return { ok: true, action: name, result: toJsonSafe(result) };
  } catch (error) {
    if (error instanceof TransactionFailedError || error instanceof TransactionTimeoutError) {
      const info = error.toJSON();
      return { ok: false, action: name, error: { message: info.message, kind: info.kind, code: info.code, retryable: info.retryable, details: toJsonSafe(info) } };
    }
    return { ok: false, action: name, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}
