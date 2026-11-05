#!/usr/bin/env node

/**
 * Thru Network Universal CLI
 */

import { defaultVmSimulator } from '../src/core/vm-simulator.js';
import { defaultRpcClient } from '../src/core/rpc-client.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main() {
  switch (command.toLowerCase()) {
    case 'status': {
      console.log('\n🌐 Thru Network Status:');
      const st = defaultRpcClient.getNetworkStatus();
      console.log(`  Block Height: ${st.blockHeight}`);
      console.log(`  Current TPS:  ${st.tps}`);
      console.log(`  Finality:     ${st.avgFinalityMs} ms\n`);
      break;
    }

    case 'programs': {
      console.log('\n📜 Deployed Thru RISC-V Programs:');
      defaultVmSimulator.getPrograms().forEach(p => {
        console.log(`  • [${p.id}] ${p.name}`);
        console.log(`    Storage: ${JSON.stringify(p.storage)}\n`);
      });
      break;
    }

    case 'exec': {
      const progId = args[1] || defaultVmSimulator.getPrograms()[0]?.id;
      const instruction = parseInt(args[2] || '1', 10);
      console.log(`\n⚡ Executing instruction ${instruction} on Thru VM (${progId})...`);
      const res = defaultVmSimulator.executeInstruction(progId, instruction);
      console.log(`  Status:       ${res.log.status}`);
      console.log(`  Cycles Used:  ${res.cyclesUsed}`);
      console.log(`  TX Hash:      ${res.txHash}`);
      console.log(`  New Storage:  ${JSON.stringify(res.storage)}\n`);
      break;
    }

    case 'studio': {
      console.log('\n🌐 Launching Thru Studio on :3410...');
      await import('../src/server/app.js');
      break;
    }

    default: {
      console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              ⚡ THRU NETWORK PROGRAM & VM CLI                    ║
║         High-Performance RISC-V VM & RPC Explorer Suite          ║
╚══════════════════════════════════════════════════════════════════╝

Commands:
  thru-cli status                 View network status, height, & TPS
  thru-cli programs               List deployed RISC-V programs
  thru-cli exec [progId] [inst]   Execute instruction on Thru VM
  thru-cli studio                 Launch Web Studio on :3410
      `);
      break;
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
