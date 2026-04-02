const A4_WIDTH = 2480;
const A4_HEIGHT = 3508;
const STORAGE_KEY = 'a4_rebuild_v1_1_workspace';
const PALETTE = [
  '#ffffff','#f8fafc','#f1f5f9','#ecfeff','#e0f2fe','#dbeafe','#eff6ff','#ede9fe','#fdf4ff','#fce7f3',
  '#ffe4e6','#fff7ed','#ffedd5','#fef3c7','#fefce8','#ecfccb','#ecfdf5','#111827','#1f2937','#334155'
];

const state = {
  images: {},
  columns: [],
  settings: {
    layoutMode: '3',
    rowGapRaw: 12,
    colGapRaw: 14,
    outerBg: '#f8fafc',
    innerBg: '#ffffff',
    filename: '',
    isCustomFilename: false,
  },
  autosaveTimer: null,
  isSaving: false,
};

const els = {};
const drag = {
  active: false,
  pointerId: null,
  itemId: null,
  fromCol: -1,
  fromIndex: -1,
  offsetX: 0,
  offsetY: 0,
  overlay: null,
  placeholder: null,
  currentList: null,
  suppressClick: false,
};

document.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  buildPalette();
  bindEvents();
  initColumns('3');
  loadWorkspace();
  ensureFilename();
  syncControls();
  render();
});

function cacheEls() {
  ['imageInput','layoutMode','rowGap','rowGapValue','colGap','colGapValue','outerBg','innerBg','palette','filenameInput','downloadBtn','resetBtn','board','previewCanvas','saveDot','saveText','dragLayer']
    .forEach(id => els[id] = document.getElementById(id));
}

function bindEvents() {
  els.imageInput.addEventListener('change', onUpload);
  els.layoutMode.addEventListener('change', () => {
    state.settings.layoutMode = els.layoutMode.value;
    initColumns(state.settings.layoutMode, true);
    render();
    scheduleSave();
  });
  els.rowGap.addEventListener('input', () => {
    state.settings.rowGapRaw = Number(els.rowGap.value);
    syncControls(); render(); scheduleSave();
  });
  els.colGap.addEventListener('input', () => {
    state.settings.colGapRaw = Number(els.colGap.value);
    syncControls(); render(); scheduleSave();
  });
  els.outerBg.addEventListener('input', () => { state.settings.outerBg = els.outerBg.value; setPaletteActive(); render(); scheduleSave(); });
  els.innerBg.addEventListener('input', () => { state.settings.innerBg = els.innerBg.value; setPaletteActive(); render(); scheduleSave(); });
  els.filenameInput.addEventListener('input', () => {
    state.settings.filename = sanitizeFilename(els.filenameInput.value.trim()) || defaultFilename();
    state.settings.isCustomFilename = true;
    els.filenameInput.value = state.settings.filename;
    scheduleSave();
  });
  els.downloadBtn.addEventListener('click', downloadPNG);
  els.resetBtn.addEventListener('click', resetAll);

  els.board.addEventListener('pointerdown', onBoardPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp, { passive: false });
  window.addEventListener('pointercancel', onPointerUp, { passive: false });
}

function buildPalette() {
  els.palette.innerHTML = '';
  PALETTE.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = color;
    btn.dataset.color = color;
    btn.title = color;
    btn.addEventListener('click', () => {
      // click once applies to both for parity and speed
      state.settings.outerBg = color;
      state.settings.innerBg = color;
      els.outerBg.value = color;
      els.innerBg.value = color;
      setPaletteActive();
      render();
      scheduleSave();
    });
    els.palette.appendChild(btn);
  });
  setPaletteActive();
}

function setPaletteActive() {
  const activeColor = String(state.settings.innerBg || '').toLowerCase();
  els.palette.querySelectorAll('.swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color.toLowerCase() === activeColor);
  });
}

function initColumns(layoutMode, preserve = false) {
  const previous = preserve ? state.columns.flatMap(col => col.items) : [];
  const count = layoutMode === 'special_2_1' ? 3 : Math.max(1, Number(layoutMode || 3));
  const names = layoutMode === 'special_2_1'
    ? ['左上方', '右上方', '下方置中']
    : Array.from({ length: count }, (_, i) => `第 ${i + 1} 欄`);

  state.columns = names.map(name => ({ name, align: 'top', items: [] }));
  previous.forEach((item, idx) => {
    state.columns[idx % state.columns.length].items.push(item);
  });
}

