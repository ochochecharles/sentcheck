const $ = (sel) => document.querySelector(sel);
const api = (path, opts) =>
  fetch(`/api${path}`, opts).then(async (r) => {
    const text = await r.text();
    if (!r.ok) {
      throw new Error(text || `Request failed (${r.status})`);
    }
    return text ? JSON.parse(text) : null;
  });

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString() : '—';

async function refreshAccounts() {
  const list = $('#account-list');
  const accounts = await api('/auth/accounts');
  if (!accounts.length) {
    list.innerHTML =
      '<li class="muted">No accounts connected. Pick Gmail or Outlook above.</li>';
    return;
  }
  const statuses = await api('/sync/status');
  const statusByAccount = new Map(statuses.map((s) => [s.id, s]));
  list.innerHTML = '';
  for (const a of accounts) {
    const st = statusByAccount.get(a.id);
    const li = document.createElement('li');
    const syncInfo = st?.sync
      ? `Last sync ${escapeHtml(fmtDate(st.sync.lastSyncedAt))}${
          st.sync.lastError ? ` · error: ${escapeHtml(String(st.sync.lastError))}` : ''
        }`
      : 'Not synced yet';
    const provider = escapeHtml(a.provider);
    const email = escapeHtml(a.accountEmail);
    li.innerHTML = `
      <div>
        <span class="provider">${provider}</span> — ${email}
        <div class="count">${Number(st?.emailCount ?? 0)} sends indexed · ${syncInfo}</div>
      </div>
      <button class="disconnect" data-provider="${provider}" data-email="${email}">Disconnect</button>`;
    list.appendChild(li);
  }
  list.querySelectorAll('.disconnect').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('/auth/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: btn.dataset.provider,
            accountEmail: btn.dataset.email,
          }),
        });
        await Promise.all([refreshAccounts(), refreshRecent()]);
      } catch (err) {
        alert(`Disconnect failed: ${err.message}`);
        btn.disabled = false;
      }
    }),
  );
}

async function refreshRecent() {
  const body = $('#recent-body');
  const empty = $('#recent-empty');
  const sends = await api('/sends/recent?limit=30');
  empty.classList.toggle('hidden', sends.length > 0);
  body.innerHTML = '';
  for (const s of sends) {
    const tr = document.createElement('tr');
    const tos = (s.recipients ?? [])
      .filter((r) => r.type === 'to')
      .map((r) =>
        r.name
          ? `${escapeHtml(r.name)} &lt;${escapeHtml(r.rawAddress)}&gt;`
          : escapeHtml(r.rawAddress),
      );
    tr.innerHTML = `
      <td data-label="Date">${escapeHtml(fmtDate(s.sentAt))}</td>
      <td data-label="To">${tos.join('<br>') || '—'}</td>
      <td data-label="Subject">${escapeHtml(s.subject ?? '')}</td>
      <td data-label="Account">${escapeHtml(s.provider)}</td>`;
    body.appendChild(tr);
  }
}

async function refreshSyncStatus() {
  try {
    const statuses = await api('/sync/status');
    const total = statuses.reduce((n, s) => n + s.emailCount, 0);
    const syncing = statuses.some((s) => s.sync?.syncInProgress);
    $('#sync-status').textContent = syncing
      ? `Syncing… ${total} sends indexed`
      : `${total} sends indexed`;
  } catch {
    $('#sync-status').textContent = 'Server unreachable';
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#0f1220');
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const isLight = theme === 'light';
    btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
    btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  }
}

function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  // sync UI with current theme set by inline head script
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current);
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });
  // follow system if user never picked manually
  try {
    if (!localStorage.getItem('theme')) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        applyTheme(e.matches ? 'light' : 'dark');
        // don't persist system auto - keep it transient
        try { localStorage.removeItem('theme'); } catch {}
      });
    }
  } catch {}
}

