// ===== PANCY Frontend =====
const API_BASE = '';
let authKey = localStorage.getItem('pancy_auth') || '';
let currentFilter = 'all';
let currentLeague = 'all';
let picks = JSON.parse(localStorage.getItem('pancy_picks') || '[]');
let liveInterval = null;

// ===== Utilities =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

function formatTime(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getStatusClass(status) {
  const map = { '1H': 'live', 'HT': 'ht', '2H': 'live', 'ET': 'live', 'P': 'live', 'LIVE': 'live', 'FT': 'ft', 'NS': 'upcoming', 'TBD': 'upcoming' };
  return map[status] || 'upcoming';
}

function getStatusLabel(status, elapsed) {
  if (status === '1H') return `🔴 LIVE ${elapsed}'`;
  if (status === 'HT') return '⏸ HT';
  if (status === '2H') return `🔴 LIVE ${elapsed}'`;
  if (status === 'ET') return `🔴 ET ${elapsed}'`;
  if (status === 'P') return '⏸ Pen';
  if (status === 'FT') return '✓ FT';
  if (status === 'NS') return 'Upcoming';
  return status;
}

function getConfidenceBadge(conf) {
  if (!conf) return '';
  return `<span class="confidence-badge ${conf.color}">${conf.emoji} ${conf.level}</span>`;
}

function showToast(msg, icon = '⚠️') {
  const toast = $('#toast');
  $('#toast-icon').textContent = icon;
  $('#toast-message').textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ===== API =====
async function api(endpoint, opts = {}) {
  const url = `${API_BASE}/api${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (authKey) headers['x-pancy-auth'] = authKey;

  try {
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      localStorage.removeItem('pancy_auth');
      authKey = '';
      showAuth();
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('API error:', err);
    showToast('Connection error', '⚠️');
    throw err;
  }
}

// ===== Auth =====
function showAuth() {
  $('#auth-overlay').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function hideAuth() {
  $('#auth-overlay').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

$('#auth-btn').addEventListener('click', async () => {
  const val = $('#auth-input').value.trim();
  if (!val) return;
  authKey = val;
  try {
    await api('/health');
    localStorage.setItem('pancy_auth', authKey);
    hideAuth();
    initApp();
  } catch {
    $('#auth-error').textContent = 'Invalid key';
    authKey = '';
  }
});

$('#auth-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') $('#auth-btn').click(); });

// ===== Theme =====
function initTheme() {
  const saved = localStorage.getItem('pancy_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('pancy_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  $('#theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}

$('#theme-toggle').addEventListener('click', toggleTheme);

// ===== Navigation =====
$$('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    loadMatches();
    updateViewVisibility();
  });
});

$$('.bottom-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    $$('.bottom-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (view === 'picks') { togglePicks(); }
    else if (view === 'live') {
      currentFilter = 'live';
      $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'live'));
      loadMatches();
    } else {
      currentFilter = 'all';
      $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
      loadMatches();
    }
    updateViewVisibility();
  });
});

function updateViewVisibility() {
  $('#live-section').classList.toggle('hidden', currentFilter !== 'live');
  $('#matches-section').classList.toggle('hidden', currentFilter === 'live');
  $('#matches-title').textContent = currentFilter === 'today' ? '📅 Today' : 
                                    currentFilter === 'upcoming' ? '📅 Upcoming' :
                                    currentFilter === 'finished' ? '📅 Results' : '📅 Matches';
}

// ===== Matches =====
async function loadMatches() {
  try {
    $('#empty-state').classList.add('hidden');
    $('#error-state').classList.add('hidden');

    const params = new URLSearchParams();
    params.set('filter', currentFilter);
    if (currentLeague !== 'all') params.set('league', currentLeague);

    const data = await api(`/matches?${params}`);
    const matches = data.matches || [];

    if (matches.length === 0) {
      $('#empty-state').classList.remove('hidden');
      $('#matches-grid').innerHTML = '';
      return;
    }

    const grid = currentFilter === 'live' ? $('#live-grid') : $('#matches-grid');
    grid.innerHTML = matches.map(m => renderMatchCard(m)).join('');

    // Add click handlers
    grid.querySelectorAll('.match-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.market-item') || e.target.closest('.details-toggle')) return;
        openMatchDetail(card.dataset.id);
      });
    });

    // Add market click handlers
    grid.querySelectorAll('.market-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        addPick(item.dataset.match, item.dataset.name, item.dataset.market, item.dataset.selection, item.dataset.prob);
      });
    });

    // Add toggle handlers
    grid.querySelectorAll('.details-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const details = btn.closest('.match-card').querySelector('.match-details');
        details.classList.toggle('hidden');
        btn.textContent = details.classList.contains('hidden') ? '⌄ Show Predictions' : '⌃ Hide Predictions';
      });
    });

  } catch (err) {
    $('#error-state').classList.remove('hidden');
    $('#error-time').textContent = new Date().toLocaleTimeString();
  }
}

function renderMatchCard(m) {
  const isLive = ['1H', 'HT', '2H', 'ET', 'P', 'LIVE'].includes(m.status_short);
  const isFeatured = m.featured === 1;
  const preds = m.predictions || { home: 33, draw: 33, away: 33 };
  const conf = m.confidence || { level: 'Low', color: 'low', emoji: '🔴' };
  const factors = m.factors || {};

  let eventsHtml = '';
  try {
    const events = JSON.parse(m.events || '[]');
    if (events.length > 0 && isLive) {
      eventsHtml = `<div class="live-timeline">${events.slice(-5).reverse().map(e => {
        const type = e.type === 'Goal' ? 'goal' : e.type === 'Card' ? (e.detail === 'Red Card' ? 'red' : 'card') : '';
        return `<div class="timeline-event ${type}"><span class="timeline-time">${e.time}'</span> ${e.detail} — ${e.player}</div>`;
      }).join('')}</div>`;
    }
  } catch {}

  let statsHtml = '';
  try {
    const stats = JSON.parse(m.statistics || '[]');
    if (stats.length >= 2 && isLive) {
      const homeStats = stats.find(s => s.team_id === m.home_team_id)?.stats || [];
      const awayStats = stats.find(s => s.team_id === m.away_team_id)?.stats || [];
      const getVal = (arr, type) => { const item = arr.find(s => s.type === type); return parseInt(item?.value) || 0; };
      const hp = getVal(homeStats, 'Ball Possession');
      const ap = getVal(awayStats, 'Ball Possession');
      const total = hp + ap || 100;
      statsHtml = `
        <div class="live-stats">
          <div class="live-stat-home">${hp}%</div>
          <div><div class="live-stat-label">Possession</div><div class="live-stat-bar"><div class="live-stat-bar-home" style="width:${hp/total*100}%"></div><div class="live-stat-bar-away" style="width:${ap/total*100}%"></div></div></div>
          <div class="live-stat-away">${ap}%</div>
        </div>`;
    }
  } catch {}

  const markets = m.predictions?.markets || {};
  const marketItems = [
    { key: 'over_1_5', name: 'Over 1.5', label: 'O1.5' },
    { key: 'over_2_5', name: 'Over 2.5', label: 'O2.5' },
    { key: 'over_3_5', name: 'Over 3.5', label: 'O3.5' },
    { key: 'under_2_5', name: 'Under 2.5', label: 'U2.5' },
    { key: 'btts', name: 'BTTS', label: 'GG' },
  ];

  const isPicked = (market, sel) => picks.some(p => p.match_api_id == m.api_id && p.market === market && p.selection === sel);

  return `
    <div class="match-card ${isFeatured ? 'featured' : ''}" data-id="${m.api_id}">
      <div class="match-header">
        <div class="match-league">
          ${m.league_logo ? `<img src="${m.league_logo}" alt="">` : ''}
          ${m.league_name}
        </div>
        <div class="match-status ${getStatusClass(m.status_short)}">
          ${getStatusLabel(m.status_short, m.elapsed)}
        </div>
      </div>
      <div class="match-body">
        <div class="match-team home">
          <img src="${m.home_team_logo || 'https://via.placeholder.com/40'}" class="match-team-logo" alt="">
          <div class="match-team-name">${m.home_team}</div>
        </div>
        <div class="match-score">
          <div class="match-score-value">
            ${m.home_score !== null ? m.home_score : '-'} <span class="match-score-divider">:</span> ${m.away_score !== null ? m.away_score : '-'}
          </div>
          <div class="match-time">${isLive ? m.elapsed + "'" : formatTime(m.timestamp)}</div>
        </div>
        <div class="match-team away">
          <img src="${m.away_team_logo || 'https://via.placeholder.com/40'}" class="match-team-logo" alt="">
          <div class="match-team-name">${m.away_team}</div>
        </div>
      </div>
      <div class="match-predictions">
        <div class="prediction-row">
          <span class="prediction-label">Home</span>
          <div class="prediction-bar-bg"><div class="prediction-bar-fill home" style="width:${preds.home}%"></div></div>
          <span class="prediction-value">${preds.home}%</span>
        </div>
        <div class="prediction-row">
          <span class="prediction-label">Draw</span>
          <div class="prediction-bar-bg"><div class="prediction-bar-fill draw" style="width:${preds.draw}%"></div></div>
          <span class="prediction-value">${preds.draw}%</span>
        </div>
        <div class="prediction-row">
          <span class="prediction-label">Away</span>
          <div class="prediction-bar-bg"><div class="prediction-bar-fill away" style="width:${preds.away}%"></div></div>
          <span class="prediction-value">${preds.away}%</span>
        </div>
        <div style="margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;justify-content:space-between;">
          ${getConfidenceBadge(conf)}
          <span style="font-size:0.7rem;color:var(--text-muted);">${formatDate(m.date)}</span>
        </div>
      </div>
      <div class="match-details hidden">
        ${statsHtml}
        ${eventsHtml}
        <div class="factors-grid">
          ${Object.entries(factors).map(([k, v]) => `
            <div class="factor-item">
              <div class="factor-name">${k}</div>
              <div class="factor-bar">
                <div class="factor-track"><div class="factor-fill" style="width:${v}%"></div></div>
                <span class="factor-value">${v}%</span>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="markets-grid">
          ${marketItems.map(mk => {
            const prob = markets[mk.key] || 0;
            const selected = isPicked(mk.name, mk.label) ? 'selected' : '';
            return `<div class="market-item ${selected}" data-match="${m.api_id}" data-name="${m.home_team} vs ${m.away_team}" data-market="${mk.name}" data-selection="${mk.label}" data-prob="${prob}">
              <div class="market-name">${mk.label}</div>
              <div class="market-prob">${prob}%</div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <button class="details-toggle">⌄ Show Predictions</button>
    </div>
  `;
}

// ===== Top Picks =====
async function loadTopPicks() {
  try {
    const data = await api('/top-picks');
    const picks = data.picks || [];
    const grid = $('#top-picks-grid');

    if (picks.length === 0) {
      grid.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;padding:1rem;">No strong picks available right now. Check back soon.</p>';
      return;
    }

    grid.innerHTML = picks.map((m, i) => {
      const preds = m.predictions || { home: 33, draw: 33, away: 33 };
      const best = preds.home >= preds.draw && preds.home >= preds.away ? 'Home' : 
                   preds.draw >= preds.away ? 'Draw' : 'Away';
      const prob = Math.max(preds.home, preds.draw, preds.away);
      return `
        <div class="top-pick-card" data-id="${m.api_id}">
          <div class="top-pick-rank">${i + 1}</div>
          <div class="top-pick-teams">${m.home_team}<br>vs<br>${m.away_team}</div>
          <div class="top-pick-market">${best} Win</div>
          <div class="top-pick-prob">${prob}%</div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.top-pick-card').forEach(card => {
      card.addEventListener('click', () => openMatchDetail(card.dataset.id));
    });
  } catch {
    $('#top-picks-grid').innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;padding:1rem;">Loading picks...</p>';
  }
}

// ===== Headlines =====
async function loadHeadlines() {
  try {
    const data = await api('/headlines');
    const list = $('#headlines-list');
    const headlines = data.headlines || [];

    if (headlines.length === 0) {
      list.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">No headlines available.</p>';
      return;
    }

    list.innerHTML = headlines.map(h => `
      <div class="headline-item">
        <span class="headline-icon">📰</span>
        <div class="headline-content">
          <div class="headline-title">${h.title}</div>
          <div class="headline-meta">${h.source} • ${formatDate(h.published_at)}</div>
        </div>
      </div>
    `).join('');
  } catch {}
}

// ===== Leagues =====
async function loadLeagues() {
  try {
    const data = await api('/leagues');
    const select = $('#league-filter');
    const leagues = data.leagues || [];

    leagues.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.league_name;
      opt.textContent = l.league_name;
      select.appendChild(opt);
    });
  } catch {}
}

