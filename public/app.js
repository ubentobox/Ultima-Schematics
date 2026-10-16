/**
 * Ultima Online Housing & Art Studio - Frontend Engine
 * Matches and extends the layout and aesthetic of the classic housing gallery.
 */

// State
let currentTab = 'server';
let serverHouses = [];
let libraryHouses = [];
let defaultView = 'full'; // 'full' | 'ground' | 'top'
let sortKey = 'cost';
let searchQuery = '';
let selectedLibraryCategory = 'all';
let selectedFloors = {}; // house.multi -> floor index (-1 = full)
let lightboxCur = -1;
let currentLightboxList = [];
let imgVersion = 2; // Cache-buster for rendered house & floor PNGs

// Tile substitution state
let activeResolverHouse = null;
let activeTileMappings = {}; // { [missingTileId]: replacementTileId }
let activePickerTargetTileId = null;

// Library Add / Edit modal state
let libraryModalMode = 'add'; // 'add' | 'edit'
let libraryModalTarget = null;

// Confirmation modal state
let confirmModalResolver = null;

const ALL_MODAL_IDS = [
  'modal-edit-house',
  'modal-library-entry',
  'modal-resolver',
  'modal-tile-picker',
  'modal-tile-inspector',
  'modal-tile-detail',
  'modal-zoom',
  'modal-export-cs',
  'modal-confirm',
  'lb'
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initTheme();

  // Ensure all overlays and hidden panels start strictly closed
  ALL_MODAL_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.hidden = true;
      el.style.display = 'none';
    }
  });

  setupModalBackdropAndKeyboard();
  setupTabs();
  setupToolbar();
  setupLightboxKeyboard();
  loadConfigAndStatus();
  loadServerHouses();
  loadLibrary();
  switchTab('server');
});

// Format numbers as comma-separated
const gp = n => (Number(n) || 0).toLocaleString('en-US');

// Escape HTML entities safely
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------
// Toast Notifications & Custom Confirmation Modal
// ------------------------------------------------------------------
function showToast(message, type = 'success', duration = 4500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    error: '⚠️',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const textWrap = document.createElement('div');
  textWrap.style.flex = '1';
  textWrap.style.whiteSpace = 'pre-line';
  textWrap.textContent = `${icons[type] || '•'} ${message}`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.type = 'button';
  closeBtn.innerHTML = '✕';
  closeBtn.addEventListener('click', () => toast.remove());

  toast.appendChild(textWrap);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, duration);
  }
}

function showConfirmModal({ title = 'Confirm Action', message = 'Are you sure?', detail = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const modal = document.getElementById('modal-confirm');
    if (!modal) {
      resolve(false);
      return;
    }

    confirmModalResolver = resolve;
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-message').textContent = message;

    const detailEl = document.getElementById('confirm-modal-detail');
    if (detail) {
      detailEl.textContent = detail;
      detailEl.hidden = false;
      detailEl.style.display = 'block';
    } else {
      detailEl.textContent = '';
      detailEl.hidden = true;
      detailEl.style.display = 'none';
    }

    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');
    okBtn.textContent = confirmText;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    cancelBtn.textContent = cancelText;

    modal.hidden = false;
    modal.style.display = 'flex';
    okBtn.focus();
  });
}

function resolveConfirmModal(confirmed) {
  const modal = document.getElementById('modal-confirm');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
  if (confirmModalResolver) {
    const resolve = confirmModalResolver;
    confirmModalResolver = null;
    resolve(Boolean(confirmed));
  }
}

function setupModalBackdropAndKeyboard() {
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', e => {
      if (e.target !== backdrop) return;
      if (backdrop.id === 'modal-confirm') {
        resolveConfirmModal(false);
      } else {
        backdrop.hidden = true;
        backdrop.style.display = 'none';
      }
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const confirmModal = document.getElementById('modal-confirm');
    if (confirmModal && !confirmModal.hidden) {
      resolveConfirmModal(false);
      return;
    }
    const detailModal = document.getElementById('modal-tile-detail');
    if (detailModal && !detailModal.hidden) {
      closeTileDetailModal();
      return;
    }
    const pickerModal = document.getElementById('modal-tile-picker');
    if (pickerModal && !pickerModal.hidden) {
      closeTilePicker();
      return;
    }
    for (const id of ['modal-library-entry', 'modal-edit-house', 'modal-resolver', 'modal-tile-inspector', 'modal-zoom', 'modal-export-cs']) {
      const el = document.getElementById(id);
      if (el && !el.hidden) {
        el.hidden = true;
        el.style.display = 'none';
        return;
      }
    }
  });
}

// ------------------------------------------------------------------
// Theme Management
// ------------------------------------------------------------------
function initTheme() {
  const savedTheme = localStorage.getItem('uo-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.textContent = savedTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('uo-theme', next);
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.textContent = next === 'dark' ? '☀️ Light' : '🌙 Dark';
}

// ------------------------------------------------------------------
// Tabs Navigation
// ------------------------------------------------------------------
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  const views = ['server', 'library', 'compare', 'settings'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      const active = (v === tab);
      el.hidden = !active;
      el.style.display = active ? 'block' : 'none';
    }
  });

  // Toolbar visibility (only for server & library)
  const toolbar = document.getElementById('main-toolbar');
  if (toolbar) {
    const showToolbar = (tab === 'server' || tab === 'library');
    toolbar.hidden = !showToolbar;
    toolbar.style.display = showToolbar ? 'block' : 'none';
  }

  // Category filter visibility (only on Library tab)
  const catWrap = document.getElementById('lib-cat-filter-wrap');
  if (catWrap) {
    const isLib = (tab === 'library');
    catWrap.hidden = !isLib;
    catWrap.style.display = isLib ? 'flex' : 'none';
  }

  if (tab === 'server') renderServerHouses();
  if (tab === 'library') renderLibrary();
  if (tab === 'compare') refreshCompareView();
  if (tab === 'settings') loadConfigAndStatus();
}

// ------------------------------------------------------------------
// Toolbar (Sort, View Mode, Category Filter, Search)
// ------------------------------------------------------------------
function setupToolbar() {
  document.querySelectorAll('.bar [data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      defaultView = btn.dataset.view;
      document.querySelectorAll('.bar [data-view]').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.view === defaultView))
      );
      selectedFloors = {}; // Reset overrides
      if (currentTab === 'server') renderServerHouses();
      if (currentTab === 'library') renderLibrary();
    });
  });

  const catSelect = document.getElementById('lib-category-filter');
  if (catSelect) {
    catSelect.addEventListener('change', e => {
      selectedLibraryCategory = e.target.value;
      if (currentTab === 'library') renderLibrary();
    });
  }

  const sortSelect = document.getElementById('sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', e => {
      sortKey = e.target.value;
      if (currentTab === 'server') renderServerHouses();
      if (currentTab === 'library') renderLibrary();
    });
  }

  const searchInput = document.getElementById('q');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      searchQuery = e.target.value;
      if (currentTab === 'server') renderServerHouses();
      if (currentTab === 'library') renderLibrary();
    });
  }

  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
}

// ------------------------------------------------------------------
// Server Houses View
// ------------------------------------------------------------------
async function loadServerHouses() {
  try {
    const res = await fetch('/api/houses');
    serverHouses = await res.json();
    const countBadge = document.getElementById('tab-server-count');
    if (countBadge) countBadge.textContent = serverHouses.length;
    renderServerHouses();
  } catch (err) {
    console.error('Error loading server houses:', err);
  }
}

function getHouseKey(h) {
  if (!h) return '';
  if (h.multi !== undefined && h.multi !== null) return String(h.multi);
  if (h.id) return String(h.id);
  return h.name || '';
}

function getFloorIndex(h) {
  const key = getHouseKey(h);
  if (key && (key in selectedFloors)) return selectedFloors[key];
  if (!h.floors || h.floors.length === 0) return -1;
  return defaultView === 'full' ? -1 : defaultView === 'ground' ? 0 : h.floors.length - 1;
}

function getHouseImageSrc(h, floorIdx) {
  if (floorIdx < 0 || !h.floors || !h.floors[floorIdx]) {
    return h.file ? `/images/${h.file}?v=${imgVersion}` : '/api/art/tile/1006';
  }
  const fl = h.floors[floorIdx];
  if (fl.file) {
    return `/images_floors/${fl.file}?v=${imgVersion}`;
  }
  if (h.file) {
    const prefix = h.file.split('_')[0];
    if (prefix && prefix.length === 4) {
      return `/images_floors/${prefix}_f${floorIdx + 1}.png?v=${imgVersion}`;
    }
  }
  return h.file ? `/images/${h.file}?v=${imgVersion}` : '/api/art/tile/1006';
}

function renderServerHouses() {
  const grid = document.getElementById('server-grid');
  if (!grid) return;

  const q = searchQuery.trim().toLowerCase();
  let list = serverHouses.filter(h => {
    if (!q) return true;
    const hex = '0x' + h.multi.toString(16).toLowerCase();
    return h.name.toLowerCase().includes(q) || hex.includes(q) || String(h.multi).includes(q);
  });

  list.sort((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name);
    if (sortKey === 'category') return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
    if (sortKey === 'author') return (a.author || '').localeCompare(b.author || '') || a.name.localeCompare(b.name);
    if (sortKey === 'floors') return ((a.floors?.length || 1) - (b.floors?.length || 1)) || (a.cost - b.cost);
    return ((a[sortKey] || 0) - (b[sortKey] || 0)) || (a.cost - b.cost);
  });

  currentLightboxList = list;
  grid.innerHTML = '';

  list.forEach((house, idx) => {
    grid.appendChild(createHouseCard(house, idx, false));
  });

  const countEl = document.getElementById('count');
  if (countEl) countEl.textContent = `${list.length} of ${serverHouses.length} houses`;
}

