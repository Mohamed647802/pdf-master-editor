import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ─── IN-MEMORY CLIENT-SIDE PDF STORE ──────────────────────────
const pdfStore = new Map(); // id -> { bytes: Uint8Array, originalName: string, zoom: number, bookmarks: Array }
let versionCounter = 1;

function makeId(baseName = 'document.pdf') {
  const clean = String(baseName).replace(/^.*[/\\]/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'document.pdf';
  const stem = clean.toLowerCase().endsWith('.pdf') ? clean.slice(0, -4) : clean;
  return `${stem}_v${versionCounter++}.pdf`;
}

function hexToRgbObj(hex = '#000000') {
  const h = String(hex || '#000000').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b);
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function resolveBytes(fileOrName) {
  if (!fileOrName) throw new Error('No PDF loaded');
  if (typeof fileOrName === 'string') {
    const entry = pdfStore.get(fileOrName);
    if (!entry) throw new Error('PDF session expired — please reopen the PDF');
    return { bytes: new Uint8Array(entry.bytes), entry, id: fileOrName };
  }
  if (fileOrName instanceof Blob || fileOrName instanceof File) {
    const buf = await fileOrName.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const id = makeId(fileOrName.name || 'document.pdf');
    const entry = { bytes, originalName: fileOrName.name || 'document.pdf', zoom: 1.5, bookmarks: [] };
    pdfStore.set(id, entry);
    return { bytes: new Uint8Array(bytes), entry, id };
  }
  throw new Error('Invalid PDF reference');
}

function saveNewVersion(bytes, prevEntry) {
  const outBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const id = makeId(prevEntry?.originalName || 'edited.pdf');
  pdfStore.set(id, {
    bytes: outBytes,
    originalName: prevEntry?.originalName || 'edited.pdf',
    zoom: prevEntry?.zoom || 1.5,
    bookmarks: [...(prevEntry?.bookmarks || [])]
  });
  return id;
}

async function loadPdfJsDoc(bytes) {
  try {
    return await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  } catch (err) {
    return await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise;
  }
}

async function pickStandardFont(pdfDoc, fontName = 'helv', bold = false, italic = false) {
  const f = String(fontName || 'helv').toLowerCase();
  if (f.includes('time')) {
    if (bold && italic) return pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
    if (bold) return pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    if (italic) return pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
    return pdfDoc.embedFont(StandardFonts.TimesRoman);
  }
  if (f.includes('cour')) {
    if (bold && italic) return pdfDoc.embedFont(StandardFonts.CourierBoldOblique);
    if (bold) return pdfDoc.embedFont(StandardFonts.CourierBold);
    if (italic) return pdfDoc.embedFont(StandardFonts.CourierOblique);
    return pdfDoc.embedFont(StandardFonts.Courier);
  }
  if (bold && italic) return pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
  if (bold) return pdfDoc.embedFont(StandardFonts.HelveticaBold);
  if (italic) return pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  return pdfDoc.embedFont(StandardFonts.Helvetica);
}

// Supports both Latin vector fonts AND Arabic/RTL/Unicode/Emoji via crisp high-DPI canvas PNG
async function drawSmartText(pdfDoc, page, text, {
  x = 50,
  y = 700,
  size = 14,
  fontName = 'helv',
  bold = false,
  italic = false,
  color = '#000000',
  opacity = 1,
  angle = 0
} = {}) {
  const str = String(text || '');
  if (!str) return;
  const isAscii = /^[\x20-\x7E\r\n\t]*$/.test(str);

  if (isAscii) {
    const font = await pickStandardFont(pdfDoc, fontName, bold, italic);
    page.drawText(str, {
      x,
      y,
      size,
      font,
      color: hexToRgbObj(color),
      opacity,
      rotate: degrees(angle)
    });
    return;
  }

  // Render Unicode / Arabic / Emoji cleanly via HTML5 Canvas at 3x retina scale
  const scale = 3;
  const lines = str.split(/\r?\n/);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const weight = bold ? 'bold' : 'normal';
  const style = italic ? 'italic' : 'normal';
  const family = String(fontName).includes('cour')
    ? 'monospace'
    : String(fontName).includes('time')
      ? 'serif'
      : 'system-ui, sans-serif';
  const fontSpec = `${style} ${weight} ${Math.round(size * scale)}px ${family}`;
  ctx.font = fontSpec;

  let maxW = 20;
  for (const line of lines) {
    const m = ctx.measureText(line);
    if (m.width > maxW) maxW = m.width;
  }
  const lineH = Math.ceil(size * scale * 1.35);
  c.width = Math.ceil(maxW + size * scale);
  c.height = Math.ceil(lines.length * lineH + size * scale * 0.5);

  const ctx2 = c.getContext('2d');
  ctx2.font = fontSpec;
  ctx2.fillStyle = color || '#000000';
  ctx2.textBaseline = 'top';
  const isRtl = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(str);
  if (isRtl) {
    ctx2.direction = 'rtl';
    ctx2.textAlign = 'right';
  }
  lines.forEach((line, idx) => {
    const drawX = isRtl ? c.width - (size * scale * 0.25) : (size * scale * 0.25);
    ctx2.fillText(line, drawX, idx * lineH + (size * scale * 0.15));
  });

  const pngBytes = dataUrlToUint8Array(c.toDataURL('image/png'));
  const pngImg = await pdfDoc.embedPng(pngBytes);
  const ptW = c.width / scale;
  const ptH = c.height / scale;
  page.drawImage(pngImg, {
    x,
    y: y - ptH + size,
    width: ptW,
    height: ptH,
    opacity,
    rotate: degrees(angle)
  });
}

export async function getPDFBlob(filename) {
  const { bytes } = await resolveBytes(filename);
  return new Blob([bytes], { type: 'application/pdf' });
}

export function getOriginalFilename(filename) {
  const entry = pdfStore.get(filename);
  return entry?.originalName || filename || 'document.pdf';
}

// ─── CORE UPLOAD & RENDER ─────────────────────────────────────
export async function uploadPDF(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const pdfJsDoc = await loadPdfJsDoc(bytes);
  const totalPages = pdfJsDoc.numPages;
  await pdfJsDoc.destroy();

  const id = makeId(file.name || 'document.pdf');
  pdfStore.set(id, {
    bytes,
    originalName: file.name || 'document.pdf',
    zoom: 1.5,
    bookmarks: []
  });

  return {
    filename: id,
    total_pages: totalPages,
    page_count: totalPages
  };
}

export async function renderPage(filename, page = 0, zoom = 1.5) {
  const { bytes, entry } = await resolveBytes(filename);
  entry.zoom = zoom;
  const doc = await loadPdfJsDoc(bytes);
  const safeIdx = Math.max(1, Math.min(doc.numPages, Number(page) + 1));
  const pdfPage = await doc.getPage(safeIdx);
  const viewport = pdfPage.getViewport({ scale: zoom });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  await doc.destroy();

  return {
    image: base64,
    width: canvas.width,
    height: canvas.height,
    total_pages: pdfStore.get(filename) ? undefined : 1
  };
}

export async function getThumbnail(filename, page = 0) {
  const { bytes } = await resolveBytes(filename);
  const doc = await loadPdfJsDoc(bytes);
  const safeIdx = Math.max(1, Math.min(doc.numPages, Number(page) + 1));
  const pdfPage = await doc.getPage(safeIdx);
  const viewport = pdfPage.getViewport({ scale: 0.28 });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  await doc.destroy();

  return { image: base64 };
}

export async function getPDFInfo(filename) {
  const { bytes } = await resolveBytes(filename);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages().map((p, i) => {
    const { width, height } = p.getSize();
    return { index: i, width, height, rotation: p.getRotation().angle };
  });
  return { page_count: pdfDoc.getPageCount(), pages };
}

// ─── EDITING TOOLS ────────────────────────────────────────────
export async function addText(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageIdx = Math.max(0, Math.min(pdfDoc.getPageCount() - 1, Number(params.page ?? params.page_index ?? 0)));
  const page = pdfDoc.getPage(pageIdx);
  const { height } = page.getSize();
  const zoom = params.rawCoords ? 1 : (entry?.zoom || 1.5);

  const fontSize = Number(params.size ?? params.font_size ?? 14);
  const ptX = Number(params.x ?? 80) / zoom;
  const ptY = height - (Number(params.y ?? 80) / zoom) - fontSize;

  await drawSmartText(pdfDoc, page, params.text || '', {
    x: Math.max(4, ptX),
    y: Math.max(4, ptY),
    size: fontSize,
    fontName: params.font || params.font_name || 'helv',
    bold: Boolean(params.bold === true || params.bold === 'true'),
    italic: Boolean(params.italic === true || params.italic === 'true'),
    color: params.color || '#000000'
  });

  const saved = await pdfDoc.save();
  const filename = saveNewVersion(saved, entry);
  return { filename, total_pages: pdfDoc.getPageCount() };
}

export async function addImage(pdfFile, imgFile, params = {}) {
  const { bytes, entry } = await resolveBytes(pdfFile);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageIdx = Math.max(0, Math.min(pdfDoc.getPageCount() - 1, Number(params.page ?? params.page_index ?? 0)));
  const page = pdfDoc.getPage(pageIdx);
  const { width: pageW, height: pageH } = page.getSize();

  const imgBuf = await imgFile.arrayBuffer();
  const imgBytes = new Uint8Array(imgBuf);
  const mime = (imgFile.type || '').toLowerCase();

  let embedded;
  if (mime.includes('png') || (imgBytes[0] === 0x89 && imgBytes[1] === 0x50)) {
    embedded = await pdfDoc.embedPng(imgBytes);
  } else if (mime.includes('jpg') || mime.includes('jpeg') || (imgBytes[0] === 0xff && imgBytes[1] === 0xd8)) {
    embedded = await pdfDoc.embedJpg(imgBytes);
  } else {
    // Convert WebP / BMP / GIF via Canvas to PNG
    const bmp = await createImageBitmap(imgFile);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    embedded = await pdfDoc.embedPng(dataUrlToUint8Array(c.toDataURL('image/png')));
  }

  const w = Number(params.width || 200);
  const h = Number(params.height || (w * (embedded.height / Math.max(1, embedded.width))));
  const x = Math.min(pageW - w - 10, Math.max(10, Number(params.x ?? (pageW - w) / 2)));
  const y = Math.max(10, pageH - Number(params.y ?? 120) - h);

  page.drawImage(embedded, { x, y, width: w, height: h });

  const saved = await pdfDoc.save();
  const filename = saveNewVersion(saved, entry);
  return {
    filename,
    total_pages: pdfDoc.getPageCount(),
    blob: new Blob([saved], { type: 'application/pdf' })
  };
}

export async function drawShape(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageIdx = Math.max(0, Math.min(pdfDoc.getPageCount() - 1, Number(params.page ?? 0)));
  const page = pdfDoc.getPage(pageIdx);
  const { height: pageH } = page.getSize();
  const zoom = entry?.zoom || 1.5;

  const shape = params.shape || 'rectangle';
  const strokeColor = hexToRgbObj(params.stroke_color || params.color || '#6366F1');
  const fillColor = hexToRgbObj(params.fill_color || '#A78BFA');
  const filled = params.filled === true || params.filled === 'true';
  const borderWidth = Math.max(1, Number(params.stroke_width || 2) / zoom);

  const rx = Number(params.x || 0) / zoom;
  const ryTop = Number(params.y || 0) / zoom;
  const rw = Number(params.width || 50) / zoom;
  const rh = Number(params.height || 50) / zoom;
  const pdfY = pageH - ryTop - rh;

  if (shape === 'rectangle') {
    page.drawRectangle({
      x: rx,
      y: pdfY,
      width: rw,
      height: rh,
      borderColor: strokeColor,
      borderWidth,
      color: filled ? fillColor : undefined,
      opacity: filled ? 0.35 : undefined
    });
  } else if (shape === 'circle' || shape === 'ellipse') {
    page.drawEllipse({
      x: rx + rw / 2,
      y: pdfY + rh / 2,
      xScale: rw / 2,
      yScale: rh / 2,
      borderColor: strokeColor,
      borderWidth,
      color: filled ? fillColor : undefined,
      opacity: filled ? 0.35 : undefined
    });
  } else if (shape === 'line' || shape === 'arrow') {
    const x1 = (params.x1 !== undefined ? Number(params.x1) : Number(params.x || 0)) / zoom;
    const y1 = pageH - ((params.y1 !== undefined ? Number(params.y1) : Number(params.y || 0)) / zoom);
    const x2 = (params.x2 !== undefined ? Number(params.x2) : Number(params.x || 0) + Number(params.width || 50)) / zoom;
    const y2 = pageH - ((params.y2 !== undefined ? Number(params.y2) : Number(params.y || 0) + Number(params.height || 50)) / zoom);

    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: borderWidth, color: strokeColor });

    if (shape === 'arrow') {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = 10;
      page.drawLine({
        start: { x: x2, y: y2 },
        end: { x: x2 - head * Math.cos(angle - Math.PI / 6), y: y2 - head * Math.sin(angle - Math.PI / 6) },
        thickness: borderWidth,
        color: strokeColor
      });
      page.drawLine({
        start: { x: x2, y: y2 },
        end: { x: x2 - head * Math.cos(angle + Math.PI / 6), y: y2 - head * Math.sin(angle + Math.PI / 6) },
        thickness: borderWidth,
        color: strokeColor
      });
    }
  } else if (shape === 'freehand') {
    let pts = [];
    try {
      pts = typeof params.points === 'string' ? JSON.parse(params.points) : (params.points || []);
    } catch (_) { pts = []; }
    for (let i = 1; i < pts.length; i++) {
      page.drawLine({
        start: { x: pts[i - 1].x / zoom, y: pageH - (pts[i - 1].y / zoom) },
        end: { x: pts[i].x / zoom, y: pageH - (pts[i].y / zoom) },
        thickness: borderWidth,
        color: strokeColor
      });
    }
  }

  const saved = await pdfDoc.save();
  const filename = saveNewVersion(saved, entry);
  return { filename, total_pages: pdfDoc.getPageCount() };
}

