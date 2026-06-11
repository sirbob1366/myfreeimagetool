/* compare-slider.js — draggable before/after comparison.
   Used by every tool that transforms an image. clip-path based so both
   layers stay pixel-aligned at any zoom. Pointer + keyboard accessible.

   const cmp = CompareSlider.create(container, { labels: ['Original', 'Result'] });
   cmp.setBefore(canvasOrImg); cmp.setAfter(canvasOrImg); cmp.destroy();
*/
(function () {
  'use strict';

  function asElement(src) {
    // Accept a canvas, an <img>, or a URL string.
    if (typeof src === 'string') {
      const img = new Image();
      img.src = src;
      return img;
    }
    return src;
  }

  function create(container, opts = {}) {
    const labels = opts.labels || ['Before', 'After'];
    const root = document.createElement('div');
    root.className = 'cmp';
    root.innerHTML =
      '<div class="cmp-stage">' +
      '  <div class="cmp-layer cmp-before"></div>' +
      '  <div class="cmp-layer cmp-after"></div>' +
      '  <div class="cmp-handle" role="slider" tabindex="0" aria-label="Comparison position"' +
      '       aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">' +
      '    <span class="cmp-grip" aria-hidden="true">' +
      '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l-3 3 3 3M16 9l3 3-3 3"/></svg>' +
      '    </span>' +
      '  </div>' +
      '  <span class="cmp-label cmp-label-l">' + labels[0] + '</span>' +
      '  <span class="cmp-label cmp-label-r">' + labels[1] + '</span>' +
      '</div>';
    container.appendChild(root);

    const stage = root.querySelector('.cmp-stage');
    const beforeWrap = root.querySelector('.cmp-before');
    const afterWrap = root.querySelector('.cmp-after');
    const handle = root.querySelector('.cmp-handle');
    let pos = 0.5;
    let raf = 0;

    function render() {
      raf = 0;
      const pct = (pos * 100).toFixed(2);
      afterWrap.style.clipPath = 'inset(0 0 0 ' + pct + '%)';
      handle.style.left = pct + '%';
      handle.setAttribute('aria-valuenow', Math.round(pos * 100));
    }
    function setPos(p) {
      pos = Math.min(1, Math.max(0, p));
      if (!raf) raf = requestAnimationFrame(render);
    }
    function posFromEvent(e) {
      const r = stage.getBoundingClientRect();
      setPos((e.clientX - r.left) / r.width);
    }

    function onPointerDown(e) {
      e.preventDefault();
      posFromEvent(e);
      const move = ev => posFromEvent(ev);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('pointerup', up);
    }
    stage.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { setPos(pos - 0.04); e.preventDefault(); }
      if (e.key === 'ArrowRight') { setPos(pos + 0.04); e.preventDefault(); }
      if (e.key === 'Home') { setPos(0); e.preventDefault(); }
      if (e.key === 'End') { setPos(1); e.preventDefault(); }
    });

    function fill(wrap, el) {
      wrap.innerHTML = '';
      if (el) wrap.appendChild(el);
      // Stage aspect follows the "before" layer's intrinsic size.
      const ref = beforeWrap.firstChild || afterWrap.firstChild;
      if (ref) {
        const w = ref.naturalWidth || ref.width, h = ref.naturalHeight || ref.height;
        if (w && h) stage.style.aspectRatio = w + ' / ' + h;
      }
    }

    render();
    return {
      el: root,
      setBefore(src) { fill(beforeWrap, asElement(src)); },
      setAfter(src) { fill(afterWrap, asElement(src)); },
      setPos,
      destroy() { root.remove(); }
    };
  }

  window.CompareSlider = { create };
})();
