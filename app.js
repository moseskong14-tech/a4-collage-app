const FRAME_ASSET_MAP = window.FRAME_ASSET_MAP || {};
const APP_BUILD = 'v0.11.0 · 20260830-output-spacing-offline';
const A4_WIDTH = 2480;
const A4_HEIGHT = 3508;
const DEFAULT_AUTHOR_NAME = 'Maggie Fung';
const DEFAULT_ROW_GAP_RAW = 20;
const DEFAULT_COLUMN_GAP_RAW = 20;
const DEFAULT_FRAME_STYLE = 'none';
const DEFAULT_IMAGE_BORDER_STYLE = 'none';
const DB_NAME = 'A4CollageDB';
const DB_VERSION = 2;
const STORE_NAME = 'workspace';
const WORKSPACE_KEY = 'workspace';
const HISTORY_LIMIT = 20;

window.__A4_APP_BUILD__ = APP_BUILD;

let db = null;
let persistenceAvailable = true;
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
let activeWidthRatioItemId = null;
let previewBaseImage = null;
let lastHistoryTouchActionAt = 0;
let lastWidthRatioTouchAt = 0;
const historyState = {
  past: [],
  future: [],
  applying: false
};
let pendingControlHistorySnapshots = new WeakMap();

const frameAssetCache = {};
function createDefaultItemMeta() {
  return {
    groupId: null,
    lockSameWidth: false,
    lockSameHeight: false,
    fixedGap: null,
    widthRatio: 1.0,
    pinned: false,
    weight: 1.0,
    minWidth: null,
    maxWidth: null
  };
}

function normalizeItem(item) {
  const normalized = { ...createDefaultItemMeta(), ...item };
  normalized.noGapBelow = item?.noGapBelow === true;
  normalized.fixedGap = normalized.noGapBelow ? 0 : null;
  return normalized;
}

function normalizeColumnsState(rawColumnsState) {
  return (rawColumnsState || []).map((col, colIndex) => {
    const items = col.items || [];
    let groupCounter = 0;
    let currentGroupId = null;

    const convertedItems = items.map((item, idx) => {
      const prevItem = items[idx - 1];
      const inGroup = item.noGapBelow === true || prevItem?.noGapBelow === true;

      if (inGroup && !item.groupId) {
        if (!currentGroupId) {
          currentGroupId = `__migrated_group_${colIndex}_${groupCounter++}`;
        }
        const converted = normalizeItem({
          ...createDefaultItemMeta(),
          ...item,
          groupId: currentGroupId,
          fixedGap: item.noGapBelow ? 0 : null
        });
        if (!item.noGapBelow) currentGroupId = null;
        return converted;
      }

      currentGroupId = null;
      return normalizeItem(item);
    });

    return { ...col, items: convertedItems };
  });
}

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
  if (els.appVersionBadge) {
    els.appVersionBadge.textContent = APP_BUILD;
    els.appVersionBadge.title = `目前載入版本：${APP_BUILD}`;
  }
  document.documentElement.dataset.a4Build = APP_BUILD;
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
  setupOfflineMode();
  updateHistoryControls();
  renderKanban();
  throttledDrawCanvas();
});

function cacheEls() {
  [
    'appVersionBadge','offlineModeBadge','updateAppBtn','imageInput','openTextCardBtn','resetBtn','layoutMode','spacingMode','defaultGap','gapValue','columnGap','columnGapValue','beautifyBtn','authorName','frameStyle','imageBorderStyle','globalBgColor','innerBgColor','patternColor',
    'kanbanBoard','saveDot','saveText','filenameInput','outputFormat','downloadBtn','loading','collageCanvas',
    'textCardModal','textCardPreview','textCardContent','textCardTextColor','textCardBgColor','textCardFontSize','textCardAlignH','textCardAlignV','addTextCardBtn',
    'imageTextModal','imageTextPreview','imageTextContent','imageTextColor','imageTextSize','imageTextAlign','applyImageTextBtn',
    'widthRatioModal','widthRatioInput','confirmWidthRatioBtn','cancelWidthRatioBtn','closeWidthRatioModalBtn',
    'imageInputMobileProxy','mobileTextCardBtn','mobileDownloadBtn','autoBalanceBtn','sampleColorBtn','undoBtn','redoBtn'
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
  trackControlHistoryStart(els.layoutMode);
  els.layoutMode.addEventListener('change', () => {
    pushPendingControlHistory(els.layoutMode);
    initColumnsForLayout(els.layoutMode.value, true);
    renderKanban();
    stateChanged();
  });
  [els.defaultGap, els.columnGap].forEach(input => {
    trackControlHistoryStart(input);
    input.addEventListener('input', () => {
      if (els.spacingMode) els.spacingMode.value = 'custom';
      syncSpacingControls({ requestRender: true });
    });
    input.addEventListener('change', () => {
      pushPendingControlHistory(input);
      if (els.spacingMode) els.spacingMode.value = 'custom';
      syncSpacingControls({ requestRender: true, requestSave: true });
    });
  });
  els.kanbanBoard.addEventListener('click', onKanbanBoardClick);
  els.kanbanBoard.addEventListener(
    'pointerup',
    onKanbanBoardPointerUp,
    { passive: false }
  );
  els.kanbanBoard.addEventListener('pointerdown', onKanbanPointerDown, { passive: true });
  document.addEventListener('keydown', onKanbanKeyDown);
  window.addEventListener('blur', cancelKanbanDrag);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelKanbanDrag();
  });
  if (els.spacingMode) {
    trackControlHistoryStart(els.spacingMode);
    els.spacingMode.addEventListener('change', () => {
      pushPendingControlHistory(els.spacingMode);
      applySpacingMode(els.spacingMode.value, true);
    });
  }
  if (els.authorName) {
    trackControlHistoryStart(els.authorName);
    els.authorName.addEventListener('input', triggerAutoSave);
    els.authorName.addEventListener('change', () => pushPendingControlHistory(els.authorName));
    els.authorName.addEventListener('blur', () => pushPendingControlHistory(els.authorName, false));
  }
  ['frameStyle','patternColor','imageBorderStyle'].forEach(id => {
    trackControlHistoryStart(els[id]);
    els[id].addEventListener('input', stateChanged);
    els[id].addEventListener('change', () => {
      pushPendingControlHistory(els[id]);
      stateChanged();
    });
  });
  ['globalBgColor','innerBgColor'].forEach(id => {
    trackControlHistoryStart(els[id]);
    els[id].addEventListener('input', () => { updateSwatchSelection(id, els[id].value); stateChanged(); });
    els[id].addEventListener('change', () => {
      pushPendingControlHistory(els[id]);
      updateSwatchSelection(id, els[id].value);
      stateChanged();
    });
  });
  els.openTextCardBtn.addEventListener('click', () => openModal(els.textCardModal));
  if (els.mobileTextCardBtn) els.mobileTextCardBtn.addEventListener('click', () => openModal(els.textCardModal));
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(document.getElementById(btn.dataset.close))));
  ['textCardContent','textCardTextColor','textCardBgColor','textCardFontSize','textCardAlignH','textCardAlignV'].forEach(id => els[id].addEventListener('input', drawTextCardPreview));
  els.addTextCardBtn.addEventListener('click', addTextCardToBoard);
  els.resetBtn.addEventListener('click', clearAll);
  if (els.autoBalanceBtn) els.autoBalanceBtn.addEventListener('click', handleAutoBalance);
  bindHistoryButton(els.undoBtn, 'undo');
  bindHistoryButton(els.redoBtn, 'redo');
  if (els.confirmWidthRatioBtn) {
    els.confirmWidthRatioBtn.addEventListener('click', confirmWidthRatioModal);
  }
  if (els.cancelWidthRatioBtn) {
    els.cancelWidthRatioBtn.addEventListener('click', closeWidthRatioModal);
  }
  if (els.closeWidthRatioModalBtn) {
    els.closeWidthRatioModalBtn.addEventListener('click', closeWidthRatioModal);
  }
  if (els.widthRatioInput) {
    els.widthRatioInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirmWidthRatioModal();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeWidthRatioModal();
      }
    });
  }
  if (els.beautifyBtn) els.beautifyBtn.addEventListener('click', applyBeautifyPreset);
  if (els.updateAppBtn) els.updateAppBtn.addEventListener('click', requestManualAppUpdate);
  if (els.sampleColorBtn) els.sampleColorBtn.addEventListener('click', () => {
    pushHistorySnapshot();
    applyPatternColorFromPrimaryImage();
  });
  trackControlHistoryStart(els.filenameInput);
  els.filenameInput.addEventListener('input', () => { currentFilename = sanitizeFilename(els.filenameInput.value.trim()) || defaultFilename(); isCustomFilename = true; els.filenameInput.value = currentFilename; triggerAutoSave(); });
  els.filenameInput.addEventListener('change', () => pushPendingControlHistory(els.filenameInput));
  els.filenameInput.addEventListener('blur', () => pushPendingControlHistory(els.filenameInput, false));
  els.downloadBtn.addEventListener('click', downloadCanvas);
  if (els.mobileDownloadBtn) els.mobileDownloadBtn.addEventListener('click', downloadCanvas);
  document.querySelectorAll('.swatch').forEach(btn => btn.addEventListener('click', () => {
    pushHistorySnapshot();
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
  return Math.max(0, Math.round(Number(raw || 0)));
}

function getEffectiveColumnGap(raw) {
  return Math.max(0, Math.round(Number(raw || 0)));
}

function getLegacyEffectiveRowGap(raw) {
  const gap = Math.max(0, Number(raw || 0));
  return gap === 0 ? 0 : Math.round(gap * 1.18 + 2);
}

function getLegacyEffectiveColumnGap(raw) {
  const gap = Math.max(0, Number(raw || 0));
  return gap === 0 ? 0 : Math.round(gap * 1.2 + 4);
}

function stateChanged() {
  throttledDrawCanvas();
  triggerAutoSave();
}

function captureHistorySnapshot() {
  return {
    columnsState: structuredClone(columnsState),
    settings: {
      layoutMode: els.layoutMode.value,
      defaultGap: els.defaultGap.value,
      columnGap: els.columnGap.value,
      spacingMode: els.spacingMode?.value || 'custom',
      frameStyle: els.frameStyle.value,
      imageBorderStyle: els.imageBorderStyle?.value || DEFAULT_IMAGE_BORDER_STYLE,
      globalBgColor: els.globalBgColor.value,
      innerBgColor: els.innerBgColor.value,
      patternColor: els.patternColor.value,
      authorName: els.authorName?.value || '',
      filename: currentFilename,
      isCustomFilename
    }
  };
}

function historySnapshotKey(snapshot) {
  return JSON.stringify(snapshot);
}

function pushHistorySnapshot(snapshot = captureHistorySnapshot()) {
  if (historyState.applying) return;
  const last = historyState.past[historyState.past.length - 1];
  if (last && historySnapshotKey(last) === historySnapshotKey(snapshot)) return;
  historyState.past.push(snapshot);
  if (historyState.past.length > HISTORY_LIMIT) historyState.past.shift();
  historyState.future = [];
  updateHistoryControls();
}

function updateHistoryControls() {
  if (els.undoBtn) {
    els.undoBtn.disabled = historyState.past.length === 0;
  }
  if (els.redoBtn) {
    els.redoBtn.disabled = historyState.future.length === 0;
  }
}

function trackControlHistoryStart(input) {
  if (!input) return;
  const remember = () => {
    if (historyState.applying || pendingControlHistorySnapshots.has(input)) return;
    pendingControlHistorySnapshots.set(input, captureHistorySnapshot());
  };
  input.addEventListener('focus', remember);
  input.addEventListener('pointerdown', remember);
  input.addEventListener('keydown', remember);
}

function pushPendingControlHistory(input, fallback = true) {
  const snapshot = pendingControlHistorySnapshots.get(input);
  if (snapshot) {
    pushHistorySnapshot(snapshot);
    pendingControlHistorySnapshots.delete(input);
  } else if (fallback) {
    pushHistorySnapshot();
  }
}

function applyHistorySnapshot(snapshot) {
  historyState.applying = true;
  try {
    columnsState = structuredClone(snapshot.columnsState);
    const settings = snapshot.settings || {};
    els.layoutMode.value = settings.layoutMode || '3';
    els.defaultGap.value = settings.defaultGap ?? DEFAULT_ROW_GAP_RAW;
    els.columnGap.value = settings.columnGap ?? DEFAULT_COLUMN_GAP_RAW;
    if (els.spacingMode) els.spacingMode.value = settings.spacingMode || '';
    els.frameStyle.value = settings.frameStyle || DEFAULT_FRAME_STYLE;
    if (els.imageBorderStyle) els.imageBorderStyle.value = settings.imageBorderStyle || DEFAULT_IMAGE_BORDER_STYLE;
    els.globalBgColor.value = settings.globalBgColor || '#f8fafc';
    els.innerBgColor.value = settings.innerBgColor || '#ffffff';
    els.patternColor.value = settings.patternColor || '#c9a227';
    if (els.authorName) els.authorName.value = settings.authorName || '';
    currentFilename = settings.filename || defaultFilename();
    isCustomFilename = Boolean(settings.isCustomFilename);
    refreshFilename();
    updateSwatchSelection('globalBgColor', els.globalBgColor.value);
    updateSwatchSelection('innerBgColor', els.innerBgColor.value);
    updateSwatchSelection('patternColor', els.patternColor.value);
    syncSpacingControls({ requestRender: false, requestSave: false });
    renderKanban();
    throttledDrawCanvas();
  } finally {
    historyState.applying = false;
  }
  triggerAutoSave();
  updateHistoryControls();
}

function undo() {
  if (!historyState.past.length) return;
  historyState.future.push(captureHistorySnapshot());
  const snapshot = historyState.past.pop();
  applyHistorySnapshot(snapshot);
  updateHistoryControls();
  showStatus('已復原上一個操作', 'info');
}

function redo() {
  if (!historyState.future.length) return;
  historyState.past.push(captureHistorySnapshot());
  if (historyState.past.length > HISTORY_LIMIT) historyState.past.shift();
  const snapshot = historyState.future.pop();
  applyHistorySnapshot(snapshot);
  updateHistoryControls();
  showStatus('已重做操作', 'info');
}

function runHistoryAction(action) {
  if (action === 'undo') {
    if (!historyState.past.length) return;
    undo();
    return;
  }

  if (action === 'redo') {
    if (!historyState.future.length) return;
    redo();
  }
}

function bindHistoryButton(button, action) {
  if (!button) return;

  button.addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch') return;
    if (button.disabled) return;

    event.preventDefault();
    lastHistoryTouchActionAt = Date.now();
    runHistoryAction(action);
  });

  button.addEventListener('click', event => {
    if (button.disabled) return;

    const isSyntheticFollowupClick =
      Date.now() - lastHistoryTouchActionAt < 700;

    if (isSyntheticFollowupClick) {
      event.preventDefault();
      return;
    }

    runHistoryAction(action);
  });
}

