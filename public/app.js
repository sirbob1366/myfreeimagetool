/* Shared JS — theme toggle, footer year, utility helpers */

(function () {
  // ---------- Theme ----------
  const root = document.documentElement;
  const stored = localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const currentExplicit = root.getAttribute('data-theme');
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const currentEffective = currentExplicit || (systemDark ? 'dark' : 'light');
      const next = currentEffective === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  }

  // ---------- Footer year ----------
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ---------- Support widget ----------
  // Lazy-loaded once the page is interactive. Skipped on the full-screen
  // editor, where it would overlap the workspace — its nav links Help instead.
  if (!location.pathname.startsWith('/editor')) {
    window.addEventListener('load', () => {
      const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1));
      idle(() => {
        const s = document.createElement('script');
        s.src = '/js/support-widget.js';
        s.defer = true;
        document.body.appendChild(s);
      });
    });
  }
})();

/* Exposed helpers */
window.ImgUtils = {
  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024, units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
  },

  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  setStatus(msg, type) {
    const el = document.querySelector('.status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.remove('error', 'success');
    if (type) el.classList.add(type);
  },

  escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  stripExt(name) { return String(name).replace(/\.[^.]+$/, ''); },

  // Standard image drop-zone wiring.
  attachDropzone(opts) {
    const { dropzone, input, accept = 'image/', multiple = false, onFiles } = opts;
    function deliver(fileList) {
      const arr = Array.from(fileList).filter(f => f.type.startsWith(accept));
      if (!arr.length) { ImgUtils.setStatus('Please choose an image file.', 'error'); return; }
      onFiles(multiple ? arr : [arr[0]]);
    }
    if (input) input.addEventListener('change', e => deliver(e.target.files));
    ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('is-drag'); }));
    dropzone.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files) deliver(e.dataTransfer.files); });
  }
};
