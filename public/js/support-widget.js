/* Support widget — floating help button + searchable FAQ panel.
   Fully client-side: keyword scoring against the FAQ set, mailto fallback.
   Injected styles use the site's CSS variables so it follows the theme. */

(function () {
  'use strict';
  if (window.__mfitSupport) return;
  window.__mfitSupport = true;

  var SITE = 'MyFreeImageTool';
  var EMAIL = ['sawantrob', 'gmail.com'].join('@');
  var LS_KEY = 'mfit-help-open';

  var FAQS = [
    {
      q: 'Is everything really free?',
      a: 'Yes — all 33 tools, including AI background removal, OCR and the full editor, are free with no signup, no watermark and no usage caps. The site is supported by unobtrusive ads.',
      k: ['free', 'cost', 'price', 'pay', 'paid', 'premium', 'subscription', 'signup', 'account', 'trial']
    },
    {
      q: 'Are my images uploaded to a server?',
      a: 'No. Every tool runs entirely in your browser using the Canvas API and WebAssembly. Your images never leave your device, and most tools keep working offline once the page has loaded.',
      k: ['upload', 'server', 'privacy', 'private', 'secure', 'safe', 'cloud', 'data', 'offline', 'leave', 'store']
    },
    {
      q: 'Are there file size or batch limits?',
      a: 'No. There are no per-file size caps and no batch limits — process 3 images or 300. Because your own device does the work, very large jobs simply run at the speed of your hardware.',
      k: ['limit', 'cap', 'size', 'big', 'large', 'batch', 'many', 'bulk', 'maximum', 'max', 'mb', 'count']
    },
    {
      q: 'Why does background removal work best on people?',
      a: 'The on-device model (MODNet) is trained for portraits, so it excels at people and struggles with products or pets. Unlike server tools there is no usage cap — retry and refine as often as you like, free.',
      k: ['background', 'removal', 'remove', 'cutout', 'transparent', 'portrait', 'modnet', 'matting', 'product', 'object']
    },
    {
      q: 'Why is OCR slow the first time?',
      a: 'Image to Text downloads the Tesseract engine and your language data on first use (a few MB, cached afterwards), then recognition runs on your CPU. Clear, high-resolution images recognise fastest — and nothing is sent anywhere.',
      k: ['ocr', 'text', 'recognize', 'recognition', 'slow', 'tesseract', 'extract', 'scan', 'language', 'long', 'stuck']
    },
    {
      q: 'How do I convert iPhone HEIC photos?',
      a: 'Use the HEIC to JPG tool — drop in any number of .heic/.heif photos and they convert to JPG (or PNG) right on your device. No 30-file batch cap, no uploads.',
      k: ['heic', 'heif', 'iphone', 'apple', 'ios', 'convert', 'jpg', 'photos']
    },
    {
      q: "Why can't I export WebP in Safari?",
      a: "Safari can decode WebP but cannot encode it, so the WebP converter can't produce WebP files there. Use Chrome, Edge or Firefox for WebP output, or pick JPG/PNG instead — those work everywhere.",
      k: ['webp', 'safari', 'export', 'encode', 'browser', 'mac', 'format', 'avif']
    },
    {
      q: 'Do the tools add a watermark?',
      a: 'Never. Every download is your image, untouched — no watermarks, no branding, no reduced "free tier" quality. The Add Watermark tool exists only for marks you choose to add yourself.',
      k: ['watermark', 'logo', 'brand', 'stamp', 'quality', 'mark']
    },
    {
      q: 'Does it work on my phone?',
      a: 'Yes — the whole site is responsive and works on iPhone, iPad and Android. Heavy AI jobs (upscaling, background removal, OCR) run at the speed of your device, so a laptop will finish them faster.',
      k: ['phone', 'mobile', 'iphone', 'android', 'ipad', 'tablet', 'app', 'install']
    },
    {
      q: 'How do I remove location data from a photo?',
      a: 'The EXIF Remover strips GPS coordinates, camera serial numbers and all other metadata in one click, on-device. You can inspect exactly what a photo contains before you clean it.',
      k: ['exif', 'location', 'gps', 'metadata', 'strip', 'remove', 'geotag', 'camera', 'info']
    }
  ];

  var CSS =
    '.sw-fab{position:fixed;right:18px;bottom:18px;z-index:250;width:48px;height:48px;border:none;border-radius:50%;' +
    'background:var(--accent,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;' +
    'box-shadow:0 6px 24px var(--accent-glow,rgba(79,70,229,.25));transition:transform .25s var(--ease-out,ease),background-color .2s ease}' +
    '.sw-fab:hover{transform:scale(1.06);background:var(--accent-hover,#4338ca)}' +
    '.sw-fab:focus-visible{outline:2px solid var(--accent,#4f46e5);outline-offset:3px}' +
    '.sw-fab svg{width:22px;height:22px}' +
    '.sw-panel{position:fixed;right:18px;bottom:78px;z-index:250;width:min(360px,calc(100vw - 36px));' +
    'max-height:min(540px,calc(100vh - 110px));display:flex;flex-direction:column;overflow:hidden;' +
    'background:var(--bg,#fff);border:1px solid var(--border,#ececf0);border-radius:var(--radius-lg,16px);' +
    'box-shadow:var(--shadow-card-hover,0 16px 56px rgba(0,0,0,.1))}' +
    '.sw-panel[hidden]{display:none!important}' +
    '.sw-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border,#ececf0)}' +
    '.sw-title{font-size:15px;font-weight:600;color:var(--text,#0d0d0f);margin:0}' +
    '.sw-close{width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--text-muted,#8a8a96);' +
    'font-size:18px;line-height:1;cursor:pointer;transition:background-color .15s ease,color .15s ease}' +
    '.sw-close:hover{background:var(--bg-elevated,#f6f6f8);color:var(--text,#0d0d0f)}' +
    '.sw-body{padding:14px 16px;overflow-y:auto;flex:1}' +
    '.sw-greet{margin:0 0 12px;font-size:13.5px;line-height:1.55;color:var(--text-secondary,#4b4b57)}' +
    '.sw-search{width:100%;padding:10px 12px;margin-bottom:12px;background:var(--bg,#fff);color:var(--text,#0d0d0f);' +
    'border:1px solid var(--border-strong,#dcdce4);border-radius:9px;font-family:inherit;font-size:14px}' +
    '.sw-search:focus{outline:none;border-color:var(--accent,#4f46e5);box-shadow:0 0 0 3px var(--accent-soft,rgba(79,70,229,.08))}' +
    '.sw-list{list-style:none;margin:0;padding:0}' +
    '.sw-item{border:1px solid var(--border,#ececf0);border-radius:var(--radius-md,12px);margin-bottom:8px;background:var(--bg-card,#fff);transition:border-color .25s ease}' +
    '.sw-item.open{border-color:var(--accent,#4f46e5)}' +
    '.sw-q{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:11px 14px;border:none;' +
    'background:transparent;text-align:left;font-family:inherit;font-size:13.5px;font-weight:500;color:var(--text,#0d0d0f);cursor:pointer}' +
    '.sw-q::after{content:"+";font-size:18px;font-weight:300;color:var(--text-muted,#8a8a96);flex-shrink:0}' +
    '.sw-item.open .sw-q::after{content:"\\2212";color:var(--accent,#4f46e5)}' +
    '.sw-a{display:none;margin:0;padding:0 14px 12px;font-size:13px;line-height:1.6;color:var(--text-secondary,#4b4b57)}' +
    '.sw-item.open .sw-a{display:block}' +
    '.sw-empty{padding:4px 2px 8px;font-size:13.5px;line-height:1.6;color:var(--text-secondary,#4b4b57)}' +
    '.sw-empty a{color:var(--accent,#4f46e5);font-weight:600;text-decoration:none}' +
    '.sw-empty a:hover{text-decoration:underline}' +
    '.sw-foot{padding:10px 16px;border-top:1px solid var(--border,#ececf0);font-size:12px;color:var(--text-muted,#8a8a96)}' +
    '.sw-foot a{color:var(--accent,#4f46e5);text-decoration:none;font-weight:500}' +
    '.sw-foot a:hover{text-decoration:underline}' +
    '@media (max-width:560px){.sw-panel{left:0;right:0;bottom:0;width:100%;border-radius:16px 16px 0 0;border-left:none;border-right:none;border-bottom:none;max-height:80vh;max-height:80dvh}}';

  function mailto(subject) {
    var body = 'Hi Rob,\n\nWhat happened:\n\n\nWhat I expected:\n\n\nBrowser & device (e.g. Chrome on Windows 11):\n\n\nPage: ' + location.href + '\n';
    return 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  function tokenize(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2; });
  }

  // Precompute searchable word sets per FAQ.
  FAQS.forEach(function (f) {
    f.qWords = tokenize(f.q);
    f.aWords = tokenize(f.a);
  });

  function score(faq, tokens) {
    var s = 0;
    tokens.forEach(function (t) {
      if (faq.k.indexOf(t) !== -1) s += 3;
      else if (faq.qWords.indexOf(t) !== -1) s += 2;
      else if (faq.aWords.indexOf(t) !== -1) s += 1;
    });
    return s;
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var fab = el('button', 'sw-fab');
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Help and frequently asked questions');
  fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
    '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5v-8Z" stroke-linejoin="round"/>' +
    '<path d="M9.6 9.2a2.4 2.4 0 1 1 3.3 2.2c-.6.25-.9.6-.9 1.1v.3" stroke-linecap="round"/>' +
    '<circle cx="12" cy="14.9" r=".4" fill="currentColor" stroke="none"/></svg>';

  var panel = el('div', 'sw-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', SITE + ' help');
  panel.hidden = true;
  panel.innerHTML =
    '<div class="sw-head"><p class="sw-title">Need a hand?</p>' +
    '<button class="sw-close" type="button" aria-label="Close help">&times;</button></div>' +
    '<div class="sw-body">' +
    '<p class="sw-greet">Hi! Ask a question or browse the answers below — everything here runs on your device, so help is instant.</p>' +
    '<input class="sw-search" type="search" placeholder="e.g. Are my images uploaded?" aria-label="Search frequently asked questions">' +
    '<ul class="sw-list"></ul><div class="sw-empty" hidden></div></div>' +
    '<div class="sw-foot">Still stuck? <a class="sw-mail" href="#">Email support</a></div>';

  var list = panel.querySelector('.sw-list');
  var empty = panel.querySelector('.sw-empty');
  var search = panel.querySelector('.sw-search');
  panel.querySelector('.sw-mail').href = mailto('Support: ' + SITE);

  function render(query) {
    var items = FAQS;
    if (query) {
      var tokens = tokenize(query);
      items = FAQS.map(function (f) { return { f: f, s: score(f, tokens) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 4)
        .map(function (x) { return x.f; });
    }
    list.innerHTML = '';
    if (!items.length) {
      empty.hidden = false;
      empty.innerHTML = 'Hmm, nothing here matches that. Drop us a line at ' +
        '<a href="' + mailto('Support: ' + SITE) + '">' + EMAIL + '</a>' +
        ' and a human will get back to you — include your browser and what happened.';
      return;
    }
    empty.hidden = true;
    items.forEach(function (f, i) {
      var li = el('li', 'sw-item' + (query && i === 0 ? ' open' : ''));
      var btn = el('button', 'sw-q');
      btn.type = 'button';
      btn.textContent = f.q;
      btn.setAttribute('aria-expanded', li.className.indexOf('open') !== -1 ? 'true' : 'false');
      btn.addEventListener('click', function () {
        var open = li.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      var ans = el('p', 'sw-a');
      ans.textContent = f.a;
      li.appendChild(btn);
      li.appendChild(ans);
      list.appendChild(li);
    });
  }

  var debounce;
  search.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () { render(search.value.trim()); }, 120);
  });

  function setOpen(open, focus) {
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem(LS_KEY, open ? 'open' : 'closed'); } catch (e) { /* private mode */ }
    if (open && focus) search.focus();
    if (!open && focus) fab.focus();
  }

  fab.addEventListener('click', function () { setOpen(panel.hidden, true); });
  panel.querySelector('.sw-close').addEventListener('click', function () { setOpen(false, true); });
  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false, true);
  });

  render('');
  document.body.appendChild(panel);
  document.body.appendChild(fab);

  var remembered = null;
  try { remembered = localStorage.getItem(LS_KEY); } catch (e) { /* private mode */ }
  if (remembered === 'open') setOpen(true, false);
})();