function isEditableShortcutTarget(target) {
  return !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

function hasOpenModal() {
  return [els.textCardModal, els.imageTextModal, els.widthRatioModal].some(modal => modal && !modal.classList.contains('hidden'));
}

function updateKanbanSpacingVars() {
  // Output spacing and drag-board spacing are intentionally independent.
  // The Kanban board uses fixed CSS gaps for predictable dragging.
  return {
    rowGap: getEffectiveRowGap(els.defaultGap.value),
    colGap: getEffectiveColumnGap(els.columnGap.value)
  };
}

function syncSpacingControls(options = {}) {
  const { requestRender: shouldRender = true, requestSave: shouldSave = false } = options;
  const { rowGap, colGap } = updateKanbanSpacingVars();
  els.gapValue.textContent = `${rowGap} px`;
  els.columnGapValue.textContent = `${colGap} px`;
  if (shouldRender) requestRender();
  if (shouldSave) requestSave();
}

function applySpacingMode(mode, notify=false) {
  const presets = {
    tight: { row: 8, col: 8, label: '緊密' },
    normal: { row: DEFAULT_ROW_GAP_RAW, col: DEFAULT_COLUMN_GAP_RAW, label: '標準' },
    airy: { row: 36, col: 32, label: '寬鬆' }
  };
  const preset = presets[mode] || presets.normal;
  els.defaultGap.value = preset.row;
  els.columnGap.value = preset.col;
  syncSpacingControls({ requestRender: true, requestSave: true });
  if (notify) showStatus(`已套用${preset.label}留白`, 'success');
}

function applyBeautifyPreset() {
  pushHistorySnapshot();
  const allItems = columnsState.flatMap(col => col.items);

  els.defaultGap.value = 96;
  els.columnGap.value = 36;
  if (els.spacingMode) els.spacingMode.value = 'custom';
  els.globalBgColor.value = '#eaf6fb';
  els.innerBgColor.value = '#eaf6fb';
  els.patternColor.value = '#9bbfcb';
  if (els.imageBorderStyle) els.imageBorderStyle.value = 'soft-white';

  if (allItems.length === 3) {
    els.layoutMode.value = 'special_2_1';
    initColumnsForLayout('special_2_1', true);
    columnsState.forEach((col, index) => {
      col.align = 'center';
      col.items.forEach(item => { item.widthRatio = index === 2 ? 0.76 : 1.0; });
    });
    if (els.frameStyle.value === 'none') els.frameStyle.value = 'watercolor-floral';
    renderKanban();
    showStatus('已套用 3 圖海報美化：上二下一、淺藍底、水彩花框、柔白相框', 'success');
  } else {
    if (els.frameStyle.value === 'none') els.frameStyle.value = 'watercolor-floral';
    showStatus('已套用柔和 A4 美化；圖片次序與比例保持不變', 'success');
  }

  updateSwatchSelection('globalBgColor', els.globalBgColor.value);
  updateSwatchSelection('innerBgColor', els.innerBgColor.value);
  updateSwatchSelection('patternColor', els.patternColor.value);
  syncSpacingControls({ requestRender: false, requestSave: false });
  stateChanged();
}


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
  const prevBlocks = preserve
    ? columnsState.flatMap(col => createBlocks(col.items))
    : [];
  const isSpecialThreeRegion =
    layout === 'special_2_1' ||
    layout === 'special_1_2';
  const count = isSpecialThreeRegion ? 3 : Number(layout);
  let names;
  if (layout === 'special_2_1') {
    names = ['左上方','右上方','下方置中'];
  } else if (layout === 'special_1_2') {
    names = ['上方置中','左下方','右下方'];
  } else {
    names = Array.from({length: count}, (_,i) => `第 ${i+1} 欄`);
  }
  const newCols = names.map(name => ({ align: 'top', name, items: [] }));
  prevBlocks.forEach((block, idx) => newCols[idx % newCols.length].items.push(...block));
  columnsState = newCols;
}

async function handleImageUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  showLoading(true);
  const total = files.length;
  let successCount = 0;
  let processedCount = 0;
  let historyPushed = false;
  const failedFiles = [];
  showStatus(
    total >= 20
      ? `正在加入 ${total} 張圖片，建立預覽可能需要少許時間…`
      : `正在準備加入 0 / ${total} 張圖片…`,
    'info'
  );
  try {
    for (const file of files) {
      try {
        const id = `img_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const originalData = await fileToDataURL(file);
        const previewData = await createPreview(originalData, 520, 0.94);
        const img = await loadImage(originalData);
        imageRegistry[id] = { img, previewData, originalData, type: 'image' };
        const colCount = Math.max(1, columnsState.length);
        const safeW = A4_WIDTH - (computeSafeArea(els.frameStyle.value).x) * 2;
        const baseColWidth = colCount > 1
          ? (safeW - getEffectiveColumnGap(getColumnGapValue()) * (colCount - 1)) / colCount
          : safeW;
        const rowGap = getEffectiveRowGap(els.defaultGap.value);
        const targetCol = pickTargetColumnForLayout(
          els.layoutMode.value,
          columnsState,
          baseColWidth,
          rowGap
        );
        if (!historyPushed) {
          pushHistorySnapshot();
          historyPushed = true;
        }
        targetCol.items.push(normalizeItem({ id, noGapBelow: false }));
        successCount++;
      } catch (err) {
        console.error('Image import failed:', file?.name, err);
        failedFiles.push(file?.name || '未命名圖片');
      } finally {
        processedCount++;
        showStatus(`正在加入 ${processedCount} / ${total} 張圖片…`, 'info');
        if (processedCount % 3 === 0 || processedCount === total) {
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }
    }
    if (successCount > 0) {
      renderKanban();
      stateChanged();
    }
    if (successCount > 0 && failedFiles.length === 0) {
      showStatus(`已加入 ${successCount} 張圖片`, 'success');
    } else if (successCount > 0 && failedFiles.length > 0) {
      showStatus(`已加入 ${successCount} 張圖片；${failedFiles.length} 張未能讀取`, 'warning');
    } else {
      showStatus('未能讀取所選圖片。請改用 JPG、PNG 或 WebP 後再試。', 'error');
    }
  } catch (err) {
    console.error(err);
    showStatus('圖片載入失敗，請換一張試試', 'error');
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
    img.onload = async () => {
      if (img.decode) {
        try { await img.decode(); } catch {}
      }
      resolve(img);
    };
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
  updateKanbanSpacingVars();
  els.kanbanBoard.style.setProperty('--kanban-column-count', String(Math.max(1, columnsState.length)));

  columnsState.forEach((col, colIndex) => {
    const wrap = document.createElement('div');
    wrap.className = 'kanban-col';
    wrap.innerHTML = `
      <div class="kanban-col-head">
        <div class="kanban-col-title-row">
          <div class="kanban-col-title">${col.name}</div>
          <div class="kanban-col-count">${col.items.length}</div>
        </div>
        <button
          class="kanban-align-pill align-btn"
          type="button"
          data-col="${colIndex}"
          title="${alignLabel(col.align)}"
          aria-label="欄位對齊：${alignLabel(col.align)}；按一下切換"
        >
          <span class="kanban-align-text">${alignLabel(col.align)}</span>
          <span class="kanban-align-symbol" aria-hidden="true">${alignSymbol(col.align)}</span>
        </button>
      </div>
      <div class="kanban-list" data-col="${colIndex}"></div>
    `;
    els.kanbanBoard.appendChild(wrap);

    const list = wrap.querySelector('.kanban-list');
    col.items.forEach((item, itemIndex) => {
      const reg = imageRegistry[item.id];
      if (!reg) return;
      const noGapAbove = isNoGapAbove(colIndex, itemIndex);
      const isFirstItem = itemIndex === 0;
      const noGapTitle = isFirstItem
        ? '第一張沒有上一張可貼齊'
        : noGapAbove
          ? '已與上一張貼齊；按一下取消'
          : '與上一張貼齊';
      const card = document.createElement('div');
      card.className = `kanban-item ${item.noGapBelow ? 'nogap-below' : ''}`;
      card.dataset.id = item.id;
      card.innerHTML = `
        <div class="kanban-card-frame">
          <div class="kanban-drag-content">
            <div class="kanban-thumb-shell">
              <img class="kanban-thumb" src="${reg.previewData || reg.thumb || reg.originalData}" alt="thumb" loading="lazy" decoding="async">
            </div>
          </div>
          <div class="kanban-card-actions">
            <button class="kanban-mini-icon kanban-drag-handle" type="button" title="拖曳排序">
              <i class="fa-solid fa-grip-lines"></i>
            </button>
            <button class="kanban-mini-icon ${noGapAbove ? 'is-active' : ''} toggle-gap-btn" type="button" data-id="${item.id}" title="${noGapTitle}" aria-label="${noGapTitle}" ${isFirstItem ? 'disabled' : ''}>
              <i class="fa-solid fa-link"></i>
            </button>
            
            <button class="kanban-mini-icon ${(item.widthRatio ?? 1.0) < 1.0 ? 'is-active' : ''} width-ratio-btn" data-id="${item.id}" title="佔寬比例">
              <span style="font-size:0.7em;font-weight:600;letter-spacing:-0.02em">${(() => { const wr = item.widthRatio ?? 1.0; return Math.abs(wr - 1.0) < 0.01 ? '100%' : Math.abs(wr - 0.75) < 0.01 ? '75%' : Math.abs(wr - 0.5) < 0.01 ? '50%' : `${Math.round(wr * 100)}%`; })()}</span>
            </button>
            ${reg.type === 'image' ? `<button class="kanban-mini-icon edit-btn" data-id="${item.id}" title="加字"><i class="fa-solid fa-pen-nib"></i></button>` : ''}
            <button class="kanban-mini-icon is-danger delete-btn" data-id="${item.id}" title="刪除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
      list.appendChild(card);
    });

    const isMobileBoard = window.matchMedia('(max-width: 1023px)').matches;
    // removed Sortable
  });

}

