const A4_WIDTH = 2480;
const A4_HEIGHT = 3508;
const DB_NAME = 'A4CollageDB';
const DB_VERSION = 2;
const STORE_NAME = 'workspace';
const WORKSPACE_KEY = 'workspace';

let db = null;
let imageRegistry = {};
let columnsState = [];
let currentFilename = '';
let isCustomFilename = false;
let autosaveTimer = null;
let isSaving = false;
let pendingSaveRequested = false;
let resetInProgress = false;
let rafPending = false;
let activeImageEditId = null;
let previewBaseImage = null;
let previewImageBitmap = null;

const SHARED_BG_PALETTE = [
  '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8',
  '#ecfeff', '#cffafe', '#a5f3fc', '#e0f2fe', '#bae6fd', '#7dd3fc',
  '#dbeafe', '#bfdbfe', '#93c5fd', '#eff6ff', '#dbeafe', '#60a5fa',
  '#eef2ff', '#e0e7ff', '#c7d2fe', '#f5f3ff', '#ede9fe', '#ddd6fe',
  '#faf5ff', '#f3e8ff', '#e9d5ff', '#fdf4ff', '#f5d0fe', '#f0abfc',
  '#fce7f3', '#fbcfe8', '#f9a8d4', '#ffe4e6', '#fecdd3', '#fda4af',
  '#fff7ed', '#ffedd5', '#fed7aa', '#fef3c7', '#fde68a', '#fcd34d',
  '#fefce8', '#fef9c3', '#fde047', '#f7fee7', '#d9f99d', '#bef264',
  '#f0fdf4', '#dcfce7', '#86efac', '#ecfdf5', '#a7f3d0', '#34d399',
  '#111827', '#1f2937', '#334155', '#475569', '#64748b', '#0f172a'
];

const textState = {
  text: '', color: '#ffffff', fontSizeRatio: 7, wrapWidth: 680,
  x: 500, y: 700, alignH: 'center', actualWidth: 0, actualHeight: 0
};
const dragState = { active: false, action: null, startX: 0, startY: 0, startWrap: 680, startRatio: 7, startTextX: 0, startTextY: 0 };

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  buildSharedBgPalettes();
  enforcePaletteRows();
  bindEvents();
  setupMobileUI();
  initColumnsForLayout('3');
  refreshFilename();
  updateSwatchSelection('globalBgColor', els.globalBgColor.value);
  updateSwatchSelection('innerBgColor', els.innerBgColor.value);
  syncSpacingControls();
  await initDB();
  await loadWorkspace();
  renderKanban();
  throttledDrawCanvas();
});

function cacheEls() {
  [
    'imageInput','openTextCardBtn','resetBtn','layoutMode','defaultGap','gapValue','columnGap','columnGapValue','frameStyle','globalBgColor','innerBgColor','patternColor',
    'whiteBorderToggle','whiteBorderText','kanbanBoard','saveDot','saveText','filenameInput','downloadBtn','loading','collageCanvas',
    'textCardModal','textCardPreview','textCardContent','textCardTextColor','textCardBgColor','textCardFontSize','textCardAlignH','textCardAlignV','addTextCardBtn',
    'imageTextModal','imageTextPreview','imageTextContent','imageTextColor','imageTextSize','imageTextAlign','applyImageTextBtn',
    'imageInputMobileProxy','mobileTextCardBtn','mobileDownloadBtn'
  ].forEach(id => els[id] = document.getElementById(id));
}


function setupMobileUI() {
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.scrollTarget);
      if (!target) return;
      document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.classList.toggle('is-active', btn.dataset.scrollTarget === visible.target.id));
  }, { threshold: [0.25, 0.55, 0.8] });

  ['controlsSection','boardSection','previewSection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

function bindEvents() {
  els.imageInput.addEventListener('change', handleImageUpload);
  if (els.imageInputMobileProxy) els.imageInputMobileProxy.addEventListener('change', handleImageUpload);
  els.layoutMode.addEventListener('change', () => {
    initColumnsForLayout(els.layoutMode.value, true);
    renderKanban();
    stateChanged();
  });
  ['input','change'].forEach(evtName => {
    els.defaultGap.addEventListener(evtName, syncSpacingControls);
    els.columnGap.addEventListener(evtName, syncSpacingControls);
  });
  ['frameStyle','patternColor'].forEach(id => els[id].addEventListener('input', stateChanged));
  ['globalBgColor','innerBgColor'].forEach(id => els[id].addEventListener('input', () => { updateSwatchSelection(id, els[id].value); stateChanged(); }));
  els.whiteBorderToggle.addEventListener('click', () => {
    const on = els.whiteBorderToggle.classList.contains('toggle-on');
    setWhiteBorder(!on);
    stateChanged();
  });
  els.openTextCardBtn.addEventListener('click', () => openModal(els.textCardModal));
  if (els.mobileTextCardBtn) els.mobileTextCardBtn.addEventListener('click', () => openModal(els.textCardModal));
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(document.getElementById(btn.dataset.close))));
  ['textCardContent','textCardTextColor','textCardBgColor','textCardFontSize','textCardAlignH','textCardAlignV'].forEach(id => els[id].addEventListener('input', drawTextCardPreview));
  els.addTextCardBtn.addEventListener('click', addTextCardToBoard);
  els.resetBtn.addEventListener('click', clearAll);
  els.filenameInput.addEventListener('input', () => { currentFilename = sanitizeFilename(els.filenameInput.value.trim()) || defaultFilename(); isCustomFilename = true; els.filenameInput.value = currentFilename; triggerAutoSave(); });
  els.downloadBtn.addEventListener('click', downloadCanvas);
  if (els.mobileDownloadBtn) els.mobileDownloadBtn.addEventListener('click', downloadCanvas);
  document.querySelectorAll('.swatch').forEach(btn => btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    target.value = btn.dataset.color;
    updateSwatchSelection(btn.dataset.target, btn.dataset.color);
    stateChanged();
  }));
  ['imageTextContent','imageTextColor','imageTextSize','imageTextAlign'].forEach(id => els[id].addEventListener('input', syncImageTextControls));
  document.querySelectorAll('.quick-y-btn').forEach(btn => btn.addEventListener('click', () => setQuickY(btn.dataset.quickY)));
  els.applyImageTextBtn.addEventListener('click', applyImageText);
  bindImageTextCanvas();
}

function buildSharedBgPalettes() {
  [['globalBgPalette','globalBgColor'], ['innerBgPalette','innerBgColor']].forEach(([wrapId, targetId]) => {
    const wrap = document.getElementById(wrapId);
    const input = document.getElementById(targetId);
    if (!wrap || !input) return;
    wrap.querySelectorAll('.swatch').forEach(el => el.remove());
    SHARED_BG_PALETTE.forEach(color => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.dataset.target = targetId;
      btn.dataset.color = color;
      btn.style.background = color;
      btn.setAttribute('aria-label', `${targetId}-${color}`);
      btn.title = color;
      wrap.appendChild(btn);
    });
  });
}


function enforcePaletteRows() {
  ['globalBgPalette','innerBgPalette','patternPalette'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'flex';
    el.style.flexWrap = 'nowrap';
    el.style.overflowX = 'auto';
    el.style.overflowY = 'hidden';
    el.style.whiteSpace = 'nowrap';
    el.style.alignItems = 'center';
    el.style.gap = '.7rem';
    el.style.maxWidth = '100%';
    el.style.paddingBottom = '.2rem';
    el.classList.add('palette-force-row');
    Array.from(el.children).forEach(child => {
      if (child.classList?.contains('swatch') || child.classList?.contains('color-picker')) {
        child.style.width = '3rem';
        child.style.height = '3rem';
        child.style.minWidth = '3rem';
        child.style.flex = '0 0 3rem';
      }
    });
  });
}

function updateSwatchSelection(targetId, value) {
  document.querySelectorAll(`.swatch[data-target="${targetId}"]`).forEach(btn => {
    const active = btn.dataset.color.toLowerCase() === String(value).toLowerCase();
    btn.classList.toggle('ring-2', active);
    btn.classList.toggle('ring-slate-300', active);
    btn.classList.toggle('scale-110', active);
  });
}

function getEffectiveRowGap(raw) {
  const gap = Math.max(0, Number(raw || 0));
  return gap === 0 ? 0 : Math.round(gap * 1.18 + 2);
}

function getEffectiveColumnGap(raw) {
  const gap = Math.max(0, Number(raw || 0));
  return gap === 0 ? 0 : Math.round(gap * 1.2 + 4);
}

function stateChanged() {
  throttledDrawCanvas();
  triggerAutoSave();
}

function syncSpacingControls() {
  const rowGap = getEffectiveRowGap(els.defaultGap.value);
  const colGap = getEffectiveColumnGap(els.columnGap.value);
  els.gapValue.textContent = `${rowGap} px`;
  els.columnGapValue.textContent = `${colGap} px`;
  renderKanban();
  throttledDrawCanvas();
  triggerAutoSave();
}


function setWhiteBorder(on) {
  els.whiteBorderToggle.className = on ? 'toggle-on' : 'toggle-off';
  els.whiteBorderText.textContent = on ? '開啟' : '關閉';
}
function getWhiteBorderEnabled() { return els.whiteBorderToggle.classList.contains('toggle-on'); }

