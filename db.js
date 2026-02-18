const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'mrp.db');
const db = new Database(dbPath);

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT,
      uom TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      location TEXT,
      qty REAL DEFAULT 0,
      FOREIGN KEY(item_id) REFERENCES items(id)
    );

    CREATE TABLE IF NOT EXISTS boms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      child_id INTEGER,
      qty REAL,
      FOREIGN KEY(parent_id) REFERENCES items(id),
      FOREIGN KEY(child_id) REFERENCES items(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      qty REAL,
      eta TEXT,
      status TEXT DEFAULT 'OPEN'
    );

    CREATE TABLE IF NOT EXISTS production_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      qty REAL,
      due_date TEXT,
      status TEXT DEFAULT 'OPEN'
    );
  `);

  // history table for replacements (undo support)
  db.exec(`
    CREATE TABLE IF NOT EXISTS replace_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT,
      old_code TEXT,
      new_code TEXT,
      snapshot TEXT
    );
  `);

  // add lead_time column to items if missing
  const info = db.prepare("PRAGMA table_info('items')").all();
  const hasLead = info.find(c => c.name === 'lead_time');
  if (!hasLead) {
    db.exec("ALTER TABLE items ADD COLUMN lead_time INTEGER DEFAULT 0");
  }
  const hasBatch = info.find(c => c.name === 'batch_size');
  if (!hasBatch) {
    db.exec("ALTER TABLE items ADD COLUMN batch_size REAL DEFAULT 25");
  }

  // add dilution columns to boms if missing
  const bomInfo = db.prepare("PRAGMA table_info('boms')").all();
  const hasIsDilution = bomInfo.find(c => c.name === 'is_dilution');
  const hasPerMain = bomInfo.find(c => c.name === 'per_main_qty');
  const hasDilMain = bomInfo.find(c => c.name === 'dilution_main_id');
  if (!hasIsDilution) db.exec("ALTER TABLE boms ADD COLUMN is_dilution INTEGER DEFAULT 0");
  if (!hasPerMain) db.exec("ALTER TABLE boms ADD COLUMN per_main_qty REAL DEFAULT NULL");
  if (!hasDilMain) db.exec("ALTER TABLE boms ADD COLUMN dilution_main_id INTEGER DEFAULT NULL");

  // seed sample items if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO items (code, name, uom) VALUES (?, ?, ?)');
    insert.run('RAW_A', 'Raw Material A', 'kg');
    insert.run('RAW_B', 'Raw Material B', 'kg');
    insert.run('PROD_X', 'Product X', 'kg');

    const getId = db.prepare('SELECT id FROM items WHERE code = ?');
    const rawA = getId.get('RAW_A').id;
    const rawB = getId.get('RAW_B').id;
    const prodX = getId.get('PROD_X').id;

    const invInsert = db.prepare('INSERT INTO inventory (item_id, location, qty) VALUES (?, ?, ?)');
    invInsert.run(rawA, 'Main', 100);
    invInsert.run(rawB, 'Main', 50);
    invInsert.run(prodX, 'Finished', 10);

    const bomInsert = db.prepare('INSERT INTO boms (parent_id, child_id, qty) VALUES (?, ?, ?)');
    bomInsert.run(prodX, rawA, 2);
    bomInsert.run(prodX, rawB, 1);

    const poInsert = db.prepare('INSERT INTO purchase_orders (item_id, qty, eta) VALUES (?, ?, ?)');
    poInsert.run(rawA, 200, '2026-03-01');
  }
}

init();

module.exports = {
  getItems: () => db.prepare('SELECT * FROM items').all(),
  addItem: (i) => {
    const stmt = db.prepare('INSERT INTO items (code, name, uom, lead_time) VALUES (?, ?, ?, ?)');
    return stmt.run(i.code, i.name, i.uom, i.lead_time || 0);
  },
  getInventory: () => db.prepare('SELECT inventory.id, items.code, items.name, inventory.location, inventory.qty FROM inventory JOIN items ON inventory.item_id = items.id').all(),
  addInventory: (inv) => {
    const get = db.prepare('SELECT id FROM items WHERE code = ?').get(inv.code);
    if (!get) throw new Error('Item not found');
    return db.prepare('INSERT INTO inventory (item_id, location, qty) VALUES (?, ?, ?)').run(get.id, inv.location, inv.qty);
  },
  getBOMs: () => db.prepare('SELECT b.id, p.code as parent_code, c.code as child_code, b.qty, b.is_dilution, b.per_main_qty, dm.code as dilution_main_code FROM boms b JOIN items p ON b.parent_id = p.id JOIN items c ON b.child_id = c.id LEFT JOIN items dm ON b.dilution_main_id = dm.id').all(),
  getBOMForParent: (parentCode) => db.prepare('SELECT b.id, p.code as parent_code, c.code as child_code, b.qty, b.is_dilution, b.per_main_qty, dm.code as dilution_main_code FROM boms b JOIN items p ON b.parent_id = p.id JOIN items c ON b.child_id = c.id LEFT JOIN items dm ON b.dilution_main_id = dm.id WHERE p.code = ?').all(parentCode),
  addBOM: (bom) => {
    const parent = db.prepare('SELECT id FROM items WHERE code = ?').get(bom.parent);
    const child = db.prepare('SELECT id FROM items WHERE code = ?').get(bom.child);
    if (!parent || !child) throw new Error('Parent or child not found');
    let dilMainId = null;
    if (bom.dilution_main) {
      const dm = db.prepare('SELECT id FROM items WHERE code = ?').get(bom.dilution_main);
      if (!dm) throw new Error('Dilution main item not found');
      dilMainId = dm.id;
    }
    const stmt = db.prepare('INSERT INTO boms (parent_id, child_id, qty, is_dilution, per_main_qty, dilution_main_id) VALUES (?, ?, ?, ?, ?, ?)');
    return stmt.run(parent.id, child.id, bom.qty, bom.is_dilution ? 1 : 0, bom.per_main_qty || null, dilMainId);
  },
  updateBOM: (id, fields) => {
    const row = db.prepare('SELECT * FROM boms WHERE id = ?').get(id);
    if (!row) throw new Error('BOM line not found');
    const parent = fields.parent ? db.prepare('SELECT id FROM items WHERE code = ?').get(fields.parent).id : row.parent_id;
    const child = fields.child ? db.prepare('SELECT id FROM items WHERE code = ?').get(fields.child).id : row.child_id;
    const qty = (typeof fields.qty !== 'undefined') ? fields.qty : row.qty;
    const is_dilution = (typeof fields.is_dilution !== 'undefined') ? (fields.is_dilution ? 1 : 0) : row.is_dilution;
    const per_main_qty = (typeof fields.per_main_qty !== 'undefined') ? fields.per_main_qty : row.per_main_qty;
    let dilation_main_id = row.dilution_main_id;
    if (fields.dilution_main) {
      const dm = db.prepare('SELECT id FROM items WHERE code = ?').get(fields.dilution_main);
      dilation_main_id = dm ? dm.id : null;
    }
    return db.prepare('UPDATE boms SET parent_id = ?, child_id = ?, qty = ?, is_dilution = ?, per_main_qty = ?, dilution_main_id = ? WHERE id = ?').run(parent, child, qty, is_dilution, per_main_qty, dilation_main_id, id);
  },
  deleteBOM: (id) => {
    return db.prepare('DELETE FROM boms WHERE id = ?').run(id);
  },
  updateItemLeadTime: (code, days) => {
    const row = db.prepare('SELECT id FROM items WHERE code = ?').get(code);
    if (!row) throw new Error('Item not found');
    return db.prepare('UPDATE items SET lead_time = ? WHERE id = ?').run(parseInt(days, 10) || 0, row.id);
  },
  updateItemBatchSize: (code, size) => {
    const row = db.prepare('SELECT id FROM items WHERE code = ?').get(code);
    if (!row) throw new Error('Item not found');
    return db.prepare('UPDATE items SET batch_size = ? WHERE id = ?').run(parseFloat(size) || 25, row.id);
  },
  createPO: (po) => {
    const itm = db.prepare('SELECT id FROM items WHERE code = ?').get(po.code);
    if (!itm) throw new Error('Item not found');
    return db.prepare('INSERT INTO purchase_orders (item_id, qty, eta) VALUES (?, ?, ?)').run(itm.id, po.qty, po.eta);
  },
  getPOs: () => db.prepare('SELECT p.id, i.code, p.qty, p.eta, p.status FROM purchase_orders p JOIN items i ON p.item_id = i.id').all(),
  runMRP: () => {
    // Multi-level MRP explode with dilution support: take open production orders as demand,
    // recursively explode BOMs, handle dilution lines (per-main quantities),
    // then net requirements against inventory and open POs.
    const prod = db.prepare('SELECT po.id, i.code, po.qty, po.due_date FROM production_orders po JOIN items i ON po.item_id = i.id WHERE po.status = "OPEN"').all();

    const boms = db.prepare('SELECT p.code as parent, c.code as child, b.qty, b.is_dilution, b.per_main_qty, dm.code as dilution_main FROM boms b JOIN items p ON b.parent_id = p.id JOIN items c ON b.child_id = c.id LEFT JOIN items dm ON b.dilution_main_id = dm.id').all();
    const bomMap = {}; // normal children
    const dilutionMap = {}; // key = main ingredient code -> array of diluent lines
    boms.forEach(b => {
      if (b.is_dilution) {
        if (b.dilution_main) {
          if (!dilutionMap[b.dilution_main]) dilutionMap[b.dilution_main] = [];
          dilutionMap[b.dilution_main].push({ child: b.child, per_main_qty: b.per_main_qty || 0 });
        }
      } else {
        if (!bomMap[b.parent]) bomMap[b.parent] = [];
        bomMap[b.parent].push({ child: b.child, qty: b.qty });
      }
    });

    const requirements = {};

    function addRequirement(code, qty, dueDate) {
      if (!requirements[code]) requirements[code] = [];
      requirements[code].push({ qty: qty, due_date: dueDate });
      // if this code has dilution entries where it is the main, generate diluent needs
      const dlines = dilutionMap[code] || [];
      dlines.forEach(d => {
        const needDil = qty * d.per_main_qty;
        if (needDil > 0) {
          if (!requirements[d.child]) requirements[d.child] = [];
          requirements[d.child].push({ qty: needDil, due_date: dueDate });
          // also explode diluent children if it has BOM itself
          explodeWithDate(d.child, needDil, dueDate);
        }
      });
    }

    function explodeWithDate(parent, qty, dueDate) {
      const children = bomMap[parent];
      if (!children) return;
      children.forEach(ch => {
        const need = qty * ch.qty;
        addRequirement(ch.child, need, dueDate);
        explodeWithDate(ch.child, need, dueDate);
      });
    }

    prod.forEach(p => {
      const due = p.due_date || null;
      // respect batch size: determine item batch_size (default 25)
      const bsRow = db.prepare('SELECT batch_size FROM items WHERE code = ?').get(p.code) || { batch_size: 25 };
      const batchSize = bsRow.batch_size || 25;
      const batches = Math.max(1, Math.ceil(p.qty / batchSize));
      const effectiveQty = batches * batchSize;
      // store batches info in demand
      p.batches = batches;
      p.effectiveQty = effectiveQty;
      addRequirement(p.code, effectiveQty, due);
      explodeWithDate(p.code, effectiveQty, due);
    });

    const inventory = db.prepare('SELECT items.code, SUM(inventory.qty) as qty FROM inventory JOIN items ON inventory.item_id = items.id GROUP BY items.code').all();
    const invMap = {};
    inventory.forEach(r => { invMap[r.code] = r.qty; });

    const poRows = db.prepare('SELECT i.code, SUM(p.qty) as qty FROM purchase_orders p JOIN items i ON p.item_id = i.id WHERE p.status = "OPEN" GROUP BY i.code').all();
    const poMap = {};
    poRows.forEach(r => { poMap[r.code] = r.qty; });

    const result = [];
    // summarize per code: total need and earliest due date
    Object.keys(requirements).forEach(code => {
      const arr = requirements[code];
      let totalNeed = 0;
      let earliest = null;
      arr.forEach(r => {
        totalNeed += r.qty;
        if (r.due_date) {
          const d = new Date(r.due_date);
          if (!earliest || d < earliest) earliest = d;
        }
      });
      const earliestStr = earliest ? earliest.toISOString().slice(0,10) : null;
      const onHand = invMap[code] || 0;
      const onPO = poMap[code] || 0;
      const net = totalNeed - onHand - onPO;
      // get lead time for item
      const ltRow = db.prepare('SELECT lead_time FROM items WHERE code = ?').get(code) || { lead_time: 0 };
      const lead = ltRow.lead_time || 0;
      // compute suggested order date = earliestDue - lead days
      let suggested = null;
      let daysUntilOrder = null;
      let urgent = false;
      if (earliest) {
        const sd = new Date(earliest);
        sd.setDate(sd.getDate() - lead);
        suggested = sd.toISOString().slice(0,10);
        const today = new Date();
        const diff = Math.ceil((sd - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / (1000*60*60*24));
        daysUntilOrder = diff;
        urgent = sd <= new Date();
      }
      result.push({ code, need: totalNeed, earliestDue: earliestStr, lead_time: lead, onHand, onPO, net: net > 0 ? net : 0, suggestedOrderDate: suggested, daysUntilOrder, urgent });
    });

    return { demand: prod, explodedRequirements: result, bomMap, dilutionMap };
  },
  replaceRawMaterial: (oldCode, newCode, createIfMissing) => {
    const oldRow = db.prepare('SELECT * FROM items WHERE code = ?').get(oldCode);
    if (!oldRow) throw new Error('Old item not found');
    let newRow = db.prepare('SELECT id FROM items WHERE code = ?').get(newCode);
    if (!newRow) {
      if (createIfMissing) {
        const ins = db.prepare('INSERT INTO items (code, name, uom, lead_time) VALUES (?, ?, ?, ?)');
        ins.run(newCode, newCode, 'ea', 0);
        newRow = db.prepare('SELECT id FROM items WHERE code = ?').get(newCode);
      } else {
        throw new Error('New item not found');
      }
    }
    const oldId = oldRow.id;
    const newId = newRow.id;

    // snapshot affected rows for undo
    const inventoryRows = db.prepare('SELECT * FROM inventory WHERE item_id = ?').all(oldId);
    const bomRows = db.prepare('SELECT * FROM boms WHERE parent_id = ? OR child_id = ? OR dilution_main_id = ?').all(oldId, oldId, oldId);
    const poRows = db.prepare('SELECT * FROM purchase_orders WHERE item_id = ?').all(oldId);
    const prodRows = db.prepare('SELECT * FROM production_orders WHERE item_id = ?').all(oldId);
    const snapshot = JSON.stringify({ oldItem: oldRow, inventoryRows, bomRows, poRows, prodRows });
    const ts = new Date().toISOString();
    db.prepare('INSERT INTO replace_history (ts, old_code, new_code, snapshot) VALUES (?, ?, ?, ?)').run(ts, oldCode, newCode, snapshot);

    // perform replacement
    db.prepare('UPDATE inventory SET item_id = ? WHERE item_id = ?').run(newId, oldId);
    db.prepare('UPDATE boms SET parent_id = ? WHERE parent_id = ?').run(newId, oldId);
    db.prepare('UPDATE boms SET child_id = ? WHERE child_id = ?').run(newId, oldId);
    db.prepare('UPDATE boms SET dilution_main_id = ? WHERE dilution_main_id = ?').run(newId, oldId);
    db.prepare('UPDATE purchase_orders SET item_id = ? WHERE item_id = ?').run(newId, oldId);
    db.prepare('UPDATE production_orders SET item_id = ? WHERE item_id = ?').run(newId, oldId);

    return { replaced: true, history_ts: ts };
  },
  replaceRawMaterialBulk: (oldPattern, newPattern, createIfMissing) => {
    // support prefix* patterns. If oldPattern contains '*', treat as prefix capture
    const results = [];
    if (oldPattern.includes('*')) {
      const parts = oldPattern.split('*');
      const prefix = parts[0];
      const rows = db.prepare('SELECT code FROM items WHERE code LIKE ?').all(prefix + '%');
      rows.forEach(r => {
        const suffix = r.code.slice(prefix.length);
        let newCode = newPattern.includes('*') ? newPattern.replace('*', suffix) : newPattern;
        try {
          const res = module.exports.replaceRawMaterial(r.code, newCode, createIfMissing);
          results.push({ old: r.code, new: newCode, ok: true, res });
        } catch (e) {
          results.push({ old: r.code, new: newCode, ok: false, error: e.message });
        }
      });
    } else {
      // exact match
      try {
        const res = module.exports.replaceRawMaterial(oldPattern, newPattern, createIfMissing);
        results.push({ old: oldPattern, new: newPattern, ok: true, res });
      } catch (e) {
        results.push({ old: oldPattern, new: newPattern, ok: false, error: e.message });
      }
    }
    return results;
  },
  getReplaceHistory: () => db.prepare('SELECT id, ts, old_code, new_code FROM replace_history ORDER BY id DESC').all(),
  undoReplace: (historyId) => {
    const h = db.prepare('SELECT * FROM replace_history WHERE id = ?').get(historyId);
    if (!h) throw new Error('History entry not found');
    const snap = JSON.parse(h.snapshot);
    const oldItem = snap.oldItem;
    // ensure old item exists
    const existing = db.prepare('SELECT id FROM items WHERE code = ?').get(oldItem.code);
    let oldId = existing ? existing.id : null;
    if (!oldId) {
      const ins = db.prepare('INSERT INTO items (code, name, uom, lead_time) VALUES (?, ?, ?, ?)');
      const r = ins.run(oldItem.code, oldItem.name || oldItem.code, oldItem.uom || 'ea', oldItem.lead_time || 0);
      oldId = r.lastInsertRowid;
    }
    // restore inventory rows (by id)
    (snap.inventoryRows || []).forEach(row => {
      db.prepare('UPDATE inventory SET item_id = ?, location = ?, qty = ? WHERE id = ?').run(oldId, row.location, row.qty, row.id);
    });
    // restore boms
    (snap.bomRows || []).forEach(row => {
      db.prepare('UPDATE boms SET parent_id = ?, child_id = ?, qty = ?, is_dilution = ?, per_main_qty = ?, dilution_main_id = ? WHERE id = ?').run(row.parent_id, row.child_id, row.qty, row.is_dilution || 0, row.per_main_qty || null, row.dilution_main_id || null, row.id);
    });
    // restore POs
    (snap.poRows || []).forEach(row => {
      db.prepare('UPDATE purchase_orders SET item_id = ?, qty = ?, eta = ?, status = ? WHERE id = ?').run(oldId, row.qty, row.eta, row.status, row.id);
    });
    // restore production orders
    (snap.prodRows || []).forEach(row => {
      db.prepare('UPDATE production_orders SET item_id = ?, qty = ?, due_date = ?, status = ? WHERE id = ?').run(oldId, row.qty, row.due_date, row.status, row.id);
    });
    return { undone: true };
  },
};