function onKanbanBoardClick(e) {
  const alignBtn = e.target.closest('.align-btn');
  if (alignBtn && els.kanbanBoard.contains(alignBtn)) return cycleAlign(Number(alignBtn.dataset.col));
  const gapBtn = e.target.closest('.toggle-gap-btn');
  if (gapBtn && els.kanbanBoard.contains(gapBtn)) {
    if (gapBtn.disabled) return;
    return toggleNoGapAbove(gapBtn.dataset.id);
  }
  const deleteBtn = e.target.closest('.delete-btn');
  if (deleteBtn && els.kanbanBoard.contains(deleteBtn)) return deleteItem(deleteBtn.dataset.id);
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn && els.kanbanBoard.contains(editBtn)) return openImageTextEditor(editBtn.dataset.id);
  const widthBtn = e.target.closest('.width-ratio-btn');
  if (widthBtn && els.kanbanBoard.contains(widthBtn)) {
    const isSyntheticTouchClick =
      Date.now() - lastWidthRatioTouchAt < 800;

    if (isSyntheticTouchClick) {
      e.preventDefault();
      return;
    }

    return openWidthRatioModal(widthBtn.dataset.id, false);
  }
}

function onKanbanBoardPointerUp(event) {
  if (event.pointerType !== 'touch') return;

  const widthBtn = event.target.closest('.width-ratio-btn');

  if (!widthBtn || !els.kanbanBoard.contains(widthBtn)) return;

  event.preventDefault();
  event.stopPropagation();

  lastWidthRatioTouchAt = Date.now();

  openWidthRatioModal(widthBtn.dataset.id, true);
}

function clearDropIndicators() {
  document.body.classList.remove('kanban-drag-active');
  document.querySelectorAll('.kanban-list').forEach(list => list.classList.remove('is-drop-target'));
  document.querySelectorAll('.kanban-item').forEach(item => item.classList.remove('drop-before','drop-after'));
}


function alignLabel(align) { return align === 'top' ? '靠上 ⬆️' : align === 'center' ? '置中 ↕️' : '靠下 ⬇️'; }
function alignSymbol(align) {
  if (align === 'top') return '↑';
  if (align === 'center') return '↕';
  return '↓';
}
function cycleAlign(colIndex) {
  pushHistorySnapshot();
  const seq = ['top','center','bottom'];
  const current = columnsState[colIndex].align;
  columnsState[colIndex].align = seq[(seq.indexOf(current)+1) % seq.length];
  renderKanban();
  stateChanged();
}
function findItemPositionById(id) {
  for (let colIndex = 0; colIndex < columnsState.length; colIndex += 1) {
    const itemIndex = columnsState[colIndex].items.findIndex(item => item.id === id);
    if (itemIndex !== -1) return { colIndex, itemIndex, col: colIndex, index: itemIndex };
  }
  return null;
}

function isNoGapAbove(colIndex, itemIndex) {
  if (itemIndex <= 0) return false;
  return columnsState[colIndex]?.items[itemIndex - 1]?.noGapBelow === true;
}

function setNoGapAfterItem(item, enabled) {
  if (!item) return;
  item.noGapBelow = enabled === true;
  item.fixedGap = enabled ? 0 : null;
}

function toggleNoGapAbove(id) {
  const position = findItemPositionById(id);
  if (!position || position.itemIndex === 0) return;
  const previousItem = columnsState[position.colIndex].items[position.itemIndex - 1];
  const enabled = previousItem.noGapBelow !== true;
  pushHistorySnapshot();
  setNoGapAfterItem(previousItem, enabled);
  renderKanban();
  stateChanged();
  showStatus(enabled ? '已與上一張貼齊' : '已取消與上一張貼齊', 'success');
}

function findKanbanItemById(id) {
  for (const col of columnsState) {
    const item = col.items.find(entry => entry.id === id);
    if (item) return item;
  }
  return null;
}

function openWidthRatioModal(id, fromTouchGesture = false) {
  const item = findKanbanItemById(id);
  if (!item || !els.widthRatioModal || !els.widthRatioInput) return;

  activeWidthRatioItemId = id;

  const currentPercent = Math.round((item.widthRatio ?? 1) * 100);

  els.widthRatioInput.value = String(currentPercent);
  els.widthRatioModal.classList.remove('hidden');
  els.widthRatioModal.setAttribute('aria-hidden', 'false');
  try {
    els.widthRatioInput.focus();
    els.widthRatioInput.select();
  } catch {}
}

function closeWidthRatioModal() {
  if (!els.widthRatioModal) return;

  els.widthRatioModal.classList.add('hidden');
  els.widthRatioModal.setAttribute('aria-hidden', 'true');
  activeWidthRatioItemId = null;
}

function confirmWidthRatioModal() {
  const id = activeWidthRatioItemId;
  const item = findKanbanItemById(id);

  if (!id || !item || !els.widthRatioInput) {
    closeWidthRatioModal();
    return;
  }

  const raw = String(els.widthRatioInput.value || '').trim();
  const parsed = Number(raw);

  if (raw === '' || !Number.isFinite(parsed)) {
    showStatus('請輸入 30 至 100 的數字', 'warning');
    els.widthRatioInput.focus();
    els.widthRatioInput.select();
    return;
  }

  const currentPercent = Math.round((item.widthRatio ?? 1) * 100);
  const percent = Math.min(100, Math.max(30, Math.round(parsed)));

  if (percent === currentPercent) {
    closeWidthRatioModal();
    return;
  }

  pushHistorySnapshot();
  item.widthRatio = percent / 100;

  closeWidthRatioModal();
  renderKanban();
  stateChanged();
  showStatus(`已設定圖片寬度為 ${percent}%`, 'success');
}

function deleteItem(id) {
  const position = findItemPositionById(id);
  if (!position) return;
  pushHistorySnapshot();
  const items = columnsState[position.colIndex].items;
  setNoGapAfterItem(items[position.itemIndex - 1], false);
  setNoGapAfterItem(items[position.itemIndex], false);
  items.splice(position.itemIndex, 1);
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

const requestRender = throttledDrawCanvas;
const requestSave = triggerAutoSave;

function drawCanvas() {
  const canvas = els.collageCanvas;
  const ctx = canvas.getContext('2d');
  const input = buildLayoutInput();

  ctx.clearRect(0, 0, A4_WIDTH, A4_HEIGHT);

  let safeMargin = drawBackgroundAndFrame(ctx, input);

  // 只處理 2 欄：減少 A4 外圍留白，令內容更集中
  const isTwoColumn = input.layoutMode === '2';

  if (isTwoColumn) {
    safeMargin = Math.min(Number(safeMargin) || 90, 55);
  }

  const outerPadding = isTwoColumn ? 0 : 40;

  const safeX = safeMargin + outerPadding;
  const safeY = safeMargin + outerPadding;
  const safeW = A4_WIDTH - safeX * 2;
  const safeH = A4_HEIGHT - safeY * 2;

  // 防止 safeArea 計錯時成張圖消失
  if (safeW <= 0 || safeH <= 0) {
    console.warn('Invalid safeArea:', { safeX, safeY, safeW, safeH, safeMargin, outerPadding });
    return;
  }

  input.safeArea = {
    x: safeX,
    y: safeY,
    width: safeW,
    height: safeH
  };

  if (input.layoutMode === 'special_2_1') {
    const layoutResult = computeSpecialDraftLayout(input);
    renderLayout(ctx, layoutResult, input);
  } else if (input.layoutMode === 'special_1_2') {
    const layoutResult = computeSpecialOneTopTwoBottomLayout(input);
    renderLayout(ctx, layoutResult, input);
  } else {
    const layoutResult = computeLayout(input);
    renderLayout(ctx, layoutResult, input);
  }
}

function getSettings() {
  return {
    layoutMode: els.layoutMode.value,
    spacingMode: els.spacingMode?.value || 'custom',
    defaultGap: getEffectiveRowGap(els.defaultGap.value),
    columnGap: getEffectiveColumnGap(getColumnGapValue()),
    frameStyle: els.frameStyle.value,
    imageBorderStyle: els.imageBorderStyle?.value || DEFAULT_IMAGE_BORDER_STYLE,
    globalBgColor: els.globalBgColor.value,
    innerBgColor: els.innerBgColor.value,
    patternColor: els.patternColor.value,
    authorName: getAuthorName(),
  };
}

function getAuthorName() {
  const value = els.authorName?.value.trim();
  return value || DEFAULT_AUTHOR_NAME;
}

function computeSafeArea(frameStyle) {
  const floral = ['editorial-luxe','photo-mat','parchment-classic','chapel-ornament','botanical-corners','washi-soft','botanical-atelier','artdeco-ornament','papercut-bloom','watercolor-floral','spring-daisy','rose-garden','fresh-vine','ginkgo','sakura','hydrangea','vintage-lace','geometric-arch','starry-night','confetti-corners','bamboo-zen','ribbon-corners','journal-tape','birthday-confetti','minimal-dots','pastel-grid','ribbon-corner','school-notes','starry-frame'];
  let margin;
  if (FRAME_ASSET_MAP[frameStyle]) {
    const meta = FRAME_ASSET_MAP[frameStyle];
    margin = meta?.margin ?? 118;
  } else if (floral.includes(frameStyle)) {
    margin = ['editorial-luxe','artdeco-ornament'].includes(frameStyle) ? 190 : 176;
  } else if (frameStyle === 'solid-white') {
    margin = 100;
  } else if (frameStyle === 'double' || frameStyle === 'elegant') {
    margin = 90;
  } else {
    margin = 90;
  }
  const outerPadding = 40;
  const x = margin + outerPadding;
  const y = margin + outerPadding;
  return { x, y, width: A4_WIDTH - x * 2, height: A4_HEIGHT - y * 2 };
}

function buildLayoutInput() {
  const settings = getSettings();
  return {
    ...settings,
    columnsState,
    imageRegistry,
    safeArea: computeSafeArea(settings.frameStyle)
  };
}

function getColumnGapValue() {
  return Math.max(0, Number(els.columnGap?.value || 12));
}


function getFrameAsset(style) {
  const meta = FRAME_ASSET_MAP[style];
  if (!meta) return null;
  if (frameAssetCache[style]) return frameAssetCache[style];
  const img = new Image();
  img.onload = () => throttledDrawCanvas();
  img.onerror = () => console.warn('Frame asset failed to load:', style);
  img.src = meta.src;
  frameAssetCache[style] = img;
  return img;
}

function drawImageFrameAsset(ctx, style) {
  const meta = FRAME_ASSET_MAP[style];
  if (!meta) return 90;
  const img = getFrameAsset(style);
  if (img && img.complete && img.naturalWidth) {
    ctx.drawImage(img, 0, 0, A4_WIDTH, A4_HEIGHT);
  }
  return meta.margin ?? 118;
}

function drawBackgroundAndFrame(ctx, s) {
  ctx.fillStyle = s.globalBgColor;
  ctx.fillRect(0,0,A4_WIDTH,A4_HEIGHT);
  let margin = 90;
  const floral = ['editorial-luxe','photo-mat','parchment-classic','chapel-ornament','botanical-corners','washi-soft','botanical-atelier','artdeco-ornament','papercut-bloom','watercolor-floral','spring-daisy','rose-garden','fresh-vine','ginkgo','sakura','hydrangea','vintage-lace','geometric-arch','starry-night','confetti-corners','bamboo-zen','ribbon-corners','journal-tape','birthday-confetti','minimal-dots','pastel-grid','ribbon-corner','school-notes','starry-frame'];
  if (FRAME_ASSET_MAP[s.frameStyle]) {
    margin = drawImageFrameAsset(ctx, s.frameStyle);
  } else if (floral.includes(s.frameStyle)) {
    margin = ['editorial-luxe','artdeco-ornament'].includes(s.frameStyle) ? 190 : 176;
    if (s.frameStyle === 'watercolor-floral') {
      // Flat paper field like a printed poster: no floating inner card or heavy shadow.
      ctx.fillStyle = s.innerBgColor;
      ctx.fillRect(82, 82, A4_WIDTH - 164, A4_HEIGHT - 164);
      drawProceduralFrame(ctx, s.frameStyle, s.patternColor);
    } else {
      drawProceduralFrame(ctx, s.frameStyle, s.patternColor);
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,0.12)';
      ctx.shadowBlur = 22;
      const inset = ['editorial-luxe','artdeco-ornament'].includes(s.frameStyle) ? 188 : 176;
      roundRect(ctx, inset, inset, A4_WIDTH-inset*2, A4_HEIGHT-inset*2, 26);
      ctx.fillStyle = s.innerBgColor;
      ctx.fill();
      ctx.restore();
    }
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
  } else if (style === 'photo-mat') {
    drawPhotoMatFrame(ctx, color);
  } else if (style === 'parchment-classic') {
    drawParchmentClassicFrame(ctx, color);
  } else if (style === 'chapel-ornament') {
    drawChapelOrnamentFrame(ctx, color);
  } else if (style === 'botanical-corners') {
    drawBotanicalCornersFrame(ctx, color);
  } else if (style === 'washi-soft') {
    drawWashiSoftFrame(ctx, color);
  } else if (style === 'botanical-atelier') {
    drawBotanicalAtelierFrame(ctx, color);
  } else if (style === 'artdeco-ornament') {
    drawArtDecoOrnamentFrame(ctx, color);
  } else if (style === 'papercut-bloom') {
    drawPaperCutBloomFrame(ctx, color);
  } else if (style === 'watercolor-floral') {
    drawWatercolorFloralFrame(ctx, color);
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
  } else if (style === 'journal-tape') {
    drawJournalTapeFrame(ctx, color);
  } else if (style === 'birthday-confetti') {
    drawBirthdayConfettiFrame(ctx, color);
  } else if (style === 'minimal-dots') {
    drawMinimalDotsFrame(ctx, color);
  } else if (style === 'pastel-grid') {
    drawPastelGridFrame(ctx, color);
  } else if (style === 'ribbon-corner') {
    drawRibbonCornerFrame(ctx, color);
  } else if (style === 'school-notes') {
    drawSchoolNotesFrame(ctx, color);
  } else if (style === 'starry-frame') {
    drawStarrySimpleFrame(ctx, color);
  } else {
    for (let i = 0; i < 12; i++) {
      drawFlowerDot(ctx, 120 + (i%4)*45, 120 + i*260, 40, '#f9a8d4', color);
      drawFlowerDot(ctx, A4_WIDTH-120 - (i%4)*40, 180 + i*245, 36, '#93c5fd', color);
    }
  }
}

