/* avif-enc.js — AVIF encoding with the best available path.
   1. Native canvas.toBlob('image/avif') where the browser supports it
      (rare as of 2026 — most browsers decode AVIF but don't encode).
   2. Self-hosted libavif WASM (from @jsquash/avif's codec build, Apache-2.0)
      loaded lazily from /vendor/jsquash/.

   window.AvifEnc.encode(canvas, quality 0..100) -> Promise<Blob>
   window.AvifEnc.available() -> Promise<'native'|'wasm'>
*/
(function () {
  'use strict';
  let nativeChecked = null;
  let wasmModule = null;

  // Defaults mirrored from @jsquash/avif meta.js — the wasm encoder
  // expects every field to be present.
  const DEFAULTS = {
    quality: 50, qualityAlpha: -1, denoiseLevel: 0,
    tileColsLog2: 0, tileRowsLog2: 0, speed: 6, subsample: 1,
    chromaDeltaQ: false, sharpness: 0, tune: 0,
    enableSharpYUV: false, bitDepth: 8, lossless: false
  };

  function checkNative() {
    if (!nativeChecked) {
      nativeChecked = new Promise(resolve => {
        const c = document.createElement('canvas');
        c.width = c.height = 2;
        c.toBlob(b => resolve(!!b && b.type === 'image/avif'), 'image/avif', 0.8);
      });
    }
    return nativeChecked;
  }

  async function loadWasm() {
    if (!wasmModule) {
      wasmModule = import('/vendor/jsquash/avif_enc.js')
        .then(m => m.default({
          locateFile: file => '/vendor/jsquash/' + file
        }))
        .catch(e => { wasmModule = null; throw e; });
    }
    return wasmModule;
  }

  async function available() {
    if (await checkNative()) return 'native';
    await loadWasm();
    return 'wasm';
  }

  async function encode(canvas, quality) {
    if (await checkNative()) {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/avif', quality / 100));
      if (blob && blob.type === 'image/avif') return blob;
    }
    const mod = await loadWasm();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = mod.encode(new Uint8Array(id.data.buffer), canvas.width, canvas.height,
      { ...DEFAULTS, quality });
    if (!out) throw new Error('AVIF encoding failed');
    return new Blob([out.buffer || out], { type: 'image/avif' });
  }

  window.AvifEnc = { encode, available };
})();
