/* Motion — scroll reveals, progress bar, glass nav, count-ups,
   horizontal showcase, spotlight, tilt, magnetic buttons.
   Vanilla JS, transform/opacity only, reduced-motion aware. */
(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.add('js');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Scroll progress bar ----------
  var bar;
  if (!reduced) {
    bar = document.createElement('div');
    bar.id = 'scroll-progress';
    document.body.appendChild(bar);
  }

  // ---------- Glass nav after 100px ----------
  var nav = document.querySelector('.nav, .site-nav');

  // ---------- Sticky horizontal showcase ----------
  var showcase = document.querySelector('.showcase');
  var track = document.querySelector('.tile-track');
  var pin = document.querySelector('.showcase-pin');
  var showcaseOn = false;

  function sizeShowcase() {
    showcaseOn = !!(showcase && track && pin) && !reduced && window.innerWidth > 900;
    if (!showcase) return;
    if (!showcaseOn) { showcase.style.height = ''; if (track) track.style.transform = ''; return; }
    var distance = track.scrollWidth - window.innerWidth;
    if (distance < 0) distance = 0;
    showcase.style.height = (pin.offsetTop - showcase.offsetTop) + pin.offsetHeight + distance + 'px';
  }

  // ---------- Unified scroll handler (rAF-throttled) ----------
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY;
      if (nav) nav.classList.toggle('nav-glass', y > 100);
      if (bar) {
        var max = doc.scrollHeight - window.innerHeight;
        bar.style.transform = 'scaleX(' + (max > 0 ? y / max : 0) + ')';
      }
      if (showcaseOn) {
        var start = showcase.offsetTop;
        var range = showcase.offsetHeight - pin.offsetHeight;
        var p = range > 0 ? (y - start) / range : 0;
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        var distance = track.scrollWidth - window.innerWidth;
        track.style.transform = 'translate3d(' + -p * distance + 'px,0,0)';
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { sizeShowcase(); onScroll(); }, { passive: true });
  sizeShowcase();
  onScroll();

  // ---------- Scroll reveals (auto-tag common blocks; stagger grids) ----------
  var autoSelectors = '.section-label,.section-title,.section-sub,.tool-header,' +
    '.dropzone,.workbench,.editor-link,.legal-head,.prose,.contact-card,.stat,' +
    '.faq-item,.feature-inner,.feature-visual';
  document.querySelectorAll(autoSelectors).forEach(function (el) {
    if (!el.closest('.editor-shell')) el.classList.add('rv');
  });
  // Stagger siblings inside grids/lists.
  document.querySelectorAll('.stats-row,.faq .container,.contact-grid').forEach(function (group) {
    var i = 0;
    group.querySelectorAll('.rv').forEach(function (el) { el.style.setProperty('--d', i++ % 8); });
  });
  // Tiles reveal with stagger when the showcase is in grid mode.
  document.querySelectorAll('.tile').forEach(function (el, i) {
    if (!showcaseOn) { el.classList.add('rv'); el.style.setProperty('--d', i % 6); }
  });

  var revealEls = document.querySelectorAll('.rv');
  if (reduced || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  // ---------- Count-up stats ----------
  var counters = document.querySelectorAll('[data-count]');
  function runCount(el) {
    var target = parseFloat(el.getAttribute('data-count')) || 0;
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    if (reduced) { el.textContent = prefix + target + suffix; return; }
    var t0 = null;
    var dur = 1400;
    function step(t) {
      if (!t0) t0 = t;
      var p = (t - t0) / dur;
      if (p > 1) p = 1;
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (counters.length) {
    if (reduced || !('IntersectionObserver' in window)) {
      counters.forEach(runCount);
    } else {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { runCount(entry.target); cio.unobserve(entry.target); }
        });
      }, { threshold: 0.4 });
      counters.forEach(function (el) { cio.observe(el); });
    }
  }

  if (reduced) return; // pointer effects below are motion-only

  var fine = window.matchMedia('(pointer: fine)').matches;
  if (!fine) return;

  // ---------- Hero cursor spotlight ----------
  var hero = document.querySelector('.hero');
  var spot = document.querySelector('.spot');
  if (hero && spot) {
    var sx = 0, sy = 0, spotTick = false;
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      sx = e.clientX - r.left - 450;
      sy = e.clientY - r.top - 450;
      if (spotTick) return;
      spotTick = true;
      requestAnimationFrame(function () {
        spotTick = false;
        spot.style.transform = 'translate3d(' + sx + 'px,' + sy + 'px,0)';
      });
    }, { passive: true });
  }

  // ---------- Mock editor tilt ----------
  var rig = document.querySelector('.hero-visual');
  var mock = document.querySelector('.mock');
  if (rig && mock) {
    rig.addEventListener('mousemove', function (e) {
      var r = rig.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      mock.style.setProperty('--ry', (px * 7).toFixed(2) + 'deg');
      mock.style.setProperty('--rx', (-py * 7).toFixed(2) + 'deg');
    }, { passive: true });
    rig.addEventListener('mouseleave', function () {
      mock.style.setProperty('--rx', '0deg');
      mock.style.setProperty('--ry', '0deg');
    });
  }

  // ---------- Magnetic buttons ----------
  document.querySelectorAll('.hero-cta .btn, .btn-magnetic').forEach(function (btn) {
    btn.addEventListener('mousemove', function (e) {
      var r = btn.getBoundingClientRect();
      var mx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
      var my = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      btn.style.transform = 'translate(' + (mx * 5).toFixed(1) + 'px,' + (my * 4).toFixed(1) + 'px)';
    }, { passive: true });
    btn.addEventListener('mouseleave', function () { btn.style.transform = ''; });
  });
})();