function drawWatercolorFloralFrame(ctx, color) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = hexToRgba(color, .42);
  roundRect(ctx, 74, 74, A4_WIDTH - 148, A4_HEIGHT - 148, 30);
  ctx.stroke();

  const corners = [
    [104, 104, 1, 1],
    [A4_WIDTH - 104, 104, -1, 1],
    [104, A4_HEIGHT - 104, 1, -1],
    [A4_WIDTH - 104, A4_HEIGHT - 104, -1, -1]
  ];

  corners.forEach(([x, y, sx, sy], cornerIndex) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    ctx.strokeStyle = hexToRgba(color, .55);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(80, 20, 125, 72, 205, 126);
    ctx.stroke();

    const leaves = [
      [46, 22, -.62, 32, 13], [82, 43, .42, 37, 15],
      [120, 70, -.52, 34, 14], [158, 98, .44, 31, 13]
    ];
    leaves.forEach(([lx, ly, rot, rx, ry], i) => {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(rot);
      ctx.fillStyle = i % 2 ? 'rgba(166, 218, 206, .44)' : 'rgba(174, 216, 232, .44)';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    const flowerPalette = cornerIndex % 2
      ? ['rgba(201,225,250,.68)','rgba(244,249,255,.86)']
      : ['rgba(239,247,252,.9)','rgba(188,218,243,.62)'];
    drawFlowerDot(ctx, 24, 20, 42, flowerPalette[0], 'rgba(232,196,128,.72)');
    drawFlowerDot(ctx, 186, 118, 31, flowerPalette[1], 'rgba(235,205,145,.70)');
    ctx.restore();
  });
  ctx.restore();
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

function drawJournalTapeFrame(ctx, color) {
  ctx.save();
  const tapes = [
    [92, 78, A4_WIDTH - 184, 52, 'rgba(253, 230, 138, .58)'],
    [112, A4_HEIGHT - 132, A4_WIDTH - 224, 52, 'rgba(191, 219, 254, .58)'],
    [76, 154, 52, A4_HEIGHT - 308, 'rgba(249, 168, 212, .42)'],
    [A4_WIDTH - 128, 154, 52, A4_HEIGHT - 308, 'rgba(167, 243, 208, .46)']
  ];
  tapes.forEach(([x, y, w, h, fill], idx) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = idx % 2 ? 'rgba(15,23,42,.18)' : hexToRgba(color, .28);
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 16]);
    if (w > h) {
      ctx.beginPath(); ctx.moveTo(x + 24, y + h / 2); ctx.lineTo(x + w - 24, y + h / 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x + w / 2, y + 24); ctx.lineTo(x + w / 2, y + h - 24); ctx.stroke();
    }
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = hexToRgba(color, .36);
  ctx.lineWidth = 2;
  roundRect(ctx, 106, 106, A4_WIDTH - 212, A4_HEIGHT - 212, 18); ctx.stroke();
  ctx.restore();
}

function drawBirthdayConfettiFrame(ctx, color) {
  ctx.save();
  const fills = [color, '#fb7185', '#38bdf8', '#facc15', '#a78bfa', '#34d399'];
  const corners = [[126,126,1,1],[A4_WIDTH-126,126,-1,1],[126,A4_HEIGHT-126,1,-1],[A4_WIDTH-126,A4_HEIGHT-126,-1,-1]];
  corners.forEach(([cx, cy, sx, sy], cornerIdx) => {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, sy);
    for (let i = 0; i < 34; i++) {
      const angle = (i / 34) * Math.PI / 2;
      const dist = 24 + (i % 7) * 18;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle + i * .37);
      ctx.fillStyle = fills[(i + cornerIdx) % fills.length];
      ctx.globalAlpha = .72;
      if (i % 5 === 0) drawStar(ctx, 0, 0, 10 + (i % 3) * 3, ctx.fillStyle, .78);
      else ctx.fillRect(-10, -4, 20, 8);
      ctx.restore();
    }
    ctx.restore();
  });
  ctx.strokeStyle = hexToRgba(color, .42);
  ctx.lineWidth = 3;
  roundRect(ctx, 92, 92, A4_WIDTH - 184, A4_HEIGHT - 184, 38); ctx.stroke();
  ctx.restore();
}

function drawMinimalDotsFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, .72);
  ctx.lineWidth = 3;
  roundRect(ctx, 96, 96, A4_WIDTH - 192, A4_HEIGHT - 192, 24); ctx.stroke();
  ctx.strokeStyle = hexToRgba(color, .26);
  ctx.lineWidth = 1.5;
  roundRect(ctx, 136, 136, A4_WIDTH - 272, A4_HEIGHT - 272, 18); ctx.stroke();
  ctx.fillStyle = hexToRgba(color, .58);
  for (let x = 150; x <= A4_WIDTH - 150; x += 82) {
    ctx.beginPath(); ctx.arc(x, 122, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, A4_HEIGHT - 122, 5, 0, Math.PI * 2); ctx.fill();
  }
  for (let y = 184; y <= A4_HEIGHT - 184; y += 82) {
    ctx.beginPath(); ctx.arc(122, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(A4_WIDTH - 122, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPastelGridFrame(ctx, color) {
  ctx.save();
  const inset = 92;
  const fills = ['rgba(254,202,202,.42)', 'rgba(191,219,254,.42)', 'rgba(187,247,208,.38)', 'rgba(253,230,138,.4)'];
  [[inset, inset, A4_WIDTH - inset * 2, 64], [inset, A4_HEIGHT - inset - 64, A4_WIDTH - inset * 2, 64], [inset, inset + 70, 64, A4_HEIGHT - inset * 2 - 140], [A4_WIDTH - inset - 64, inset + 70, 64, A4_HEIGHT - inset * 2 - 140]].forEach(([x, y, w, h], idx) => {
    ctx.fillStyle = fills[idx % fills.length];
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.72)';
    ctx.lineWidth = 2;
    const step = 32;
    for (let gx = x; gx <= x + w; gx += step) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
    for (let gy = y; gy <= y + h; gy += step) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
  });
  ctx.strokeStyle = hexToRgba(color, .36);
  ctx.lineWidth = 3;
  roundRect(ctx, 108, 108, A4_WIDTH - 216, A4_HEIGHT - 216, 24); ctx.stroke();
  ctx.restore();
}

function drawRibbonCornerFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, .5);
  ctx.lineWidth = 3;
  roundRect(ctx, 94, 94, A4_WIDTH - 188, A4_HEIGHT - 188, 28); ctx.stroke();
  [[128,128,1,1],[A4_WIDTH-128,128,-1,1],[128,A4_HEIGHT-128,1,-1],[A4_WIDTH-128,A4_HEIGHT-128,-1,-1]].forEach(([x,y,sx,sy]) => {
    ctx.save(); ctx.translate(x,y); ctx.scale(sx,sy);
    ctx.fillStyle = hexToRgba(color, .82);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(118,0); ctx.lineTo(92,30); ctx.lineTo(118,60); ctx.lineTo(0,60); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillRect(12, 13, 76, 10);
    ctx.fillStyle = 'rgba(15,23,42,.12)';
    ctx.beginPath(); ctx.moveTo(0,60); ctx.lineTo(34,60); ctx.lineTo(0,94); ctx.closePath(); ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

function drawSchoolNotesFrame(ctx, color) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  roundRect(ctx, 88, 88, A4_WIDTH - 176, A4_HEIGHT - 176, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(96,165,250,.34)';
  ctx.lineWidth = 2;
  for (let y = 180; y <= A4_HEIGHT - 180; y += 84) {
    ctx.beginPath(); ctx.moveTo(116, y); ctx.lineTo(A4_WIDTH - 116, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(248,113,113,.5)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(176, 112); ctx.lineTo(176, A4_HEIGHT - 112); ctx.stroke();
  ctx.fillStyle = hexToRgba(color, .42);
  for (let y = 166; y <= A4_HEIGHT - 166; y += 210) {
    ctx.beginPath(); ctx.arc(128, y, 10, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = hexToRgba(color, .5);
  ctx.lineWidth = 3;
  roundRect(ctx, 88, 88, A4_WIDTH - 176, A4_HEIGHT - 176, 18); ctx.stroke();
  ctx.restore();
}

function drawStarrySimpleFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, .56);
  ctx.lineWidth = 3;
  roundRect(ctx, 98, 98, A4_WIDTH - 196, A4_HEIGHT - 196, 34); ctx.stroke();
  for (let i = 0; i < 96; i++) {
    const edge = i % 4;
    const span = edge < 2 ? A4_WIDTH - 260 : A4_HEIGHT - 260;
    const pos = 130 + ((i * 97) % span);
    const x = edge === 0 || edge === 1 ? pos : (edge === 2 ? 122 : A4_WIDTH - 122);
    const y = edge === 0 ? 122 : edge === 1 ? A4_HEIGHT - 122 : pos;
    drawStar(ctx, x, y, 7 + (i % 4) * 3, i % 3 === 0 ? color : '#facc15', .45 + (i % 5) * .08);
  }
  ctx.restore();
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

function drawPhotoMatFrame(ctx, color) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  roundRect(ctx, 92, 92, A4_WIDTH-184, A4_HEIGHT-184, 22); ctx.fill();
  ctx.strokeStyle = hexToRgba(color, .55); ctx.lineWidth = 2.5;
  roundRect(ctx, 118, 118, A4_WIDTH-236, A4_HEIGHT-236, 16); ctx.stroke();
  ctx.strokeStyle = hexToRgba(color, .28); ctx.lineWidth = 1;
  roundRect(ctx, 138, 138, A4_WIDTH-276, A4_HEIGHT-276, 10); ctx.stroke();
  ctx.restore();
}

function drawParchmentClassicFrame(ctx, color) {
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, A4_WIDTH, A4_HEIGHT);
  grad.addColorStop(0, 'rgba(245, 234, 208, 0.72)');
  grad.addColorStop(.5, 'rgba(255, 248, 231, 0.25)');
  grad.addColorStop(1, 'rgba(229, 216, 188, 0.72)');
  ctx.fillStyle = grad;
  roundRect(ctx, 88, 88, A4_WIDTH-176, A4_HEIGHT-176, 34); ctx.fill();
  ctx.strokeStyle = hexToRgba(color, .42); ctx.lineWidth = 3;
  roundRect(ctx, 96, 96, A4_WIDTH-192, A4_HEIGHT-192, 30); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,85,43,.18)';
  for (let i=0;i<24;i++) {
    ctx.beginPath();
    const y = 130 + i*135;
    ctx.moveTo(120, y);
    ctx.bezierCurveTo(260, y-18, A4_WIDTH-260, y+18, A4_WIDTH-120, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawChapelOrnamentFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 3.2;
  roundRect(ctx, 96, 96, A4_WIDTH-192, A4_HEIGHT-192, 26); ctx.stroke();
  const corners = [
    [138,138,1,1],[A4_WIDTH-138,138,-1,1],
    [138,A4_HEIGHT-138,1,-1],[A4_WIDTH-138,A4_HEIGHT-138,-1,-1]
  ];
  corners.forEach(([x,y,sx,sy]) => {
    ctx.save(); ctx.translate(x,y); ctx.scale(sx,sy);
    ctx.beginPath(); ctx.moveTo(0,74); ctx.quadraticCurveTo(0,20,22,0); ctx.lineTo(64,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16,16); ctx.lineTo(42,42); ctx.moveTo(42,16); ctx.lineTo(16,42); ctx.stroke();
    ctx.restore();
  });
  ctx.beginPath();
  ctx.moveTo(A4_WIDTH/2, 108); ctx.lineTo(A4_WIDTH/2, 168);
  ctx.moveTo(A4_WIDTH/2 - 30, 138); ctx.lineTo(A4_WIDTH/2 + 30, 138);
  ctx.moveTo(A4_WIDTH/2, A4_HEIGHT-108); ctx.lineTo(A4_WIDTH/2, A4_HEIGHT-168);
  ctx.moveTo(A4_WIDTH/2 - 30, A4_HEIGHT-138); ctx.lineTo(A4_WIDTH/2 + 30, A4_HEIGHT-138);
  ctx.stroke();
  ctx.restore();
}

function drawBotanicalCornersFrame(ctx, color) {
  ctx.save();
  ctx.strokeStyle = hexToRgba(color,.52); ctx.lineWidth = 2.4;
  roundRect(ctx, 102, 102, A4_WIDTH-204, A4_HEIGHT-204, 30); ctx.stroke();
  [[152,152,1,1],[A4_WIDTH-152,152,-1,1],[152,A4_HEIGHT-152,1,-1],[A4_WIDTH-152,A4_HEIGHT-152,-1,-1]].forEach(([x,y,sx,sy], idx) => {
    ctx.save(); ctx.translate(x,y); ctx.scale(sx,sy);
    for (let i=0;i<5;i++) {
      const ox = i*18;
      ctx.fillStyle = i % 2 ? 'rgba(134,239,172,.28)' : 'rgba(253,230,138,.28)';
      ctx.beginPath(); ctx.ellipse(26+ox, 22+i*12, 20-i*1.5, 9-i*.7, -.6, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(22+i*12, 26+ox, 18-i*1.2, 8-i*.6, .6, 0, Math.PI*2); ctx.fill();
    }
    ctx.strokeStyle = hexToRgba(color,.65); ctx.beginPath();
    ctx.moveTo(0,96); ctx.bezierCurveTo(8,44,40,14,96,0); ctx.stroke();
    ctx.restore();
  });
  ctx.restore();
}

function drawWashiSoftFrame(ctx, color) {
  ctx.save();
  const strips = [
    [70, 92, A4_WIDTH-140, 28, 'rgba(245, 222, 179, .55)'],
    [92, A4_HEIGHT-120, A4_WIDTH-184, 30, 'rgba(221, 214, 254, .48)'],
    [82, 128, 28, A4_HEIGHT-256, 'rgba(191, 219, 254, .42)'],
    [A4_WIDTH-110, 128, 28, A4_HEIGHT-256, 'rgba(253, 164, 175, .38)']
  ];
  strips.forEach(([x,y,w,h,fill]) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x,y,w,h);
  });
  ctx.strokeStyle = hexToRgba(color,.34); ctx.lineWidth = 1.6;
  roundRect(ctx, 106, 106, A4_WIDTH-212, A4_HEIGHT-212, 20); ctx.stroke();
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

function getGapAfterItem(item, rowGap) {
  return item?.noGapBelow === true ? 0 : rowGap;
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
    const wr = item.widthRatio ?? 1.0;
    const w = colWidth * wr;
    const h = w * data.ratio;
    metrics.push({ id: item.id, height: h });
    total += h;
  });
  return { metrics, totalHeight: total, bottomGap: gap };
}


function estimateItemHeight(item, baseColWidth) {
  const data = getImageNaturalSize(item.id);
  if (!data) return 0;
  const wr = item.widthRatio ?? 1.0;
  return baseColWidth * wr * data.ratio;
}

function estimateColumnHeight(col, baseColWidth, rowGap) {
  let total = 0;
  col.items.forEach((item, i) => {
    total += estimateItemHeight(item, baseColWidth);
    if (i < col.items.length - 1) {
      total += getGapAfterItem(item, rowGap);
    }
  });
  return total;
}

function pickTargetColumn(cols, baseColWidth, rowGap) {
  return cols.reduce((best, col) => {
    // Keep the earlier column on ties so upload order stays intuitive.
    return estimateColumnHeight(col, baseColWidth, rowGap) <
           estimateColumnHeight(best, baseColWidth, rowGap) ? col : best;
  });
}

function pickTargetColumnForLayout(
  layoutMode,
  cols,
  baseColWidth,
  rowGap
) {
  const isSpecialLayout =
    layoutMode === 'special_2_1' ||
    layoutMode === 'special_1_2';
  if (isSpecialLayout) {
    const firstEmptyColumn =
      cols.find(col => col.items.length === 0);
    if (firstEmptyColumn) {
      return firstEmptyColumn;
    }
  }
  return pickTargetColumn(
    cols,
    baseColWidth,
    rowGap
  );
}

function rebalanceColumns(cols, baseColWidth, rowGap) {
  const colCount = cols.length;
  if (colCount < 2) return cols;

  const blocks = cols.flatMap(col => createBlocks(col.items));
  const newCols = cols.map(col => ({ ...col, items: [] }));

  blocks.forEach(block => {
    const target = pickTargetColumn(newCols, baseColWidth, rowGap);
    target.items.push(...block);
  });

  return newCols;
}

function handleAutoBalance() {

  const ok = window.confirm('自動平衡會重新分配圖片到各欄，你現時手動安排的欄位分布可能被覆蓋。是否繼續？');
  if (!ok) return;
  pushHistorySnapshot();

  const colCount = Math.max(1, columnsState.length);
  const safeW = A4_WIDTH - computeSafeArea(els.frameStyle.value).x * 2;
  const baseColWidth = colCount > 1
    ? (safeW - getEffectiveColumnGap(getColumnGapValue()) * (colCount - 1)) / colCount
    : safeW;
  const rowGap = getEffectiveRowGap(els.defaultGap.value);

  columnsState = rebalanceColumns(columnsState, baseColWidth, rowGap);
  renderKanban();
  stateChanged();
}


function computeDraftLayout(input) {
  const { safeArea, columnsState: cols, defaultGap, columnGap, imageRegistry: reg } = input;
  const safeX = safeArea.x, safeY = safeArea.y, safeW = safeArea.width, safeH = safeArea.height;

  const colCount = Math.max(1, cols.length);
  const requestedColGap = Math.max(0, Number(columnGap ?? 18));
  const maxGap = colCount > 1 ? safeW * 0.24 : 0;
  const baseColGap = Math.min(requestedColGap, maxGap);
  const baseColWidth = colCount > 1 ? (safeW - baseColGap * (colCount - 1)) / colCount : safeW;

  const blockData = cols.map(col => {
    const blocks = createBlocks(col.items).map(b => measureBlock(b, baseColWidth, defaultGap));
    const virtualHeight = blocks.reduce((sum, b, i) =>
      sum + b.totalHeight + (i < blocks.length - 1 ? defaultGap : 0), 0);
    return { blocks, virtualHeight };
  });

  const maxH = Math.max(1, ...blockData.map(b => b.virtualHeight));
  const scale = Math.min(1, safeH / maxH);
  const colWidth = baseColWidth * scale;
  const colGap = baseColGap * scale;
  const rowGap = defaultGap * scale;
  const contentWidth = colWidth * colCount + colGap * (colCount - 1);
  const startX = safeX + (safeW - contentWidth) / 2;

  const result = { columns: [], scale };

  cols.forEach((col, cidx) => {
    const x = startX + cidx * (colWidth + colGap);
    const colH = blockData[cidx].virtualHeight * scale;
    let y = safeY;
    if (col.align === 'center') y = safeY + (safeH - colH) / 2;
    if (col.align === 'bottom') y = safeY + safeH - colH;

    const blocks = createBlocks(col.items);
    const groups = [];

    blocks.forEach((block, blockIndex) => {
      const metric = measureBlock(block, baseColWidth, defaultGap);
      const groupY = y;
      const blockHeight = metric.totalHeight * scale;
      const items = [];

      block.forEach(item => {
        const data = getImageNaturalSize(item.id);
        if (!data) return;
        const wr = item.widthRatio ?? 1.0;
        const itemWidth = colWidth * wr;
        const h = itemWidth * data.ratio;
        const itemX = x + (colWidth - itemWidth) / 2;
        items.push({
          id: item.id,
          type: reg[item.id]?.type || 'image',
          x: itemX, y, width: itemWidth, height: h,
          sourceItem: item
        });
        y += h;
      });

      groups.push({
        groupId: block[0]?.groupId || `__block_${cidx}_${blockIndex}`,
        groupBox: { x, y: groupY, width: colWidth, height: blockHeight },
        items
      });

      if (blockIndex < blocks.length - 1) y += rowGap;
    });

    result.columns.push({ columnIndex: cidx, x, width: colWidth, groups });
  });

  return result;
}

function measureSpecialColumn(col, width, rowGap) {
  const blocks = createBlocks(col.items).map(block => {
    const measured = measureBlock(block, width, rowGap);
    return { items: block, totalHeight: measured.totalHeight };
  });
  const totalHeight = blocks.reduce((sum, blockData, index) =>
    sum + blockData.totalHeight + (index < blocks.length - 1 ? rowGap : 0), 0);
  return { blocks, totalHeight };
}

function specialAlignOffset(align, zoneHeight, contentHeight) {
  if (align === 'bottom') return Math.max(0, zoneHeight - contentHeight);
  if (align === 'center') return Math.max(0, (zoneHeight - contentHeight) / 2);
  return 0;
}

function buildSpecialGroups(reg, measureData, startX, startY, baseWidth, scale, rowGap, prefix) {
  const groups = [];
  const colWidth = baseWidth * scale;
  let cursorY = startY;

  measureData.blocks.forEach((blockData, blockIndex) => {
    const groupY = cursorY;
    const items = [];
    let groupWidth = colWidth;

    blockData.items.forEach(item => {
      const data = getImageNaturalSize(item.id);
      if (!data) return;
      const drawW = colWidth * (item.widthRatio ?? 1.0);
      const drawH = drawW * data.ratio;
      groupWidth = Math.max(groupWidth, drawW);
      const itemX = startX + (colWidth - drawW) / 2;
      items.push({
        id: item.id,
        type: reg[item.id]?.type || 'image',
        x: itemX,
        y: cursorY,
        width: drawW,
        height: drawH,
        sourceItem: item
      });
      cursorY += drawH;
    });

    groups.push({
      groupId: blockData.items[0]?.groupId || `${prefix}_${blockIndex}`,
      groupBox: { x: startX, y: groupY, width: groupWidth, height: cursorY - groupY },
      bgScale: 0,
      items
    });
    if (blockIndex < measureData.blocks.length - 1) cursorY += rowGap * scale;
  });
  return groups;
}

function computeSpecialDraftLayout(input) {
  const { safeArea, columnsState: cols, defaultGap, columnGap, imageRegistry: reg } = input;
  const safeX = safeArea.x, safeY = safeArea.y, safeW = safeArea.width, safeH = safeArea.height;

  const topLeft = cols[0] || { items: [], align: 'top' };
  const topRight = cols[1] || { items: [], align: 'top' };
  const bottomCol = cols[2] || { items: [], align: 'top' };
  const rowGapBase = Math.max(0, Number(defaultGap ?? 20));
  const topGapBase = Math.min(Math.max(0, Number(columnGap ?? 20)), safeW * 0.12);
  const topBaseW = Math.max(1, (safeW - topGapBase) / 2);
  const bottomBaseW = Math.min(safeW * 0.92, topBaseW * 2 + topGapBase);

  const leftMeasure = measureSpecialColumn(topLeft, topBaseW, rowGapBase);
  const rightMeasure = measureSpecialColumn(topRight, topBaseW, rowGapBase);
  const bottomMeasure = measureSpecialColumn(bottomCol, bottomBaseW, rowGapBase);
  const hasTopLeft = topLeft.items.length > 0;
  const hasTopRight = topRight.items.length > 0;
  const hasTop = hasTopLeft || hasTopRight;
  const hasBottom = bottomCol.items.length > 0;
  const topHBase = Math.max(leftMeasure.totalHeight, rightMeasure.totalHeight, 0);
  const tierGapBase = hasTop && hasBottom ? rowGapBase : 0;
  const totalBaseH = Math.max(1, topHBase + tierGapBase + bottomMeasure.totalHeight);
  const scale = Math.min(1, safeH / totalBaseH);
  const totalH = totalBaseH * scale;
  const startY = safeY + Math.max(0, (safeH - totalH) / 2);

  const columns = [];
  const scaledTopW = topBaseW * scale;
  const scaledTopGap = topGapBase * scale;
  const topContentW = hasTopLeft && hasTopRight ? scaledTopW * 2 + scaledTopGap : scaledTopW;
  const topStartX = safeX + (safeW - topContentW) / 2;

  if (hasTopLeft) {
    const y = startY + specialAlignOffset(topLeft.align, topHBase, leftMeasure.totalHeight) * scale;
    columns.push({
      columnIndex: 0,
      x: topStartX,
      width: scaledTopW,
      groups: buildSpecialGroups(reg, leftMeasure, topStartX, y, topBaseW, scale, rowGapBase, '__sp21_l')
    });
  }
  if (hasTopRight) {
    const x = hasTopLeft ? topStartX + scaledTopW + scaledTopGap : topStartX;
    const y = startY + specialAlignOffset(topRight.align, topHBase, rightMeasure.totalHeight) * scale;
    columns.push({
      columnIndex: 1,
      x,
      width: scaledTopW,
      groups: buildSpecialGroups(reg, rightMeasure, x, y, topBaseW, scale, rowGapBase, '__sp21_r')
    });
  }
  if (hasBottom) {
    const scaledBottomW = bottomBaseW * scale;
    const x = safeX + (safeW - scaledBottomW) / 2;
    const y = startY + (hasTop ? topHBase * scale + tierGapBase * scale : 0);
    columns.push({
      columnIndex: 2,
      x,
      width: scaledBottomW,
      groups: buildSpecialGroups(reg, bottomMeasure, x, y, bottomBaseW, scale, rowGapBase, '__sp21_b')
    });
  }

  return { columns, scale };
}

function computeSpecialOneTopTwoBottomLayout(input) {
  const { safeArea, columnsState: cols, defaultGap, columnGap, imageRegistry: reg } = input;
  const safeX = safeArea.x, safeY = safeArea.y, safeW = safeArea.width, safeH = safeArea.height;

  const topCol = cols[0] || { items: [], align: 'top' };
  const bottomLeft = cols[1] || { items: [], align: 'top' };
  const bottomRight = cols[2] || { items: [], align: 'top' };
  const rowGapBase = Math.max(0, Number(defaultGap ?? 20));
  const bottomGapBase = Math.min(Math.max(0, Number(columnGap ?? 20)), safeW * 0.12);
  const bottomBaseW = Math.max(1, (safeW - bottomGapBase) / 2);
  const topBaseW = Math.min(safeW * 0.92, bottomBaseW * 2 + bottomGapBase);

  const topMeasure = measureSpecialColumn(topCol, topBaseW, rowGapBase);
  const leftMeasure = measureSpecialColumn(bottomLeft, bottomBaseW, rowGapBase);
  const rightMeasure = measureSpecialColumn(bottomRight, bottomBaseW, rowGapBase);
  const hasTop = topCol.items.length > 0;
  const hasBottomLeft = bottomLeft.items.length > 0;
  const hasBottomRight = bottomRight.items.length > 0;
  const hasBottom = hasBottomLeft || hasBottomRight;
  const bottomHBase = Math.max(leftMeasure.totalHeight, rightMeasure.totalHeight, 0);
  const tierGapBase = hasTop && hasBottom ? rowGapBase : 0;
  const totalBaseH = Math.max(1, topMeasure.totalHeight + tierGapBase + bottomHBase);
  const scale = Math.min(1, safeH / totalBaseH);
  const totalH = totalBaseH * scale;
  const startY = safeY + Math.max(0, (safeH - totalH) / 2);
  const columns = [];

  if (hasTop) {
    const scaledTopW = topBaseW * scale;
    const x = safeX + (safeW - scaledTopW) / 2;
    columns.push({
      columnIndex: 0,
      x,
      width: scaledTopW,
      groups: buildSpecialGroups(reg, topMeasure, x, startY, topBaseW, scale, rowGapBase, '__sp12_t')
    });
  }

  if (hasBottom) {
    const scaledBottomW = bottomBaseW * scale;
    const scaledBottomGap = bottomGapBase * scale;
    const bottomContentW = hasBottomLeft && hasBottomRight
      ? scaledBottomW * 2 + scaledBottomGap
      : scaledBottomW;
    const bottomStartX = safeX + (safeW - bottomContentW) / 2;
    const bottomStartY = startY + (hasTop ? topMeasure.totalHeight * scale + tierGapBase * scale : 0);

    if (hasBottomLeft) {
      const y = bottomStartY + specialAlignOffset(bottomLeft.align, bottomHBase, leftMeasure.totalHeight) * scale;
      columns.push({
        columnIndex: 1,
        x: bottomStartX,
        width: scaledBottomW,
        groups: buildSpecialGroups(reg, leftMeasure, bottomStartX, y, bottomBaseW, scale, rowGapBase, '__sp12_l')
      });
    }
    if (hasBottomRight) {
      const x = hasBottomLeft ? bottomStartX + scaledBottomW + scaledBottomGap : bottomStartX;
      const y = bottomStartY + specialAlignOffset(bottomRight.align, bottomHBase, rightMeasure.totalHeight) * scale;
      columns.push({
        columnIndex: 2,
        x,
        width: scaledBottomW,
        groups: buildSpecialGroups(reg, rightMeasure, x, y, bottomBaseW, scale, rowGapBase, '__sp12_r')
      });
    }
  }

  return { columns, scale };
}

function computeLayout(input) {
  return computeDraftLayout(input);
}


function extractAverageColor(img, sampleSize = 32) {
  const c = document.createElement('canvas');
  c.width = sampleSize; c.height = sampleSize;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0, sampleSize, sampleSize);
  const d = cx.getImageData(0, 0, sampleSize, sampleSize).data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i+1]; b += d[i+2]; count++; }
  const h = v => Math.round(v/count).toString(16).padStart(2,'0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function applyPatternColorFromPrimaryImage() {
  const firstCol = columnsState[0];
  if (!firstCol) return;
  const item = firstCol.items.find(it => imageRegistry[it.id]?.type === 'image');
  if (!item) return;
  const entry = imageRegistry[item.id];
  if (!entry?.img) return;
  const color = extractAverageColor(entry.img);
  els.patternColor.value = color;
  updateSwatchSelection('patternColor', color);
  requestRender();
  requestSave();
}


function renderLayout(ctx, layoutResult, input) {
  layoutResult.columns.forEach(column => {
    column.groups.forEach(group => {
      group.items.forEach(item => {
        const data = getImageNaturalSize(item.id);
        if (!data) return;
        drawImagePlain(ctx, data.img, item.x, item.y, item.width, item.height, input.imageBorderStyle);
      });
    });
  });
}


function drawImagePlain(ctx, img, x, y, w, h, borderStyle='none') {
  if (borderStyle === 'soft-white') {
    const mat = Math.max(5, Math.min(9, Math.round(Math.min(w, h) * 0.012)));
    ctx.save();
    ctx.shadowColor = 'rgba(71, 85, 105, .14)';
    ctx.shadowBlur = Math.max(10, mat * 2);
    ctx.fillStyle = 'rgba(255,255,255,.98)';
    roundRect(ctx, x - mat, y - mat, w + mat * 2, h + mat * 2, Math.max(8, mat * 1.6));
    ctx.fill();
    ctx.restore();
  }
  // Never crop or stretch: layout width/height are always derived from the source aspect ratio.
  ctx.drawImage(img, x, y, w, h);
}
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath();
}