function createHouseCard(h, idx, isLibrary = false) {
  const card = document.createElement('div');
  card.className = `card ${!h.isCompatible ? 'incompatible' : ''}`;

  const floorIdx = getFloorIndex(h);
  const imgSrc = getHouseImageSrc(h, floorIdx);

  // Status Badge
  let badgeHtml = '';
  if (isLibrary && h.isInstalled) {
    badgeHtml = `<span class="card-badge badge-installed">✓ Installed</span>`;
  } else if (!h.isCompatible) {
    badgeHtml = `<span class="card-badge badge-warning">⚠️ ${h.missingTileCount} Missing Tiles</span>`;
  } else if (h.isCustom) {
    badgeHtml = `<span class="card-badge badge-custom">Custom</span>`;
  } else if (!isLibrary && h.inLibrary) {
    badgeHtml = `<span class="card-badge badge-library">🌐 In Library</span>`;
  }

  // Image Picture Button
  const pic = document.createElement('button');
  pic.className = 'pic';
  pic.type = 'button';
  pic.innerHTML = `
    ${badgeHtml}
    <img loading="lazy" src="${imgSrc}" alt="${escapeHtml(h.name)}" onerror="this.src='/images/008E_Old_Stone_Home_And_Shoppe.png?v=${imgVersion}'">
  `;
  pic.addEventListener('click', () => openLightbox(idx, currentLightboxList));

  // Header row
  const row = document.createElement('div');
  row.className = 'row';
  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = h.name;
  row.appendChild(nameEl);

  // Floor buttons
  if (h.floors && h.floors.length > 1) {
    const floorSeg = createFloorButtons(h, floorIdx, true, k => {
      selectedFloors[getHouseKey(h)] = k;
      refreshCardImage(card, h);
    });
    row.appendChild(floorSeg);
  }

  card.appendChild(pic);
  card.appendChild(row);

  // Category & Author Metadata Row for Library Entries
  if (isLibrary) {
    const metaRow = document.createElement('div');
    metaRow.className = 'lib-meta-row';

    const catText = h.category || 'Classic Housing';
    const catPill = document.createElement('button');
    catPill.type = 'button';
    catPill.className = 'lib-category-pill';
    catPill.title = `Filter library by category: ${catText}`;
    catPill.textContent = `🏷️ ${catText}`;
    catPill.addEventListener('click', e => {
      e.stopPropagation();
      selectedLibraryCategory = (selectedLibraryCategory === catText) ? 'all' : catText;
      const catSel = document.getElementById('lib-category-filter');
      if (catSel) catSel.value = selectedLibraryCategory;
      renderLibrary();
    });

    const authorPill = document.createElement('span');
    authorPill.className = 'lib-author-pill';
    authorPill.title = `Author / Credits: ${h.author || 'Unknown'}`;
    authorPill.innerHTML = `✍️ by <b>${escapeHtml(h.author || 'Unknown')}</b>`;

    metaRow.appendChild(catPill);
    metaRow.appendChild(authorPill);
    card.appendChild(metaRow);
  }

  if (h.description && isLibrary) {
    const desc = document.createElement('div');
    desc.className = 'desc-text';
    desc.title = h.description;
    desc.textContent = h.description;
    card.appendChild(desc);
  }

  // Cost & Stats
  const multiStr = h.multi !== undefined && h.multi !== null
    ? '0x' + h.multi.toString(16).toUpperCase()
    : (h.installedMulti ? '0x' + h.installedMulti.toString(16).toUpperCase() : 'Custom');
  card.insertAdjacentHTML('beforeend', `
    <div class="cost">${gp(h.cost)} gold</div>
    <div class="stats">
      <span>Storage <b>${gp(h.storage)}</b></span>
      <span>Lockdowns <b>${gp(h.lockdowns)}</b></span>
      <span>Vendors <b>${h.vendors || 0}</b></span>
      <span>Footprint <b>${h.w || 0} x ${h.d || 0}</b></span>
      <span>Floors <b>${h.floors?.length || 1}</b></span>
      <span>Multi <b>${multiStr}</b></span>
    </div>
  `);

  // Incompatibility Warning Banner
  if (!h.isCompatible) {
    const banner = document.createElement('div');
    banner.className = 'incompat-banner';
    banner.innerHTML = `
      <span>⚠️ Missing <b>${h.missingTileCount}</b> custom tiles</span>
      <button class="btn btn-sm btn-primary" type="button">Resolve</button>
    `;
    banner.querySelector('button').addEventListener('click', e => {
      e.stopPropagation();
      openTileResolverModal(h);
    });
    card.appendChild(banner);
  }

  // Action Buttons
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (!isLibrary) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm';
    editBtn.type = 'button';
    editBtn.innerHTML = '✏️ Edit';
    editBtn.title = 'Edit cost, lockdowns, storage, and vendors';
    editBtn.addEventListener('click', () => openEditHouseModal(h));

    const inspectBtn = document.createElement('button');
    inspectBtn.className = 'btn btn-sm';
    inspectBtn.type = 'button';
    inspectBtn.innerHTML = '🔍 Tiles';
    inspectBtn.title = 'Inspect tile components in multi';
    inspectBtn.addEventListener('click', () => openTileInspectorModal(h, false));

    actions.appendChild(editBtn);
    actions.appendChild(inspectBtn);

    // Add to library option if not already in library
    if (!h.inLibrary) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn btn-sm btn-accent';
      shareBtn.type = 'button';
      shareBtn.innerHTML = '📤 To Library';
      shareBtn.title = 'Add this house to the House Design Library';
      shareBtn.addEventListener('click', () => openLibraryEntryModal('add', h));
      actions.appendChild(shareBtn);
    }

    // Remove from server option
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-sm btn-remove';
    removeBtn.type = 'button';
    removeBtn.innerHTML = '🗑️';
    removeBtn.title = `Remove "${h.name}" from server housing menu`;
    removeBtn.addEventListener('click', () => removeServerHouse(h));
    actions.appendChild(removeBtn);

  } else {
    if (h.isInstalled) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-sm btn-installed';
      viewBtn.type = 'button';
      viewBtn.innerHTML = '🏛️ View in Server';
      viewBtn.title = 'Installed on Server — click to view in Server Housing Menu';
      viewBtn.style.cursor = 'pointer';
      viewBtn.addEventListener('click', () => {
        switchTab('server');
        const qInput = document.getElementById('q');
        if (qInput) {
          qInput.value = h.name;
          searchQuery = h.name;
          renderServerHouses();
        }
      });
      actions.appendChild(viewBtn);
    } else if (h.isCompatible) {
      const importBtn = document.createElement('button');
      importBtn.className = 'btn btn-sm btn-primary';
      importBtn.type = 'button';
      importBtn.innerHTML = '📥 Add to Server';
      importBtn.addEventListener('click', () => importLibraryHouse(h));
      actions.appendChild(importBtn);
    } else {
      const resolveBtn = document.createElement('button');
      resolveBtn.className = 'btn btn-sm btn-primary';
      resolveBtn.type = 'button';
      resolveBtn.innerHTML = '🔧 Resolve & Add';
      resolveBtn.addEventListener('click', () => openTileResolverModal(h));
      actions.appendChild(resolveBtn);
    }

    const editLibBtn = document.createElement('button');
    editLibBtn.className = 'btn btn-sm';
    editLibBtn.type = 'button';
    editLibBtn.innerHTML = '✏️ Edit';
    editLibBtn.title = 'Edit library entry metadata (category, author, description, cost, stats)';
    editLibBtn.addEventListener('click', () => openLibraryEntryModal('edit', h));
    actions.appendChild(editLibBtn);

    const inspectLibBtn = document.createElement('button');
    inspectLibBtn.className = 'btn btn-sm';
    inspectLibBtn.type = 'button';
    inspectLibBtn.innerHTML = '🔍 Tiles';
    inspectLibBtn.title = 'Inspect tile components for this library design';
    inspectLibBtn.addEventListener('click', () => openTileInspectorModal(h, true));
    actions.appendChild(inspectLibBtn);

    const removeLibBtn = document.createElement('button');
    removeLibBtn.className = 'btn btn-sm btn-remove';
    removeLibBtn.type = 'button';
    removeLibBtn.innerHTML = '🗑️';
    removeLibBtn.title = `Remove "${h.name}" from the House Design Library`;
    removeLibBtn.addEventListener('click', () => removeLibraryHouse(h));
    actions.appendChild(removeLibBtn);
  }

  card.appendChild(actions);
  return card;
}

function refreshCardImage(card, h) {
  const floorIdx = getFloorIndex(h);
  const img = card.querySelector('.pic img');
  if (img) img.src = getHouseImageSrc(h, floorIdx);
  card.querySelectorAll('.seg button').forEach((btn, k) => {
    btn.setAttribute('aria-pressed', String(k - 1 === floorIdx));
  });
}

