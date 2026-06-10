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
    history: [],          // array of { blob, name, type, objects }
    histIndex: -1,
    original: null,       // first loaded blob
    initial: null         // full initial snapshot { blob, name, type, objects } for Reset
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
  let inspectorBody = $('#inspector-body');

  // ---------- Loading ----------
  ImgUtils.attachDropzone({ dropzone, input: fileInput, onFiles: files => loadFile(files[0]) });

  async function loadFile(file) {
    ImgUtils.setStatus('Loading…');
    try {
      if (/\.psd$/i.test(file.name) || file.type === 'image/vnd.adobe.photoshop') { await loadPsd(file); return; }
      state.objects = []; state.selectedObjId = null;
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
      state.history = [{ blob: file, name: file.name, type: src.type, objects: [] }];
      state.histIndex = 0;
      state.initial = { blob: file, name: file.name, type: src.type, objects: [] };
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
      } else if (o.kind === 'image' && o.canvas) {
        cx.globalAlpha = o.alpha ?? 1;
        cx.drawImage(o.canvas, o.x || 0, o.y || 0, o.w || o.canvas.width, o.h || o.canvas.height);
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
  // Returns the flattened blob, or undefined if there was nothing to flatten.
  async function flattenObjects() {
    if (!state.objects.length) return;
    const c = compositeCanvas();
    const blob = await new Promise(r => c.toBlob(r, state.src.type || 'image/png', 0.95));
    state.objects = []; state.selectedObjId = null;
    await setImageFromBlob(blob, state.src.name);
    return blob;
  }

  // map a pointer event to image-space coords
  function toImagePoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (state.src.width / r.width), y: (e.clientY - r.top) * (state.src.height / r.height) };
  }

  // ---------- History ----------
  // Each entry snapshots the base image AND the overlay objects, so undo/redo
  // covers draw strokes, shapes and layer edits — not just image operations.
  const cloneObjs = list => (list || state.objects).map(o => ({ ...o }));

  function pushEntry(entry) {
    if (state.histIndex < state.history.length - 1) state.history = state.history.slice(0, state.histIndex + 1);
    state.history.push(entry);
    if (state.history.length > 30) state.history.shift();
    state.histIndex = state.history.length - 1;
    updateHistoryButtons();
  }
  function pushHistory(blob, name) {
    pushEntry({ blob, name, type: blob.type, objects: cloneObjs() });
  }
  // Snapshot an overlay-only change (stroke added/erased, shape, layer edit).
  function pushObjects() {
    const cur = state.history[state.histIndex];
    if (!cur) return;
    pushEntry({ blob: cur.blob, name: cur.name, type: cur.type, objects: cloneObjs() });
  }
  async function restoreHistory(i) {
    const h = state.history[i];
    state.histIndex = i;
    state.objects = cloneObjs(h.objects);
    state.selectedObjId = null;
    await setImageFromBlob(h.blob, h.name);
    updateHistoryButtons();
    if (state.currentTool === 'layers') renderLayers();
  }
  function updateHistoryButtons() {
    if (undoBtn) undoBtn.disabled = state.histIndex <= 0;
    if (redoBtn) redoBtn.disabled = state.histIndex >= state.history.length - 1;
  }
  undoBtn.onclick = () => { if (state.histIndex > 0) restoreHistory(state.histIndex - 1); };
  redoBtn.onclick = () => { if (state.histIndex < state.history.length - 1) restoreHistory(state.histIndex + 1); };
  resetBtn.onclick = async () => {
    const init = state.initial;
    if (!init) return;
    state.objects = cloneObjs(init.objects);
    state.selectedObjId = null;
    await setImageFromBlob(init.blob, init.name);
    state.history = [{ blob: init.blob, name: init.name, type: init.type, objects: cloneObjs(init.objects) }];
    state.histIndex = 0;
    updateHistoryButtons();
    if (state.currentTool === 'layers') renderLayers();
    ImgUtils.setStatus('Reverted to original.', 'success');
  };

  document.addEventListener('keydown', e => {
    if (!state.src) return;
    const a = document.activeElement;
    const t = a && a.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (a && a.isContentEditable)) return;
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
      if (tool === 'newcanvas') { showNewCanvas(); return; }
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
    cropOverlay.style.cursor = 'crosshair';
    state.cropRect = null;
    renderViewer(); // reset any live preview
    showInspector(tool);
  }

  function downloadCurrent() {
    if (!state.src) return;
    compositeCanvas().toBlob(b => ImgUtils.download(b, state.baseName + '.' + ImageEngine.extFor(state.src.type)), state.src.type, 0.95);
  }
  $('#download-btn').onclick = downloadCurrent;

  // ---------- New design (blank canvas + background) ----------
  const BG_GRADIENTS = {
    Sunset: ['#ff7a59', '#ff5e62', '#ffd29b'],
    Crimson: ['#e82127', '#7a0d10'],
    Ocean: ['#0072ff', '#00c6ff'],
    Mint: ['#34c759', '#30b0c7'],
    Charcoal: ['#171a20', '#3a3d44'],
    Grape: ['#5b2a52', '#241430']
  };

  function showNewCanvas() {
    state.currentTool = 'newcanvas';
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'newcanvas'));
    freshInspector();
    inspectorTitle.textContent = 'New design';
    inspectorHint.textContent = 'Pick a size and background, then add text, shapes and images.';
    const presetOpts = ImageEngine.SIZE_PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
    const gradOpts = Object.keys(BG_GRADIENTS).map(k => `<option value="${k}">${k}</option>`).join('');
    inspectorBody.innerHTML = `
      <div class="field"><label>Size</label><select id="nc-preset">${presetOpts}<option value="custom">Custom…</option></select></div>
      <div class="field-row" id="nc-custom" style="display:none;">
        <div class="field"><label>Width</label><input type="number" id="nc-w" value="1080" min="1" /></div>
        <div class="field"><label>Height</label><input type="number" id="nc-h" value="1080" min="1" /></div>
      </div>
      <div class="field"><label>Background</label><select id="nc-bgtype"><option value="solid">Solid colour</option><option value="gradient">Gradient</option></select></div>
      <div class="field" id="nc-solid"><label>Colour</label><input type="color" id="nc-color" value="#171a20" /></div>
      <div class="field" id="nc-grad" style="display:none;"><label>Gradient</label><select id="nc-gradname">${gradOpts}</select></div>
      <button class="btn btn-primary btn-block" id="nc-go" type="button">Create design</button>
    `;
    const preset = $('#nc-preset'), bgtype = $('#nc-bgtype');
    preset.onchange = () => { $('#nc-custom').style.display = preset.value === 'custom' ? 'flex' : 'none'; };
    bgtype.onchange = () => { $('#nc-solid').style.display = bgtype.value === 'solid' ? 'block' : 'none'; $('#nc-grad').style.display = bgtype.value === 'gradient' ? 'block' : 'none'; };
    $('#nc-go').onclick = () => {
      let w, h;
      if (preset.value === 'custom') { w = Number($('#nc-w').value) || 1080; h = Number($('#nc-h').value) || 1080; }
      else { const p = ImageEngine.SIZE_PRESETS[Number(preset.value)]; w = p.w; h = p.h; }
      const bg = bgtype.value === 'gradient' ? { type: 'gradient', name: $('#nc-gradname').value } : { type: 'solid', color: $('#nc-color').value };
      createCanvas(w, h, bg);
    };
  }

  async function createCanvas(w, h, bg) {
    ImgUtils.setStatus('Creating…');
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    if (bg.type === 'gradient') {
      const stops = BG_GRADIENTS[bg.name] || ['#171a20', '#3a3d44'];
      const g = cx.createLinearGradient(0, 0, w, h);
      stops.forEach((c, i) => g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, c));
      cx.fillStyle = g;
    } else cx.fillStyle = bg.color || '#ffffff';
    cx.fillRect(0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    await loadFile(new File([blob], 'design.png', { type: 'image/png' }));
    setTool('text');
  }

  // ---------- Open PSD (flatten + import layers) ----------
  async function loadPsd(file) {
    if (!window.agPsd) { ImgUtils.setStatus('PSD support is still loading — try again in a second.', 'error'); return; }
    ImgUtils.setStatus('Reading PSD…');
    try {
      const buf = await file.arrayBuffer();
      const psd = window.agPsd.readPsd(buf, { useImageData: false, skipThumbnail: true });
      const W = psd.width, H = psd.height;
      state.baseName = ImgUtils.stripExt(file.name) || 'design';
      state.original = file;
      state.objects = []; state.selectedObjId = null;

      // collect leaf raster layers (groups flattened into their children)
      const layers = [];
      (function walk(nodes) { for (const n of (nodes || [])) { if (n.children) walk(n.children); else if (n.canvas) layers.push(n); } })(psd.children);

      const CAP = 24;
      let baseBlob, msg;
      if (layers.length > 1 && layers.length <= CAP) {
        const base = document.createElement('canvas'); base.width = W; base.height = H; // transparent base
        baseBlob = await new Promise(r => base.toBlob(r, 'image/png'));
        for (const ly of layers) {
          state.objects.push({
            id: uid(), kind: 'image', canvas: ly.canvas,
            x: ly.left || 0, y: ly.top || 0,
            w: ly.canvas.width, h: ly.canvas.height,
            name: ly.name || 'Layer', visible: ly.hidden !== true
          });
        }
        msg = `Opened PSD — ${layers.length} layers imported.`;
      } else {
        const comp = psd.canvas || document.createElement('canvas');
        if (!psd.canvas) { comp.width = W; comp.height = H; }
        baseBlob = await new Promise(r => comp.toBlob(r, 'image/png'));
        msg = 'Opened PSD (flattened).';
      }
      state.src = await ImageEngine.loadImage(new File([baseBlob], state.baseName + '.png', { type: 'image/png' }));

      emptyEl.style.display = 'none';
      stage.style.display = 'block';
      toolbar.style.display = 'flex';
      actionBar.style.display = 'flex';
      document.querySelectorAll('.tool-btn').forEach(b => b.disabled = false);
      renderViewer();
      state.history = [{ blob: baseBlob, name: state.baseName + '.png', type: 'image/png', objects: cloneObjs() }];
      state.histIndex = 0;
      state.initial = { blob: baseBlob, name: state.baseName + '.png', type: 'image/png', objects: cloneObjs() };
      updateHistoryButtons();
      setTool(state.objects.length ? 'layers' : 'compress');
      ImgUtils.setStatus(msg, 'success');
    } catch (e) {
      console.error(e);
      ImgUtils.setStatus('Could not read this PSD file.', 'error');
    }
  }

  // ---------- Inspector ----------
  // Swap in a fresh node so listeners from the previous tool's panel
  // (live previews etc.) don't fire against elements that no longer exist.
  function freshInspector() {
    const fresh = inspectorBody.cloneNode(false);
    inspectorBody.parentNode.replaceChild(fresh, inspectorBody);
    inspectorBody = fresh;
  }

  function showInspector(tool) {
    freshInspector();
    inspectorBody.innerHTML = '';
    if (tool === 'text') return inspText();
    if (tool === 'draw') return inspDraw();
    if (tool === 'shapes') return inspShapes();
    if (tool === 'insert') return inspInsert();
    if (tool === 'frame') return inspFrame();
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
    inspectorHint.textContent = 'Drag on the image to draw. Switch to the eraser to remove strokes it touches.';
    inspectorBody.innerHTML = `
      <div class="field"><label>Mode</label><div class="seg" id="d-mode">
        <button type="button" data-mode="brush" class="active">✏️ Brush</button>
        <button type="button" data-mode="erase">🧽 Eraser</button>
      </div></div>
      <div class="field-row">
        <div class="field"><label>Colour</label><input type="color" id="d-color" value="#ff3b30" /></div>
        <div class="field"><label>Size <span class="range-val" id="d-w-v">8px</span></label><input type="range" id="d-w" min="1" max="60" value="8" /></div>
      </div>
      <div class="field-row" style="margin-top:6px;">
        <button class="btn btn-ghost" id="d-undo" type="button">Undo stroke</button>
        <button class="btn btn-ghost" id="d-clear" type="button">Clear all</button>
      </div>
      <p class="meta-line">The Layers panel can also hide or delete individual strokes.</p>
    `;
    let mode = 'brush';
    $('#d-mode').querySelectorAll('button').forEach(b => b.onclick = () => {
      mode = b.dataset.mode;
      $('#d-mode').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      cropOverlay.style.cursor = mode === 'erase' ? 'cell' : 'crosshair';
    });
    $('#d-w').oninput = () => $('#d-w-v').textContent = $('#d-w').value + 'px';
    $('#d-undo').onclick = () => {
      for (let i = state.objects.length - 1; i >= 0; i--) {
        if (state.objects[i].kind === 'draw') { state.objects.splice(i, 1); pushObjects(); renderViewer(); return; }
      }
    };
    $('#d-clear').onclick = () => {
      const before = state.objects.length;
      state.objects = state.objects.filter(o => o.kind !== 'draw');
      if (state.objects.length !== before) { pushObjects(); renderViewer(); }
    };
    cropOverlay.style.display = 'block'; cropOverlay.innerHTML = '';
    cropOverlay.style.cursor = 'crosshair';

    // Object eraser: removes whole strokes the pointer passes over.
    function eraseFrom(e) {
      let removed = 0;
      const tryErase = ev => {
        const p = toImagePoint(ev);
        const k = state.src.width / canvas.getBoundingClientRect().width;
        const reach = Math.max(12, Number($('#d-w').value)) * k;
        for (let i = state.objects.length - 1; i >= 0; i--) {
          const o = state.objects[i];
          if (o.kind !== 'draw' || o.visible === false) continue;
          const limit = reach + (o.width || 4) / 2;
          const hit = o.points.some(q => {
            const dx = q[0] - p.x, dy = q[1] - p.y;
            return dx * dx + dy * dy <= limit * limit;
          });
          if (hit) { state.objects.splice(i, 1); removed++; }
        }
        if (removed) renderViewer();
      };
      tryErase(e);
      const move = ev => tryErase(ev);
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (removed) pushObjects();
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }

    cropOverlay.onpointerdown = e => {
      if (mode === 'erase') { eraseFrom(e); return; }
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
        if (pts.length) { state.objects.push({ id: uid(), kind: 'draw', color, width, points: pts, visible: true }); pushObjects(); renderViewer(); }
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
        if (Math.abs(o.ex - o.sx) > 2 || Math.abs(o.ey - o.sy) > 2) { state.objects.push(o); pushObjects(); renderViewer(); }
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
          <span class="lr-name">${o.kind === 'draw' ? 'Brush stroke' : o.kind === 'image' ? (o.name || 'Image layer') : (o.shape.charAt(0).toUpperCase() + o.shape.slice(1))}</span>
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
      row.querySelector('.lr-vis').onclick = () => { const o = state.objects[idx()]; o.visible = o.visible === false; pushObjects(); renderViewer(); renderLayers(); };
      row.querySelector('.lr-up').onclick = () => { const i = idx(); if (i < state.objects.length - 1) { [state.objects[i], state.objects[i + 1]] = [state.objects[i + 1], state.objects[i]]; pushObjects(); renderViewer(); renderLayers(); } };
      row.querySelector('.lr-down').onclick = () => { const i = idx(); if (i > 0) { [state.objects[i], state.objects[i - 1]] = [state.objects[i - 1], state.objects[i]]; pushObjects(); renderViewer(); renderLayers(); } };
      row.querySelector('.lr-del').onclick = () => { state.objects.splice(idx(), 1); pushObjects(); renderViewer(); renderLayers(); };
    });
    const fl = $('#lr-flatten');
    if (fl) fl.onclick = () => flattenObjects().then(blob => {
      if (blob) pushHistory(blob, state.src.name);
      renderViewer(); renderLayers(); ImgUtils.setStatus('Flattened into image.', 'success');
    });
  }

  function inspFilters() {
    inspectorTitle.textContent = 'Adjust & filters';
    inspectorHint.textContent = 'Pick a one-click look or fine-tune with sliders. Preview updates live.';
    const presetBtns = ImageEngine.FILTER_PRESETS
      .map((p, i) => `<button type="button" data-preset="${i}" ${i === 0 ? 'class="active"' : ''}>${p.name}</button>`).join('');
    inspectorBody.innerHTML = `
      <div class="field"><label>Looks</label><div class="seg" id="f-presets">${presetBtns}</div></div>
      <div class="field"><label>Brightness <span class="range-val" id="f-br-v">100%</span></label><input type="range" id="f-br" min="0" max="200" value="100" /></div>
      <div class="field"><label>Contrast <span class="range-val" id="f-co-v">100%</span></label><input type="range" id="f-co" min="0" max="200" value="100" /></div>
      <div class="field"><label>Saturation <span class="range-val" id="f-sa-v">100%</span></label><input type="range" id="f-sa" min="0" max="200" value="100" /></div>
      <div class="field"><label>Temperature <span class="range-val" id="f-te-v">0</span></label><input type="range" id="f-te" min="-100" max="100" value="0" /></div>
      <div class="field"><label>Hue <span class="range-val" id="f-hu-v">0°</span></label><input type="range" id="f-hu" min="-180" max="180" value="0" /></div>
      <div class="field"><label>Blur <span class="range-val" id="f-bl-v">0px</span></label><input type="range" id="f-bl" min="0" max="20" value="0" /></div>
      <div class="field"><label>Vignette <span class="range-val" id="f-vg-v">0%</span></label><input type="range" id="f-vg" min="0" max="100" value="0" /></div>
      <div class="field"><label>Effects</label><div class="seg">
        <button type="button" id="f-gray">B&amp;W</button>
        <button type="button" id="f-sepia">Sepia</button>
        <button type="button" id="f-invert">Invert</button>
      </div></div>
      <div class="field-row" style="margin-top:6px;">
        <button class="btn btn-ghost" id="f-reset" type="button">Reset</button>
        <button class="btn btn-primary" id="f-go" type="button">Apply</button>
      </div>
    `;
    let gray = false, sepia = 0, invert = false;
    const setSlider = (id, value) => { $(id).value = value; };
    const opts = () => ({
      brightness: Number($('#f-br').value), contrast: Number($('#f-co').value), saturate: Number($('#f-sa').value),
      temperature: Number($('#f-te').value), hue: Number($('#f-hu').value),
      blur: Number($('#f-bl').value), vignette: Number($('#f-vg').value),
      grayscale: gray ? 100 : 0, sepia: sepia, invert: invert ? 100 : 0
    });
    let previewQueued = false;
    const preview = () => {
      if (previewQueued) return;
      previewQueued = true;
      requestAnimationFrame(() => {
        previewQueued = false;
        $('#f-br-v').textContent = $('#f-br').value + '%';
        $('#f-co-v').textContent = $('#f-co').value + '%';
        $('#f-sa-v').textContent = $('#f-sa').value + '%';
        $('#f-te-v').textContent = $('#f-te').value;
        $('#f-hu-v').textContent = $('#f-hu').value + '°';
        $('#f-bl-v').textContent = $('#f-bl').value + 'px';
        $('#f-vg-v').textContent = $('#f-vg').value + '%';
        const o = opts();
        ctx.save(); ctx.filter = ImageEngine.filterString(o);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(state.src.img, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        ImageEngine.applyPixelAdjust(ctx, canvas.width, canvas.height, o);
        drawObjects(ctx);
      });
    };
    const resetSliders = () => {
      setSlider('#f-br', 100); setSlider('#f-co', 100); setSlider('#f-sa', 100);
      setSlider('#f-te', 0); setSlider('#f-hu', 0); setSlider('#f-bl', 0); setSlider('#f-vg', 0);
      gray = false; sepia = 0; invert = false;
      ['#f-gray', '#f-sepia', '#f-invert'].forEach(s => $(s).classList.remove('active'));
    };
    $('#f-presets').querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        $('#f-presets').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        resetSliders();
        const p = ImageEngine.FILTER_PRESETS[Number(btn.dataset.preset)].opts;
        if (p.brightness != null) setSlider('#f-br', p.brightness);
        if (p.contrast != null) setSlider('#f-co', p.contrast);
        if (p.saturate != null) setSlider('#f-sa', p.saturate);
        if (p.temperature != null) setSlider('#f-te', p.temperature);
        if (p.vignette != null) setSlider('#f-vg', p.vignette);
        if (p.grayscale) { gray = true; $('#f-gray').classList.add('active'); }
        if (p.sepia) sepia = p.sepia;
        preview();
      };
    });
    inspectorBody.addEventListener('input', preview);
    $('#f-gray').onclick = () => { gray = !gray; $('#f-gray').classList.toggle('active', gray); preview(); };
    $('#f-sepia').onclick = () => { sepia = sepia ? 0 : 100; $('#f-sepia').classList.toggle('active', !!sepia); preview(); };
    $('#f-invert').onclick = () => { invert = !invert; $('#f-invert').classList.toggle('active', invert); preview(); };
    $('#f-reset').onclick = () => { resetSliders(); $('#f-presets').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0)); preview(); };
    $('#f-go').onclick = () => applyOp(() => ImageEngine.adjust(state.src, { ...opts(), mime: state.src.type }), 'Applying…').then(() => setTool('filters'));
    preview();
  }

  // ---------- Insert image (overlay) ----------
  const insertInput = $('#insert-image-input');
  function inspInsert() {
    inspectorTitle.textContent = 'Insert image';
    inspectorHint.textContent = 'Add a logo or photo on top, then drag it into place on the image.';
    inspectorBody.innerHTML = `
      <button class="btn btn-primary btn-block" id="ins-pick" type="button">Choose image…</button>
      <div id="ins-controls" style="display:none; margin-top:14px;">
        <div class="field"><label>Scale <span class="range-val" id="ins-sc-v">100%</span></label><input type="range" id="ins-sc" min="5" max="300" value="100" /></div>
        <div class="field"><label>Opacity <span class="range-val" id="ins-op-v">100%</span></label><input type="range" id="ins-op" min="5" max="100" value="100" /></div>
        <p class="meta-line">Drag the inserted image on the canvas to position it. Manage or delete it in Layers.</p>
      </div>
    `;
    cropOverlay.style.display = 'block'; cropOverlay.innerHTML = '';
    cropOverlay.style.cursor = 'move';
    $('#ins-pick').onclick = () => insertInput.click();

    const selected = () => state.objects.find(o => o.id === state.selectedObjId && o.kind === 'image');
    const showControls = () => {
      const o = selected();
      $('#ins-controls').style.display = o ? 'block' : 'none';
      if (!o) return;
      const pct = Math.round((o.w / o.canvas.width) * 100);
      $('#ins-sc').value = Math.min(300, Math.max(5, pct));
      $('#ins-sc-v').textContent = pct + '%';
      $('#ins-op').value = Math.round((o.alpha ?? 1) * 100);
      $('#ins-op-v').textContent = Math.round((o.alpha ?? 1) * 100) + '%';
    };
    $('#ins-sc').oninput = () => {
      const o = selected(); if (!o) return;
      const pct = Number($('#ins-sc').value);
      const cx0 = o.x + o.w / 2, cy0 = o.y + o.h / 2;
      o.w = Math.max(8, Math.round(o.canvas.width * pct / 100));
      o.h = Math.max(8, Math.round(o.canvas.height * pct / 100));
      o.x = cx0 - o.w / 2; o.y = cy0 - o.h / 2;
      $('#ins-sc-v').textContent = pct + '%';
      renderViewer();
    };
    $('#ins-sc').onchange = () => { if (selected()) pushObjects(); };
    $('#ins-op').oninput = () => {
      const o = selected(); if (!o) return;
      o.alpha = Number($('#ins-op').value) / 100;
      $('#ins-op-v').textContent = $('#ins-op').value + '%';
      renderViewer();
    };
    $('#ins-op').onchange = () => { if (selected()) pushObjects(); };

    insertInput.onchange = async e => {
      const file = e.target.files && e.target.files[0];
      insertInput.value = '';
      if (!file) return;
      try {
        const loaded = await ImageEngine.loadImage(file);
        const c = document.createElement('canvas');
        c.width = loaded.width; c.height = loaded.height;
        c.getContext('2d').drawImage(loaded.img, 0, 0);
        const scale = Math.min(1, (state.src.width * 0.4) / loaded.width, (state.src.height * 0.4) / loaded.height);
        const w = Math.round(loaded.width * scale), h = Math.round(loaded.height * scale);
        const obj = {
          id: uid(), kind: 'image', canvas: c, alpha: 1,
          x: Math.round((state.src.width - w) / 2), y: Math.round((state.src.height - h) / 2),
          w, h, name: file.name, visible: true
        };
        state.objects.push(obj);
        state.selectedObjId = obj.id;
        pushObjects();
        renderViewer();
        showControls();
        ImgUtils.setStatus('Image inserted — drag to position.', 'success');
      } catch (err) { console.error(err); ImgUtils.setStatus('Could not open that image.', 'error'); }
    };

    cropOverlay.onpointerdown = e => {
      const p = toImagePoint(e);
      // pick the topmost image object under the pointer
      for (let i = state.objects.length - 1; i >= 0; i--) {
        const o = state.objects[i];
        if (o.kind !== 'image' || o.visible === false) continue;
        const w = o.w || o.canvas.width, h = o.h || o.canvas.height;
        if (p.x >= o.x && p.x <= o.x + w && p.y >= o.y && p.y <= o.y + h) {
          state.selectedObjId = o.id;
          showControls();
          const offX = p.x - o.x, offY = p.y - o.y;
          const move = ev => {
            const q = toImagePoint(ev);
            o.x = q.x - offX; o.y = q.y - offY;
            renderViewer();
          };
          const up = () => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
            pushObjects();
          };
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
          return;
        }
      }
    };
    showControls();
  }

  // ---------- Frame / border ----------
  function inspFrame() {
    inspectorTitle.textContent = 'Frame & border';
    inspectorHint.textContent = 'Add a coloured border, round the corners, or both.';
    const minDim = Math.min(state.src.width, state.src.height);
    const maxBorder = Math.round(minDim * 0.15);
    const maxRadius = Math.round(minDim * 0.3);
    const defBorder = Math.round(minDim * 0.04);
    inspectorBody.innerHTML = `
      <div class="field"><label>Border width <span class="range-val" id="fr-w-v">${defBorder}px</span></label>
        <input type="range" id="fr-w" min="0" max="${maxBorder}" value="${defBorder}" /></div>
      <div class="field"><label>Border colour</label><input type="color" id="fr-c" value="#ffffff" /></div>
      <div class="field"><label>Corner radius <span class="range-val" id="fr-r-v">0px</span></label>
        <input type="range" id="fr-r" min="0" max="${maxRadius}" value="0" /></div>
      <p class="meta-line">Rounded corners need PNG or WebP to stay transparent outside the frame.</p>
      <button class="btn btn-primary btn-block" id="fr-go" type="button" style="margin-top:12px;">Apply frame</button>
    `;
    const preview = () => {
      $('#fr-w-v').textContent = $('#fr-w').value + 'px';
      $('#fr-r-v').textContent = $('#fr-r').value + 'px';
      const bw = Number($('#fr-w').value), radius = Number($('#fr-r').value);
      renderViewer();
      // approximate preview at current canvas scale (border drawn inward)
      ctx.save();
      if (bw > 0) {
        ctx.strokeStyle = $('#fr-c').value;
        ctx.lineWidth = bw * 2;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    };
    inspectorBody.addEventListener('input', preview);
    preview();
    $('#fr-go').onclick = () => {
      const o = { width: Number($('#fr-w').value), color: $('#fr-c').value, radius: Number($('#fr-r').value) };
      const mime = o.radius > 0 && state.src.type === 'image/jpeg' ? 'image/png' : state.src.type;
      applyOp(() => ImageEngine.frame(state.src, { ...o, mime }), 'Framing…').then(() => setTool('frame'));
    };
  }

  function inspText() {
    inspectorTitle.textContent = 'Add text';
    inspectorHint.textContent = 'Click anywhere on the image and type directly. Drag the ✥ handle to move, then apply.';
    const fontOpts = ImageEngine.TEXT_FONTS.map((f, i) => `<option value='${f.css}' ${i === 0 ? 'selected' : ''}>${f.label}</option>`).join('');
    const maxSize = Math.max(120, Math.round(state.src.width * 0.4));
    const defSize = Math.max(12, Math.round(state.src.width * 0.08));
    inspectorBody.innerHTML = `
      <div class="field"><label>Text</label><textarea id="tx-text" rows="2">Your text</textarea></div>
      <div class="field"><label>Font</label><select id="tx-font">${fontOpts}</select></div>
      <div class="field"><label>Size <span class="range-val" id="tx-size-v">${defSize}px</span></label>
        <input type="range" id="tx-size" min="8" max="${maxSize}" value="${defSize}" /></div>
      <div class="field"><label>Colour</label><input type="color" id="tx-color" value="#ffffff" /></div>
      <div class="field"><label>Style</label><div class="seg"><button type="button" id="tx-bold" style="font-weight:700">Bold</button><button type="button" id="tx-italic" style="font-style:italic">Italic</button></div></div>
      <button class="btn btn-primary btn-block" id="tx-go" type="button" style="margin-top:12px;">Apply text</button>
    `;
    state.textPos = { x: Math.round(state.src.width * 0.1), y: Math.round(state.src.height * 0.42) };
    cropOverlay.style.display = 'block';
    cropOverlay.innerHTML = `
      <div id="tx-wrap">
        <span id="tx-grip" title="Drag to move">✥</span>
        <div id="tx-live" contenteditable="true" spellcheck="false"></div>
      </div>`;
    const wrap = $('#tx-wrap'), live = $('#tx-live'), grip = $('#tx-grip');
    const sideText = $('#tx-text'), fontSel = $('#tx-font'), sizeInput = $('#tx-size'), colorInput = $('#tx-color');
    let bold = false, italic = false;
    live.innerText = 'Your text';

    const currentText = () => live.innerText.replace(/\n$/, '');
    const opts = () => ({
      text: currentText(), font: fontSel.value, size: Number(sizeInput.value),
      color: colorInput.value, x: state.textPos.x, y: state.textPos.y, bold, italic
    });

    // Position + style the live editable box to match how the text will bake.
    function layout() {
      const r = canvas.getBoundingClientRect();
      const k = r.width / state.src.width;
      wrap.style.left = (state.textPos.x * k) + 'px';
      wrap.style.top = (state.textPos.y * (r.height / state.src.height)) + 'px';
      live.style.fontFamily = fontSel.value;
      live.style.fontSize = (Number(sizeInput.value) * k) + 'px';
      live.style.fontWeight = bold ? '700' : '400';
      live.style.fontStyle = italic ? 'italic' : 'normal';
      live.style.color = colorInput.value;
      $('#tx-size-v').textContent = sizeInput.value + 'px';
    }

    // Sidebar ↔ on-image box stay in sync.
    live.addEventListener('input', () => { sideText.value = currentText(); });
    sideText.addEventListener('input', () => { live.innerText = sideText.value; });
    ['input', 'change'].forEach(ev => inspectorBody.addEventListener(ev, layout));
    $('#tx-bold').onclick = () => { bold = !bold; $('#tx-bold').classList.toggle('active', bold); layout(); };
    $('#tx-italic').onclick = () => { italic = !italic; $('#tx-italic').classList.toggle('active', italic); layout(); };

    // Drag the grip to move; click empty image space to reposition and type there.
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = state.src.width / r.width, sy = state.src.height / r.height;
      const startX = e.clientX, startY = e.clientY;
      const orig = { ...state.textPos };
      const move = ev => {
        state.textPos = {
          x: Math.max(0, orig.x + (ev.clientX - startX) * sx),
          y: Math.max(0, orig.y + (ev.clientY - startY) * sy)
        };
        layout();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    cropOverlay.onpointerdown = e => {
      if (wrap.contains(e.target)) return; // typing or dragging inside the box
      const r = canvas.getBoundingClientRect();
      state.textPos = {
        x: Math.max(0, (e.clientX - r.left) * (state.src.width / r.width)),
        y: Math.max(0, (e.clientY - r.top) * (state.src.height / r.height))
      };
      layout();
      requestAnimationFrame(() => live.focus());
    };

    layout();
    requestAnimationFrame(() => { live.focus(); document.getSelection()?.selectAllChildren(live); });
    $('#tx-go').onclick = () => {
      if (!currentText().trim()) { ImgUtils.setStatus('Type some text first.', 'error'); return; }
      applyOp(() => ImageEngine.addText(state.src, { ...opts(), mime: state.src.type }), 'Adding text…').then(() => setTool('text'));
    };
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
    inspectorHint.textContent = 'Set a custom size or pick a preset (social, print, profile).';
    const s = state.src;
    const presetOpts = ImageEngine.SIZE_PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
    inspectorBody.innerHTML = `
      <div class="field"><label>Preset size</label>
        <select id="rpreset"><option value="">Custom</option>${presetOpts}</select></div>
      <div class="field-row">
        <div class="field"><label>Width (px)</label><input type="number" id="rw" value="${s.width}" min="1" /></div>
        <div class="field"><label>Height (px)</label><input type="number" id="rh" value="${s.height}" min="1" /></div>
      </div>
      <div class="field"><label>Fit</label>
        <select id="rmode"><option value="stretch">Stretch to size</option><option value="cover">Fill &amp; crop</option><option value="contain">Fit with padding</option></select></div>
      <label class="check"><input type="checkbox" id="rlock" checked /> Maintain aspect ratio (custom)</label>
      <button class="btn btn-primary btn-block" id="rgo" type="button" style="margin-top:12px;">Apply resize</button>
    `;
    const aspect = s.width / s.height;
    const rw = $('#rw'), rh = $('#rh'), lock = $('#rlock'), mode = $('#rmode'), preset = $('#rpreset');
    rw.oninput = () => { if (lock.checked) rh.value = Math.round(rw.value / aspect); preset.value = ''; };
    rh.oninput = () => { if (lock.checked) rw.value = Math.round(rh.value * aspect); preset.value = ''; };
    preset.onchange = () => {
      if (preset.value === '') return;
      const p = ImageEngine.SIZE_PRESETS[Number(preset.value)];
      rw.value = p.w; rh.value = p.h; lock.checked = false; mode.value = 'cover';
    };
    $('#rgo').onclick = () => applyOp(() => ImageEngine.resizeFit(state.src, { width: Number(rw.value), height: Number(rh.value), mode: mode.value, mime: state.src.type }), 'Resizing…');
  }

  function inspConvert() {
    inspectorTitle.textContent = 'Convert';
    inspectorHint.textContent = 'Open any image type, export to any format.';
    const formatOpts = ImageEngine.EXPORT_FORMATS
      .map(f => `<option value="${f.mime}">${f.label}</option>`).join('');
    inspectorBody.innerHTML = `
      <div class="field"><label>Convert to</label>
        <select id="cvf">${formatOpts}</select></div>
      <div class="field" id="cvq-wrap" style="display:none;"><label>Quality <span class="range-val" id="cvq-val">92%</span></label>
        <input type="range" id="cvq" min="10" max="100" value="92" /></div>
      <button class="btn btn-primary btn-block" id="cvgo" type="button">Convert</button>
      <p class="meta-line" id="cv-note"></p>
    `;
    const sel = $('#cvf');
    const formatFor = () => ImageEngine.EXPORT_FORMATS.find(f => f.mime === sel.value);
    const sync = () => {
      const f = formatFor();
      $('#cvq-wrap').style.display = f.lossy ? 'block' : 'none';
      $('#cv-note').textContent = f.chain
        ? ''
        : 'Browsers can’t re-open this format, so it downloads straight away.';
    };
    sel.onchange = sync;
    $('#cvq').oninput = () => $('#cvq-val').textContent = $('#cvq').value + '%';
    sync();
    $('#cvgo').onclick = async () => {
      const f = formatFor();
      const quality = Number($('#cvq').value) / 100;
      if (f.chain) {
        applyOp(() => ImageEngine.convert(state.src, { mime: f.mime, quality }), 'Converting…');
        return;
      }
      // Non-redecodable target (TIFF/PDF): bake overlays, then download directly.
      ImgUtils.setStatus('Converting…');
      try {
        await flattenObjects();
        const blob = await ImageEngine.convert(state.src, { mime: f.mime, quality });
        ImgUtils.download(blob, state.baseName + '.' + ImageEngine.extFor(f.mime));
        ImgUtils.setStatus('Downloaded as ' + ImageEngine.extFor(f.mime).toUpperCase() + '.', 'success');
      } catch (e) { console.error(e); ImgUtils.setStatus('Conversion failed.', 'error'); }
    };
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
      <div class="field"><label>Aspect ratio</label><div class="seg" id="crop-aspect">
        <button type="button" data-aspect="" class="active">Free</button>
        <button type="button" data-aspect="1">1:1</button>
        <button type="button" data-aspect="1.3333">4:3</button>
        <button type="button" data-aspect="1.5">3:2</button>
        <button type="button" data-aspect="1.7778">16:9</button>
      </div></div>
      <div class="meta-line" id="crop-meta">Drag a selection on the image.</div>
      <button class="btn btn-primary btn-block" id="crop-go" type="button" style="margin-top:12px;" disabled>Apply crop</button>
      <button class="btn btn-ghost btn-block" id="crop-clear" type="button" style="margin-top:8px;">Clear selection</button>
    `;
    let aspect = null;
    $('#crop-aspect').querySelectorAll('button').forEach(b => b.onclick = () => {
      aspect = b.dataset.aspect ? Number(b.dataset.aspect) : null;
      $('#crop-aspect').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    });
    cropOverlay.style.display = 'block';
    cropOverlay.innerHTML = '';
    state.cropRect = null;
    setupCropDrag(() => aspect);
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

  function setupCropDrag(getAspect) {
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
        let w = Math.abs(x - start.x), h = Math.abs(y - start.y);
        const aspect = getAspect ? getAspect() : null;
        if (aspect) {
          h = w / aspect;
          const maxH = y >= start.y ? r.height - start.y : start.y;
          if (h > maxH) { h = maxH; w = h * aspect; }
        }
        const left = x >= start.x ? start.x : start.x - w;
        const top = y >= start.y ? start.y : start.y - h;
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
