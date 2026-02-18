const { contextBridge } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require(path.join(__dirname, 'db.js'));

async function importExcelBuffer(u8arr) {
  const buf = Buffer.from(u8arr);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheets = {};
  wb.SheetNames.forEach(name => {
    const ws = wb.Sheets[name];
    sheets[name] = XLSX.utils.sheet_to_json(ws, { defval: null });
  });

  const summary = { items: 0, boms: 0, inventory: 0, pos: 0, errors: [] };
  try {
    if (sheets.Items) {
      for (const r of sheets.Items) {
          try {
            const batch = parseFloat(r.BatchSize || r.Batch || r.batch_size) || (r.Code || r.code ? 25 : 25);
            db.addItem({ code: r.Code || r.code, name: r.Name || r.name, uom: r.UoM || r.uom, lead_time: parseInt(r.LeadTime || r.lead_time || 0,10) || 0, batch_size: batch });
            summary.items++;
          } catch (e) { summary.errors.push(`Item: ${e.message}`); }
      }
    }
    const bomNames = ['BOM', 'BOMs', 'Boms'];
    const bomSheet = bomNames.find(n => sheets[n]);
    if (bomSheet) {
      for (const r of sheets[bomSheet]) {
        try {
          const isDil = (r.IsDilution || r.Is_Dilution || r.Is_Diluent || r.Dilution || '').toString().toLowerCase() === 'true' || (r.IsDilution === 1 || r.is_dilution === 1);
          const perMain = parseFloat(r.PerMainQty || r.Per_Main_Qty || r.PerMain || r.Per_Main || r.per_main_qty || r.PerMainQty) || null;
          const dilMain = r.DilutionMain || r.Dilution_Main || r.DilutionFor || r.Main || r.MainIngredient || null;
          // If the BOM row provides quantities per batch (e.g. per 25kg FG), convert to per-kg
          const parentCode = r.Parent || r.parent || r.ParentCode;
          let rawQty = parseFloat(r.Qty || r.qty || r.Quantity) || 0;
          const perBatch = parseFloat(r.PerBatch || r.Per25Kg || r.Per_25Kg || r.Per_25_Kg) || null;
          if (perBatch) rawQty = perBatch;
          // get parent batch size (default 25)
          const parentRow = db.prepare('SELECT batch_size FROM items WHERE code = ?').get(parentCode) || { batch_size: 25 };
          const batchSize = parentRow.batch_size || 25;
          // if quantity is per batch, convert to per-kg for storage (per 1 kg)
          const isPerBatch = perBatch !== null;
          const qtyPerKg = isPerBatch ? (rawQty / batchSize) : rawQty;
          db.addBOM({
            parent: parentCode,
            child: r.Child || r.child || r.ChildCode,
            qty: qtyPerKg,
            is_dilution: isDil,
            per_main_qty: perMain,
            dilution_main: dilMain
          });
          summary.boms++;
        } catch (e) { summary.errors.push(`BOM: ${e.message}`); }
      }
    }
    if (sheets.Inventory) {
      for (const r of sheets.Inventory) {
        try { db.addInventory({ code: r.Code || r.code, location: r.Location || r.location || 'Main', qty: parseFloat(r.Qty || r.qty) || 0 }); summary.inventory++; } catch (e) { summary.errors.push(`Inventory: ${e.message}`); }
      }
    }
    const poNames = ['POs','PO','PurchaseOrders','Purchase Orders'];
    const poSheet = poNames.find(n => sheets[n]);
    if (poSheet) {
      for (const r of sheets[poSheet]) {
        try { db.createPO({ code: r.Code || r.code, qty: parseFloat(r.Qty || r.qty) || 0, eta: r.ETA || r.eta || r.Date || null }); summary.pos++; } catch (e) { summary.errors.push(`PO: ${e.message}`); }
      }
    }
  } catch (e) {
    summary.errors.push(e.message);
  }

  return summary;
}

function exportAllExcel() {
  const items = db.getItems();
  const boms = db.getBOMs();
  const inventory = db.getInventory();
  const pos = db.getPOs();

  const wb = XLSX.utils.book_new();
  const wsItems = XLSX.utils.json_to_sheet(items);
  XLSX.utils.book_append_sheet(wb, wsItems, 'Items');
  const wsBOM = XLSX.utils.json_to_sheet(boms);
  XLSX.utils.book_append_sheet(wb, wsBOM, 'BOMs');
  const wsInv = XLSX.utils.json_to_sheet(inventory);
  XLSX.utils.book_append_sheet(wb, wsInv, 'Inventory');
  const wsPO = XLSX.utils.json_to_sheet(pos);
  XLSX.utils.book_append_sheet(wb, wsPO, 'POs');

  const now = new Date();
  const stamp = now.toISOString().slice(0,19).replace(/[:T]/g,'');
  const filename = `mrp_export_${stamp}.xlsx`;
  const desktop = path.join(os.homedir(), 'Desktop');
  const outPath = path.join(desktop, filename);
  XLSX.writeFile(wb, outPath);
  return outPath;
}

contextBridge.exposeInMainWorld('api', {
  getItems: () => db.getItems(),
  getBOMForParent: (code) => db.getBOMForParent(code),
  addItem: (item) => db.addItem(item),
  getInventory: () => db.getInventory(),
  addInventory: (inv) => db.addInventory(inv),
  getBOMs: () => db.getBOMs(),
  addBOM: (bom) => db.addBOM(bom),
  updateBOM: (id, fields) => db.updateBOM(id, fields),
  deleteBOM: (id) => db.deleteBOM(id),
  createPO: (po) => db.createPO(po),
  getPOs: () => db.getPOs(),
  runMRP: (planningDays) => db.runMRP(planningDays),
  updateItemLeadTime: (code, days) => db.updateItemLeadTime(code, days),
  updateItemBatchSize: (code, size) => db.updateItemBatchSize(code, size),
  importExcel: (u8arr) => importExcelBuffer(u8arr),
  exportAllExcel: () => exportAllExcel()
  ,
  replaceRawMaterial: (oldCode, newCode, createIfMissing) => db.replaceRawMaterial(oldCode, newCode, createIfMissing),
  replaceRawMaterialBulk: (oldPattern, newPattern, createIfMissing) => db.replaceRawMaterialBulk(oldPattern, newPattern, createIfMissing),
  getReplaceHistory: () => db.getReplaceHistory(),
  undoReplace: (historyId) => db.undoReplace(historyId)
});