function createFloorButtons(h, curFloor, isSmall, onPick) {
  const seg = document.createElement('div');
  seg.className = `seg ${isSmall ? 'small' : ''}`;
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Floor');

  const floorsCount = h.floors ? h.floors.length : 1;
  for (let i = -1; i < floorsCount; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = i < 0 ? 'Full' : String(i + 1);
    b.setAttribute('aria-pressed', String(i === curFloor));
    b.title = i < 0 ? 'Whole house' : `Floor ${i + 1} (z ${h.floors[i]?.z ?? 0})`;
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      onPick(i);
    });
    seg.appendChild(b);
  }
  return seg;
}

// ------------------------------------------------------------------
// House Design Library View & Modal Management
// ------------------------------------------------------------------
async function loadLibrary() {
  try {
    const res = await fetch('/api/library');
    libraryHouses = await res.json();
    const countBadge = document.getElementById('tab-library-count');
    if (countBadge) countBadge.textContent = libraryHouses.length;
    populateLibraryCategoryFilter();
    renderLibrary();
  } catch (err) {
    console.error('Error loading library:', err);
  }
}

function populateLibraryCategoryFilter() {
  const select = document.getElementById('lib-category-filter');
  const datalist = document.getElementById('library-categories-list');

  const categories = Array.from(new Set(
    libraryHouses.map(h => (h.category || 'Classic Housing').trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

  if (select) {
    const prev = selectedLibraryCategory;
    select.innerHTML = `<option value="all">All Categories (${libraryHouses.length})</option>`;
    categories.forEach(cat => {
      const count = libraryHouses.filter(h => (h.category || 'Classic Housing').trim() === cat).length;
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = `${cat} (${count})`;
      select.appendChild(opt);
    });
    if (prev !== 'all' && categories.includes(prev)) {
      select.value = prev;
    } else {
      selectedLibraryCategory = 'all';
      select.value = 'all';
    }
  }

  if (datalist) {
    const presetCats = new Set([
      'Classic Housing', 'Mansions', 'Villas', 'Castles',
      'Towers', 'Shops & Guilds', 'Cottages & Cabins', 'Themed',
      ...categories
    ]);
    datalist.innerHTML = '';
    Array.from(presetCats).sort().forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      datalist.appendChild(opt);
    });
  }
}

function renderLibrary() {
  const grid = document.getElementById('library-grid');
  if (!grid) return;

  const q = searchQuery.trim().toLowerCase();
  let list = libraryHouses.filter(h => {
    if (selectedLibraryCategory !== 'all') {
      const cat = (h.category || 'Classic Housing').trim();
      if (cat !== selectedLibraryCategory) return false;
    }
    if (!q) return true;
    const multiHex = h.multi !== undefined && h.multi !== null ? '0x' + h.multi.toString(16).toLowerCase() : '';
    return h.name.toLowerCase().includes(q) ||
           (h.category && h.category.toLowerCase().includes(q)) ||
           (h.author && h.author.toLowerCase().includes(q)) ||
           (h.description && h.description.toLowerCase().includes(q)) ||
           (multiHex && multiHex.includes(q));
  });

  list.sort((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name);
    if (sortKey === 'category') return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
    if (sortKey === 'author') return (a.author || '').localeCompare(b.author || '') || a.name.localeCompare(b.name);
    if (sortKey === 'floors') return ((a.floors?.length || 1) - (b.floors?.length || 1)) || (a.cost - b.cost);
    return ((a[sortKey] || 0) - (b[sortKey] || 0)) || (a.cost - b.cost);
  });

  currentLightboxList = list;
  grid.innerHTML = '';
  list.forEach((house, idx) => {
    grid.appendChild(createHouseCard(house, idx, true));
  });

  const countEl = document.getElementById('count');
  if (countEl) countEl.textContent = `${list.length} of ${libraryHouses.length} library houses`;
}

function openLibraryEntryModal(mode, h) {
  libraryModalMode = mode;
  libraryModalTarget = h;

  const modal = document.getElementById('modal-library-entry');
  if (!modal) return;

  const titleEl = document.getElementById('lib-modal-title');
  const subEl = document.getElementById('lib-modal-subtitle');
  const submitBtn = document.getElementById('lib-modal-submit-btn');

  const multiHex = h.multi !== undefined && h.multi !== null ? '0x' + h.multi.toString(16).toUpperCase() : 'Custom';

  if (mode === 'add') {
    titleEl.textContent = '📤 Share House to Design Library';
    subEl.textContent = `Add "${h.name}" (Multi ${multiHex}) to the House Design Library with category and author metadata.`;
    submitBtn.innerHTML = '📤 Add to Library';

    document.getElementById('lib-edit-name').value = h.name || '';
    document.getElementById('lib-edit-category').value = h.category || 'Classic Housing';
    document.getElementById('lib-edit-author').value = h.author || 'Server Administrator';
    document.getElementById('lib-edit-description').value =
      h.description || `Original server housing multi ${multiHex} (${h.name}) shared to the community design library.`;
  } else {
    titleEl.textContent = '✏️ Edit Library Design Entry';
    subEl.textContent = `Update library metadata, category, author credits, description, or parameters for "${h.name}".`;
    submitBtn.innerHTML = '💾 Save Library Entry';

    document.getElementById('lib-edit-name').value = h.name || '';
    document.getElementById('lib-edit-category').value = h.category || 'Classic Housing';
    document.getElementById('lib-edit-author').value = h.author || 'Server Administrator';
    document.getElementById('lib-edit-description').value = h.description || '';
  }

  document.getElementById('lib-edit-cost').value = h.cost ?? 50000;
  document.getElementById('lib-edit-storage').value = h.storage ?? 500;
  document.getElementById('lib-edit-lockdowns').value = h.lockdowns ?? 250;
  document.getElementById('lib-edit-vendors').value = h.vendors ?? 1;
  updateLibCostHelper();

  modal.hidden = false;
  modal.style.display = 'flex';
  document.getElementById('lib-edit-category').focus();
}

function closeLibraryEntryModal() {
  const modal = document.getElementById('modal-library-entry');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
  libraryModalTarget = null;
}

function updateLibCostHelper() {
  const cost = document.getElementById('lib-edit-cost')?.value || 0;
  const helper = document.getElementById('lib-cost-helper');
  if (helper) helper.textContent = gp(cost) + ' gold';
}

async function submitLibraryEntryModal() {
  if (!libraryModalTarget) return;
  const h = libraryModalTarget;

  const name = document.getElementById('lib-edit-name').value.trim();
  const category = document.getElementById('lib-edit-category').value.trim() || 'Classic Housing';
  const author = document.getElementById('lib-edit-author').value.trim() || 'Server Administrator';
  const description = document.getElementById('lib-edit-description').value.trim();
  const cost = Number(document.getElementById('lib-edit-cost').value || 0);
  const storage = Number(document.getElementById('lib-edit-storage').value || 0);
  const lockdowns = Number(document.getElementById('lib-edit-lockdowns').value || 0);
  const vendors = Number(document.getElementById('lib-edit-vendors').value || 0);

  if (!name) {
    showToast('Please enter a house name.', 'warning');
    return;
  }

  try {
    if (libraryModalMode === 'add') {
      const res = await fetch('/api/library/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category,
          author,
          description,
          cost,
          storage,
          lockdowns,
          vendors,
          multi: h.multi,
          w: h.w,
          d: h.d,
          tiles: h.tiles,
          file: h.file,
          floors: h.floors
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`"${name}" added to the House Design Library under "${category}"!`, 'success');
        closeLibraryEntryModal();
        await loadLibrary();
        await loadServerHouses();
      } else {
        showToast(data.error || 'Failed to add house to library.', 'error');
      }
    } else {
      const res = await fetch(`/api/library/${encodeURIComponent(h.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category,
          author,
          description,
          cost,
          storage,
          lockdowns,
          vendors
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Updated library entry "${name}".`, 'success');
        closeLibraryEntryModal();
        await loadLibrary();
        await loadServerHouses();
      } else {
        showToast(data.error || 'Failed to update library entry.', 'error');
      }
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function removeLibraryHouse(h) {
  const confirmed = await showConfirmModal({
    title: '🗑️ Remove from House Design Library',
    message: `Are you sure you want to remove "${h.name}" from the House Design Library?`,
    detail: `Category: ${h.category || 'Classic Housing'} · Author: ${h.author || 'Unknown'}\nThis removes the entry from data/library.json (any copy already installed on your server will remain intact).`,
    confirmText: '🗑️ Remove from Library',
    danger: true
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/library/${encodeURIComponent(h.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`"${h.name}" was removed from the House Design Library.`, 'success');
      await loadLibrary();
      await loadServerHouses();
    } else {
      showToast(data.error || 'Failed to remove library house.', 'error');
    }
  } catch (err) {
    showToast(`Error removing library house: ${err.message}`, 'error');
  }
}

async function importLibraryHouse(h) {
  const confirmed = await showConfirmModal({
    title: '📥 Add House to Server Menu',
    message: `Import "${h.name}" into your server's active housing menu?`,
    detail: `Category: ${h.category || 'Classic Housing'} · By ${h.author || 'Unknown'}\nCost: ${gp(h.cost)} gold · Storage: ${gp(h.storage)} · Lockdowns: ${gp(h.lockdowns)}`,
    confirmText: '📥 Add to Server',
    danger: false
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: h.id })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`"${h.name}" added to server housing menu (Multi 0x${data.house.multi.toString(16).toUpperCase()})!`, 'success');
      await loadServerHouses();
      await loadLibrary();
      switchTab('server');
    } else {
      showToast(`Import error: ${data.error || 'Failed'}`, 'error');
    }
  } catch (err) {
    showToast(`Import error: ${err.message}`, 'error');
  }
}

