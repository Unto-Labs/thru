/**
 * Thru Studio Client Logic
 */

let activeProgramId = null;
let templates = [];

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadStatus();
  loadPrograms();
  initActionListeners();
});

function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
    });
  });
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    document.getElementById('header-tps').textContent = `${data.status.tps.toLocaleString()} TPS`;
    document.getElementById('header-height').textContent = `Block #${data.status.blockHeight.toLocaleString()}`;

    templates = data.templates;
    const select = document.getElementById('prog-template-select');
    select.innerHTML = '';
    templates.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = t.name;
      select.appendChild(opt);
    });

    if (templates.length > 0) {
      document.getElementById('prog-code-area').value = templates[0].code;
    }

    select.addEventListener('change', () => {
      const idx = select.value;
      document.getElementById('prog-code-area').value = templates[idx].code;
    });
  } catch (e) {
    console.error('Status fetch error:', e);
  }
}

async function loadPrograms() {
  try {
    const res = await fetch('/api/programs');
    const progs = await res.json();
    if (progs.length > 0) {
      activeProgramId = progs[0].id;
      document.getElementById('state-json-box').textContent = JSON.stringify(progs[0].storage, null, 2);
    }
  } catch (e) {
    console.error(e);
  }
}

function initActionListeners() {
  // Deploy custom
  document.getElementById('btn-deploy-custom').addEventListener('click', async () => {
    const btn = document.getElementById('btn-deploy-custom');
    const code = document.getElementById('prog-code-area').value;
    const name = 'Custom RISC-V Program';

    btn.disabled = true;
    btn.textContent = '⏳ Compiling to RV32IM...';

    try {
      const res = await fetch('/api/programs/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code }),
      });
      const data = await res.json();

      if (data.success) {
        activeProgramId = data.program.id;
        document.getElementById('state-json-box').textContent = JSON.stringify(data.program.storage, null, 2);
        alert(`✅ Deployed program ${data.program.id} to Thru Network!`);
      }
    } catch (err) {
      alert(`Deploy Error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 Deploy Program';
    }
  });

  // Execute Inst 1
  document.getElementById('btn-exec-inst-1').addEventListener('click', () => executeInstruction(1));
  // Execute Inst 2
  document.getElementById('btn-exec-inst-2').addEventListener('click', () => executeInstruction(2));
}

async function executeInstruction(instruction) {
  if (!activeProgramId) return;
  const resultBox = document.getElementById('exec-result-box');

  try {
    const res = await fetch('/api/programs/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programId: activeProgramId, instruction }),
    });
    const data = await res.json();

    if (data.success) {
      document.getElementById('state-json-box').textContent = JSON.stringify(data.storage, null, 2);
      resultBox.innerHTML = `
        <div class="card" style="border-color: #a3e635; background: rgba(163, 230, 53, 0.08);">
          <strong style="color: #bef264;">⚡ Instruction ${instruction} Executed on Thru VM!</strong>
          <div class="mono mt-1" style="font-size: 0.75rem;">Cycles: ${data.cyclesUsed} • TX: ${data.txHash.slice(0, 16)}...</div>
        </div>
      `;
      loadHistory();
    }
  } catch (err) {
    resultBox.innerHTML = `<div class="badge red">Execution error: ${err.message}</div>`;
  }
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const logs = await res.json();
    const list = document.getElementById('vm-history-list');

    if (!logs || logs.length === 0) return;
    list.innerHTML = '';

    logs.slice(0, 5).forEach(l => {
      const row = document.createElement('div');
      row.className = 'ledger-row';
      row.innerHTML = `
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #bef264; font-weight: 600;">Inst ${l.instruction} • ${l.cyclesUsed} cycles</span>
          <span class="text-muted mono" style="font-size: 0.72rem;">${l.status}</span>
        </div>
        <div class="mono text-muted mt-1" style="font-size: 0.7rem;">${l.txHash.slice(0, 20)}...</div>
      `;
      list.appendChild(row);
    });
  } catch (e) {
    console.warn(e);
  }
}