function renderCheck(data) {
  const el = $('#check-result');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div>
      <span class="verdict ${data.alreadyContacted ? 'warn' : 'ok'}">
        ${data.alreadyContacted ? '⚠️ Already contacted' : '✅ Looks new — no prior sends'}
      </span>
      <span class="muted check-meta">
        normalized: ${escapeHtml(data.normalizedEmail)} · ${data.count} prior send(s)
      </span>
    </div>
    ${data.sends.length ? '<div class="send-list">' + data.sends
      .map(
        (s) => `
      <div class="send-item">
        <div class="meta">${fmtDate(s.sentAt)} · ${escapeHtml(s.provider)} · to ${escapeHtml(
          s.recipientName ? `${s.recipientName} <${s.recipientRawAddress}>` : s.recipientRawAddress,
        )}</div>
        <div class="subject">${escapeHtml(s.subject ?? '(no subject)')}</div>
        <div class="snippet">${escapeHtml(s.snippet ?? '')}</div>
      </div>`,
      )
      .join('') + '</div>' : ''}
  `;
}

function highlightMatch(text, query) {
  if (!query || !text) return escapeHtml(text ?? '');
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  const before = escapeHtml(text.slice(0, idx));
  const match = escapeHtml(text.slice(idx, idx + query.length));
  const after = escapeHtml(text.slice(idx + query.length));
  return `${before}<span class="ta-highlight">${match}</span>${after}`;
}

async function doCheck(email) {
  const raw = String(email ?? '').trim();
  if (!raw) return;
  try {
    const data = await api('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: raw }),
    });
    renderCheck(data);
  } catch (err) {
    const el = $('#check-result');
    el.classList.remove('hidden');
    el.innerHTML = `<span class="verdict warn">Error: ${escapeHtml(err.message)}</span>`;
  }
}

function initTypeahead() {
  const input = document.getElementById('check-email');
  const list = document.getElementById('typeahead-list');
  const wrap = document.getElementById('typeahead-wrap');
  const form = document.getElementById('check-form');
  if (!input || !list || !wrap) return;

  let suggestions = [];
  let activeIndex = -1;
  let debounceId = null;
  let abortCtrl = null;
  let lastQuery = '';

  const hide = () => {
    list.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  };

  const show = () => {
    if (!suggestions.length) return;
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  };

  const setActive = (idx) => {
    activeIndex = idx;
    const items = list.querySelectorAll('.ta-item');
    items.forEach((el, i) => {
      const isActive = i === idx;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', String(isActive));
      if (isActive) el.scrollIntoView({ block: 'nearest' });
    });
    if (idx >= 0 && suggestions[idx]) {
      input.setAttribute('aria-activedescendant', `ta-opt-${idx}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const render = (query) => {
    if (!suggestions.length) {
      list.innerHTML = `<div class="ta-empty">No matches — press Enter to check “${escapeHtml(query)}”</div>`;
      show();
      return;
    }
    list.innerHTML = suggestions
      .map((s, i) => {
        const displayEmail = s.rawAddress || s.normalizedEmail;
        const namePart = s.name ? ` <span class="ta-name">${highlightMatch(s.name, query)}</span>` : '';
        return `
        <button type="button" role="option" id="ta-opt-${i}" class="ta-item" data-index="${i}" aria-selected="false">
          <span class="ta-email">${highlightMatch(displayEmail, query)}${namePart}</span>
          <span class="ta-meta"><span class="ta-count">${s.count} ×</span> ${escapeHtml(fmtDate(s.lastSentAt))}</span>
        </button>`;
      })
      .join('');
    list.querySelectorAll('.ta-item').forEach((btn) => {
      // prevent input blur before click
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.index);
        select(idx);
      });
      btn.addEventListener('mouseenter', () => setActive(Number(btn.dataset.index)));
    });
    show();
    setActive(-1);
  };

  const fetchSuggestions = async (query) => {
    lastQuery = query;
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    const signal = abortCtrl.signal;
    try {
      list.innerHTML = `<div class="ta-loading">Searching…</div>`;
      list.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=8`, { signal });
      if (signal.aborted) return;
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (input.value.trim() !== lastQuery) return;
      suggestions = Array.isArray(data) ? data : [];
      render(query);
    } catch (err) {
      if (err.name === 'AbortError') return;
      suggestions = [];
      list.innerHTML = `<div class="ta-empty">Search unavailable</div>`;
    }
  };

  const select = (idx) => {
    const s = suggestions[idx];
    if (!s) return;
    const email = s.rawAddress || s.normalizedEmail;
    input.value = email;
    hide();
    suggestions = [];
    doCheck(email);
    input.focus();
  };

  const schedule = (query) => {
    clearTimeout(debounceId);
    if (!query || query.length < 2) {
      suggestions = [];
      hide();
      return;
    }
    debounceId = setTimeout(() => fetchSuggestions(query), 200);
  };

  input.addEventListener('input', () => {
    const q = input.value.trim();
    // reset result if user is typing a new query (optional: keep until new check)
    schedule(q);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q.length >= 2 && suggestions.length) show();
    else if (q.length >= 2) schedule(q);
  });

  input.addEventListener('keydown', (e) => {
    const hasList = !list.classList.contains('hidden') && suggestions.length > 0;
    if (e.key === 'ArrowDown') {
      if (!hasList) {
        const q = input.value.trim();
        if (q.length >= 2) schedule(q);
        return;
      }
      e.preventDefault();
      setActive((activeIndex + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      if (!hasList) return;
      e.preventDefault();
      setActive((activeIndex - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      if (hasList && activeIndex >= 0) {
        e.preventDefault();
        select(activeIndex);
      } else if (hasList && suggestions.length === 1) {
        // if single suggestion, optionally auto-select on Enter when input is partial?
        // keep default submit behavior instead
      }
      // otherwise let form submit handler run doCheck
    } else if (e.key === 'Escape') {
      if (!list.classList.contains('hidden')) {
        e.preventDefault();
        hide();
      }
    }
  });

  // close on outside click
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) hide();
  });

  // close on blur via timeout (allows click to fire)
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) {
        // keep hidden logic to outside click; don't aggressively hide on blur
      }
    }, 150);
  });

  // expose for form submit to hide
  form.addEventListener('submit', () => hide());

  // hide on resize/scroll to avoid detached dropdown
  window.addEventListener('resize', hide, { passive: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initTypeahead();
  const refreshAll = async () => {
    await Promise.allSettled([
      refreshAccounts(),
      refreshRecent(),
      refreshSyncStatus(),
    ]);
  };
  await refreshAll();
  setInterval(refreshSyncStatus, 30000);

  document.querySelectorAll('[data-connect]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const provider = btn.dataset.connect;
      const { url } = await api(`/auth/${provider}?redirect=${encodeURIComponent('/')}`);
      window.location.href = url;
    }),
  );

  $('#btn-sync').addEventListener('click', async () => {
    $('#btn-sync').textContent = 'Syncing…';
    $('#btn-sync').disabled = true;
    try {
      const results = await api('/sync/run', { method: 'POST' });
      const total = results.reduce((n, r) => n + r.inserted, 0);
      await Promise.all([refreshAccounts(), refreshRecent(), refreshSyncStatus()]);
      alert(`Sync complete. ${total} new send(s) indexed.`);
    } catch (e) {
      alert(`Sync failed: ${e.message}`);
    } finally {
      $('#btn-sync').textContent = 'Sync now';
      $('#btn-sync').disabled = false;
    }
  });

  $('#check-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#check-email').value.trim();
    if (!email) return;
    // if dropdown has an active selection, prefer that
    const list = document.getElementById('typeahead-list');
    if (list && !list.classList.contains('hidden')) {
      const active = list.querySelector('.ta-item.active');
      if (active) {
        active.click();
        return;
      }
    }
    await doCheck(email);
  });

  if (new URLSearchParams(window.location.search).has('connected')) {
    await refreshAll();
  }
});