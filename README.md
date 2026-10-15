# 🏰 Ultima Online Housing & Art Studio

A local, high-performance web application designed for Ultima Online server administrators, builders, and community members. Built with the authentic medieval parchment and dark aesthetic of the classic housing gallery, this application bridges your client art files, server multis, and server scripts into a unified studio.

---

## 🌟 Key Features

### 1. 🏛️ Server Housing Menu (Classic & Prebuilt Gallery)
* **Direct Multi & Art Rendering**: Reads directly from your server's `multi.idx` / `multi.mul` and client's `artidx.mul` / `art.mul`.
* **Interactive Floor Selector**: Switch between Whole House (Full), Ground Floor, and upper floors with instantaneous rendering, just like standing inside the house in-game.
* **Full-Screen Lightbox**: High-resolution viewer with keyboard arrow navigation (`←` previous, `→` next, `↑`/`↓` change floor, `Esc` close).
* **Sorting & Searching**: Filter by Price, Storage (secures), Lockdowns, Vendors, Floors, Name, or Multi ID (hex/dec).

### 2. 🌐 House Design Library (Online & Community Repository)
* **Browse Custom Community Designs**: Includes custom community architecture (Gothic Victorian Manors, Zen Pagodas & Dojos, Sandstone Oasis Villas, Dragon Slayer Keeps, Coastal Lighthouses, Wayfarer Taverns, Arcanist Spires).
* **Live Incompatibility Detection**: Automatically scans every tile component of any library house against your active client artwork:
  * 🟢 **100% Compatible**: House uses standard tiles already present in your files.
  * ⚠️ **Incompatible Warning**: Houses using custom or missing tiles prominently display warning badges indicating exactly how many tiles are missing.
* **1-Click Server Import**: Add compatible houses to your server housing menu immediately.

### 3. 🔧 Tile Compatibility & Substitution Workbench
* **Missing Tile Resolution**: For any custom house with artwork not present in your files, view a detailed list of missing tile IDs, counts, and expected descriptions.
* **Searchable Visual Tile Picker**: Live search your server's active artwork by keyword (`wall`, `floor`, `stairs`, `roof`, `door`, `stone`) or tile ID (`0x03EE`).
* **Interactive Remapping**: Pick any replacement tile from your art files with real-time sprite previews.
* **Batch Substitute & Commit**: Remaps the house multi definition to use your server's tiles and adds the house to your server with zero client crashes.

### 4. ✏️ House Stat Editor & Automated C# Script Sync
* **Adjust Housing Parameters**: Edit Gold Price, Lockdowns, Secure Storage, and Vendor limits.
* **Safe Server Synchronization**: Updates `HousePlacementContainer.cs` on your server automatically.
* **Automated Backups**: Creates a timestamped backup (`.bak.<timestamp>`) before modifying any server script.

### 5. ⚖️ Art & Client Comparison Tool (Client Merger / Diff Tool)
* **Side-by-Side Directory Comparison**: Compare two directories (e.g. current client vs. new expansion download, patch folder, or another shard's client).
* **Deep Multi & Tile Inspection**:
  * Detects **Identical Tiles** (matching pixels and tiledata attributes).
  * Detects **Graphic Mismatches** (same ID, different sprite graphics).
  * Detects **Tiledata Diffs** (name, height, or flag discrepancies like Impassable, Wall, Surface, Bridge).
  * Detects **Missing in A** (exists in comparison client, missing in base).
  * Detects **Missing in B** (exists in base client, missing in comparison).
* **Pixel Zoom Inspection**: Side-by-side sprite modal with 2x pixelated zoom and flag breakdown.

---

## 🚀 Quick Start

### Starting the Studio
Double-click `start-app.bat` or run:

```powershell
npm start
```

Your browser will automatically open to:
```
http://localhost:3000
```

---

## ⚙️ Directory Configuration

Go to the **Directories & Settings** tab in the studio to confirm or adjust your paths:

1. **Server Multi Files**:
   * Default: `e:\Projects\ultima-schematics\Files`
   * Contains: `multi.idx`, `multi.mul`, `tiledata.mul`, `Cliloc.enu`
2. **Client Art Files**:
   * Default: `C:\Ultima-Adventures\Client\Data Files`
   * Contains: `artidx.mul`, `art.mul`, `tiledata.mul`
3. **Server Housing Scripts**:
   * Default: `E:\Projects\ultima-adventures\Scripts\Engines and systems\Houses`
   * Contains: `HousePlacementContainer.cs`, `Houses.cs`, `NewHouses.cs`

---

## 📁 Project Architecture

```
ultima-schematics/
├── Files/                     # Server binary files (multi.idx/mul, tiledata.mul, Cliloc.enu)
├── images/                    # High-res prebuilt house renders
├── images_floors/             # Layered floor renders
├── data/
│   ├── config.json            # Persisted local directory paths & settings
│   ├── houses.json            # Server housing catalog (68 classic + custom additions)
│   └── library.json           # Community house designs repository
├── public/
│   ├── index.html             # Extended UI preserving original Cinzel/Source Sans aesthetic
│   ├── app.js                 # Frontend application & interactive workbenches
│   └── app.css                # Parchment & Dark theme styles
├── server.js                  # Zero-dependency Node.js backend with binary parsers
├── start-app.bat              # One-click Windows launcher
├── package.json               # Node.js project manifest
└── README.md                  # Documentation
```
