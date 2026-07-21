(function() {
  const STORAGE_KEY = 'awardradar_consent';
  const config = window.AWARDRADAR_ANALYTICS || {};
  let analyticsLoaded = false;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  function readConsent() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored || stored.necessary !== true || typeof stored.analytics !== 'boolean') return null;
      return stored;
    } catch (_) {
      return null;
    }
  }

  function writeConsent(analytics) {
    const choice = {
      necessary: true,
      analytics: Boolean(analytics),
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    return choice;
  }

  function setGoogleConsent(granted) {
    window.gtag('consent', 'update', {
      analytics_storage: granted ? 'granted' : 'denied'
    });
  }

  function clearAnalyticsCookies() {
    const names = document.cookie
      .split(';')
      .map(function(cookie) { return cookie.split('=')[0].trim(); })
      .filter(function(name) { return /^_(ga|gid|gat)/.test(name); });
    ['_ga', '_gid', '_gat'].forEach(function(name) {
      if (!names.includes(name)) names.push(name);
    });
    const hostParts = location.hostname.split('.');
    const domains = ['', location.hostname];
    if (hostParts.length > 2) domains.push('.' + hostParts.slice(-2).join('.'));
    names.forEach(function(name) {
      domains.forEach(function(domain) {
        document.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax' + (domain ? '; domain=' + domain : '');
      });
    });
  }

  function injectScript(src, id) {
    if (id && document.getElementById(id)) return;
    const script = document.createElement('script');
    if (id) script.id = id;
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  function loadAnalytics() {
    if (analyticsLoaded || !config.production) return;
    analyticsLoaded = true;
    setGoogleConsent(true);

    if (config.gtmId) {
      window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      injectScript('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(config.gtmId), 'awardradar-gtm');
    }

    if (config.ga4Id) {
      injectScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.ga4Id), 'awardradar-ga4');
      window.gtag('js', new Date());
      window.gtag('config', config.ga4Id);
    }
  }

  function removeBanner() {
    const existing = document.getElementById('consent-banner');
    if (existing) existing.remove();
  }

  function applyConsent(choice) {
    if (choice && choice.analytics) {
      loadAnalytics();
    } else {
      setGoogleConsent(false);
      clearAnalyticsCookies();
    }
  }

  function showBanner() {
    removeBanner();
    const banner = document.createElement('section');
    banner.id = 'consent-banner';
    banner.className = 'consent-banner';
    banner.setAttribute('aria-label', 'Privacy and cookie settings');
    banner.innerHTML = `
      <div class="consent-copy">
        <strong>Privacy settings</strong>
        <p>AwardRadar uses necessary storage for core settings. Analytics only loads if you allow it.</p>
      </div>
      <div class="consent-actions">
        <button type="button" class="consent-btn consent-btn-secondary" data-consent="reject">Reject analytics</button>
        <button type="button" class="consent-btn consent-btn-primary" data-consent="accept">Allow analytics</button>
      </div>
    `;
    banner.addEventListener('click', function(event) {
      const action = event.target && event.target.getAttribute('data-consent');
      if (!action) return;
      const hadAnalytics = Boolean(readConsent() && readConsent().analytics);
      const choice = writeConsent(action === 'accept');
      applyConsent(choice);
      removeBanner();
      if (action === 'reject' && (hadAnalytics || analyticsLoaded)) {
        window.location.reload();
      }
    });
    document.body.appendChild(banner);
  }

  function addPreferencesButton() {
    // Prefer an in-page trigger (a quiet footer link) so the preferences
    // control matches the surrounding shell. Only fall back to a floating
    // button on pages that don't provide one (e.g. the legacy /tool).
    // This changes only where the reopen control lives, not consent logic.
    const slot = document.querySelector('[data-consent-preferences]');
    if (slot) {
      if (slot.dataset.consentBound === '1') return;
      slot.dataset.consentBound = '1';
      slot.addEventListener('click', function(event) {
        event.preventDefault();
        showBanner();
      });
      return;
    }
    if (document.getElementById('consent-preferences')) return;
    const button = document.createElement('button');
    button.id = 'consent-preferences';
    button.className = 'consent-preferences';
    button.type = 'button';
    button.textContent = 'Privacy settings';
    button.addEventListener('click', showBanner);
    document.body.appendChild(button);
  }

  function initConsent() {
    const choice = readConsent();
    addPreferencesButton();
    if (choice) {
      applyConsent(choice);
    } else {
      showBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConsent);
  } else {
    initConsent();
  }
})();
