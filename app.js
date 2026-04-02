const A4_WIDTH = 2480;
const A4_HEIGHT = 3508;
const DB_NAME = 'A4CollageRebuildV1';
const DB_VERSION = 1;
const STORE_NAME = 'workspace';
const KEY = 'main';

const els = {};
let db = null;
let saveTimer = null;
let dragInfo = null;

const state = {
  settings: {
    layoutMode: '3',
    rowGapRaw: 16,
    colGapRaw: 24,
    outerBg: '#f7f4ed',
    innerBg: '#ffffff',
    frameStyle: 'gallery'
  },
  filename: defaultFilename(),
  columns: [],
  images: {}
};

document.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  bindEvents();
  initColumns('3');
  await initDB();
  await loadWorkspace();
  syncControlsFromState();
  renderBoard();
  drawPreview();
});

function cacheEls() {
  [
    'imageInput','filenameInput','layoutMode','rowGap','rowGapValue','colGap','colGapValue',
    'outerBg','innerBg','frameStyle','resetBtn','downloadBtn','boardColumns','previewCanvas','saveBadge'
  ].forEach(id => els[id] = document.getElementById(id));
}

function bindEvents() {
  els.imageInput.addEventListener('change', onUpload);
  els.filenameInput.addEventListener('input', () => {
    state.filename = sanitizeFilename(els.filenameInput.value.trim()) || defaultFilename();
    els.filenameInput.value = state.filename;
    queueSave();
  });
  els.layoutMode.addEventListener('change', () => {
    state.settings.layoutMode = els.layoutMode.value;
    initColumns(els.layoutMode.value, true);
    refreshAll();
  });
  els.rowGap.addEventListener('input', () => {
    state.settings.rowGapRaw = Number(els.rowGap.value || 0);
    updateGapLabels();
    refreshAll();
  });
  els.colGap.addEventListener('input', () => {
    state.settings.colGapRaw = Number(els.colGap.value || 0);
    updateGapLabels();
    refreshAll();
  });
  els.outerBg.addEventListener('input', () => { state.settings.outerBg = els.outerBg.value; refreshAll(); });
  els.innerBg.addEventListener('input', () => { state.settings.innerBg = els.innerBg.value; refreshAll(); });
  els.frameStyle.addEventListener('change', () => { state.settings.frameStyle = els.frameStyle.value; refreshAll(); });
  els.resetBtn.addEventListener('click', resetAll);
  els.downloadBtn.addEventListener('click', downloadPng);
}

function defaultFilename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `天父功課_${y}${m}${day}`;
}

function sanitizeFilename(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
}

function initColumns(layoutMode, preserve = false) {
  const oldItems = preserve ? state.columns.flatMap(c => c.items) : [];
  const count = layoutMode === 'special_2_1' ? 3 : Math.max(1, Number(layoutMode || 3));
  const names = layoutMode === 'special_2_1'
    ? ['左上', '右上', '下方']
    : Array.from({ length: count }, (_, i) => `第 ${i + 1} 欄`);

  state.columns = names.map(name => ({ name, align: 'top', items: [] }));
  oldItems.forEach((item, index) => {
    state.columns[index % state.columns.length].items.push(item);
  });
}

function getRowGap() {
  return Number(state.settings.rowGapRaw || 0);
}

function getColGap() {
  return Number(state.settings.colGapRaw || 0);
}

function updateGapLabels() {
  els.rowGapValue.textContent = `${getRowGap()} px`;
  els.colGapValue.textContent = `${getColGap()} px`;
}

function syncControlsFromState() {
  els.filenameInput.value = state.filename;
  els.layoutMode.value = state.settings.layoutMode;
  els.rowGap.value = state.settings.rowGapRaw;
  els.colGap.value = state.settings.colGapRaw;
  els.outerBg.value = state.settings.outerBg;
  els.innerBg.value = state.settings.innerBg;
  els.frameStyle.value = state.settings.frameStyle;
  updateGapLabels();
}

