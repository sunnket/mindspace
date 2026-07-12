/*
 * Mindspace embedded-browser runtime shim.
 *
 * Injected into every page served through /api/proxy. The proxied document runs
 * in a sandboxed iframe WITHOUT allow-same-origin, so it is an opaque origin and
 * cannot touch the parent Mindspace app (no access to our DOM / localStorage /
 * auth). All parent <-> page communication goes through postMessage.
 *
 * Responsibilities:
 *   1. Route in-page navigations, fetch(), XHR and form submits back through the
 *      proxy so cross-origin requests keep working (the proxy sends ACAO:*).
 *   2. Report the real current URL + title to the parent so the URL bar updates.
 *   3. Accept back/forward/reload/extract commands from the parent.
 *   4. "Extract mode": let the user click any image or text block to send it to
 *      the canvas.
 */
(function () {
  var CFG = window.__MS_CFG || {};
  var BASE = CFG.base || location.href;
  var PROXY = CFG.proxyPath || '/api/proxy';
  var ORIGIN = location.origin;

  function isHttp(u) { return /^https?:/i.test(u); }

  function abs(u) {
    try { return new URL(u, BASE).href; } catch (e) { return null; }
  }

  // Wrap an arbitrary URL so the request goes through our proxy.
  function wrap(u) {
    if (u == null) return u;
    var s = String(u);
    if (/^(data:|blob:|javascript:|about:|#)/i.test(s)) return u;
    var a = abs(s);
    if (!a || !isHttp(a)) return u;
    // Already proxied? leave it.
    if (a.indexOf(ORIGIN + PROXY) === 0 || s.indexOf(PROXY + '?url=') === 0) return u;
    return PROXY + '?url=' + encodeURIComponent(a);
  }

  function announce() {
    try {
      parent.postMessage({ __ms: 1, type: 'nav', url: BASE, title: document.title || BASE }, '*');
    } catch (e) {}
  }

  // ---- patch fetch --------------------------------------------------------
  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          input = wrap(input);
        } else if (input && input.url) {
          input = new Request(wrap(input.url), input);
        }
      } catch (e) {}
      return _fetch.call(this, input, init);
    };
  }

  // ---- patch XHR ----------------------------------------------------------
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { arguments[1] = wrap(url); } catch (e) {}
    return _open.apply(this, arguments);
  };

  // ---- patch sendBeacon ---------------------------------------------------
  if (navigator.sendBeacon) {
    var _beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try { url = wrap(url); } catch (e) {}
      return _beacon(url, data);
    };
  }

  // ---- window.open -> navigate in place -----------------------------------
  window.open = function (u) {
    if (u) { try { location.href = wrap(u); } catch (e) {} }
    return null;
  };

  // ---- link clicks --------------------------------------------------------
  document.addEventListener('click', function (e) {
    if (window.__ms_extract) return; // extractor owns clicks
    var t = e.target;
    var a = t && t.closest ? t.closest('a') : null;
    if (!a) return;
    var raw = a.getAttribute('href') || '';
    if (/^(javascript:|mailto:|tel:|#)/i.test(raw)) return;
    var h = a.href;
    if (isHttp(h)) {
      e.preventDefault();
      location.href = wrap(h);
    }
  }, true);

  // ---- form submits -------------------------------------------------------
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    var method = (f.getAttribute('method') || 'GET').toUpperCase();
    var action = abs(f.getAttribute('action') || BASE) || BASE;
    if (method === 'GET') {
      e.preventDefault();
      try {
        var params = new URLSearchParams(new FormData(f)).toString();
        var u = new URL(action);
        u.search = params;
        location.href = wrap(u.href);
      } catch (err) {}
    } else {
      // Let the browser POST, but aim it at our proxy endpoint.
      f.setAttribute('action', PROXY + '?url=' + encodeURIComponent(action));
    }
  }, true);

  // ---- drag images / logos out onto the canvas ----------------------------
  // Uses native HTML5 drag (which DOES cross a same-origin iframe boundary) and
  // stamps the ABSOLUTE image URL + dimensions onto the dataTransfer. The parent
  // canvas' drop handler turns that into an image block.
  function findImageSrc(el) {
    if (!el) return null;
    var img = el.tagName === 'IMG' ? el : (el.closest ? el.closest('img') : null);
    if (!img && el.querySelector) img = el.querySelector('img');
    if (img && (img.currentSrc || img.getAttribute('src'))) {
      return {
        src: abs(img.currentSrc || img.getAttribute('src')),
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0,
      };
    }
    var node = el;
    for (var i = 0; i < 4 && node && node.nodeType === 1; i++) {
      try {
        var bg = getComputedStyle(node).backgroundImage;
        var m = bg && bg.match(/url\((['"]?)(.*?)\1\)/);
        if (m && m[2] && !/^data:/i.test(m[2])) return { src: abs(m[2]), w: 0, h: 0 };
      } catch (e) {}
      node = node.parentElement;
    }
    return null;
  }

  // Make sure images are actually draggable (some sites disable it).
  function ensureDraggable() {
    var imgs = document.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].setAttribute('draggable', 'true');
      imgs[i].style.webkitUserDrag = 'element';
    }
  }
  document.addEventListener('DOMContentLoaded', ensureDraggable);
  window.addEventListener('load', ensureDraggable);

  document.addEventListener('dragstart', function (e) {
    var info = findImageSrc(e.target);
    if (!info || !info.src || !e.dataTransfer) return;
    try {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/uri-list', info.src);
      e.dataTransfer.setData('text/plain', info.src);
      e.dataTransfer.setData('application/x-mindspace-image', JSON.stringify(info));
    } catch (er) {}
  }, true);

  // ---- extraction mode ----------------------------------------------------
  var hoverEl = null;
  var banner = null;
  var style = document.createElement('style');
  style.textContent =
    '.__ms_hi{outline:3px solid #4f8cff !important;outline-offset:-1px !important;' +
    'cursor:copy !important;background:rgba(79,140,255,0.08) !important;}' +
    '.__ms_banner{position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
    'background:#0b0b0f;color:#fff;font:600 13px/1.4 system-ui,sans-serif;' +
    'padding:9px 14px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.35);}';
  (document.head || document.documentElement).appendChild(style);

  function setHi(el, on) {
    if (!el || !el.classList) return;
    if (on) el.classList.add('__ms_hi'); else el.classList.remove('__ms_hi');
  }

  function onMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (el === hoverEl || (el && el.classList && el.classList.contains('__ms_banner'))) return;
    setHi(hoverEl, false);
    hoverEl = el;
    setHi(hoverEl, true);
  }

  function flash(el) {
    try {
      var prev = el.style.outline;
      el.style.outline = '3px solid #22c55e';
      setTimeout(function () { el.style.outline = prev; }, 260);
    } catch (e) {}
  }

  function onClick(e) {
    if (!window.__ms_extract) return;
    e.preventDefault();
    e.stopPropagation();
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || (el.classList && el.classList.contains('__ms_banner'))) return;

    // 1) an <img> (directly, or the nearest one inside the clicked element)
    var img = el.tagName === 'IMG' ? el : (el.querySelector ? el.querySelector('img') : null);
    if (img && (img.currentSrc || img.getAttribute('src'))) {
      parent.postMessage({
        __ms: 1, type: 'extract', kind: 'image',
        src: abs(img.currentSrc || img.getAttribute('src')),
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0
      }, '*');
      flash(el);
      return;
    }

    // 2) a CSS background image
    try {
      var bg = getComputedStyle(el).backgroundImage;
      var m = bg && bg.match(/url\((['"]?)(.*?)\1\)/);
      if (m && m[2] && !/^data:/i.test(m[2])) {
        parent.postMessage({ __ms: 1, type: 'extract', kind: 'image', src: abs(m[2]) }, '*');
        flash(el);
        return;
      }
    } catch (e2) {}

    // 3) fall back to the element's text
    var text = (el.innerText || el.textContent || '').replace(/\s+\n/g, '\n').trim();
    if (text) {
      parent.postMessage({ __ms: 1, type: 'extract', kind: 'text', text: text.slice(0, 8000) }, '*');
      flash(el);
    }
  }

  function setExtract(on) {
    if (!!window.__ms_extract === !!on) return;
    window.__ms_extract = !!on;
    if (on) {
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      banner = document.createElement('div');
      banner.className = '__ms_banner';
      banner.textContent = 'Extract mode — click any image or text to send it to the canvas. Press Esc to exit.';
      (document.body || document.documentElement).appendChild(banner);
    } else {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      setHi(hoverEl, false);
      hoverEl = null;
      if (banner) { banner.remove(); banner = null; }
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && window.__ms_extract) {
      setExtract(false);
      try { parent.postMessage({ __ms: 1, type: 'extract-off' }, '*'); } catch (er) {}
    }
  });

  // ---- commands from the parent ------------------------------------------
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__ms !== 1) return;
    if (d.action === 'back') history.back();
    else if (d.action === 'forward') history.forward();
    else if (d.action === 'reload') location.reload();
    else if (d.action === 'extract') setExtract(!!d.on);
  });

  // ---- announce current URL to parent ------------------------------------
  if (document.readyState === 'interactive' || document.readyState === 'complete') announce();
  document.addEventListener('DOMContentLoaded', announce);
  window.addEventListener('load', announce);
})();