async function removeServerHouse(h) {
  const multiHex = '0x' + (h.multi ? h.multi.toString(16).toUpperCase() : '??');
  const confirmed = await showConfirmModal({
    title: '🗑️ Remove House from Server Menu',
    message: `Remove "${h.name}" (${multiHex}) from the server housing menu?`,
    detail: `This removes it from houses.json and comments out its entry in HousePlacementContainer.cs (saving an automatic timestamped .bak backup).`,
    confirmText: '🗑️ Remove from Server',
    danger: true
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/houses/${h.multi}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      let msg = `"${h.name}" was removed from the server housing menu.`;
      if (data.scriptResult && data.scriptResult.success) {
        msg += ` ${data.scriptResult.message}`;
      }
      showToast(msg, 'success');
      await loadServerHouses();
      await loadLibrary();
    } else {
      showToast(`Error removing house: ${data.error || 'Failed'}`, 'error');
    }
  } catch (err) {
    showToast(`Error removing house: ${err.message}`, 'error');
  }
}

// ------------------------------------------------------------------
// Tile Compatibility & Substitution Workbench
// ------------------------------------------------------------------
function openTileResolverModal(h) {
  activeResolverHouse = h;
  activeTileMappings = {};
  const modal = document.getElementById('modal-resolver');
  if (!modal) return;

  document.getElementById('resolver-house-name').textContent = h.name;
  const descEl = document.getElementById('resolver-house-desc');
  if (descEl) descEl.textContent = `This house uses ${h.missingTileCount} custom tile(s) not found in your client art files. Select alternate tiles from your server's artwork to make it 100% compatible.`;

  renderSubstitutionRows();
  modal.hidden = false;
  modal.style.display = 'flex';
}

function closeTileResolverModal() {
  const modal = document.getElementById('modal-resolver');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
  activeResolverHouse = null;
  activeTileMappings = {};
}

function renderSubstitutionRows() {
  const container = document.getElementById('resolver-list');
  if (!container || !activeResolverHouse) return;
  container.innerHTML = '';

  activeResolverHouse.missingTiles.forEach(missing => {
    const row = document.createElement('div');
    row.className = 'subst-row';

    const currentMapping = activeTileMappings[missing.itemId];

    row.innerHTML = `
      <div style="flex: 1;">
        <div style="font-weight: 700; font-size: 14px; color: var(--danger);">
          ⚠️ Missing Tile: ${missing.hex} (${missing.itemId})
        </div>
        <div style="font-size: 13px; color: var(--muted);">
          Expected: <b>${missing.expectedName}</b> · Used <b>${missing.count}</b> times
        </div>
      </div>
      <div class="subst-arrow">➔</div>
      <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
        <div class="tile-thumb" id="thumb-subst-${missing.itemId}">
          ${currentMapping ? `<img src="/api/art/tile/${currentMapping}" alt="Tile">` : `<span style="font-size:11px;color:var(--muted)">None</span>`}
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 13px;" id="name-subst-${missing.itemId}">
            ${currentMapping ? `Selected: 0x${currentMapping.toString(16).toUpperCase()}` : 'Pick Replacement'}
          </div>
          <button class="btn btn-sm" type="button" onclick="openTilePickerFor(${missing.itemId})">
            🎨 Choose Alternate Tile...
          </button>
        </div>
      </div>
    `;
    container.appendChild(row);
  });
}

function openTilePickerFor(targetMissingTileId) {
  activePickerTargetTileId = targetMissingTileId;
  const pickerModal = document.getElementById('modal-tile-picker');
  if (pickerModal) {
    pickerModal.hidden = false;
    pickerModal.style.display = 'flex';
    document.getElementById('picker-search').value = '';
    searchTilePicker('stone'); // default suggested search
  }
}

function closeTilePicker() {
  const pickerModal = document.getElementById('modal-tile-picker');
  if (pickerModal) {
    pickerModal.hidden = true;
    pickerModal.style.display = 'none';
  }
  activePickerTargetTileId = null;
}

async function searchTilePicker(query) {
  const grid = document.getElementById('picker-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="padding:12px;color:var(--muted)">Searching tiles...</div>';

  try {
    const res = await fetch(`/api/tiledata/search?q=${encodeURIComponent(query)}`);
    const tiles = await res.json();
    grid.innerHTML = '';

    if (tiles.length === 0) {
      grid.innerHTML = '<div style="padding:12px;color:var(--muted)">No matching tiles found.</div>';
      return;
    }

    tiles.forEach(t => {
      const item = document.createElement('div');
      item.className = 'tile-picker-item';
      item.innerHTML = `
        <img loading="lazy" src="/api/art/tile/${t.id}" alt="${t.name}">
        <span>${t.hex}</span>
        <span title="${t.name}">${t.name || 'Tile'}</span>
      `;
      item.addEventListener('click', () => {
        selectTileReplacement(activePickerTargetTileId, t.id, t.name);
        closeTilePicker();
      });
      grid.appendChild(item);
    });
  } catch (err) {
    grid.innerHTML = `<div style="color:var(--danger)">Error: ${err.message}</div>`;
  }
}

function selectTileReplacement(missingTileId, replacementId, replacementName) {
  activeTileMappings[missingTileId] = replacementId;
  renderSubstitutionRows();
}

async function commitTileResolution() {
  if (!activeResolverHouse) return;

  // Verify all missing tiles have replacements
  const unresolved = activeResolverHouse.missingTiles.filter(m => !activeTileMappings[m.itemId]);
  if (unresolved.length > 0) {
    showToast(`Please select an alternate tile for all ${unresolved.length} missing tile(s) before committing.`, 'warning');
    return;
  }

  try {
    const res = await fetch('/api/library/resolve-and-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeResolverHouse.id,
        mappings: activeTileMappings
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`"${data.house.name}" with your selected alternate tiles has been added to your server!`, 'success');
      closeTileResolverModal();
      await loadServerHouses();
      await loadLibrary();
      switchTab('server');
    } else {
      showToast(`Error committing house: ${data.error || 'Failed'}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ------------------------------------------------------------------
// Edit House Modal (Cost, Lockdowns, Storage, Vendors)
// ------------------------------------------------------------------
let editingHouse = null;

function openEditHouseModal(h) {
  editingHouse = h;
  const modal = document.getElementById('modal-edit-house');
  if (!modal) return;

  document.getElementById('edit-name').value = h.name;
  document.getElementById('edit-cost').value = h.cost;
  document.getElementById('edit-storage').value = h.storage;
  document.getElementById('edit-lockdowns').value = h.lockdowns;
  document.getElementById('edit-vendors').value = h.vendors || 1;
  document.getElementById('edit-multi').value = '0x' + h.multi.toString(16).toUpperCase();

  updateCostHelper();
  modal.hidden = false;
  modal.style.display = 'flex';
}

function closeEditHouseModal() {
  const modal = document.getElementById('modal-edit-house');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
  editingHouse = null;
}

function updateCostHelper() {
  const cost = document.getElementById('edit-cost').value;
  const helper = document.getElementById('cost-helper');
  if (helper) helper.textContent = gp(cost) + ' gold';
}

async function saveHouseChanges() {
  if (!editingHouse) return;

  const cost = Number(document.getElementById('edit-cost').value);
  const storage = Number(document.getElementById('edit-storage').value);
  const lockdowns = Number(document.getElementById('edit-lockdowns').value);
  const vendors = Number(document.getElementById('edit-vendors').value);
  const name = document.getElementById('edit-name').value.trim();
  const saveToServerScript = document.getElementById('edit-sync-server').checked;

  try {
    const res = await fetch(`/api/houses/${editingHouse.multi}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cost, storage, lockdowns, vendors, name, saveToServerScript })
    });
    const data = await res.json();
    if (data.success) {
      let msg = `Changes for "${name}" saved!`;
      if (saveToServerScript) {
        if (data.scriptUpdateResult && data.scriptUpdateResult.success) {
          msg += `\nServer script (HousePlacementContainer.cs) updated & backup created.`;
        } else if (data.scriptUpdateResult) {
          msg += `\nNotice: ${data.scriptUpdateResult.message}`;
        }
      }
      showToast(msg, 'success', 5500);
      closeEditHouseModal();
      await loadServerHouses();
    } else {
      showToast(`Error saving house: ${data.error || 'Failed'}`, 'error');
    }
  } catch (err) {
    showToast(`Error saving house: ${err.message}`, 'error');
  }
}

// ------------------------------------------------------------------
// Tile Inspector Modal & Single Tile Details Modal
// ------------------------------------------------------------------
let currentInspectorHouse = null;
let currentInspectorIsLibrary = false;

