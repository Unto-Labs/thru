# @thru/indexer

A reusable blockchain indexing framework for building backends that index Thru chain data.

## Features

- **Event Streams** - Index historical, immutable event data
- **Account Streams** - Track current on-chain account state with slot-aware upserts
- **Type-Safe Schema Builder** - Fluent API with full TypeScript inference
- **Auto-Generated REST API** - Hono + OpenAPI routes with pagination
- **Resumable Indexing** - Checkpoint-based recovery after restarts
- **Drizzle ORM** - PostgreSQL with type-safe queries and migrations

## Installation

```bash
pnpm add @thru/indexer @thru/replay @thru/helpers postgres drizzle-orm hono @hono/zod-openapi
pnpm add -D drizzle-kit tsx typescript
```

## Quick Start

### 1. Define an Event Stream

```typescript
// src/streams/transfers.ts
import { create } from "@bufbuild/protobuf";
import { decodeAddress, encodeAddress, encodeSignature } from "@thru/helpers";
import { defineEventStream, t } from "@thru/indexer";
import { FilterSchema, FilterParamValueSchema, type Event } from "@thru/replay";
import { TokenEvent } from "../abi/token";

const TOKEN_PROGRAM = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq";

const transfers = defineEventStream({
  name: "transfers",
  description: "Token transfer events",

  schema: {
    id: t.text().primaryKey(),
    slot: t.bigint().notNull().index(),
    txnSignature: t.text().notNull(),
    source: t.text().notNull().index(),
    dest: t.text().notNull().index(),
    amount: t.bigint().notNull(),
    indexedAt: t.timestamp().notNull().defaultNow(),
  },

  // Lazy filter for drizzle-kit compatibility
  filterFactory: () => {
    const programBytes = new Uint8Array(decodeAddress(TOKEN_PROGRAM));
    return create(FilterSchema, {
      expression: "event.program.value == params.address",
      params: {
        address: create(FilterParamValueSchema, {
          kind: { case: "bytesValue", value: programBytes },
        }),
      },
    });
  },

  // Parse raw event into table row (return null to skip)
  parse: (event: Event) => {
    const payload = event.payload;
    if (!payload || payload[0] !== 2) return null;

    const tokenEvent = TokenEvent.from_array(payload);
    const transfer = tokenEvent?.payload()?.asTransfer();
    if (!transfer) return null;

    return {
      id: event.eventId,
      slot: event.slot!,
      txnSignature: encodeSignature(event.transactionSignature?.value ?? new Uint8Array()),
      source: encodeAddress(new Uint8Array(transfer.source.get_bytes())),
      dest: encodeAddress(new Uint8Array(transfer.dest.get_bytes())),
      amount: transfer.amount,
      indexedAt: new Date(),
    };
  },

  api: { filters: ["source", "dest"] },
});

// Export table for Drizzle migrations
export const transferEvents = transfers.table;
export default transfers;
```

### 2. Define an Account Stream

```typescript
// src/account-streams/token-accounts.ts
import { decodeAddress, encodeAddress } from "@thru/helpers";
import { defineAccountStream, t } from "@thru/indexer";
import { TokenAccount } from "../abi/token";

const TOKEN_PROGRAM = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq";

const tokenAccounts = defineAccountStream({
  name: "token-accounts",
  description: "Token account balances",

  ownerProgramFactory: () => new Uint8Array(decodeAddress(TOKEN_PROGRAM)),
  expectedSize: 73,

  schema: {
    address: t.text().primaryKey(),
    mint: t.text().notNull().index(),
    owner: t.text().notNull().index(),
    amount: t.bigint().notNull(),
    slot: t.bigint().notNull(),
    seq: t.bigint().notNull(),
    updatedAt: t.timestamp().notNull().defaultNow(),
  },

  parse: (account) => {
    if (account.data.length !== 73) return null;

    const parsed = TokenAccount.from_array(account.data);
    if (!parsed) return null;

    return {
      address: encodeAddress(account.address),
      mint: encodeAddress(new Uint8Array(parsed.mint.get_bytes())),
      owner: encodeAddress(new Uint8Array(parsed.owner.get_bytes())),
      amount: parsed.amount,
      slot: account.slot,
      seq: account.seq,
      updatedAt: new Date(),
    };
  },

  api: { filters: ["mint", "owner"], idField: "address" },
});

export const tokenAccountsTable = tokenAccounts.table;
export default tokenAccounts;
```