function openModal(el) { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

function drawMultiLineTextOnCanvas(ctx, text, x, y, maxWidth, lineHeight, alignH='center', alignV='center', options={}) {
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
    if (options.stroke) ctx.strokeText(line, tx, startY + i * lineHeight);
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
  const colCount = Math.max(1, columnsState.length);
  const safeW = A4_WIDTH - (computeSafeArea(els.frameStyle.value).x) * 2;
  const baseColWidth = colCount > 1
    ? (safeW - getEffectiveColumnGap(getColumnGapValue()) * (colCount - 1)) / colCount
    : safeW;
  const rowGap = getEffectiveRowGap(els.defaultGap.value);
  const targetCol = pickTargetColumnForLayout(
    els.layoutMode.value,
    columnsState,
    baseColWidth,
    rowGap
  );
  pushHistorySnapshot();
  targetCol.items.push(normalizeItem({ id, noGapBelow: false }));
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
  ctx.save();
  ctx.fillStyle = textState.color;
  const fontSize = Math.max(24, bake.width * (textState.fontSizeRatio / 100));
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = Math.max(3, fontSize * .06);
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = Math.max(4, fontSize * .06);
  ctx.shadowOffsetX = Math.max(2, fontSize * .025);
  ctx.shadowOffsetY = Math.max(2, fontSize * .025);
  drawMultiLineTextOnCanvas(ctx, textState.text || ' ', textState.x * (bake.width / els.imageTextPreview.width), textState.y * (bake.height / els.imageTextPreview.height), textState.wrapWidth * (bake.width / els.imageTextPreview.width), fontSize*1.35, textState.alignH, 'center', { stroke: true });
  ctx.restore();
  const originalData = bake.toDataURL('image/jpeg', 0.95);
  imageRegistry[activeImageEditId].originalData = originalData;
  imageRegistry[activeImageEditId].previewData = await createPreview(originalData, 520, 0.94);
  imageRegistry[activeImageEditId].img = await loadImage(originalData);
  closeModal(els.imageTextModal);
  renderKanban();
  stateChanged();
  showStatus('已套用圖片文字；此圖片編輯暫不支援復原', 'info');
}

function showLoading(show) { els.loading.classList.toggle('hidden', !show); }
function showStatus(message, tone='info') {
  const map = {
    info: 'bg-sky-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-400',
    error: 'bg-rose-500'
  };
  els.saveDot.className = `w-3 h-3 rounded-full inline-block ${map[tone] || map.info}`;
  els.saveText.textContent = message;
}
function updateSaveStatus(state) {
  const map = {
    idle:['bg-slate-300','尚未存檔'], saving:['bg-amber-400','儲存中…'], saved:['bg-emerald-500','已自動儲存'], error:['bg-rose-500','存檔失敗']
  };
  els.saveDot.className = `w-3 h-3 rounded-full inline-block ${map[state][0]}`;
  els.saveText.textContent = map[state][1];
}

async function initDB() {
  if (!('indexedDB' in window)) {
    persistenceAvailable = false;
    db = null;
    return;
  }
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    persistenceAvailable = true;
  } catch (err) {
    console.warn('IndexedDB unavailable; continuing without persistence.', err);
    db = null;
    persistenceAvailable = false;
  }
}
function putWorkspace(data) {
  if (!db) return Promise.resolve();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE_NAME,'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(data, WORKSPACE_KEY);
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
}
function getWorkspace() {
  if (!db) return Promise.resolve(null);
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE_NAME,'readonly');
    const req = tx.objectStore(STORE_NAME).get(WORKSPACE_KEY);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
function deleteWorkspace() {
  if (!db) return Promise.resolve();
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
  const referencedIds = new Set(columnsState.flatMap(col => col.items.map(item => item.id)));
  referencedIds.forEach(id => {
    const item = imageRegistry[id];
    if (!item) return;
    images[id] = {
      previewData: item.previewData || item.thumb || item.originalData,
      originalData: item.originalData,
      type: item.type
    };
  });
  return {
    version: 4,
    savedAt: Date.now(),
    settings: {
      ...getSettings(),
      rawDefaultGap: Number(els.defaultGap?.value || DEFAULT_ROW_GAP_RAW),
      rawColumnGap: Number(els.columnGap?.value || DEFAULT_COLUMN_GAP_RAW),
      filename: currentFilename,
      isCustomFilename
    },
    columnsState: structuredClone(columnsState),
    images
  };
}

async function saveWorkspace() {
  if (resetInProgress) return;
  if (!persistenceAvailable || !db) {
    showStatus('本機儲存不可用；目前內容只保留在這個頁面', 'warning');
    return;
  }
  isSaving = true;
  updateSaveStatus('saving');
  try {
    await putWorkspace(buildWorkspacePayload());
    updateSaveStatus('saved');
  } catch (err) {
    console.error(err);
    showStatus('自動儲存失敗，圖片可能太多', 'error');
  } finally {
    isSaving = false;
    if (pendingSaveRequested && !resetInProgress) { pendingSaveRequested = false; await saveWorkspace(); }
  }
}