async function openTileInspectorModal(h, isLibrary = false) {
  currentInspectorHouse = h;
  currentInspectorIsLibrary = isLibrary;
  const modal = document.getElementById('modal-tile-inspector');
  if (!modal) return;

  document.getElementById('inspector-title').textContent = `${h.name} - Component Tiles`;
  const grid = document.getElementById('inspector-tiles-grid');
  grid.innerHTML = '<div style="padding:12px;color:var(--muted)">Loading multi components...</div>';
  modal.hidden = false;
  modal.style.display = 'flex';

  try {
    const endpoint = isLibrary && h.id
      ? `/api/library/${encodeURIComponent(h.id)}`
      : `/api/houses/${h.multi}`;
    const res = await fetch(endpoint);
    const data = await res.json();
    const multi = data.multiData;

    if (!multi || !multi.components || multi.components.length === 0) {
      grid.innerHTML = '<div style="padding:12px;color:var(--danger)">No multi component data found for this house.</div>';
      return;
    }

    // Group components by itemId and track whether any are fixtures (doors/signs)
    const counts = {};
    const fixtureIds = new Set();
    multi.components.forEach(c => {
      if (c.itemId <= 1) return;
      counts[c.itemId] = (counts[c.itemId] || 0) + 1;
      if (c.isFixture || c.flags === 0) fixtureIds.add(c.itemId);
    });

    grid.innerHTML = '';
    const uniqueIds = Object.keys(counts).map(Number).sort((a, b) => a - b);

    uniqueIds.forEach(id => {
      const item = document.createElement('div');
      item.className = 'tile-picker-item';
      const hex = '0x' + id.toString(16).toUpperCase().padStart(4, '0');
      const isFixture = fixtureIds.has(id);
      item.innerHTML = `
        <img loading="lazy" src="/api/art/tile/${id}" alt="${hex}">
        <span>${hex}</span>
        <span style="font-weight:700">${counts[id]}x</span>
        ${isFixture ? `<span class="fixture-tag" title="Placed door, sign, or fixture">Door / Sign</span>` : ''}
      `;
      item.addEventListener('click', () => showTileDataPopup(id, counts[id], isFixture));
      grid.appendChild(item);
    });

  } catch (err) {
    grid.innerHTML = `<div style="color:var(--danger)">Error: ${err.message}</div>`;
  }
}

async function showTileDataPopup(tileId, countInHouse = null, isFixture = false) {
  const modal = document.getElementById('modal-tile-detail');
  const titleEl = document.getElementById('tile-detail-title');
  const bodyEl = document.getElementById('tile-detail-body');
  if (!modal || !bodyEl) return;

  const hex = '0x' + tileId.toString(16).toUpperCase().padStart(4, '0');
  titleEl.textContent = `Tile ${hex} (${tileId})`;
  bodyEl.innerHTML = `<div style="padding:12px;color:var(--muted)">Loading tile metadata...</div>`;
  modal.hidden = false;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/tiledata/tile/${tileId}`);
    if (!res.ok) throw new Error('Tile not found');
    const tile = await res.json();

    const activeFlags = [];
    if (tile.flagsFlags) {
      if (tile.flagsFlags.flagWall) activeFlags.push('Wall');
      if (tile.flagsFlags.flagSurface) activeFlags.push('Surface / Floor');
      if (tile.flagsFlags.flagRoof) activeFlags.push('Roof');
      if (tile.flagsFlags.flagDoor) activeFlags.push('Door');
      if (tile.flagsFlags.flagBridge) activeFlags.push('Stair / Bridge');
      if (tile.flagsFlags.flagImpassable) activeFlags.push('Impassable');
    }
    if (isFixture && !activeFlags.includes('Placed Fixture')) {
      activeFlags.push('Placed Door / Sign');
    }

    const flagsHtml = activeFlags.length > 0
      ? `<div class="tile-flags-wrap">${activeFlags.map(f => `<span class="tile-flag-pill">${escapeHtml(f)}</span>`).join('')}</div>`
      : `<div style="font-size:12px;color:var(--muted);margin-top:4px">Standard static tile</div>`;

    bodyEl.innerHTML = `
      <div class="tile-detail-preview">
        <img src="/api/art/tile/${tile.id}" alt="${escapeHtml(tile.name)}">
      </div>
      <div class="tile-detail-grid">
        <div>
          <small>Name</small>
          <b>${escapeHtml(tile.name)}</b>
        </div>
        <div>
          <small>Tile ID</small>
          <b>${tile.hex} (${tile.id})</b>
        </div>
        <div>
          <small>Height / Z-Offset</small>
          <b>${tile.height}</b>
        </div>
        <div>
          <small>Weight / Layer</small>
          <b>${tile.weight} / ${tile.quality}</b>
        </div>
        <div>
          <small>Raw Flags</small>
          <b>${tile.flags}</b>
        </div>
        <div>
          <small>Occurrences in Multi</small>
          <b>${countInHouse !== null ? `${countInHouse}x` : '—'}</b>
        </div>
      </div>
      <div>
        <small style="display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">Decoded Tile Attributes</small>
        ${flagsHtml}
      </div>
    `;
  } catch (_) {
    bodyEl.innerHTML = `
      <div class="tile-detail-preview">
        <img src="/api/art/tile/${tileId}" alt="${hex}">
      </div>
      <div style="text-align:center;color:var(--muted)">Tile ${hex} (${tileId}) — Custom or unindexed tiledata entry.</div>
    `;
  }
}

function closeTileDetailModal() {
  const modal = document.getElementById('modal-tile-detail');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
}

function closeTileInspectorModal() {
  const modal = document.getElementById('modal-tile-inspector');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
}

// ------------------------------------------------------------------
// Directory Comparison View
// ------------------------------------------------------------------
let currentCompPage = 1;
let currentCompFilter = 'all';

async function triggerScanComparison() {
  const dirA = document.getElementById('comp-dir-a').value.trim();
  const dirB = document.getElementById('comp-dir-b').value.trim();

  if (!dirB) {
    showToast('Please enter or select Directory B to compare against.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-scan-comp');
  btn.disabled = true;
  btn.textContent = '⏳ Scanning Directories...';

  try {
    const res = await fetch('/api/compare/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirA, dirB })
    });
    const data = await res.json();
    if (data.success) {
      currentCompPage = 1;
      await refreshCompareView();
      showToast(`Comparison scan complete! Checked ${gp(data.stats.total)} tiles (${gp(data.totalDiffs)} differences found).`, 'success');
    } else {
      showToast(`Scan error: ${data.error || 'Failed'}`, 'error');
    }
  } catch (err) {
    showToast(`Scan error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚖️ Start Art & Tile Comparison';
  }
}

async function refreshCompareView() {
  try {
    const search = document.getElementById('comp-search')?.value || '';
    const res = await fetch(`/api/compare/tiles?filter=${currentCompFilter}&page=${currentCompPage}&q=${encodeURIComponent(search)}`);
    const data = await res.json();

    if (!data.active || !data.stats) {
      document.getElementById('comp-results-wrap').hidden = true;
      return;
    }

    document.getElementById('comp-results-wrap').hidden = false;

    // Update stats boxes
    document.getElementById('stat-total').textContent = gp(data.stats.total);
    document.getElementById('stat-identical').textContent = gp(data.stats.identical);
    document.getElementById('stat-graphic-diff').textContent = gp(data.stats.graphicMismatch);
    document.getElementById('stat-tiledata-diff').textContent = gp(data.stats.tiledataMismatch);
    document.getElementById('stat-missing-a').textContent = gp(data.stats.missingA);
    document.getElementById('stat-missing-b').textContent = gp(data.stats.missingB);

    // Render table
    renderCompareTable(data.results);

    // Update pagination
    const pagInfo = document.getElementById('comp-pagination-info');
    if (pagInfo) {
      pagInfo.textContent = `Page ${data.page} of ${data.totalPages || 1} (${gp(data.totalMatches)} items)`;
    }
    document.getElementById('comp-btn-prev').disabled = (data.page <= 1);
    document.getElementById('comp-btn-next').disabled = (data.page >= data.totalPages);

  } catch (err) {
    console.error('Error refreshing comparison:', err);
  }
}

