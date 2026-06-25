(function() {
  const STORAGE_KEY = 'awardradar_saved_searches';
  const MAX_SAVED_SEARCHES = 12;

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cssValue(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function readSavedSearches() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item => item && item.id && item.is_active !== false);
    } catch (_) {
      return [];
    }
  }

  function writeSavedSearches(searches) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches.slice(0, MAX_SAVED_SEARCHES)));
  }

  function activeCabinValue() {
    const active = document.querySelector('.seg.active');
    return active ? active.dataset.cabin : 'Economy';
  }

  function activeModeValue() {
    const active = document.querySelector('.tab.active');
    return active ? active.dataset.tab : 'cheap';
  }

  function activeFlexValue() {
    const flex = document.querySelector('.flex-opt.on');
    return flex ? parseInt(flex.dataset.flex || '0', 10) : 0;
  }

  function currentSearch() {
    const origin = (byId('origin')?.value || '').trim().toUpperCase();
    const destination = (byId('dest')?.value || '').trim().toUpperCase();
    const departureDate = (byId('date')?.value || '').trim();
    const isOneWay = Boolean(byId('oneWay')?.checked);
    const returnDate = isOneWay ? '' : ((byId('returnDate')?.value || '').trim());

    if (!origin || !destination || !departureDate) {
      throw new Error('Enter origin, destination and departure date before saving.');
    }

    const timestamp = nowIso();
    return {
      id: 'ss_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      user_id: null,
      origin,
      destination,
      departure_date: departureDate,
      return_date: returnDate,
      cabin: activeCabinValue(),
      programs: byId('mmOnly')?.checked ? ['star_alliance'] : [],
      passengers: 1,
      search_type: activeModeValue(),
      flex_days: activeFlexValue(),
      created_at: timestamp,
      updated_at: timestamp,
      is_active: true
    };
  }

  function sameSearch(a, b) {
    return a.origin === b.origin
      && a.destination === b.destination
      && a.departure_date === b.departure_date
      && (a.return_date || '') === (b.return_date || '')
      && a.cabin === b.cabin
      && a.search_type === b.search_type
      && a.flex_days === b.flex_days
      && JSON.stringify(a.programs || []) === JSON.stringify(b.programs || []);
  }

  function saveCurrentSearch() {
    const next = currentSearch();
    const existing = readSavedSearches();
    const duplicate = existing.find(item => sameSearch(item, next));
    if (duplicate) {
      duplicate.updated_at = nowIso();
      writeSavedSearches([duplicate, ...existing.filter(item => item.id !== duplicate.id)]);
      renderSavedSearches('Saved search updated.');
      return;
    }
    writeSavedSearches([next, ...existing]);
    renderSavedSearches('Search saved.');
  }

  function setDateValue(id, value) {
    const input = byId(id);
    if (!input) return;
    if (input._flatpickr) {
      if (value) input._flatpickr.setDate(value, false);
      else input._flatpickr.clear();
    } else {
      input.value = value || '';
    }
  }

  function restoreSearch(search, shouldRun) {
    if (!search) return;
    byId('origin').value = search.origin || '';
    byId('dest').value = search.destination || '';
    setDateValue('date', search.departure_date || '');
    setDateValue('returnDate', search.return_date || '');

    const oneWay = byId('oneWay');
    if (oneWay) oneWay.checked = !search.return_date;
    if (typeof toggleReturn === 'function') toggleReturn();

    const mmOnly = byId('mmOnly');
    if (mmOnly) mmOnly.checked = (search.programs || []).includes('star_alliance');
    document.querySelectorAll('.pill input[type=checkbox]').forEach(cb => {
      const pill = cb.closest('.pill');
      if (pill) pill.classList.toggle('on', cb.checked);
    });

    const cabin = document.querySelector('.seg[data-cabin="' + cssValue(search.cabin || 'Economy') + '"]');
    if (cabin) cabin.click();

    document.querySelectorAll('.flex-opt').forEach(btn => {
      btn.classList.toggle('on', String(search.flex_days || 0) === String(btn.dataset.flex || '0'));
    });

    const tab = document.querySelector('.tab[data-tab="' + cssValue(search.search_type || 'cheap') + '"]');
    if (tab && typeof activateTab === 'function') activateTab(tab);
    if (typeof updatePaCodes === 'function') updatePaCodes();

    if (shouldRun && typeof run === 'function') run();
  }

  function removeSearch(id) {
    writeSavedSearches(readSavedSearches().filter(item => item.id !== id));
    renderSavedSearches('Saved search removed.');
  }

  function clearSavedSearches() {
    writeSavedSearches([]);
    renderSavedSearches('Saved searches cleared.');
  }

  function labelFor(search) {
    const route = `${search.origin || '?'} -> ${search.destination || '?'}`;
    const dates = search.return_date ? `${search.departure_date} -> ${search.return_date}` : search.departure_date;
    return { route, dates };
  }

  function renderSavedSearches(message) {
    const list = byId('savedSearchesList');
    if (!list) return;
    const searches = readSavedSearches();
    const messageHtml = message ? `<div class="saved-searches-message">${safeText(message)}</div>` : '';
    if (!searches.length) {
      list.innerHTML = messageHtml + '<div class="saved-searches-empty">No saved searches yet.</div>';
      return;
    }
    list.innerHTML = messageHtml + searches.map(search => {
      const labels = labelFor(search);
      const programLabel = (search.programs || []).includes('star_alliance') ? 'Star Alliance' : 'All programs';
      return `<article class="saved-search-item" data-id="${safeText(search.id)}">
        <div class="saved-search-main">
          <strong>${safeText(labels.route)}</strong>
          <span>${safeText(labels.dates)} | ${safeText(search.cabin || 'Economy')} | ${safeText(programLabel)}</span>
        </div>
        <div class="saved-search-actions">
          <button type="button" data-action="load" data-id="${safeText(search.id)}">Load</button>
          <button type="button" data-action="run" data-id="${safeText(search.id)}">Run</button>
          <button type="button" data-action="remove" data-id="${safeText(search.id)}" aria-label="Remove saved search">Remove</button>
        </div>
      </article>`;
    }).join('');
  }

  function bindSavedSearches() {
    const saveButton = byId('saveSearchBtn');
    const list = byId('savedSearchesList');
    if (!saveButton || !list) return;

    saveButton.addEventListener('click', function() {
      try {
        saveCurrentSearch();
      } catch (error) {
        renderSavedSearches(error.message || 'Search could not be saved.');
      }
    });

    list.addEventListener('click', function(event) {
      const target = event.target.closest('button[data-action]');
      if (!target) return;
      const id = target.dataset.id;
      const action = target.dataset.action;
      const search = readSavedSearches().find(item => item.id === id);
      if (action === 'remove') {
        removeSearch(id);
      } else if (search) {
        restoreSearch(search, action === 'run');
      }
    });

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'saved-searches-clear';
    clearButton.textContent = 'Clear saved';
    clearButton.addEventListener('click', clearSavedSearches);
    saveButton.insertAdjacentElement('afterend', clearButton);
    renderSavedSearches();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSavedSearches);
  } else {
    bindSavedSearches();
  }
})();
