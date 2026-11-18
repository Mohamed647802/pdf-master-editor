import {
  uploadPDF, renderPage, getThumbnail, getPDFBlob, getOriginalFilename,
  addText, addImage, drawShape, highlightText, strikethroughText, underlineText, addStickyNote,
  addBlankPage as apiAddBlankPage,
  duplicatePage as apiDuplicatePage,
  deletePage as apiDeletePage,
  reorderPages as apiReorderPages,
  rotatePage as apiRotatePage,
  mergePDFs, splitPDF, compressPDF, convertToDocx,
  convertToImages as apiConvertToImages,
  convertToText, addWatermark, addHeaderFooter,
  getBookmarks, addBookmark, addPassword, getMetadata, updateMetadata,
  fillForms, runOCR
} from './utils/api.js';

import { buildToolbar } from './components/Toolbar.js';
import { buildModals } from './components/Modals.js';
import { buildLeftSidebar, renderThumbnails } from './components/LeftSidebar.js';
import { buildRightSidebar, updateRightSidebar } from './components/RightSidebar.js';
import { buildPDFViewer, initDrawCanvas } from './components/PDFViewer.js';

// ─── STATE ───────────────────────────────────────────────────
const state = {
  currentFile: null,
  currentPage: 0,
  totalPages: 0,
  zoom: 1.5,
  tool: 'select',
  drawShape: 'rectangle',
  history: [],
  historyIndex: -1,
  darkMode: true,
  isDrawing: false,
  drawStart: null,
  annotations: [],
  pageImages: {},
  thumbnails: {},
  drawSettings: {
    strokeColor: '#6366F1',
    fillColor: '#A78BFA',
    strokeWidth: 2,
    filled: false,
    highlightColor: '#FFFF00'
  },
  textSettings: {
    font: 'helv',
    size: 12,
    color: '#000000',
    bold: false,
    italic: false,
    underline: false
  },
  pendingClickX: 0,
  pendingClickY: 0,
  mergeFiles: [],
  splitTotalPages: 0,
};

// ─── LOAD PDF ─────────────────────────────────────────────────
async function loadPDF(file) {
  showLoading(true);
  showToast('⬆ Uploading PDF...', 'info');
  try {
    const result = await uploadPDF(file);
    state.currentFile = result.filename;
    state.totalPages = result.total_pages;
    state.currentPage = 0;
    state.thumbnails = {};
    state.pageImages = {};

    addToHistory({ type: 'load', filename: result.filename });

    // Show page nav
    document.getElementById('page-nav').style.display = 'flex';
    document.getElementById('viewer-empty').style.display = 'none';
    document.getElementById('page-display').style.display = 'block';

    // Update status bar
    updateStatusBar();

    // Render first page
    await renderCurrentPage();

    // Load thumbnails asynchronously
    renderThumbnailsAsync();

    showToast(`✅ Loaded: ${file.name} (${result.total_pages} pages)`, 'success');
  } catch (err) {
    showToast(`❌ Failed to load: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function renderCurrentPage() {
  if (!state.currentFile) return;
  showLoading(true);
  try {
    const result = await renderPage(state.currentFile, state.currentPage, state.zoom);
    const img = document.getElementById('pdf-page-img');
    if (img) {
      img.src = `data:image/png;base64,${result.image}`;
      img.onload = () => {
        // Resize draw canvas to match
        const canvas = document.getElementById('draw-canvas');
        if (canvas) {
          canvas.width = img.clientWidth;
          canvas.height = img.clientHeight;
          canvas.style.width = img.clientWidth + 'px';
          canvas.style.height = img.clientHeight + 'px';
        }
      };
    }

    // Update nav
    const navInfo = document.getElementById('nav-info');
    if (navInfo) navInfo.textContent = `${state.currentPage + 1} / ${state.totalPages}`;
    document.getElementById('btn-prev').disabled = state.currentPage === 0;
    document.getElementById('btn-next').disabled = state.currentPage >= state.totalPages - 1;

    updateStatusBar();
    updateRightSidebar(state);
  } catch (err) {
    showToast(`❌ Render failed: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function renderThumbnailsAsync() {
  renderThumbnails(state);
  for (let i = 0; i < state.totalPages; i++) {
    try {
      const result = await getThumbnail(state.currentFile, i);
      state.thumbnails[i] = result.image;
      renderThumbnails(state);
    } catch (e) {
      // skip failed thumbnails
    }
  }
}

// ─── TOOL MANAGEMENT ─────────────────────────────────────────
function setTool(tool) {
  state.tool = tool;

  // Update toolbar active state
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('tool-active'));
  const activeBtn = document.querySelector(`[data-tool="${tool}"]`);
  if (activeBtn) activeBtn.classList.add('tool-active');

  // Update cursor
  const canvas = document.getElementById('draw-canvas');
  if (canvas) {
    const cursors = { select: 'default', text: 'text', draw: 'crosshair', highlight: 'crosshair', sticky: 'cell', image: 'copy', pan: 'grab', strikethrough: 'crosshair', underline: 'crosshair' };
    canvas.style.cursor = cursors[tool] || 'default';
  }

  updateRightSidebar(state);
  updateStatusBar();
}

function setDrawShape(shape) {
  state.drawShape = shape;
  const shapeSelect = document.getElementById('draw-shape');
  const rsShapeSelect = document.getElementById('rs-draw-shape');
  if (shapeSelect) shapeSelect.value = shape;
  if (rsShapeSelect) rsShapeSelect.value = shape;
  closeAllDropdowns();
  showToast(`Shape: ${shape}`, 'info');
}

function toggleDropdown(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) el.classList.add('open');
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu.open').forEach(d => d.classList.remove('open'));
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.toolbar-btn-group')) closeAllDropdowns();
});