function renderCompareTable(items) {
  const tbody = document.getElementById('comp-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--muted)">No differences match the current filter.</td></tr>`;
    return;
  }

  items.forEach(item => {
    const tr = document.createElement('tr');

    let badgeClass = 'badge-warning';
    let badgeLabel = 'Graphic Mismatch';
    if (item.status === 'missing_in_a') { badgeClass = 'badge-warning'; badgeLabel = 'Missing in A'; }
    else if (item.status === 'missing_in_b') { badgeClass = 'badge-warning'; badgeLabel = 'Missing in B'; }
    else if (item.status === 'tiledata_mismatch') { badgeClass = 'badge-custom'; badgeLabel = 'Tiledata Diff'; }

    let actionButtons = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">`;
    if (item.status === 'missing_in_a') {
      actionButtons += `<button class="btn btn-sm btn-primary" type="button" title="Add this tile into Directory A (vacant slot)" onclick="copyCompareTile(${item.id}, 'add_to_a', this)">📥 Add to Dir A</button>`;
    } else if (item.status === 'missing_in_b') {
      actionButtons += `<button class="btn btn-sm btn-primary" type="button" title="Add this tile into Directory B (vacant slot)" onclick="copyCompareTile(${item.id}, 'add_to_b', this)">📤 Add to Dir B</button>`;
    }
    actionButtons += `<button class="btn btn-sm" type="button" onclick="openSideBySideZoom(${item.id}, '${item.status}')">🔍 Inspect</button></div>`;

    tr.innerHTML = `
      <td><b>${item.hex}</b><br><small style="color:var(--muted)">${item.id}</small></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="tile-thumb"><img src="/api/art/tile/${item.id}?dir=base" alt="${item.hex}"></div>
          <div>
            <div style="font-weight:600">${escapeHtml(item.nameA || '—')}</div>
            <small style="color:var(--muted)">H: ${item.heightA}</small>
          </div>
        </div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="tile-thumb"><img src="/api/art/tile/${item.id}?dir=compare" alt="${item.hex}"></div>
          <div>
            <div style="font-weight:600">${escapeHtml(item.nameB || '—')}</div>
            <small style="color:var(--muted)">H: ${item.heightB}</small>
          </div>
        </div>
      </td>
      <td><span class="card-badge ${badgeClass}" style="position:static">${badgeLabel}</span></td>
      <td>${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  });
}

function setCompFilter(filter) {
  currentCompFilter = filter;
  currentCompPage = 1;
  document.querySelectorAll('#comp-filter-group button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
  });
  refreshCompareView();
}

function changeCompPage(delta) {
  currentCompPage += delta;
  refreshCompareView();
}

function openSideBySideZoom(tileId, status) {
  const modal = document.getElementById('modal-zoom');
  if (!modal) return;

  const hex = '0x' + tileId.toString(16).toUpperCase().padStart(4, '0');
  document.getElementById('zoom-title').textContent = `Tile ${hex} (${tileId}) - Side-by-Side Zoom`;
  document.getElementById('zoom-img-a').src = `/api/art/tile/${tileId}?dir=base`;
  document.getElementById('zoom-img-b').src = `/api/art/tile/${tileId}?dir=compare`;

  const actionContainer = document.getElementById('zoom-action-container');
  if (actionContainer) {
    if (status === 'missing_in_a') {
      actionContainer.innerHTML = `<button class="btn btn-primary" type="button" onclick="copyCompareTile(${tileId}, 'add_to_a', this)">📥 Add Tile ${hex} to Directory A (Vacant Slot)</button>`;
    } else if (status === 'missing_in_b') {
      actionContainer.innerHTML = `<button class="btn btn-primary" type="button" onclick="copyCompareTile(${tileId}, 'add_to_b', this)">📤 Add Tile ${hex} to Directory B (Vacant Slot)</button>`;
    } else {
      actionContainer.innerHTML = '';
    }
  }

  modal.hidden = false;
  modal.style.display = 'flex';
}

async function copyCompareTile(tileId, direction, btn) {
  const dirLabel = direction === 'add_to_a' ? 'Directory A (Server Client)' : 'Directory B (Target)';
  const hex = '0x' + tileId.toString(16).toUpperCase().padStart(4, '0');

  const confirmed = await showConfirmModal({
    title: '📥 Copy Tile Between Directories',
    message: `Import tile ${hex} into ${dirLabel}?`,
    detail: `This appends the sprite art to art.mul, updates artidx.mul, and synchronizes the item record in tiledata.mul (with automatic .bak backup).`,
    confirmText: `Import Tile ${hex}`,
    danger: false
  });
  if (!confirmed) return;

  const oldText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Adding...';
  }

  try {
    const res = await fetch('/api/compare/copy-tile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tileId, direction })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Tile ${data.hex} ("${data.name}") added to ${dirLabel}!`, 'success');
      closeSideBySideZoom();
      await refreshCompareView();
    } else {
      showToast(`Error copying tile: ${data.error || 'Failed'}`, 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }
  } catch (err) {
    showToast(`Error copying tile: ${err.message}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }
}

function closeSideBySideZoom() {
  const modal = document.getElementById('modal-zoom');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
}

// ------------------------------------------------------------------
// Settings & Directories View
// ------------------------------------------------------------------
async function loadConfigAndStatus() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();

    document.getElementById('cfg-server-files').value = data.config.serverFilesDir;
    document.getElementById('cfg-client-art').value = data.config.clientArtDir;
    document.getElementById('cfg-server-scripts').value = data.config.serverScriptsDir;

    // Set default comparison dir A
    const compDirA = document.getElementById('comp-dir-a');
    if (compDirA && !compDirA.value) compDirA.value = data.config.clientArtDir;

    // Status badges
    const st = data.status;
    renderStatusPill('status-files', st.serverFilesStatus.multiIdx && st.serverFilesStatus.multiMul, 'multi.idx / multi.mul found');
    renderStatusPill('status-art', st.clientArtStatus.artIdx && st.clientArtStatus.artMul, 'artidx.mul / art.mul found');
    renderStatusPill('status-scripts', st.serverScriptsStatus.housePlacementContainer, 'HousePlacementContainer.cs found');

  } catch (err) {
    console.error('Error loading config:', err);
  }
}

function renderStatusPill(elementId, ok, label) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `status-pill ${ok ? 'status-ok' : 'status-err'}`;
  el.innerHTML = ok ? `✓ ${label}` : `✗ Missing files or directory`;
}

async function saveSettings() {
  const serverFilesDir = document.getElementById('cfg-server-files').value.trim();
  const clientArtDir = document.getElementById('cfg-client-art').value.trim();
  const serverScriptsDir = document.getElementById('cfg-server-scripts').value.trim();

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverFilesDir, clientArtDir, serverScriptsDir })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Directories updated and binary readers reloaded successfully!', 'success');
      await loadConfigAndStatus();
      await loadServerHouses();
      await loadLibrary();
    } else {
      showToast('Failed to save settings.', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function regenerateHouseImagesFromSettings() {
  const btn = document.getElementById('btn-regen-images');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Rendering 68 Houses & 137 Floors...';
  }

  try {
    const res = await fetch('/api/houses/regenerate-images', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      imgVersion = Date.now();
      showToast(`Re-rendered ${data.fullCount} full house images and ${data.floorCount} floor views with doors & signs!`, 'success');
      renderServerHouses();
      renderLibrary();
    } else {
      showToast(`Render error: ${data.error || 'Failed'}`, 'error');
    }
  } catch (err) {
    showToast(`Render error: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

// ------------------------------------------------------------------
// Lightbox (Expanded from original index.html)
// ------------------------------------------------------------------
const lb = document.getElementById('lb');

function openLightbox(idx, list) {
  currentLightboxList = list;
  lightboxCur = idx;
  showLightbox();
  lb.hidden = false;
  lb.style.display = 'flex';
  document.getElementById('lb-close').focus();
}

function showLightbox() {
  const h = currentLightboxList[lightboxCur];
  if (!h) return;
  const f = getFloorIndex(h);

  document.getElementById('lb-name').textContent = h.name;
  const libPrefix = (h.category || h.author)
    ? `${h.category || 'Classic Housing'} · by ${h.author || 'Unknown'} · `
    : '';
  document.getElementById('lb-meta').textContent =
    `${libPrefix}${gp(h.cost)} gold · storage ${gp(h.storage)} · lockdowns ${gp(h.lockdowns)} · vendors ${h.vendors || 0} · footprint ${h.w} x ${h.d} · ${(h.floors?.length || 1)} floor(s)`;

  const img = document.getElementById('lb-pic');
  img.src = getHouseImageSrc(h, f);
  img.alt = h.name;

  const holder = document.getElementById('lb-floors');
  if (holder) {
    const newSeg = createFloorButtons(h, f, false, k => {
      selectedFloors[getHouseKey(h)] = k;
      showLightbox();
      if (currentTab === 'server') renderServerHouses();
      else if (currentTab === 'library') renderLibrary();
    });
    newSeg.id = 'lb-floors';
    holder.replaceWith(newSeg);
  }
}

function closeLightbox() {
  lb.hidden = true;
  lb.style.display = 'none';
  lightboxCur = -1;
}

function setupLightboxKeyboard() {
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', () => {
    lightboxCur = (lightboxCur - 1 + currentLightboxList.length) % currentLightboxList.length;
    showLightbox();
  });
  document.getElementById('lb-next').addEventListener('click', () => {
    lightboxCur = (lightboxCur + 1) % currentLightboxList.length;
    showLightbox();
  });
  lb.addEventListener('click', e => {
    if (e.target === lb || e.target.classList.contains('lb-img')) closeLightbox();
  });
  document.addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') document.getElementById('lb-prev').click();
    if (e.key === 'ArrowRight') document.getElementById('lb-next').click();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const h = currentLightboxList[lightboxCur];
      if (!h || !h.floors || h.floors.length <= 1) return;
      let f = getFloorIndex(h) + (e.key === 'ArrowUp' ? 1 : -1);
      if (f >= h.floors.length) f = -1;
      if (f < -1) f = h.floors.length - 1;
      selectedFloors[getHouseKey(h)] = f;
      showLightbox();
      if (currentTab === 'server') renderServerHouses();
      else if (currentTab === 'library') renderLibrary();
      e.preventDefault();
    }
  });
}

// ------------------------------------------------------------------
// Export C# Script
// ------------------------------------------------------------------
function exportServerCsScript() {
  const modal = document.getElementById('modal-export-cs');
  if (!modal) return;

  const lines = [
    '// ========================================================',
    '// Generated House Placement Definitions for Server',
    '// File: HousePlacementContainer.cs or CustomHousing.cs',
    '// ========================================================',
    '',
    '// Array entries for m_ClassicHouses:',
    'private static HousePlacementEntry[] m_ClassicHouses = new HousePlacementEntry[]',
    '{'
  ];

  serverHouses.forEach(h => {
    const typeName = h.name.replace(/[^a-zA-Z0-9]/g, '');
    const multiHex = '0x' + h.multi.toString(16).toUpperCase();
    const cliloc = h.cliloc || (1011300 + (h.multi % 100));
    lines.push(`\tnew HousePlacementEntry( typeof( ${typeName} ), \t${cliloc}, \t${h.storage}, \t${h.lockdowns}, \t${h.storage}, \t${h.lockdowns}, \t${h.vendors || 1}, \t${h.cost}, \t0, 4, 0, \t${multiHex} ),`);
  });

  lines.push('};');

  document.getElementById('export-cs-content').value = lines.join('\n');
  modal.hidden = false;
  modal.style.display = 'flex';
}

