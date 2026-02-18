function el(tag, txt) { const e = document.createElement(tag); if (txt !== undefined) e.textContent = txt; return e; }

const content = document.getElementById('content');

document.getElementById('btn-inventory').addEventListener('click', async () => {
  const inv = await window.api.getInventory();
  renderInventory(inv);
});

document.getElementById('btn-bom').addEventListener('click', async () => {
  renderBOMEditor();
});

document.getElementById('btn-items').addEventListener('click', async () => {
  const items = await window.api.getItems();
  renderItems(items);
});

document.getElementById('btn-po').addEventListener('click', async () => {
  const pos = await window.api.getPOs();
  renderPOs(pos);
});

document.getElementById('btn-mrp').addEventListener('click', async () => {
  const days = parseInt(prompt('Planning horizon (days)', '30') || '30', 10);
  const res = await window.api.runMRP(days);
  renderMRP(res);
});

document.getElementById('btn-import').addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const ab = fr.result;
      const u8 = new Uint8Array(ab);
      const summary = await window.api.importExcel(u8);
      alert('Import summary:\n' + JSON.stringify(summary, null, 2));
    };
    fr.readAsArrayBuffer(file);
  };
  input.click();
});

document.getElementById('btn-export').addEventListener('click', async () => {
  try {
    const out = await window.api.exportAllExcel();
    alert('Exported to: ' + out);
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
});

document.getElementById('btn-bulk-replace').addEventListener('click', async () => {
  const oldPattern = prompt('Old code or pattern (use * as wildcard, e.g. OLD_* )');
  if (!oldPattern) return;
  const newPattern = prompt('New code or pattern (use * to insert suffix, e.g. NEW_* )');
  if (!newPattern) return;
  let createIfMissing = false;
  if (!confirm('Create missing replacement items if not present?')) createIfMissing = false; else createIfMissing = true;
  const results = await window.api.replaceRawMaterialBulk(oldPattern, newPattern, createIfMissing);
  alert('Bulk replace results:\n' + JSON.stringify(results, null, 2));
});

document.getElementById('btn-undo-replace').addEventListener('click', async () => {
  const history = await window.api.getReplaceHistory();
  if (!history || history.length === 0) { alert('No replace history'); return; }
  const last = history[0];
  if (!confirm('Undo last replace: ' + last.old_code + ' -> ' + last.new_code + ' ?')) return;
  try {
    const res = await window.api.undoReplace(last.id);
    alert('Undo result: ' + JSON.stringify(res));
  } catch (e) {
    alert('Undo failed: ' + e.message);
  }
});

function clear() { content.innerHTML = ''; }

function renderInventory(rows) {
  clear();
  const h = el('h3', 'Inventory');
  content.appendChild(h);
  const t = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Code</th><th>Name</th><th>Location</th><th>Qty</th></tr>';
  t.appendChild(thead);
  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.code}</td><td>${r.name}</td><td>${r.location}</td><td>${r.qty}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  content.appendChild(t);
}

function renderBOMs(rows) {
  clear();
  content.appendChild(el('h3','BOMs'));
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>Parent</th><th>Child</th><th>Qty(per kg)</th><th>Dilution</th><th>PerMainQty</th><th>DilutionMain</th></tr></thead>';
  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.parent_code}</td><td>${r.child_code}</td><td>${r.qty}</td><td>${r.is_dilution}</td><td>${r.per_main_qty || ''}</td><td>${r.dilution_main_code || ''}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  content.appendChild(t);
}