// ─── NAVIGATION ───────────────────────────────────────────────
function navigatePage(delta) {
  const newPage = state.currentPage + delta;
  if (newPage < 0 || newPage >= state.totalPages) return;
  navigateToPage(newPage);
}

function navigateToPage(page) {
  if (page < 0 || page >= state.totalPages) return;
  state.currentPage = page;
  renderCurrentPage();
  renderThumbnails(state);
}

// ─── ZOOM ─────────────────────────────────────────────────────
function setZoom(value) {
  state.zoom = Math.max(0.25, Math.min(4.0, parseFloat(value.toFixed(2))));
  const pct = `${Math.round(state.zoom * 100)}%`;
  const zoomDisp = document.getElementById('zoom-display');
  const zoomSel = document.getElementById('zoom-select');
  const rightZoom = document.getElementById('right-zoom-slider');
  const rightZoomDisp = document.getElementById('right-zoom-display');
  if (zoomDisp) zoomDisp.textContent = pct;
  if (zoomSel) {
    const opt = [...zoomSel.options].find(o => parseFloat(o.value) === state.zoom);
    if (opt) zoomSel.value = state.zoom;
  }
  if (rightZoom) rightZoom.value = state.zoom;
  if (rightZoomDisp) rightZoomDisp.textContent = pct;
  updateStatusBar();
  renderCurrentPage();
}

// ─── HISTORY ──────────────────────────────────────────────────
function addToHistory(action) {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push({
    ...action,
    filename: state.currentFile,
    totalPages: state.totalPages,
    timestamp: Date.now()
  });
  state.historyIndex = state.history.length - 1;
  autoSave();
}

function undo() {
  if (state.historyIndex <= 0) { showToast('Nothing to undo', 'warning'); return; }
  state.historyIndex--;
  const entry = state.history[state.historyIndex];
  if (entry?.filename) {
    state.currentFile = entry.filename;
    state.totalPages = entry.totalPages || state.totalPages;
    if (state.currentPage >= state.totalPages) state.currentPage = Math.max(0, state.totalPages - 1);
    state.thumbnails = {};
    renderThumbnailsAsync();
  }
  showToast('↩ Undo', 'info');
  renderCurrentPage();
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) { showToast('Nothing to redo', 'warning'); return; }
  state.historyIndex++;
  const entry = state.history[state.historyIndex];
  if (entry?.filename) {
    state.currentFile = entry.filename;
    state.totalPages = entry.totalPages || state.totalPages;
    if (state.currentPage >= state.totalPages) state.currentPage = Math.max(0, state.totalPages - 1);
    state.thumbnails = {};
    renderThumbnailsAsync();
  }
  showToast('↪ Redo', 'info');
  renderCurrentPage();
}

// ─── MODAL ────────────────────────────────────────────────────
function showModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('open');
    el.style.display = 'flex';
    // Pre-fill split total pages
    if (id === 'modal-split') {
      const el2 = document.getElementById('split-total-pages');
      if (el2) el2.textContent = state.totalPages || '-';
    }
    // Pre-fill metadata
    if (id === 'modal-metadata' && state.currentFile) {
      loadMetadata();
    }
  }
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    el.style.display = 'none';
  }
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    e.target.style.display = 'none';
  }
});