function defaultFilename() {
  const d = new Date();
  return `天父功課_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function ensureFilename() {
  if (!state.settings.isCustomFilename || !state.settings.filename) {
    state.settings.filename = defaultFilename();
  }
  els.filenameInput.value = state.settings.filename;
}

function sanitizeFilename(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
}

function effectiveRowGap() {
  const g = Number(state.settings.rowGapRaw || 0);
  return g === 0 ? 0 : Math.round(g * 1.18 + 2);
}

function effectiveColGap() {
  const g = Number(state.settings.colGapRaw || 0);
  return g === 0 ? 0 : Math.round(g * 1.2 + 4);
}

function syncControls() {
  els.layoutMode.value = state.settings.layoutMode;
  els.rowGap.value = state.settings.rowGapRaw;
  els.colGap.value = state.settings.colGapRaw;
  els.outerBg.value = state.settings.outerBg;
  els.innerBg.value = state.settings.innerBg;
  els.rowGapValue.textContent = `${effectiveRowGap()} px`;
  els.colGapValue.textContent = `${effectiveColGap()} px`;
  setPaletteActive();
}

async function onUpload(e) {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const originalData = await fileToDataURL(file);
    const previewData = await createPreview(originalData, 520, 0.94);
    const img = await loadImage(originalData);
    state.images[id] = { id, type: 'image', originalData, previewData, img };
    const target = state.columns.reduce((a,b) => a.items.length <= b.items.length ? a : b);
    target.items.push({ id, noGapBelow: false });
  }
  e.target.value = '';
  render();
  scheduleSave();
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function createPreview(src, maxSize = 520, quality = 0.94) {
  const img = await loadImage(src);
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

function render() {
  renderBoard();
  drawPreview();
}

function renderBoard() {
  const gap = Math.max(8, Math.round(effectiveColGap() * 0.55));
  const itemGap = Math.max(8, Math.round(effectiveRowGap() * 0.55));
  els.board.style.setProperty('--board-gap', `${gap}px`);
  els.board.style.setProperty('--item-gap', `${itemGap}px`);
  els.board.innerHTML = '';

  state.columns.forEach((col, colIndex) => {
    const colEl = document.createElement('div');
    colEl.className = 'kanban-col';
    colEl.dataset.col = String(colIndex);
    colEl.innerHTML = `
      <div class="kanban-col-head">
        <div class="kanban-col-title">${col.name}</div>
        <div class="kanban-col-count">${col.items.length}</div>
      </div>
      <div class="kanban-list" data-col="${colIndex}"></div>
    `;
    const list = colEl.querySelector('.kanban-list');

    col.items.forEach((item, index) => {
      const reg = state.images[item.id];
      if (!reg) return;
      const itemEl = document.createElement('div');
      itemEl.className = 'kanban-item';
      itemEl.dataset.id = item.id;
      itemEl.innerHTML = `
        <div class="kanban-card">
          <div class="drag-surface">
            <img class="thumb" src="${reg.previewData || reg.originalData}" alt="preview" />
            <div class="card-main">
              <div class="card-title">${reg.type === 'text' ? '文字卡紙' : `圖片 ${index + 1}`}</div>
              <div class="card-sub">按住此區拖曳 · 長期跟手指移動</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="icon-btn toggle-gap ${item.noGapBelow ? 'active' : ''}" type="button" title="無縫貼齊"><i class="fa-solid fa-link"></i></button>
            <button class="icon-btn delete-item" type="button" title="刪除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
      itemEl.querySelector('.toggle-gap').addEventListener('click', () => {
        item.noGapBelow = !item.noGapBelow;
        render();
        scheduleSave();
      });
      itemEl.querySelector('.delete-item').addEventListener('click', () => {
        removeItem(item.id);
      });
      list.appendChild(itemEl);
    });

    els.board.appendChild(colEl);
  });
}

function removeItem(id) {
  state.columns.forEach(col => {
    col.items = col.items.filter(item => item.id !== id);
  });
  delete state.images[id];
  render();
  scheduleSave();
}

function onBoardPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target.closest('.icon-btn')) return;
  const surface = e.target.closest('.drag-surface');
  if (!surface) return;
  const itemEl = e.target.closest('.kanban-item');
  const listEl = e.target.closest('.kanban-list');
  if (!itemEl || !listEl) return;

  const rect = itemEl.getBoundingClientRect();
  drag.active = true;
  drag.pointerId = e.pointerId;
  drag.itemId = itemEl.dataset.id;
  drag.fromCol = Number(listEl.dataset.col);
  drag.fromIndex = Array.from(listEl.children).indexOf(itemEl);
  drag.offsetX = e.clientX - rect.left;
  drag.offsetY = e.clientY - rect.top;
  drag.currentList = listEl;
  drag.placeholder = createPlaceholder(itemEl);
  drag.overlay = createOverlay(itemEl);
  drag.suppressClick = true;

  itemEl.classList.add('dragging-source');
  itemEl.querySelector('.kanban-card')?.classList.add('drag-hidden');
  itemEl.after(drag.placeholder);
  updateOverlayPosition(e.clientX, e.clientY);
  document.body.classList.add('dragging');
  e.preventDefault();
}

function createPlaceholder(itemEl) {
  const ph = document.createElement('div');
  ph.className = 'drop-indicator';
  ph.style.height = `${Math.max(10, itemEl.getBoundingClientRect().height * 0.22)}px`;
  return ph;
}

function createOverlay(itemEl) {
  const overlay = document.createElement('div');
  overlay.className = 'drag-overlay';
  overlay.innerHTML = itemEl.innerHTML;
  els.dragLayer.innerHTML = '';
  els.dragLayer.appendChild(overlay);
  return overlay;
}

function updateOverlayPosition(clientX, clientY) {
  if (!drag.overlay) return;
  const x = clientX - drag.offsetX;
  const y = clientY - drag.offsetY;
  drag.overlay.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function onPointerMove(e) {
  if (!drag.active) return;
  e.preventDefault();
  updateOverlayPosition(e.clientX, e.clientY);

  const list = findTargetList(e.clientX, e.clientY) || drag.currentList;
  if (!list) return;
  drag.currentList = list;
  placePlaceholder(list, e.clientY);
}

function findTargetList(x, y) {
  const lists = Array.from(document.querySelectorAll('.kanban-list'));
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const direct = hit.closest('.kanban-list');
  if (direct) return direct;

  let best = null;
  let bestScore = Infinity;
  lists.forEach(list => {
    const r = list.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const score = Math.hypot(x - cx, y - cy);
    if (score < bestScore) {
      bestScore = score;
      best = list;
    }
  });
  return best;
}

function placePlaceholder(list, pointerY) {
  const items = Array.from(list.querySelectorAll('.kanban-item:not(.dragging-source)'));
  if (!items.length) {
    list.appendChild(drag.placeholder);
    return;
  }
  let inserted = false;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (pointerY < mid) {
      list.insertBefore(drag.placeholder, item);
      inserted = true;
      break;
    }
  }
  if (!inserted) list.appendChild(drag.placeholder);
}

function onPointerUp() {
  if (!drag.active) return;

  const sourceItemEl = document.querySelector(`.kanban-item[data-id="${CSS.escape(drag.itemId)}"]`);
  const toList = drag.placeholder?.parentElement;
  const toCol = toList ? Number(toList.dataset.col) : drag.fromCol;
  const toIndex = toList ? Array.from(toList.children).indexOf(drag.placeholder) : drag.fromIndex;

  if (sourceItemEl) {
    sourceItemEl.querySelector('.kanban-card')?.classList.remove('drag-hidden');
  }

  if (drag.placeholder && drag.placeholder.parentElement) {
    drag.placeholder.remove();
  }
  els.dragLayer.innerHTML = '';

  if (toCol >= 0 && drag.itemId) {
    moveItem(drag.itemId, drag.fromCol, drag.fromIndex, toCol, toIndex);
  }

  document.body.classList.remove('dragging');
  drag.active = false;
  drag.pointerId = null;
  drag.itemId = null;
  drag.fromCol = -1;
  drag.fromIndex = -1;
  drag.overlay = null;
  drag.placeholder = null;
  drag.currentList = null;

  render();
  scheduleSave();
}

