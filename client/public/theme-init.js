// Set the theme before first paint to avoid a flash. A stored choice wins;
// otherwise follow the OS preference. This lives in a same-origin file (rather
// than inline) so it passes the strict CSP (script-src 'self'); referenced as a
// render-blocking <script> in <head> so it runs before the body paints.
(function () {
  try {
    var t = localStorage.getItem('cq-theme');
    if (t !== 'canquery' && t !== 'canquery-light') {
      t = matchMedia('(prefers-color-scheme: light)').matches ? 'canquery-light' : 'canquery';
    }
    document.documentElement.dataset.theme = t;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'canquery-light' ? '#f4f7fc' : '#0a0e16');
  } catch { /* no-op: fall back to the default theme */ }
})();