function closeExportCsModal() {
  const modal = document.getElementById('modal-export-cs');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
}

function copyExportCsToClipboard() {
  const textarea = document.getElementById('export-cs-content');
  if (textarea) {
    textarea.select();
    navigator.clipboard.writeText(textarea.value).then(() => {
      showToast('C# script copied to clipboard!', 'success');
    }).catch(() => {
      document.execCommand('copy');
      showToast('C# script copied to clipboard!', 'success');
    });
  }
}

// ------------------------------------------------------------------
// Export Individual Design (.uoa / Multi .txt)
// ------------------------------------------------------------------
function exportCurrentInspectorDesign(format = 'uoa') {
  if (!currentInspectorHouse) return;
  const targetKey = (currentInspectorIsLibrary && currentInspectorHouse.id)
    ? currentInspectorHouse.id
    : (currentInspectorHouse.multi !== undefined ? String(currentInspectorHouse.multi) : currentInspectorHouse.id);
  if (!targetKey) {
    showToast('Unable to determine design ID for export.', 'error');
    return;
  }
  const url = `/api/export/${format === 'txt' ? 'txt' : 'uoa'}/${encodeURIComponent(targetKey)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast(`Exporting "${currentInspectorHouse.name}" as .${format.toUpperCase()}...`, 'info');
}

// ------------------------------------------------------------------
// UO Architect & Raw Text Import Workbench
// ------------------------------------------------------------------
let uoaImportMode = 'folder';
let uoaParsedDesigns = [];
let uoaSelectedTempIds = new Set();
let uoaActivePreviewTempId = null;
let uoaActivePreviewFloor = -1;

function openUoaImportModal(mode = 'folder') {
  const modal = document.getElementById('modal-uoa-import');
  if (!modal) return;
  modal.hidden = false;
  modal.style.display = 'flex';
  switchUoaImportMode(mode);
  setupUoaDropzone();
}

function closeUoaImportModal() {
  const modal = document.getElementById('modal-uoa-import');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
  }
}

function switchUoaImportMode(mode) {
  uoaImportMode = mode;
  const modes = ['folder', 'upload', 'paste'];
  modes.forEach(m => {
    const tab = document.getElementById(`uoa-tab-${m}`);
    const panel = document.getElementById(`uoa-panel-${m}`);
    if (tab) tab.setAttribute('aria-pressed', String(m === mode));
    if (panel) panel.hidden = (m !== mode);
  });
}

let uoaDropzoneInitialized = false;
function setupUoaDropzone() {
  if (uoaDropzoneInitialized) return;
  const dz = document.getElementById('uoa-dropzone');
  if (!dz) return;
  uoaDropzoneInitialized = true;

  dz.addEventListener('dragover', e => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => {
    dz.classList.remove('dragover');
  });
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUoaFileSelect(e.dataTransfer.files);
    }
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleUoaFileSelect(fileList) {
  if (!fileList || fileList.length === 0) return;
  const statusEl = document.getElementById('uoa-import-summary-status');
  if (statusEl) statusEl.textContent = `⏳ Reading and parsing ${fileList.length} file(s)...`;

  try {
    const filesPayload = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const contentBase64 = await readFileAsBase64(f);
      filesPayload.push({
        name: f.name,
        contentBase64
      });
    }

    const res = await fetch('/api/import/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: filesPayload })
    });
    const data = await res.json();
    if (data.designs && data.designs.length > 0) {
      populateUoaWorkbench(data.designs, data.errors || []);
      showToast(`Parsed ${data.designs.length} design(s) from ${fileList.length} uploaded file(s)!`, 'success');
    } else {
      const errMsg = (data.errors && data.errors[0]?.error) || data.error || 'No valid designs found in selected files.';
      showToast(errMsg, 'error');
      if (statusEl) statusEl.textContent = `❌ ${errMsg}`;
    }
  } catch (err) {
    showToast(`Error parsing files: ${err.message}`, 'error');
    if (statusEl) statusEl.textContent = `❌ Error: ${err.message}`;
  }
}

function loadSampleRawMultiText() {
  const nameInput = document.getElementById('uoa-paste-name');
  const catInput = document.getElementById('uoa-paste-category');
  const authorInput = document.getElementById('uoa-paste-author');
  const textarea = document.getElementById('uoa-paste-textarea');

  if (nameInput && !nameInput.value) nameInput.value = 'Guard Watchtower Outpost';
  if (catInput && !catInput.value) catInput.value = 'Towers';
  if (authorInput && !authorInput.value) authorInput.value = 'In-Game [extract';
  if (textarea) {
    textarea.value = [
      '6 version',
      '1 template id',
      '-1 item version',
      '29 num components',
      '57 -2 -2 0 1',
      '56 -1 -2 0 1',
      '56 0 -2 0 1',
      '56 1 -2 0 1',
      '55 -2 -1 0 1',
      '55 -2 0 0 1',
      '55 -2 1 0 1',
      '54 2 -2 0 1',
      '55 2 -1 0 1',
      '55 2 0 0 1',
      '55 2 1 0 1',
      '56 -2 2 0 1',
      '56 -1 2 0 1',
      '56 1 2 0 1',
      '53 2 2 0 1',
      '1301 -1 -1 0 1',
      '1301 0 -1 0 1',
      '1301 1 -1 0 1',
      '1301 -1 0 0 1',
      '1301 0 0 0 1',
      '1301 1 0 0 1',
      '1301 -1 1 0 1',
      '1301 0 1 0 1',
      '1301 1 1 0 1',
      '1661 0 2 0 0',
      '60 -2 -2 20 1',
      '60 -1 -2 20 1',
      '60 0 -2 20 1',
      '60 1 -2 20 1'
    ].join('\n');
  }
}

async function parsePastedUoaText() {
  const rawText = document.getElementById('uoa-paste-textarea')?.value || '';
  const rawTextName = document.getElementById('uoa-paste-name')?.value.trim() || 'In-Game Extracted Schematic';
  const defaultCategory = document.getElementById('uoa-paste-category')?.value.trim() || '';
  const defaultAuthor = document.getElementById('uoa-paste-author')?.value.trim() || '';

  if (!rawText.trim()) {
    showToast('Please paste raw multi text, [extract output, .wsc, XML, or C# lines first.', 'warning');
    return;
  }

  const statusEl = document.getElementById('uoa-import-summary-status');
  if (statusEl) statusEl.textContent = '⏳ Parsing raw text schematic...';

  try {
    const res = await fetch('/api/import/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawText,
        rawTextName,
        defaultCategory,
        defaultAuthor
      })
    });
    const data = await res.json();
    if (data.designs && data.designs.length > 0) {
      populateUoaWorkbench(data.designs, data.errors || []);
      showToast(`Parsed "${data.designs[0].name}" (${gp(data.designs[0].tiles)} tiles)!`, 'success');
    } else {
      const errMsg = (data.errors && data.errors[0]?.error) || data.error || 'Could not parse any valid tile components from text.';
      showToast(errMsg, 'error');
      if (statusEl) statusEl.textContent = `❌ ${errMsg}`;
    }
  } catch (err) {
    showToast(`Error parsing text: ${err.message}`, 'error');
  }
}

async function scanUoaDirectory() {
  const dirInput = document.getElementById('uoa-scan-dir-input');
  const dirPath = dirInput ? dirInput.value.trim() : '';
  const btn = document.getElementById('btn-uoa-scan-dir');
  const statusEl = document.getElementById('uoa-import-summary-status');

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Scanning...';
  }
  if (statusEl) statusEl.textContent = `⏳ Scanning ${dirPath || 'UO Architect Save folder'}...`;

  try {
    const res = await fetch('/api/import/scan-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath, deduplicate: true })
    });
    const data = await res.json();
    if (data.success && data.designs) {
      populateUoaWorkbench(data.designs, data.errors || []);
      showToast(`Discovered ${data.designs.length} unique designs in ${data.dirPath}!`, 'success');
    } else {
      showToast(data.error || 'Failed to scan directory.', 'error');
      if (statusEl) statusEl.textContent = `❌ ${data.error || 'Failed to scan directory.'}`;
    }
  } catch (err) {
    showToast(`Scan error: ${err.message}`, 'error');
    if (statusEl) statusEl.textContent = `❌ Error: ${err.message}`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔍 Scan Folder for Designs';
    }
  }
}

function populateUoaWorkbench(designs, errors = []) {
  uoaParsedDesigns = designs || [];
  uoaSelectedTempIds.clear();

  // Select all designs not yet in library by default (or all if all are already in library)
  const newOnes = uoaParsedDesigns.filter(d => !d.alreadyInLibrary);
  const defaultTargets = newOnes.length > 0 ? newOnes : uoaParsedDesigns;
  defaultTargets.forEach(d => uoaSelectedTempIds.add(d.tempId));

  // Populate category filter dropdown
  const catSelect = document.getElementById('uoa-filter-cat');
  if (catSelect) {
    const cats = Array.from(new Set(uoaParsedDesigns.map(d => d.category || 'Custom Housing'))).sort();
    catSelect.innerHTML = `<option value="all">All Categories (${uoaParsedDesigns.length})</option>`;
    cats.forEach(c => {
      const cnt = uoaParsedDesigns.filter(d => (d.category || 'Custom Housing') === c).length;
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = `${c} (${cnt})`;
      catSelect.appendChild(opt);
    });
  }

  const workbench = document.getElementById('uoa-results-workbench');
  if (workbench) workbench.hidden = false;

  renderUoaParsedList();

  if (uoaParsedDesigns.length > 0) {
    selectUoaItemForPreview(uoaParsedDesigns[0].tempId, -1);
  }
}

function getFilteredUoaDesigns() {
  const q = (document.getElementById('uoa-filter-q')?.value || '').trim().toLowerCase();
  const cat = document.getElementById('uoa-filter-cat')?.value || 'all';
  const compat = document.getElementById('uoa-filter-compat')?.value || 'all';

  return uoaParsedDesigns.filter(d => {
    if (cat !== 'all' && (d.category || 'Custom Housing') !== cat) return false;
    if (compat === 'compatible' && !d.isCompatible) return false;
    if (compat === 'missing' && d.isCompatible) return false;
    if (compat === 'new' && d.alreadyInLibrary) return false;
    if (!q) return true;
    return (
      (d.name && d.name.toLowerCase().includes(q)) ||
      (d.category && d.category.toLowerCase().includes(q)) ||
      (d.author && d.author.toLowerCase().includes(q)) ||
      (d.sourceFile && d.sourceFile.toLowerCase().includes(q))
    );
  });
}

function renderUoaParsedList() {
  const tbody = document.getElementById('uoa-parsed-tbody');
  if (!tbody) return;
  const filtered = getFilteredUoaDesigns();
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--muted)">No parsed designs match your filter.</td></tr>`;
    updateUoaSummaryFooter();
    return;
  }

  filtered.forEach(d => {
    const tr = document.createElement('tr');
    tr.dataset.tempId = d.tempId;
    if (d.tempId === uoaActivePreviewTempId) tr.classList.add('selected-row');

    const checked = uoaSelectedTempIds.has(d.tempId) ? 'checked' : '';
    let statusBadge = d.isCompatible
      ? `<span class="status-pill status-ok" style="margin:0">✓ Ready</span>`
      : `<span class="status-pill status-err" style="margin:0" title="${d.missingTileCount} missing tile IDs">⚠️ ${d.missingTileCount} Missing</span>`;

    if (d.alreadyInLibrary) {
      statusBadge += ` <span class="status-pill" style="margin:0;background:var(--thumb);color:var(--muted)">In Library</span>`;
    }

    tr.innerHTML = `
      <td><input type="checkbox" class="uoa-row-check" data-temp-id="${escapeHtml(d.tempId)}" ${checked}></td>
      <td>
        <div style="font-weight:700">${escapeHtml(d.name)}</div>
        <small style="color:var(--muted)">by ${escapeHtml(d.author || 'Unknown')} · ${escapeHtml(d.sourceFile || d.sourceFormat)}</small>
      </td>
      <td><span class="lib-category-pill" style="pointer-events:none">${escapeHtml(d.category)}</span></td>
      <td>${d.w}×${d.d}<br><small style="color:var(--muted)">${d.floors?.length || 1} fl</small></td>
      <td><b>${gp(d.tiles)}</b></td>
      <td>${statusBadge}</td>
    `;

    const checkbox = tr.querySelector('.uoa-row-check');
    checkbox.addEventListener('click', e => {
      e.stopPropagation();
      if (checkbox.checked) uoaSelectedTempIds.add(d.tempId);
      else uoaSelectedTempIds.delete(d.tempId);
      updateUoaSummaryFooter();
    });

    tr.addEventListener('click', () => {
      selectUoaItemForPreview(d.tempId, -1);
    });

    tbody.appendChild(tr);
  });

  updateUoaSummaryFooter();
}

