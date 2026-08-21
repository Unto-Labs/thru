/**
 * Thru RISC-V Virtual Machine Simulator
 */

import crypto from 'crypto';
import { THRU_CONFIG } from '../config.js';

export class ThruVmSimulator {
  constructor() {
    this.programs = new Map(); // programId -> { id, name, code, storage, deployedAt }
    this.executionHistory = [];

    // Seed default programs
    THRU_CONFIG.programTemplates.forEach(t => {
      this.deployProgram({
        name: t.name,
        code: t.code,
        initialStorage: { count: 42, supply: 1000000 },
      });
    });
  }

  deployProgram({ name, code, initialStorage = {} }) {
    const programId = 'thru_prg_' + crypto.randomBytes(10).toString('hex');
    const program = {
      id: programId,
      name,
      code,
      storage: { ...initialStorage },
      deployedAt: new Date().toISOString(),
      deployedBy: '0x' + crypto.randomBytes(20).toString('hex'),
      instructionCycles: Math.floor(Math.random() * 450) + 120,
    };

    this.programs.set(programId, program);
    return program;
  }

  /**
   * Execute instruction on Thru RISC-V VM
   */
  executeInstruction(programId, instruction = 1, args = {}) {
    const program = this.programs.get(programId);
    if (!program) throw new Error('Program not found');

    const cycles = Math.floor(Math.random() * 300) + 150;
    const txHash = '0x' + crypto.randomBytes(32).toString('hex');

    // Simulate state update
    if (instruction === 1) { // Increment
      program.storage.count = (program.storage.count || 0) + 1;
    } else if (instruction === 2) { // Decrement
      program.storage.count = Math.max(0, (program.storage.count || 0) - 1);
    } else if (args.amount) { // Transfer
      program.storage.lastTransfer = { amount: args.amount, to: args.recipient || '0xRecipient' };
    }

    const log = {
      id: `exec_${Date.now()}`,
      programId,
      programName: program.name,
      instruction,
      cyclesUsed: cycles,
      status: 'THRU_SUCCESS (0)',
      txHash,
      newStorage: { ...program.storage },
      executedAt: new Date().toISOString(),
    };

    this.executionHistory.unshift(log);
    this.programs.set(programId, program);

    return {
      success: true,
      cyclesUsed: cycles,
      txHash,
      storage: program.storage,
      log,
    };
  }

  getPrograms() {
    return Array.from(this.programs.values());
  }

  getHistory() {
    return this.executionHistory;
  }
}

export const defaultVmSimulator = new ThruVmSimulator();