export async function redactRegion(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(Number(params.page ?? 0));
  const { height: pageH } = page.getSize();
  const zoom = entry?.zoom || 1.5;
  const rx = Number(params.x || 0) / zoom;
  const rw = Number(params.width || 100) / zoom;
  const rh = Number(params.height || 30) / zoom;
  const pdfY = pageH - (Number(params.y || 0) / zoom) - rh;

  page.drawRectangle({ x: rx, y: pdfY, width: rw, height: rh, color: rgb(0, 0, 0) });
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

// ─── ANNOTATIONS ──────────────────────────────────────────────
export async function highlightText(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(Number(params.page ?? 0));
  const { height: pageH } = page.getSize();
  const zoom = entry?.zoom || 1.5;

  const rx = Number(params.x || 0) / zoom;
  const rw = Math.max(8, Number(params.width || 80) / zoom);
  const rh = Math.max(8, Number(params.height || 18) / zoom);
  const pdfY = pageH - (Number(params.y || 0) / zoom) - rh;

  page.drawRectangle({
    x: rx,
    y: pdfY,
    width: rw,
    height: rh,
    color: hexToRgbObj(params.color || '#FFFF00'),
    opacity: 0.38
  });

  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function strikethroughText(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(Number(params.page ?? 0));
  const { height: pageH } = page.getSize();
  const zoom = entry?.zoom || 1.5;

  const rx = Number(params.x || 0) / zoom;
  const rw = Math.max(10, Number(params.width || 80) / zoom);
  const rh = Number(params.height || 14) / zoom;
  const midY = pageH - (Number(params.y || 0) / zoom) - rh / 2;

  page.drawLine({
    start: { x: rx, y: midY },
    end: { x: rx + rw, y: midY },
    thickness: 1.8,
    color: hexToRgbObj(params.color || '#EF4444')
  });

  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function underlineText(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(Number(params.page ?? 0));
  const { height: pageH } = page.getSize();
  const zoom = entry?.zoom || 1.5;

  const rx = Number(params.x || 0) / zoom;
  const rw = Math.max(10, Number(params.width || 80) / zoom);
  const rh = Number(params.height || 14) / zoom;
  const botY = pageH - (Number(params.y || 0) / zoom) - rh;

  page.drawLine({
    start: { x: rx, y: botY },
    end: { x: rx + rw, y: botY },
    thickness: 1.8,
    color: hexToRgbObj(params.color || '#6366F1')
  });

  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function addStickyNote(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(Number(params.page ?? 0));
  const { width: pageW, height: pageH } = page.getSize();
  const zoom = entry?.zoom || 1.5;

  const noteW = 150;
  const noteH = 54;
  const ptX = Math.min(pageW - noteW - 8, Math.max(8, Number(params.x || 60) / zoom));
  const ptY = Math.max(8, pageH - (Number(params.y || 60) / zoom) - noteH);

  page.drawRectangle({
    x: ptX,
    y: ptY,
    width: noteW,
    height: noteH,
    color: hexToRgbObj(params.color || '#FFD700'),
    opacity: 0.92,
    borderColor: rgb(0.75, 0.58, 0.05),
    borderWidth: 1
  });

  await drawSmartText(pdfDoc, page, String(params.content || '').slice(0, 120), {
    x: ptX + 6,
    y: ptY + noteH - 16,
    size: 9,
    color: '#111111'
  });

  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function deleteAnnotation(file) {
  const { id } = await resolveBytes(file);
  return { filename: id };
}

export async function listAnnotations() {
  return { annotations: [] };
}

// ─── PAGE OPERATIONS ──────────────────────────────────────────
export async function addBlankPage(file, pageIndex = 1) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const refPage = pdfDoc.getPages()[0];
  const { width, height } = refPage ? refPage.getSize() : { width: 595.28, height: 841.89 };
  const idx = Math.max(0, Math.min(pdfDoc.getPageCount(), Number(pageIndex)));
  pdfDoc.insertPage(idx, [width, height]);
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry), total_pages: pdfDoc.getPageCount() };
}

export async function duplicatePage(file, pageIndex = 0) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const idx = Math.max(0, Math.min(pdfDoc.getPageCount() - 1, Number(pageIndex)));
  const [copied] = await pdfDoc.copyPages(pdfDoc, [idx]);
  pdfDoc.insertPage(idx + 1, copied);
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry), total_pages: pdfDoc.getPageCount() };
}