function moveItem(itemId, fromCol, fromIndex, toCol, toIndex) {
  if (fromCol < 0 || toCol < 0) return;
  const fromItems = state.columns[fromCol]?.items;
  const toItems = state.columns[toCol]?.items;
  if (!fromItems || !toItems) return;

  const actualFromIndex = fromItems.findIndex(item => item.id === itemId);
  if (actualFromIndex < 0) return;
  const [moved] = fromItems.splice(actualFromIndex, 1);
  let insertIndex = Math.max(0, toIndex);
  if (fromCol === toCol && actualFromIndex < insertIndex) insertIndex -= 1;
  insertIndex = Math.min(insertIndex, toItems.length);
  toItems.splice(insertIndex, 0, moved);
}

function drawPreview() {
  const canvas = els.previewCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, A4_WIDTH, A4_HEIGHT);

  ctx.fillStyle = state.settings.outerBg;
  ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  const outer = 130;
  const inner = 36;
  const safeX = outer + inner;
  const safeY = outer + inner;
  const safeW = A4_WIDTH - (outer + inner) * 2;
  const safeH = A4_HEIGHT - (outer + inner) * 2;

  ctx.save();
  ctx.fillStyle = state.settings.innerBg;
  roundRect(ctx, outer, outer, A4_WIDTH - outer * 2, A4_HEIGHT - outer * 2, 30);
  ctx.fill();
  ctx.restore();

  const settings = { rowGap: effectiveRowGap(), colGap: effectiveColGap(), layoutMode: state.settings.layoutMode };
  if (settings.layoutMode === 'special_2_1') {
    drawSpecialLayout(ctx, settings, safeX, safeY, safeW, safeH);
  } else {
    drawStandardLayout(ctx, settings, safeX, safeY, safeW, safeH);
  }
}

function getImageInfo(id) {
  const img = state.images[id]?.img;
  if (!img) return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  return { img, w, h, ratio: h / w };
}

function measureColumnHeight(items, width, rowGap) {
  const blocks = createBlocks(items);
  return blocks.reduce((sum, block, blockIndex) => {
    const blockH = block.reduce((s, item) => {
      const info = getImageInfo(item.id);
      return s + (info ? width * info.ratio : 0);
    }, 0);
    return sum + blockH + (blockIndex < blocks.length - 1 ? rowGap : 0);
  }, 0);
}

function drawStandardLayout(ctx, settings, safeX, safeY, safeW, safeH) {
  const colCount = Math.max(1, state.columns.length);
  const baseGap = Math.min(settings.colGap, colCount > 1 ? safeW * 0.18 : 0);
  const baseWidth = colCount > 1 ? (safeW - baseGap * (colCount - 1)) / colCount : safeW;
  const heights = state.columns.map(col => measureColumnHeight(col.items, baseWidth, settings.rowGap));
  const maxHeight = Math.max(1, ...heights);
  const scale = Math.min(1, safeH / maxHeight);
  const drawWidth = baseWidth * scale;
  const drawGap = baseGap * scale;
  const drawRowGap = settings.rowGap * scale;
  const contentWidth = drawWidth * colCount + drawGap * (colCount - 1);
  const startX = safeX + (safeW - contentWidth) / 2;

  state.columns.forEach((col, c) => {
    let y = safeY;
    const colDrawHeight = heights[c] * scale;
    if (col.align === 'center') y = safeY + (safeH - colDrawHeight) / 2;
    if (col.align === 'bottom') y = safeY + (safeH - colDrawHeight);
    const x = startX + c * (drawWidth + drawGap);
    const blocks = createBlocks(col.items);
    blocks.forEach((block, blockIndex) => {
      block.forEach(item => {
        const info = getImageInfo(item.id);
        if (!info) return;
        const h = drawWidth * info.ratio;
        drawRoundedImage(ctx, info.img, x, y, drawWidth, h, item.noGapBelow ? 8 : 18);
        y += h;
      });
      if (blockIndex < blocks.length - 1) y += drawRowGap;
    });
  });
}

