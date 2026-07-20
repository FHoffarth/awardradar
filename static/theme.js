/*
 * AwardRadar shared public theme controller.
 *
 * First paint is handled by a tiny inline block in templates/base_public.html
 * (stored value -> prefers-color-scheme -> dark) so there is no flash of the
 * wrong theme. This file owns the toggle/event logic and keeps every
 * `.theme-btn` in sync (icons + accessible state).
 *
 * Storage key stays `awardradar_theme`. Only 'light' and 'dark' are accepted;
 * anything else falls back to the system preference, then dark. localStorage
 * access is wrapped defensively so a blocked store never breaks the page.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'awardradar_theme';
  var root = document.documentElement;

  function readStored() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (e) {
      return null;
    }
  }

  function writeStored(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* localStorage unavailable (private mode, blocked, quota) — ignore. */
    }
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function currentTheme() {
    var applied = root.dataset.theme;
    if (applied === 'light' || applied === 'dark') return applied;
    return readStored() || systemTheme();
  }

  function sync(theme) {
    root.dataset.theme = theme;

    var moon = document.getElementById('themeIconMoon');
    var sun = document.getElementById('themeIconSun');
    if (moon) moon.style.display = theme === 'dark' ? '' : 'none';
    if (sun) sun.style.display = theme === 'light' ? '' : 'none';

    // Convey state to assistive tech — not by icon alone.
    var nextTheme = theme === 'dark' ? 'light' : 'dark';
    var label = 'Switch to ' + nextTheme + ' mode';
    var buttons = document.querySelectorAll('.theme-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      buttons[i].setAttribute('aria-label', label);
    }
  }

  function applyTheme(theme) {
    sync(theme);
    writeStored(theme);
  }

  function toggle() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  function init() {
    // Re-sync icons/labels to whatever the early inline block already applied.
    sync(currentTheme());

    var buttons = document.querySelectorAll('.theme-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', toggle);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