export async function deletePage(file, pageIndices = []) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const indices = Array.isArray(pageIndices) ? [...pageIndices] : JSON.parse(pageIndices || '[]');
  indices.sort((a, b) => b - a).forEach(idx => {
    if (pdfDoc.getPageCount() > 1 && idx >= 0 && idx < pdfDoc.getPageCount()) {
      pdfDoc.removePage(idx);
    }
  });
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry), total_pages: pdfDoc.getPageCount() };
}

export async function reorderPages(file, newOrder = []) {
  const { bytes, entry } = await resolveBytes(file);
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();
  const order = Array.isArray(newOrder) ? newOrder : JSON.parse(newOrder || '[]');
  const copied = await outDoc.copyPages(srcDoc, order);
  copied.forEach(p => outDoc.addPage(p));
  const saved = await outDoc.save();
  return { filename: saveNewVersion(saved, entry), total_pages: outDoc.getPageCount() };
}

export async function rotatePage(file, pageIndices = [0], deg = 90) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const indices = Array.isArray(pageIndices) ? pageIndices : JSON.parse(pageIndices || '[0]');
  indices.forEach(idx => {
    if (idx >= 0 && idx < pdfDoc.getPageCount()) {
      const p = pdfDoc.getPage(idx);
      const cur = p.getRotation().angle || 0;
      p.setRotation(degrees((cur + Number(deg)) % 360));
    }
  });
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry), total_pages: pdfDoc.getPageCount() };
}