$('#league-filter').addEventListener('change', (e) => {
  currentLeague = e.target.value;
  loadMatches();
});

// ===== Search =====
let searchTimeout;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const term = e.target.value.trim();
  if (!term) { currentFilter = 'all'; loadMatches(); return; }
  searchTimeout = setTimeout(async () => {
    try {
      const data = await api(`/matches?search=${encodeURIComponent(term)}`);
      $('#matches-grid').innerHTML = (data.matches || []).map(m => renderMatchCard(m)).join('');
    } catch {}
  }, 400);
});

// ===== Match Detail Modal =====
async function openMatchDetail(id) {
  try {
    const data = await api(`/matches/${id}`);
    const m = data.match;
    const preds = data.predictions;

    const modal = $('#match-modal');
    const detail = $('#match-detail');

    const isLive = ['1H', 'HT', '2H', 'ET', 'P', 'LIVE'].includes(m.status_short);

    detail.innerHTML = `
      <div class="match-detail-header">
        <div class="detail-teams">
          <div class="detail-team">
            <img src="${m.home_team_logo || ''}" alt="">
            <div class="detail-team-name">${m.home_team}</div>
          </div>
          <div>
            <div class="detail-vs">VS</div>
            <div class="detail-score">${m.home_score !== null ? m.home_score : '-'} : ${m.away_score !== null ? m.away_score : '-'}</div>
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.25rem;">${getStatusLabel(m.status_short, m.elapsed)}</div>
          </div>
          <div class="detail-team">
            <img src="${m.away_team_logo || ''}" alt="">
            <div class="detail-team-name">${m.away_team}</div>
          </div>
        </div>
        <div style="font-size:0.8rem;color:var(--text-secondary);">${m.league_name} • ${m.venue || ''} • ${formatDate(m.date)} ${formatTime(m.timestamp)}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Match Predictions</div>
        <div class="prediction-row">
          <span class="prediction-label">Home</span>
          <div class="prediction-bar-bg"><div class="prediction-bar-fill home" style="width:${preds.home}%"></div></div>
          <span class="prediction-value">${preds.home}%</span>
        </div>
        <div class="prediction-row">
          <span class="prediction-label">Draw</span>
          <div class="prediction-bar-bg"><div class="prediction-bar-fill draw" style="width:${preds.draw}%"></div></div>
          <span class="prediction-value">${preds.draw}%</span>
        </div>
        <div class="prediction-row">
          <span class="prediction-label">Away</span>
          <div class="prediction-bar-bg"><div class="prediction-bar-fill away" style="width:${preds.away}%"></div></div>
          <span class="prediction-value">${preds.away}%</span>
        </div>
        <div style="margin-top:0.75rem;">${getConfidenceBadge(preds.confidence)}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Prediction Factors</div>
        <div class="factors-grid">
          ${Object.entries(preds.factors || {}).map(([k, v]) => `
            <div class="factor-item">
              <div class="factor-name">${k}</div>
              <div class="factor-bar">
                <div class="factor-track"><div class="factor-fill" style="width:${v}%"></div></div>
                <span class="factor-value">${v}%</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${preds.history && preds.history.length > 1 ? `
        <div class="detail-section">
          <div class="detail-section-title">Prediction Movement</div>
          <div class="movement-chart">
            ${preds.history.map(h => `<div class="movement-bar" style="height:${Math.max(10, h.home)}%"></div>`).join('')}
          </div>
          <p style="font-size:0.7rem;color:var(--text-muted);text-align:center;">Home win probability over time</p>
        </div>
      ` : ''}

      <div class="detail-section">
        <div class="detail-section-title">Markets</div>
        <div class="markets-grid">
          ${Object.entries(preds.markets || {}).filter(([k]) => k !== 'expected_goals').map(([k, v]) => `
            <div class="market-item" onclick="app.addPickFromModal(${m.api_id}, '${m.home_team} vs ${m.away_team}', '${k}', '${k}', ${v})">
              <div class="market-name">${k.replace('_', ' ').toUpperCase()}</div>
              <div class="market-prob">${v}%</div>
            </div>
          `).join('')}
        </div>
      </div>

      ${data.h2h && data.h2h.length > 0 ? `
        <div class="detail-section">
          <div class="detail-section-title">Head to Head (Last ${data.h2h.length})</div>
          ${data.h2h.map(h => `
            <div style="padding:0.35rem 0;font-size:0.8rem;border-bottom:1px solid var(--border);">
              ${h.home} ${h.home_score} - ${h.away_score} ${h.away} <span style="color:var(--text-muted);float:right;">${h.date?.split('T')[0] || ''}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${data.standings && data.standings.length > 0 ? `
        <div class="detail-section">
          <div class="detail-section-title">League Standings</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;font-size:0.75rem;border-collapse:collapse;">
              <tr style="color:var(--text-secondary);text-align:left;">
                <th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>
              </tr>
              ${data.standings.slice(0, 10).map(s => `
                <tr style="border-top:1px solid var(--border);${s.team_id === m.home_team_id || s.team_id === m.away_team_id ? 'background:var(--accent-dim);font-weight:700;' : ''}">
                  <td>${s.rank}</td><td>${s.team_id === m.home_team_id ? '🏠 ' : s.team_id === m.away_team_id ? '✈️ ' : ''}${s.team_id}</td>
                  <td>${s.played}</td><td>${s.wins}</td><td>${s.draws}</td><td>${s.losses}</td><td>${s.goals_diff}</td><td>${s.points}</td>
                </tr>
              `).join('')}
            </table>
          </div>
        </div>
      ` : ''}
    `;

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    showToast('Failed to load match details', '⚠️');
  }
}

$('.modal-backdrop').addEventListener('click', closeModal);
$('.modal-close').addEventListener('click', closeModal);

function closeModal() {
  $('#match-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ===== Picks =====
function addPick(matchId, matchName, market, selection, prob) {
  const existing = picks.findIndex(p => p.match_api_id == matchId && p.market === market);
  if (existing >= 0) {
    picks.splice(existing, 1);
  } else {
    picks.push({ match_api_id: matchId, match_name: matchName, market, selection, odds: 0, confidence: prob + '%' });
  }
  savePicks();
  renderPicks();
  loadMatches(); // Re-render to update selected state
  showToast(existing >= 0 ? 'Removed from picks' : 'Added to picks', existing >= 0 ? '🗑️' : '✅');
}

function addPickFromModal(matchId, matchName, market, selection, prob) {
  addPick(matchId, matchName, market, selection, prob);
}

function savePicks() {
  localStorage.setItem('pancy_picks', JSON.stringify(picks));
}

function renderPicks() {
  const list = $('#picks-list');
  const count = picks.length;

  $('#picks-count').textContent = `${count} selection${count !== 1 ? 's' : ''}`;
  $('#picks-badge').textContent = count;
  $('#picks-badge').classList.toggle('hidden', count === 0);
  $('#fab-badge').textContent = count;
  $('#fab-badge').classList.toggle('hidden', count === 0);

  if (count === 0) {
    list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:2rem 0;font-size:0.85rem;">No picks yet. Tap on match markets to add.</p>';
    return;
  }

  list.innerHTML = picks.map((p, i) => `
    <div class="pick-item">
      <div class="pick-info">
        <div class="pick-match">${p.match_name}</div>
        <div class="pick-selection">${p.market} — ${p.selection} ${p.confidence ? '(' + p.confidence + ')' : ''}</div>
      </div>
      <button class="pick-remove" onclick="app.removePick(${i})">✕</button>
    </div>
  `).join('');
}

function removePick(index) {
  picks.splice(index, 1);
  savePicks();
  renderPicks();
  loadMatches();
}

function togglePicks() {
  $('#picks-panel').classList.toggle('hidden');
}

$('#picks-close').addEventListener('click', togglePicks);
$('#fab-picks').addEventListener('click', togglePicks);
$('#picks-clear').addEventListener('click', () => {
  picks = [];
  savePicks();
  renderPicks();
  loadMatches();
  showToast('All picks cleared', '🗑️');
});

// ===== Refresh =====
$('#refresh-btn').addEventListener('click', async () => {
  $('#refresh-btn').style.animation = 'spin 1s linear';
  try {
    await api('/refresh', { method: 'POST', body: JSON.stringify({ type: 'live' }) });
    await loadMatches();
    await loadTopPicks();
    $('#last-updated').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    showToast('Data refreshed', '✅');
  } catch {
    showToast('Refresh failed', '⚠️');
  }
  setTimeout(() => $('#refresh-btn').style.animation = '', 1000);
});

// ===== Live Polling =====
function startLivePolling() {
  if (liveInterval) clearInterval(liveInterval);
  liveInterval = setInterval(async () => {
    if (currentFilter === 'live' || currentFilter === 'all') {
      try {
        await loadMatches();
        $('#last-updated').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      } catch {}
    }
  }, 60000); // Every minute
}

// ===== Init =====
async function initApp() {
  initTheme();
  renderPicks();
  await loadLeagues();
  await loadTopPicks();
  await loadHeadlines();
  await loadMatches();
  startLivePolling();
  $('#last-updated').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// Check auth on load
(async () => {
  if (authKey) {
    try {
      await api('/health');
      hideAuth();
      initApp();
    } catch {
      showAuth();
    }
  } else {
    showAuth();
  }
})();

// Expose for inline handlers
window.app = { addPickFromModal, removePick, loadMatches, togglePicks };
