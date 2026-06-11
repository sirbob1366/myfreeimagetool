/* tool-ui.js — shared UI machinery for tool pages.
   Page-wide drag & drop, technical readout card, determinate progress,
   success checkmark, zip downloads, lazy vendor loading.
   Depends on app.js (ImgUtils). Heavy vendors load only on first use. */
(function () {
  'use strict';
  const UI = {};
  const loaded = {};

  // ---------- Lazy loaders ----------
  UI.lazyScript = function (src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => { delete loaded[src]; reject(new Error('Failed to load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  };
  UI.lazyModule = function (src) {
    if (!loaded[src]) {
      loaded[src] = import(src).catch(e => { delete loaded[src]; throw e; });
    }
    return loaded[src];
  };
  // Fetch with byte progress — for big wasm/model files ("Loading AI model…").
  UI.fetchWithProgress = async function (url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch ' + url);
    const total = Number(res.headers.get('Content-Length')) || 0;
    if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(received / total, received, total);
    }
    const out = new Uint8Array(received);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  };

  // ---------- Page-wide drag & drop ----------
  // Files dropped anywhere on the page reach the tool, with a full-page glow.
  UI.pageDrop = function (onFiles, accept = 'image/') {
    let depth = 0;
    let veil = null;
    function showVeil() {
      if (veil) return;
      veil = document.createElement('div');
      veil.className = 'drop-veil';
      veil.innerHTML = '<div class="drop-veil-inner">Drop to open</div>';
      document.body.appendChild(veil);
    }
    function hideVeil() { if (veil) { veil.remove(); veil = null; } }
    document.addEventListener('dragenter', e => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth++;
      showVeil();
    });
    document.addEventListener('dragover', e => { e.preventDefault(); });
    document.addEventListener('dragleave', e => {
      e.preventDefault();
      if (--depth <= 0) { depth = 0; hideVeil(); }
    });
    document.addEventListener('drop', e => {
      e.preventDefault();
      depth = 0;
      hideVeil();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      const arr = Array.from(files).filter(f => accept === '*' || f.type.startsWith(accept) || /\.(heic|heif|svg|gif|avif)$/i.test(f.name));
      if (arr.length) onFiles(arr);
    });
  };

  // ---------- Technical readout card ----------
  // Dimensions · megapixels · format · file size · colour · EXIF indicator.
  UI.readout = async function (container, src, file) {
    container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'readout';
    const mp = (src.width * src.height / 1e6);
    const fmt = (src.type || file && file.type || 'image').split('/').pop().toUpperCase();
    const cells = [
      ['Dimensions', src.width.toLocaleString() + ' × ' + src.height.toLocaleString()],
      ['Resolution', (mp >= 10 ? mp.toFixed(0) : mp.toFixed(1)) + ' MP'],
      ['Format', fmt],
      ['File size', ImgUtils.formatBytes(src.size != null ? src.size : (file && file.size))],
      ['Colour', null],   // filled async
      ['Metadata', null]  // filled async
    ];
    card.innerHTML = cells.map(c =>
      '<div class="readout-cell"><span class="readout-k">' + c[0] + '</span><span class="readout-v" data-k="' + c[0] + '">' + (c[1] || '…') + '</span></div>'
    ).join('');
    container.appendChild(card);

    // Colour depth / alpha (sampled on a small copy — cheap).
    try {
      const probe = document.createElement('canvas');
      const s = Math.min(1, 64 / Math.max(src.width, src.height));
      probe.width = Math.max(1, Math.round(src.width * s));
      probe.height = Math.max(1, Math.round(src.height * s));
      const pctx = probe.getContext('2d', { willReadFrequently: true });
      pctx.drawImage(src.img || src, 0, 0, probe.width, probe.height);
      const d = pctx.getImageData(0, 0, probe.width, probe.height).data;
      let alpha = false;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; }
      card.querySelector('[data-k="Colour"]').textContent = alpha ? '8-bit RGBA' : '8-bit RGB';
    } catch (e) {
      card.querySelector('[data-k="Colour"]').textContent = '8-bit';
    }

    // EXIF presence (lazy parser, JPEG/PNG only).
    const exifEl = card.querySelector('[data-k="Metadata"]');
    const type = (file && file.type) || src.type || '';
    if (file && (type === 'image/jpeg' || type === 'image/png')) {
      try {
        await UI.lazyScript('/js/exif.js');
        const info = window.ExifTool.parse(await file.arrayBuffer());
        if (info.present) {
          exifEl.textContent = 'EXIF present' + (info.gps ? ' · GPS' : '');
          exifEl.classList.add('readout-warn');
        } else {
          exifEl.textContent = 'No EXIF';
        }
      } catch (e) { exifEl.textContent = '—'; }
    } else {
      exifEl.textContent = '—';
    }
    return card;
  };

  // ---------- Determinate progress ----------
  UI.progress = function (container, label) {
    const wrap = document.createElement('div');
    wrap.className = 'prog';
    wrap.innerHTML = '<div class="prog-top"><span class="prog-label"></span><span class="prog-pct"></span></div>' +
      '<div class="prog-track"><div class="prog-fill" style="width:0%"></div></div>';
    container.appendChild(wrap);
    const labelEl = wrap.querySelector('.prog-label');
    const pctEl = wrap.querySelector('.prog-pct');
    const fill = wrap.querySelector('.prog-fill');
    if (label) labelEl.textContent = label;
    return {
      el: wrap,
      set(frac, text) {
        const pct = Math.min(100, Math.max(0, Math.round(frac * 100)));
        fill.style.width = pct + '%';
        pctEl.textContent = pct + '%';
        if (text) labelEl.textContent = text;
      },
      done(text) {
        fill.style.width = '100%';
        pctEl.textContent = '';
        if (text) labelEl.textContent = text;
        wrap.classList.add('prog-done');
      },
      fail(text) {
        wrap.classList.add('prog-fail');
        if (text) labelEl.textContent = text;
      },
      remove() { wrap.remove(); }
    };
  };

  // ---------- Success checkmark (draw-on) ----------
  UI.checkmark = function (container) {
    const span = document.createElement('span');
    span.className = 'tick';
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path class="tick-path" d="M4.5 12.5l5 5 10-11"/></svg>';
    container.appendChild(span);
    setTimeout(() => span.classList.add('tick-out'), 1600);
    setTimeout(() => span.remove(), 2000);
    return span;
  };

  // ---------- Zip download (self-hosted JSZip, lazy) ----------
  UI.zip = async function (files, zipName, onProgress) {
    await UI.lazyScript('/vendor/jszip/jszip.min.js');
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.blob);
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      meta => onProgress && onProgress(meta.percent / 100)
    );
    ImgUtils.download(blob, zipName);
    return blob;
  };

  // ---------- Preview helpers ----------
  // Downscaled copy for live previews — keeps slider feedback instant.
  UI.downscale = function (source, maxDim = 1400) {
    const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    const s = Math.min(1, maxDim / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c;
  };
  UI.toCanvas = function (src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src.img || src, 0, 0);
    return c;
  };

  // De-dupe output names in a batch ("a.png", "a (2).png", …).
  UI.uniqueNames = function () {
    const seen = new Map();
    return name => {
      const n = (seen.get(name) || 0) + 1;
      seen.set(name, n);
      if (n === 1) return name;
      const dot = name.lastIndexOf('.');
      return dot > 0 ? name.slice(0, dot) + ' (' + n + ')' + name.slice(dot) : name + ' (' + n + ')';
    };
  };

  window.ToolUI = UI;
})();