function selectUoaItemForPreview(tempId, floorIdx = -1) {
  uoaActivePreviewTempId = tempId;
  uoaActivePreviewFloor = floorIdx;
  const item = uoaParsedDesigns.find(d => d.tempId === tempId);
  if (!item) return;

  // Highlight selected row
  document.querySelectorAll('#uoa-parsed-tbody tr').forEach(tr => {
    tr.classList.toggle('selected-row', tr.dataset.tempId === tempId);
  });

  // Update badge & floor buttons
  const badge = document.getElementById('uoa-prev-badge');
  if (badge) {
    badge.className = `status-pill ${item.isCompatible ? 'status-ok' : 'status-err'}`;
    badge.textContent = item.isCompatible
      ? `✓ Compatible (${gp(item.tiles)} tiles)`
      : `⚠️ ${item.missingTileCount} Missing Custom Tiles`;
  }

  const floorsHolder = document.getElementById('uoa-prev-floors');
  if (floorsHolder) {
    const newSeg = createFloorButtons(item, floorIdx, true, k => {
      selectUoaItemForPreview(tempId, k);
    });
    newSeg.id = 'uoa-prev-floors';
    floorsHolder.replaceWith(newSeg);
  }

  // Update preview image
  const img = document.getElementById('uoa-prev-img');
  if (img) {
    let maxZParam = '';
    if (floorIdx >= 0 && item.floors && item.floors[floorIdx]) {
      maxZParam = `?maxZ=${(item.floors[floorIdx].z ?? 0) + 15}`;
    }
    img.src = `/api/import/preview/${encodeURIComponent(tempId)}${maxZParam}`;
  }

  // Populate metadata editor
  const editor = document.getElementById('uoa-meta-editor');
  if (editor) {
    editor.hidden = false;
    document.getElementById('uoa-edit-item-name').value = item.name || '';
    document.getElementById('uoa-edit-item-cat').value = item.category || '';
    document.getElementById('uoa-edit-item-author').value = item.author || '';
    document.getElementById('uoa-edit-item-cost').value = item.cost || 50000;
    document.getElementById('uoa-edit-item-storage').value = item.storage || 500;
    document.getElementById('uoa-edit-item-lockdowns').value = item.lockdowns || 230;
    const srcInfo = document.getElementById('uoa-prev-source-info');
    if (srcInfo) {
      const origMeta = [item.rawCategory, item.rawSubsection].filter(Boolean).join(' / ');
      srcInfo.textContent = `Source: ${item.sourceFormat}${item.sourceFile ? ` (${item.sourceFile})` : ''}${origMeta ? ` · Original UOA Tag: ${origMeta}` : ''}`;
    }
  }
}

function updateSelectedUoaItemField(field, value) {
  if (!uoaActivePreviewTempId) return;
  const item = uoaParsedDesigns.find(d => d.tempId === uoaActivePreviewTempId);
  if (!item) return;
  item[field] = value;
  renderUoaParsedList();
}

function setUoaSelection(mode) {
  const filtered = getFilteredUoaDesigns();
  if (mode === 'none') {
    filtered.forEach(d => uoaSelectedTempIds.delete(d.tempId));
  } else if (mode === 'new') {
    uoaSelectedTempIds.clear();
    filtered.filter(d => !d.alreadyInLibrary).forEach(d => uoaSelectedTempIds.add(d.tempId));
  } else {
    filtered.forEach(d => uoaSelectedTempIds.add(d.tempId));
  }
  renderUoaParsedList();
}

function updateUoaSummaryFooter() {
  const statusEl = document.getElementById('uoa-import-summary-status');
  const commitBtn = document.getElementById('btn-uoa-commit-import');
  const selCount = uoaSelectedTempIds.size;

  if (statusEl) {
    statusEl.textContent = uoaParsedDesigns.length > 0
      ? `Selected ${selCount} of ${uoaParsedDesigns.length} discovered design(s) for import.`
      : 'Ready to scan or parse schematics.';
  }
  if (commitBtn) {
    commitBtn.disabled = (selCount === 0);
    commitBtn.textContent = selCount > 0
      ? `📥 Import ${selCount} Selected Design${selCount === 1 ? '' : 's'} to Library`
      : '📥 Import Selected to Library';
  }
}

async function commitUoaImport() {
  const selectedItems = uoaParsedDesigns.filter(d => uoaSelectedTempIds.has(d.tempId));
  if (selectedItems.length === 0) return;

  const skipExisting = document.getElementById('uoa-opt-skip-existing')?.checked ?? true;
  const addToServer = document.getElementById('uoa-opt-add-server')?.checked ?? false;
  const commitBtn = document.getElementById('btn-uoa-commit-import');
  if (commitBtn) {
    commitBtn.disabled = true;
    commitBtn.textContent = `⏳ Importing ${selectedItems.length} Design(s)...`;
  }

  try {
    const res = await fetch('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: selectedItems.map(d => ({
          tempId: d.tempId,
          name: d.name,
          category: d.category,
          author: d.author,
          description: d.description,
          cost: d.cost,
          storage: d.storage,
          lockdowns: d.lockdowns,
          vendors: d.vendors,
          w: d.w,
          d: d.d
        })),
        skipExisting,
        addToServer
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(
        `Imported ${data.importedCount} design(s) into the House Design Library!${data.skippedCount > 0 ? ` (${data.skippedCount} duplicate(s) skipped)` : ''}`,
        'success',
        5500
      );
      closeUoaImportModal();
      await loadLibrary();
      if (addToServer) await loadServerHouses();
      switchTab('library');
    } else {
      showToast(`Import error: ${data.error || 'Failed'}`, 'error');
    }
  } catch (err) {
    showToast(`Import error: ${err.message}`, 'error');
  } finally {
    updateUoaSummaryFooter();
  }
}



