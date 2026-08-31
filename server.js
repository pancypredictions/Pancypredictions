require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const cron = require('node-cron');

const { db, pickOps } = require('./database');
const {
  fetchFixtures, fetchLiveFixtures, fetchMatchStats, fetchMatchEvents,
  fetchStandings, fetchH2H, fetchTeamStats, fetchHeadlines,
  getMatchesByDate, getLiveMatches, getUpcomingMatches, getFinishedMatches,
  getMatchById, getTopPicks, searchMatches
} = require('./api-service');
const { predictMatch, runPredictions } = require('./predictor');

const app = express();
const PORT = process.env.PORT || 3000;
const PANCY_PASSWORD = process.env.PANCY_PASSWORD || '';

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple auth middleware
function checkAuth(req, res, next) {
  if (!PANCY_PASSWORD) return next();
  const auth = req.headers['x-pancy-auth'] || req.query.key;
  if (auth === PANCY_PASSWORD) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Health check
app.get('/api/health', (req, res) => {
  const stats = db.prepare('SELECT COUNT(*) as matches FROM matches').get();
  const live = db.prepare("SELECT COUNT(*) as live FROM matches WHERE status_short IN ('1H','HT','2H','LIVE')").get();
  res.json({ status: 'ok', matches: stats.matches, live: live.live, timestamp: new Date().toISOString() });
});

// Get matches by filter
app.get('/api/matches', checkAuth, async (req, res) => {
  try {
    const { filter, date, league, search } = req.query;
    let matches = [];

    if (search) {
      matches = searchMatches(search);
    } else if (filter === 'live') {
      matches = getLiveMatches();
    } else if (filter === 'today') {
      const today = new Date().toISOString().split('T')[0];
      matches = getMatchesByDate(today);
    } else if (filter === 'upcoming') {
      matches = getUpcomingMatches();
    } else if (filter === 'finished') {
      matches = getFinishedMatches();
    } else if (date) {
      matches = getMatchesByDate(date);
    } else {
      // Default: today + live
      const today = new Date().toISOString().split('T')[0];
      const todayMatches = getMatchesByDate(today);
      const liveMatches = getLiveMatches();
      const ids = new Set(liveMatches.map(m => m.api_id));
      matches = [...liveMatches, ...todayMatches.filter(m => !ids.has(m.api_id))];
    }

    // League filter
    if (league && league !== 'all') {
      matches = matches.filter(m => m.league_name?.toLowerCase().includes(league.toLowerCase()));
    }

    // Enrich with predictions
    const enriched = matches.map(m => {
      try {
        const preds = m.predictions ? JSON.parse(m.predictions) : null;
        const conf = m.prediction_confidence ? JSON.parse(m.prediction_confidence) : null;
        const factors = m.prediction_factors ? JSON.parse(m.prediction_factors) : null;
        const history = m.prediction_history ? JSON.parse(m.prediction_history) : [];
        return { ...m, predictions: preds, confidence: conf, factors, history };
      } catch {
        return m;
      }
    });

    res.json({ count: enriched.length, matches: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// Get single match with details
app.get('/api/matches/:id', checkAuth, async (req, res) => {
  try {
    const match = getMatchById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // Fetch fresh stats and events if live
    if (['1H', 'HT', '2H', 'LIVE'].includes(match.status_short)) {
      await fetchMatchStats(match.api_id);
      await fetchMatchEvents(match.api_id);
    }

    // Re-fetch from DB after updates
    const fresh = getMatchById(req.params.id);

    // Get predictions
    const preds = predictMatch(fresh);

    // Get standings
    const standings = db.prepare('SELECT * FROM standings WHERE league_id = ? ORDER BY rank')
      .all(fresh.league_id);

    // Get H2H
    const h2h = db.prepare(`
      SELECT * FROM h2h WHERE (team1_id = ? AND team2_id = ?) OR (team1_id = ? AND team2_id = ?)
    `).get(fresh.home_team_id, fresh.away_team_id, fresh.away_team_id, fresh.home_team_id);

    res.json({
      match: fresh,
      predictions: preds,
      standings,
      h2h: h2h ? JSON.parse(h2h.matches) : []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get top picks
app.get('/api/top-picks', checkAuth, (req, res) => {
  try {
    const picks = getTopPicks();
    const enriched = picks.map(m => {
      try {
        const preds = m.predictions ? JSON.parse(m.predictions) : null;
        const conf = m.prediction_confidence ? JSON.parse(m.prediction_confidence) : null;
        return { ...m, predictions: preds, confidence: conf };
      } catch { return m; }
    });
    res.json({ count: enriched.length, picks: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get headlines
app.get('/api/headlines', checkAuth, async (req, res) => {
  try {
    const { headlineOps } = require('./database');
    let headlines = headlineOps.getRecent.all();
    if (headlines.length === 0) {
      headlines = await fetchHeadlines();
    }
    res.json({ headlines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get leagues list
app.get('/api/leagues', checkAuth, (req, res) => {
  const leagues = db.prepare(`
    SELECT DISTINCT league_id, league_name, league_country, league_logo 
    FROM matches WHERE date >= date('now', '-7 days')
    ORDER BY league_name
  `).all();
  res.json({ leagues });
});

// Picks (bet slip)
app.get('/api/picks', checkAuth, (req, res) => {
  res.json({ picks: pickOps.getAll.all() });
});

app.post('/api/picks', checkAuth, (req, res) => {
  const { match_api_id, match_name, market, selection, odds, confidence } = req.body;
  pickOps.add.run(match_api_id, match_name, market, selection, odds || 0, confidence || '');
  res.json({ success: true });
});

app.delete('/api/picks/:id', checkAuth, (req, res) => {
  pickOps.delete.run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/picks', checkAuth, (req, res) => {
  pickOps.clear.run();
  res.json({ success: true });
});

// Refresh data manually
app.post('/api/refresh', checkAuth, async (req, res) => {
  try {
    const { type } = req.body;
    if (type === 'live') {
      await fetchLiveFixtures();
    } else {
      await fetchFixtures();
    }
    runPredictions();
    res.json({ success: true, message: 'Data refreshed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get API status
app.get('/api/status', checkAuth, (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM api_logs ORDER BY created_at DESC LIMIT 20
  `).all();
  const hasKey = !!process.env.API_FOOTBALL_KEY;
  res.json({ api_football_configured: hasKey, recent_logs: logs });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Scheduled tasks
cron.schedule('*/15 * * * *', async () => {
  console.log('[CRON] Fetching live fixtures...');
  try {
    await fetchLiveFixtures();
    runPredictions();
  } catch (err) {
    console.error('[CRON] Error:', err.message);
  }
});

cron.schedule('0 */6 * * *', async () => {
  console.log('[CRON] Fetching daily fixtures...');
  try {
    await fetchFixtures();
    await fetchHeadlines();
    runPredictions();
  } catch (err) {
    console.error('[CRON] Error:', err.message);
  }
});

cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] Fetching standings and team stats...');
  try {
    const { MAJOR_LEAGUES } = require('./api-service');
    for (const leagueId of MAJOR_LEAGUES.slice(0, 8)) {
      await fetchStandings(leagueId);
      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error('[CRON] Standings error:', err.message);
  }
});

// Initial data load
async function init() {
  console.log('🚀 PANCY starting...');
  console.log('📡 API-Football configured:', !!process.env.API_FOOTBALL_KEY);
  console.log('🔒 Password protection:', PANCY_PASSWORD ? 'ON' : 'OFF');

  if (process.env.API_FOOTBALL_KEY) {
    try {
      await fetchFixtures();
      runPredictions();
      console.log('✅ Initial data loaded');
    } catch (err) {
      console.error('⚠️ Initial fetch failed:', err.message);
    }
  } else {
    console.log('⚠️ No API-Football key. Add API_FOOTBALL_KEY to .env');
  }
}

app.listen(PORT, () => {
  console.log(`🎯 PANCY running on port ${PORT}`);
  init();
});

module.exports = app;
