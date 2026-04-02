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
  '#ffffff', '#f8fafc', '#f1f5f9', '#ecfeff', '#e0f2fe', '#dbeafe', '#eff6ff',
  '#f5f3ff', '#ede9fe', '#fdf4ff', '#fce7f3', '#ffe4e6', '#fff1f2', '#fff7ed',
  '#ffedd5', '#fef3c7', '#fefce8', '#f7fee7', '#ecfccb', '#f0fdf4', '#ecfdf5',
  '#111827', '#1f2937', '#334155'
];

const textState = {
  text: '',
  color: '#ffffff',
  fontSizeRatio: 7,
  wrapWidth: 680,
  x: 500,
  y: 700,
  alignH: 'center',
  actualWidth: 0,
  actualHeight: 0
};

const dragState = {
  active: false,
  action: null,
  startX: 0,
  startY: 0,
  startWrap: 680,
  startRatio: 7,
  startTextX: 0,
  startTextY: 0
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  buildSharedBgPalettes();
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
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.scrollTarget === visible.target.id);
    });
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

  ['globalBgColor','innerBgColor'].forEach(id => {
    els[id].addEventListener('input', () => {
      updateSwatchSelection(id, els[id].value);
      stateChanged();
    });
  });

  els.whiteBorderToggle.addEventListener('click', () => {
    const on = els.whiteBorderToggle.classList.contains('toggle-on');
    setWhiteBorder(!on);
    stateChanged();
  });

  els.openTextCardBtn.addEventListener('click', () => openModal(els.textCardModal));
  if (els.mobileTextCardBtn) els.mobileTextCardBtn.addEventListener('click', () => openModal(els.textCardModal));

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(document.getElementById(btn.dataset.close)));
  });

  ['textCardContent','textCardTextColor','textCardBgColor','textCardFontSize','textCardAlignH','textCardAlignV'].forEach(id => {
    els[id].addEventListener('input', drawTextCardPreview);
  });

  els.addTextCardBtn.addEventListener('click', addTextCardToBoard);
  els.resetBtn.addEventListener('click', clearAll);

  els.filenameInput.addEventListener('input', () => {
    currentFilename = sanitizeFilename(els.filenameInput.value.trim()) || defaultFilename();
    isCustomFilename = true;
    els.filenameInput.value = currentFilename;
    triggerAutoSave();
  });

  els.downloadBtn.addEventListener('click', downloadCanvas);
  if (els.mobileDownloadBtn) els.mobileDownloadBtn.addEventListener('click', downloadCanvas);

  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target.value = btn.dataset.color;
      updateSwatchSelection(btn.dataset.target, btn.dataset.color);
      stateChanged();
    });
  });

  ['imageTextContent','imageTextColor','imageTextSize','imageTextAlign'].forEach(id => {
    els[id].addEventListener('input', syncImageTextControls);
  });

  document.querySelectorAll('.quick-y-btn').forEach(btn => {
    btn.addEventListener('click', () => setQuickY(btn.dataset.quickY));
  });

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
      wrap.appendChild(btn);
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

function invertEffectiveRowGap(effective) {
  const value = Number(effective || 0);
  if (value <= 0) return 0;
  return Math.max(0, Math.round((value - 2) / 1.18));
}

function invertEffectiveColumnGap(effective) {
  const value = Number(effective || 0);
  if (value <= 0) return 0;
  return Math.max(0, Math.round((value - 4) / 1.2));
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

function getWhiteBorderEnabled() {
  return els.whiteBorderToggle.classList.contains('toggle-on');
}

function defaultFilename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `天父功課_${y}${m}${day}_(1)`;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
}

function refreshFilename() {
  if (!isCustomFilename) currentFilename = defaultFilename();
  els.filenameInput.value = currentFilename;
}

function initColumnsForLayout(layout, preserve = false) {
  const prevItems = preserve ? columnsState.flatMap(c => c.items) : [];
  const count = layout === 'special_2_1' ? 3 : Number(layout);
  const names = layout === 'special_2_1'
    ? ['左上方','右上方','下方置中']
    : Array.from({ length: count }, (_, i) => `第 ${i + 1} 欄`);

  const newCols = names.map(name => ({
    align: 'top',
    name,
    items: []
  }));

  prevItems.forEach((item, idx) => newCols[idx % newCols.length].items.push(item));
  columnsState = newCols;
}