async function renderBOMEditor() {
  clear();
  content.appendChild(el('h3','BOM Editor'));
  const items = await window.api.getItems();
  const parentSelect = document.createElement('select');
  items.forEach(it => { const o = document.createElement('option'); o.value = it.code; o.textContent = `${it.code} (${it.uom || 'kg'}) batch ${it.batch_size||25}kg`; parentSelect.appendChild(o); });
  const loadBtn = document.createElement('button'); loadBtn.textContent = 'Load BOM';
  const newBtn = document.createElement('button'); newBtn.textContent = 'New Line';
  const parentRow = document.createElement('div'); parentRow.appendChild(parentSelect); parentRow.appendChild(loadBtn); parentRow.appendChild(newBtn);
  content.appendChild(parentRow);

  const table = document.createElement('table'); table.innerHTML = '<thead><tr><th>Child</th><th>Qty(per kg)</th><th>Mode</th><th>Dilution</th><th>PerMainQty</th><th>DilMain</th><th>Actions</th></tr></thead>';
  const tbody = document.createElement('tbody'); table.appendChild(tbody);
  content.appendChild(table);

  async function load(parent) {
    tbody.innerHTML = '';
    const rows = await window.api.getBOMForParent(parent);
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.child_code}</td><td>${r.qty}</td><td>per kg</td><td>${r.is_dilution ? 'Yes' : ''}</td><td>${r.per_main_qty || ''}</td><td>${r.dilution_main_code || ''}</td>`;
      const edit = document.createElement('button'); edit.textContent = 'Edit';
      edit.addEventListener('click', () => openEdit(parent, r));
      const del = document.createElement('button'); del.textContent = 'Delete';
      del.addEventListener('click', async () => { if (!confirm('Delete line?')) return; await window.api.deleteBOM(r.id); load(parentSelect.value); });
      const td = document.createElement('td'); td.appendChild(edit); td.appendChild(del);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
  }

  function openEdit(parent, row) {
    const dlg = document.createElement('div'); dlg.style.border = '1px solid #ccc'; dlg.style.padding = '8px'; dlg.style.marginTop = '8px';
    dlg.innerHTML = `<div>Parent: ${parent}</div>`;
    const childInput = document.createElement('input'); childInput.value = row.child_code;
    const qtyInput = document.createElement('input'); qtyInput.type = 'number'; qtyInput.value = row.qty;
    const isDil = document.createElement('input'); isDil.type = 'checkbox'; isDil.checked = row.is_dilution ? true : false;
    const perMain = document.createElement('input'); perMain.type = 'number'; perMain.value = row.per_main_qty || '';
    const dilMain = document.createElement('input'); dilMain.value = row.dilution_main_code || '';
    const save = document.createElement('button'); save.textContent = 'Save';
    save.addEventListener('click', async () => {
      await window.api.updateBOM(row.id, { child: childInput.value, qty: parseFloat(qtyInput.value)||0, is_dilution: isDil.checked, per_main_qty: parseFloat(perMain.value)||null, dilution_main: dilMain.value || null });
      dlg.remove(); load(parentSelect.value);
    });
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => dlg.remove());
    dlg.appendChild(document.createTextNode('Child: ')); dlg.appendChild(childInput); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('Qty (per kg): ')); dlg.appendChild(qtyInput); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('Is Dilution: ')); dlg.appendChild(isDil); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('PerMainQty: ')); dlg.appendChild(perMain); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('DilutionMain: ')); dlg.appendChild(dilMain); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(save); dlg.appendChild(cancel);
    content.appendChild(dlg);
  }

  newBtn.addEventListener('click', () => {
    const dlg = document.createElement('div'); dlg.style.border = '1px solid #ccc'; dlg.style.padding = '8px'; dlg.style.marginTop = '8px';
    const childInput = document.createElement('input'); childInput.placeholder = 'Child code';
    const qtyInput = document.createElement('input'); qtyInput.type = 'number'; qtyInput.placeholder = 'Qty (enter per batch or per kg and choose mode)';
    const modeSelect = document.createElement('select'); const o1 = document.createElement('option'); o1.value='per_batch'; o1.textContent='Per Batch'; const o2 = document.createElement('option'); o2.value='per_kg'; o2.textContent='Per Kg'; modeSelect.appendChild(o1); modeSelect.appendChild(o2);
    const isDil = document.createElement('input'); isDil.type = 'checkbox';
    const perMain = document.createElement('input'); perMain.type = 'number'; perMain.placeholder = 'PerMainQty';
    const dilMain = document.createElement('input'); dilMain.placeholder = 'DilutionMain code';
    const save = document.createElement('button'); save.textContent = 'Add';
    save.addEventListener('click', async () => {
      const parent = parentSelect.value;
      let qty = parseFloat(qtyInput.value) || 0;
      if (modeSelect.value === 'per_batch') {
        const it = (await window.api.getItems()).find(x => x.code === parent);
        const batch = it ? (it.batch_size||25) : 25;
        qty = qty / batch; // store per-kg
      }
      await window.api.addBOM({ parent: parent, child: childInput.value, qty: qty, is_dilution: isDil.checked, per_main_qty: parseFloat(perMain.value)||null, dilution_main: dilMain.value || null });
      dlg.remove(); load(parent);
    });
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => dlg.remove());
    dlg.appendChild(document.createTextNode('Child: ')); dlg.appendChild(childInput); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('Qty: ')); dlg.appendChild(qtyInput); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('Mode: ')); dlg.appendChild(modeSelect); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('Is Dilution: ')); dlg.appendChild(isDil); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('PerMainQty: ')); dlg.appendChild(perMain); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(document.createTextNode('DilutionMain: ')); dlg.appendChild(dilMain); dlg.appendChild(document.createElement('br'));
    dlg.appendChild(save); dlg.appendChild(cancel);
    content.appendChild(dlg);
  });

  load(parentSelect.value);
  loadBtn.addEventListener('click', () => load(parentSelect.value));

function renderItems(rows) {
  clear();
  content.appendChild(el('h3','Items'));
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>Code</th><th>Name</th><th>UoM</th><th>Lead Time (days)</th><th>Action</th><th>Replace</th></tr></thead>';
  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const leadInput = document.createElement('input');
    leadInput.type = 'number';
    leadInput.value = r.lead_time || 0;
    leadInput.style.width = '70px';
    const btn = document.createElement('button');
    btn.textContent = 'Save';
    btn.addEventListener('click', async () => {
      await window.api.updateItemLeadTime(r.code, leadInput.value);
      alert('Lead time updated');
    });
    const replaceBtn = document.createElement('button');
    replaceBtn.textContent = 'Replace RM';
    replaceBtn.addEventListener('click', async () => {
      const newCode = prompt('Replace item ' + r.code + ' with (enter new code)');
      if (!newCode) return;
      let createIfMissing = false;
      const exists = (await window.api.getItems()).find(it => it.code === newCode);
      if (!exists) {
        createIfMissing = confirm('Item ' + newCode + ' not found. Create it?');
      }
      try {
        const res = await window.api.replaceRawMaterial(r.code, newCode, createIfMissing);
        alert('Replacement done');
        const items = await window.api.getItems();
        renderItems(items);
      } catch (e) {
        alert('Replace failed: ' + e.message);
      }
    });
    tr.innerHTML = `<td>${r.code}</td><td>${r.name}</td><td>${r.uom}</td>`;
    const td = document.createElement('td'); td.appendChild(leadInput);
    const ta = document.createElement('td'); ta.appendChild(btn);
    const trp = document.createElement('td'); trp.appendChild(replaceBtn);
    tr.appendChild(td);
    tr.appendChild(ta);
    tr.appendChild(trp);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  content.appendChild(t);
}

function renderPOs(rows) {
  clear();
  content.appendChild(el('h3','Purchase Orders'));
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>Code</th><th>Qty</th><th>ETA</th><th>Status</th></tr></thead>';
  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.code}</td><td>${r.qty}</td><td>${r.eta}</td><td>${r.status}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  content.appendChild(t);
}

function renderMRP(res) {
  clear();
  content.appendChild(el('h3','MRP Run'));
  content.appendChild(el('h4','Open Production Orders'));
  const p = document.createElement('pre'); p.textContent = JSON.stringify(res.demand, null, 2);
  content.appendChild(p);
  content.appendChild(el('h4','Exploded Requirements'));
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>Code</th><th>Need</th><th>On Hand</th><th>Net</th></tr></thead>';
  const tb = document.createElement('tbody');
  res.explodedRequirements.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.code}</td><td>${r.need}</td><td>${r.onHand}</td><td>${r.net}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  content.appendChild(t);
}