// ─── TOAST ────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-message">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 220);
  }, 3500);
}

// ─── STATUS BAR ───────────────────────────────────────────────
function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  if (!bar) return;
  bar.innerHTML = `
    <span class="status-item">📄 ${state.currentFile ? state.currentFile.split('/').pop() : 'No file'}</span>
    <span class="status-sep"></span>
    <span class="status-item">Page: ${state.totalPages > 0 ? state.currentPage + 1 : 0} / ${state.totalPages}</span>
    <span class="status-sep"></span>
    <span class="status-item">Zoom: ${Math.round(state.zoom * 100)}%</span>
    <span class="status-sep"></span>
    <span class="status-item">Tool: ${state.tool}</span>
    <span class="status-sep"></span>
    <span class="status-item">Shape: ${state.drawShape}</span>
  `;
}

// ─── LOADING ──────────────────────────────────────────────────
function showLoading(show) {
  const el = document.getElementById('page-loading');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
}

// ─── FILE SAVE / DOWNLOAD ─────────────────────────────────────
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function downloadFile(blob, name) {
  if (window.AndroidBridge && typeof window.AndroidBridge.saveBase64File === 'function') {
    const dataUrl = await blobToDataURL(blob);
    window.AndroidBridge.saveBase64File(dataUrl, name, blob.type || 'application/octet-stream');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveCurrent() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  try {
    const blob = await getPDFBlob(state.currentFile);
    const outName = getOriginalFilename(state.currentFile);
    if (window.AndroidBridge && typeof window.AndroidBridge.shareBase64File === 'function') {
      const dataUrl = await blobToDataURL(blob);
      window.AndroidBridge.shareBase64File(dataUrl, outName, 'application/pdf');
      showToast('📤 Ready to share / save PDF', 'success');
    } else {
      await downloadFile(blob, outName);
      showToast('💾 File saved', 'success');
    }
  } catch (err) {
    showToast(`❌ Save failed: ${err.message}`, 'error');
  }
}

async function downloadCurrent() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  try {
    const blob = await getPDFBlob(state.currentFile);
    const outName = getOriginalFilename(state.currentFile);
    await downloadFile(blob, outName);
    showToast('📥 Saved PDF to Downloads', 'success');
  } catch (err) {
    showToast(`❌ Download failed: ${err.message}`, 'error');
  }
}

// ─── TEXT TOOL ────────────────────────────────────────────────
function showTextPopover(x, y) {
  const popover = document.getElementById('text-popover');
  if (!popover) return;
  popover.style.display = 'block';
  popover.style.left = x + 'px';
  popover.style.top = y + 'px';
  state.pendingClickX = x;
  state.pendingClickY = y;
  document.getElementById('text-popover-input').focus();
}

function cancelTextInput() {
  document.getElementById('text-popover').style.display = 'none';
}

