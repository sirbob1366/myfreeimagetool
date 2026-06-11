/* ===========================================================
   image-engine.js — Shared client-side image operations (Canvas API)
   All tool pages and the unified editor use these functions.
   pdf-lib (global PDFLib) is only needed for imageToPdf().
   =========================================================== */

(function () {
  'use strict';
  const Engine = {};

  // ---------- Load ----------
  // Returns { img, width, height, name, type, size }
  Engine.loadImage = function (file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ img, width: img.naturalWidth, height: img.naturalHeight, name: file.name, type: file.type || 'image/png', size: file.size, url });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
      img.src = url;
    });
  };

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // mime helpers
  Engine.mimeFor = function (format) {
    return format === 'jpg' || format === 'jpeg' ? 'image/jpeg'
      : format === 'webp' ? 'image/webp'
      : format === 'gif' ? 'image/gif'
      : format === 'bmp' ? 'image/bmp'
      : format === 'tiff' || format === 'tif' ? 'image/tiff'
      : format === 'ico' ? 'image/x-icon'
      : format === 'pdf' ? 'application/pdf'
      : 'image/png';
  };
  Engine.extFor = function (mime) {
    return mime === 'image/jpeg' ? 'jpg'
      : mime === 'image/webp' ? 'webp'
      : mime === 'image/gif' ? 'gif'
      : mime === 'image/bmp' ? 'bmp'
      : mime === 'image/tiff' ? 'tiff'
      : mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon' ? 'ico'
      : mime === 'application/pdf' ? 'pdf'
      : 'png';
  };

  // Every format the converter can write. `chain: false` means browsers can't
  // re-decode it, so the editor downloads it instead of continuing to edit.
  Engine.EXPORT_FORMATS = [
    { mime: 'image/png', label: 'PNG — lossless, transparency', lossy: false, chain: true },
    { mime: 'image/jpeg', label: 'JPG — small files, photos', lossy: true, chain: true },
    { mime: 'image/webp', label: 'WebP — modern, smallest', lossy: true, chain: true },
    { mime: 'image/gif', label: 'GIF — 256 colours, transparency', lossy: false, chain: true },
    { mime: 'image/bmp', label: 'BMP — uncompressed bitmap', lossy: false, chain: true },
    { mime: 'image/tiff', label: 'TIFF — print & archiving', lossy: false, chain: false },
    { mime: 'image/x-icon', label: 'ICO — favicon (max 256px)', lossy: false, chain: true },
    { mime: 'application/pdf', label: 'PDF — single-page document', lossy: false, chain: false }
  ];

  function toBlob(canvas, mime, quality) {
    // canvas.toBlob only writes PNG/JPEG/WebP; fall back to PNG for the rest
    // (e.g. resizing an image that was just converted to GIF or BMP).
    const safe = mime === 'image/jpeg' || mime === 'image/webp' ? mime : 'image/png';
    return new Promise(resolve => canvas.toBlob(b => resolve(b), safe, quality));
  }

  // Draw onto a white background for formats without alpha (JPEG).
  function drawImage(ctx, img, w, h, mime) {
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
  }

  // ---------- Compress ----------
  // opts: { quality 0..1, mime } — keeps original dimensions
  Engine.compress = async function (src, opts = {}) {
    const mime = opts.mime || (src.type === 'image/png' ? 'image/jpeg' : src.type) || 'image/jpeg';
    const quality = opts.quality ?? 0.7;
    const canvas = makeCanvas(src.width, src.height);
    const ctx = canvas.getContext('2d');
    drawImage(ctx, src.img, canvas.width, canvas.height, mime);
    return toBlob(canvas, mime, quality);
  };

  // ---------- Resize ----------
  // opts: { width, height, mime, quality }
  Engine.resize = async function (src, opts = {}) {
    const mime = opts.mime || src.type || 'image/png';
    const canvas = makeCanvas(opts.width || src.width, opts.height || src.height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    drawImage(ctx, src.img, canvas.width, canvas.height, mime);
    return toBlob(canvas, mime, opts.quality ?? 0.92);
  };

  // ---------- Resize to a target size (preset) ----------
  // opts: { width, height, mode: 'stretch'|'cover'|'contain', bg, mime, quality }
  Engine.resizeFit = async function (src, opts = {}) {
    const mime = opts.mime || src.type || 'image/png';
    const tw = Math.max(1, Math.round(opts.width)), th = Math.max(1, Math.round(opts.height));
    const mode = opts.mode || 'stretch';
    const canvas = makeCanvas(tw, th);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (mime === 'image/jpeg' || (mode === 'contain' && opts.bg !== 'transparent')) {
      ctx.fillStyle = opts.bg && opts.bg !== 'transparent' ? opts.bg : '#ffffff';
      ctx.fillRect(0, 0, tw, th);
    }
    if (mode === 'stretch') {
      ctx.drawImage(src.img, 0, 0, tw, th);
    } else {
      const s = mode === 'cover' ? Math.max(tw / src.width, th / src.height) : Math.min(tw / src.width, th / src.height);
      const dw = src.width * s, dh = src.height * s;
      ctx.drawImage(src.img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
    }
    return toBlob(canvas, mime, opts.quality ?? 0.92);
  };

  // Common social/print canvas presets (Canva-style).
  Engine.SIZE_PRESETS = [
    { label: 'Instagram Post — 1080×1080', w: 1080, h: 1080 },
    { label: 'Instagram Story — 1080×1920', w: 1080, h: 1920 },
    { label: 'Facebook Cover — 1640×624', w: 1640, h: 624 },
    { label: 'X / Twitter Header — 1500×500', w: 1500, h: 500 },
    { label: 'YouTube Thumbnail — 1280×720', w: 1280, h: 720 },
    { label: 'A4 Portrait — 1240×1754', w: 1240, h: 1754 },
    { label: 'Profile Picture — 400×400', w: 400, h: 400 }
  ];

  // ---------- Manual encoders (formats the browser can't write) ----------
  function srcImageData(src) {
    const canvas = makeCanvas(src.width, src.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src.img, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  // 24-bit BMP (alpha composited onto white; rows bottom-up, BGR, 4-byte padded).
  function encodeBMP(src) {
    const { data, width: w, height: h } = srcImageData(src);
    const rowSize = Math.ceil((w * 3) / 4) * 4;
    const pixelBytes = rowSize * h;
    const buf = new ArrayBuffer(54 + pixelBytes);
    const v = new DataView(buf);
    v.setUint8(0, 0x42); v.setUint8(1, 0x4d);            // "BM"
    v.setUint32(2, 54 + pixelBytes, true);               // file size
    v.setUint32(10, 54, true);                           // pixel data offset
    v.setUint32(14, 40, true);                           // BITMAPINFOHEADER
    v.setInt32(18, w, true); v.setInt32(22, h, true);
    v.setUint16(26, 1, true); v.setUint16(28, 24, true); // planes, bpp
    v.setUint32(34, pixelBytes, true);
    v.setInt32(38, 2835, true); v.setInt32(42, 2835, true); // 72 dpi
    const out = new Uint8Array(buf);
    for (let y = 0; y < h; y++) {
      let o = 54 + (h - 1 - y) * rowSize;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = data[i + 3] / 255;
        out[o++] = Math.round(data[i + 2] * a + 255 * (1 - a)); // B
        out[o++] = Math.round(data[i + 1] * a + 255 * (1 - a)); // G
        out[o++] = Math.round(data[i] * a + 255 * (1 - a));     // R
      }
    }
    return new Blob([buf], { type: 'image/bmp' });
  }

  // Uncompressed RGBA TIFF (little-endian, single strip).
  function encodeTIFF(src) {
    const { data, width: w, height: h } = srcImageData(src);
    const tags = 13;
    const ifdSize = 2 + tags * 12 + 4;
    const bpsOff = 8 + ifdSize;          // [8,8,8,8] shorts
    const xresOff = bpsOff + 8;
    const yresOff = xresOff + 8;
    const dataOff = yresOff + 8;
    const buf = new ArrayBuffer(dataOff + data.length);
    const v = new DataView(buf);
    v.setUint8(0, 0x49); v.setUint8(1, 0x49);  // "II" little-endian
    v.setUint16(2, 42, true);
    v.setUint32(4, 8, true);                   // IFD offset
    v.setUint16(8, tags, true);
    let o = 10;
    const tag = (id, type, count, value) => {
      v.setUint16(o, id, true); v.setUint16(o + 2, type, true);
      v.setUint32(o + 4, count, true); v.setUint32(o + 8, value, true);
      o += 12;
    };
    const shortTag = (id, value) => {
      v.setUint16(o, id, true); v.setUint16(o + 2, 3, true);
      v.setUint32(o + 4, 1, true); v.setUint16(o + 8, value, true);
      o += 12;
    };
    tag(256, 4, 1, w);            // ImageWidth
    tag(257, 4, 1, h);            // ImageLength
    tag(258, 3, 4, bpsOff);       // BitsPerSample -> offset
    shortTag(259, 1);             // Compression: none
    shortTag(262, 2);             // Photometric: RGB
    tag(273, 4, 1, dataOff);      // StripOffsets
    shortTag(277, 4);             // SamplesPerPixel
    tag(278, 4, 1, h);            // RowsPerStrip
    tag(279, 4, 1, data.length);  // StripByteCounts
    tag(282, 5, 1, xresOff);      // XResolution
    tag(283, 5, 1, yresOff);      // YResolution
    shortTag(296, 2);             // ResolutionUnit: inch
    shortTag(338, 2);             // ExtraSamples: unassociated alpha
    v.setUint32(o, 0, true);      // next IFD: none
    for (let i = 0; i < 4; i++) v.setUint16(bpsOff + i * 2, 8, true);
    v.setUint32(xresOff, 72, true); v.setUint32(xresOff + 4, 1, true);
    v.setUint32(yresOff, 72, true); v.setUint32(yresOff + 4, 1, true);
    new Uint8Array(buf, dataOff).set(data);
    return new Blob([buf], { type: 'image/tiff' });
  }

  // ICO containing a single PNG (Vista+ format), scaled to fit 256px.
  async function encodeICO(src) {
    const side = Math.min(256, Math.max(src.width, src.height, 16));
    const canvas = makeCanvas(side, side);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const s = Math.min(side / src.width, side / src.height);
    const dw = src.width * s, dh = src.height * s;
    ctx.drawImage(src.img, (side - dw) / 2, (side - dh) / 2, dw, dh);
    const png = await toBlob(canvas, 'image/png');
    const pngBytes = new Uint8Array(await png.arrayBuffer());
    const head = new ArrayBuffer(22);
    const v = new DataView(head);
    v.setUint16(0, 0, true); v.setUint16(2, 1, true); v.setUint16(4, 1, true);
    v.setUint8(6, side >= 256 ? 0 : side);  // width (0 = 256)
    v.setUint8(7, side >= 256 ? 0 : side);  // height
    v.setUint16(10, 1, true);               // planes
    v.setUint16(12, 32, true);              // bpp
    v.setUint32(14, pngBytes.length, true);
    v.setUint32(18, 22, true);              // data offset
    return new Blob([head, pngBytes], { type: 'image/x-icon' });
  }

  // Static GIF89a with LZW compression. Exact palette when the image has
  // <=255 unique colours, otherwise a uniform 6x7x6 colour cube.
  function encodeGIF(src) {
    const { data, width: w, height: h } = srcImageData(src);
    const npix = w * h;
    const indices = new Uint8Array(npix);
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 128) { hasAlpha = true; break; }
    }

    // -- Build palette (index 0 reserved for transparency when needed) --
    const base = hasAlpha ? 1 : 0;
    let palette = [];
    const exact = new Map();
    let overflow = false;
    for (let p = 0; p < npix; p++) {
      const i = p * 4;
      if (hasAlpha && data[i + 3] < 128) { indices[p] = 0; continue; }
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      let idx = exact.get(key);
      if (idx === undefined) {
        if (exact.size >= 255 - base) { overflow = true; break; }
        idx = base + exact.size;
        exact.set(key, idx);
      }
      indices[p] = idx;
    }
    if (!overflow) {
      palette = new Array(base + exact.size);
      exact.forEach((idx, key) => { palette[idx] = [(key >> 16) & 255, (key >> 8) & 255, key & 255]; });
    } else {
      // uniform 6x7x6 cube (252 colours)
      palette = new Array(base + 252);
      for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
        palette[base + r * 42 + g * 6 + b] = [Math.round(r * 51), Math.round(g * 42.5), Math.round(b * 51)];
      }
      for (let p = 0; p < npix; p++) {
        const i = p * 4;
        if (hasAlpha && data[i + 3] < 128) { indices[p] = 0; continue; }
        const r = Math.min(5, Math.round(data[i] / 51));
        const g = Math.min(6, Math.round(data[i + 1] / 42.5));
        const b = Math.min(5, Math.round(data[i + 2] / 51));
        indices[p] = base + r * 42 + g * 6 + b;
      }
    }
    if (hasAlpha) palette[0] = [0, 0, 0];

    let sizeExp = 0; // global colour table holds 2^(sizeExp+1) entries
    while ((2 << sizeExp) < palette.length) sizeExp++;
    const tableSize = 2 << sizeExp;
    const minCodeSize = Math.max(2, sizeExp + 1);

    const out = [];
    const push16 = n => { out.push(n & 255, (n >> 8) & 255); };
    // Header + logical screen descriptor
    for (const c of 'GIF89a') out.push(c.charCodeAt(0));
    push16(w); push16(h);
    out.push(0x80 | (0x07 << 4) | sizeExp, 0, 0);
    for (let i = 0; i < tableSize; i++) {
      const c = palette[i] || [0, 0, 0];
      out.push(c[0], c[1], c[2]);
    }
    if (hasAlpha) out.push(0x21, 0xf9, 0x04, 0x01, 0, 0, 0, 0); // GCE: transparent index 0
    out.push(0x2c); push16(0); push16(0); push16(w); push16(h); out.push(0);
    out.push(minCodeSize);

    // -- LZW (follows the omggif reference logic) --
    const bytes = [];
    let cur = 0, curBits = 0;
    let codeSize = minCodeSize + 1;
    const clear = 1 << minCodeSize, eoi = clear + 1;
    let next = eoi + 1;
    let table = new Map();
    const emit = code => {
      cur |= code << curBits; curBits += codeSize;
      while (curBits >= 8) { bytes.push(cur & 255); cur >>= 8; curBits -= 8; }
    };
    emit(clear);
    let prev = indices[0];
    for (let p = 1; p < npix; p++) {
      const k = indices[p];
      const key = (prev << 8) | k;
      const code = table.get(key);
      if (code !== undefined) { prev = code; continue; }
      emit(prev);
      if (next === 4096) {
        emit(clear);
        next = eoi + 1; codeSize = minCodeSize + 1; table = new Map();
      } else {
        if (next >= (1 << codeSize)) codeSize++;
        table.set(key, next++);
      }
      prev = k;
    }
    emit(prev);
    emit(eoi);
    if (curBits > 0) bytes.push(cur & 255);

    for (let i = 0; i < bytes.length; i += 255) {
      const chunk = bytes.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0, 0x3b);
    return new Blob([new Uint8Array(out)], { type: 'image/gif' });
  }

  // ---------- Convert ----------
  // opts: { mime, quality } — handles every EXPORT_FORMATS entry.
  Engine.convert = async function (src, opts = {}) {
    const mime = opts.mime || 'image/png';
    if (mime === 'image/bmp') return encodeBMP(src);
    if (mime === 'image/tiff') return encodeTIFF(src);
    if (mime === 'image/gif') return encodeGIF(src);
    if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') return encodeICO(src);
    if (mime === 'application/pdf') {
      const bytes = await Engine.imagesToPdf([src]);
      return new Blob([bytes], { type: 'application/pdf' });
    }
    const canvas = makeCanvas(src.width, src.height);
    const ctx = canvas.getContext('2d');
    drawImage(ctx, src.img, canvas.width, canvas.height, mime);
    return toBlob(canvas, mime, opts.quality ?? 0.92);
  };

  // ---------- Crop ----------
  // rect: { x, y, w, h } in source-image pixels
  Engine.crop = async function (src, rect, opts = {}) {
    const mime = opts.mime || src.type || 'image/png';
    const canvas = makeCanvas(rect.w, rect.h);
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(src.img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return toBlob(canvas, mime, opts.quality ?? 0.92);
  };

  // ---------- Rotate & flip ----------
  // opts: { deg (0/90/180/270), flipH, flipV, mime, quality }
  Engine.transform = async function (src, opts = {}) {
    const mime = opts.mime || src.type || 'image/png';
    const deg = ((opts.deg || 0) % 360 + 360) % 360;
    const swap = deg === 90 || deg === 270;
    const w = src.width, h = src.height;
    const canvas = makeCanvas(swap ? h : w, swap ? w : h);
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(deg * Math.PI / 180);
    ctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
    ctx.drawImage(src.img, -w / 2, -h / 2, w, h);
    ctx.restore();
    return toBlob(canvas, mime, opts.quality ?? 0.92);
  };

  // ---------- Watermark ----------
  // opts: { text, fontSize, opacity 0..1, color, position, mime, quality }
  // position: top-left|top-right|center|bottom-left|bottom-right
  Engine.watermark = async function (src, opts = {}) {
    const mime = opts.mime || src.type || 'image/png';
    const canvas = makeCanvas(src.width, src.height);
    const ctx = canvas.getContext('2d');
    drawImage(ctx, src.img, canvas.width, canvas.height, mime);
    const text = opts.text || 'Watermark';
    const size = opts.fontSize || Math.round(canvas.width * 0.06);
    ctx.font = `600 ${size}px -apple-system, Helvetica, Arial, sans-serif`;
    ctx.fillStyle = opts.color || '#ffffff';
    ctx.globalAlpha = opts.opacity ?? 0.5;
    ctx.textBaseline = 'middle';
    const m = ctx.measureText(text);
    const pad = Math.round(size * 0.6);
    let x = pad, y = pad + size / 2;
    const pos = opts.position || 'bottom-right';
    if (pos.includes('right')) x = canvas.width - m.width - pad;
    if (pos.includes('bottom')) y = canvas.height - pad - size / 2;
    if (pos === 'center') { x = (canvas.width - m.width) / 2; y = canvas.height / 2; }
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = Math.max(2, size * 0.06);
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    return toBlob(canvas, mime, opts.quality ?? 0.92);
  };

  // Web-safe fonts — rasterised into the image, so no embedding needed.
  Engine.TEXT_FONTS = [
    { label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    { label: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
    { label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
    { label: 'Georgia', css: 'Georgia, serif' },
    { label: 'Garamond', css: 'Garamond, "Times New Roman", serif' },
    { label: 'Palatino', css: '"Palatino Linotype", Palatino, serif' },
    { label: 'Courier New', css: '"Courier New", monospace' },
    { label: 'Lucida Console', css: '"Lucida Console", Monaco, monospace' },
    { label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
    { label: 'Tahoma', css: 'Tahoma, Geneva, sans-serif' },
    { label: 'Trebuchet MS', css: '"Trebuchet MS", Helvetica, sans-serif' },
    { label: 'Impact', css: 'Impact, Charcoal, sans-serif' },
    { label: 'Comic Sans MS', css: '"Comic Sans MS", "Comic Sans", cursive' },
    { label: 'Brush Script', css: '"Brush Script MT", "Segoe Script", cursive' }
  ];

  // ---------- Filters / adjustments ----------
  // opts: { brightness, contrast, saturate (percent, 100=normal),
  //         grayscale, sepia, invert (0..100), hue (deg), blur (px),
  //         temperature (-100..100), vignette (0..100), mime, quality }
  Engine.filterString = function (o = {}) {
    const f = [];
    if (o.brightness != null && o.brightness !== 100) f.push(`brightness(${o.brightness}%)`);
    if (o.contrast != null && o.contrast !== 100) f.push(`contrast(${o.contrast}%)`);
    if (o.saturate != null && o.saturate !== 100) f.push(`saturate(${o.saturate}%)`);
    if (o.grayscale) f.push(`grayscale(${o.grayscale}%)`);
    if (o.sepia) f.push(`sepia(${o.sepia}%)`);
    if (o.invert) f.push(`invert(${o.invert}%)`);
    if (o.hue) f.push(`hue-rotate(${o.hue}deg)`);
    if (o.blur) f.push(`blur(${o.blur}px)`);
    return f.join(' ') || 'none';
  };

  // Pixel-level passes that CSS filters can't express. Mutates the context.
  Engine.applyPixelAdjust = function (ctx, w, h, o = {}) {
    if (o.temperature) {
      const shift = o.temperature * 0.4;
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] + shift, b = d[i + 2] - shift;
        d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
      ctx.putImageData(imageData, 0, 0);
    }
    if (o.vignette) {
      const outer = Math.hypot(w, h) / 2;
      const g = ctx.createRadialGradient(w / 2, h / 2, outer * 0.4, w / 2, h / 2, outer);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${(o.vignette / 100) * 0.85})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  };

  Engine.adjust = async function (src, o = {}) {
    const mime = o.mime || src.type || 'image/png';
    const canvas = makeCanvas(src.width, src.height);
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.filter = Engine.filterString(o);
    ctx.drawImage(src.img, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    Engine.applyPixelAdjust(ctx, canvas.width, canvas.height, o);
    return toBlob(canvas, mime, o.quality ?? 0.95);
  };

  // Named one-click looks (Adobe Express-style presets).
  Engine.FILTER_PRESETS = [
    { name: 'None', opts: {} },
    { name: 'Vintage', opts: { brightness: 96, contrast: 108, saturate: 120, sepia: 45, vignette: 30 } },
    { name: 'Noir', opts: { grayscale: 100, contrast: 135, brightness: 92, vignette: 35 } },
    { name: 'Warm', opts: { temperature: 35, saturate: 125, brightness: 103 } },
    { name: 'Cool', opts: { temperature: -30, saturate: 115, brightness: 102 } },
    { name: 'Vivid', opts: { saturate: 160, contrast: 112 } },
    { name: 'Fade', opts: { contrast: 84, brightness: 110, saturate: 80 } }
  ];

  // ---------- Frame / border ----------
  // opts: { width (px), color, radius (px), mime, quality }
  Engine.frame = async function (src, o = {}) {
    const bw = Math.max(0, Math.round(o.width || 0));
    const radius = Math.max(0, Math.round(o.radius || 0));
    const mime = (radius > 0 || bw === 0) && (o.mime === 'image/jpeg') ? 'image/jpeg' : (o.mime || src.type || 'image/png');
    const W = src.width + bw * 2, H = src.height + bw * 2;
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
    if (bw > 0) {
      ctx.fillStyle = o.color || '#ffffff';
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, radius);
      ctx.fill();
    }
    ctx.save();
    const innerR = Math.max(0, radius - Math.round(bw * 0.6));
    if (radius > 0) {
      ctx.beginPath();
      ctx.roundRect(bw, bw, src.width, src.height, bw > 0 ? innerR : radius);
      ctx.clip();
    }
    ctx.drawImage(src.img, bw, bw, src.width, src.height);
    ctx.restore();
    return toBlob(canvas, mime, o.quality ?? 0.95);
  };

  // Average of the four corners — a good default background colour guess.
  Engine.cornerColor = function (src) {
    const c = makeCanvas(src.width, src.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src.img, 0, 0);
    const pts = [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1]];
    let r = 0, g = 0, b = 0;
    for (const [x, y] of pts) { const p = ctx.getImageData(x, y, 1, 1).data; r += p[0]; g += p[1]; b += p[2]; }
    return [Math.round(r / 4), Math.round(g / 4), Math.round(b / 4)];
  };

  // ---------- Add text ----------
  // opts: { text, x, y (top-left, image px), size, font(css stack), color, bold, italic, mime, quality }
  Engine.addText = async function (src, o = {}) {
    const mime = o.mime || src.type || 'image/png';
    const canvas = makeCanvas(src.width, src.height);
    const ctx = canvas.getContext('2d');
    drawImage(ctx, src.img, canvas.width, canvas.height, mime);
    const size = o.size || Math.round(src.width * 0.08);
    ctx.font = `${o.bold ? '700 ' : ''}${o.italic ? 'italic ' : ''}${size}px ${o.font || 'Arial, sans-serif'}`;
    ctx.fillStyle = o.color || '#ffffff';
    ctx.textBaseline = 'top';
    const lines = (o.text || '').split('\n');
    const lh = size * 1.25;
    lines.forEach((ln, i) => ctx.fillText(ln, o.x || 0, (o.y || 0) + i * lh));
    return toBlob(canvas, mime, o.quality ?? 0.95);
  };

  // ---------- Blur background (center focus) ----------
  // opts: { blur (px), focus (0..1 of min dimension as clear radius), mime, quality }
  Engine.blurBackground = async function (src, opts = {}) {
    const mime = opts.mime || src.type || 'image/png';
    const w = src.width, h = src.height;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');

    // 1) blurred base
    ctx.filter = `blur(${opts.blur ?? 12}px)`;
    drawImage(ctx, src.img, w, h, mime);
    ctx.filter = 'none';

    // 2) sharp center, feathered with a radial mask
    const sharp = makeCanvas(w, h);
    const sctx = sharp.getContext('2d');
    sctx.drawImage(src.img, 0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const min = Math.min(w, h);
    const clear = (opts.focus ?? 0.42) * min;
    const grad = sctx.createRadialGradient(cx, cy, clear * 0.6, cx, cy, clear);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.globalCompositeOperation = 'destination-in';
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(sharp, 0, 0);
    return toBlob(canvas, mime, opts.quality ?? 0.92);
  };

  // ---------- Images to PDF ----------
  // sources: [{ img, width, height }]. opts: { fit: 'page' (A4-ish auto) }
  Engine.imagesToPdf = async function (sources) {
    const doc = await PDFLib.PDFDocument.create();
    for (const s of sources) {
      // Re-encode each image to PNG bytes for embedding (robust for any source type)
      const canvas = makeCanvas(s.width, s.height);
      canvas.getContext('2d').drawImage(s.img, 0, 0, s.width, s.height);
      const blob = await toBlob(canvas, 'image/png');
      const bytes = await blob.arrayBuffer();
      const png = await doc.embedPng(bytes);
      const page = doc.addPage([s.width, s.height]);
      page.drawImage(png, { x: 0, y: 0, width: s.width, height: s.height });
    }
    return doc.save();
  };

  window.ImageEngine = Engine;
})();
