import { Pubkey } from '@thru/sdk';
import { BOOTSTRAP_PROGRAM_SEEDS, CANONICAL_PROGRAMS, type BootstrapProgramName } from '../bootstrap-addresses';
import { MANAGER_PROGRAM_ADDRESS, CORE_MANAGER_PROGRAM_ADDRESS } from './constants';

export interface ManagerSelection {
  manager?: 'public' | 'core';
  managerProgramAddress?: string;
  /** The fixed Core executable has no seed or managed metadata pair. */
  canonicalProgram?: Exclude<BootstrapProgramName, 'core_manager'>;
}
/** Arbitrary user seeds default to Public. Canonical genesis entries require
 * Core's distinct wire; the eight canonical applications (UNTO-3561) are
 * Public-managed and never Core-managed. */
export function resolveManagerSelection(selection: ManagerSelection, seed: string) {
  if (selection.canonicalProgram && BOOTSTRAP_PROGRAM_SEEDS[selection.canonicalProgram] !== seed) throw new Error('Seed does not match canonical registry entry');
  const canonical = selection.canonicalProgram ? CANONICAL_PROGRAMS.find(entry => entry.name === selection.canonicalProgram) : undefined;
  const canonicalManager = canonical ? (canonical.parent === 'public' ? 'public' : 'core') : undefined;
  const manager = canonicalManager ?? selection.manager ?? (selection.managerProgramAddress && Pubkey.from(selection.managerProgramAddress).equals(CORE_MANAGER_PROGRAM_ADDRESS) ? 'core' : 'public');
  if (canonicalManager === 'core' && selection.manager === 'public') throw new Error('Canonical genesis programs are Core-managed');
  if (canonicalManager === 'public' && selection.manager === 'core') throw new Error(`${selection.canonicalProgram} is a Public application deployed under the Public program manager`);
  const programAddress = manager === 'core' ? CORE_MANAGER_PROGRAM_ADDRESS : MANAGER_PROGRAM_ADDRESS;
  if (selection.managerProgramAddress && !Pubkey.from(selection.managerProgramAddress).equals(programAddress)) throw new Error('Manager address does not match canonical policy');
  return { manager, programAddress };
}
