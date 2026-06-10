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
      : 'image/png';
  };
  Engine.extFor = function (mime) {
    return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  };

  function toBlob(canvas, mime, quality) {
    return new Promise(resolve => canvas.toBlob(b => resolve(b), mime, quality));
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

  // ---------- Convert ----------
  // opts: { mime, quality }
  Engine.convert = async function (src, opts = {}) {
    const mime = opts.mime || 'image/png';
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
  //         grayscale, sepia, invert (0..100), mime, quality }
  Engine.filterString = function (o = {}) {
    const f = [];
    if (o.brightness != null && o.brightness !== 100) f.push(`brightness(${o.brightness}%)`);
    if (o.contrast != null && o.contrast !== 100) f.push(`contrast(${o.contrast}%)`);
    if (o.saturate != null && o.saturate !== 100) f.push(`saturate(${o.saturate}%)`);
    if (o.grayscale) f.push(`grayscale(${o.grayscale}%)`);
    if (o.sepia) f.push(`sepia(${o.sepia}%)`);
    if (o.invert) f.push(`invert(${o.invert}%)`);
    return f.join(' ') || 'none';
  };
  Engine.adjust = async function (src, o = {}) {
    const mime = o.mime || src.type || 'image/png';
    const canvas = makeCanvas(src.width, src.height);
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.filter = Engine.filterString(o);
    ctx.drawImage(src.img, 0, 0, canvas.width, canvas.height);
    return toBlob(canvas, mime, o.quality ?? 0.95);
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