function defaultFilename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `天父功課_${y}${m}${day}_(1)`;
}
function sanitizeFilename(name) { return name.replace(/[\\/:*?"<>|]/g,'').slice(0,80); }
function refreshFilename() {
  if (!isCustomFilename) currentFilename = defaultFilename();
  els.filenameInput.value = currentFilename;
}

function initColumnsForLayout(layout, preserve=false) {
  const prevItems = preserve ? columnsState.flatMap(c => c.items) : [];
  const count = layout === 'special_2_1' ? 3 : Number(layout);
  const names = layout === 'special_2_1' ? ['左上方','右上方','下方置中'] : Array.from({length: count}, (_,i) => `第 ${i+1} 欄`);
  const newCols = names.map(name => ({ align: 'top', name, items: [] }));
  prevItems.forEach((item, idx) => newCols[idx % newCols.length].items.push(item));
  columnsState = newCols;
}

async function handleImageUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  showLoading(true);
  try {
    for (const file of files) {
      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      const originalData = await fileToDataURL(file);
      const previewData = await createPreview(originalData, 520, 0.94);
      const img = await loadImage(originalData);
      imageRegistry[id] = { img, previewData, originalData, type: 'image' };
      const targetCol = columnsState.reduce((a,b) => a.items.length <= b.items.length ? a : b);
      targetCol.items.push({ id, noGapBelow: false });
    }
    renderKanban();
    stateChanged();
  } finally {
    showLoading(false);
    e.target.value = '';
  }
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

function renderKanban() {
  els.kanbanBoard.innerHTML = '';
  const colClass = columnsState.length === 1 ? 'xl:grid-cols-1' : columnsState.length === 2 ? 'xl:grid-cols-2' : 'xl:grid-cols-3';
  els.kanbanBoard.className = `kanban-board grid grid-cols-1 md:grid-cols-2 ${colClass} gap-0`;
  els.kanbanBoard.style.setProperty('--kanban-col-gap', '0px');
  els.kanbanBoard.style.setProperty('--kanban-row-gap', `${Math.max(8, Math.round(getEffectiveRowGap(els.defaultGap.value) * 0.5))}px`);

  columnsState.forEach((col, colIndex) => {
    const wrap = document.createElement('div');
    wrap.className = 'kanban-col';
    wrap.innerHTML = `
      <div class="kanban-col-head">
        <div class="kanban-col-title-row">
          <div class="kanban-col-title">${col.name}</div>
          <div class="kanban-col-count">${col.items.length}</div>
        </div>
        <button class="kanban-align-pill align-btn" data-col="${colIndex}">${alignLabel(col.align)}</button>
      </div>
      <div class="kanban-list" data-col="${colIndex}"></div>
    `;
    els.kanbanBoard.appendChild(wrap);

    const list = wrap.querySelector('.kanban-list');
    col.items.forEach((item, itemIndex) => {
      const reg = imageRegistry[item.id];
      if (!reg) return;
      const card = document.createElement('div');
      card.className = `kanban-item ${item.noGapBelow ? 'nogap' : ''}`;
      card.dataset.id = item.id;
      card.innerHTML = `
        <div class="kanban-card-frame">
          <button class="kanban-drag-handle" type="button" title="按住拖曳手柄可排序">
            <i class="fa-solid fa-grip-lines"></i>
          </button>
          <div class="kanban-drag-content">
            <div class="kanban-thumb-shell">
              <img class="kanban-thumb" src="${reg.previewData || reg.thumb || reg.originalData}" alt="thumb" loading="lazy" decoding="async">
            </div>
            <div class="kanban-card-main">
              <div class="kanban-chip-row">
                <span class="kanban-type-chip ${reg.type === 'textCard' ? 'is-text' : ''}">${reg.type === 'textCard' ? '文字卡' : '圖片'}</span>
                <span class="kanban-sub-chip">高清預覽</span>
              </div>
              <div class="kanban-item-title">${reg.type === 'textCard' ? '文字卡紙' : '圖片項目'}</div>
              <div class="kanban-item-sub">左右滑看板；按住縮圖與文字區上下拖移</div>
            </div>
          </div>
          <div class="kanban-card-actions">
            <div class="kanban-order-pill">${itemIndex + 1}</div>
            <button class="kanban-mini-icon ${item.noGapBelow ? 'is-active' : ''} toggle-gap-btn" data-id="${item.id}" title="${item.noGapBelow ? '已貼齊' : '無縫貼齊'}">
              <i class="fa-solid fa-link"></i>
            </button>
            ${reg.type === 'image' ? `<button class="kanban-mini-icon edit-btn" data-id="${item.id}" title="加字"><i class="fa-solid fa-pen-nib"></i></button>` : `<div class="kanban-mini-spacer"></div>`}
            <button class="kanban-mini-icon is-danger delete-btn" data-id="${item.id}" title="刪除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
      list.appendChild(card);
    });

    const isMobileBoard = window.matchMedia('(max-width: 1023px)').matches;
    // removed Sortable
  });

  document.querySelectorAll('.align-btn').forEach(btn => btn.addEventListener('click', () => cycleAlign(Number(btn.dataset.col))));
  document.querySelectorAll('.toggle-gap-btn').forEach(btn => btn.addEventListener('click', () => toggleNoGap(btn.dataset.id)));
  document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', () => deleteItem(btn.dataset.id)));
  document.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => openImageTextEditor(btn.dataset.id)));
}

function clearDropIndicators() {
  document.body.classList.remove('kanban-drag-active');
  document.querySelectorAll('.kanban-list').forEach(list => list.classList.remove('is-drop-target'));
  document.querySelectorAll('.kanban-item').forEach(item => item.classList.remove('drop-before','drop-after'));
}

function handleSortChoose(evt) {
  document.body.classList.add('kanban-drag-active','kanban-sort-lock','kanban-actually-dragging');
  evt.item.style.willChange = 'transform';
  evt.item.classList.add('is-lifted');
}

function handleSortStart(evt) {
  document.body.classList.add('kanban-drag-active','kanban-sort-lock','kanban-actually-dragging');
  evt.item.style.willChange = 'transform';
  evt.item.classList.add('is-lifted');
  const rect = evt.item.getBoundingClientRect();
  evt.item.style.width = `${Math.round(rect.width)}px`;
}

function handleSortMove(evt) {
  clearDropIndicators();
  document.body.classList.add('kanban-drag-active');
  if (evt.to) evt.to.classList.add('is-drop-target');
  const related = evt.related;
  if (related && related.classList?.contains('kanban-item')) {
    related.classList.add(evt.willInsertAfter ? 'drop-after' : 'drop-before');
  }
}

function handleSortEnd(evt) {
  clearDropIndicators();
  document.body.classList.remove('kanban-sort-lock','kanban-actually-dragging');
  evt.item?.classList.remove('is-lifted');
  evt.item?.style.removeProperty('width');
  evt.item?.style.removeProperty('will-change');
  const fromCol = Number(evt.from.dataset.col);
  const toCol = Number(evt.to.dataset.col);
  if (Number.isNaN(fromCol) || Number.isNaN(toCol) || evt.oldIndex == null || evt.newIndex == null) {
    renderKanban();
    return;
  }
  const [moved] = columnsState[fromCol].items.splice(evt.oldIndex, 1);
  if (!moved) {
    renderKanban();
    return;
  }
  columnsState[toCol].items.splice(evt.newIndex, 0, moved);
  renderKanban();
  stateChanged();
}
function alignLabel(align) { return align === 'top' ? '靠上 ⬆️' : align === 'center' ? '置中 ↕️' : '靠下 ⬇️'; }
function cycleAlign(colIndex) {
  const seq = ['top','center','bottom'];
  const current = columnsState[colIndex].align;
  columnsState[colIndex].align = seq[(seq.indexOf(current)+1) % seq.length];
  renderKanban();
  stateChanged();
}
function toggleNoGap(id) {
  for (const col of columnsState) {
    const item = col.items.find(x => x.id === id);
    if (item) { item.noGapBelow = !item.noGapBelow; break; }
  }
  renderKanban();
  stateChanged();
}
function deleteItem(id) {
  for (const col of columnsState) col.items = col.items.filter(item => item.id !== id);
  delete imageRegistry[id];
  renderKanban();
  stateChanged();
}

function throttledDrawCanvas() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    drawCanvas();
  });
}

function drawCanvas() {
  const canvas = els.collageCanvas;
  const ctx = canvas.getContext('2d');
  const settings = getSettings();
  ctx.clearRect(0,0,A4_WIDTH,A4_HEIGHT);
  const safeMargin = drawBackgroundAndFrame(ctx, settings);
  const outerPadding = 40;
  const safeX = safeMargin + outerPadding;
  const safeY = safeMargin + outerPadding;
  const safeW = A4_WIDTH - (safeMargin + outerPadding) * 2;
  const safeH = A4_HEIGHT - (safeMargin + outerPadding) * 2;

  if (settings.layoutMode === 'special_2_1') {
    drawSpecialLayout(ctx, settings, safeX, safeY, safeW, safeH);
  } else {
    drawStandardLayout(ctx, settings, safeX, safeY, safeW, safeH);
  }
}

function getSettings() {
  return {
    layoutMode: els.layoutMode.value,
    defaultGap: getEffectiveRowGap(els.defaultGap.value),
    columnGap: getEffectiveColumnGap(getColumnGapValue()),
    frameStyle: els.frameStyle.value,
    globalBgColor: els.globalBgColor.value,
    innerBgColor: els.innerBgColor.value,
    patternColor: els.patternColor.value,
    whiteBorderEnabled: getWhiteBorderEnabled()
  };
}


function getColumnGapValue() {
  return Math.max(0, Number(els.columnGap?.value || 12));
}

function drawBackgroundAndFrame(ctx, s) {
  ctx.fillStyle = s.globalBgColor;
  ctx.fillRect(0,0,A4_WIDTH,A4_HEIGHT);
  let margin = 90;
  const floral = ['editorial-luxe','botanical-atelier','artdeco-ornament','papercut-bloom','watercolor-floral','spring-daisy','rose-garden','fresh-vine','ginkgo','sakura','hydrangea','vintage-lace','geometric-arch','starry-night','confetti-corners','bamboo-zen','ribbon-corners'];
  if (floral.includes(s.frameStyle)) {
    margin = ['editorial-luxe','artdeco-ornament'].includes(s.frameStyle) ? 190 : 176;
    drawProceduralFrame(ctx, s.frameStyle, s.patternColor);
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.12)';
    ctx.shadowBlur = 22;
    const inset = ['editorial-luxe','artdeco-ornament'].includes(s.frameStyle) ? 188 : 176;
    roundRect(ctx, inset, inset, A4_WIDTH-inset*2, A4_HEIGHT-inset*2, 26);
    ctx.fillStyle = s.innerBgColor;
    ctx.fill();
    ctx.restore();
  } else if (s.frameStyle === 'solid-white') {
    margin = 100;
    ctx.fillStyle = '#fff';
    ctx.fillRect(50,50,A4_WIDTH-100,A4_HEIGHT-100);
  } else if (s.frameStyle === 'double') {
    margin = 110;
    ctx.strokeStyle = s.patternColor;
    ctx.lineWidth = 8;
    ctx.strokeRect(55,55,A4_WIDTH-110,A4_HEIGHT-110);
    ctx.lineWidth = 2;
    ctx.strokeRect(90,90,A4_WIDTH-180,A4_HEIGHT-180);
  } else if (s.frameStyle === 'elegant') {
    margin = 120;
    ctx.strokeStyle = s.patternColor;
    ctx.lineWidth = 4;
    roundRect(ctx, 70, 70, A4_WIDTH-140, A4_HEIGHT-140, 34); ctx.stroke();
    drawCornerFlourish(ctx, s.patternColor);
  }
  return margin;
}

function drawProceduralFrame(ctx, style, color) {
  const randoms = Array.from({length: 18}, (_,i) => i / 18);
  if (style === 'editorial-luxe') {
    drawEditorialLuxeFrame(ctx, color);
  } else if (style === 'botanical-atelier') {
    drawBotanicalAtelierFrame(ctx, color);
  } else if (style === 'artdeco-ornament') {
    drawArtDecoOrnamentFrame(ctx, color);
  } else if (style === 'papercut-bloom') {
    drawPaperCutBloomFrame(ctx, color);
  } else if (style === 'fresh-vine') {
    ctx.strokeStyle = color; ctx.lineWidth = 8;
    for (let i = 0; i < 6; i++) {
      const y = 130 + i * 520;
      drawLeafVine(ctx, 70, y, 180, 180, color);
      drawLeafVine(ctx, A4_WIDTH-70, y+80, -180, 180, color);
    }
  } else if (style === 'ginkgo') {
    randoms.forEach((r,i) => drawGinkgo(ctx, 80 + (i%3)*60, 120 + i*180, 70 + (i%4)*15, color));
    randoms.forEach((r,i) => drawGinkgo(ctx, A4_WIDTH-100 - (i%3)*45, 140 + i*180, 70 + (i%4)*12, color));
  } else if (style === 'sakura') {
    randoms.forEach((r,i) => drawFlowerDot(ctx, 130 + (i%4)*50, 120 + i*170, 36, '#fda4af', color));
    randoms.forEach((r,i) => drawFlowerDot(ctx, A4_WIDTH-130 - (i%4)*45, 150 + i*165, 36, '#fecdd3', color));
  } else if (style === 'hydrangea') {
    drawCluster(ctx, 120, 130, 120, '#c4b5fd');
    drawCluster(ctx, A4_WIDTH-120, 130, 120, '#ddd6fe');
    drawCluster(ctx, 120, A4_HEIGHT-130, 120, '#c4b5fd');
    drawCluster(ctx, A4_WIDTH-120, A4_HEIGHT-130, 120, '#ddd6fe');
  } else if (style === 'rose-garden') {
    drawRose(ctx, 150, 150, 84, '#be123c');
    drawRose(ctx, A4_WIDTH-150, 150, 84, '#be123c');
    drawRose(ctx, 150, A4_HEIGHT-150, 84, '#be123c');
    drawRose(ctx, A4_WIDTH-150, A4_HEIGHT-150, 84, '#be123c');
  } else if (style === 'spring-daisy') {
    for (let i = 0; i < 12; i++) {
      drawDaisy(ctx, 120 + (i%3)*60, 120 + i*260, 34);
      drawDaisy(ctx, A4_WIDTH-120 - (i%3)*45, 180 + i*240, 34);
    }
  } else if (style === 'vintage-lace') {
    drawLaceFrame(ctx, color);
  } else if (style === 'geometric-arch') {
    drawGeometricArchFrame(ctx, color);
  } else if (style === 'starry-night') {
    drawStarryFrame(ctx, color);
  } else if (style === 'confetti-corners') {
    drawConfettiCorners(ctx, color);
  } else if (style === 'bamboo-zen') {
    drawBambooFrame(ctx, color);
  } else if (style === 'ribbon-corners') {
    drawRibbonCorners(ctx, color);
  } else {
    for (let i = 0; i < 12; i++) {
      drawFlowerDot(ctx, 120 + (i%4)*45, 120 + i*260, 40, '#f9a8d4', color);
      drawFlowerDot(ctx, A4_WIDTH-120 - (i%4)*40, 180 + i*245, 36, '#93c5fd', color);
    }
  }
}

function drawLeafVine(ctx, x, y, dx, dy, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x,y); ctx.bezierCurveTo(x+dx*0.2,y+dy*0.1,x+dx*0.7,y+dy*0.5,x+dx,y+dy); ctx.stroke();
  for (let i=0;i<6;i++) {
    const px = x + dx * (i/5); const py = y + dy * (i/5);
    ctx.fillStyle = 'rgba(34,197,94,.18)';
    ctx.beginPath(); ctx.ellipse(px+18, py-8, 20, 10, Math.PI/4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(px-18, py+8, 20, 10, -Math.PI/4, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}
function drawGinkgo(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x,y); ctx.fillStyle = color; ctx.globalAlpha = .75; ctx.beginPath(); ctx.moveTo(0,0);
  for (let i=0;i<=20;i++){ const a = Math.PI*(i/20); const r = s*(0.72+0.28*Math.sin(a)); ctx.lineTo(Math.cos(a)*r, -Math.sin(a)*r); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawFlowerDot(ctx, x, y, r, fill, center) {
  ctx.save(); ctx.translate(x,y);
  for(let i=0;i<5;i++){ ctx.rotate((Math.PI*2)/5); ctx.fillStyle = fill; ctx.globalAlpha=.65; ctx.beginPath(); ctx.ellipse(0,-r*.8,r*.35,r*.8,0,0,Math.PI*2); ctx.fill(); }
  ctx.fillStyle = center; ctx.globalAlpha=1; ctx.beginPath(); ctx.arc(0,0,r*.22,0,Math.PI*2); ctx.fill(); ctx.restore();
}
function drawCluster(ctx, x, y, spread, color) { for(let i=0;i<26;i++) drawFlowerDot(ctx, x + Math.cos(i)*spread*.35 + (i%5)*10, y + Math.sin(i*1.3)*spread*.35, 22, color, '#ffffff'); }
function drawRose(ctx, x, y, size, color) { ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.lineWidth=7; for(let i=0;i<6;i++){ ctx.beginPath(); ctx.arc(0,0,size-(i*10),i*.6,Math.PI*2-i*.4); ctx.stroke(); } ctx.restore(); }
function drawDaisy(ctx, x, y, r) { ctx.save(); ctx.translate(x,y); for(let i=0;i<14;i++){ ctx.rotate((Math.PI*2)/14); ctx.fillStyle='#fff'; ctx.beginPath(); ctx.ellipse(0,-r,8,22,0,0,Math.PI*2); ctx.fill(); } ctx.fillStyle='#facc15'; ctx.beginPath(); ctx.arc(0,0,11,0,Math.PI*2); ctx.fill(); ctx.restore(); }

function drawLaceFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.globalAlpha = .8;
  roundRect(ctx, 84, 84, A4_WIDTH-168, A4_HEIGHT-168, 46); ctx.stroke();
  for (let x = 130; x <= A4_WIDTH-130; x += 86) {
    drawScallop(ctx, x, 106, 18, false, color);
    drawScallop(ctx, x, A4_HEIGHT-106, 18, true, color);
  }
  for (let y = 154; y <= A4_HEIGHT-154; y += 86) {
    drawScallop(ctx, 106, y, 18, true, color, true);
    drawScallop(ctx, A4_WIDTH-106, y, 18, false, color, true);
  }
  ctx.restore();
}
function drawScallop(ctx, x, y, r, invert, color, vertical=false) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath();
  if (vertical) ctx.arc(x, y, r, invert ? Math.PI/2 : -Math.PI/2, invert ? Math.PI*1.5 : Math.PI/2, invert);
  else ctx.arc(x, y, r, invert ? 0 : Math.PI, invert ? Math.PI : 0, invert);
  ctx.stroke(); ctx.restore();
}
function drawGeometricArchFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 7;
  roundRect(ctx, 86, 86, A4_WIDTH-172, A4_HEIGHT-172, 54); ctx.stroke();
  ctx.lineWidth = 3; ctx.globalAlpha = .65;
  for (let i=0;i<4;i++) {
    const inset = 132 + i*34;
    roundRect(ctx, inset, 126, A4_WIDTH-inset*2, A4_HEIGHT-252, 120); ctx.stroke();
  }
  ctx.restore();
}
function drawStarryFrame(ctx, color) {
  ctx.save();
  for (let i=0;i<120;i++) {
    const edge = i % 4;
    const base = 90 + (i*173 % (edge < 2 ? A4_WIDTH-180 : A4_HEIGHT-180));
    const x = edge === 0 ? base : edge === 1 ? base : (edge === 2 ? 92 : A4_WIDTH-92);
    const y = edge === 0 ? 92 : edge === 1 ? A4_HEIGHT-92 : base;
    drawStar(ctx, x, y, 8 + (i%3)*4, color, 0.55 + (i%4)*0.08);
  }
  ctx.restore();
}
function drawStar(ctx, x, y, r, color, alpha=1) {
  ctx.save(); ctx.translate(x,y); ctx.fillStyle = color; ctx.globalAlpha = alpha; ctx.beginPath();
  for (let i=0;i<10;i++) { const a = -Math.PI/2 + i*Math.PI/5; const rr = i%2===0 ? r : r*.42; const px = Math.cos(a)*rr; const py = Math.sin(a)*rr; i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawConfettiCorners(ctx, color) {
  const corners = [[110,110],[A4_WIDTH-110,110],[110,A4_HEIGHT-110],[A4_WIDTH-110,A4_HEIGHT-110]];
  corners.forEach(([cx,cy], cornerIdx) => {
    for (let i=0;i<44;i++) {
      const angle = (Math.PI/2) * (i/44) + (cornerIdx===1||cornerIdx===3?Math.PI/2:0) + (cornerIdx>=2?Math.PI:0);
      const dist = 26 + (i%6)*18;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      ctx.save(); ctx.translate(x,y); ctx.rotate(angle); ctx.fillStyle = i%3===0 ? color : (i%3===1 ? '#fb7185' : '#38bdf8'); ctx.globalAlpha = .72;
      ctx.fillRect(-8,-3,16,6); ctx.restore();
    }
  });
}
function drawBambooFrame(ctx, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.globalAlpha = .85;
  [98, A4_WIDTH-98].forEach(x => {
    ctx.beginPath(); ctx.moveTo(x, 120); ctx.lineTo(x, A4_HEIGHT-120); ctx.stroke();
    for (let y = 180; y < A4_HEIGHT-160; y += 210) {
      ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(x-8, y); ctx.lineTo(x+8, y); ctx.stroke(); ctx.lineWidth = 8;
      drawLeafVine(ctx, x, y+12, x < A4_WIDTH/2 ? 120 : -120, 86, color);
    }
  });
  ctx.restore();
}
function drawRibbonCorners(ctx, color) {
  [[110,110,1,1],[A4_WIDTH-110,110,-1,1],[110,A4_HEIGHT-110,1,-1],[A4_WIDTH-110,A4_HEIGHT-110,-1,-1]].forEach(([x,y,sx,sy]) => {
    ctx.save(); ctx.translate(x,y); ctx.scale(sx,sy); ctx.fillStyle = color; ctx.globalAlpha = .82;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(92,0); ctx.lineTo(58,36); ctx.lineTo(92,72); ctx.lineTo(0,72); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(0,12,76,10);
    ctx.restore();
  });
}


function drawEditorialLuxeFrame(ctx, color) {
  ctx.save();
  const c = hexToRgba(color, .92);
  ctx.strokeStyle = c;
  ctx.lineWidth = 4;
  roundRect(ctx, 78, 78, A4_WIDTH-156, A4_HEIGHT-156, 56); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.globalAlpha = .82;
  roundRect(ctx, 110, 110, A4_WIDTH-220, A4_HEIGHT-220, 42); ctx.stroke();
  roundRect(ctx, 142, 142, A4_WIDTH-284, A4_HEIGHT-284, 28); ctx.stroke();
  [[146,146,1,1],[A4_WIDTH-146,146,-1,1],[146,A4_HEIGHT-146,1,-1],[A4_WIDTH-146,A4_HEIGHT-146,-1,-1]].forEach(([x,y,sx,sy]) => {
    drawEditorialCorner(ctx, x, y, sx, sy, color);
  });
  drawEditorialMidline(ctx, A4_WIDTH/2, 104, false, color);
  drawEditorialMidline(ctx, A4_WIDTH/2, A4_HEIGHT-104, true, color);
  drawEditorialSideDots(ctx, color);
  ctx.restore();
}
function drawEditorialCorner(ctx, x, y, sx, sy, color) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(sx, sy);
  ctx.strokeStyle = color; ctx.fillStyle = hexToRgba(color, .14);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0,72); ctx.bezierCurveTo(0,24,24,0,72,0); ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(18,82); ctx.bezierCurveTo(18,36,36,18,82,18); ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(0,0,8,0,Math.PI*2); ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.moveTo(26,0); ctx.lineTo(54,0); ctx.moveTo(0,26); ctx.lineTo(0,54); ctx.stroke();
  ctx.restore();
}
function drawEditorialMidline(ctx, x, y, invert, color) {
  ctx.save(); ctx.translate(x, y); if (invert) ctx.rotate(Math.PI);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = .85;
  ctx.beginPath(); ctx.moveTo(-160,0); ctx.lineTo(-44,0); ctx.moveTo(44,0); ctx.lineTo(160,0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-28,0); ctx.bezierCurveTo(-18,-16,18,-16,28,0); ctx.bezierCurveTo(18,16,-18,16,-28,0); ctx.stroke();
  ctx.restore();
}
function drawEditorialSideDots(ctx, color) {
  ctx.save(); ctx.fillStyle = hexToRgba(color, .45);
  for (let i = 0; i < 12; i++) {
    const y = 230 + i * 255;
    ctx.beginPath(); ctx.arc(104, y, i % 3 === 0 ? 4 : 2.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(A4_WIDTH-104, y, i % 3 === 0 ? 4 : 2.5, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}
function drawBotanicalAtelierFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, .88); ctx.lineWidth = 2.5;
  roundRect(ctx, 104, 104, A4_WIDTH-208, A4_HEIGHT-208, 40); ctx.stroke();
  ctx.strokeStyle = hexToRgba(color, .38); ctx.lineWidth = 1.5;
  roundRect(ctx, 134, 134, A4_WIDTH-268, A4_HEIGHT-268, 28); ctx.stroke();
  [[160,160,1,1],[A4_WIDTH-160,160,-1,1],[160,A4_HEIGHT-160,1,-1],[A4_WIDTH-160,A4_HEIGHT-160,-1,-1]].forEach(([x,y,sx,sy], idx) => {
    drawBotanicalCornerCluster(ctx, x, y, sx, sy, idx % 2 === 0 ? '#86efac' : '#bfdbfe', color);
  });
  ctx.restore();
}
function drawBotanicalCornerCluster(ctx, x, y, sx, sy, leafFill, lineColor) {
  ctx.save(); ctx.translate(x,y); ctx.scale(sx,sy);
  for (let i = 0; i < 5; i++) {
    const ox = 18 + i*22; const oy = 10 + i*20;
    drawWaterLeaf(ctx, ox, oy, 34 - i*2, 16 - i, leafFill, lineColor, -0.45);
    drawWaterLeaf(ctx, oy, ox, 30 - i*2, 14 - i, '#fde68a', lineColor, 0.62);
  }
  ctx.strokeStyle = hexToRgba(lineColor, .68); ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(8,118); ctx.bezierCurveTo(12,62,48,24,116,8); ctx.stroke();
  ctx.restore();
}
function drawWaterLeaf(ctx, x, y, rx, ry, fill, stroke, rot) {
  ctx.save(); ctx.translate(x,y); ctx.rotate(rot);
  ctx.fillStyle = fill; ctx.globalAlpha = .72;
  ctx.beginPath(); ctx.ellipse(0,0,rx,ry,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = hexToRgba(stroke, .42); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-rx*0.7,0); ctx.quadraticCurveTo(0,-ry*0.3,rx*0.7,0); ctx.stroke();
  ctx.restore();
}
function drawArtDecoOrnamentFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 4;
  roundRect(ctx, 88, 88, A4_WIDTH-176, A4_HEIGHT-176, 30); ctx.stroke();
  ctx.lineWidth = 2;
  roundRect(ctx, 122, 122, A4_WIDTH-244, A4_HEIGHT-244, 18); ctx.stroke();
  [[128,128,1,1],[A4_WIDTH-128,128,-1,1],[128,A4_HEIGHT-128,1,-1],[A4_WIDTH-128,A4_HEIGHT-128,-1,-1]].forEach(([x,y,sx,sy]) => drawDecoCorner(ctx, x, y, sx, sy, color));
  drawDecoFan(ctx, A4_WIDTH/2, 116, color, false);
  drawDecoFan(ctx, A4_WIDTH/2, A4_HEIGHT-116, color, true);
  ctx.restore();
}
function drawDecoCorner(ctx, x, y, sx, sy, color) {
  ctx.save(); ctx.translate(x,y); ctx.scale(sx,sy);
  ctx.strokeStyle = color;
  [0,20,40,60].forEach((o, idx) => {
    ctx.lineWidth = idx === 0 ? 4 : 2;
    ctx.beginPath(); ctx.moveTo(0,84-o); ctx.lineTo(0,0); ctx.lineTo(84-o,0); ctx.stroke();
  });
  ctx.restore();
}
function drawDecoFan(ctx, x, y, color, invert) {
  ctx.save(); ctx.translate(x,y); if (invert) ctx.rotate(Math.PI); ctx.strokeStyle = color; ctx.lineWidth = 2.2;
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(i*30,36 + Math.abs(i)*5); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-132,0); ctx.lineTo(-48,0); ctx.moveTo(48,0); ctx.lineTo(132,0); ctx.stroke();
  ctx.restore();
}
function drawPaperCutBloomFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, .35); ctx.lineWidth = 2;
  roundRect(ctx, 108, 108, A4_WIDTH-216, A4_HEIGHT-216, 46); ctx.stroke();
  [[150,150,1,1],[A4_WIDTH-150,150,-1,1],[150,A4_HEIGHT-150,1,-1],[A4_WIDTH-150,A4_HEIGHT-150,-1,-1]].forEach(([x,y,sx,sy], idx) => {
    drawPaperCutCorner(ctx, x, y, sx, sy, idx % 2 ? '#f9a8d4' : '#93c5fd', color);
  });
  ctx.restore();
}
function drawPaperCutCorner(ctx, x, y, sx, sy, fill, line) {
  ctx.save(); ctx.translate(x,y); ctx.scale(sx,sy);
  const layers = [
    {r:96, alpha:.22, col:fill},
    {r:76, alpha:.28, col:'#fde68a'},
    {r:56, alpha:.34, col:fill},
    {r:38, alpha:.42, col:'#ffffff'}
  ];
  layers.forEach(({r, alpha, col}) => {
    ctx.fillStyle = col; ctx.globalAlpha = alpha;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0,0); ctx.quadraticCurveTo(r*.1, -r*.35, r, 0); ctx.quadraticCurveTo(r*.35, r*.1, 0, 0); ctx.fill();
      ctx.rotate(Math.PI/8);
    }
  });
  ctx.globalAlpha = .9; ctx.strokeStyle = hexToRgba(line, .4); ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0,104); ctx.quadraticCurveTo(0,32,104,0); ctx.stroke();
  ctx.restore();
}
function hexToRgba(hex, alpha=1) {
  const v = hex.replace('#','');
  const n = v.length === 3 ? v.split('').map(ch => ch + ch).join('') : v;
  const int = parseInt(n, 16);
  const r = (int >> 16) & 255; const g = (int >> 8) & 255; const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawCornerFlourish(ctx, color) { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3; [[100,100],[A4_WIDTH-100,100],[100,A4_HEIGHT-100],[A4_WIDTH-100,A4_HEIGHT-100]].forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,40,0,Math.PI*2);ctx.stroke();}); ctx.restore(); }

function createBlocks(items) {
  const blocks = [];
  let current = [];
  items.forEach((item, idx) => {
    current.push(item);
    if (!item.noGapBelow || idx === items.length - 1) {
      blocks.push(current);
      current = [];
    }
  });
  return blocks;
}

function getImageNaturalSize(itemId) {
  const img = imageRegistry[itemId]?.img;
  if (!img) return null;
  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;
  if (!width || !height) return null;
  return { img, width, height, ratio: height / width };
}

function measureBlock(block, colWidth, gap) {
  const metrics = [];
  let total = 0;
  block.forEach((item) => {
    const data = getImageNaturalSize(item.id);
    if (!data) return;
    const h = colWidth * data.ratio;
    metrics.push({ id: item.id, height: h });
    total += h;
  });
  return { metrics, totalHeight: total, bottomGap: gap };
}


function drawStandardLayout(ctx, settings, safeX, safeY, safeW, safeH) {
  const colCount = Math.max(1, columnsState.length);
  const requestedColGap = Math.max(0, Number(settings.columnGap ?? 18));
  const maxGap = colCount > 1 ? safeW * 0.24 : 0;
  const baseColGap = Math.min(requestedColGap, maxGap);
  const baseColWidth = colCount > 1 ? (safeW - baseColGap * (colCount - 1)) / colCount : safeW;

  const blockData = columnsState.map(col => {
    const blocks = createBlocks(col.items).map(b => measureBlock(b, baseColWidth, settings.defaultGap));
    const virtualHeight = blocks.reduce((sum, b, i) => sum + b.totalHeight + (i < blocks.length - 1 ? settings.defaultGap : 0), 0);
    return { blocks, virtualHeight };
  });

  const maxH = Math.max(1, ...blockData.map(b => b.virtualHeight));
  const scale = Math.min(1, safeH / maxH);
  const colWidth = baseColWidth * scale;
  const colGap = baseColGap * scale;
  const rowGap = settings.defaultGap * scale;
  const contentWidth = colWidth * colCount + colGap * (colCount - 1);
  const startX = safeX + (safeW - contentWidth) / 2;

  columnsState.forEach((col, cidx) => {
    const x = startX + cidx * (colWidth + colGap);
    const colH = blockData[cidx].virtualHeight * scale;
    let y = safeY;
    if (col.align === 'center') y = safeY + (safeH - colH) / 2;
    if (col.align === 'bottom') y = safeY + (safeH - colH);

    const blocks = createBlocks(col.items);
    blocks.forEach((block, blockIndex) => {
      const metric = measureBlock(block, baseColWidth, settings.defaultGap);
      const blockHeight = metric.totalHeight * scale;
      if (settings.whiteBorderEnabled && block.length) drawBlockBg(ctx, x, y, colWidth, blockHeight, scale);
      block.forEach((item) => {
        const data = getImageNaturalSize(item.id); if (!data) return;
        const h = colWidth * data.ratio;
        drawImageRounded(ctx, data.img, x, y, colWidth, h, item.noGapBelow ? 8 : 18);
        y += h;
      });
      if (blockIndex < blocks.length - 1) y += rowGap;
    });
  });
}

function drawSpecialLayout(ctx, settings, safeX, safeY, safeW, safeH) {
  const topLeft = columnsState[0] || { items: [], align: 'top' };
  const topRight = columnsState[1] || { items: [], align: 'top' };
  const bottomCol = columnsState[2] || { items: [], align: 'top' };

  const requestedGap = Math.max(0, Number(settings.columnGap ?? 12));
  const baseTopGap = Math.min(requestedGap, safeW * 0.06);
  const rowGap = Math.max(0, Number(settings.defaultGap || 0));

  // Strict 1:1 vertical split for 上2下1
  const topZoneHeight = safeH * 0.5;
  const bottomZoneHeight = safeH * 0.5;

  const nonEmptyTop = [topLeft.items.length > 0, topRight.items.length > 0].filter(Boolean).length;
  const soloTopMode = nonEmptyTop === 1;

  const tentativeTopColWidth = soloTopMode
    ? safeW * 0.72
    : Math.min((safeW - baseTopGap) / 2, safeW * 0.455);

  const measureColHeight = (items, width) => {
    const blocks = createBlocks(items).map(block => measureBlock(block, width, rowGap));
    const height = blocks.reduce((sum, b, i) => sum + b.totalHeight + (i < blocks.length - 1 ? rowGap : 0), 0);
    return { blocks, height };
  };

  const topLeftMeasured = measureColHeight(topLeft.items, tentativeTopColWidth);
  const topRightMeasured = measureColHeight(topRight.items, tentativeTopColWidth);
  const tallestTopHeight = Math.max(topLeftMeasured.height, topRightMeasured.height, 1);
  const topScale = Math.min(1, topZoneHeight / tallestTopHeight);
  const topColWidth = tentativeTopColWidth * topScale;
  const topGap = baseTopGap * topScale;

  const topContentWidth = soloTopMode ? topColWidth : (topColWidth * 2 + topGap);
  const topStartX = safeX + (safeW - topContentWidth) / 2;
  const topStartY = safeY;

  let bottomWidth = Math.min(safeW * 0.72, topColWidth * 1.08);
  const bottomMeasured0 = measureColHeight(bottomCol.items, bottomWidth);
  if (bottomMeasured0.height > bottomZoneHeight && bottomMeasured0.height > 0) {
    bottomWidth *= bottomZoneHeight / bottomMeasured0.height;
  }
  const bottomMeasured = measureColHeight(bottomCol.items, bottomWidth);
  const bottomContentHeight = Math.min(bottomZoneHeight, bottomMeasured.height);
  const bottomStartX = safeX + (safeW - bottomWidth) / 2;
  const bottomStartY = safeY + topZoneHeight;

  const drawBlocksScaled = (col, startX, startY, zoneHeight, drawWidth, scaleValue) => {
    const measured = measureColHeight(col.items, drawWidth / scaleValue);
    const contentHeight = measured.height * scaleValue;
    let y = startY;
    if (col.align === 'center') y = startY + (zoneHeight - contentHeight) / 2;
    if (col.align === 'bottom') y = startY + (zoneHeight - contentHeight);

    const blocks = createBlocks(col.items);
    blocks.forEach((block, blockIndex) => {
      const metric = measureBlock(block, drawWidth / scaleValue, rowGap);
      const blockHeight = metric.totalHeight * scaleValue;
      if (settings.whiteBorderEnabled && block.length) drawBlockBg(ctx, startX, y, drawWidth, blockHeight, scaleValue);
      block.forEach((item) => {
        const imgData = getImageNaturalSize(item.id);
        if (!imgData) return;
        const drawH = drawWidth * imgData.ratio;
        drawImageRounded(ctx, imgData.img, startX, y, drawWidth, drawH, item.noGapBelow ? 8 : 18);
        y += drawH;
      });
      if (blockIndex < blocks.length - 1) y += rowGap * scaleValue;
    });
  };

  if (topLeft.items.length) drawBlocksScaled(topLeft, topStartX, topStartY, topZoneHeight, topColWidth, topScale);
  if (topRight.items.length) {
    const x = soloTopMode ? topStartX : topStartX + topColWidth + topGap;
    drawBlocksScaled(topRight, x, topStartY, topZoneHeight, topColWidth, topScale);
  }

  if (bottomCol.items.length) {
    let y = bottomStartY + Math.max(0, (bottomZoneHeight - bottomContentHeight) / 2);
    const blocks = createBlocks(bottomCol.items);
    blocks.forEach((block, blockIndex) => {
      const metric = measureBlock(block, bottomWidth, rowGap);
      if (settings.whiteBorderEnabled && block.length) drawBlockBg(ctx, bottomStartX, y, bottomWidth, metric.totalHeight, 1);
      block.forEach((item) => {
        const imgData = getImageNaturalSize(item.id);
        if (!imgData) return;
        const drawH = bottomWidth * imgData.ratio;
        drawImageRounded(ctx, imgData.img, bottomStartX, y, bottomWidth, drawH, item.noGapBelow ? 8 : 18);
        y += drawH;
      });
      if (blockIndex < blocks.length - 1) y += rowGap;
    });
  }
}

function drawBlockBg(ctx, x, y, w, h, scale) {
  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,0.18)';
  ctx.shadowBlur = 18;
  roundRect(ctx, x - 14*scale, y - 14*scale, w + 28*scale, h + 28*scale, 28*scale);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}
function drawImageRounded(ctx, img, x, y, w, h, radius=18) {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath();
}

function openModal(el) { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

function drawMultiLineTextOnCanvas(ctx, text, x, y, maxWidth, lineHeight, alignH='center', alignV='center') {
  const words = text.split('\n');
  const lines = [];
  words.forEach(paragraph => {
    const tokens = paragraph.split('');
    let line = '';
    tokens.forEach(ch => {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = ch; }
      else line = test;
    });
    lines.push(line || ' ');
  });
  const totalHeight = lines.length * lineHeight;
  let startY = y;
  if (alignV === 'center') startY = y - totalHeight / 2 + lineHeight * .8;
  if (alignV === 'bottom') startY = y - totalHeight + lineHeight;
  lines.forEach((line, i) => {
    let tx = x;
    if (alignH === 'left') ctx.textAlign = 'left';
    if (alignH === 'center') ctx.textAlign = 'center';
    if (alignH === 'right') ctx.textAlign = 'right';
    ctx.fillText(line, tx, startY + i * lineHeight);
  });
  const widest = Math.max(...lines.map(line => ctx.measureText(line).width), 0);
  return { lines, width: widest, height: totalHeight };
}

function measureTextCardLayout() {
  const text = (els.textCardContent.value || ' ').trim() || ' ';
  const fontSize = Number(els.textCardFontSize.value);
  const lineHeight = fontSize * 1.45;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = `600 ${fontSize}px sans-serif`;
  const maxWidth = 760;
  const result = drawMultiLineTextOnCanvas(mctx, text, 0, 0, maxWidth, lineHeight, els.textCardAlignH.value, 'top');
  const paddingX = Math.max(80, fontSize * 1.2);
  const paddingY = Math.max(90, fontSize * 1.45);
  const width = Math.max(560, Math.min(1600, Math.ceil(result.width + paddingX * 2)));
  const height = Math.max(360, Math.min(2200, Math.ceil(result.height + paddingY * 2)));
  return { text, fontSize, lineHeight, width, height, paddingX, paddingY };
}

function drawTextCardPreview() {
  const canvas = els.textCardPreview;
  const ctx = canvas.getContext('2d');
  const layout = measureTextCardLayout();
  canvas.width = layout.width;
  canvas.height = layout.height;
  canvas.style.aspectRatio = `${layout.width} / ${layout.height}`;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = els.textCardBgColor.value;
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = els.textCardTextColor.value;
  ctx.font = `600 ${layout.fontSize}px sans-serif`;
  const anchorX = els.textCardAlignH.value === 'left' ? layout.paddingX : els.textCardAlignH.value === 'right' ? canvas.width - layout.paddingX : canvas.width / 2;
  const anchorY = els.textCardAlignV.value === 'top' ? layout.paddingY : els.textCardAlignV.value === 'bottom' ? canvas.height - layout.paddingY : canvas.height / 2;
  const result = drawMultiLineTextOnCanvas(ctx, layout.text, anchorX, anchorY, canvas.width - layout.paddingX * 2, layout.lineHeight, els.textCardAlignH.value, els.textCardAlignV.value);
  return { ...result, width: canvas.width, height: canvas.height };
}

async function addTextCardToBoard() {
  drawTextCardPreview();
  const id = `txt_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const originalData = els.textCardPreview.toDataURL('image/png');
  const previewData = await createPreview(originalData, 520, 0.96);
  const img = await loadImage(originalData);
  imageRegistry[id] = { img, previewData, originalData, type: 'textCard' };
  const targetCol = columnsState.reduce((a,b) => a.items.length <= b.items.length ? a : b);
  targetCol.items.push({ id, noGapBelow: false });
  closeModal(els.textCardModal);
  renderKanban();
  stateChanged();
}

async function openImageTextEditor(id) {
  activeImageEditId = id;
  const reg = imageRegistry[id];
  if (!reg) return;
  previewBaseImage = await loadImage(reg.originalData);
  const canvas = els.imageTextPreview;
  const ratio = previewBaseImage.height / previewBaseImage.width;
  canvas.width = 1000;
  canvas.height = Math.max(1000, Math.round(canvas.width * ratio));
  textState.text = '';
  textState.color = '#ffffff';
  textState.fontSizeRatio = 7;
  textState.wrapWidth = canvas.width * 0.68;
  textState.x = canvas.width / 2;
  textState.y = canvas.height * 0.82;
  textState.alignH = 'center';
  syncControlsFromTextState();
  drawImageTextPreview();
  openModal(els.imageTextModal);
}
function syncControlsFromTextState() {
  els.imageTextContent.value = textState.text;
  els.imageTextColor.value = textState.color;
  els.imageTextSize.value = textState.fontSizeRatio;
  els.imageTextAlign.value = textState.alignH;
}
function syncImageTextControls() {
  textState.text = els.imageTextContent.value;
  textState.color = els.imageTextColor.value;
  textState.fontSizeRatio = Number(els.imageTextSize.value);
  textState.alignH = els.imageTextAlign.value;
  drawImageTextPreview();
}
function setQuickY(mode) {
  const c = els.imageTextPreview;
  if (mode === 'top') textState.y = c.height * 0.18;
  if (mode === 'center') textState.y = c.height * 0.5;
  if (mode === 'bottom') textState.y = c.height * 0.82;
  drawImageTextPreview();
}

function drawImageTextPreview() {
  const c = els.imageTextPreview; const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  if (previewBaseImage) ctx.drawImage(previewBaseImage,0,0,c.width,c.height);
  ctx.save();
  const fontSize = Math.max(24, c.width * (textState.fontSizeRatio / 100));
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.fillStyle = textState.color;
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(2, fontSize*.05);
  const res = drawMultiLineTextOnCanvas(ctx, textState.text || ' ', textState.x, textState.y, textState.wrapWidth, fontSize*1.35, textState.alignH, 'center');
  textState.actualWidth = res.width; textState.actualHeight = res.height;
  const left = textState.alignH === 'center' ? textState.x - res.width/2 : textState.alignH === 'right' ? textState.x - res.width : textState.x;
  const top = textState.y - res.height/2;
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
  ctx.strokeRect(left-18, top-18, Math.max(100, res.width+36), res.height+36);
  [[left-18, top-18],[left+res.width+18, top-18],[left-18, top+res.height+18],[left+res.width+18, top+res.height+18],[left-18, top+res.height/2],[left+res.width+18, top+res.height/2]].forEach(([x,y]) => {
    ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2); ctx.fillStyle='#0f172a'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.stroke();
  });
  ctx.restore();
}

function getPointerOnPreview(evt) {
  const rect = els.imageTextPreview.getBoundingClientRect();
  const scaleX = els.imageTextPreview.width / rect.width;
  const scaleY = els.imageTextPreview.height / rect.height;
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function bindImageTextCanvas() {
  const canvas = els.imageTextPreview;
  const start = evt => {
    evt.preventDefault();
    const p = getPointerOnPreview(evt);
    const hit = hitTestTextBox(p.x,p.y);
    if (!hit) return;
    dragState.active = true; dragState.action = hit; dragState.startX = p.x; dragState.startY = p.y; dragState.startWrap = textState.wrapWidth; dragState.startRatio = textState.fontSizeRatio; dragState.startTextX = textState.x; dragState.startTextY = textState.y;
  };
  const move = evt => {
    if (!dragState.active) return;
    evt.preventDefault();
    const p = getPointerOnPreview(evt);
    const dx = p.x - dragState.startX; const dy = p.y - dragState.startY;
    if (dragState.action === 'move') {
      textState.x = dragState.startTextX + dx;
      textState.y = dragState.startTextY + dy;
    } else if (dragState.action === 'resize_r' || dragState.action === 'resize_l') {
      textState.wrapWidth = Math.max(160, dragState.startWrap + (dragState.action === 'resize_r' ? dx : -dx) * 2);
    } else {
      const scaleDelta = 1 + (Math.abs(dx) + Math.abs(dy)) / 500;
      const sign = (dx + dy) >= 0 ? 1 : -1;
      textState.fontSizeRatio = Math.min(18, Math.max(2, dragState.startRatio + sign * (scaleDelta - 1) * 8));
      textState.wrapWidth = Math.max(180, dragState.startWrap + sign * (scaleDelta - 1) * 180);
    }
    syncControlsFromTextState();
    drawImageTextPreview();
  };
  const end = () => { dragState.active = false; dragState.action = null; };
  canvas.addEventListener('mousedown', start); window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive:false }); window.addEventListener('touchmove', move, { passive:false }); window.addEventListener('touchend', end);
}

function hitTestTextBox(x,y) {
  const left = textState.alignH === 'center' ? textState.x - textState.actualWidth/2 : textState.alignH === 'right' ? textState.x - textState.actualWidth : textState.x;
  const top = textState.y - textState.actualHeight/2;
  const handles = {
    resize_tl:[left-18, top-18], resize_tr:[left+textState.actualWidth+18, top-18], resize_bl:[left-18, top+textState.actualHeight+18], resize_br:[left+textState.actualWidth+18, top+textState.actualHeight+18], resize_l:[left-18, top+textState.actualHeight/2], resize_r:[left+textState.actualWidth+18, top+textState.actualHeight/2]
  };
  for (const [action,[hx,hy]] of Object.entries(handles)) if (Math.hypot(x-hx,y-hy) <= 18) return action;
  if (x >= left-18 && x <= left+textState.actualWidth+18 && y >= top-18 && y <= top+textState.actualHeight+18) return 'move';
  return null;
}

async function applyImageText() {
  if (!activeImageEditId || !previewBaseImage) return;
  const bake = document.createElement('canvas');
  bake.width = previewBaseImage.width; bake.height = previewBaseImage.height;
  const ctx = bake.getContext('2d');
  ctx.drawImage(previewBaseImage, 0, 0);
  ctx.fillStyle = textState.color;
  const fontSize = Math.max(24, bake.width * (textState.fontSizeRatio / 100));
  ctx.font = `700 ${fontSize}px sans-serif`;
  drawMultiLineTextOnCanvas(ctx, textState.text || ' ', textState.x * (bake.width / els.imageTextPreview.width), textState.y * (bake.height / els.imageTextPreview.height), textState.wrapWidth * (bake.width / els.imageTextPreview.width), fontSize*1.35, textState.alignH, 'center');
  const originalData = bake.toDataURL('image/jpeg', 0.95);
  imageRegistry[activeImageEditId].originalData = originalData;
  imageRegistry[activeImageEditId].previewData = await createPreview(originalData, 520, 0.94);
  imageRegistry[activeImageEditId].img = await loadImage(originalData);
  closeModal(els.imageTextModal);
  renderKanban();
  stateChanged();
}

function showLoading(show) { els.loading.classList.toggle('hidden', !show); }
function updateSaveStatus(state) {
  const map = {
    idle:['bg-slate-300','尚未存檔'], saving:['bg-amber-400','儲存中…'], saved:['bg-emerald-500','已自動儲存'], error:['bg-rose-500','存檔失敗']
  };
  els.saveDot.className = `w-3 h-3 rounded-full inline-block ${map[state][0]}`;
  els.saveText.textContent = map[state][1];
}

async function initDB() {
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function putWorkspace(data) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE_NAME,'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(data, WORKSPACE_KEY);
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
}
function getWorkspace() {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE_NAME,'readonly');
    const req = tx.objectStore(STORE_NAME).get(WORKSPACE_KEY);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
function deleteWorkspace() {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE_NAME,'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(WORKSPACE_KEY);
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
}

function triggerAutoSave() {
  if (resetInProgress) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    if (isSaving) { pendingSaveRequested = true; return; }
    await saveWorkspace();
  }, 1000);
}

function buildWorkspacePayload() {
  const images = {};
  Object.entries(imageRegistry).forEach(([id, item]) => {
    images[id] = { previewData: item.previewData || item.thumb || item.originalData, originalData: item.originalData, type: item.type };
  });
  return {
    version: 3,
    savedAt: Date.now(),
    settings: {
      ...getSettings(),
      rawDefaultGap: Number(els.defaultGap?.value || 12),
      rawColumnGap: Number(els.columnGap?.value || 12),
      filename: currentFilename,
      isCustomFilename
    },
    columnsState: structuredClone(columnsState),
    images
  };
}

async function saveWorkspace() {
  if (resetInProgress) return;
  isSaving = true;
  updateSaveStatus('saving');
  try {
    await putWorkspace(buildWorkspacePayload());
    updateSaveStatus('saved');
  } catch (err) {
    console.error(err);
    updateSaveStatus('error');
  } finally {
    isSaving = false;
    if (pendingSaveRequested && !resetInProgress) { pendingSaveRequested = false; await saveWorkspace(); }
  }
}

async function loadWorkspace() {
  showLoading(true);
  try {
    const workspace = await getWorkspace();
    if (!workspace) { drawTextCardPreview(); updateSaveStatus('idle'); return; }
    els.layoutMode.value = workspace.settings?.layoutMode || '3';
    initColumnsForLayout(els.layoutMode.value);
    const rawDefaultGap = workspace.settings?.rawDefaultGap;
    const rawColumnGap = workspace.settings?.rawColumnGap;
    els.defaultGap.value = rawDefaultGap != null ? rawDefaultGap : 12;
    els.columnGap.value = rawColumnGap != null ? rawColumnGap : 12;
    syncSpacingControls();
    els.frameStyle.value = workspace.settings?.frameStyle || 'editorial-luxe';
    els.globalBgColor.value = workspace.settings?.globalBgColor || '#f8fafc';
    els.innerBgColor.value = workspace.settings?.innerBgColor || '#ffffff';
    els.patternColor.value = workspace.settings?.patternColor || '#c9a227';
    updateSwatchSelection('globalBgColor', els.globalBgColor.value);
    updateSwatchSelection('innerBgColor', els.innerBgColor.value);
    setWhiteBorder(Boolean(workspace.settings?.whiteBorderEnabled));
    currentFilename = workspace.settings?.filename || defaultFilename();
    isCustomFilename = Boolean(workspace.settings?.isCustomFilename);
    refreshFilename();

    columnsState = workspace.columnsState || columnsState;
    imageRegistry = {};
    const entries = Object.entries(workspace.images || {});
    await Promise.all(entries.map(async ([id, item]) => {
      imageRegistry[id] = { ...item, previewData: item.previewData || item.thumb || item.originalData, img: await loadImage(item.originalData) };
    }));
    enforcePaletteRows();
    drawTextCardPreview();
    updateSaveStatus('saved');
  } catch (err) {
    console.error(err);
    updateSaveStatus('error');
  } finally { showLoading(false); }
}

async function clearAll() {
  const ok = window.confirm('確定要重設全部？這會清除圖片、排版與本機自動儲存資料。');
  if (!ok) return;
  resetInProgress = true;
  clearTimeout(autosaveTimer);
  pendingSaveRequested = false;
  try {
    imageRegistry = {};
    isCustomFilename = false;
    currentFilename = defaultFilename();
    els.layoutMode.value = '3';
    initColumnsForLayout('3');
    els.defaultGap.value = 12; els.columnGap.value = 12; syncSpacingControls();
    els.frameStyle.value = 'editorial-luxe';
    els.globalBgColor.value = '#f8fafc';
    els.innerBgColor.value = '#ffffff';
    els.patternColor.value = '#c9a227';
    updateSwatchSelection('globalBgColor', els.globalBgColor.value);
    updateSwatchSelection('innerBgColor', els.innerBgColor.value);
    setWhiteBorder(false);
    els.textCardContent.value = '';
    els.textCardTextColor.value = '#0f172a';
    els.textCardBgColor.value = '#ffffff';
    els.textCardFontSize.value = 52;
    els.textCardAlignH.value = 'center';
    els.textCardAlignV.value = 'center';
    refreshFilename();
    await deleteWorkspace();
    drawTextCardPreview();
    renderKanban();
    throttledDrawCanvas();
    updateSaveStatus('idle');
  } catch (err) {
    console.error(err);
    updateSaveStatus('error');
  } finally {
    resetInProgress = false;
  }
}

function downloadCanvas() {
  els.collageCanvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${sanitizeFilename(currentFilename || defaultFilename())}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}


// ===== CUSTOM DRAG ENGINE v1.2 =====
const dragRuntime = {
  pointerId: null,
  sourceId: null,
  sourceCol: -1,
  sourceIndex: -1,
  active: false,
  overlay: null,
  placeholder: null,
  offsetX: 0,
  offsetY: 0,
  startX: 0,
  startY: 0,
  targetCol: -1,
  targetIndex: -1,
  moved: false
};

function isInteractiveTarget(el) {
  return !!el.closest('.kanban-card-actions, .align-btn, button, input, textarea, select, a, label');
}

function buildPlaceholder(cardRect) {
  const ph = document.createElement('div');
  ph.className = 'kanban-item kanban-placeholder';
  ph.style.height = `${Math.max(84, Math.round(cardRect.height))}px`;
  return ph;
}


function buildOverlay(card, rect) {
  const overlay = document.createElement('div');
  overlay.className = 'kanban-item kanban-drag-overlay';
  const thumbSrc = card.querySelector('.kanban-thumb')?.getAttribute('src') || '';
  const title = card.querySelector('.kanban-item-title')?.textContent?.trim() || '圖片項目';
  const sub = card.querySelector('.kanban-item-sub')?.textContent?.trim() || '';
  overlay.innerHTML = `
    <div class="kanban-card-frame">
      <div class="kanban-thumb-shell">${thumbSrc ? `<img class="kanban-thumb" src="${thumbSrc}" alt="thumb">` : ''}</div>
      <div class="kanban-card-main">
        <div class="kanban-item-title">${title}</div>
        <div class="kanban-item-sub">${sub}</div>
      </div>
    </div>
  `;
  overlay.style.position = 'fixed';
  overlay.style.left = '0px';
  overlay.style.top = '0px';
  overlay.style.width = `${Math.round(rect.width)}px`;
  overlay.style.maxWidth = `${Math.round(rect.width)}px`;
  overlay.style.overflow = 'hidden';
  overlay.style.borderRadius = '1.25rem';
  overlay.style.boxSizing = 'border-box';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '99999';
  overlay.style.margin = '0';
  overlay.style.opacity = '0.97';
  overlay.style.transform = 'translate3d(-9999px,-9999px,0)';
  return overlay;
}

function updateOverlayPosition(clientX, clientY) {
  if (!dragRuntime.overlay) return;
  const x = clientX - dragRuntime.offsetX;
  const y = clientY - dragRuntime.offsetY;
  dragRuntime.overlay.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function clearDragClasses() {
  document.body.classList.remove('kanban-drag-active', 'kanban-sort-lock', 'kanban-actually-dragging');
  document.querySelectorAll('.kanban-list').forEach(list => list.classList.remove('is-drop-target'));
  document.querySelectorAll('.kanban-item').forEach(item => item.classList.remove('drop-before', 'drop-after', 'is-drag-source'));
}

function findItemPositionById(id) {
  for (let c = 0; c < columnsState.length; c++) {
    const idx = columnsState[c].items.findIndex(item => item.id === id);
    if (idx !== -1) return { col: c, index: idx };
  }
  return { col: -1, index: -1 };
}

function getDropPosition(clientX, clientY) {
  const prevDisplay = dragRuntime.overlay ? dragRuntime.overlay.style.display : '';
  if (dragRuntime.overlay) dragRuntime.overlay.style.display = 'none';
  const target = document.elementFromPoint(clientX, clientY);
  if (dragRuntime.overlay) dragRuntime.overlay.style.display = prevDisplay;

  const list = target?.closest('.kanban-list');
  if (!list) return null;
  const col = Number(list.dataset.col);
  const items = Array.from(list.querySelectorAll('.kanban-item:not(.kanban-placeholder):not(.is-drag-source)'));

  let insertIndex = items.length;
  let related = null;
  let after = true;

  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (clientY < midY) {
      insertIndex = i;
      related = items[i];
      after = false;
      break;
    }
  }

  if (related == null && items.length) {
    related = items[items.length - 1];
    after = true;
  }

  return { list, col, insertIndex, related, after };
}

function movePlaceholder(pos) {
  if (!pos || !dragRuntime.placeholder) return;
  document.querySelectorAll('.kanban-list').forEach(list => list.classList.remove('is-drop-target'));
  document.querySelectorAll('.kanban-item').forEach(item => item.classList.remove('drop-before', 'drop-after'));
  pos.list.classList.add('is-drop-target');

  if (pos.related) {
    pos.related.classList.add(pos.after ? 'drop-after' : 'drop-before');
    pos.list.insertBefore(dragRuntime.placeholder, pos.after ? pos.related.nextSibling : pos.related);
  } else {
    pos.list.appendChild(dragRuntime.placeholder);
  }

  dragRuntime.targetCol = pos.col;
  dragRuntime.targetIndex = pos.insertIndex;
}

function onKanbanPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (isInteractiveTarget(e.target)) return;
  const handle = e.target.closest('.kanban-drag-content, .kanban-drag-handle');
  if (!handle) return;
  const card = e.target.closest('.kanban-item');
  if (!card) return;

  const id = card.dataset.id;
  const pos = findItemPositionById(id);
  if (pos.col === -1) return;

  const rect = card.getBoundingClientRect();
  dragRuntime.pointerId = e.pointerId;
  dragRuntime.sourceId = id;
  dragRuntime.sourceCol = pos.col;
  dragRuntime.sourceIndex = pos.index;
  dragRuntime.startX = e.clientX;
  dragRuntime.startY = e.clientY;
  dragRuntime.offsetX = e.clientX - rect.left;
  dragRuntime.offsetY = e.clientY - rect.top;
  dragRuntime.active = false;
  dragRuntime.moved = false;

  try { handle.setPointerCapture?.(e.pointerId); } catch {}
  document.addEventListener('pointermove', onKanbanPointerMove, { passive: false });
  document.addEventListener('pointerup', onKanbanPointerUp, { passive: false, once: false });
  document.addEventListener('pointercancel', onKanbanPointerUp, { passive: false, once: false });
}

function beginDrag(card, clientX, clientY) {
  const rect = card.getBoundingClientRect();
  dragRuntime.active = true;
  dragRuntime.overlay = buildOverlay(card, rect);
  dragRuntime.placeholder = buildPlaceholder(rect);
  card.classList.add('is-drag-source');
  card.style.visibility = 'hidden';
  document.body.appendChild(dragRuntime.overlay);
  card.parentElement?.insertBefore(dragRuntime.placeholder, card.nextSibling);
  document.body.classList.add('kanban-drag-active', 'kanban-sort-lock', 'kanban-actually-dragging');
  updateOverlayPosition(clientX, clientY);
}

function onKanbanPointerMove(e) {
  if (e.pointerId !== dragRuntime.pointerId) return;
  const sourceCard = document.querySelector(`.kanban-item[data-id="${dragRuntime.sourceId}"]`);
  if (!sourceCard) return;
  const dx = e.clientX - dragRuntime.startX;
  const dy = e.clientY - dragRuntime.startY;
  const dist = Math.hypot(dx, dy);

  if (!dragRuntime.active) {
    if (dist < 4) return;
    e.preventDefault();
    beginDrag(sourceCard, e.clientX, e.clientY);
  } else {
    e.preventDefault();
  }

  dragRuntime.moved = true;
  updateOverlayPosition(e.clientX, e.clientY);
  const pos = getDropPosition(e.clientX, e.clientY);
  if (pos) movePlaceholder(pos);
}

function finalizeDrag() {
  const { sourceId, sourceCol, sourceIndex, targetCol, targetIndex } = dragRuntime;
  if (sourceId == null) return;

  if (targetCol !== -1 && sourceCol !== -1 && targetIndex !== -1) {
    const [moved] = columnsState[sourceCol].items.splice(sourceIndex, 1);
    if (moved) {
      let insertIndex = targetIndex;
      if (sourceCol === targetCol && sourceIndex < targetIndex) insertIndex -= 1;
      insertIndex = Math.max(0, Math.min(insertIndex, columnsState[targetCol].items.length));
      columnsState[targetCol].items.splice(insertIndex, 0, moved);
    }
  }
}

function resetDragRuntime() {
  const prevSourceId = dragRuntime.sourceId;
  dragRuntime.pointerId = null;
  dragRuntime.sourceId = null;
  dragRuntime.sourceCol = -1;
  dragRuntime.sourceIndex = -1;
  dragRuntime.targetCol = -1;
  dragRuntime.targetIndex = -1;
  dragRuntime.active = false;
  dragRuntime.moved = false;
  dragRuntime.overlay?.remove();
  dragRuntime.placeholder?.remove();
  dragRuntime.overlay = null;
  dragRuntime.placeholder = null;
  const src = prevSourceId ? document.querySelector(`.kanban-item[data-id="${prevSourceId}"]`) : null;
  if (src) src.style.visibility = '';
  clearDragClasses();
}

function onKanbanPointerUp(e) {
  if (dragRuntime.pointerId !== null && e.pointerId !== dragRuntime.pointerId) return;
  document.removeEventListener('pointermove', onKanbanPointerMove);
  document.removeEventListener('pointerup', onKanbanPointerUp);
  document.removeEventListener('pointercancel', onKanbanPointerUp);

  if (dragRuntime.active && dragRuntime.moved) {
    finalizeDrag();
    resetDragRuntime();
    renderKanban();
    stateChanged();
  } else {
    resetDragRuntime();
  }
}

document.addEventListener('pointerdown', onKanbanPointerDown, { passive: true });
// ===== END CUSTOM DRAG ENGINE v1.2 =====
