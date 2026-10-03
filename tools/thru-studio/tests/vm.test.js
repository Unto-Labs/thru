/**
 * Thru VM Simulator Unit Tests
 */

import { defaultVmSimulator } from '../src/core/vm-simulator.js';

async function runVmTests() {
  console.log('Testing Thru RISC-V VM Simulator...');

  const program = defaultVmSimulator.deployProgram({
    name: 'Test Vault',
    code: '// RISC-V test code',
    initialStorage: { count: 10 },
  });

  if (!program.id.startsWith('thru_prg_') || program.storage.count !== 10) {
    throw new Error('Program deployment simulation failed');
  }

  const exec = defaultVmSimulator.executeInstruction(program.id, 1);
  if (!exec.success || exec.storage.count !== 11 || exec.cyclesUsed <= 0) {
    throw new Error('Instruction execution state update failed');
  }

  console.log(`✅ Thru RISC-V Instruction Executed: Storage updated to ${exec.storage.count} (${exec.cyclesUsed} cycles)!`);
}

runVmTests().catch(e => {
  console.error('❌ VM Test Failed:', e);
  process.exit(1);
});