async function onUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  setSaveBadge('saving', '處理中…');
  try {
    for (const file of files) {
      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const originalData = await fileToDataURL(file);
      const previewData = await createPreviewData(originalData, 480, 0.92);
      const image = await loadImage(originalData);

      state.images[id] = {
        id,
        type: 'image',
        originalData,
        previewData,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      };

      getShortestColumn().items.push({ id, noGapBelow: false });
    }

    refreshAll();
    event.target.value = '';
  } catch (err) {
    console.error(err);
    setSaveBadge('error', '上傳失敗');
  }
}

function getShortestColumn() {
  return state.columns.reduce((a, b) => a.items.length <= b.items.length ? a : b);
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
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

async function createPreviewData(src, maxSize = 480, quality = 0.92) {
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

function renderBoard() {
  els.boardColumns.innerHTML = '';

  state.columns.forEach((column, colIndex) => {
    const colEl = document.createElement('section');
    colEl.className = 'board-col';
    colEl.innerHTML = `
      <div class="col-head">
        <h3>${column.name}</h3>
        <span>${column.items.length}</span>
      </div>
      <div class="col-list" data-col-index="${colIndex}"></div>
    `;

    const listEl = colEl.querySelector('.col-list');
    setupColumnDrop(listEl);

    column.items.forEach((item, itemIndex) => {
      const image = state.images[item.id];
      if (!image) return;
      const card = renderCard(image, item, colIndex, itemIndex);
      listEl.appendChild(card);
    });

    els.boardColumns.appendChild(colEl);
  });
}

function renderCard(image, item, colIndex, itemIndex) {
  const tpl = document.getElementById('cardTemplate');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;
  node.dataset.colIndex = colIndex;
  node.dataset.itemIndex = itemIndex;

  const thumb = node.querySelector('.thumb');
  thumb.src = image.previewData || image.originalData;

  node.querySelector('.card-title').textContent = `圖片 ${itemIndex + 1}`;
  node.querySelector('.card-meta').textContent = `${image.width} × ${image.height}`;

  const linkBtn = node.querySelector('.link-btn');
  if (item.noGapBelow) linkBtn.classList.add('active');
  linkBtn.addEventListener('click', () => {
    item.noGapBelow = !item.noGapBelow;
    refreshAll();
  });

  node.querySelector('.delete-btn').addEventListener('click', () => {
    deleteItem(item.id);
  });

  node.addEventListener('dragstart', e => {
    dragInfo = { id: item.id, fromCol: colIndex, fromIndex: itemIndex };
    node.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  });

  node.addEventListener('dragend', () => {
    dragInfo = null;
    node.classList.remove('dragging');
    document.querySelectorAll('.col-list').forEach(el => el.classList.remove('drag-over'));
  });

  return node;
}

function setupColumnDrop(listEl) {
  listEl.addEventListener('dragover', e => {
    e.preventDefault();
    listEl.classList.add('drag-over');
  });

  listEl.addEventListener('dragleave', () => {
    listEl.classList.remove('drag-over');
  });

  listEl.addEventListener('drop', e => {
    e.preventDefault();
    listEl.classList.remove('drag-over');
    if (!dragInfo) return;

    const toCol = Number(listEl.dataset.colIndex);
    const afterElement = getDragAfterElement(listEl, e.clientY);
    const toIndex = afterElement ? Number(afterElement.dataset.itemIndex) : state.columns[toCol].items.length;
    moveItem(dragInfo.fromCol, dragInfo.fromIndex, toCol, toIndex);
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.board-card:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function moveItem(fromCol, fromIndex, toCol, toIndex) {
  if (fromCol === toCol && fromIndex === toIndex) return;
  const [moved] = state.columns[fromCol].items.splice(fromIndex, 1);
  if (!moved) return;

  const adjustedIndex = fromCol === toCol && toIndex > fromIndex ? toIndex - 1 : toIndex;
  state.columns[toCol].items.splice(adjustedIndex, 0, moved);
  refreshAll();
}

function deleteItem(id) {
  state.columns.forEach(col => {
    col.items = col.items.filter(item => item.id !== id);
  });
  delete state.images[id];
  refreshAll();
}

function refreshAll() {
  renderBoard();
  drawPreview();
  queueSave();
}

function queueSave() {
  clearTimeout(saveTimer);
  setSaveBadge('saving', '儲存中…');
  saveTimer = setTimeout(saveWorkspace, 500);
}

function setSaveBadge(type, text) {
  els.saveBadge.className = `badge ${type}`;
  els.saveBadge.textContent = text;
}

function drawPreview() {
  const canvas = els.previewCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, A4_WIDTH, A4_HEIGHT);

  ctx.fillStyle = state.settings.outerBg;
  ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  const frameMargin = drawFrame(ctx, state.settings.frameStyle);
  const paperX = frameMargin;
  const paperY = frameMargin;
  const paperW = A4_WIDTH - frameMargin * 2;
  const paperH = A4_HEIGHT - frameMargin * 2;

  ctx.fillStyle = state.settings.innerBg;
  roundRect(ctx, paperX, paperY, paperW, paperH, 24);
  ctx.fill();

  const innerPad = 46;
  const safeX = paperX + innerPad;
  const safeY = paperY + innerPad;
  const safeW = paperW - innerPad * 2;
  const safeH = paperH - innerPad * 2;

  if (state.settings.layoutMode === 'special_2_1') {
    drawSpecialLayout(ctx, safeX, safeY, safeW, safeH);
  } else {
    drawStandardLayout(ctx, safeX, safeY, safeW, safeH);
  }
}

function drawFrame(ctx, style) {
  if (style === 'none') return 68;

  if (style === 'gallery') {
    const m = 82;
    ctx.save();
    ctx.strokeStyle = '#c7b58a';
    ctx.lineWidth = 6;
    roundRect(ctx, m, m, A4_WIDTH - m * 2, A4_HEIGHT - m * 2, 34);
    ctx.stroke();
    ctx.lineWidth = 2;
    roundRect(ctx, m + 24, m + 24, A4_WIDTH - (m + 24) * 2, A4_HEIGHT - (m + 24) * 2, 24);
    ctx.stroke();
    ctx.restore();
    return 104;
  }

  if (style === 'soft') {
    const m = 88;
    ctx.save();
    ctx.strokeStyle = '#d7dbe6';
    ctx.lineWidth = 10;
    roundRect(ctx, m, m, A4_WIDTH - m * 2, A4_HEIGHT - m * 2, 38);
    ctx.stroke();
    ctx.strokeStyle = '#f3e8ff';
    ctx.lineWidth = 4;
    roundRect(ctx, m + 26, m + 26, A4_WIDTH - (m + 26) * 2, A4_HEIGHT - (m + 26) * 2, 30);
    ctx.stroke();
    ctx.restore();
    return 112;
  }

  if (style === 'botanical') {
    const m = 104;
    ctx.save();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    roundRect(ctx, m, m, A4_WIDTH - m * 2, A4_HEIGHT - m * 2, 30);
    ctx.stroke();
    drawLeafCluster(ctx, m + 24, m + 24, '#86efac', '#4b5563', 1, 1);
    drawLeafCluster(ctx, A4_WIDTH - m - 24, m + 24, '#bfdbfe', '#4b5563', -1, 1);
    drawLeafCluster(ctx, m + 24, A4_HEIGHT - m - 24, '#fde68a', '#4b5563', 1, -1);
    drawLeafCluster(ctx, A4_WIDTH - m - 24, A4_HEIGHT - m - 24, '#f9a8d4', '#4b5563', -1, -1);
    ctx.restore();
    return 128;
  }

  if (style === 'deco') {
    const m = 92;
    ctx.save();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 4;
    roundRect(ctx, m, m, A4_WIDTH - m * 2, A4_HEIGHT - m * 2, 24);
    ctx.stroke();
    drawDecoCorner(ctx, m + 8, m + 8, '#64748b', 1, 1);
    drawDecoCorner(ctx, A4_WIDTH - m - 8, m + 8, '#64748b', -1, 1);
    drawDecoCorner(ctx, m + 8, A4_HEIGHT - m - 8, '#64748b', 1, -1);
    drawDecoCorner(ctx, A4_WIDTH - m - 8, A4_HEIGHT - m - 8, '#64748b', -1, -1);
    ctx.restore();
    return 118;
  }

  return 68;
}

function drawLeafCluster(ctx, x, y, fill, stroke, sx, sy) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  for (let i = 0; i < 4; i++) {
    const ox = i * 18;
    const oy = i * 14;
    ctx.fillStyle = fill;
    ctx.globalAlpha = .65;
    ctx.beginPath();
    ctx.ellipse(ox, oy, 28 - i * 2, 14 - i, -.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 58);
  ctx.quadraticCurveTo(0, 18, 58, 0);
  ctx.stroke();
  ctx.restore();
}

function drawDecoCorner(ctx, x, y, color, sx, sy) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.strokeStyle = color;
  [0, 16, 32, 48].forEach((o, idx) => {
    ctx.lineWidth = idx === 0 ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(0, 72 - o);
    ctx.lineTo(0, 0);
    ctx.lineTo(72 - o, 0);
    ctx.stroke();
  });
  ctx.restore();
}

function getImageData(id) {
  const image = state.images[id];
  if (!image) return null;
  return {
    ...image,
    ratio: image.height / image.width
  };
}

function drawStandardLayout(ctx, safeX, safeY, safeW, safeH) {
  const colCount = Math.max(1, state.columns.length);
  const baseColGap = Math.min(getColGap(), colCount > 1 ? safeW * 0.18 : 0);
  const baseColWidth = colCount > 1 ? (safeW - baseColGap * (colCount - 1)) / colCount : safeW;

  const columnHeights = state.columns.map(col => {
    const blocks = createBlocks(col.items);
    return blocks.reduce((sum, block, blockIndex) => {
      const blockHeight = block.reduce((h, item) => {
        const data = getImageData(item.id);
        return h + (data ? baseColWidth * data.ratio : 0);
      }, 0);
      return sum + blockHeight + (blockIndex < blocks.length - 1 ? getRowGap() : 0);
    }, 0);
  });

  const globalScale = Math.min(1, safeH / Math.max(1, ...columnHeights));
  const drawColWidth = baseColWidth * globalScale;
  const drawColGap = baseColGap * globalScale;
  const drawRowGap = getRowGap() * globalScale;
  const contentWidth = drawColWidth * colCount + drawColGap * (colCount - 1);
  const startX = safeX + (safeW - contentWidth) / 2;

  state.columns.forEach((col, colIndex) => {
    const x = startX + colIndex * (drawColWidth + drawColGap);
    const colHeight = columnHeights[colIndex] * globalScale;
    let y = safeY;
    if (col.align === 'center') y = safeY + (safeH - colHeight) / 2;
    if (col.align === 'bottom') y = safeY + (safeH - colHeight);

    const blocks = createBlocks(col.items);
    blocks.forEach((block, blockIndex) => {
      block.forEach(item => {
        const data = getImageData(item.id);
        if (!data) return;
        const h = drawColWidth * data.ratio;
        drawRoundedImage(ctx, data.originalData, x, y, drawColWidth, h, item.noGapBelow ? 8 : 18);
        y += h;
      });
      if (blockIndex < blocks.length - 1) y += drawRowGap;
    });
  });
}

function drawSpecialLayout(ctx, safeX, safeY, safeW, safeH) {
  const topGapBase = Math.min(getColGap(), safeW * 0.10);
  const topColBase = (safeW - topGapBase) / 2;
  const bottomWidthBase = Math.min(safeW * 0.78, Math.max(topColBase * 1.18, topColBase * 1.32));

  const topHeights = [0, 1].map(index => {
    const col = state.columns[index] || { items: [] };
    const blocks = createBlocks(col.items);
    return blocks.reduce((sum, block, blockIndex) => {
      const blockHeight = block.reduce((h, item) => {
        const data = getImageData(item.id);
        return h + (data ? topColBase * data.ratio : 0);
      }, 0);
      return sum + blockHeight + (blockIndex < blocks.length - 1 ? getRowGap() : 0);
    }, 0);
  });

  const bottomCol = state.columns[2] || { items: [] };
  const bottomBlocks = createBlocks(bottomCol.items);
  const bottomHeight = bottomBlocks.reduce((sum, block, blockIndex) => {
    const blockHeight = block.reduce((h, item) => {
      const data = getImageData(item.id);
      return h + (data ? bottomWidthBase * data.ratio : 0);
    }, 0);
    return sum + blockHeight + (blockIndex < bottomBlocks.length - 1 ? getRowGap() : 0);
  }, 0);

  const totalHeight = Math.max(...topHeights, 0) + (bottomHeight > 0 ? getRowGap() : 0) + bottomHeight;
  const scale = Math.min(1, safeH / Math.max(1, totalHeight));

  const topGap = topGapBase * scale;
  const topWidth = topColBase * scale;
  const bottomWidth = bottomWidthBase * scale;
  const rowGap = getRowGap() * scale;

  const topContentWidth = topWidth * 2 + topGap;
  const topStartX = safeX + (safeW - topContentWidth) / 2;
  const topStartY = safeY + (safeH - totalHeight * scale) / 2;
  const topSectionHeight = Math.max(...topHeights, 0) * scale;

  [0, 1].forEach(index => {
    const col = state.columns[index] || { items: [], align: 'top' };
    const colHeight = topHeights[index] * scale;
    const x = topStartX + index * (topWidth + topGap);
    let y = topStartY;
    if (col.align === 'center') y = topStartY + (topSectionHeight - colHeight) / 2;
    if (col.align === 'bottom') y = topStartY + (topSectionHeight - colHeight);

    const blocks = createBlocks(col.items);
    blocks.forEach((block, blockIndex) => {
      block.forEach(item => {
        const data = getImageData(item.id);
        if (!data) return;
        const h = topWidth * data.ratio;
        drawRoundedImage(ctx, data.originalData, x, y, topWidth, h, item.noGapBelow ? 8 : 18);
        y += h;
      });
      if (blockIndex < blocks.length - 1) y += rowGap;
    });
  });

  const bottomX = safeX + (safeW - bottomWidth) / 2;
  let bottomY = topStartY + topSectionHeight;
  if (bottomHeight > 0) bottomY += rowGap;

  bottomBlocks.forEach((block, blockIndex) => {
    block.forEach(item => {
      const data = getImageData(item.id);
      if (!data) return;
      const h = bottomWidth * data.ratio;
      drawRoundedImage(ctx, data.originalData, bottomX, bottomY, bottomWidth, h, item.noGapBelow ? 8 : 18);
      bottomY += h;
    });
    if (blockIndex < bottomBlocks.length - 1) bottomY += rowGap;
  });
}

function drawRoundedImage(ctx, src, x, y, w, h, radius = 18) {
  const img = new Image();
  img.src = src;
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

async function initDB() {
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putWorkspace(data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(data, KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getWorkspace() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function clearWorkspace() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function saveWorkspace() {
  try {
    const payload = {
      settings: structuredClone(state.settings),
      filename: state.filename,
      columns: structuredClone(state.columns),
      images: structuredClone(state.images)
    };
    await putWorkspace(payload);
    setSaveBadge('saved', '已自動儲存');
  } catch (err) {
    console.error(err);
    setSaveBadge('error', '存檔失敗');
  }
}

async function loadWorkspace() {
  try {
    const workspace = await getWorkspace();
    if (!workspace) {
      setSaveBadge('idle', '尚未存檔');
      return;
    }

    state.settings = {
      ...state.settings,
      ...(workspace.settings || {})
    };
    state.filename = workspace.filename || defaultFilename();
    state.columns = workspace.columns || state.columns;
    state.images = workspace.images || {};
    setSaveBadge('saved', '已載入存檔');
  } catch (err) {
    console.error(err);
    setSaveBadge('error', '載入失敗');
  }
}

async function resetAll() {
  const ok = window.confirm('確定重設全部？會清除本機自動儲存。');
  if (!ok) return;

  state.settings = {
    layoutMode: '3',
    rowGapRaw: 16,
    colGapRaw: 24,
    outerBg: '#f7f4ed',
    innerBg: '#ffffff',
    frameStyle: 'gallery'
  };
  state.filename = defaultFilename();
  state.images = {};
  initColumns('3');
  syncControlsFromState();
  renderBoard();
  drawPreview();
  await clearWorkspace();
  setSaveBadge('idle', '尚未存檔');
}

function downloadPng() {
  els.previewCanvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(state.filename || defaultFilename())}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }, 'image/png');
}