async function submitTextInput() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const text = document.getElementById('text-popover-input').value.trim();
  if (!text) { cancelTextInput(); return; }

  const img = document.getElementById('pdf-page-img');
  const scaleX = img ? (img.naturalWidth / img.clientWidth) : 1;
  const scaleY = img ? (img.naturalHeight / img.clientHeight) : 1;

  const params = {
    page: state.currentPage,
    text,
    x: state.pendingClickX * scaleX,
    y: state.pendingClickY * scaleY,
    font: state.textSettings.font,
    size: state.textSettings.size,
    color: state.textSettings.color
  };

  cancelTextInput();
  showLoading(true);
  try {
    const result = await addText(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'addText', params });
    await renderCurrentPage();
    showToast('✅ Text added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function submitText() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const text = document.getElementById('text-content')?.value?.trim();
  if (!text) { showToast('Enter some text', 'warning'); return; }

  const params = {
    page: state.currentPage,
    text,
    x: parseInt(document.getElementById('text-x')?.value) || 100,
    y: parseInt(document.getElementById('text-y')?.value) || 100,
    font: document.getElementById('text-font')?.value || 'helv',
    size: parseInt(document.getElementById('text-size')?.value) || 12,
    color: document.getElementById('text-color')?.value || '#000000',
    bold: document.getElementById('btn-bold')?.classList.contains('active') || false,
    italic: document.getElementById('btn-italic')?.classList.contains('active') || false,
    rawCoords: true
  };

  hideModal('modal-text');
  showLoading(true);
  try {
    const result = await addText(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'addText', params });
    await renderCurrentPage();
    showToast('✅ Text added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── STICKY NOTE TOOL ─────────────────────────────────────────
function showStickyPopover(x, y) {
  const popover = document.getElementById('sticky-popover');
  if (!popover) return;
  popover.style.display = 'block';
  popover.style.left = x + 'px';
  popover.style.top = y + 'px';
  state.pendingClickX = x;
  state.pendingClickY = y;
  document.getElementById('sticky-popover-input').focus();
}

function cancelStickyInput() {
  document.getElementById('sticky-popover').style.display = 'none';
}

async function submitStickyInput() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const content = document.getElementById('sticky-popover-input').value.trim();
  if (!content) { cancelStickyInput(); return; }

  const img = document.getElementById('pdf-page-img');
  const scaleX = img ? (img.naturalWidth / img.clientWidth) : 1;
  const scaleY = img ? (img.naturalHeight / img.clientHeight) : 1;

  const params = {
    page: state.currentPage,
    content,
    x: state.pendingClickX * scaleX,
    y: state.pendingClickY * scaleY,
    color: document.getElementById('rs-note-color')?.value || '#FFD700'
  };

  cancelStickyInput();
  showLoading(true);
  try {
    const result = await addStickyNote(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'stickyNote', params });
    await renderCurrentPage();
    showToast('✅ Sticky note added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── DRAW SHAPE ───────────────────────────────────────────────
async function submitDrawShape(params) {
  if (!state.currentFile) return;
  showLoading(true);
  try {
    const result = await drawShape(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'drawShape', params });
    // Clear overlay canvas
    const canvas = document.getElementById('draw-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    await renderCurrentPage();
    showToast('✅ Shape drawn', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function submitHighlight(params) {
  if (!state.currentFile) return;
  showLoading(true);
  try {
    params.color = state.drawSettings.highlightColor || '#FFFF00';
    const result = await highlightText(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'highlight', params });
    const canvas = document.getElementById('draw-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    await renderCurrentPage();
    showToast('✅ Highlight added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function submitStrikethrough(params) {
  if (!state.currentFile) return;
  showLoading(true);
  try {
    const result = await strikethroughText(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'strikethrough', params });
    const canvas = document.getElementById('draw-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    await renderCurrentPage();
    showToast('✅ Strikethrough added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function submitUnderline(params) {
  if (!state.currentFile) return;
  showLoading(true);
  try {
    const result = await underlineText(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'underline', params });
    const canvas = document.getElementById('draw-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    await renderCurrentPage();
    showToast('✅ Underline added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

function applyDrawSettings() {
  state.drawSettings.strokeColor = document.getElementById('draw-stroke-color')?.value || '#6366F1';
  state.drawSettings.fillColor = document.getElementById('draw-fill-color')?.value || '#A78BFA';
  state.drawSettings.strokeWidth = parseInt(document.getElementById('draw-stroke-width')?.value) || 2;
  state.drawSettings.filled = document.getElementById('draw-filled')?.checked || false;
  state.drawShape = document.getElementById('draw-shape')?.value || 'rectangle';
  hideModal('modal-draw');
  showToast('Draw settings updated', 'info');
}

function updateDrawSettings() {
  state.drawSettings.strokeColor = document.getElementById('rs-stroke-color')?.value || '#6366F1';
  state.drawSettings.fillColor = document.getElementById('rs-fill-color')?.value || '#A78BFA';
  state.drawSettings.strokeWidth = parseInt(document.getElementById('rs-stroke-width')?.value) || 2;
  state.drawSettings.filled = document.getElementById('rs-filled')?.checked || false;
}

function updateHighlightSettings() {
  state.drawSettings.highlightColor = document.getElementById('rs-highlight-color')?.value || '#FFFF00';
}

function updateTextSettings() {
  state.textSettings.font = document.getElementById('rs-text-font')?.value || 'helv';
  state.textSettings.size = parseInt(document.getElementById('rs-text-size')?.value) || 12;
  state.textSettings.color = document.getElementById('rs-text-color')?.value || '#000000';
  state.textSettings.bold = document.getElementById('rs-bold')?.classList.contains('active') || false;
  state.textSettings.italic = document.getElementById('rs-italic')?.classList.contains('active') || false;
  state.textSettings.underline = document.getElementById('rs-underline')?.classList.contains('active') || false;
}

// ─── PAGE OPERATIONS ──────────────────────────────────────────
async function addBlankPage() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  showLoading(true);
  try {
    const result = await apiAddBlankPage(state.currentFile, state.currentPage + 1);
    state.currentFile = result.filename || state.currentFile;
    state.totalPages++;
    addToHistory({ type: 'addPage' });
    state.thumbnails = {};
    await renderCurrentPage();
    renderThumbnailsAsync();
    showToast('✅ Blank page added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function deleteCurrentPage() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  if (state.totalPages <= 1) { showToast('Cannot delete the only page', 'warning'); return; }
  if (!confirm(`Delete page ${state.currentPage + 1}?`)) return;
  await doDeletePage(state.currentPage);
}

async function deletePage(pageIndex) {
  await doDeletePage(pageIndex);
}

async function doDeletePage(pageIndex) {
  if (!state.currentFile) return;
  showLoading(true);
  try {
    const result = await apiDeletePage(state.currentFile, [pageIndex]);
    state.currentFile = result.filename || state.currentFile;
    state.totalPages--;
    if (state.currentPage >= state.totalPages) state.currentPage = state.totalPages - 1;
    addToHistory({ type: 'deletePage', page: pageIndex });
    state.thumbnails = {};
    await renderCurrentPage();
    renderThumbnailsAsync();
    showToast('✅ Page deleted', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function rotatePage(degrees, pageIndices) {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const indices = pageIndices || [state.currentPage];
  showLoading(true);
  try {
    const result = await apiRotatePage(state.currentFile, indices, degrees);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'rotate', pages: indices, degrees });
    state.thumbnails = {};
    await renderCurrentPage();
    renderThumbnailsAsync();
    showToast(`✅ Rotated ${degrees}°`, 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function duplicatePage() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  showLoading(true);
  try {
    const result = await apiDuplicatePage(state.currentFile, state.currentPage);
    state.currentFile = result.filename || state.currentFile;
    state.totalPages++;
    addToHistory({ type: 'duplicate' });
    state.thumbnails = {};
    await renderCurrentPage();
    renderThumbnailsAsync();
    showToast('✅ Page duplicated', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── THUMBNAIL DRAG AND DROP ──────────────────────────────────
let draggedPage = null;

function handleThumbnailDragStart(event, pageIndex) {
  draggedPage = pageIndex;
  event.dataTransfer.effectAllowed = 'move';
}

function handleThumbnailDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

async function handleThumbnailDrop(event, targetIndex) {
  event.preventDefault();
  if (draggedPage === null || draggedPage === targetIndex) return;

  const newOrder = Array.from({ length: state.totalPages }, (_, i) => i);
  newOrder.splice(draggedPage, 1);
  newOrder.splice(targetIndex, 0, draggedPage);
  draggedPage = null;

  if (!state.currentFile) return;
  showLoading(true);
  try {
    const result = await apiReorderPages(state.currentFile, newOrder);
    state.currentFile = result.filename || state.currentFile;
    state.thumbnails = {};
    addToHistory({ type: 'reorder', order: newOrder });
    await renderCurrentPage();
    renderThumbnailsAsync();
    showToast('✅ Pages reordered', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── MERGE / SPLIT ────────────────────────────────────────────
function handleMergeFiles(files) {
  state.mergeFiles = [...state.mergeFiles, ...Array.from(files)];
  const list = document.getElementById('merge-file-list');
  if (!list) return;
  list.innerHTML = state.mergeFiles.map((f, i) => `
    <div class="file-list-item">
      <span>📄</span>
      <span style="flex:1">${f.name}</span>
      <button onclick="window.app.removeMergeFile(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer">✕</button>
    </div>
  `).join('');
}

function removeMergeFile(index) {
  state.mergeFiles.splice(index, 1);
  handleMergeFiles([]);
}

async function applyMerge() {
  if (state.mergeFiles.length < 2) { showToast('Add at least 2 PDFs to merge', 'warning'); return; }
  hideModal('modal-merge');
  showLoading(true);
  showToast('⏳ Merging PDFs...', 'info');
  try {
    const blob = await mergePDFs(state.mergeFiles);
    downloadFile(blob, 'merged.pdf');
    state.mergeFiles = [];
    showToast('✅ PDFs merged successfully', 'success');
  } catch (err) {
    showToast(`❌ Merge failed: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

function updateSplitUI() {
  const mode = document.getElementById('split-mode')?.value;
  document.getElementById('split-ranges-ui').style.display = mode === 'ranges' ? 'flex' : 'none';
  document.getElementById('split-every-ui').style.display = mode === 'every' ? 'flex' : 'none';
}

async function applySplit() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const mode = document.getElementById('split-mode')?.value;
  let ranges = [];

  if (mode === 'ranges') {
    const rangeStr = document.getElementById('split-ranges')?.value || '';
    ranges = rangeStr.split(',').map(r => r.trim()).filter(Boolean);
  } else if (mode === 'every') {
    const n = parseInt(document.getElementById('split-every-n')?.value) || 5;
    for (let i = 0; i < state.totalPages; i += n) {
      ranges.push(`${i + 1}-${Math.min(i + n, state.totalPages)}`);
    }
  } else {
    ranges = Array.from({ length: state.totalPages }, (_, i) => `${i + 1}`);
  }

  hideModal('modal-split');
  showLoading(true);
  showToast('⏳ Splitting PDF...', 'info');
  try {
    const blob = await splitPDF(state.currentFile, ranges);
    downloadFile(blob, 'split.zip');
    showToast('✅ PDF split successfully', 'success');
  } catch (err) {
    showToast(`❌ Split failed: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── WATERMARK ────────────────────────────────────────────────
async function applyWatermark() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const params = {
    text: document.getElementById('watermark-text')?.value || 'CONFIDENTIAL',
    color: document.getElementById('watermark-color')?.value || '#FF0000',
    size: parseInt(document.getElementById('watermark-size')?.value) || 48,
    opacity: parseInt(document.getElementById('watermark-opacity')?.value) / 100 || 0.3,
    angle: parseInt(document.getElementById('watermark-angle')?.value) || 45,
    pages: document.getElementById('watermark-pages')?.value || 'all'
  };

  hideModal('modal-watermark');
  showLoading(true);
  try {
    const result = await addWatermark(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'watermark', params });
    await renderCurrentPage();
    showToast('✅ Watermark added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── HEADER / FOOTER ──────────────────────────────────────────
async function applyHeaderFooter() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const params = {
    header: document.getElementById('hf-header')?.value || '',
    footer: document.getElementById('hf-footer')?.value || '',
    size: parseInt(document.getElementById('hf-size')?.value) || 10,
    color: document.getElementById('hf-color')?.value || '#333333',
    align: document.getElementById('hf-align')?.value || 'center',
    page_numbers: document.getElementById('hf-page-num')?.checked || false
  };

  hideModal('modal-header-footer');
  showLoading(true);
  try {
    const result = await addHeaderFooter(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    await renderCurrentPage();
    showToast('✅ Header/Footer added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── PASSWORD ─────────────────────────────────────────────────
async function applyPassword() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const params = {
    user_password: document.getElementById('pwd-user')?.value || '',
    owner_password: document.getElementById('pwd-owner')?.value || '',
    allow_print: document.getElementById('perm-print')?.checked || true,
    allow_copy: document.getElementById('perm-copy')?.checked || true,
    allow_edit: document.getElementById('perm-edit')?.checked || false
  };

  hideModal('modal-password');
  showLoading(true);
  try {
    const result = await addPassword(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    showToast('✅ Password protection applied', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── METADATA ─────────────────────────────────────────────────
async function loadMetadata() {
  if (!state.currentFile) return;
  try {
    const meta = await getMetadata(state.currentFile);
    if (document.getElementById('meta-title')) document.getElementById('meta-title').value = meta.title || '';
    if (document.getElementById('meta-author')) document.getElementById('meta-author').value = meta.author || '';
    if (document.getElementById('meta-subject')) document.getElementById('meta-subject').value = meta.subject || '';
    if (document.getElementById('meta-keywords')) document.getElementById('meta-keywords').value = meta.keywords || '';
    if (document.getElementById('meta-creator')) document.getElementById('meta-creator').value = meta.creator || '';
  } catch (e) { /* silent fail */ }
}

async function applyMetadata() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const params = {
    title: document.getElementById('meta-title')?.value || '',
    author: document.getElementById('meta-author')?.value || '',
    subject: document.getElementById('meta-subject')?.value || '',
    keywords: document.getElementById('meta-keywords')?.value || '',
    creator: document.getElementById('meta-creator')?.value || ''
  };

  hideModal('modal-metadata');
  showLoading(true);
  try {
    const result = await updateMetadata(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    addToHistory({ type: 'metadata', params });
    showToast('✅ Metadata updated', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── BOOKMARKS ────────────────────────────────────────────────
async function applyBookmark() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const params = {
    title: document.getElementById('bookmark-title')?.value || 'Bookmark',
    page: parseInt(document.getElementById('bookmark-page')?.value) - 1 || 0,
    level: parseInt(document.getElementById('bookmark-level')?.value) || 1
  };

  hideModal('modal-bookmark');
  showLoading(true);
  try {
    const result = await addBookmark(state.currentFile, params);
    state.currentFile = result.filename || state.currentFile;
    showToast('✅ Bookmark added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── COMPRESS ─────────────────────────────────────────────────
async function applyCompress() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const quality = document.querySelector('input[name="compress-quality"]:checked')?.value || 'medium';
  hideModal('modal-compress');
  showLoading(true);
  showToast('⏳ Compressing PDF...', 'info');
  try {
    const blob = await compressPDF(state.currentFile, quality);
    downloadFile(blob, 'compressed.pdf');
    showToast('✅ PDF compressed', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── CONVERT ──────────────────────────────────────────────────
async function doConvertToDocx() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  hideModal('modal-convert');
  showLoading(true);
  showToast('⏳ Converting to DOCX...', 'info');
  try {
    const blob = await convertToDocx(state.currentFile);
    downloadFile(blob, 'document.docx');
    showToast('✅ Converted to DOCX', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

async function doConvertToImages(format) {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  hideModal('modal-convert');
  showLoading(true);
  showToast(`⏳ Converting to ${format.toUpperCase()}...`, 'info');
  try {
    const blob = await apiConvertToImages(state.currentFile, format);
    downloadFile(blob, `images_${format}.zip`);
    showToast(`✅ Converted to ${format.toUpperCase()}`, 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

function openConvertModal() {
  showModal('modal-convert');
}

async function doConvertToText() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  hideModal('modal-convert');
  showLoading(true);
  try {
    const result = await convertToText(state.currentFile);
    const blob = new Blob([result.text || ''], { type: 'text/plain' });
    downloadFile(blob, 'document.txt');
    showToast('✅ Text extracted', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── OCR ──────────────────────────────────────────────────────
async function applyOCR() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const lang = document.getElementById('ocr-language')?.value || 'eng';
  const output = document.getElementById('ocr-output')?.value || 'text';
  hideModal('modal-ocr');
  showLoading(true);
  showToast('⏳ Running OCR... this may take a while', 'info');
  try {
    const result = await runOCR(state.currentFile);
    if (output === 'text') {
      const blob = new Blob([result.text || ''], { type: 'text/plain' });
      downloadFile(blob, 'ocr_result.txt');
    } else {
      state.currentFile = result.filename || state.currentFile;
      await renderCurrentPage();
    }
    showToast('✅ OCR complete', 'success');
  } catch (err) {
    showToast(`❌ OCR failed: ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── FORM FIELD ───────────────────────────────────────────────
async function applyFormField() {
  if (!state.currentFile) { showToast('No file open', 'warning'); return; }
  const params = {
    page: state.currentPage,
    field_type: document.getElementById('field-type')?.value || 'text',
    name: document.getElementById('field-name')?.value || 'field1',
    default_value: document.getElementById('field-default')?.value || '',
    x: 100, y: 100,
    width: parseInt(document.getElementById('field-width')?.value) || 150,
    height: parseInt(document.getElementById('field-height')?.value) || 20
  };
  hideModal('modal-form-field');
  showLoading(true);
  try {
    const result = await fillForms(state.currentFile, [params]);
    state.currentFile = result.filename || state.currentFile;
    await renderCurrentPage();
    showToast('✅ Form field added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── DARK MODE ────────────────────────────────────────────────
function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  document.body.classList.toggle('light-mode', !state.darkMode);
  const btn = document.getElementById('btn-darkmode');
  if (btn) btn.querySelector('.btn-icon').textContent = state.darkMode ? '🌙' : '☀️';
  showToast(state.darkMode ? '🌙 Dark mode' : '☀️ Light mode', 'info');
}

// ─── AUTOSAVE ─────────────────────────────────────────────────
function autoSave() {
  try {
    localStorage.setItem('pdf-master-state', JSON.stringify({
      currentFile: state.currentFile,
      currentPage: state.currentPage,
      zoom: state.zoom,
      tool: state.tool,
      darkMode: state.darkMode
    }));
  } catch (e) { /* ignore */ }
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem('pdf-master-state') || '{}');
    if (saved.zoom) state.zoom = saved.zoom;
    if (saved.darkMode === false) {
      state.darkMode = false;
      document.body.classList.add('light-mode');
    }
  } catch (e) { /* ignore */ }
}

// ─── IMAGE TOOL ───────────────────────────────────────────────
async function handleImageUpload(file) {
  if (!state.currentFile) { showToast('Open a PDF first', 'warning'); return; }
  showLoading(true);
  showToast('⏳ Adding image...', 'info');
  try {
    const params = { page: state.currentPage, x: 100, y: 100, width: 200 };
    const result = await addImage(state.currentFile, file, params);
    if (result?.filename) {
      state.currentFile = result.filename;
      addToHistory({ type: 'addImage', params });
      state.thumbnails = {};
      renderThumbnailsAsync();
    } else if (result instanceof Blob) {
      await downloadFile(result, 'with-image.pdf');
    }
    await renderCurrentPage();
    showToast('✅ Image added', 'success');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'z': e.preventDefault(); e.shiftKey ? redo() : undo(); break;
      case 'y': e.preventDefault(); redo(); break;
      case 'o': e.preventDefault(); document.getElementById('file-input').click(); break;
      case 's': e.preventDefault(); saveCurrent(); break;
      case '+': case '=': e.preventDefault(); setZoom(state.zoom + 0.1); break;
      case '-': e.preventDefault(); setZoom(state.zoom - 0.1); break;
    }
  }
  switch (e.key) {
    case 'v': case 'V': if (!e.target.matches('input, textarea')) setTool('select'); break;
    case 't': case 'T': if (!e.target.matches('input, textarea')) setTool('text'); break;
    case 'd': case 'D': if (!e.target.matches('input, textarea')) setTool('draw'); break;
    case 'h': case 'H': if (!e.target.matches('input, textarea')) setTool('highlight'); break;
    case 'n': case 'N': if (!e.target.matches('input, textarea')) setTool('sticky'); break;
    case 'ArrowLeft': navigatePage(-1); break;
    case 'ArrowRight': navigatePage(1); break;
    case 'Escape':
      cancelTextInput(); cancelStickyInput(); closeAllDropdowns();
      document.querySelectorAll('.modal-overlay.open').forEach(m => { m.classList.remove('open'); m.style.display = 'none'; });
      break;
  }
});

// ─── EXPOSE API ───────────────────────────────────────────────
window.app = {
  state,
  loadPDF,
  renderCurrentPage,
  setTool,
  setDrawShape,
  navigatePage,
  navigateToPage,
  setZoom,
  undo,
  redo,
  showModal,
  hideModal,
  showToast,
  toggleDarkMode,
  toggleDropdown,
  saveCurrent,
  downloadCurrent,
  showTextPopover,
  cancelTextInput,
  submitTextInput,
  submitText,
  showStickyPopover,
  cancelStickyInput,
  submitStickyInput,
  submitDrawShape,
  submitHighlight,
  submitStrikethrough,
  submitUnderline,
  applyDrawSettings,
  updateDrawSettings,
  updateHighlightSettings,
  updateTextSettings,
  addBlankPage,
  deleteCurrentPage,
  deletePage,
  rotatePage,
  duplicatePage,
  handleThumbnailDragStart,
  handleThumbnailDragOver,
  handleThumbnailDrop,
  handleMergeFiles,
  removeMergeFile,
  applyMerge,
  updateSplitUI,
  applySplit,
  applyWatermark,
  applyHeaderFooter,
  applyPassword,
  applyMetadata,
  applyBookmark,
  applyCompress,
  doConvertToDocx,
  doConvertToImages,
  convertToImages: openConvertModal,
  doConvertToText,
  applyOCR,
  applyFormField,
  handleImageUpload,
};

// ─── INIT ─────────────────────────────────────────────────────
function init() {
  restoreState();
  updateStatusBar();
  initDrawCanvas(state);
  setTool('select');
  showToast('🎉 PDF Master ready! Open a PDF to begin.', 'success');
}

init();
