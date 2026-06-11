/* Motion — scroll reveals, progress bar, glass nav, count-ups.
   Vanilla JS, transform/opacity only, reduced-motion aware.
   (The 3D background lives in scene3d.js.) */
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

  // ---------- Nav shadow state on scroll ----------
  var nav = document.querySelector('.nav, .site-nav');

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
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
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
  document.querySelectorAll('.tile').forEach(function (el, i) {
    el.classList.add('rv');
    el.style.setProperty('--d', i % 6);
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

  // ---------- Category nav scrollspy (homepage) ----------
  var catNav = document.querySelector('.cat-nav');
  if (catNav && 'IntersectionObserver' in window) {
    var links = catNav.querySelectorAll('a[href^="#"]');
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) {
          a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-25% 0px -65% 0px' });
    links.forEach(function (a) {
      var target = document.getElementById(a.getAttribute('href').slice(1));
      if (target) spy.observe(target);
    });
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
})();