### 3. Set Up Database Schema

```typescript
// src/db/schema.ts
export { checkpointTable } from "@thru/indexer";
export { transferEvents } from "../streams/transfers";
export { tokenAccountsTable } from "../account-streams/token-accounts";
```

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

```typescript
// src/db/index.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client);
```

### 4. Create Indexer

```typescript
// src/indexer.ts
import { ChainClient } from "@thru/replay";
import { Indexer } from "@thru/indexer";
import { db } from "./db";
import transfers from "./streams/transfers";
import tokenAccounts from "./account-streams/token-accounts";

const indexer = new Indexer({
  db,
  clientFactory: () => new ChainClient({ baseUrl: process.env.CHAIN_RPC_URL! }),
  eventStreams: [transfers],
  accountStreams: [tokenAccounts],
  defaultStartSlot: 0n,
  safetyMargin: 64,
  pageSize: 512,
  logLevel: "info",
});

process.on("SIGINT", () => indexer.stop());
process.on("SIGTERM", () => indexer.stop());

indexer.start().then((result) => {
  console.log("Indexer finished:", result);
});
```

### 5. Create API Server

```typescript
// src/api.ts
import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { mountStreamRoutes } from "@thru/indexer";
import { db } from "./db";
import transfers from "./streams/transfers";
import tokenAccounts from "./account-streams/token-accounts";

const app = new OpenAPIHono();

mountStreamRoutes(app, {
  db,
  basePath: "/api/v1",
  eventStreams: [transfers],
  accountStreams: [tokenAccounts],
});

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`API server running on http://localhost:${info.port}`);
});
```

### 6. Run

```bash
# Generate and apply migrations
pnpm drizzle-kit generate
pnpm drizzle-kit push

# Start indexer
pnpm tsx src/indexer.ts

# Start API (separate terminal)
pnpm tsx src/api.ts
```

## API Reference

### Schema Builder

The `t` object provides a fluent API for defining columns:

```typescript
import { t } from "@thru/indexer";

const schema = {
  id: t.text().primaryKey(),
  slot: t.bigint().notNull().index(),
  name: t.text(),                        // nullable by default
  count: t.integer().notNull(),
  active: t.boolean().notNull().default(true),
  createdAt: t.timestamp().notNull().defaultNow(),
  mintId: t.text().notNull().references(mintsTable, "id"),
};
```

**Column Types:**
- `t.text()` - VARCHAR/TEXT
- `t.bigint()` - BIGINT (for slots, amounts)
- `t.integer()` - INTEGER
- `t.boolean()` - BOOLEAN
- `t.timestamp()` - TIMESTAMP WITH TIME ZONE

**Modifiers:**
- `.notNull()` - NOT NULL constraint
- `.primaryKey()` - Primary key (implies NOT NULL)
- `.index()` - Create index
- `.unique()` - Unique constraint
- `.default(value)` - Default value
- `.defaultNow()` - Default to current timestamp
- `.references(table, column)` - Foreign key

### Event Stream Options

```typescript
defineEventStream({
  name: string;                    // Unique stream name
  description?: string;            // Human-readable description
  schema: { ... };                 // Column definitions
  filter?: Filter;                 // Direct CEL filter
  filterFactory?: () => Filter;    // Lazy filter (for drizzle-kit)
  parse: (event: Event) => Row | null;
  api?: {
    filters?: string[];            // Filterable columns
  };
  filterBatch?: (events, ctx) => Promise<events>;  // Pre-commit filter
  onCommit?: (batch, ctx) => Promise<void>;        // Post-commit hook
});
```

### Account Stream Options

```typescript
defineAccountStream({
  name: string;
  description?: string;
  ownerProgram?: Uint8Array;           // Direct program address
  ownerProgramFactory?: () => Uint8Array;  // Lazy (for drizzle-kit)
  expectedSize?: number;               // Filter by data size
  dataSizes?: number[];                // Multiple valid sizes
  schema: { ... };
  parse: (account: AccountState) => Row | null;
  api?: {
    filters?: string[];
    idField?: string;                  // Primary key field name
  };
});
```

### Indexer Options

```typescript
new Indexer({
  db: DatabaseClient;                  // Drizzle database client
  clientFactory: () => ChainClient;    // Factory for RPC connections
  eventStreams?: EventStream[];
  accountStreams?: AccountStream[];
  defaultStartSlot?: bigint;           // Start slot if no checkpoint
  safetyMargin?: number;               // Slots behind tip (default: 64)
  pageSize?: number;                   // Events per page (default: 512)
  logLevel?: "debug" | "info" | "warn" | "error";
  validateParse?: boolean;             // Validate parse output with Zod (dev mode)
});
```

### Hooks

**`filterBatch`** - Filter events before database commit:

```typescript
filterBatch: async (events, { db }) => {
  // Only keep transfers involving registered users
  const users = await db.select().from(usersTable);
  const userAddresses = new Set(users.map(u => u.address));

  return events.filter(e =>
    userAddresses.has(e.source) || userAddresses.has(e.dest)
  );
}
```

**`onCommit`** - Side effects after commit:

```typescript
onCommit: async (batch, { db }) => {
  // Queue notifications for transfer recipients
  await queueNotifications(db, batch.events);
}
```

## Migrations

The library uses Drizzle Kit for migrations. Tables are automatically created from stream schemas.

```bash
# Generate migration from schema changes
pnpm drizzle-kit generate

