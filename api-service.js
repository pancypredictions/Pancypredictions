const https = require('https');
const { matchOps, teamOps, standingOps, h2hOps, headlineOps, logApi } = require('./database');

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY || '';

// Major league IDs from API-Football
const MAJOR_LEAGUES = [
  39,   // Premier League
  140,  // La Liga
  135,  // Serie A
  78,   // Bundesliga
  61,   // Ligue 1
  2,    // Champions League
  3,    // Europa League
  94,   // Primeira Liga
  88,   // Eredivisie
  144,  // Jupiler Pro League
  179,  // Premiership (Scotland)
  253,  // MLS
  71,   // Serie A (Brazil)
  128,  // Liga MX
  307,  // Saudi Pro League
  262,  // Liga Argentina
];

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = https.get(url, { headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const time = Date.now() - start;
        resolve({ status: res.statusCode, data, time });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchApiFootball(endpoint, params = {}) {
  if (!API_FOOTBALL_KEY) return { error: 'No API-Football key configured' };

  const query = new URLSearchParams(params).toString();
  const url = `https://v3.football.api-sports.io/${endpoint}?${query}`;

  try {
    const res = await httpGet(url, {
      'x-rapidapi-key': API_FOOTBALL_KEY,
      'x-rapidapi-host': 'v3.football.api-sports.io'
    });

    logApi.run(url, 'api-football', res.status, res.time, res.status !== 200 ? res.data : null);

    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const json = JSON.parse(res.data);
    return json.response || [];
  } catch (err) {
    console.error('API-Football error:', err.message);
    return { error: err.message };
  }
}

async function fetchFootballData(endpoint) {
  if (!FOOTBALL_DATA_KEY) return { error: 'No football-data key' };

  const url = `https://api.football-data.org/v4/${endpoint}`;
  try {
    const res = await httpGet(url, { 'X-Auth-Token': FOOTBALL_DATA_KEY });
    logApi.run(url, 'football-data', res.status, res.time, res.status !== 200 ? res.data : null);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(res.data);
  } catch (err) {
    console.error('football-data error:', err.message);
    return { error: err.message };
  }
}

// Transform API-Football fixture to our format
function transformFixture(f) {
  const now = Math.floor(Date.now() / 1000);
  return {
    api_id: f.fixture.id,
    league_id: f.league.id,
    league_name: f.league.name,
    league_country: f.league.country,
    league_logo: f.league.logo || '',
    season: f.league.season,
    round: f.league.round || '',
    home_team_id: f.teams.home.id,
    home_team: f.teams.home.name,
    home_team_logo: f.teams.home.logo || '',
    away_team_id: f.teams.away.id,
    away_team: f.teams.away.name,
    away_team_logo: f.teams.away.logo || '',
    date: f.fixture.date?.split('T')[0] || '',
    time: f.fixture.date?.split('T')[1]?.substring(0, 5) || '',
    timestamp: new Date(f.fixture.date).getTime() / 1000,
    status: f.fixture.status?.long || '',
    status_short: f.fixture.status?.short || 'NS',
    elapsed: f.fixture.status?.elapsed || 0,
    venue: f.fixture.venue?.name || '',
    referee: f.fixture.referee || '',
    home_score: f.goals.home ?? null,
    away_score: f.goals.away ?? null,
    ht_home_score: f.score?.halftime?.home ?? null,
    ht_away_score: f.score?.halftime?.away ?? null,
    ft_home_score: f.score?.fulltime?.home ?? null,
    ft_away_score: f.score?.fulltime?.away ?? null,
    penalty_home: f.score?.penalty?.home ?? null,
    penalty_away: f.score?.penalty?.away ?? null,
    winner: f.teams.home.winner === true ? 'home' : f.teams.away.winner === true ? 'away' : 'draw',
    events: JSON.stringify(f.events || []),
    statistics: JSON.stringify(f.statistics || []),
    lineups: JSON.stringify(f.lineups || []),
    odds: JSON.stringify(f.odds || []),
    cached_at: now,
    updated_at: now
  };
}

// Fetch fixtures for a date (default today)
async function fetchFixtures(date = null) {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const results = [];
  const seen = new Set();

  // Try fetching all matches for the date in one request (saves API calls)
  const allData = await fetchApiFootball('fixtures', { 
    date: targetDate,
    timezone: 'Africa/Nairobi'
  });

  if (Array.isArray(allData) && allData.length > 0) {
    for (const f of allData) {
      const row = transformFixture(f);
      matchOps.upsert.run(row);
      seen.add(row.api_id);
      results.push(row);
    }
  } else {
    // Fallback: fetch major leagues individually
    for (const leagueId of MAJOR_LEAGUES.slice(0, 8)) {
      const data = await fetchApiFootball('fixtures', { 
        league: leagueId, 
        season: 2026, 
        date: targetDate,
        timezone: 'Africa/Nairobi'
      });
      if (Array.isArray(data)) {
        for (const f of data) {
          const row = transformFixture(f);
          if (!seen.has(row.api_id)) {
            matchOps.upsert.run(row);
            seen.add(row.api_id);
            results.push(row);
          }
        }
      }
    }
  }

  // Also fetch live matches regardless of date
  const liveData = await fetchApiFootball('fixtures', { live: 'all' });
  if (Array.isArray(liveData)) {
    for (const f of liveData) {
      const row = transformFixture(f);
      if (!seen.has(row.api_id)) {
        matchOps.upsert.run(row);
        results.push(row);
      }
    }
  }

  return results;
}

// Fetch live fixtures only
async function fetchLiveFixtures() {
  const data = await fetchApiFootball('fixtures', { live: 'all' });
  if (!Array.isArray(data)) return [];

  const results = [];
  for (const f of data) {
    const row = transformFixture(f);
    matchOps.upsert.run(row);
    results.push(row);
  }
  return results;
}

// Fetch match statistics
async function fetchMatchStats(fixtureId) {
  const data = await fetchApiFootball('fixtures/statistics', { fixture: fixtureId });
  if (Array.isArray(data) && data.length > 0) {
    const stats = data.map(s => ({
      team: s.team.name,
      team_id: s.team.id,
      stats: s.statistics
    }));
    matchOps.getById.get(fixtureId); // ensure exists
    // Update statistics column
    const db2 = require('./database').db;
    db2.prepare('UPDATE matches SET statistics = ?, updated_at = ? WHERE api_id = ?')
      .run(JSON.stringify(stats), Math.floor(Date.now()/1000), fixtureId);
    return stats;
  }
  return null;
}

// Fetch match events
async function fetchMatchEvents(fixtureId) {
  const data = await fetchApiFootball('fixtures/events', { fixture: fixtureId });
  if (Array.isArray(data)) {
    const events = data.map(e => ({
      time: e.time.elapsed + (e.time.extra || 0),
      team: e.team.name,
      team_id: e.team.id,
      player: e.player?.name || '',
      assist: e.assist?.name || '',
      type: e.type,
      detail: e.detail,
      comments: e.comments || ''
    }));
    const db2 = require('./database').db;
    db2.prepare('UPDATE matches SET events = ?, updated_at = ? WHERE api_id = ?')
      .run(JSON.stringify(events), Math.floor(Date.now()/1000), fixtureId);
    return events;
  }
  return null;
}

// Fetch standings for a league
async function fetchStandings(leagueId, season = 2026) {
  const data = await fetchApiFootball('standings', { league: leagueId, season });
  if (Array.isArray(data) && data[0]?.league?.standings) {
    const standings = data[0].league.standings[0];
    for (const s of standings) {
      standingOps.upsert.run({
        league_id: leagueId,
        season,
        team_id: s.team.id,
        rank: s.rank,
        points: s.points,
        goals_diff: s.goalsDiff,
        form: s.form || '',
        played: s.all.played,
        wins: s.all.win,
        draws: s.all.draw,
        losses: s.all.lose,
        goals_for: s.all.goals.for,
        goals_against: s.all.goals.against,
        cached_at: Math.floor(Date.now()/1000)
      });
    }
    return standings;
  }
  return null;
}

// Fetch H2H
async function fetchH2H(team1, team2) {
  const data = await fetchApiFootball('fixtures/headtohead', { h2h: `${team1}-${team2}` });
  if (Array.isArray(data)) {
    const matches = data.slice(0, 10).map(f => ({
      date: f.fixture.date,
      home: f.teams.home.name,
      away: f.teams.away.name,
      home_score: f.goals.home,
      away_score: f.goals.away,
      winner: f.teams.home.winner ? 'home' : f.teams.away.winner ? 'away' : 'draw'
    }));
    h2hOps.upsert.run({
      team1_id: team1,
      team2_id: team2,
      matches: JSON.stringify(matches),
      cached_at: Math.floor(Date.now()/1000)
    });
    return matches;
  }
  return null;
}

// Fetch team statistics (form, goals, etc.)
async function fetchTeamStats(teamId, leagueId, season = 2026) {
  const data = await fetchApiFootball('teams/statistics', { 
    team: teamId, 
    league: leagueId, 
    season 
  });
  if (data && !data.error) {
    const stats = Array.isArray(data) ? data[0] : data;
    if (stats) {
      teamOps.updateStats.run({
        api_id: teamId,
        form: stats.form || '',
        wins_home: stats.fixtures?.wins?.home || 0,
        wins_away: stats.fixtures?.wins?.away || 0,
        draws_home: stats.fixtures?.draws?.home || 0,
        draws_away: stats.fixtures?.draws?.away || 0,
        losses_home: stats.fixtures?.loses?.home || 0,
        losses_away: stats.fixtures?.loses?.away || 0,
        goals_for_home: stats.goals?.for?.average?.home || 0,
        goals_for_away: stats.goals?.for?.average?.away || 0,
        goals_against_home: stats.goals?.against?.average?.home || 0,
        goals_against_away: stats.goals?.against?.average?.away || 0,
        cached_at: Math.floor(Date.now()/1000)
      });
      return stats;
    }
  }
  return null;
}

// Mock headlines (no free reliable football news API without key)
// We'll generate from match context or use a simple feed
async function fetchHeadlines() {
  // In production, you could integrate a news API. For now, we'll generate
  // contextual headlines from the database matches
  const db2 = require('./database').db;
  const upcoming = db2.prepare(`
    SELECT home_team, away_team, league_name, date FROM matches 
    WHERE date >= date('now') AND date <= date('now', '+3 days') AND status_short = 'NS'
    ORDER BY RANDOM() LIMIT 5
  `).all();

  const headlines = upcoming.map(m => ({
    title: `${m.home_team} vs ${m.away_team} - ${m.league_name} Preview`,
    description: `Matchday approaching in ${m.league_name}. Check PANCY predictions.`,
    url: '#',
    image: '',
    source: 'PANCY Intelligence',
    published_at: m.date,
    category: 'Preview',
    cached_at: Math.floor(Date.now()/1000)
  }));

  // Clear old and insert new
  headlineOps.clearOld.run();
  for (const h of headlines) {
    headlineOps.upsert.run(h);
  }

  return headlines;
}

// Get all cached matches for a date
function getMatchesByDate(date) {
  return matchOps.getByDate.all(date);
}

function getLiveMatches() {
  return matchOps.getLive.all();
}

function getUpcomingMatches() {
  return matchOps.getUpcoming.all();
}

function getFinishedMatches() {
  return matchOps.getFinished.all();
}

function getMatchById(id) {
  return matchOps.getById.get(id);
}

function getTopPicks() {
  return matchOps.getTopPicks.all();
}

function searchMatches(term) {
  const like = `%${term}%`;
  return matchOps.search.all(like, like);
}

module.exports = {
  fetchFixtures,
  fetchLiveFixtures,
  fetchMatchStats,
  fetchMatchEvents,
  fetchStandings,
  fetchH2H,
  fetchTeamStats,
  fetchHeadlines,
  getMatchesByDate,
  getLiveMatches,
  getUpcomingMatches,
  getFinishedMatches,
  getMatchById,
  getTopPicks,
  searchMatches,
  MAJOR_LEAGUES
};