async function handleImageUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  showLoading(true);

  try {
    for (const file of files) {
      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const originalData = await fileToDataURL(file);
      const previewData = await createPreview(originalData, 520, 0.94);
      const img = await loadImage(originalData);

      imageRegistry[id] = {
        img,
        previewData,
        originalData,
        type: 'image'
      };

      const targetCol = columnsState.reduce((a, b) => a.items.length <= b.items.length ? a : b);
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

  const colClass =
    columnsState.length === 1 ? 'xl:grid-cols-1' :
    columnsState.length === 2 ? 'xl:grid-cols-2' :
    'xl:grid-cols-3';

  els.kanbanBoard.className = `kanban-board grid grid-cols-1 md:grid-cols-2 ${colClass} gap-4`;
  els.kanbanBoard.style.setProperty('--kanban-col-gap', `${Math.max(8, Math.round(getEffectiveColumnGap(getColumnGapValue()) * 0.58))}px`);
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
            ${reg.type === 'image'
              ? `<button class="kanban-mini-icon edit-btn" data-id="${item.id}" title="加字"><i class="fa-solid fa-pen-nib"></i></button>`
              : `<div class="kanban-mini-spacer"></div>`}
            <button class="kanban-mini-icon is-danger delete-btn" data-id="${item.id}" title="刪除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
      list.appendChild(card);
    });

    const isMobileBoard = window.matchMedia('(max-width: 1023px)').matches;

    new Sortable(list, {
      group: 'kanban',
      animation: isMobileBoard ? 0 : 90,
      easing: isMobileBoard ? 'linear' : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      draggable: '.kanban-item',
      handle: '.kanban-drag-content',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 0,
      swapThreshold: isMobileBoard ? 0.34 : 0.44,
      invertSwap: false,
      direction: 'vertical',
      invertedSwapThreshold: isMobileBoard ? 0.68 : 0.76,
      delayOnTouchOnly: false,
      delay: 0,
      touchStartThreshold: 1,
      scroll: true,
      bubbleScroll: true,
      scrollSensitivity: isMobileBoard ? 80 : 120,
      scrollSpeed: isMobileBoard ? 16 : 20,
      emptyInsertThreshold: isMobileBoard ? 20 : 28,
      filter: '.kanban-card-actions button,.align-btn,button,input,textarea,select,label,a',
      preventOnFilter: false,
      setData: dataTransfer => dataTransfer.setData('text/plain', ''),
      onFilter: evt => evt.preventDefault(),
      removeCloneOnHide: true,
      onChoose: evt => handleSortChoose(evt),
      onUnchoose: () => clearDropIndicators(),
      onStart: evt => handleSortStart(evt),
      onMove: evt => handleSortMove(evt),
      onEnd: evt => handleSortEnd(evt)
    });
  });

  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.addEventListener('click', () => cycleAlign(Number(btn.dataset.col)));
  });

  document.querySelectorAll('.toggle-gap-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleNoGap(btn.dataset.id));
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteItem(btn.dataset.id));
  });

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openImageTextEditor(btn.dataset.id));
  });
}

function clearDropIndicators() {
  document.body.classList.remove('kanban-drag-active');
  document.querySelectorAll('.kanban-list').forEach(list => list.classList.remove('is-drop-target'));
  document.querySelectorAll('.kanban-item').forEach(item => item.classList.remove('drop-before', 'drop-after'));
}

function handleSortChoose(evt) {
  document.body.classList.add('kanban-drag-active', 'kanban-sort-lock', 'kanban-actually-dragging');
  evt.item.style.willChange = 'transform';
  evt.item.classList.add('is-lifted');
}