# Apply migrations
pnpm drizzle-kit migrate

# Push schema directly (development)
pnpm drizzle-kit push

# Open Drizzle Studio
pnpm drizzle-kit studio
```

### Why `filterFactory` / `ownerProgramFactory`?

Drizzle Kit imports your schema files to generate migrations. If those files load config at import time, it fails:

```typescript
// Breaks drizzle-kit (config not available at import time)
filter: create(FilterSchema, {
  params: { address: decodeAddress(loadConfig().TOKEN_PROGRAM) }
})

// Works (lazy loading, only called at runtime)
filterFactory: () => {
  const config = loadConfig();
  return create(FilterSchema, { ... });
}
```

### Schema Helper

Use `getSchemaExports()` to collect all tables for your Drizzle schema file:

```typescript
// db/schema.ts
import { getSchemaExports } from "@thru/indexer";
import transfers from "../streams/transfers";
import tokenAccounts from "../account-streams/token-accounts";

// Export all tables for Drizzle migrations
export const { checkpointTable, transfersTable, tokenAccountsTable } = getSchemaExports({
  eventStreams: [transfers],
  accountStreams: [tokenAccounts],
});
```

### Runtime Validation

Enable `validateParse` to validate parse function output at runtime using Zod schemas. This is useful during development to catch type mismatches early:

```typescript
const indexer = new Indexer({
  db,
  clientFactory: () => new ChainClient({ baseUrl: RPC_URL }),
  eventStreams: [transfers],
  validateParse: process.env.NODE_ENV !== "production",  // Enable in dev
});
```

When validation fails, the indexer logs detailed error messages:

```
[transfers] Stream "transfers" parse returned invalid data:
  - amount: Expected bigint, received number
  - source: Required
```

## Exports

```typescript
// Schema
export { t, columnBuilder } from "@thru/indexer";
export type { ColumnDef, SchemaDefinition, InferRow, InferInsert } from "@thru/indexer";

// Validation (for development)
export { generateZodSchema, validateParsedData } from "@thru/indexer";

// Streams
export { defineEventStream, defineAccountStream } from "@thru/indexer";
export type { EventStream, AccountStream } from "@thru/indexer";

// Checkpoint
export { checkpointTable, getCheckpoint, updateCheckpoint, getSchemaExports } from "@thru/indexer";

// API
export { mountStreamRoutes, generateSchemas } from "@thru/indexer";
export { paginate, parseCursor, paginationQuerySchema } from "@thru/indexer";

// Runtime
export { Indexer } from "@thru/indexer";
export type { IndexerConfig, IndexerResult } from "@thru/indexer";

// Types
export type { ApiConfig, StreamBatch, HookContext } from "@thru/indexer";
```

## Example Project Structure

```
my-indexer/
├── src/
│   ├── abi/                      # ABI type definitions
│   │   └── token.ts
│   ├── streams/                  # Event stream definitions
│   │   └── transfers.ts
│   ├── account-streams/          # Account stream definitions
│   │   └── token-accounts.ts
│   ├── db/
│   │   ├── index.ts              # Database client
│   │   └── schema.ts             # Drizzle schema exports
│   ├── indexer.ts                # Indexer entry point
│   └── api.ts                    # API entry point
├── drizzle/                      # Generated migrations
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```
