export function buildPDFViewer() {
  return `
<div class="pdf-viewer-container" id="pdf-viewer-container">
  <div class="pdf-canvas-wrap" id="pdf-canvas-wrap">
    <!-- Empty state -->
    <div class="viewer-empty" id="viewer-empty">
      <div class="viewer-empty-icon">📄</div>
      <div class="viewer-empty-title">No PDF Open</div>
      <div class="viewer-empty-subtitle">Open a PDF file to get started</div>
      <button class="btn-primary viewer-open-btn" onclick="document.getElementById('file-input').click()">
        📂 Open PDF
      </button>
    </div>

    <!-- Page display -->
    <div class="page-display" id="page-display" style="display:none; position:relative">
      <img id="pdf-page-img" class="pdf-page-img" alt="PDF Page" draggable="false">
      <canvas id="draw-canvas" class="draw-canvas"></canvas>
      <!-- Text input popover -->
      <div class="text-popover" id="text-popover" style="display:none">
        <textarea id="text-popover-input" class="text-popover-input" placeholder="Type here..." rows="3"></textarea>
        <div class="text-popover-actions">
          <button class="btn-ghost btn-sm" onclick="window.app.cancelTextInput()">Cancel</button>
          <button class="btn-primary btn-sm" onclick="window.app.submitTextInput()">Add</button>
        </div>
      </div>
      <!-- Sticky note popover -->
      <div class="sticky-popover" id="sticky-popover" style="display:none">
        <div class="sticky-popover-header">💬 Sticky Note</div>
        <textarea id="sticky-popover-input" class="text-popover-input" placeholder="Note text..." rows="4"></textarea>
        <div class="text-popover-actions">
          <button class="btn-ghost btn-sm" onclick="window.app.cancelStickyInput()">Cancel</button>
          <button class="btn-primary btn-sm" onclick="window.app.submitStickyInput()">Add Note</button>
        </div>
      </div>
    </div>

    <!-- Loading overlay -->
    <div class="page-loading" id="page-loading" style="display:none">
      <div class="spinner"></div>
      <div class="loading-text">Loading page...</div>
    </div>
  </div>

  <!-- Floating navigation -->
  <div class="page-nav" id="page-nav" style="display:none">
    <button class="nav-btn" id="btn-prev" onclick="window.app.navigatePage(-1)" title="Previous Page">◀</button>
    <span class="nav-info" id="nav-info">1 / 1</span>
    <button class="nav-btn" id="btn-next" onclick="window.app.navigatePage(1)" title="Next Page">▶</button>
  </div>
</div>
`;
}

