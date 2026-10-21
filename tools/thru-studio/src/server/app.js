/**
 * Thru Program Playground & RPC Explorer Web Server
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { THRU_CONFIG } from '../config.js';
import { defaultVmSimulator } from '../core/vm-simulator.js';
import { defaultRpcClient } from '../core/rpc-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.join(__dirname, '../../web');

const app = express();
const PORT = process.env.PORT || 3410;

app.use(cors());
app.use(express.json());
app.use(express.static(WEB_ROOT));

// 1. Network Status
app.get('/api/status', (req, res) => {
  res.json({
    status: defaultRpcClient.getNetworkStatus(),
    vm: THRU_CONFIG.vm,
    templates: THRU_CONFIG.programTemplates,
  });
});

// 2. List Programs
app.get('/api/programs', (req, res) => {
  res.json(defaultVmSimulator.getPrograms());
});

// 3. Deploy New Program
app.post('/api/programs/deploy', (req, res) => {
  try {
    const { name, code } = req.body;
    const program = defaultVmSimulator.deployProgram({ name, code });
    res.json({ success: true, program });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Execute Instruction on VM
app.post('/api/programs/execute', (req, res) => {
  try {
    const { programId, instruction, args } = req.body;
    const result = defaultVmSimulator.executeInstruction(programId, instruction, args);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Execution History
app.get('/api/history', (req, res) => {
  res.json(defaultVmSimulator.getHistory());
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`⚡ Thru Network Program Studio & VM Simulator Running!`);
    console.log(`🌐 Web Dashboard: http://localhost:${PORT}`);
    console.log(`💻 Architecture: RISC-V 32-bit (RV32IM)`);
    console.log(`======================================================\n`);
  });
}

export default app;