function handleSortStart(evt) {
  document.body.classList.add('kanban-drag-active', 'kanban-sort-lock', 'kanban-actually-dragging');
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
  document.body.classList.remove('kanban-sort-lock', 'kanban-actually-dragging');
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

function alignLabel(align) {
  return align === 'top' ? '靠上 ⬆️' : align === 'center' ? '置中 ↕️' : '靠下 ⬇️';
}

function cycleAlign(colIndex) {
  const seq = ['top', 'center', 'bottom'];
  const current = columnsState[colIndex].align;
  columnsState[colIndex].align = seq[(seq.indexOf(current) + 1) % seq.length];
  renderKanban();
  stateChanged();
}

function toggleNoGap(id) {
  for (const col of columnsState) {
    const item = col.items.find(x => x.id === id);
    if (item) {
      item.noGapBelow = !item.noGapBelow;
      break;
    }
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

  ctx.clearRect(0, 0, A4_WIDTH, A4_HEIGHT);

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
  return Math.max(0, Number(els.columnGap?.value || 24));
}

function drawBackgroundAndFrame(ctx, s) {
  ctx.fillStyle = s.globalBgColor;
  ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

  let margin = 90;
  const floral = [
    'editorial-luxe','botanical-atelier','artdeco-ornament','papercut-bloom',
    'watercolor-floral','spring-daisy','rose-garden','fresh-vine','ginkgo',
    'sakura','hydrangea','vintage-lace','geometric-arch','starry-night',
    'confetti-corners','bamboo-zen','ribbon-corners'
  ];

  if (floral.includes(s.frameStyle)) {
    margin = ['editorial-luxe','artdeco-ornament'].includes(s.frameStyle) ? 190 : 176;
    drawProceduralFrame(ctx, s.frameStyle, s.patternColor);

    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.12)';
    ctx.shadowBlur = 22;
    const inset = ['editorial-luxe','artdeco-ornament'].includes(s.frameStyle) ? 188 : 176;
    roundRect(ctx, inset, inset, A4_WIDTH - inset * 2, A4_HEIGHT - inset * 2, 26);
    ctx.fillStyle = s.innerBgColor;
    ctx.fill();
    ctx.restore();
  } else if (s.frameStyle === 'solid-white') {
    margin = 100;
    ctx.fillStyle = '#fff';
    ctx.fillRect(50, 50, A4_WIDTH - 100, A4_HEIGHT - 100);
  } else if (s.frameStyle === 'double') {
    margin = 110;
    ctx.strokeStyle = s.patternColor;
    ctx.lineWidth = 8;
    ctx.strokeRect(55, 55, A4_WIDTH - 110, A4_HEIGHT - 110);
    ctx.lineWidth = 2;
    ctx.strokeRect(90, 90, A4_WIDTH - 180, A4_HEIGHT - 180);
  } else if (s.frameStyle === 'elegant') {
    margin = 120;
    ctx.strokeStyle = s.patternColor;
    ctx.lineWidth = 4;
    roundRect(ctx, 70, 70, A4_WIDTH - 140, A4_HEIGHT - 140, 34);
    ctx.stroke();
    drawCornerFlourish(ctx, s.patternColor);
  }

  return margin;
}

function drawProceduralFrame(ctx, style, color) {
  const randoms = Array.from({ length: 18 }, (_, i) => i / 18);

  if (style === 'editorial-luxe') {
    drawEditorialLuxeFrame(ctx, color);
  } else if (style === 'botanical-atelier') {
    drawBotanicalAtelierFrame(ctx, color);
  } else if (style === 'artdeco-ornament') {
    drawArtDecoOrnamentFrame(ctx, color);
  } else if (style === 'papercut-bloom') {
    drawPaperCutBloomFrame(ctx, color);
  } else if (style === 'fresh-vine') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    for (let i = 0; i < 6; i++) {
      const y = 130 + i * 520;
      drawLeafVine(ctx, 70, y, 180, 180, color);
      drawLeafVine(ctx, A4_WIDTH - 70, y + 80, -180, 180, color);
    }
  } else if (style === 'ginkgo') {
    randoms.forEach((r, i) => drawGinkgo(ctx, 80 + (i % 3) * 60, 120 + i * 180, 70 + (i % 4) * 15, color));
    randoms.forEach((r, i) => drawGinkgo(ctx, A4_WIDTH - 100 - (i % 3) * 45, 140 + i * 180, 70 + (i % 4) * 12, color));
  } else if (style === 'sakura') {
    randoms.forEach((r, i) => drawFlowerDot(ctx, 130 + (i % 4) * 50, 120 + i * 170, 36, '#fda4af', color));
    randoms.forEach((r, i) => drawFlowerDot(ctx, A4_WIDTH - 130 - (i % 4) * 45, 150 + i * 165, 36, '#fecdd3', color));
  } else if (style === 'hydrangea') {
    drawCluster(ctx, 120, 130, 120, '#c4b5fd');
    drawCluster(ctx, A4_WIDTH - 120, 130, 120, '#ddd6fe');
    drawCluster(ctx, 120, A4_HEIGHT - 130, 120, '#c4b5fd');
    drawCluster(ctx, A4_WIDTH - 120, A4_HEIGHT - 130, 120, '#ddd6fe');
  } else if (style === 'rose-garden') {
    drawRose(ctx, 150, 150, 84, '#be123c');
    drawRose(ctx, A4_WIDTH - 150, 150, 84, '#be123c');
    drawRose(ctx, 150, A4_HEIGHT - 150, 84, '#be123c');
    drawRose(ctx, A4_WIDTH - 150, A4_HEIGHT - 150, 84, '#be123c');
  } else if (style === 'spring-daisy') {
    for (let i = 0; i < 12; i++) {
      drawDaisy(ctx, 120 + (i % 3) * 60, 120 + i * 260, 34);
      drawDaisy(ctx, A4_WIDTH - 120 - (i % 3) * 45, 180 + i * 240, 34);
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
      drawFlowerDot(ctx, 120 + (i % 4) * 45, 120 + i * 260, 40, '#f9a8d4', color);
      drawFlowerDot(ctx, A4_WIDTH - 120 - (i % 4) * 40, 180 + i * 245, 36, '#93c5fd', color);
    }
  }
}

