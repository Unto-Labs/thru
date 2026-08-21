/**
 * Thru Network & RISC-V VM Configuration
 */

export const THRU_CONFIG = {
  network: {
    name: 'Thru Network Testnet',
    chainId: 'thru-testnet-1',
    rpcUrl: process.env.THRU_RPC_URL || 'https://rpc.testnet.thru.org',
    grpcUrl: 'grpc.testnet.thru.org:9090',
    explorerUrl: 'https://explorer.thru.org',
    nativeCurrency: { name: 'Thru Token', symbol: 'THRU', decimals: 9 },
  },
  vm: {
    architecture: 'RISC-V 32-bit (RV32IM)',
    maxComputeUnits: 200000,
    baseInstructionCost: 1,
    registers: ['x0(zero)', 'x1(ra)', 'x2(sp)', 'x3(gp)', 'x4(tp)', 'x5(t0)', 'x6(t1)', 'x7(t2)', 'x8(s0)', 'x9(s1)', 'x10(a0)', 'x11(a1)'],
  },
  programTemplates: [
    {
      id: 'prog_counter',
      name: 'Stateful Atomic Counter',
      author: 'Unto Labs Devkit',
      description: 'Increments and decrements on-chain account state with overflow checks in RISC-V C.',
      code: `// Thru RISC-V Program: Counter
#include <thru/sdk.h>

int main(thru_context_t *ctx) {
    uint64_t current = thru_storage_load_u64("count");
    if (ctx->instruction == 1) { // Increment
        current += 1;
    } else if (ctx->instruction == 2) { // Decrement
        if (current > 0) current -= 1;
    }
    thru_storage_store_u64("count", current);
    thru_emit_event("CountUpdated", current);
    return THRU_SUCCESS;
}`,
    },
    {
      id: 'prog_token',
      name: 'Thru Native Token Vault',
      author: 'Unto Labs Devkit',
      description: 'High-throughput token transfers with passkey authorization verification.',
      code: `// Thru RISC-V Program: Token Vault
#include <thru/sdk.h>

int main(thru_context_t *ctx) {
    thru_address_t sender = ctx->sender;
    thru_address_t recipient = ctx->args.recipient;
    uint64_t amount = ctx->args.amount;

    uint64_t sender_bal = thru_get_balance(sender);
    if (sender_bal < amount) return THRU_ERR_INSUFFICIENT_FUNDS;

    thru_sub_balance(sender, amount);
    thru_add_balance(recipient, amount);
    thru_emit_event("Transfer", sender, recipient, amount);
    return THRU_SUCCESS;
}`,
    },
  ],
};