function drawSpecialLayout(ctx, settings, safeX, safeY, safeW, safeH) {
  const topGapBase = Math.min(settings.colGap, safeW * 0.1);
  const topWidthBase = (safeW - topGapBase) / 2;
  const bottomWidthBase = Math.min(safeW * 0.78, Math.max(topWidthBase * 1.18, topWidthBase * 1.34));

  const topHeights = [0,1].map(i => measureColumnHeight(state.columns[i]?.items || [], topWidthBase, settings.rowGap));
  const bottomHeight = measureColumnHeight(state.columns[2]?.items || [], bottomWidthBase, settings.rowGap);
  const totalHeight = Math.max(topHeights[0], topHeights[1], 0) + (bottomHeight > 0 ? settings.rowGap : 0) + bottomHeight;
  const scale = Math.min(1, safeH / Math.max(1, totalHeight));

  const topGap = topGapBase * scale;
  const topWidth = topWidthBase * scale;
  const bottomWidth = bottomWidthBase * scale;
  const rowGap = settings.rowGap * scale;
  const topSectionHeight = Math.max(topHeights[0], topHeights[1], 0) * scale;
  const topStartX = safeX + (safeW - (topWidth * 2 + topGap)) / 2;
  const topY = safeY + (safeH - totalHeight * scale) / 2;

  [0,1].forEach(i => {
    const col = state.columns[i] || { items: [], align: 'top' };
    let y = topY;
    const drawHeight = topHeights[i] * scale;
    if (col.align === 'center') y = topY + (topSectionHeight - drawHeight) / 2;
    if (col.align === 'bottom') y = topY + (topSectionHeight - drawHeight);
    const x = topStartX + i * (topWidth + topGap);
    const blocks = createBlocks(col.items);
    blocks.forEach((block, blockIndex) => {
      block.forEach(item => {
        const info = getImageInfo(item.id);
        if (!info) return;
        const h = topWidth * info.ratio;
        drawRoundedImage(ctx, info.img, x, y, topWidth, h, item.noGapBelow ? 8 : 18);
        y += h;
      });
      if (blockIndex < blocks.length - 1) y += rowGap;
    });
  });

  const bottomCol = state.columns[2] || { items: [] };
  let bottomY = topY + topSectionHeight;
  if (bottomHeight > 0) bottomY += rowGap;
  const bottomX = safeX + (safeW - bottomWidth) / 2;
  const bottomBlocks = createBlocks(bottomCol.items);
  bottomBlocks.forEach((block, blockIndex) => {
    block.forEach(item => {
      const info = getImageInfo(item.id);
      if (!info) return;
      const h = bottomWidth * info.ratio;
      drawRoundedImage(ctx, info.img, bottomX, bottomY, bottomWidth, h, item.noGapBelow ? 8 : 18);
      bottomY += h;
    });
    if (blockIndex < bottomBlocks.length - 1) bottomY += rowGap;
  });
}

function drawRoundedImage(ctx, img, x, y, w, h, radius = 18) {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function scheduleSave() {
  clearTimeout(state.autosaveTimer);
  updateSaveStatus('saving');
  state.autosaveTimer = setTimeout(saveWorkspace, 400);
}

function saveWorkspace() {
  try {
    const images = {};
    Object.entries(state.images).forEach(([id, item]) => {
      images[id] = {
        id,
        type: item.type,
        originalData: item.originalData,
        previewData: item.previewData,
      };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      settings: state.settings,
      columns: state.columns,
      images,
    }));
    updateSaveStatus('saved');
  } catch (err) {
    console.error(err);
    updateSaveStatus('error');
  }
}

async function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      updateSaveStatus('idle');
      return;
    }
    const parsed = JSON.parse(raw);
    Object.assign(state.settings, parsed.settings || {});
    syncControls();
    initColumns(state.settings.layoutMode || '3');
    state.columns = parsed.columns || state.columns;
    state.images = {};
    const entries = Object.entries(parsed.images || {});
    for (const [id, item] of entries) {
      const img = await loadImage(item.originalData);
      state.images[id] = { ...item, img };
    }
    ensureFilename();
    updateSaveStatus('saved');
  } catch (err) {
    console.error(err);
    updateSaveStatus('error');
  }
}

function updateSaveStatus(stateName) {
  els.saveDot.className = `dot ${stateName}`;
  els.saveText.textContent = stateName === 'saving' ? '儲存中…' : stateName === 'saved' ? '已自動儲存' : stateName === 'error' ? '存檔失敗' : '尚未存檔';
}

function resetAll() {
  const ok = window.confirm('確定要重設全部？');
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  state.images = {};
  state.settings = {
    layoutMode: '3',
    rowGapRaw: 12,
    colGapRaw: 14,
    outerBg: '#f8fafc',
    innerBg: '#ffffff',
    filename: '',
    isCustomFilename: false,
  };
  initColumns('3');
  ensureFilename();
  syncControls();
  render();
  updateSaveStatus('idle');
}

function downloadPNG() {
  drawPreview();
  els.previewCanvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(state.settings.filename || defaultFilename())}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