export function initDrawCanvas(state) {
  const canvas = document.getElementById('draw-canvas');
  const img = document.getElementById('pdf-page-img');
  if (!canvas || !img) return;

  const updateCanvasSize = () => {
    canvas.width = img.clientWidth || img.naturalWidth || 800;
    canvas.height = img.clientHeight || img.naturalHeight || 1000;
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
  };

  img.addEventListener('load', updateCanvasSize);
  window.addEventListener('resize', updateCanvasSize);
  if (img.complete) updateCanvasSize();

  const ctx = canvas.getContext('2d');
  let drawing = false;
  let startX = 0, startY = 0;
  let snapshot = null;
  let freehandPoints = [];

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const activeTools = ['draw', 'highlight', 'text', 'sticky', 'strikethrough', 'underline'];

  const handleStart = (e) => {
    if (!activeTools.includes(state.tool)) return;
    if (e.cancelable) e.preventDefault();
    const pos = getPos(e);

    if (state.tool === 'text') {
      window.app.showTextPopover(pos.x, pos.y);
      return;
    }
    if (state.tool === 'sticky') {
      window.app.showStickyPopover(pos.x, pos.y);
      return;
    }

    drawing = true;
    startX = pos.x;
    startY = pos.y;
    freehandPoints = [pos];
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.isDrawing = true;
    state.drawStart = pos;
  };

  const handleMove = (e) => {
    if (!drawing) return;
    if (e.cancelable) e.preventDefault();
    const pos = getPos(e);
    ctx.putImageData(snapshot, 0, 0);

    const drawSettings = state.drawSettings || {};
    ctx.strokeStyle = drawSettings.strokeColor || '#6366F1';
    ctx.fillStyle = drawSettings.fillColor || '#A78BFA';
    ctx.lineWidth = drawSettings.strokeWidth || 2;

    const dx = pos.x - startX;
    const dy = pos.y - startY;

    if (state.tool === 'highlight') {
      ctx.fillStyle = `${drawSettings.highlightColor || '#FFFF00'}66`;
      ctx.fillRect(startX, startY, dx, dy);
      return;
    }
    if (state.tool === 'strikethrough') {
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, startY + dy / 2);
      ctx.lineTo(pos.x, startY + dy / 2);
      ctx.stroke();
      return;
    }
    if (state.tool === 'underline') {
      ctx.strokeStyle = '#6366F1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, Math.max(startY, pos.y));
      ctx.lineTo(pos.x, Math.max(startY, pos.y));
      ctx.stroke();
      return;
    }

    ctx.beginPath();
    switch (state.drawShape) {
      case 'rectangle':
        ctx.rect(startX, startY, dx, dy);
        if (drawSettings.filled) ctx.fill();
        ctx.stroke();
        break;
      case 'circle': {
        const rx = Math.abs(dx) / 2;
        const ry = Math.abs(dy) / 2;
        const cx = startX + dx / 2;
        const cy = startY + dy / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (drawSettings.filled) ctx.fill();
        ctx.stroke();
        break;
      }
      case 'line':
        ctx.moveTo(startX, startY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        break;
      case 'arrow': {
        ctx.moveTo(startX, startY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        const angle = Math.atan2(dy, dx);
        const headLen = 15;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x - headLen * Math.cos(angle - Math.PI / 6), pos.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x - headLen * Math.cos(angle + Math.PI / 6), pos.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
        break;
      }
      case 'freehand':
        freehandPoints.push(pos);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (freehandPoints.length > 0) {
          ctx.moveTo(freehandPoints[0].x, freehandPoints[0].y);
          freehandPoints.forEach(pt => ctx.lineTo(pt.x, pt.y));
        }
        ctx.stroke();
        break;
    }
  };

  const handleEnd = (e) => {
    if (!drawing) return;
    drawing = false;
    state.isDrawing = false;
    const pos = getPos(e);
    const imgEl = document.getElementById('pdf-page-img');
    const scaleX = imgEl && imgEl.clientWidth ? (imgEl.naturalWidth / imgEl.clientWidth) : 1;
    const scaleY = imgEl && imgEl.clientHeight ? (imgEl.naturalHeight / imgEl.clientHeight) : 1;

    const params = {
      page: state.currentPage,
      x: Math.min(startX, pos.x) * scaleX,
      y: Math.min(startY, pos.y) * scaleY,
      x1: startX * scaleX,
      y1: startY * scaleY,
      x2: pos.x * scaleX,
      y2: pos.y * scaleY,
      width: Math.abs(pos.x - startX) * scaleX,
      height: Math.abs(pos.y - startY) * scaleY,
      shape: state.drawShape,
      stroke_color: state.drawSettings?.strokeColor || '#6366F1',
      fill_color: state.drawSettings?.fillColor || '#A78BFA',
      stroke_width: state.drawSettings?.strokeWidth || 2,
      filled: state.drawSettings?.filled || false,
      points: JSON.stringify(freehandPoints.map(p => ({ x: p.x * scaleX, y: p.y * scaleY })))
    };

    const movedEnough = params.width > 4 || params.height > 4 || freehandPoints.length > 3;
    if (!movedEnough) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (state.tool === 'draw') {
      window.app.submitDrawShape(params);
    } else if (state.tool === 'highlight') {
      window.app.submitHighlight(params);
    } else if (state.tool === 'strikethrough') {
      window.app.submitStrikethrough?.(params);
    } else if (state.tool === 'underline') {
      window.app.submitUnderline?.(params);
    }
  };

  canvas.addEventListener('mousedown', handleStart);
  canvas.addEventListener('mousemove', handleMove);
  canvas.addEventListener('mouseup', handleEnd);
  canvas.addEventListener('touchstart', handleStart, { passive: false });
  canvas.addEventListener('touchmove', handleMove, { passive: false });
  canvas.addEventListener('touchend', handleEnd, { passive: false });

  canvas.addEventListener('mouseleave', () => {
    if (drawing) {
      drawing = false;
      state.isDrawing = false;
    }
  });
}