function drawLeafVine(ctx, x, y, dx, dy, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + dx * 0.2, y + dy * 0.1, x + dx * 0.7, y + dy * 0.5, x + dx, y + dy);
  ctx.stroke();

  for (let i = 0; i < 6; i++) {
    const px = x + dx * (i / 5);
    const py = y + dy * (i / 5);
    ctx.fillStyle = 'rgba(34,197,94,.18)';
    ctx.beginPath();
    ctx.ellipse(px + 18, py - 8, 20, 10, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px - 18, py + 8, 20, 10, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawGinkgo(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.globalAlpha = .75;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * (i / 20);
    const r = s * (0.72 + 0.28 * Math.sin(a));
    ctx.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFlowerDot(ctx, x, y, r, fill, center) {
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 5; i++) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.fillStyle = fill;
    ctx.globalAlpha = .65;
    ctx.beginPath();
    ctx.ellipse(0, -r * .8, r * .35, r * .8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(0, 0, r * .22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCluster(ctx, x, y, spread, color) {
  for (let i = 0; i < 26; i++) {
    drawFlowerDot(ctx, x + Math.cos(i) * spread * .35 + (i % 5) * 10, y + Math.sin(i * 1.3) * spread * .35, 22, color, '#ffffff');
  }
}

function drawRose(ctx, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, size - (i * 10), i * .6, Math.PI * 2 - i * .4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDaisy(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 14; i++) {
    ctx.rotate((Math.PI * 2) / 14);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(0, -r, 8, 22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLaceFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = .8;
  roundRect(ctx, 84, 84, A4_WIDTH - 168, A4_HEIGHT - 168, 46);
  ctx.stroke();

  for (let x = 130; x <= A4_WIDTH - 130; x += 86) {
    drawScallop(ctx, x, 106, 18, false, color);
    drawScallop(ctx, x, A4_HEIGHT - 106, 18, true, color);
  }

  for (let y = 154; y <= A4_HEIGHT - 154; y += 86) {
    drawScallop(ctx, 106, y, 18, true, color, true);
    drawScallop(ctx, A4_WIDTH - 106, y, 18, false, color, true);
  }

  ctx.restore();
}

function drawScallop(ctx, x, y, r, invert, color, vertical = false) {
  ctx.save();
  ctx.strokeStyle