async function loadWorkspace() {
  showLoading(true);
  try {
    if (!persistenceAvailable || !db) {
      drawTextCardPreview();
      showStatus('本機儲存不可用；仍可排版及下載', 'warning');
      updateHistoryControls();
      return;
    }

    const workspace = await getWorkspace();
    if (!workspace) { drawTextCardPreview(); updateSaveStatus('idle'); updateHistoryControls(); return; }
    els.layoutMode.value = workspace.settings?.layoutMode || '3';
    initColumnsForLayout(els.layoutMode.value);

    const rawDefaultGap = workspace.settings?.rawDefaultGap;
    const rawColumnGap = workspace.settings?.rawColumnGap;
    const legacy = Number(workspace.version || 0) < 4;
    els.defaultGap.value = legacy
      ? getLegacyEffectiveRowGap(rawDefaultGap != null ? rawDefaultGap : 15)
      : (rawDefaultGap != null ? rawDefaultGap : DEFAULT_ROW_GAP_RAW);
    els.columnGap.value = legacy
      ? getLegacyEffectiveColumnGap(rawColumnGap != null ? rawColumnGap : 13)
      : (rawColumnGap != null ? rawColumnGap : DEFAULT_COLUMN_GAP_RAW);
    if (els.spacingMode) {
      const savedMode = workspace.settings?.spacingMode;
      els.spacingMode.value = (!legacy && savedMode && ['tight','normal','airy','custom'].includes(savedMode))
        ? savedMode
        : 'custom';
    }
    syncSpacingControls();

    els.frameStyle.value = workspace.settings?.frameStyle || DEFAULT_FRAME_STYLE;
    if (els.imageBorderStyle) els.imageBorderStyle.value = workspace.settings?.imageBorderStyle || DEFAULT_IMAGE_BORDER_STYLE;
    els.globalBgColor.value = workspace.settings?.globalBgColor || '#f8fafc';
    els.innerBgColor.value = workspace.settings?.innerBgColor || '#ffffff';
    els.patternColor.value = workspace.settings?.patternColor || '#c9a227';
    if (els.authorName) els.authorName.value = workspace.settings?.authorName || DEFAULT_AUTHOR_NAME;
    updateSwatchSelection('globalBgColor', els.globalBgColor.value);
    updateSwatchSelection('innerBgColor', els.innerBgColor.value);
    updateSwatchSelection('patternColor', els.patternColor.value);
    currentFilename = workspace.settings?.filename || defaultFilename();
    isCustomFilename = Boolean(workspace.settings?.isCustomFilename);
    refreshFilename();

    columnsState = normalizeColumnsState(workspace.columnsState || columnsState);
    imageRegistry = {};
    const entries = Object.entries(workspace.images || {});
    const failedIds = [];
    for (const [id, item] of entries) {
      try {
        imageRegistry[id] = {
          ...item,
          previewData: item.previewData || item.thumb || item.originalData,
          img: await loadImage(item.originalData)
        };
      } catch (err) {
        console.warn('Skipping unreadable saved image:', id, err);
        failedIds.push(id);
      }
    }
    if (failedIds.length) {
      const bad = new Set(failedIds);
      columnsState.forEach(col => { col.items = col.items.filter(item => !bad.has(item.id)); });
      showStatus(`已略過 ${failedIds.length} 張損壞的舊圖片，其餘排版已復原`, 'warning');
    } else {
      updateSaveStatus('saved');
    }
    enforcePaletteRows();
    drawTextCardPreview();
    updateHistoryControls();
  } catch (err) {
    console.error(err);
    showStatus('載入本機工作區失敗；可繼續建立新排版', 'error');
  } finally { showLoading(false); }
}

async function clearAll() {
  const ok = window.confirm('確定要重設全部？這會清除圖片、排版與本機自動儲存資料。');
  if (!ok) return;
  resetInProgress = true;
  clearTimeout(autosaveTimer);
  pendingSaveRequested = false;
  try {
    historyState.past = [];
    historyState.future = [];
    pendingControlHistorySnapshots = new WeakMap();
    updateHistoryControls();
    imageRegistry = {};
    isCustomFilename = false;
    currentFilename = defaultFilename();
    els.layoutMode.value = '3';
    initColumnsForLayout('3');
    els.defaultGap.value = DEFAULT_ROW_GAP_RAW; els.columnGap.value = DEFAULT_COLUMN_GAP_RAW; if (els.spacingMode) els.spacingMode.value = 'normal'; syncSpacingControls();
    els.frameStyle.value = DEFAULT_FRAME_STYLE;
    if (els.imageBorderStyle) els.imageBorderStyle.value = DEFAULT_IMAGE_BORDER_STYLE;
    els.globalBgColor.value = '#f8fafc';
    els.innerBgColor.value = '#ffffff';
    els.patternColor.value = '#c9a227';
    if (els.authorName) els.authorName.value = DEFAULT_AUTHOR_NAME;
    updateSwatchSelection('globalBgColor', els.globalBgColor.value);
    updateSwatchSelection('innerBgColor', els.innerBgColor.value);
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
    showStatus('已重設全部', 'success');
  } catch (err) {
    console.error(err);
    updateSaveStatus('error');
  } finally {
    resetInProgress = false;
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function withPngDpi(blob, dpi=300) {
  return blob.arrayBuffer().then(buffer => {
    const src = new Uint8Array(buffer);
    const signature = [137,80,78,71,13,10,26,10];
    if (src.length < 33 || !signature.every((v,i) => src[i] === v)) return blob;
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, 9);
    chunk.set([112,72,89,115], 4); // pHYs
    view.setUint32(8, ppm);
    view.setUint32(12, ppm);
    chunk[16] = 1;
    view.setUint32(17, crc32(chunk.slice(4,17)));
    const insertAt = 33; // immediately after IHDR
    const out = new Uint8Array(src.length + chunk.length);
    out.set(src.slice(0, insertAt), 0);
    out.set(chunk, insertAt);
    out.set(src.slice(insertAt), insertAt + chunk.length);
    return new Blob([out], { type: 'image/png' });
  });
}

function withJpegDpi(blob, dpi=300) {
  return blob.arrayBuffer().then(buffer => {
    const src = new Uint8Array(buffer);
    if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) return blob;
    let pos = 2;
    while (pos + 4 < src.length && src[pos] === 0xff) {
      const marker = src[pos + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const len = (src[pos + 2] << 8) | src[pos + 3];
      if (marker === 0xe0 && len >= 16 &&
          src[pos+4] === 0x4a && src[pos+5] === 0x46 && src[pos+6] === 0x49 && src[pos+7] === 0x46 && src[pos+8] === 0x00) {
        const out = src.slice();
        out[pos + 11] = 1; // dots per inch
        out[pos + 12] = (dpi >> 8) & 0xff;
        out[pos + 13] = dpi & 0xff;
        out[pos + 14] = (dpi >> 8) & 0xff;
        out[pos + 15] = dpi & 0xff;
        return new Blob([out], { type: 'image/jpeg' });
      }
      if (len < 2) break;
      pos += 2 + len;
    }

    const app0 = new Uint8Array([
      0xff,0xe0,0x00,0x10, 0x4a,0x46,0x49,0x46,0x00,
      0x01,0x01, 0x01,
      (dpi >> 8) & 0xff, dpi & 0xff,
      (dpi >> 8) & 0xff, dpi & 0xff,
      0x00,0x00
    ]);
    const out = new Uint8Array(src.length + app0.length);
    out.set(src.slice(0, 2), 0);
    out.set(app0, 2);
    out.set(src.slice(2), 2 + app0.length);
    return new Blob([out], { type: 'image/jpeg' });
  });
}

function downloadCanvas() {
  if (!els.collageCanvas) return;

  const format = els.outputFormat?.value || 'jpeg';
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  showStatus(`正在製作 ${ext.toUpperCase()} 300DPI 檔案…`, 'info');

  els.collageCanvas.toBlob(async (blob) => {
    if (!blob) {
      showStatus('下載失敗，請再試一次', 'error');
      return;
    }
    try {
      const tagged = format === 'jpeg'
        ? await withJpegDpi(blob, 300)
        : await withPngDpi(blob, 300);
      const url = URL.createObjectURL(tagged);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(currentFilename || defaultFilename())}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      showStatus(`${ext.toUpperCase()} 2480×3508／300DPI 已開始下載`, 'success');
    } catch (err) {
      console.error(err);
      showStatus('下載失敗，請再試一次', 'error');
    }
  }, mimeType, 0.98);
}



function setOfflineBadge(text, state='ready') {
  if (!els.offlineModeBadge) return;
  els.offlineModeBadge.textContent = text;
  els.offlineModeBadge.dataset.state = state;
}

async function setupOfflineMode() {
  if (!('serviceWorker' in navigator)) {
    setOfflineBadge('此瀏覽器不支援離線鎖定', 'error');
    if (els.updateAppBtn) els.updateAppBtn.disabled = true;
    return;
  }
  if (!window.isSecureContext) {
    setOfflineBadge('需 HTTPS 才可離線鎖定', 'error');
    if (els.updateAppBtn) els.updateAppBtn.disabled = true;
    return;
  }
  try {
    let reg = await navigator.serviceWorker.getRegistration('./');
    if (!reg) {
      reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'all' });
      await navigator.serviceWorker.ready;
    }
    if (navigator.serviceWorker.controller) {
      setOfflineBadge('離線鎖定已啟用', 'ready');
    } else {
      setOfflineBadge('離線已安裝・重開後鎖定', 'pending');
    }
  } catch (err) {
    console.error('Service worker setup failed:', err);
    setOfflineBadge('離線安裝失敗', 'error');
  }
}

async function requestManualAppUpdate() {
  if (!('serviceWorker' in navigator)) return;
  const ok = window.confirm('更新程式時會暫時連線下載最新檔案。完成後會重新載入；平時不會用網絡讀取 App 檔案。是否現在更新？');
  if (!ok) return;
  if (els.updateAppBtn) els.updateAppBtn.disabled = true;
  setOfflineBadge('正在連線更新…', 'updating');
  showStatus('正在檢查及下載完整更新；完成前會保留目前版本', 'info');

  try {
    let reg = await navigator.serviceWorker.getRegistration('./');
    if (!reg) {
      reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'all' });
      await navigator.serviceWorker.ready;
    }
    const worker = reg.active || reg.waiting || reg.installing;
    if (!worker) throw new Error('No active service worker');

    const channel = new MessageChannel();
    const response = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Update timeout')), 120000);
      channel.port1.onmessage = event => {
        window.clearTimeout(timer);
        if (event.data?.ok) resolve(event.data);
        else reject(new Error(event.data?.error || 'Update failed'));
      };
    });
    worker.postMessage({ type: 'MANUAL_REFRESH' }, [channel.port2]);
    await response;

    // Only this explicit user action asks the browser to check whether sw.js itself changed.
    await reg.update();
    const candidate = reg.installing || reg.waiting;
    if (candidate && candidate.state !== 'activated') {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(resolve, 30000);
        const onState = () => {
          if (candidate.state === 'activated') { window.clearTimeout(timer); resolve(); }
          if (candidate.state === 'redundant') { window.clearTimeout(timer); reject(new Error('New service worker became redundant')); }
        };
        candidate.addEventListener('statechange', onState);
        onState();
      });
    }
    setOfflineBadge('更新完成', 'ready');
    showStatus('更新完成，正在重新載入新版本…', 'success');
    window.setTimeout(() => window.location.reload(), 350);
  } catch (err) {
    console.error(err);
    setOfflineBadge('更新失敗・仍用舊版', 'error');
    showStatus('更新失敗；完整舊版本仍然保留，請確認伺服器／網絡後再試', 'error');
    if (els.updateAppBtn) els.updateAppBtn.disabled = false;
  }
}

// ===== CUSTOM DRAG ENGINE v1.2 =====
const dragRuntime = {
  pointerId: null,
  captureElement: null,
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
  moved: false,
  lastClientX: 0,
  lastClientY: 0,
  dragRafId: null,
  lastDropKey: null,
  lastDropList: null,
  lastDropRelated: null,
  lastDropAfter: null
};

