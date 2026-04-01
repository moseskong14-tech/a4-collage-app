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

const textState = {
  text: '', color: '#ffffff', fontSizeRatio: 7, wrapWidth: 680,
  x: 500, y: 700, alignH: 'center', actualWidth: 0, actualHeight: 0
};
const dragState = { active: false, action: null, startX: 0, startY: 0, startWrap: 680, startRatio: 7, startTextX: 0, startTextY: 0 };

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheEls();
  bindEvents();
  setupMobileUI();
  initColumnsForLayout('3');
  refreshFilename();
  await initDB();
  await loadWorkspace();
  renderKanban();
  throttledDrawCanvas();
});

function cacheEls() {
  [
    'imageInput','openTextCardBtn','resetBtn','layoutMode','defaultGap','gapValue','frameStyle','globalBgColor','innerBgColor','patternColor',
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
  els.defaultGap.addEventListener('input', () => { els.gapValue.textContent = els.defaultGap.value; throttledDrawCanvas(); triggerAutoSave(); });
  ['frameStyle','globalBgColor','innerBgColor','patternColor'].forEach(id => els[id].addEventListener('input', stateChanged));
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
    stateChanged();
  }));
  ['imageTextContent','imageTextColor','imageTextSize','imageTextAlign'].forEach(id => els[id].addEventListener('input', syncImageTextControls));
  document.querySelectorAll('.quick-y-btn').forEach(btn => btn.addEventListener('click', () => setQuickY(btn.dataset.quickY)));
  els.applyImageTextBtn.addEventListener('click', applyImageText);
  bindImageTextCanvas();
}

