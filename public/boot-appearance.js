// A separate file because the security policy in _headers allows no inline scripts.
// Not deferred or a module: it has to run before the page is drawn.
// Apply a saved Light/Dark choice before the page is drawn, so a dark-mode
// user never sees a white flash while React loads. Same key as src/ui/theme.ts.
try {
  var saved = localStorage.getItem('spendsense-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {}
// The same for effects, so none flash on before React loads. Subtle unless
// a choice is stored; src/ui/appearance.ts holds the same names and rules.
(function () {
  var fx = { background: true, tilt: true, edgeMotion: true, chartAnimation: true, level: 'subtle' };
  try {
    var stored = JSON.parse(localStorage.getItem('spendsense-effects'));
    if (stored && typeof stored.background === 'boolean' && typeof stored.tilt === 'boolean' &&
        typeof stored.edgeMotion === 'boolean' && typeof stored.chartAnimation === 'boolean') fx = stored;
  } catch {}
  var data = document.documentElement.dataset;
  data.fxBackground = fx.background ? 'on' : 'off';
  data.fxTilt = fx.tilt ? 'on' : 'off';
  data.fxEdge = fx.edgeMotion ? 'on' : 'off';
  data.fxChart = fx.chartAnimation ? 'on' : 'off';
  data.fxLevel = !fx.background && !fx.tilt && !fx.edgeMotion && !fx.chartAnimation ? 'off' : fx.level === 'full' ? 'full' : 'subtle';
})();