function isInteractiveTarget(el) {
  if (el.closest('.kanban-drag-handle')) return false;
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
  overlay.className = 'a4-drag-preview';

  const thumbSrc =
    card.querySelector('.kanban-thumb')?.getAttribute('src') || '';

  overlay.innerHTML = thumbSrc
    ? `<img class="a4-drag-preview-image" src="${thumbSrc}" alt="">`
    : '';

  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '96px';
  overlay.style.height = '96px';
  overlay.style.margin = '0';
  overlay.style.padding = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '99999';
  overlay.style.opacity = '0.97';
  overlay.style.transform = 'translate3d(-9999px,-9999px,0)';
  overlay.style.boxSizing = 'border-box';

  return overlay;
}

function lockDragPreviewGeometry(overlay) {
  if (!overlay) return;

  const forced = [
    ['position', 'fixed'],
    ['display', 'block'],
    ['width', '96px'],
    ['min-width', '96px'],
    ['max-width', '96px'],
    ['height', '96px'],
    ['min-height', '96px'],
    ['max-height', '96px'],
    ['margin', '0'],
    ['padding', '0'],
    ['overflow', 'hidden'],
    ['box-sizing', 'border-box'],
    ['pointer-events', 'none'],
    ['z-index', '99999']
  ];

  forced.forEach(([property, value]) => {
    overlay.style.setProperty(property, value, 'important');
  });

  const image = overlay.querySelector('.a4-drag-preview-image');

  if (image) {
    [
      ['display', 'block'],
      ['width', '96px'],
      ['min-width', '96px'],
      ['max-width', '96px'],
      ['height', '96px'],
      ['min-height', '96px'],
      ['max-height', '96px'],
      ['object-fit', 'contain'],
      ['box-sizing', 'border-box']
    ].forEach(([property, value]) => {
      image.style.setProperty(property, value, 'important');
    });
  }
}

function updateOverlayPosition(clientX, clientY) {
  if (!dragRuntime.overlay) return;
  const x = clientX - dragRuntime.offsetX;
  const y = clientY - dragRuntime.offsetY;
  dragRuntime.overlay.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.015)`;
}

function clearDragClasses() {
  document.body.classList.remove('kanban-drag-active', 'kanban-sort-lock', 'kanban-actually-dragging');
  document.querySelectorAll('.kanban-list').forEach(list => list.classList.remove('is-drop-target'));
  document.querySelectorAll('.kanban-item').forEach(item => item.classList.remove('drop-before', 'drop-after', 'is-drag-source'));
}

function clearCurrentDropTarget() {
  dragRuntime.lastDropList?.classList.remove('is-drop-target');
  dragRuntime.lastDropRelated?.classList.remove(dragRuntime.lastDropAfter ? 'drop-after' : 'drop-before');
  dragRuntime.lastDropKey = null;
  dragRuntime.lastDropList = null;
  dragRuntime.lastDropRelated = null;
  dragRuntime.lastDropAfter = null;
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
  const dropKey = `${pos.col}:${pos.related?.dataset.id || '__end__'}:${pos.after ? 'after' : 'before'}`;
  if (dropKey === dragRuntime.lastDropKey) return;
  clearCurrentDropTarget();

  pos.list.classList.add('is-drop-target');

  if (pos.related) {
    pos.related.classList.add(pos.after ? 'drop-after' : 'drop-before');
    pos.list.insertBefore(dragRuntime.placeholder, pos.after ? pos.related.nextSibling : pos.related);
  } else {
    pos.list.appendChild(dragRuntime.placeholder);
  }

  dragRuntime.targetCol = pos.col;
  dragRuntime.targetIndex = pos.insertIndex;
  dragRuntime.lastDropKey = dropKey;
  dragRuntime.lastDropList = pos.list;
  dragRuntime.lastDropRelated = pos.related;
  dragRuntime.lastDropAfter = pos.after;
}

function onKanbanPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const dragHandle = e.target.closest('.kanban-drag-handle');
  const dragContent = e.target.closest('.kanban-drag-content');
  if (e.pointerType === 'touch' && !dragHandle) return;
  if (!dragHandle && isInteractiveTarget(e.target)) return;
  const handle = dragHandle || dragContent;
  if (!handle || !els.kanbanBoard.contains(handle)) return;
  const card = e.target.closest('.kanban-item');
  if (!card) return;

  const id = card.dataset.id;
  const pos = findItemPositionById(id);
  if (!pos) return;

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
  dragRuntime.lastClientX = e.clientX;
  dragRuntime.lastClientY = e.clientY;
  dragRuntime.captureElement = handle;

  try { handle.setPointerCapture?.(e.pointerId); } catch {}
  document.addEventListener('pointermove', onKanbanPointerMove, { passive: false });
  document.addEventListener('pointerup', onKanbanPointerUp, { passive: false, once: false });
  document.addEventListener('pointercancel', onKanbanPointerCancel, { passive: false, once: false });
}

function beginDrag(card, clientX, clientY) {
  const rect = card.getBoundingClientRect();
  dragRuntime.active = true;
  dragRuntime.overlay = buildOverlay(card, rect);
  dragRuntime.placeholder = buildPlaceholder(rect);
  card.classList.add('is-drag-source');
  card.style.display = 'none';
  document.body.appendChild(dragRuntime.overlay);
  lockDragPreviewGeometry(dragRuntime.overlay);
  requestAnimationFrame(() => {
    if (!dragRuntime.overlay) return;

    lockDragPreviewGeometry(dragRuntime.overlay);

    const rect = dragRuntime.overlay.getBoundingClientRect();

    if (rect.width > 110 || rect.height > 110) {
      console.warn(
        '[A4 drag preview geometry mismatch]',
        {
          build: APP_BUILD,
          width: rect.width,
          height: rect.height,
          className: dragRuntime.overlay.className
        }
      );
    }
  });
  card.parentElement?.insertBefore(dragRuntime.placeholder, card.nextSibling);
  document.body.classList.add('kanban-drag-active', 'kanban-sort-lock', 'kanban-actually-dragging');
  updateOverlayPosition(clientX, clientY);
}

function scheduleKanbanDragFrame() {
  if (dragRuntime.dragRafId != null) return;
  dragRuntime.dragRafId = requestAnimationFrame(flushKanbanDragFrame);
}

function updateKanbanAutoScroll(clientX, clientY) {
  let scrolled = false;
  const viewportEdge = 56;
  if (clientY < viewportEdge) {
    const speed = Math.max(-18, Math.round((clientY - viewportEdge) * 0.22));
    if (speed) {
      window.scrollBy(0, speed);
      scrolled = true;
    }
  } else if (clientY > window.innerHeight - viewportEdge) {
    const speed = Math.min(18, Math.round((clientY - (window.innerHeight - viewportEdge)) * 0.22));
    if (speed) {
      window.scrollBy(0, speed);
      scrolled = true;
    }
  }

  const board = els.kanbanBoard;
  if (!board || board.scrollWidth <= board.clientWidth) return scrolled;
  const rect = board.getBoundingClientRect();
  const boardEdge = 48;
  if (clientX < rect.left + boardEdge) {
    const speed = Math.max(-16, Math.round((clientX - (rect.left + boardEdge)) * 0.2));
    if (speed) {
      board.scrollLeft += speed;
      scrolled = true;
    }
  } else if (clientX > rect.right - boardEdge) {
    const speed = Math.min(16, Math.round((clientX - (rect.right - boardEdge)) * 0.2));
    if (speed) {
      board.scrollLeft += speed;
      scrolled = true;
    }
  }
  return scrolled;
}

function flushKanbanDragFrame() {
  dragRuntime.dragRafId = null;
  if (!dragRuntime.active) return;
  const { lastClientX, lastClientY } = dragRuntime;
  updateOverlayPosition(lastClientX, lastClientY);
  const pos = getDropPosition(lastClientX, lastClientY);
  if (pos) movePlaceholder(pos);
  if (updateKanbanAutoScroll(lastClientX, lastClientY)) scheduleKanbanDragFrame();
}

function onKanbanPointerMove(e) {
  if (e.pointerId !== dragRuntime.pointerId) return;
  const sourceCard = document.querySelector(`.kanban-item[data-id="${dragRuntime.sourceId}"]`);
  if (!sourceCard) return;
  const dx = e.clientX - dragRuntime.startX;
  const dy = e.clientY - dragRuntime.startY;
  const dist = Math.hypot(dx, dy);

  if (!dragRuntime.active) {
    const dragThreshold = e.pointerType === 'touch' ? 10 : 4;
    if (dist < dragThreshold) return;
    e.preventDefault();
    beginDrag(sourceCard, e.clientX, e.clientY);
  } else {
    e.preventDefault();
  }

  dragRuntime.moved = true;
  dragRuntime.lastClientX = e.clientX;
  dragRuntime.lastClientY = e.clientY;
  scheduleKanbanDragFrame();
}

function finalizeDrag() {
  const { sourceId, sourceCol, sourceIndex, targetCol, targetIndex } = dragRuntime;
  if (sourceId == null) return false;

  if (targetCol !== -1 && sourceCol !== -1 && targetIndex !== -1) {
    let finalInsertIndex = targetIndex;
    if (sourceCol === targetCol && sourceIndex < targetIndex) {
      finalInsertIndex -= 1;
    }

    const isNoOp = sourceCol === targetCol && finalInsertIndex === sourceIndex;
    if (isNoOp) return false;

    pushHistorySnapshot();
    const sourceItems = columnsState[sourceCol].items;
    setNoGapAfterItem(sourceItems[sourceIndex - 1], false);
    setNoGapAfterItem(sourceItems[sourceIndex], false);
    const [moved] = sourceItems.splice(sourceIndex, 1);
    if (moved) {
      const insertIndex = Math.max(0, Math.min(finalInsertIndex, columnsState[targetCol].items.length));
      const targetItems = columnsState[targetCol].items;
      setNoGapAfterItem(targetItems[insertIndex - 1], false);
      targetItems.splice(insertIndex, 0, moved);
      return true;
    }
  }
  return false;
}

function resetDragRuntime() {
  const prevSourceId = dragRuntime.sourceId;
  const prevPointerId = dragRuntime.pointerId;
  const prevCaptureElement = dragRuntime.captureElement;
  if (dragRuntime.dragRafId != null) {
    cancelAnimationFrame(dragRuntime.dragRafId);
    dragRuntime.dragRafId = null;
  }
  try {
    if (prevPointerId != null && prevCaptureElement?.hasPointerCapture?.(prevPointerId)) {
      prevCaptureElement.releasePointerCapture(prevPointerId);
    }
  } catch {}
  document.removeEventListener('pointermove', onKanbanPointerMove);
  document.removeEventListener('pointerup', onKanbanPointerUp);
  document.removeEventListener('pointercancel', onKanbanPointerCancel);
  dragRuntime.pointerId = null;
  dragRuntime.captureElement = null;
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
  if (src) src.style.display = '';
  clearCurrentDropTarget();
  clearDragClasses();
}

function onKanbanPointerUp(e) {
  if (dragRuntime.pointerId !== null && e.pointerId !== dragRuntime.pointerId) return;

  if (dragRuntime.active && dragRuntime.moved) {
    if (dragRuntime.dragRafId != null) {
      cancelAnimationFrame(dragRuntime.dragRafId);
      flushKanbanDragFrame();
    }
    const droppedId = dragRuntime.sourceId;
    const didChange = finalizeDrag();
    resetDragRuntime();
    if (didChange) {
      renderKanban();
    }
    if (didChange && droppedId) {
      const dropped = document.querySelector(`.kanban-item[data-id="${droppedId}"]`);
      dropped?.classList.add('kanban-just-dropped');
      window.setTimeout(() => dropped?.classList.remove('kanban-just-dropped'), 260);
    }
    if (didChange) stateChanged();
  } else {
    resetDragRuntime();
  }
}

function onKanbanPointerCancel(e) {
  if (dragRuntime.pointerId !== null && e.pointerId !== dragRuntime.pointerId) return;
  resetDragRuntime();
}

function cancelKanbanDrag() {
  if (dragRuntime.pointerId == null && !dragRuntime.active) return;
  resetDragRuntime();
}

function onKanbanKeyDown(e) {
  if (e.key === 'Escape') {
    if (dragRuntime.pointerId == null && !dragRuntime.active) return;
    e.preventDefault();
    resetDragRuntime();
    return;
  }

  if (hasOpenModal() || isEditableShortcutTarget(e.target)) return;
  const key = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  const wantsUndo = mod && key === 'z' && !e.shiftKey;
  const wantsRedo = (mod && key === 'z' && e.shiftKey) || (e.ctrlKey && key === 'y');
  if (wantsUndo && historyState.past.length) {
    e.preventDefault();
    undo();
  } else if (wantsRedo && historyState.future.length) {
    e.preventDefault();
    redo();
  }
}
// ===== END CUSTOM DRAG ENGINE v1.2 =====
