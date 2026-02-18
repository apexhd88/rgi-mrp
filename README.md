# MRP Desktop — Minimal

This is a minimal Electron desktop app demonstrating a tiny MRP system (items, BOM, inventory, purchase orders, a simple MRP run).

Quick start (Windows):

1. Open a terminal in the `mrp-desktop` folder.
2. Install dependencies:

```powershell
npm install
```

3. Run the app:

```powershell
npm start
```

Notes:
- Data is stored in `data/mrp.db` (SQLite). Seed sample items are created on first run.
- This is a minimal scaffold — features like multi-level BOM explode, lead time handling, safety stock, scheduling, and full procurement workflows are intentionally simplified.

New features added:
- Multi-level BOM explosion for `Run MRP` (explodes recursively and nets against inventory and open POs).
- Excel import: drop an `.xlsx` file with sheets named `Items`, `BOM`/`BOMs`, `Inventory`, `POs` to import data.
- Excel export: exports `Items`, `BOMs`, `Inventory`, `POs` to `Desktop/mrp_export_*.xlsx`.
 - Lead times on items and planning horizon: set item `lead_time` in the `Items` view; `Run MRP` will ask for a planning horizon (days) and compute suggested order dates (due date minus lead time), flagging urgent orders.
 - Dilution-aware BOMs: BOM lines can be marked as diluents with `PerMainQty` and `DilutionMain` so diluents are exploded based on the quantity of the main ingredient.
 - Replace Raw Material: in the `Items` view use `Replace RM` to replace a raw material across inventory, BOMs, production orders and POs (optionally creating the replacement item).
 - Bulk replace: use the `Bulk Replace` button to replace many RM codes at once. Supports a `*` wildcard (e.g. `OLD_*` -> `NEW_*`).
 - Undo replace: the app records replacement snapshots; use `Undo Last Replace` to revert the most recent replacement.
 - PO import: the import accepts minimal PO columns — `Code` (RM code), `Qty` and any of `ETA`, `Date`, `ArrivalDate`, or `Arrival Date` for arrival/ETA.
 - BOM editor: use the `BOM` button to open the full BOM editor. Select a parent FG, view/add/edit/delete BOM lines, set dilution flags and `PerMainQty`. When adding a line you can enter quantities `Per Batch` (e.g. per 25kg FG) or `Per Kg` — `Per Batch` values are converted to per-kg using the parent `batch_size`.
 - Batch sizing: items have `batch_size` (default 25 kg). When running MRP, production orders are rounded up to whole batches (minimum 1 batch). The `Items` view lets you edit `batch_size`.

If you want, I can:
- Add multi-level BOM explosion
- Add a planning horizon and lead times
- Add import/export (CSV/XLSX)
- Add user authentication and roles

Build a Windows executable via GitHub Actions
- I added a GitHub Actions workflow at `.github/workflows/windows-build.yml` that packages the app on a Windows runner using `electron-packager` and uploads the packaged `dist/` folder as an artifact.
- To use it:
	1. Initialize a git repo in `mrp-desktop`, commit all files and push to a GitHub repository.
	2. Push to the `main` branch (or run the workflow manually in the Actions tab).
	3. After the workflow finishes, download the `mrp-desktop-windows` artifact from the run — it contains the packaged app under `dist/` (run `mrp-desktop.exe`).

If you prefer, I can create the GitHub repository for you and push these files (I will need a remote URL or permission). Would you like me to do that, or shall I guide you through creating the repo and triggering the workflow?
