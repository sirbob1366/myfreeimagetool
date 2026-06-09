/* ===========================================================
   editor.js — Unified image editor controller
   Loads one image, then applies tools (compress/resize/convert/crop/
   rotate/watermark/blur/to-pdf) in sequence. Each apply produces a new
   image you keep editing. Undo/redo over the image history.
   =========================================================== */

(function () {
  'use strict';

  const state = {
    src: null,            // { img, width, height, name, type, size }
    currentTool: null,
    baseName: 'image',
    cropRect: null,       // display-space rect while cropping
    textPos: null,        // { x, y } image-space anchor for the text tool
    objects: [],          // non-destructive overlay: draw strokes + shapes (image coords)
    selectedObjId: null,
    history: [],          // array of { blob, name, type }
    histIndex: -1,
    original: null        // first loaded blob for Reset
  };

  const $ = s => document.querySelector(s);
  const dropzone = $('#dropzone');
  const fileInput = $('#file-input');
  const addInput = $('#add-image-input');
  const emptyEl = $('#editor-empty');
  const toolbar = $('#viewer-toolbar');
  const stage = $('#image-stage');
  const canvas = $('#img-canvas');
  const ctx = canvas.getContext('2d');
  const cropOverlay = $('#crop-overlay');
  const actionBar = $('#editor-actionbar');
  const abSummary = $('#ab-summary');
  const vtFile = $('#vt-file');
  const undoBtn = $('#undo-btn');
  const redoBtn = $('#redo-btn');
  const resetBtn = $('#reset-btn');
  const inspectorTitle = $('#inspector-title');
  const inspectorHint = $('#inspector-hint');
  const inspectorBody = $('#inspector-body');

  // ---------- Loading ----------
  ImgUtils.attachDropzone({ dropzone, input: fileInput, onFiles: files => loadFile(files[0]) });

  async function loadFile(file) {
    ImgUtils.setStatus('Loading…');
    try {
      const src = await ImageEngine.loadImage(file);
      state.src = src;
      state.baseName = ImgUtils.stripExt(file.name) || 'image';
      state.original = file;
      emptyEl.style.display = 'none';
      stage.style.display = 'block';
      toolbar.style.display = 'flex';
      actionBar.style.display = 'flex';
      document.querySelectorAll('.tool-btn').forEach(b => b.disabled = false);
      renderViewer();
      // history starts with the loaded image
      state.history = [{ blob: file, name: file.name, type: src.type }];
      state.histIndex = 0;
      updateHistoryButtons();
      setTool('compress');
      ImgUtils.setStatus('');
    } catch (e) {
      console.error(e);
      ImgUtils.setStatus('Could not open this image.', 'error');
    }
  }

  // Reload the working image from a Blob (after an op). Keeps chaining.
  async function setImageFromBlob(blob, name) {
    const file = new File([blob], name || (state.baseName + '.' + ImageEngine.extFor(blob.type)), { type: blob.type });
    state.src = await ImageEngine.loadImage(file);
    renderViewer();
    updateSummary();
  }

  // ---------- Viewer ----------
  function renderViewer() {
    const s = state.src;
    canvas.width = s.width;
    canvas.height = s.height;
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.drawImage(s.img, 0, 0, s.width, s.height);
    drawObjects(ctx);
    // fit within viewer via CSS
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '72vh';
    canvas.style.width = 'auto';
    canvas.style.height = 'auto';
    vtFile.textContent = `${s.name} · ${s.width}×${s.height} · ${ImgUtils.formatBytes(s.size)}`;
    updateSummary();
  }

  function updateSummary() {
    const s = state.src;
    if (s) abSummary.innerHTML = `<strong>${s.width}×${s.height}</strong> · ${ImageEngine.extFor(s.type).toUpperCase()} · ${ImgUtils.formatBytes(s.size)}`;
  }

  // ---------- Overlay objects (draw / shapes) ----------
  const uid = () => 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function drawObjects(cx, list) {
    (list || state.objects).forEach(o => {
      if (o.visible === false) return;
      cx.save();
      cx.strokeStyle = o.color; cx.fillStyle = o.color; cx.lineWidth = o.width || o.stroke || 4;
      cx.lineCap = 'round'; cx.lineJoin = 'round';
      if (o.kind === 'draw') {
        cx.beginPath();
        o.points.forEach((p, i) => i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]));
        cx.stroke();
      } else if (o.kind === 'shape') {
        drawShape(cx, o);
      }
      cx.restore();
    });
  }

  function drawShape(cx, o) {
    const x = Math.min(o.sx, o.ex), y = Math.min(o.sy, o.ey), w = Math.abs(o.ex - o.sx), h = Math.abs(o.ey - o.sy);
    if (o.shape === 'rect') { o.fill ? cx.fillRect(x, y, w, h) : cx.strokeRect(x, y, w, h); }
    else if (o.shape === 'ellipse') {
      cx.beginPath(); cx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      o.fill ? cx.fill() : cx.stroke();
    } else if (o.shape === 'line' || o.shape === 'arrow') {
      cx.beginPath(); cx.moveTo(o.sx, o.sy); cx.lineTo(o.ex, o.ey); cx.stroke();
      if (o.shape === 'arrow') {
        const a = Math.atan2(o.ey - o.sy, o.ex - o.sx), len = Math.max(10, (o.stroke || 4) * 3.2);
        cx.beginPath(); cx.moveTo(o.ex, o.ey);
        cx.lineTo(o.ex - len * Math.cos(a - 0.4), o.ey - len * Math.sin(a - 0.4));
        cx.moveTo(o.ex, o.ey);
        cx.lineTo(o.ex - len * Math.cos(a + 0.4), o.ey - len * Math.sin(a + 0.4));
        cx.stroke();
      }
    }
  }

  function compositeCanvas() {
    const c = document.createElement('canvas');
    c.width = state.src.width; c.height = state.src.height;
    const cx = c.getContext('2d');
    cx.drawImage(state.src.img, 0, 0);
    drawObjects(cx);
    return c;
  }

  // Bake overlay objects into the base image (called before destructive ops / export).
  async function flattenObjects() {
    if (!state.objects.length) return;
    const c = compositeCanvas();
    const blob = await new Promise(r => c.toBlob(r, state.src.type || 'image/png', 0.95));
    state.objects = []; state.selectedObjId = null;
    await setImageFromBlob(blob, state.src.name);
  }

  // map a pointer event to image-space coords
  function toImagePoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (state.src.width / r.width), y: (e.clientY - r.top) * (state.src.height / r.height) };
  }

  // ---------- History ----------
  function pushHistory(blob, name) {
    if (state.histIndex < state.history.length - 1) state.history = state.history.slice(0, state.histIndex + 1);
    state.history.push({ blob, name, type: blob.type });
    if (state.history.length > 30) state.history.shift();
    state.histIndex = state.history.length - 1;
    updateHistoryButtons();
  }
  async function restoreHistory(i) {
    const h = state.history[i];
    state.histIndex = i;
    await setImageFromBlob(h.blob, h.name);
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    if (undoBtn) undoBtn.disabled = state.histIndex <= 0;
    if (redoBtn) redoBtn.disabled = state.histIndex >= state.history.length - 1;
  }
  undoBtn.onclick = () => { if (state.histIndex > 0) restoreHistory(state.histIndex - 1); };
  redoBtn.onclick = () => { if (state.histIndex < state.history.length - 1) restoreHistory(state.histIndex + 1); };
  resetBtn.onclick = () => { if (state.original) { state.history = []; setImageFromBlob(state.original, state.original.name).then(() => { pushHistory(state.original, state.original.name); }); } };

  document.addEventListener('keydown', e => {
    if (!state.src) return;
    const t = document.activeElement && document.activeElement.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undoBtn.click(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redoBtn.click(); }
  });

  // Run an op, commit to history, keep editing.
  async function applyOp(producer, statusMsg) {
    ImgUtils.setStatus(statusMsg || 'Working…');
    try {
      await flattenObjects(); // bake any draw/shape overlay into the base first
      const blob = await producer();
      const name = state.baseName + '.' + ImageEngine.extFor(blob.type);
      await setImageFromBlob(blob, name);
      pushHistory(blob, name);
      ImgUtils.setStatus('Applied.', 'success');
    } catch (e) { console.error(e); ImgUtils.setStatus('That operation failed.', 'error'); }
  }

  // ---------- Tools ----------
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'open') { fileInput.click(); return; }
      if (tool === 'download') { downloadCurrent(); return; }
      if (!state.src) return;
      setTool(tool);
    });
  });

  function setTool(tool) {
    state.currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    cropOverlay.style.display = 'none';
    cropOverlay.innerHTML = '';
    cropOverlay.onpointerdown = null;
    state.cropRect = null;
    renderViewer(); // reset any live preview
    showInspector(tool);
  }

  function downloadCurrent() {
    if (!state.src) return;
    compositeCanvas().toBlob(b => ImgUtils.download(b, state.baseName + '.' + ImageEngine.extFor(state.src.type)), state.src.type, 0.95);
  }
  $('#download-btn').onclick = downloadCurrent;

  // ---------- Inspector ----------
  function showInspector(tool) {
    inspectorBody.innerHTML = '';
    if (tool === 'text') return inspText();
    if (tool === 'draw') return inspDraw();
    if (tool === 'shapes') return inspShapes();
    if (tool === 'layers') return inspLayers();
    if (tool === 'filters') return inspFilters();
    if (tool === 'compress') return inspCompress();
    if (tool === 'resize') return inspResize();
    if (tool === 'convert') return inspConvert();
    if (tool === 'crop') return inspCrop();
    if (tool === 'rotate') return inspRotate();
    if (tool === 'watermark') return inspWatermark();
    if (tool === 'blur') return inspBlur();
    if (tool === 'topdf') return inspToPdf();
  }

  function inspDraw() {
    inspectorTitle.textContent = 'Draw';
    inspectorHint.textContent = 'Drag on the image to draw freehand. Each stroke is its own layer.';
    inspectorBody.innerHTML = `
      <div class="field-row">
        <div class="field"><label>Colour</label><input type="color" id="d-color" value="#ff3b30" /></div>
        <div class="field"><label>Brush size <span class="range-val" id="d-w-v">8px</span></label><input type="range" id="d-w" min="1" max="60" value="8" /></div>
      </div>
      <p class="meta-line">Use the Layers panel to hide or delete strokes.</p>
    `;
    cropOverlay.style.display = 'block'; cropOverlay.innerHTML = '';
    $('#d-w').oninput = () => $('#d-w-v').textContent = $('#d-w').value + 'px';
    cropOverlay.onpointerdown = e => {
      const color = $('#d-color').value, width = Number($('#d-w').value), pts = [];
      const add = ev => {
        const p = toImagePoint(ev); pts.push([p.x, p.y]);
        renderViewer();
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); ctx.restore();
      };
      add(e);
      const move = ev => add(ev);
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (pts.length) { state.objects.push({ id: uid(), kind: 'draw', color, width, points: pts, visible: true }); renderViewer(); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
  }

  function inspShapes() {
    inspectorTitle.textContent = 'Shapes & arrows';
    inspectorHint.textContent = 'Pick a shape, then drag on the image to draw it.';
    inspectorBody.innerHTML = `
      <div class="field"><label>Shape</label><div class="seg" id="s-shapes">
        <button type="button" data-shape="rect" class="active">▭</button>
        <button type="button" data-shape="ellipse">◯</button>
        <button type="button" data-shape="line">╱</button>
        <button type="button" data-shape="arrow">➜</button>
      </div></div>
      <div class="field-row">
        <div class="field"><label>Colour</label><input type="color" id="s-color" value="#ff3b30" /></div>
        <div class="field"><label>Stroke <span class="range-val" id="s-w-v">6px</span></label><input type="range" id="s-w" min="1" max="40" value="6" /></div>
      </div>
      <label class="check"><input type="checkbox" id="s-fill" /> Fill (rectangle &amp; ellipse)</label>
    `;
    let shape = 'rect';
    $('#s-shapes').querySelectorAll('button').forEach(b => b.onclick = () => { shape = b.dataset.shape; $('#s-shapes').querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); });
    $('#s-w').oninput = () => $('#s-w-v').textContent = $('#s-w').value + 'px';
    cropOverlay.style.display = 'block'; cropOverlay.innerHTML = '';
    cropOverlay.onpointerdown = e => {
      const start = toImagePoint(e);
      const o = { id: uid(), kind: 'shape', shape, sx: start.x, sy: start.y, ex: start.x, ey: start.y, color: $('#s-color').value, stroke: Number($('#s-w').value), fill: $('#s-fill').checked, visible: true };
      const move = ev => {
        const p = toImagePoint(ev); o.ex = p.x; o.ey = p.y;
        renderViewer();
        ctx.save(); ctx.strokeStyle = o.color; ctx.fillStyle = o.color; ctx.lineWidth = o.stroke; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; drawShape(ctx, o); ctx.restore();
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (Math.abs(o.ex - o.sx) > 2 || Math.abs(o.ey - o.sy) > 2) { state.objects.push(o); renderViewer(); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
  }

  function inspLayers() {
    inspectorTitle.textContent = 'Layers';
    inspectorHint.textContent = 'Background plus each stroke and shape you add. Reorder, hide or delete.';
    renderLayers();
  }
  function renderLayers() {
    if (state.currentTool !== 'layers') return;
    const top = [...state.objects].reverse(); // show top of stack first
    inspectorBody.innerHTML = `
      <div class="layer-list">
        ${top.map(o => `<div class="layer-row" data-id="${o.id}">
          <button class="lr-btn lr-vis" title="Show/hide">${o.visible === false ? '◌' : '●'}</button>
          <span class="lr-name">${o.kind === 'draw' ? 'Brush stroke' : (o.shape.charAt(0).toUpperCase() + o.shape.slice(1))}</span>
          <button class="lr-btn lr-up" title="Move up">↑</button>
          <button class="lr-btn lr-down" title="Move down">↓</button>
          <button class="lr-btn lr-del" title="Delete">✕</button>
        </div>`).join('')}
        <div class="layer-row layer-bg"><button class="lr-btn" disabled>▦</button><span class="lr-name">Background image</span></div>
      </div>
      ${state.objects.length ? `<button class="btn btn-ghost btn-block" id="lr-flatten" type="button" style="margin-top:12px;">Flatten all into image</button>` : '<p class="meta-line">No layers yet — add some with Draw or Shapes.</p>'}
    `;
    inspectorBody.querySelectorAll('.layer-row[data-id]').forEach(row => {
      const id = row.dataset.id;
      const idx = () => state.objects.findIndex(o => o.id === id);
      row.querySelector('.lr-vis').onclick = () => { const o = state.objects[idx()]; o.visible = o.visible === false; renderViewer(); renderLayers(); };
      row.querySelector('.lr-up').onclick = () => { const i = idx(); if (i < state.objects.length - 1) { [state.objects[i], state.objects[i + 1]] = [state.objects[i + 1], state.objects[i]]; renderViewer(); renderLayers(); } };
      row.querySelector('.lr-down').onclick = () => { const i = idx(); if (i > 0) { [state.objects[i], state.objects[i - 1]] = [state.objects[i - 1], state.objects[i]]; renderViewer(); renderLayers(); } };
      row.querySelector('.lr-del').onclick = () => { state.objects.splice(idx(), 1); renderViewer(); renderLayers(); };
    });
    const fl = $('#lr-flatten');
    if (fl) fl.onclick = () => flattenObjects().then(() => { renderViewer(); renderLayers(); ImgUtils.setStatus('Flattened into image.', 'success'); });
  }

  function inspFilters() {
    inspectorTitle.textContent = 'Filters & adjustments';
    inspectorHint.textContent = 'Drag the sliders or pick a preset. Preview updates live.';
    inspectorBody.innerHTML = `
      <div class="field"><label>Brightness <span class="range-val" id="f-br-v">100%</span></label><input type="range" id="f-br" min="0" max="200" value="100" /></div>
      <div class="field"><label>Contrast <span class="range-val" id="f-co-v">100%</span></label><input type="range" id="f-co" min="0" max="200" value="100" /></div>
      <div class="field"><label>Saturation <span class="range-val" id="f-sa-v">100%</span></label><input type="range" id="f-sa" min="0" max="200" value="100" /></div>
      <div class="field"><label>Presets</label><div class="seg">
        <button type="button" id="f-gray">B&amp;W</button>
        <button type="button" id="f-sepia">Sepia</button>
        <button type="button" id="f-invert">Invert</button>
      </div></div>
      <div class="field-row" style="margin-top:6px;">
        <button class="btn btn-ghost" id="f-reset" type="button">Reset</button>
        <button class="btn btn-primary" id="f-go" type="button">Apply</button>
      </div>
    `;
    let gray = false, sepia = false, invert = false;
    const opts = () => ({
      brightness: Number($('#f-br').value), contrast: Number($('#f-co').value), saturate: Number($('#f-sa').value),
      grayscale: gray ? 100 : 0, sepia: sepia ? 100 : 0, invert: invert ? 100 : 0
    });
    const preview = () => {
      $('#f-br-v').textContent = $('#f-br').value + '%';
      $('#f-co-v').textContent = $('#f-co').value + '%';
      $('#f-sa-v').textContent = $('#f-sa').value + '%';
      renderViewer();
      ctx.save(); ctx.filter = ImageEngine.filterString(opts());
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(state.src.img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    inspectorBody.addEventListener('input', preview);
    $('#f-gray').onclick = () => { gray = !gray; $('#f-gray').classList.toggle('active', gray); preview(); };
    $('#f-sepia').onclick = () => { sepia = !sepia; $('#f-sepia').classList.toggle('active', sepia); preview(); };
    $('#f-invert').onclick = () => { invert = !invert; $('#f-invert').classList.toggle('active', invert); preview(); };
    $('#f-reset').onclick = () => { $('#f-br').value = 100; $('#f-co').value = 100; $('#f-sa').value = 100; gray = sepia = invert = false; inspectorBody.querySelectorAll('.seg button').forEach(b => b.classList.remove('active')); preview(); };
    $('#f-go').onclick = () => applyOp(() => ImageEngine.adjust(state.src, { ...opts(), mime: state.src.type }), 'Applying…').then(() => setTool('filters'));
    preview();
  }

  function inspText() {
    inspectorTitle.textContent = 'Add text';
    inspectorHint.textContent = 'Type, pick a font/colour, then click on the image to position. Drag to move.';
    const fontOpts = ImageEngine.TEXT_FONTS.map((f, i) => `<option value='${f.css}' ${i === 0 ? 'selected' : ''}>${f.label}</option>`).join('');
    inspectorBody.innerHTML = `
      <div class="field"><label>Text</label><textarea id="tx-text" rows="2">Your text</textarea></div>
      <div class="field"><label>Font</label><select id="tx-font">${fontOpts}</select></div>
      <div class="field-row">
        <div class="field"><label>Size</label><input type="number" id="tx-size" value="${Math.round(state.src.width * 0.08)}" min="6" /></div>
        <div class="field"><label>Colour</label><input type="color" id="tx-color" value="#ffffff" /></div>
      </div>
      <div class="field"><label>Style</label><div class="seg"><button type="button" id="tx-bold" style="font-weight:700">Bold</button><button type="button" id="tx-italic" style="font-style:italic">Italic</button></div></div>
      <button class="btn btn-primary btn-block" id="tx-go" type="button" style="margin-top:12px;">Apply text</button>
    `;
    state.textPos = { x: Math.round(state.src.width * 0.1), y: Math.round(state.src.height * 0.42) };
    cropOverlay.style.display = 'block'; cropOverlay.innerHTML = '';
    let bold = false, italic = false;
    const opts = () => ({ text: $('#tx-text').value, font: $('#tx-font').value, size: Number($('#tx-size').value), color: $('#tx-color').value, x: state.textPos.x, y: state.textPos.y, bold, italic });
    const preview = () => drawTextPreview(opts());
    ['input', 'change'].forEach(ev => inspectorBody.addEventListener(ev, () => { if (state.src) preview(); }));
    $('#tx-bold').onclick = () => { bold = !bold; $('#tx-bold').classList.toggle('active', bold); preview(); };
    $('#tx-italic').onclick = () => { italic = !italic; $('#tx-italic').classList.toggle('active', italic); preview(); };
    cropOverlay.onpointerdown = e => {
      const r = canvas.getBoundingClientRect();
      const sx = state.src.width / r.width, sy = state.src.height / r.height;
      const setPos = ev => { state.textPos = { x: Math.max(0, (ev.clientX - r.left) * sx), y: Math.max(0, (ev.clientY - r.top) * sy) }; preview(); };
      setPos(e);
      const move = ev => setPos(ev);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    preview();
    $('#tx-go').onclick = () => applyOp(() => ImageEngine.addText(state.src, { ...opts(), mime: state.src.type }), 'Adding text…').then(() => setTool('text'));
  }

  function drawTextPreview(o) {
    renderViewer();
    if (!o.text) return;
    ctx.save();
    ctx.font = `${o.bold ? '700 ' : ''}${o.italic ? 'italic ' : ''}${o.size}px ${o.font}`;
    ctx.fillStyle = o.color; ctx.textBaseline = 'top';
    const lines = o.text.split('\n'), lh = o.size * 1.25;
    lines.forEach((ln, i) => ctx.fillText(ln, o.x, o.y + i * lh));
    ctx.restore();
  }

  function inspCompress() {
    inspectorTitle.textContent = 'Compress';
    inspectorHint.textContent = 'Lower quality = smaller file. JPEG/WebP compress best.';
    inspectorBody.innerHTML = `
      <div class="field"><label>Quality <span class="range-val" id="cq-val">70%</span></label>
        <input type="range" id="cq" min="10" max="100" value="70" /></div>
      <div class="field"><label>Format</label>
        <select id="cf"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></div>
      <button class="btn btn-primary btn-block" id="cgo" type="button">Apply compression</button>
    `;
    $('#cq').oninput = () => $('#cq-val').textContent = $('#cq').value + '%';
    $('#cgo').onclick = () => applyOp(() => ImageEngine.compress(state.src, { quality: Number($('#cq').value) / 100, mime: $('#cf').value }), 'Compressing…');
  }

  function inspResize() {
    inspectorTitle.textContent = 'Resize';
    inspectorHint.textContent = 'Set new dimensions. Aspect ratio is kept by default.';
    const s = state.src;
    inspectorBody.innerHTML = `
      <div class="field-row">
        <div class="field"><label>Width (px)</label><input type="number" id="rw" value="${s.width}" min="1" /></div>
        <div class="field"><label>Height (px)</label><input type="number" id="rh" value="${s.height}" min="1" /></div>
      </div>
      <div class="field"><label>Scale</label>
        <select id="rscale"><option value="">Custom</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="0.75">75%</option></select></div>
      <label class="check"><input type="checkbox" id="rlock" checked /> Maintain aspect ratio</label>
      <button class="btn btn-primary btn-block" id="rgo" type="button" style="margin-top:12px;">Apply resize</button>
    `;
    const aspect = s.width / s.height;
    const rw = $('#rw'), rh = $('#rh'), lock = $('#rlock');
    rw.oninput = () => { if (lock.checked) rh.value = Math.round(rw.value / aspect); };
    rh.oninput = () => { if (lock.checked) rw.value = Math.round(rh.value * aspect); };
    $('#rscale').onchange = () => { const f = Number($('#rscale').value); if (f) { rw.value = Math.round(s.width * f); rh.value = Math.round(s.height * f); } };
    $('#rgo').onclick = () => applyOp(() => ImageEngine.resize(state.src, { width: Number(rw.value), height: Number(rh.value), mime: state.src.type }), 'Resizing…');
  }

  function inspConvert() {
    inspectorTitle.textContent = 'Convert';
    inspectorHint.textContent = 'Change the file format.';
    inspectorBody.innerHTML = `
      <div class="field"><label>Convert to</label>
        <select id="cvf"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></div>
      <button class="btn btn-primary btn-block" id="cvgo" type="button">Convert</button>
    `;
    $('#cvgo').onclick = () => applyOp(() => ImageEngine.convert(state.src, { mime: $('#cvf').value }), 'Converting…');
  }

  function inspRotate() {
    inspectorTitle.textContent = 'Rotate & Flip';
    inspectorHint.textContent = 'Each action applies immediately.';
    inspectorBody.innerHTML = `
      <div class="field-row">
        <button class="btn btn-ghost" id="rl" type="button">↺ 90° left</button>
        <button class="btn btn-ghost" id="rr" type="button">↻ 90° right</button>
      </div>
      <button class="btn btn-ghost btn-block" id="r180" type="button" style="margin-top:8px;">180°</button>
      <div class="divider"></div>
      <div class="field-row">
        <button class="btn btn-ghost" id="fh" type="button">⇋ Flip H</button>
        <button class="btn btn-ghost" id="fv" type="button">⇅ Flip V</button>
      </div>
    `;
    const t = (o, msg) => applyOp(() => ImageEngine.transform(state.src, { ...o, mime: state.src.type }), msg);
    $('#rl').onclick = () => t({ deg: 270 }, 'Rotating…');
    $('#rr').onclick = () => t({ deg: 90 }, 'Rotating…');
    $('#r180').onclick = () => t({ deg: 180 }, 'Rotating…');
    $('#fh').onclick = () => t({ flipH: true }, 'Flipping…');
    $('#fv').onclick = () => t({ flipV: true }, 'Flipping…');
  }

  function inspWatermark() {
    inspectorTitle.textContent = 'Watermark';
    inspectorHint.textContent = 'Live preview updates as you type.';
    inspectorBody.innerHTML = `
      <div class="field"><label>Text</label><input type="text" id="wt" value="© MyFreeImageTool" /></div>
      <div class="field-row">
        <div class="field"><label>Size <span class="range-val" id="ws-val"></span></label><input type="range" id="ws" min="10" max="200" value="${Math.round(state.src.width * 0.06)}" /></div>
      </div>
      <div class="field"><label>Opacity <span class="range-val" id="wo-val">50%</span></label><input type="range" id="wo" min="5" max="100" value="50" /></div>
      <div class="field-row">
        <div class="field"><label>Colour</label><input type="color" id="wc" value="#ffffff" /></div>
        <div class="field"><label>Position</label>
          <select id="wp"><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="center">Center</option><option value="top-right">Top right</option><option value="top-left">Top left</option></select></div>
      </div>
      <button class="btn btn-primary btn-block" id="wgo" type="button">Apply watermark</button>
    `;
    const opts = () => ({ text: $('#wt').value, fontSize: Number($('#ws').value), opacity: Number($('#wo').value) / 100, color: $('#wc').value, position: $('#wp').value });
    const preview = () => {
      $('#ws-val').textContent = $('#ws').value + 'px';
      $('#wo-val').textContent = $('#wo').value + '%';
      drawWatermarkPreview(opts());
    };
    ['input', 'change'].forEach(ev => inspectorBody.addEventListener(ev, preview));
    preview();
    $('#wgo').onclick = () => applyOp(() => ImageEngine.watermark(state.src, { ...opts(), mime: state.src.type }), 'Adding watermark…');
  }

  function drawWatermarkPreview(o) {
    renderViewer();
    const text = o.text || '';
    if (!text) return;
    ctx.save();
    ctx.font = `600 ${o.fontSize}px -apple-system, Helvetica, Arial, sans-serif`;
    ctx.fillStyle = o.color; ctx.globalAlpha = o.opacity; ctx.textBaseline = 'middle';
    const m = ctx.measureText(text); const pad = Math.round(o.fontSize * 0.6);
    let x = pad, y = pad + o.fontSize / 2;
    if (o.position.includes('right')) x = canvas.width - m.width - pad;
    if (o.position.includes('bottom')) y = canvas.height - pad - o.fontSize / 2;
    if (o.position === 'center') { x = (canvas.width - m.width) / 2; y = canvas.height / 2; }
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = Math.max(2, o.fontSize * 0.06);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function inspBlur() {
    inspectorTitle.textContent = 'Blur background';
    inspectorHint.textContent = 'Keeps the centre sharp and blurs the rest.';
    inspectorBody.innerHTML = `
      <div class="field"><label>Blur strength <span class="range-val" id="bb-val">12px</span></label><input type="range" id="bb" min="2" max="40" value="12" /></div>
      <div class="field"><label>Focus size <span class="range-val" id="bf-val">42%</span></label><input type="range" id="bf" min="15" max="80" value="42" /></div>
      <button class="btn btn-primary btn-block" id="bgo" type="button">Apply blur</button>
    `;
    $('#bb').oninput = () => $('#bb-val').textContent = $('#bb').value + 'px';
    $('#bf').oninput = () => $('#bf-val').textContent = $('#bf').value + '%';
    $('#bgo').onclick = () => applyOp(() => ImageEngine.blurBackground(state.src, { blur: Number($('#bb').value), focus: Number($('#bf').value) / 100, mime: state.src.type }), 'Blurring…');
  }

  function inspToPdf() {
    inspectorTitle.textContent = 'Image to PDF';
    inspectorHint.textContent = 'Save the current image as a one-page PDF, or add more images for a multi-page PDF.';
    inspectorBody.innerHTML = `
      <button class="btn btn-primary btn-block" id="pdf-one" type="button">Save current as PDF</button>
      <div class="divider"></div>
      <button class="btn btn-ghost btn-block" id="pdf-more" type="button">Add more images &amp; make PDF</button>
    `;
    $('#pdf-one').onclick = async () => {
      ImgUtils.setStatus('Building PDF…');
      try {
        await flattenObjects();
        const bytes = await ImageEngine.imagesToPdf([state.src]);
        ImgUtils.download(new Blob([bytes], { type: 'application/pdf' }), state.baseName + '.pdf');
        ImgUtils.setStatus('PDF downloaded.', 'success');
      } catch (e) { console.error(e); ImgUtils.setStatus('Could not build PDF.', 'error'); }
    };
    $('#pdf-more').onclick = () => addInput.click();
  }

  addInput.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    ImgUtils.setStatus('Building PDF…');
    try {
      await flattenObjects();
      const extra = [];
      for (const f of files) extra.push(await ImageEngine.loadImage(f));
      const bytes = await ImageEngine.imagesToPdf([state.src, ...extra]);
      ImgUtils.download(new Blob([bytes], { type: 'application/pdf' }), state.baseName + '_album.pdf');
      ImgUtils.setStatus(`PDF with ${extra.length + 1} pages downloaded.`, 'success');
    } catch (e) { console.error(e); ImgUtils.setStatus('Could not build PDF.', 'error'); }
    addInput.value = '';
  });

  // ---------- Crop ----------
  function inspCrop() {
    inspectorTitle.textContent = 'Crop';
    inspectorHint.textContent = 'Drag on the image to select an area, then apply.';
    inspectorBody.innerHTML = `
      <div class="meta-line" id="crop-meta">Drag a selection on the image.</div>
      <button class="btn btn-primary btn-block" id="crop-go" type="button" style="margin-top:12px;" disabled>Apply crop</button>
      <button class="btn btn-ghost btn-block" id="crop-clear" type="button" style="margin-top:8px;">Clear selection</button>
    `;
    cropOverlay.style.display = 'block';
    cropOverlay.innerHTML = '';
    state.cropRect = null;
    setupCropDrag();
    $('#crop-clear').onclick = () => { cropOverlay.innerHTML = ''; state.cropRect = null; $('#crop-go').disabled = true; $('#crop-meta').textContent = 'Drag a selection on the image.'; };
    $('#crop-go').onclick = () => {
      if (!state.cropRect) return;
      const scaleX = state.src.width / canvas.getBoundingClientRect().width;
      const scaleY = state.src.height / canvas.getBoundingClientRect().height;
      const r = state.cropRect;
      const rect = {
        x: Math.round(r.x * scaleX), y: Math.round(r.y * scaleY),
        w: Math.round(r.w * scaleX), h: Math.round(r.h * scaleY)
      };
      if (rect.w < 2 || rect.h < 2) return;
      applyOp(() => ImageEngine.crop(state.src, rect, { mime: state.src.type }), 'Cropping…').then(() => setTool('crop'));
    };
  }

  function setupCropDrag() {
    let box = null, start = null;
    cropOverlay.onpointerdown = e => {
      const r = cropOverlay.getBoundingClientRect();
      start = { x: e.clientX - r.left, y: e.clientY - r.top };
      box = document.createElement('div');
      box.className = 'crop-rect';
      cropOverlay.innerHTML = '';
      cropOverlay.appendChild(box);
      const move = ev => {
        const x = Math.max(0, Math.min(ev.clientX - r.left, r.width));
        const y = Math.max(0, Math.min(ev.clientY - r.top, r.height));
        const left = Math.min(x, start.x), top = Math.min(y, start.y);
        const w = Math.abs(x - start.x), h = Math.abs(y - start.y);
        box.style.left = left + 'px'; box.style.top = top + 'px';
        box.style.width = w + 'px'; box.style.height = h + 'px';
        state.cropRect = { x: left, y: top, w, h };
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const go = $('#crop-go'), meta = $('#crop-meta');
        if (state.cropRect && state.cropRect.w > 4 && state.cropRect.h > 4) {
          if (go) go.disabled = false;
          const sx = state.src.width / r.width, sy = state.src.height / r.height;
          if (meta) meta.innerHTML = `Selection: <strong>${Math.round(state.cropRect.w * sx)}×${Math.round(state.cropRect.h * sy)}</strong> px`;
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

})();