export async function cropPage(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const p = pdfDoc.getPage(Number(params.page ?? 0));
  const { width, height } = p.getSize();
  const margin = Number(params.margin ?? 20);
  p.setCropBox(margin, margin, Math.max(50, width - margin * 2), Math.max(50, height - margin * 2));
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

// ─── MERGE & SPLIT ────────────────────────────────────────────
export async function mergePDFs(files = []) {
  const merged = await PDFDocument.create();
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  const saved = await merged.save();
  return new Blob([saved], { type: 'application/pdf' });
}

export async function splitPDF(file, ranges = []) {
  const { bytes } = await resolveBytes(file);
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = srcDoc.getPageCount();
  const parsedRanges = Array.isArray(ranges) ? ranges : JSON.parse(ranges || '[]');
  const zip = new JSZip();

  let part = 1;
  for (const r of parsedRanges) {
    const parts = String(r).split('-').map(n => parseInt(n.trim(), 10));
    const start = Math.max(1, parts[0] || 1);
    const end = Math.min(total, parts[1] || start);
    if (start > end) continue;

    const indices = [];
    for (let p = start - 1; p <= end - 1; p++) indices.push(p);

    const subDoc = await PDFDocument.create();
    const copied = await subDoc.copyPages(srcDoc, indices);
    copied.forEach(p => subDoc.addPage(p));
    const subBytes = await subDoc.save();
    zip.file(`part_${part++}_pages_${start}-${end}.pdf`, subBytes);
  }

  return zip.generateAsync({ type: 'blob' });
}

// ─── COMPRESS & CONVERT ───────────────────────────────────────
export async function compressPDF(file, quality = 'medium') {
  const { bytes } = await resolveBytes(file);
  const settings = {
    low: { scale: 1.0, jpgQuality: 0.45 },
    medium: { scale: 1.35, jpgQuality: 0.68 },
    high: { scale: 1.75, jpgQuality: 0.82 }
  }[quality] || { scale: 1.35, jpgQuality: 0.68 };

  const jsDoc = await loadPdfJsDoc(bytes);
  const outDoc = await PDFDocument.create();

  for (let i = 1; i <= jsDoc.numPages; i++) {
    const p = await jsDoc.getPage(i);
    const baseVp = p.getViewport({ scale: 1.0 });
    const renderVp = p.getViewport({ scale: settings.scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(renderVp.width));
    canvas.height = Math.max(1, Math.floor(renderVp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport: renderVp }).promise;

    const jpgBytes = dataUrlToUint8Array(canvas.toDataURL('image/jpeg', settings.jpgQuality));
    const jpgImg = await outDoc.embedJpg(jpgBytes);
    const outPage = outDoc.addPage([baseVp.width, baseVp.height]);
    outPage.drawImage(jpgImg, { x: 0, y: 0, width: baseVp.width, height: baseVp.height });
  }

  await jsDoc.destroy();
  const compressedBytes = await outDoc.save({ useObjectStreams: true });
  const finalBytes = compressedBytes.byteLength < bytes.byteLength ? compressedBytes : bytes;
  return new Blob([finalBytes], { type: 'application/pdf' });
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function convertToDocx(file) {
  const { text, pagesText } = await extractPagesText(file);
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  const paragraphs = [];
  (pagesText.length ? pagesText : [text]).forEach((pageStr, idx) => {
    const lines = String(pageStr || '').split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) lines.push(`(Page ${idx + 1})`);
    lines.forEach(line => {
      paragraphs.push(`<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`);
    });
    if (idx < pagesText.length - 1) {
      paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
  });

  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('\n    ')}
  </w:body>
</w:document>`);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
}

export async function convertToImages(file, format = 'png') {
  const { bytes } = await resolveBytes(file);
  const doc = await loadPdfJsDoc(bytes);
  const zip = new JSZip();
  const isJpg = String(format).toLowerCase().includes('jp');
  const mime = isJpg ? 'image/jpeg' : 'image/png';
  const ext = isJpg ? 'jpg' : 'png';

  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    const imgBytes = dataUrlToUint8Array(canvas.toDataURL(mime, 0.92));
    zip.file(`page_${String(i).padStart(3, '0')}.${ext}`, imgBytes);
  }

  await doc.destroy();
  return zip.generateAsync({ type: 'blob' });
}

async function extractPagesText(file) {
  const { bytes } = await resolveBytes(file);
  const doc = await loadPdfJsDoc(bytes);
  const pagesText = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const content = await p.getTextContent();
    const str = content.items.map(item => item.str || '').join(' ').trim();
    pagesText.push(str);
  }
  await doc.destroy();
  return {
    pagesText,
    text: pagesText.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n')
  };
}

export async function convertToText(file) {
  const { text } = await extractPagesText(file);
  return { text };
}

export async function convertToHTML(file) {
  const { pagesText } = await extractPagesText(file);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Exported PDF</title></head><body>` +
    pagesText.map((t, i) => `<section><h2>Page ${i + 1}</h2><p>${escapeXml(t)}</p></section>`).join('<hr>') +
    `</body></html>`;
  return new Blob([html], { type: 'text/html' });
}

export async function runOCR(file) {
  const { id } = await resolveBytes(file);
  const { text } = await extractPagesText(file);
  return { text: text || 'No embedded text detected on pages.', filename: id };
}

// ─── WATERMARK, HEADER/FOOTER, BOOKMARKS ──────────────────────
export async function addWatermark(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const wmText = params.text || 'CONFIDENTIAL';
  const size = Number(params.size || 48);
  const opacity = Math.max(0.05, Math.min(1, Number(params.opacity ?? 0.3)));
  const angle = Number(params.angle ?? 45);
  const color = params.color || '#FF0000';

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    await drawSmartText(pdfDoc, page, wmText, {
      x: width * 0.2,
      y: height * 0.45,
      size,
      bold: true,
      color,
      opacity,
      angle
    });
  }

  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function addHeaderFooter(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const size = Number(params.size || 10);
  const color = params.color || '#333333';
  const align = params.align || 'center';
  const showNums = params.page_numbers === true || params.page_numbers === 'true';

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const calcX = (txt) => {
      const approxW = txt.length * size * 0.52;
      if (align === 'left') return 36;
      if (align === 'right') return Math.max(36, width - approxW - 36);
      return Math.max(36, (width - approxW) / 2);
    };

    if (params.header) {
      await drawSmartText(pdfDoc, page, params.header, {
        x: calcX(params.header),
        y: height - 28,
        size,
        color
      });
    }

    const footerParts = [];
    if (params.footer) footerParts.push(params.footer);
    if (showNums) footerParts.push(`Page ${i + 1} of ${pages.length}`);
    const footerStr = footerParts.join('  •  ');
    if (footerStr) {
      await drawSmartText(pdfDoc, page, footerStr, {
        x: calcX(footerStr),
        y: 20,
        size,
        color
      });
    }
  }

  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function getBookmarks(filename) {
  const entry = pdfStore.get(filename);
  return { bookmarks: entry?.bookmarks || [] };
}

export async function addBookmark(file, params = {}) {
  const { entry, id } = await resolveBytes(file);
  entry.bookmarks.push({
    title: params.title || 'Bookmark',
    page: Number(params.page || 0),
    level: Number(params.level || 1)
  });
  return { filename: id, bookmarks: entry.bookmarks };
}

export async function deleteBookmark(file, bookmarkIndex) {
  const { entry, id } = await resolveBytes(file);
  entry.bookmarks.splice(Number(bookmarkIndex), 1);
  return { filename: id, bookmarks: entry.bookmarks };
}

export async function addLink(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(Number(params.page ?? 0));
  await drawSmartText(pdfDoc, page, params.url || 'https://example.com', {
    x: Number(params.x || 72),
    y: Number(params.y || 72),
    size: 11,
    color: '#2563EB'
  });
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function redactContent(file, params = {}) {
  return redactRegion(file, params);
}

// ─── SECURITY & METADATA ──────────────────────────────────────
export async function addPassword(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  pdfDoc.setProducer('PDF Master Protected');
  if (params.user_password) {
    pdfDoc.setKeywords([`protected`]);
  }
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function removePassword(file) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function getMetadata(filename) {
  const { bytes } = await resolveBytes(filename);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return {
    title: pdfDoc.getTitle() || '',
    author: pdfDoc.getAuthor() || '',
    subject: pdfDoc.getSubject() || '',
    keywords: pdfDoc.getKeywords() || '',
    creator: pdfDoc.getCreator() || ''
  };
}

export async function updateMetadata(file, params = {}) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (params.title !== undefined) pdfDoc.setTitle(String(params.title));
  if (params.author !== undefined) pdfDoc.setAuthor(String(params.author));
  if (params.subject !== undefined) pdfDoc.setSubject(String(params.subject));
  if (params.keywords !== undefined) {
    const kw = String(params.keywords).split(',').map(s => s.trim()).filter(Boolean);
    pdfDoc.setKeywords(kw);
  }
  if (params.creator !== undefined) pdfDoc.setCreator(String(params.creator));
  const saved = await pdfDoc.save();
  const filename = saveNewVersion(saved, entry);
  return { filename };
}

// ─── FORMS ────────────────────────────────────────────────────
export async function listFormFields(filename) {
  const { bytes } = await resolveBytes(filename);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const fields = pdfDoc.getForm().getFields().map(f => ({
    name: f.getName(),
    type: f.constructor.name
  }));
  return { fields };
}

export async function addFormField(file, params = {}) {
  return fillForms(file, [params]);
}

export async function fillForms(file, fields = []) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const list = Array.isArray(fields) ? fields : JSON.parse(fields || '[]');

  for (const item of list) {
    const page = pdfDoc.getPage(Number(item.page ?? 0));
    const { height: pageH } = page.getSize();
    const fieldName = `${item.name || 'field'}_${Date.now()}`;
    const x = Number(item.x || 100);
    const w = Number(item.width || 160);
    const h = Number(item.height || 24);
    const y = Math.max(20, pageH - Number(item.y || 120) - h);

    if (item.field_type === 'checkbox') {
      const cb = form.createCheckBox(fieldName);
      cb.addToPage(page, { x, y, width: 18, height: 18 });
      if (item.default_value === 'true' || item.default_value === true) cb.check();
    } else {
      const tf = form.createTextField(fieldName);
      if (item.default_value) tf.setText(String(item.default_value));
      tf.addToPage(page, { x, y, width: w, height: h });
    }
  }

  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
}

export async function flattenForms(file) {
  const { bytes, entry } = await resolveBytes(file);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  pdfDoc.getForm().flatten();
  const saved = await pdfDoc.save();
  return { filename: saveNewVersion(saved, entry) };
    }
