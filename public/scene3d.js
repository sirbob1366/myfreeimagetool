/* 3D floating-geometry background (Three.js, lazy-loaded from CDN).
   Guardrails: max 7 objects, pixelRatio<=2, paused when hidden, static
   frame under prefers-reduced-motion, 3 objects + no parallax on mobile,
   FPS guard drops the loop if mobile can't hold 30fps, lazy init after
   first paint so LCP is unaffected. Fails silently without WebGL. */
(function () {
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mobile = window.innerWidth < 768;
  var lite = document.body.getAttribute('data-scene') === 'lite';
  var count = lite ? 3 : 7;

  function start() {
    // Mobile: skip WebGL entirely — a pre-rendered still of the scene keeps
    // the main thread free (Three.js parse/compile costs ~600ms on phones).
    if (mobile) {
      var still = document.createElement('div');
      still.id = 'bg3d';
      still.setAttribute('aria-hidden', 'true');
      still.style.backgroundImage = 'url(/scene-static.jpg)';
      still.style.backgroundSize = 'cover';
      still.style.backgroundPosition = 'center';
      document.body.appendChild(still);
      return;
    }
    try {
      var probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    } catch (e) { return; }
    import('/vendor/three/three.module.min.js')
      .then(init)
      .catch(function (e) { console.warn('3D scene unavailable:', e && e.message); });
  }

  function init(THREE) {
    try {
      var canvas = document.createElement('canvas');
      canvas.id = 'bg3d';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 0, 14);

      // Soft studio lighting
      scene.add(new THREE.AmbientLight(0xffffff, 1.15));
      var key = new THREE.DirectionalLight(0xffffff, 1.7);
      key.position.set(5, 8, 6);
      scene.add(key);
      var fill = new THREE.DirectionalLight(0xc7d2fe, 0.9);
      fill.position.set(-6, -4, 4);
      scene.add(fill);

      // Soft matte pastels — premium against pure white
      var pastels = [0xc7d2fe, 0xfbcfe8, 0xbbf7d0, 0xfde68a, 0xbae6fd, 0xddd6fe, 0xe5e7eb];
      var geometries = [
        new THREE.IcosahedronGeometry(1.1, 0),
        new THREE.SphereGeometry(0.95, 48, 48),
        new THREE.TorusGeometry(0.85, 0.34, 32, 72),
        new THREE.TetrahedronGeometry(1.25, 0),
        new THREE.SphereGeometry(0.6, 48, 48),
        new THREE.IcosahedronGeometry(0.7, 0),
        new THREE.TorusGeometry(0.55, 0.22, 32, 72)
      ];
      var placements = [
        [-4.8, 1.9, -2], [4.4, 2.5, -4], [3.7, -2.3, -1],
        [-3.3, -2.7, -3], [0.6, 3.4, -6], [-1.5, -4.2, -7], [5.6, 0.4, -8]
      ];

      var objects = [];
      for (var i = 0; i < count; i++) {
        var material = new THREE.MeshStandardMaterial({
          color: pastels[i % pastels.length],
          roughness: 0.32,
          metalness: 0.05
        });
        var mesh = new THREE.Mesh(geometries[i % geometries.length], material);
        var p = placements[i];
        mesh.position.set(p[0], p[1], p[2]);
        mesh.userData = {
          phase: i * 1.7,
          baseX: p[0], baseY: p[1],
          spin: 0.06 + (i % 3) * 0.04
        };
        scene.add(mesh);
        objects.push(mesh);
      }

      var targetX = 0, targetY = 0, lerpX = 0, lerpY = 0;
      if (!mobile && !reduced) {
        window.addEventListener('mousemove', function (e) {
          targetX = e.clientX / window.innerWidth - 0.5;
          targetY = e.clientY / window.innerHeight - 0.5;
        }, { passive: true });
      }

      window.addEventListener('resize', function () {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (stopped) frame(lastT);
      }, { passive: true });

      var stopped = false;
      var frameCount = 0;
      var fpsStart = 0;
      var fpsChecked = false;
      var lastT = 0;

      function frame(t) {
        lastT = t;
        var s = t / 1000;
        for (var j = 0; j < objects.length; j++) {
          var o = objects[j], u = o.userData;
          o.rotation.x = s * u.spin;
          o.rotation.y = s * u.spin * 1.35;
          o.position.y = u.baseY + Math.sin(s * 0.28 + u.phase) * 0.55;
          o.position.x = u.baseX + Math.cos(s * 0.2 + u.phase) * 0.3;
        }
        // Lerped mouse parallax + slow scroll dolly
        lerpX += (targetX - lerpX) * 0.04;
        lerpY += (targetY - lerpY) * 0.04;
        var doc = document.documentElement;
        var scrollMax = Math.max(1, doc.scrollHeight - window.innerHeight);
        var st = window.scrollY / scrollMax;
        camera.position.x = lerpX * 1.3;
        camera.position.y = -lerpY * 1.3 - st * 4.5;
        camera.position.z = 14 - st * 3;
        camera.lookAt(0, -st * 4.5, 0);
        renderer.render(scene, camera);
      }

      function loop(t) {
        if (stopped || document.hidden) return;
        frame(t);
        // FPS guard: on mobile, if the first 2s can't average 30fps,
        // freeze on a static frame instead of janking.
        if (mobile && !fpsChecked) {
          if (!fpsStart) fpsStart = t;
          frameCount++;
          if (t - fpsStart > 2000) {
            fpsChecked = true;
            if (frameCount / ((t - fpsStart) / 1000) < 30) { stopped = true; return; }
          }
        }
        requestAnimationFrame(loop);
      }

      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && !stopped && !reduced) requestAnimationFrame(loop);
      });

      if (reduced) {
        frame(0); // single static frame
      } else {
        requestAnimationFrame(loop);
      }
    } catch (e) {
      console.warn('3D scene failed to start:', e && e.message);
    }
  }

  // Lazy init after first paint / idle so LCP is unaffected.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(start, { timeout: 2500 });
  } else {
    setTimeout(start, 900);
  }
})();
