/* Global light/dark theme toggle — shared across all Lensly pages */
(function () {
  var KEY = 'lensly_theme';

  // Apply saved theme ASAP to minimise flash
  var current = 'dark';
  try { current = localStorage.getItem(KEY) || 'dark'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', current);

  var btn;

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    updateBtn(theme);
  }

  function updateBtn(theme) {
    if (!btn) return;
    // Show the icon of the mode you'll switch TO
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.setAttribute('aria-label',
      theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    btn.setAttribute('title',
      theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  }

  function init() {
    btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.type = 'button';
    btn.addEventListener('click', function () {
      var now = document.documentElement.getAttribute('data-theme');
      setTheme(now === 'light' ? 'dark' : 'light');
    });
    document.body.appendChild(btn);
    updateBtn(document.documentElement.getAttribute('data-theme'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