function stateChanged() {
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
  els.kanbanBoard.className = `grid grid-cols-1 md:grid-cols-2 ${colClass} gap-4`;

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
        <div class="kanban-row-shell">
          <div class="kanban-card-left">
            <div class="kanban-thumb-shell kanban-handle" title="按住拖曳排序">
              <img class="kanban-thumb" src="${reg.previewData || reg.thumb || reg.originalData}" alt="thumb" loading="lazy" decoding="async">
            </div>
            <div class="kanban-order-rail">${itemIndex + 1}</div>
            <button class="kanban-mini-icon ${item.noGapBelow ? 'is-active' : ''} toggle-gap-btn" data-id="${item.id}" title="${item.noGapBelow ? '已貼齊' : '無縫貼齊'}">
              <i class="fa-solid fa-link"></i>
            </button>
            ${reg.type === 'image' ? `<button class="kanban-mini-icon edit-btn" data-id="${item.id}" title="加字"><i class="fa-solid fa-pen-nib"></i></button>` : `<div class="kanban-mini-spacer"></div>`}
            <button class="kanban-mini-icon is-danger delete-btn" data-id="${item.id}" title="刪除"><i class="fa-solid fa-trash"></i></button>
          </div>
          <div class="kanban-card-right">
            <div class="kanban-chip-row">
              <span class="kanban-type-chip ${reg.type === 'textCard' ? 'is-text' : ''}">${reg.type === 'textCard' ? '文字卡' : '圖片'}</span>
              <span class="kanban-sub-chip">高清預覽</span>
            </div>
            <div class="kanban-item-title">${reg.type === 'textCard' ? '文字卡紙' : '圖片項目'}</div>
            <div class="kanban-item-sub">縮細顯示 · 保持高解像預覽</div>
          </div>
        </div>
      `;
      list.appendChild(card);
    });

    new Sortable(list, {
      group: 'kanban',
      animation: 220,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      handle: '.kanban-handle',
      draggable: '.kanban-item',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      forceFallback: true,
      fallbackOnBody: true,
      swapThreshold: 0.2,
      invertSwap: true,
      invertedSwapThreshold: 0.45,
      delayOnTouchOnly: true,
      delay: 120,
      touchStartThreshold: 4,
      scroll: true,
      bubbleScroll: true,
      emptyInsertThreshold: 18,
      onChoose: evt => handleSortChoose(evt),
      onUnchoose: () => clearDropIndicators(),
      onStart: evt => handleSortStart(evt),
      onMove: evt => handleSortMove(evt),
      onEnd: evt => handleSortEnd(evt)
    });
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
  document.body.classList.add('kanban-drag-active');
  evt.item.classList.add('is-lifted');
}

function handleSortStart(evt) {
  document.body.classList.add('kanban-drag-active');
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
  evt.item?.classList.remove('is-lifted');
  evt.item?.style.removeProperty('width');
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
    defaultGap: Number(els.defaultGap.value),
    frameStyle: els.frameStyle.value,
    globalBgColor: els.globalBgColor.value,
    innerBgColor: els.innerBgColor.value,
    patternColor: els.patternColor.value,
    whiteBorderEnabled: getWhiteBorderEnabled()
  };
}

function drawBackgroundAndFrame(ctx, s) {
  ctx.fillStyle = s.globalBgColor;
  ctx.fillRect(0,0,A4_WIDTH,A4_HEIGHT);
  let margin = 90;
  const floral = ['watercolor-floral','spring-daisy','rose-garden','fresh-vine','ginkgo','sakura','hydrangea'];
  if (floral.includes(s.frameStyle)) {
    margin = 170;
    drawProceduralFrame(ctx, s.frameStyle, s.patternColor);
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.1)';
    ctx.shadowBlur = 18;
    roundRect(ctx, 170, 170, A4_WIDTH-340, A4_HEIGHT-340, 20);
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
  if (style === 'fresh-vine') {
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

function measureBlock(block, colWidth, gap) {
  const metrics = [];
  let total = 0;
  block.forEach((item, idx) => {
    const img = imageRegistry[item.id]?.img; if (!img) return;
    const h = colWidth * (img.height / img.width);
    metrics.push({ id: item.id, height: h });
    total += h + (idx < block.length - 1 ? 0 : 0);
  });
  return { metrics, totalHeight: total, bottomGap: gap };
}

function drawStandardLayout(ctx, settings, safeX, safeY, safeW, safeH) {
  const colCount = columnsState.length;
  const colGap = 18;
  const colWidth = (safeW - colGap * (colCount - 1)) / colCount;
  const blockData = columnsState.map(col => {
    const blocks = createBlocks(col.items).map(b => measureBlock(b, colWidth, settings.defaultGap));
    const virtualHeight = blocks.reduce((sum,b,i) => sum + b.totalHeight + (i < blocks.length - 1 ? settings.defaultGap : 0), 0);
    return { blocks, virtualHeight };
  });
  const maxH = Math.max(1, ...blockData.map(b => b.virtualHeight));
  const scale = Math.min(1, safeH / maxH);

  columnsState.forEach((col, cidx) => {
    const x = safeX + cidx * (colWidth + colGap);
    const colH = blockData[cidx].virtualHeight * scale;
    let y = safeY;
    if (col.align === 'center') y = safeY + (safeH - colH) / 2;
    if (col.align === 'bottom') y = safeY + (safeH - colH);
    createBlocks(col.items).forEach((block, bidx) => {
      const metric = measureBlock(block, colWidth, settings.defaultGap);
      const blockHeight = metric.totalHeight * scale;
      if (settings.whiteBorderEnabled && block.length) drawBlockBg(ctx, x, y, colWidth, blockHeight, scale);
      block.forEach((item, idx) => {
        const img = imageRegistry[item.id]?.img; if (!img) return;
        const h = colWidth * scale * (img.height / img.width);
        drawImageRounded(ctx, img, x, y, colWidth, h, item.noGapBelow ? 8 : 18);
        y += h;
      });
      y += settings.defaultGap * scale;
    });
  });
}

function drawSpecialLayout(ctx, settings, safeX, safeY, safeW, safeH) {
  const topGap = 18;
  const colWidth = (safeW - topGap) / 2;
  const topHeights = [0,1].map(i => columnsState[i]?.items.reduce((sum,item,idx)=>{ const img = imageRegistry[item.id]?.img; if(!img) return sum; return sum + colWidth * (img.height/img.width) + (idx < columnsState[i].items.length - 1 ? settings.defaultGap : 0);},0) || 0);
  const bottomWidth = safeW * .68;
  const bottomHeight = columnsState[2]?.items.reduce((sum,item,idx)=>{ const img = imageRegistry[item.id]?.img; if(!img) return sum; return sum + bottomWidth * (img.height/img.width) + (idx < columnsState[2].items.length - 1 ? settings.defaultGap : 0);},0) || 0;
  const totalH = Math.max(...topHeights) + settings.defaultGap + bottomHeight;
  const scale = Math.min(1, safeH / Math.max(totalH, 1));
  const topY = safeY + (safeH - totalH*scale)/2;

  [0,1].forEach(i => {
    let y = topY;
    const x = safeX + i * (colWidth + topGap);
    columnsState[i].items.forEach(item => {
      const img = imageRegistry[item.id]?.img; if(!img) return;
      const h = colWidth * scale * (img.height / img.width);
      drawImageRounded(ctx, img, x, y, colWidth, h, 18);
      y += h + settings.defaultGap * scale;
    });
  });
  const bottomX = safeX + (safeW - bottomWidth) / 2;
  let bottomY = topY + Math.max(...topHeights) * scale + settings.defaultGap * scale;
  columnsState[2].items.forEach(item => {
    const img = imageRegistry[item.id]?.img; if(!img) return;
    const h = bottomWidth * scale * (img.height / img.width);
    drawImageRounded(ctx, img, bottomX, bottomY, bottomWidth, h, 18);
    bottomY += h + settings.defaultGap * scale;
  });
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
    version: 2,
    savedAt: Date.now(),
    settings: { ...getSettings(), filename: currentFilename, isCustomFilename },
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
    els.defaultGap.value = workspace.settings?.defaultGap ?? 12;
    els.gapValue.textContent = els.defaultGap.value;
    els.frameStyle.value = workspace.settings?.frameStyle || 'watercolor-floral';
    els.globalBgColor.value = workspace.settings?.globalBgColor || '#f8fafc';
    els.innerBgColor.value = workspace.settings?.innerBgColor || '#ffffff';
    els.patternColor.value = workspace.settings?.patternColor || '#c9a227';
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
    els.defaultGap.value = 12; els.gapValue.textContent = '12';
    els.frameStyle.value = 'watercolor-floral';
    els.globalBgColor.value = '#f8fafc';
    els.innerBgColor.value = '#ffffff';
    els.patternColor.value = '#c9a227';
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
