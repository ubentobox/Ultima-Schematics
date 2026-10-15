/**
 * Ultima Online Housing & Art Studio Server
 * Zero-dependency Node.js backend for UO binary inspection, housing management,
 * online design library, multi-directory client comparison, and server script synchronization.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');
const crypto = require('crypto');

// ==========================================
// CONFIGURATION & PERSISTENCE
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HOUSES_FILE = path.join(DATA_DIR, 'houses.json');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');

let config = {
  serverFilesDir: path.join(__dirname, 'Files'),
  clientArtDir: 'C:\\Ultima-Adventures\\Client\\Data Files',
  serverScriptsDir: 'E:\\Projects\\ultima-adventures\\Scripts\\Engines and systems\\Houses',
  port: 3000,
  theme: 'dark',
  autoOpenBrowser: true,
  remoteRepositories: []
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...config, ...data };
    }
  } catch (err) {
    console.error('Error loading config.json:', err.message);
  }
}

function saveConfig() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config.json:', err.message);
  }
}

loadConfig();

// ==========================================
// PNG GENERATION (Pure Node built-in zlib)
// ==========================================
const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? -306674912 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return crc ^ -1;
}

function createPng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8-bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // No interlace

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(Buffer.from([0])); // Filter type 0: None
    rawRows.push(rgbaBuffer.subarray(y * width * 4, (y + 1) * width * 4));
  }
  const idat = makeChunk('IDAT', zlib.deflateSync(Buffer.concat(rawRows)));
  return Buffer.concat([signature, makeChunk('IHDR', ihdr), idat, makeChunk('IEND', Buffer.alloc(0))]);
}

// 1x1 transparent PNG fallback
const TRANSPARENT_PNG = createPng(1, 1, Buffer.alloc(4, 0));

// ==========================================
// UO BINARY READERS
// ==========================================

class UOArtReader {
  constructor(dir) {
    this.dir = dir;
    this.idxPath = path.join(dir, 'artidx.mul');
    this.mulPath = path.join(dir, 'art.mul');
    this.fdIdx = null;
    this.fdMul = null;
    this.totalEntries = 0;
    this.cache = new Map(); // graphic -> PNG Buffer
    this.bitmapCache = new Map(); // graphic -> { width, height, rgba }
    this.init();
  }

  init() {
    this.close();
    if (fs.existsSync(this.idxPath) && fs.existsSync(this.mulPath)) {
      try {
        this.fdIdx = fs.openSync(this.idxPath, 'r');
        this.fdMul = fs.openSync(this.mulPath, 'r');
        const st = fs.fstatSync(this.fdIdx);
        this.totalEntries = Math.floor(st.size / 12);
      } catch (e) {
        console.error(`Error opening art in ${this.dir}:`, e.message);
      }
    }
  }

  close() {
    if (this.fdIdx !== null) { try { fs.closeSync(this.fdIdx); } catch (_) {} this.fdIdx = null; }
    if (this.fdMul !== null) { try { fs.closeSync(this.fdMul); } catch (_) {} this.fdMul = null; }
    this.cache.clear();
    if (this.bitmapCache) this.bitmapCache.clear();
  }

  isAvailable() {
    return this.fdIdx !== null && this.fdMul !== null;
  }

  getStaticArtEntry(graphic) {
    if (!this.isAvailable()) return null;
    const entryIndex = 0x4000 + graphic;
    if (entryIndex >= this.totalEntries || entryIndex < 0) return null;

    const buf = Buffer.alloc(12);
    fs.readSync(this.fdIdx, buf, 0, 12, entryIndex * 12);
    const lookup = buf.readUInt32LE(0);
    const length = buf.readUInt32LE(4);
    if (lookup === 0xFFFFFFFF || length === 0) return null;
    return { lookup, length };
  }

  getTileRaw(graphic) {
    const entry = this.getStaticArtEntry(graphic);
    if (!entry) return null;
    const raw = Buffer.alloc(entry.length);
    fs.readSync(this.fdMul, raw, 0, entry.length, entry.lookup);
    return raw;
  }

  getTileHash(graphic) {
    const raw = this.getTileRaw(graphic);
    if (!raw) return null;
    return {
      exists: true,
      length: raw.length,
      md5: crypto.createHash('md5').update(raw).digest('hex')
    };
  }

  getTilePixelHash(graphic, preloadedRaw = null) {
    const raw = preloadedRaw || this.getTileRaw(graphic);
    if (!raw || raw.length < 8) return null;
    const width = raw.readUInt16LE(4);
    const height = raw.readUInt16LE(6);
    if (width === 0 || height === 0 || width > 1024 || height > 1024) return null;

    const lineOffsets = [];
    for (let y = 0; y < height; y++) {
      lineOffsets.push(raw.readUInt16LE(8 + y * 2));
    }
    const dataStart = 8 + height * 2;
    const rgba = Buffer.alloc(width * height * 2, 0);

    for (let y = 0; y < height; y++) {
      let pos = dataStart + lineOffsets[y] * 2;
      let x = 0;
      while (pos + 4 <= raw.length) {
        const xoff = raw.readUInt16LE(pos);
        const run = raw.readUInt16LE(pos + 2);
        pos += 4;
        if (xoff + run === 0) break;
        x += xoff;
        for (let j = 0; j < run; j++) {
          if (pos + 2 > raw.length) break;
          const val = raw.readUInt16LE(pos);
          pos += 2;
          if (val !== 0 && x < width) {
            const p = (y * width + x) * 2;
            rgba.writeUInt16LE(val, p);
          }
          x++;
        }
      }
    }
    return `${width}x${height}_${crypto.createHash('md5').update(rgba).digest('hex')}`;
  }

  getStaticBitmap(graphic) {
    if (this.bitmapCache && this.bitmapCache.has(graphic)) return this.bitmapCache.get(graphic);
    const raw = this.getTileRaw(graphic);
    if (!raw || raw.length < 8) return null;

    const width = raw.readUInt16LE(4);
    const height = raw.readUInt16LE(6);
    if (width === 0 || height === 0 || width > 1024 || height > 1024) return null;

    const lineOffsets = [];
    for (let y = 0; y < height; y++) {
      lineOffsets.push(raw.readUInt16LE(8 + y * 2));
    }
    const dataStart = 8 + height * 2;
    const rgba = Buffer.alloc(width * height * 4, 0);

    for (let y = 0; y < height; y++) {
      let pos = dataStart + lineOffsets[y] * 2;
      let x = 0;
      while (pos + 4 <= raw.length) {
        const xoff = raw.readUInt16LE(pos);
        const run = raw.readUInt16LE(pos + 2);
        pos += 4;
        if (xoff + run === 0) break;
        x += xoff;
        for (let j = 0; j < run; j++) {
          if (pos + 2 > raw.length) break;
          const val = raw.readUInt16LE(pos);
          pos += 2;
          if (val !== 0 && x < width) {
            const r5 = (val >> 10) & 0x1F, g5 = (val >> 5) & 0x1F, b5 = val & 0x1F;
            const p = (y * width + x) * 4;
            rgba[p]     = (r5 << 3) | (r5 >> 2);
            rgba[p + 1] = (g5 << 3) | (g5 >> 2);
            rgba[p + 2] = (b5 << 3) | (b5 >> 2);
            rgba[p + 3] = 255;
          }
          x++;
        }
      }
    }

    const bmp = { width, height, rgba };
    if (this.bitmapCache) {
      if (this.bitmapCache.size > 3000) this.bitmapCache.clear();
      this.bitmapCache.set(graphic, bmp);
    }
    return bmp;
  }

  getStaticPng(graphic) {
    if (this.cache.has(graphic)) return this.cache.get(graphic);
    const bmp = this.getStaticBitmap(graphic);
    if (!bmp) return null;

    const png = createPng(bmp.width, bmp.height, bmp.rgba);
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(graphic, png);
    return png;
  }
}

class UOTileDataReader {
  constructor(dir) {
    this.dir = dir;
    this.filePath = path.join(dir, 'tiledata.mul');
    this.fd = null;
    this.fileSize = 0;
    this.isHSA = false;
    this.init();
  }

  init() {
    if (this.fd !== null) { try { fs.closeSync(this.fd); } catch (_) {} this.fd = null; }
    if (fs.existsSync(this.filePath)) {
      try {
        this.fd = fs.openSync(this.filePath, 'r');
        this.fileSize = fs.fstatSync(this.fd).size;
        this.isHSA = (this.fileSize === 3188736);
      } catch (e) {
        console.error(`Error opening tiledata in ${this.dir}:`, e.message);
      }
    }
  }

  isAvailable() {
    return this.fd !== null;
  }

  getStaticTile(graphic) {
    if (!this.isAvailable()) return null;
    const landSize = this.isHSA ? 512 * (4 + 32 * 30) : 512 * (4 + 32 * 26);
    const itemGroupSize = this.isHSA ? (4 + 32 * 41) : (4 + 32 * 37);
    const itemRecordSize = this.isHSA ? 41 : 37;

    const group = Math.floor(graphic / 32);
    const indexInGroup = graphic % 32;
    const offset = landSize + group * itemGroupSize + 4 + indexInGroup * itemRecordSize;

    if (offset + itemRecordSize > this.fileSize) return null;

    const buf = Buffer.alloc(itemRecordSize);
    fs.readSync(this.fd, buf, 0, itemRecordSize, offset);

    let flags, weight, quality, height, name;
    if (this.isHSA) {
      flags = buf.readBigUInt64LE(0);
      weight = buf[8];
      quality = buf[9];
      height = buf[20];
      name = buf.subarray(21, 41).toString('latin1').replace(/\0.*$/g, '').trim();
    } else {
      flags = BigInt(buf.readUInt32LE(0));
      weight = buf[4];
      quality = buf[5];
      height = buf[16];
      name = buf.subarray(17, 37).toString('latin1').replace(/\0.*$/g, '').trim();
    }

    const flagWall = (flags & 0x00000010n) !== 0n;
    const flagImpassable = (flags & 0x00000040n) !== 0n;
    const flagSurface = (flags & 0x00000200n) !== 0n;
    const flagBridge = (flags & 0x00000400n) !== 0n;
    const flagRoof = (flags & 0x10000000n) !== 0n;
    const flagDoor = (flags & 0x20000000n) !== 0n;

    let friendlyName = name;
    if (!friendlyName) {
      if (flagSurface) friendlyName = 'Floor / Surface';
      else if (flagWall) friendlyName = 'Wall Structure';
      else if (flagRoof) friendlyName = 'Roof Section';
      else if (flagBridge) friendlyName = 'Stair / Bridge';
      else if (flagDoor) friendlyName = 'Door Component';
      else friendlyName = `Tile 0x${graphic.toString(16).toUpperCase().padStart(4, '0')}`;
    }

    return {
      id: graphic,
      hex: '0x' + graphic.toString(16).toUpperCase().padStart(4, '0'),
      name: friendlyName,
      rawName: name,
      flags: '0x' + flags.toString(16).toUpperCase(),
      flagsFlags: { flagWall, flagImpassable, flagSurface, flagBridge, flagRoof, flagDoor },
      weight,
      quality,
      height
    };
  }

  search(query, max = 50) {
    if (!this.isAvailable()) return [];
    const q = (query || '').trim().toLowerCase();
    const results = [];
    const isHex = q.startsWith('0x');
    const searchId = isHex ? parseInt(q, 16) : (q.length > 0 && !isNaN(Number(q)) ? parseInt(q, 10) : NaN);

    // If explicit ID searched
    if (!isNaN(searchId) && searchId >= 0 && searchId < 0x10000) {
      const tile = this.getStaticTile(searchId);
      if (tile && activeArtReader.getStaticArtEntry(searchId)) {
        results.push(tile);
      }
    }

    const wantFloor = q.includes('floor') || q.includes('ground') || q.includes('surface');
    const wantWall = q.includes('wall');
    const wantRoof = q.includes('roof');
    const wantDoor = q.includes('door');
    const wantStair = q.includes('stair') || q.includes('step');

    const limit = this.isHSA ? 65536 : 16384;
    for (let i = 0; i < limit && results.length < max; i++) {
      if (!isNaN(searchId) && i === searchId) continue;

      // Must have art sprite
      if (!activeArtReader.getStaticArtEntry(i)) continue;

      const tile = this.getStaticTile(i);
      if (!tile) continue;

      let matched = false;
      if (!q) {
        matched = true;
      } else if (tile.name && tile.name.toLowerCase().includes(q)) {
        matched = true;
      } else if (wantFloor && tile.flagsFlags.flagSurface) {
        matched = true;
      } else if (wantWall && tile.flagsFlags.flagWall) {
        matched = true;
      } else if (wantRoof && tile.flagsFlags.flagRoof) {
        matched = true;
      } else if (wantDoor && tile.flagsFlags.flagDoor) {
        matched = true;
      } else if (wantStair && (tile.flagsFlags.flagBridge || tile.name.toLowerCase().includes('stair'))) {
        matched = true;
      }

      if (matched) results.push(tile);
    }
    return results;
  }
}

// Server-placed doors and house signs defined in C# scripts (Houses.cs, NewHouses.cs, SmallTents.cs)
// that supplement the flags===0 entries stored in multi.mul.
const EXTRA_PLACEMENT_ITEMS = {
  0x0070: [ // Blue Tent (SmallTents.cs)
    { itemId: 0x0BD1, x: -1, y: 5, z: 9, flags: 0 }
  ],
  0x0072: [ // Green Tent (SmallTents.cs)
    { itemId: 0x0BD1, x: -1, y: 5, z: 9, flags: 0 }
  ],
  0x0094: [ // Wagon (NewHouses.cs)
    { itemId: 0x06A5, x: 0, y: 4, z: 5, flags: 0 },
    { itemId: 0x0BD2, x: 4, y: 5, z: 5, flags: 0 }
  ],
  0x004F: [ // Plaster House Picture Window (NewHouses.cs interior double doors)
    { itemId: 0x06A5, x: -2, y: -1, z: 5, flags: 0 },
    { itemId: 0x06A7, x: -1, y: -1, z: 5, flags: 0 }
  ],
  0x007C: [ // Small Stone Keep (Houses.cs interior doors)
    { itemId: 0x0675, x: 3, y: -4, z: 6, flags: 0 },
    { itemId: 0x067D, x: -5, y: 3, z: 6, flags: 0 },
    { itemId: 0x067D, x: 6, y: 3, z: 6, flags: 0 }
  ]
};

class UOMultiReader {
  constructor(dir) {
    this.dir = dir;
    this.idxPath = path.join(dir, 'multi.idx');
    this.mulPath = path.join(dir, 'multi.mul');
    this.fdIdx = null;
    this.fdMul = null;
    this.totalEntries = 0;
    this.init();
  }

  init() {
    if (this.fdIdx !== null) { try { fs.closeSync(this.fdIdx); } catch (_) {} this.fdIdx = null; }
    if (this.fdMul !== null) { try { fs.closeSync(this.fdMul); } catch (_) {} this.fdMul = null; }
    if (fs.existsSync(this.idxPath) && fs.existsSync(this.mulPath)) {
      try {
        this.fdIdx = fs.openSync(this.idxPath, 'r');
        this.fdMul = fs.openSync(this.mulPath, 'r');
        this.totalEntries = Math.floor(fs.fstatSync(this.fdIdx).size / 12);
      } catch (e) {
        console.error(`Error opening multi files in ${this.dir}:`, e.message);
      }
    }
  }

  isAvailable() {
    return this.fdIdx !== null && this.fdMul !== null;
  }

  getMulti(multiId) {
    if (!this.isAvailable() || multiId >= this.totalEntries || multiId < 0) return null;
    const buf = Buffer.alloc(12);
    fs.readSync(this.fdIdx, buf, 0, 12, multiId * 12);
    const lookup = buf.readUInt32LE(0);
    const length = buf.readUInt32LE(4);
    if (lookup === 0xFFFFFFFF || length === 0) return null;

    const raw = Buffer.alloc(length);
    fs.readSync(this.fdMul, raw, 0, length, lookup);

    const entrySize = (length % 16 === 0) ? 16 : 12;
    const count = Math.floor(length / entrySize);
    const components = [];
    const uniqueTiles = new Set();

    let minX = 9999, maxX = -9999, minY = 9999, maxY = -9999, minZ = 9999, maxZ = -9999;
    const floorZLevels = new Set();

    const addComponent = (itemId, x, y, z, flags, isServerPlaced = false) => {
      if (itemId <= 1) return; // Skip invisible nodraw markers (0x0000, 0x0001)
      components.push({
        itemId,
        x,
        y,
        z,
        flags,
        isFixture: flags === 0 || isServerPlaced
      });
      uniqueTiles.add(itemId);

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;

      floorZLevels.add(z);
    };

    for (let i = 0; i < count; i++) {
      const off = i * entrySize;
      const itemId = raw.readUInt16LE(off);
      const x = raw.readInt16LE(off + 2);
      const y = raw.readInt16LE(off + 4);
      const z = raw.readInt16LE(off + 6);
      const flags = (entrySize === 16) ? raw.readUInt32LE(off + 8) : raw.readUInt16LE(off + 8);
      addComponent(itemId, x, y, z, flags, false);
    }

    // Append server-placed doors & house signs not present in multi.mul
    const extras = EXTRA_PLACEMENT_ITEMS[multiId] || [];
    for (const ex of extras) {
      const exists = components.some(c => c.itemId === ex.itemId && c.x === ex.x && c.y === ex.y && c.z === ex.z);
      if (!exists) {
        addComponent(ex.itemId, ex.x, ex.y, ex.z, ex.flags ?? 0, true);
      }
    }

    const width = (maxX >= minX) ? (maxX - minX + 1) : 0;
    const depth = (maxY >= minY) ? (maxY - minY + 1) : 0;

    return {
      multiId,
      hex: '0x' + multiId.toString(16).toUpperCase().padStart(4, '0'),
      count: components.length,
      width,
      depth,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
      zLevels: Array.from(floorZLevels).sort((a, b) => a - b),
      uniqueTiles: Array.from(uniqueTiles),
      components
    };
  }
}

// Active readers
let activeArtReader = new UOArtReader(config.clientArtDir);
let activeTileDataReader = new UOTileDataReader(config.clientArtDir.length ? config.clientArtDir : config.serverFilesDir);
let activeMultiReader = new UOMultiReader(config.serverFilesDir);

function reloadReaders() {
  activeArtReader.close();
  activeArtReader = new UOArtReader(config.clientArtDir);

  activeTileDataReader.init();
  activeTileDataReader = new UOTileDataReader(
    (fs.existsSync(path.join(config.clientArtDir, 'tiledata.mul'))) ? config.clientArtDir : config.serverFilesDir
  );

  activeMultiReader.init();
  activeMultiReader = new UOMultiReader(config.serverFilesDir);
}

// ==========================================
// ISOMETRIC MULTI RENDERER (WITH DOORS & SIGNS)
// ==========================================
function renderMultiComponents(components, maxZ = Infinity) {
  if (!activeArtReader.isAvailable() || !components || components.length === 0) return null;

  const drawItems = [];
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    if (!c || c.itemId <= 1) continue;
    if (c.z > maxZ) continue;

    const bmp = activeArtReader.getStaticBitmap(c.itemId);
    if (!bmp) continue;

    const td = activeTileDataReader.isAvailable() ? activeTileDataReader.getStaticTile(c.itemId) : null;
    const height = td ? td.height : 0;

    const px = (c.x - c.y) * 22 - (bmp.width >> 1);
    const py = (c.x + c.y) * 22 - c.z * 4 - bmp.height;

    drawItems.push({
      x: c.x,
      y: c.y,
      z: c.z,
      height,
      idx: i,
      px,
      py,
      bmp
    });
  }

  if (drawItems.length === 0) return null;

  // Classic UO isometric painter's algorithm sort order
  drawItems.sort((a, b) =>
    ((a.x + a.y) - (b.x + b.y)) ||
    (a.z - b.z) ||
    (a.height - b.height) ||
    (a.idx - b.idx)
  );

  let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
  for (const d of drawItems) {
    if (d.px < minPx) minPx = d.px;
    if (d.py < minPy) minPy = d.py;
    if (d.px + d.bmp.width > maxPx) maxPx = d.px + d.bmp.width;
    if (d.py + d.bmp.height > maxPy) maxPy = d.py + d.bmp.height;
  }

  const pad = 12;
  const W = (maxPx - minPx) + pad * 2;
  const H = (maxPy - minPy) + pad * 2;
  if (W <= 0 || H <= 0 || W > 4096 || H > 4096) return null;

  const ox = pad - minPx;
  const oy = pad - minPy;
  const canvas = Buffer.alloc(W * H * 4, 0);

  for (const d of drawItems) {
    const { width, height, rgba } = d.bmp;
    const dx = d.px + ox;
    const dy = d.py + oy;
    for (let sy = 0; sy < height; sy++) {
      const ty = dy + sy;
      if (ty < 0 || ty >= H) continue;
      for (let sx = 0; sx < width; sx++) {
        const tx = dx + sx;
        if (tx < 0 || tx >= W) continue;
        const sp = (sy * width + sx) * 4;
        if (rgba[sp + 3] > 0) {
          const tp = (ty * W + tx) * 4;
          canvas[tp]     = rgba[sp];
          canvas[tp + 1] = rgba[sp + 1];
          canvas[tp + 2] = rgba[sp + 2];
          canvas[tp + 3] = 255;
        }
      }
    }
  }

  return createPng(W, H, canvas);
}

function regenerateAllHouseImages() {
  if (!activeArtReader.isAvailable() || !activeMultiReader.isAvailable()) {
    return { success: false, error: 'Art or Multi binary files are not available.' };
  }
  const houses = JSON.parse(fs.readFileSync(HOUSES_FILE, 'utf8'));
  const imagesDir = path.join(__dirname, 'images');
  const floorsDir = path.join(__dirname, 'images_floors');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
  if (!fs.existsSync(floorsDir)) fs.mkdirSync(floorsDir, { recursive: true });

  let fullCount = 0;
  let floorCount = 0;

  for (const h of houses) {
    if (h.multi === undefined || h.multi === null) continue;
    const multiData = activeMultiReader.getMulti(h.multi);
    if (!multiData || !multiData.components || multiData.components.length === 0) continue;

    // 1. Full house image (including doors & house sign)
    if (h.file) {
      const fullPng = renderMultiComponents(multiData.components, Infinity);
      if (fullPng) {
        fs.writeFileSync(path.join(imagesDir, h.file), fullPng);
        fullCount++;
      }
    }

    // 2. Floor cutaways (including doors & house sign up to floor.z + 15)
    if (Array.isArray(h.floors)) {
      const prefix = h.multi.toString(16).toUpperCase().padStart(4, '0');
      h.floors.forEach((fl, idx) => {
        const floorFile = fl.file || `${prefix}_f${idx + 1}.png`;
        const floorPng = renderMultiComponents(multiData.components, (fl.z ?? 0) + 15);
        if (floorPng) {
          fs.writeFileSync(path.join(floorsDir, floorFile), floorPng);
          floorCount++;
        }
      });
    }
  }

  return { success: true, fullCount, floorCount };
}

// ==========================================
// HOUSES & COMPATIBILITY ENGINE
// ==========================================

function getHousesList() {
  let houses = [];
  try {
    if (fs.existsSync(HOUSES_FILE)) {
      houses = JSON.parse(fs.readFileSync(HOUSES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading houses.json:', e.message);
  }

  let library = [];
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
    }
  } catch (e) {}

  // Augment houses with live compatibility and library status
  return houses.map(h => {
    const multiData = activeMultiReader.getMulti(h.multi);
    let isCompatible = true;
    let missingTiles = [];

    if (multiData && activeArtReader.isAvailable()) {
      for (const tileId of multiData.uniqueTiles) {
        const entry = activeArtReader.getStaticArtEntry(tileId);
        if (!entry) {
          isCompatible = false;
          missingTiles.push(tileId);
        }
      }
    }

    const inLibrary = library.some(lh =>
      (h.libraryId && h.libraryId === lh.id) ||
      (h.id && h.id === lh.id) ||
      (lh.multi !== undefined && lh.multi === h.multi) ||
      (h.name && lh.name && h.name.trim().toLowerCase() === lh.name.trim().toLowerCase())
    );

    return {
      ...h,
      inLibrary,
      isCompatible,
      missingTileCount: missingTiles.length,
      missingTiles
    };
  });
}

function getLibraryList() {
  let library = [];
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading library.json:', e.message);
  }

  let serverHouses = [];
  try {
    if (fs.existsSync(HOUSES_FILE)) {
      serverHouses = JSON.parse(fs.readFileSync(HOUSES_FILE, 'utf8'));
    }
  } catch (e) {}

  // Evaluate compatibility against active art and check if installed on server
  return library.map(item => {
    const matchingServer = serverHouses.find(sh =>
      (sh.libraryId && sh.libraryId === item.id) ||
      (sh.id && sh.id === item.id) ||
      (item.multi !== undefined && sh.multi === item.multi) ||
      (sh.name && item.name && sh.name.trim().toLowerCase() === item.name.trim().toLowerCase())
    );

    const isInstalled = !!matchingServer;
    const installedMulti = matchingServer ? matchingServer.multi : (item.multi || null);

    let missingTiles = [];
    if (item.components && activeArtReader.isAvailable()) {
      const tileCounts = {};
      item.components.forEach(c => {
        tileCounts[c.itemId] = (tileCounts[c.itemId] || 0) + 1;
      });

      for (const [idStr, count] of Object.entries(tileCounts)) {
        const tileId = parseInt(idStr, 10);
        const entry = activeArtReader.getStaticArtEntry(tileId);
        if (!entry) {
          const comp = item.components.find(c => c.itemId === tileId);
          missingTiles.push({
            itemId: tileId,
            hex: '0x' + tileId.toString(16).toUpperCase().padStart(4, '0'),
            count,
            expectedName: (comp && comp.expectedName) ? comp.expectedName : `Custom Tile 0x${tileId.toString(16).toUpperCase()}`
          });
        }
      }
    }

    return {
      ...item,
      isInstalled,
      installedMulti,
      isCompatible: missingTiles.length === 0,
      missingTileCount: missingTiles.length,
      missingTiles
    };
  });
}

// ==========================================
// SERVER C# SCRIPT SYNCHRONIZER
// ==========================================
function updateServerHouseScripts(updatedHouse) {
  const containerScript = path.join(config.serverScriptsDir, 'HousePlacementContainer.cs');
  if (!fs.existsSync(containerScript)) {
    return { success: false, message: `Server script not found at ${containerScript}` };
  }

  try {
    const rawContent = fs.readFileSync(containerScript, 'utf8');

    // Create timestamped backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${containerScript}.bak.${timestamp}`;
    fs.writeFileSync(backupPath, rawContent, 'utf8');

    // Target the specific house by multiID hex or dec
    const hex = '0x' + updatedHouse.multi.toString(16).toUpperCase();
    const hexRegex = new RegExp(
      `(new\\s+HousePlacementEntry\\s*\\([^,]+,\\s*[^,]+,\\s*)(\\d+)(\\s*,\\s*)(\\d+)(\\s*,\\s*)(\\d+)(\\s*,\\s*)(\\d+)(\\s*,\\s*)(\\d+)(\\s*,\\s*)([^,]+)(\\s*,\\s*[-\\d]+\\s*,\\s*[-\\d]+\\s*,\\s*[-\\d]+\\s*,\\s*(?:${hex}|${updatedHouse.multi})\\s*\\))`,
      'i'
    );

    let replaced = false;
    const newContent = rawContent.replace(hexRegex, (match, prefix, st1, c1, lk1, c2, st2, c3, lk2, c4, vend, c5, costExpr, suffix) => {
      replaced = true;
      return `${prefix}${updatedHouse.storage}${c1}${updatedHouse.lockdowns}${c2}${updatedHouse.storage}${c3}${updatedHouse.lockdowns}${c4}${updatedHouse.vendors}${c5}${updatedHouse.cost}${suffix}`;
    });

    if (replaced) {
      fs.writeFileSync(containerScript, newContent, 'utf8');
      return { success: true, backupPath, message: 'Server script updated successfully!' };
    } else {
      return {
        success: false,
        backupPath,
        message: `Could not locate HousePlacementEntry for Multi ${hex} in HousePlacementContainer.cs. You can still export modular scripts.`
      };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function removeServerHouseScript(removedHouse) {
  const containerScript = path.join(config.serverScriptsDir, 'HousePlacementContainer.cs');
  if (!fs.existsSync(containerScript)) {
    return { success: false, message: `Server script not found at ${containerScript}` };
  }

  try {
    const rawContent = fs.readFileSync(containerScript, 'utf8');
    const hex = '0x' + removedHouse.multi.toString(16).toUpperCase();
    const hexRegex = new RegExp(
      `^[ \\t]*(?:new\\s+HousePlacementEntry\\s*\\([^;]+?(?:${hex}|${removedHouse.multi})\\s*\\)\\s*,?)`,
      'mi'
    );

    if (hexRegex.test(rawContent)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${containerScript}.bak.${timestamp}`;
      fs.writeFileSync(backupPath, rawContent, 'utf8');

      const newContent = rawContent.replace(hexRegex, match => `\t// [REMOVED VIA APP] ${match.trim()}`);
      fs.writeFileSync(containerScript, newContent, 'utf8');
      return { success: true, backupPath, message: `House commented out in HousePlacementContainer.cs (backup saved).` };
    }
    return { success: false, message: `HousePlacementEntry for Multi ${hex} not found in HousePlacementContainer.cs.` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ==========================================
// DIRECTORY COMPARISON CACHE & ENGINE
// ==========================================
let comparisonState = {
  active: false,
  dirA: '',
  dirB: '',
  stats: { total: 0, identical: 0, graphicMismatch: 0, tiledataMismatch: 0, missingA: 0, missingB: 0 },
  results: [], // Array of diff items
  lastRun: null
};

function runDirectoryComparison(dirA, dirB) {
  const artA = new UOArtReader(dirA);
  const artB = new UOArtReader(dirB);
  const tdA = new UOTileDataReader(dirA);
  const tdB = new UOTileDataReader(dirB);

  const results = [];
  let identical = 0, graphicMismatch = 0, tiledataMismatch = 0, missingA = 0, missingB = 0;

  // Compare 0 to 65535 statics
  for (let id = 0; id < 65536; id++) {
    const entryA = artA.getStaticArtEntry(id);
    const entryB = artB.getStaticArtEntry(id);

    if (!entryA && !entryB) continue; // Neither has this tile

    const hex = '0x' + id.toString(16).toUpperCase().padStart(4, '0');
    const tiledataA = tdA.getStaticTile(id);
    const tiledataB = tdB.getStaticTile(id);

    if (entryA && !entryB) {
      missingB++;
      results.push({
        id, hex, status: 'missing_in_b',
        nameA: tiledataA ? (tiledataA.rawName || tiledataA.name) : '', nameB: '',
        heightA: tiledataA ? tiledataA.height : 0, heightB: 0,
        flagsA: tiledataA ? tiledataA.flags : '', flagsB: '',
        slotFreeInB: true
      });
      continue;
    }

    if (!entryA && entryB) {
      missingA++;
      results.push({
        id, hex, status: 'missing_in_a',
        nameA: '', nameB: tiledataB ? (tiledataB.rawName || tiledataB.name) : '',
        heightA: 0, heightB: tiledataB ? tiledataB.height : 0,
        flagsA: '', flagsB: tiledataB ? tiledataB.flags : '',
        slotFreeInA: true
      });
      continue;
    }

    // Both exist - compare graphics & tiledata
    const hashA = artA.getTileHash(id);
    const hashB = artB.getTileHash(id);
    let graphicsMatch = (hashA && hashB && hashA.md5 === hashB.md5);
    if (!graphicsMatch && hashA && hashB) {
      const pxA = artA.getTilePixelHash(id);
      const pxB = artB.getTilePixelHash(id);
      if (pxA && pxB && pxA === pxB) {
        graphicsMatch = true;
      }
    }

    const nameA = tiledataA ? tiledataA.rawName : '';
    const nameB = tiledataB ? tiledataB.rawName : '';
    const flagsA = tiledataA ? tiledataA.flags : '';
    const flagsB = tiledataB ? tiledataB.flags : '';
    const heightA = tiledataA ? tiledataA.height : 0;
    const heightB = tiledataB ? tiledataB.height : 0;

    let flagsMatch = (flagsA === flagsB);
    if (!flagsMatch && tiledataA && tiledataB) {
      const fNumA = BigInt(tiledataA.flags) & 0xFFFFFFFFn;
      const fNumB = BigInt(tiledataB.flags) & 0xFFFFFFFFn;
      flagsMatch = (fNumA === fNumB);
    }

    const tiledataMatch = (nameA.toLowerCase() === nameB.toLowerCase() && flagsMatch && heightA === heightB);

    if (graphicsMatch && tiledataMatch) {
      identical++;
    } else if (!graphicsMatch) {
      graphicMismatch++;
      results.push({
        id, hex, status: 'graphic_mismatch',
        nameA: tiledataA ? (tiledataA.rawName || tiledataA.name) : '',
        nameB: tiledataB ? (tiledataB.rawName || tiledataB.name) : '',
        heightA, heightB, flagsA, flagsB,
        sizeA: hashA ? hashA.length : 0, sizeB: hashB ? hashB.length : 0
      });
    } else {
      tiledataMismatch++;
      results.push({
        id, hex, status: 'tiledata_mismatch',
        nameA: tiledataA ? (tiledataA.rawName || tiledataA.name) : '',
        nameB: tiledataB ? (tiledataB.rawName || tiledataB.name) : '',
        heightA, heightB, flagsA, flagsB,
        sizeA: hashA ? hashA.length : 0, sizeB: hashB ? hashB.length : 0
      });
    }
  }

  artA.close();
  artB.close();
  if (tdA.fd) fs.closeSync(tdA.fd);
  if (tdB.fd) fs.closeSync(tdB.fd);

  comparisonState = {
    active: true,
    dirA,
    dirB,
    stats: {
      total: identical + graphicMismatch + tiledataMismatch + missingA + missingB,
      identical,
      graphicMismatch,
      tiledataMismatch,
      missingA,
      missingB
    },
    results,
    lastRun: new Date().toISOString()
  };

  return comparisonState;
}

function copyTileBetweenDirectories(srcDir, destDir, tileId) {
  if (tileId < 0 || tileId >= 65536) {
    return { success: false, error: `Invalid tile ID: ${tileId}` };
  }

  const srcArt = new UOArtReader(srcDir);
  const srcTd = new UOTileDataReader(srcDir);
  const rawArt = srcArt.getTileRaw(tileId);
  if (!rawArt || rawArt.length === 0) {
    srcArt.close();
    if (srcTd.fd) fs.closeSync(srcTd.fd);
    return { success: false, error: `Source directory does not contain art for tile 0x${tileId.toString(16).toUpperCase()}` };
  }

  // Check target vacant slot
  const destArt = new UOArtReader(destDir);
  const destEntry = destArt.getStaticArtEntry(tileId);
  if (destEntry && destEntry.length > 0 && destEntry.lookup !== 0xFFFFFFFF) {
    srcArt.close();
    destArt.close();
    if (srcTd.fd) fs.closeSync(srcTd.fd);
    return { success: false, error: `Target slot 0x${tileId.toString(16).toUpperCase()} is already occupied!` };
  }
  destArt.close();

  const artMulPath = path.join(destDir, 'art.mul');
  const artIdxPath = path.join(destDir, 'artidx.mul');
  const tiledataPath = path.join(destDir, 'tiledata.mul');

  if (!fs.existsSync(artMulPath) || !fs.existsSync(artIdxPath)) {
    srcArt.close();
    if (srcTd.fd) fs.closeSync(srcTd.fd);
    return { success: false, error: `Target directory is missing art.mul or artidx.mul` };
  }

  // Backups
  try {
    if (!fs.existsSync(artMulPath + '.bak')) fs.copyFileSync(artMulPath, artMulPath + '.bak');
    if (!fs.existsSync(artIdxPath + '.bak')) fs.copyFileSync(artIdxPath, artIdxPath + '.bak');
    if (fs.existsSync(tiledataPath) && !fs.existsSync(tiledataPath + '.bak')) {
      fs.copyFileSync(tiledataPath, tiledataPath + '.bak');
    }
  } catch (bErr) {
    console.warn('Backup warning:', bErr.message);
  }

  // 1. Append art to art.mul
  const artMulStat = fs.statSync(artMulPath);
  const newLookup = artMulStat.size;
  fs.appendFileSync(artMulPath, rawArt);

  // 2. Update artidx.mul
  const idxOffset = (0x4000 + tileId) * 12;
  const idxFd = fs.openSync(artIdxPath, 'r+');
  const idxStat = fs.fstatSync(idxFd);

  if (idxStat.size < idxOffset + 12) {
    const padSize = (idxOffset + 12) - idxStat.size;
    const padBuf = Buffer.alloc(padSize);
    for (let p = 0; p < padSize; p += 12) {
      padBuf.writeUInt32LE(0xFFFFFFFF, p);
      padBuf.writeUInt32LE(0x00000000, p + 4);
      padBuf.writeUInt32LE(0x00000000, p + 8);
    }
    fs.writeSync(idxFd, padBuf, 0, padSize, idxStat.size);
  }

  const idxBuf = Buffer.alloc(12);
  idxBuf.writeUInt32LE(newLookup, 0);
  idxBuf.writeUInt32LE(rawArt.length, 4);
  idxBuf.writeUInt32LE(0, 8);
  fs.writeSync(idxFd, idxBuf, 0, 12, idxOffset);
  fs.closeSync(idxFd);

  // 3. Update tiledata.mul if it exists
  let tileName = `Tile 0x${tileId.toString(16).toUpperCase().padStart(4, '0')}`;
  if (fs.existsSync(tiledataPath)) {
    const destTd = new UOTileDataReader(destDir);
    const srcIsHsa = srcTd.isHSA;
    const destIsHsa = destTd.isHSA;

    const srcLandSize = srcIsHsa ? 512 * (4 + 32 * 30) : 512 * (4 + 32 * 26);
    const srcRecSize = srcIsHsa ? 41 : 37;
    const srcGrpSize = 4 + 32 * srcRecSize;
    const srcGrp = Math.floor(tileId / 32);
    const srcIdxInGrp = tileId % 32;
    const srcOffset = srcLandSize + srcGrp * srcGrpSize + 4 + srcIdxInGrp * srcRecSize;

    let srcRec = null;
    if (srcTd.fd && srcOffset + srcRecSize <= srcTd.fileSize) {
      srcRec = Buffer.alloc(srcRecSize);
      fs.readSync(srcTd.fd, srcRec, 0, srcRecSize, srcOffset);
    }

    const destLandSize = destIsHsa ? 512 * (4 + 32 * 30) : 512 * (4 + 32 * 26);
    const destRecSize = destIsHsa ? 41 : 37;
    const destGrpSize = 4 + 32 * destRecSize;
    const destGrp = Math.floor(tileId / 32);
    const destIdxInGrp = tileId % 32;
    const destOffset = destLandSize + destGrp * destGrpSize + 4 + destIdxInGrp * destRecSize;

    const destBuf = Buffer.alloc(destRecSize, 0);
    if (srcRec) {
      if (srcIsHsa === destIsHsa) {
        srcRec.copy(destBuf);
      } else if (!srcIsHsa && destIsHsa) {
        const flags = srcRec.readUInt32LE(0);
        destBuf.writeBigUInt64LE(BigInt(flags), 0);
        srcRec.copy(destBuf, 8, 4, 37);
      } else if (srcIsHsa && !destIsHsa) {
        const flags = Number(srcRec.readBigUInt64LE(0) & 0xFFFFFFFFn);
        destBuf.writeUInt32LE(flags, 0);
        srcRec.copy(destBuf, 4, 8, 41);
      }
      const rawNameStr = (destIsHsa ? destBuf.subarray(21, 41) : destBuf.subarray(17, 37)).toString('latin1').replace(/\0.*$/g, '').trim();
      if (rawNameStr) tileName = rawNameStr;
    } else {
      const nameBuf = Buffer.from(tileName.substring(0, 20), 'latin1');
      if (destIsHsa) nameBuf.copy(destBuf, 21);
      else nameBuf.copy(destBuf, 17);
    }

    const tdFd = fs.openSync(tiledataPath, 'r+');
    const tdStat = fs.fstatSync(tdFd);

    if (tdStat.size < destOffset + destRecSize) {
      const requiredGroups = destGrp + 1;
      const targetSize = destLandSize + requiredGroups * destGrpSize;
      if (targetSize > tdStat.size) {
        const expandSize = targetSize - tdStat.size;
        const expandBuf = Buffer.alloc(expandSize, 0);
        fs.writeSync(tdFd, expandBuf, 0, expandSize, tdStat.size);
      }
    }

    fs.writeSync(tdFd, destBuf, 0, destRecSize, destOffset);
    fs.closeSync(tdFd);
    if (destTd.fd) fs.closeSync(destTd.fd);
  }

  srcArt.close();
  if (srcTd.fd) fs.closeSync(srcTd.fd);

  // Reload active readers if destination is one of our active paths
  if (destDir === config.clientArtDir || destDir === config.serverFilesDir) {
    reloadReaders();
  }

  return {
    success: true,
    tileId,
    hex: '0x' + tileId.toString(16).toUpperCase().padStart(4, '0'),
    name: tileName,
    newLookup,
    length: rawArt.length
  };
}

// ==========================================
// HTTP SERVER & ROUTING
// ==========================================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) req.destroy(); // 20MB limit
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ----------------------------------------------------
    // API: CONFIG & STATUS
    // ----------------------------------------------------
    if (pathname === '/api/config' && req.method === 'GET') {
      const serverFilesStatus = {
        dirExists: fs.existsSync(config.serverFilesDir),
        multiIdx: fs.existsSync(path.join(config.serverFilesDir, 'multi.idx')),
        multiMul: fs.existsSync(path.join(config.serverFilesDir, 'multi.mul')),
        tiledataMul: fs.existsSync(path.join(config.serverFilesDir, 'tiledata.mul')),
        clilocEnu: fs.existsSync(path.join(config.serverFilesDir, 'Cliloc.enu'))
      };

      const clientArtStatus = {
        dirExists: fs.existsSync(config.clientArtDir),
        artIdx: fs.existsSync(path.join(config.clientArtDir, 'artidx.mul')),
        artMul: fs.existsSync(path.join(config.clientArtDir, 'art.mul')),
        tiledataMul: fs.existsSync(path.join(config.clientArtDir, 'tiledata.mul'))
      };

      const serverScriptsStatus = {
        dirExists: fs.existsSync(config.serverScriptsDir),
        housePlacementContainer: fs.existsSync(path.join(config.serverScriptsDir, 'HousePlacementContainer.cs')),
        housesCs: fs.existsSync(path.join(config.serverScriptsDir, 'Houses.cs')),
        newHousesCs: fs.existsSync(path.join(config.serverScriptsDir, 'NewHouses.cs'))
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        config,
        status: {
          serverFilesStatus,
          clientArtStatus,
          serverScriptsStatus,
          artAvailable: activeArtReader.isAvailable(),
          multiAvailable: activeMultiReader.isAvailable(),
          tiledataAvailable: activeTileDataReader.isAvailable()
        }
      }));
      return;
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const data = await parseBody(req);
      if (data.serverFilesDir) config.serverFilesDir = data.serverFilesDir;
      if (data.clientArtDir) config.clientArtDir = data.clientArtDir;
      if (data.serverScriptsDir) config.serverScriptsDir = data.serverScriptsDir;
      if (data.theme) config.theme = data.theme;
      saveConfig();
      reloadReaders();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, config }));
      return;
    }

    // ----------------------------------------------------
    // API: HOUSES (SERVER HOUSING MENU)
    // ----------------------------------------------------
    if (pathname === '/api/houses' && req.method === 'GET') {
      const houses = getHousesList();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(houses));
      return;
    }

    if (pathname.startsWith('/api/houses/') && req.method === 'GET') {
      const idOrMulti = pathname.replace('/api/houses/', '');
      const houses = getHousesList();
      const house = houses.find(h => h.multi == idOrMulti || h.name.toLowerCase() === decodeURIComponent(idOrMulti).toLowerCase());
      if (!house) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'House not found' }));
        return;
      }

      // Add full multi component breakdown
      const multiData = activeMultiReader.getMulti(house.multi);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...house, multiData }));
      return;
    }

    if (pathname.startsWith('/api/houses/') && req.method === 'PUT') {
      const idOrMulti = pathname.replace('/api/houses/', '');
      const data = await parseBody(req);
      const houses = JSON.parse(fs.readFileSync(HOUSES_FILE, 'utf8'));
      const idx = houses.findIndex(h => h.multi == idOrMulti || h.name.toLowerCase() === decodeURIComponent(idOrMulti).toLowerCase());

      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'House not found' }));
        return;
      }

      // Update fields
      if (data.cost !== undefined) houses[idx].cost = Number(data.cost);
      if (data.storage !== undefined) houses[idx].storage = Number(data.storage);
      if (data.lockdowns !== undefined) houses[idx].lockdowns = Number(data.lockdowns);
      if (data.vendors !== undefined) houses[idx].vendors = Number(data.vendors);
      if (data.name !== undefined) houses[idx].name = String(data.name);

      fs.writeFileSync(HOUSES_FILE, JSON.stringify(houses, null, 2), 'utf8');

      // Optionally update server script immediately if requested
      let scriptUpdateResult = null;
      if (data.saveToServerScript) {
        scriptUpdateResult = updateServerHouseScripts(houses[idx]);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, house: houses[idx], scriptUpdateResult }));
      return;
    }

    if (pathname.startsWith('/api/houses/') && req.method === 'DELETE') {
      const idOrMulti = pathname.replace('/api/houses/', '');
      const houses = JSON.parse(fs.readFileSync(HOUSES_FILE, 'utf8'));
      const idx = houses.findIndex(h => h.multi == idOrMulti || h.name.toLowerCase() === decodeURIComponent(idOrMulti).toLowerCase());

      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'House not found on server' }));
        return;
      }

      const removed = houses.splice(idx, 1)[0];
      fs.writeFileSync(HOUSES_FILE, JSON.stringify(houses, null, 2), 'utf8');

      const scriptResult = removeServerHouseScript(removed);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, removedHouse: removed, scriptResult }));
      return;
    }

    if (pathname === '/api/houses/save-to-server' && req.method === 'POST') {
      const data = await parseBody(req);
      const houses = JSON.parse(fs.readFileSync(HOUSES_FILE, 'utf8'));
      const house = houses.find(h => h.multi == data.multi);
      if (!house) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'House not found' }));
        return;
      }

      const result = updateServerHouseScripts(house);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/houses/regenerate-images' && req.method === 'POST') {
      const result = regenerateAllHouseImages();
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // ----------------------------------------------------
    // API: HOUSE DESIGN LIBRARY (ONLINE / COMMUNITY REPO)
    // ----------------------------------------------------
    if (pathname === '/api/library' && req.method === 'GET') {
      const library = getLibraryList();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(library));
      return;
    }

    if (pathname === '/api/library/add' && req.method === 'POST') {
      const data = await parseBody(req);
      let library = [];
      try {
        if (fs.existsSync(LIBRARY_FILE)) {
          library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
        }
      } catch (e) {}

      // Check if house with same name or multi already exists in library
      const exists = library.find(lh =>
        (data.multi !== undefined && lh.multi === data.multi) ||
        (lh.name && data.name && lh.name.trim().toLowerCase() === data.name.trim().toLowerCase())
      );
      if (exists) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `"${data.name}" already exists in the House Design Library!` }));
        return;
      }

      // Generate a clean slug id
      const baseId = (data.name || 'house').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const id = `${baseId}_${data.multi !== undefined ? data.multi.toString(16) : Date.now().toString(16)}`;

      // Extract components if multi reader available
      let components = [];
      if (data.multi !== undefined && activeMultiReader.isAvailable()) {
        const multiData = activeMultiReader.getMulti(data.multi);
        if (multiData && multiData.components) {
          components = multiData.components.map(c => ({
            itemId: c.itemId,
            x: c.x,
            y: c.y,
            z: c.z,
            flags: c.flags ?? 1,
            expectedName: activeTileDataReader.isAvailable() ? (activeTileDataReader.getStaticTile(c.itemId)?.name || 'Tile') : 'Tile'
          }));
        }
      }

      const newLibHouse = {
        id,
        name: data.name,
        category: data.category || 'Classic Housing',
        author: data.author || 'Server Administrator',
        description: data.description || `Original server housing multi 0x${(data.multi || 0).toString(16).toUpperCase()} (${data.name}) shared to community library.`,
        cost: Number(data.cost || 50000),
        storage: Number(data.storage || 500),
        lockdowns: Number(data.lockdowns || 250),
        vendors: Number(data.vendors || 2),
        w: data.w || 12,
        d: data.d || 12,
        tiles: data.tiles || (components.length || 200),
        file: data.file || '',
        floors: data.floors || [{ z: 0, file: '' }],
        components,
        multi: data.multi
      };

      library.push(newLibHouse);
      fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2), 'utf8');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, house: newLibHouse }));
      return;
    }

    if (pathname === '/api/library/import' && req.method === 'POST') {
      const data = await parseBody(req);
      const library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
      const libHouse = library.find(h => h.id === data.id);
      if (!libHouse) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Library house not found' }));
        return;
      }

      // Assign a multi ID if needed or find next available custom multi
      const houses = JSON.parse(fs.readFileSync(HOUSES_FILE, 'utf8'));
      const newMulti = data.multi || (Math.max(...houses.map(h => h.multi), 0x9F) + 1);

      const importedHouse = {
        name: data.name || libHouse.name,
        multi: newMulti,
        cost: Number(data.cost || libHouse.cost),
        storage: Number(data.storage || libHouse.storage),
        lockdowns: Number(data.lockdowns || libHouse.lockdowns),
        vendors: Number(data.vendors || libHouse.vendors),
        file: libHouse.file || '008E_Old_Stone_Home_And_Shoppe.png',
        w: libHouse.w || 14,
        d: libHouse.d || 14,
        floors: libHouse.floors || [{ z: 0, file: '' }],
        tiles: libHouse.tiles || 500,
        libraryId: libHouse.id,
        isCustom: true
      };

      houses.push(importedHouse);
      fs.writeFileSync(HOUSES_FILE, JSON.stringify(houses, null, 2), 'utf8');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, house: importedHouse }));
      return;
    }

    if (pathname === '/api/library/resolve-and-import' && req.method === 'POST') {
      const data = await parseBody(req);
      const library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
      const libIndex = library.findIndex(h => h.id === data.id);
      if (libIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Library house not found' }));
        return;
      }

      const libHouse = library[libIndex];
      const mappings = data.mappings || {}; // { [missingTileId]: replacementTileId }

      // Remap components and persist to library.json
      if (libHouse.components) {
        libHouse.components = libHouse.components.map(comp => {
          if (mappings[comp.itemId]) {
            const newId = Number(mappings[comp.itemId]);
            const td = activeTileDataReader.isAvailable() ? activeTileDataReader.getStaticTile(newId) : null;
            return {
              ...comp,
              itemId: newId,
              expectedName: td ? td.name : comp.expectedName
            };
          }
          return comp;
        });
        fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2), 'utf8');
      }

      // Add to houses.json
      const houses = JSON.parse(fs.readFileSync(HOUSES_FILE, 'utf8'));
      const newMulti = data.multi || (Math.max(...houses.map(h => h.multi), 0x9F) + 1);

      const importedHouse = {
        name: data.name || libHouse.name,
        multi: newMulti,
        cost: Number(data.cost || libHouse.cost),
        storage: Number(data.storage || libHouse.storage),
        lockdowns: Number(data.lockdowns || libHouse.lockdowns),
        vendors: Number(data.vendors || libHouse.vendors),
        file: libHouse.file || '008E_Old_Stone_Home_And_Shoppe.png',
        w: libHouse.w || 14,
        d: libHouse.d || 14,
        floors: libHouse.floors || [{ z: 0, file: '' }],
        tiles: libHouse.tiles || 500,
        libraryId: libHouse.id,
        isCustom: true
      };

      houses.push(importedHouse);
      fs.writeFileSync(HOUSES_FILE, JSON.stringify(houses, null, 2), 'utf8');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, house: importedHouse }));
      return;
    }

    if (pathname.startsWith('/api/library/') && req.method === 'GET') {
      const libId = decodeURIComponent(pathname.replace('/api/library/', ''));
      const library = getLibraryList();
      const libHouse = library.find(h => h.id === libId);
      if (!libHouse) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Library entry not found' }));
        return;
      }

      let multiData = null;
      if (libHouse.multi !== undefined && libHouse.multi !== null && activeMultiReader.isAvailable()) {
        multiData = activeMultiReader.getMulti(libHouse.multi);
      }
      if (!multiData && Array.isArray(libHouse.components) && libHouse.components.length > 0) {
        const uniqueTiles = Array.from(new Set(libHouse.components.map(c => c.itemId)));
        multiData = {
          multiId: libHouse.multi || 0,
          count: libHouse.components.length,
          uniqueTiles,
          components: libHouse.components
        };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...libHouse, multiData }));
      return;
    }

    if (pathname.startsWith('/api/library/') && req.method === 'PUT') {
      const libId = decodeURIComponent(pathname.replace('/api/library/', ''));
      const data = await parseBody(req);
      let library = [];
      try {
        if (fs.existsSync(LIBRARY_FILE)) {
          library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
        }
      } catch (e) {}

      const idx = library.findIndex(h => h.id === libId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Library entry not found' }));
        return;
      }

      if (data.name !== undefined && String(data.name).trim()) library[idx].name = String(data.name).trim();
      if (data.category !== undefined) library[idx].category = String(data.category).trim() || 'Classic Housing';
      if (data.author !== undefined) library[idx].author = String(data.author).trim() || 'Unknown';
      if (data.description !== undefined) library[idx].description = String(data.description).trim();
      if (data.cost !== undefined) library[idx].cost = Number(data.cost);
      if (data.storage !== undefined) library[idx].storage = Number(data.storage);
      if (data.lockdowns !== undefined) library[idx].lockdowns = Number(data.lockdowns);
      if (data.vendors !== undefined) library[idx].vendors = Number(data.vendors);
      if (data.w !== undefined && Number(data.w) > 0) library[idx].w = Number(data.w);
      if (data.d !== undefined && Number(data.d) > 0) library[idx].d = Number(data.d);

      fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2), 'utf8');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, house: library[idx] }));
      return;
    }

    if (pathname.startsWith('/api/library/') && req.method === 'DELETE') {
      const libId = decodeURIComponent(pathname.replace('/api/library/', ''));
      let library = [];
      try {
        if (fs.existsSync(LIBRARY_FILE)) {
          library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
        }
      } catch (e) {}

      const idx = library.findIndex(h => h.id === libId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Library entry not found' }));
        return;
      }

      const removed = library.splice(idx, 1)[0];
      fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2), 'utf8');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, removedHouse: removed }));
      return;
    }

    // ----------------------------------------------------
    // API: LIVE MULTI & LIBRARY ISOMETRIC RENDERING
    // ----------------------------------------------------
    if (pathname.startsWith('/api/render/multi/') && req.method === 'GET') {
      const multiIdStr = pathname.replace('/api/render/multi/', '');
      const multiId = multiIdStr.startsWith('0x') ? parseInt(multiIdStr, 16) : parseInt(multiIdStr, 10);
      const maxZ = parsedUrl.query.maxZ !== undefined ? Number(parsedUrl.query.maxZ) : Infinity;

      const multiData = activeMultiReader.getMulti(multiId);
      const png = multiData ? renderMultiComponents(multiData.components, maxZ) : null;

      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(png || TRANSPARENT_PNG);
      return;
    }

    if (pathname.startsWith('/api/render/library/') && req.method === 'GET') {
      const libId = decodeURIComponent(pathname.replace('/api/render/library/', ''));
      const maxZ = parsedUrl.query.maxZ !== undefined ? Number(parsedUrl.query.maxZ) : Infinity;
      const library = getLibraryList();
      const libHouse = library.find(h => h.id === libId);

      let components = libHouse?.components || [];
      if (libHouse?.multi !== undefined && activeMultiReader.isAvailable()) {
        const md = activeMultiReader.getMulti(libHouse.multi);
        if (md && md.components && md.components.length > components.length) {
          components = md.components;
        }
      }

      const png = components.length > 0 ? renderMultiComponents(components, maxZ) : null;
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache'
      });
      res.end(png || TRANSPARENT_PNG);
      return;
    }

    // ----------------------------------------------------
    // API: TILE & ART RENDERING
    // ----------------------------------------------------
    if (pathname.startsWith('/api/art/tile/')) {
      const tileIdStr = pathname.replace('/api/art/tile/', '');
      const tileId = parseInt(tileIdStr, 10);
      const customDir = parsedUrl.query.dir;

      let reader = activeArtReader;
      if (customDir === 'compare' && comparisonState.dirB) {
        reader = new UOArtReader(comparisonState.dirB);
      } else if (customDir && fs.existsSync(customDir)) {
        reader = new UOArtReader(customDir);
      }

      const png = reader.getStaticPng(tileId);
      if (customDir && customDir !== 'base' && reader !== activeArtReader) reader.close();

      if (png) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400'
        });
        res.end(png);
      } else {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600'
        });
        res.end(TRANSPARENT_PNG);
      }
      return;
    }

    if (pathname.startsWith('/api/tiledata/tile/')) {
      const tileId = parseInt(pathname.replace('/api/tiledata/tile/', ''), 10);
      const tile = activeTileDataReader.getStaticTile(tileId);
      if (tile) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tile));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tile not found' }));
      }
      return;
    }

    if (pathname === '/api/tiledata/search' && req.method === 'GET') {
      const q = parsedUrl.query.q || '';
      const results = activeTileDataReader.search(q, 50);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
      return;
    }

    // ----------------------------------------------------
    // API: DIRECTORY COMPARISON
    // ----------------------------------------------------
    if (pathname === '/api/compare/scan' && req.method === 'POST') {
      const data = await parseBody(req);
      const dirA = data.dirA || config.clientArtDir;
      const dirB = data.dirB;

      if (!dirB || !fs.existsSync(dirB)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Directory B is invalid or does not exist.' }));
        return;
      }

      const compResult = runDirectoryComparison(dirA, dirB);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        stats: compResult.stats,
        lastRun: compResult.lastRun,
        totalDiffs: compResult.results.length
      }));
      return;
    }

    if (pathname === '/api/compare/tiles' && req.method === 'GET') {
      if (!comparisonState.active) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ active: false, stats: null, results: [] }));
        return;
      }

      const filter = parsedUrl.query.filter || 'all';
      const search = (parsedUrl.query.q || '').toLowerCase();
      const page = parseInt(parsedUrl.query.page || '1', 10);
      const pageSize = parseInt(parsedUrl.query.pageSize || '50', 10);

      let filtered = comparisonState.results;
      if (filter !== 'all') {
        filtered = filtered.filter(item => item.status === filter);
      }

      if (search) {
        filtered = filtered.filter(item =>
          item.hex.toLowerCase().includes(search) ||
          String(item.id).includes(search) ||
          (item.nameA && item.nameA.toLowerCase().includes(search)) ||
          (item.nameB && item.nameB.toLowerCase().includes(search))
        );
      }

      const totalMatches = filtered.length;
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        active: true,
        stats: comparisonState.stats,
        totalMatches,
        page,
        pageSize,
        totalPages: Math.ceil(totalMatches / pageSize),
        results: paged
      }));
      return;
    }

    if (pathname === '/api/compare/copy-tile' && req.method === 'POST') {
      const data = await parseBody(req);
      const tileId = parseInt(data.tileId, 10);
      const direction = data.direction; // 'add_to_a' or 'add_to_b'

      if (isNaN(tileId) || !direction) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing tileId or direction' }));
        return;
      }

      if (!comparisonState.active || !comparisonState.dirA || !comparisonState.dirB) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active comparison session' }));
        return;
      }

      const srcDir = (direction === 'add_to_a') ? comparisonState.dirB : comparisonState.dirA;
      const destDir = (direction === 'add_to_a') ? comparisonState.dirA : comparisonState.dirB;

      const result = copyTileBetweenDirectories(srcDir, destDir, tileId);
      if (result.success) {
        // Update comparisonState results in memory
        const itemIdx = comparisonState.results.findIndex(r => r.id === tileId);
        if (itemIdx !== -1) {
          const removed = comparisonState.results.splice(itemIdx, 1)[0];
          if (removed.status === 'missing_in_a') comparisonState.stats.missingA = Math.max(0, comparisonState.stats.missingA - 1);
          if (removed.status === 'missing_in_b') comparisonState.stats.missingB = Math.max(0, comparisonState.stats.missingB - 1);
          comparisonState.stats.identical = (comparisonState.stats.identical || 0) + 1;
        }
      }

      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // ----------------------------------------------------
    // STATIC FILE SERVING
    // ----------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Support serving existing images and images_floors directly
    if (pathname.startsWith('/images/')) {
      filePath = path.join(__dirname, pathname);
    } else if (pathname.startsWith('/images_floors/')) {
      filePath = path.join(__dirname, pathname);
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // If not found
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');

  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

const PORT = config.port || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🏰 Ultima Online Housing & Art Studio`);
  console.log(`🌐 Server running at: http://localhost:${PORT}`);
  console.log(`📁 Server Multi Files: ${config.serverFilesDir}`);
  console.log(`🎨 Client Art Files:   ${config.clientArtDir}`);
  console.log(`📜 Server Scripts:     ${config.serverScriptsDir}`);
  console.log(`=======================================================`);
});
