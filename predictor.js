const { db, matchOps, standingOps, h2hOps, teamOps } = require('./database');

// Parse form string (e.g., "WDLWW") into numeric score
function parseForm(formStr) {
  if (!formStr) return 50;
  let score = 50;
  const recent = formStr.slice(-5);
  for (const c of recent) {
    if (c === 'W') score += 10;
    else if (c === 'D') score += 3;
    else if (c === 'L') score -= 8;
  }
  return Math.max(10, Math.min(100, score));
}

// Calculate home/away advantage factor
function getHomeAdvantage() {
  return 8; // ~8% boost for home team
}

// Get team standing info
function getTeamStanding(teamId, leagueId, season = 2026) {
  const row = db.prepare(`
    SELECT * FROM standings WHERE team_id = ? AND league_id = ? AND season = ?
  `).get(teamId, leagueId, season);
  return row;
}

// Get team stats
function getTeamStats(teamId) {
  return teamOps.getById.get(teamId);
}

// Get H2H record
function getH2H(team1Id, team2Id) {
  const row = h2hOps.get.get(team1Id, team2Id, team2Id, team1Id);
  if (!row) return null;
  try {
    return JSON.parse(row.matches);
  } catch { return null; }
}

// Calculate pre-match probabilities
function calculatePreMatch(match) {
  const homeId = match.home_team_id;
  const awayId = match.away_team_id;
  const leagueId = match.league_id;

  // Base scores
  let homeScore = 50;
  let awayScore = 50;

  // Factor 1: Form (weight 0.30)
  const homeStats = getTeamStats(homeId);
  const awayStats = getTeamStats(awayId);

  const homeForm = parseForm(homeStats?.form);
  const awayForm = parseForm(awayStats?.form);

  homeScore += (homeForm - 50) * 0.30;
  awayScore += (awayForm - 50) * 0.30;

  // Factor 2: Home/Away form (weight 0.20)
  const homeHomeStrength = homeStats ? 
    (homeStats.wins_home * 3 + homeStats.draws_home) / Math.max(1, homeStats.wins_home + homeStats.draws_home + homeStats.losses_home) * 33 : 50;
  const awayAwayStrength = awayStats ? 
    (awayStats.wins_away * 3 + awayStats.draws_away) / Math.max(1, awayStats.wins_away + awayStats.draws_away + awayStats.losses_away) * 33 : 50;

  homeScore += (homeHomeStrength - 50) * 0.20;
  awayScore += (awayAwayStrength - 50) * 0.20;

  // Factor 3: League position (weight 0.15)
  const homeStanding = getTeamStanding(homeId, leagueId);
  const awayStanding = getTeamStanding(awayId, leagueId);

  if (homeStanding && awayStanding) {
    const totalTeams = db.prepare('SELECT COUNT(*) as c FROM standings WHERE league_id = ?').get(leagueId).c || 20;
    const homePosScore = (1 - (homeStanding.rank - 1) / totalTeams) * 100;
    const awayPosScore = (1 - (awayStanding.rank - 1) / totalTeams) * 100;
    homeScore += (homePosScore - 50) * 0.15;
    awayScore += (awayPosScore - 50) * 0.15;
  }

  // Factor 4: H2H (weight 0.15)
  const h2h = getH2H(homeId, awayId);
  if (h2h && h2h.length > 0) {
    let homeWins = 0, awayWins = 0, draws = 0;
    for (const m of h2h) {
      if (m.winner === 'home') homeWins++;
      else if (m.winner === 'away') awayWins++;
      else draws++;
    }
    const total = h2h.length;
    const h2hHomeAdvantage = (homeWins / total) * 100;
    const h2hAwayAdvantage = (awayWins / total) * 100;
    homeScore += (h2hHomeAdvantage - 50) * 0.15;
    awayScore += (h2hAwayAdvantage - 50) * 0.15;
  }

  // Factor 5: Goals scored/conceded (weight 0.20)
  if (homeStats && awayStats) {
    const homeAttack = Math.min(100, (parseFloat(homeStats.goals_for_home) + parseFloat(homeStats.goals_for_away)) / 2 * 25);
    const homeDefence = Math.min(100, (parseFloat(homeStats.goals_against_home) + parseFloat(homeStats.goals_against_away)) / 2 * 25);
    const awayAttack = Math.min(100, (parseFloat(awayStats.goals_for_home) + parseFloat(awayStats.goals_for_away)) / 2 * 25);
    const awayDefence = Math.min(100, (parseFloat(awayStats.goals_against_home) + parseFloat(awayStats.goals_against_away)) / 2 * 25);

    // Better attack = higher score, better defence = lower opponent score
    homeScore += (homeAttack - 50) * 0.10;
    homeScore -= (awayDefence - 50) * 0.10;
    awayScore += (awayAttack - 50) * 0.10;
    awayScore -= (homeDefence - 50) * 0.10;
  }

  // Home advantage
  homeScore += getHomeAdvantage();

  // Normalize to probabilities
  const total = homeScore + awayScore + 40; // 40 represents draw probability baseline
  let homeProb = (homeScore / total) * 100;
  let awayProb = (awayScore / total) * 100;
  let drawProb = 100 - homeProb - awayProb;

  // Ensure valid ranges
  drawProb = Math.max(5, Math.min(40, drawProb));
  const remainder = 100 - drawProb;
  const ratio = homeProb / (homeProb + awayProb);
  homeProb = remainder * ratio;
  awayProb = remainder * (1 - ratio);

  return {
    home: Math.round(homeProb),
    draw: Math.round(drawProb),
    away: Math.round(awayProb)
  };
}

// Calculate secondary markets
function calculateMarkets(match, preMatch) {
  const homeStats = getTeamStats(match.home_team_id);
  const awayStats = getTeamStats(match.away_team_id);

  let homeAttack = 1.2, awayAttack = 1.2;
  let homeDefence = 1.2, awayDefence = 1.2;

  if (homeStats) {
    homeAttack = (parseFloat(homeStats.goals_for_home) + parseFloat(homeStats.goals_for_away)) / 2 || 1.2;
    homeDefence = (parseFloat(homeStats.goals_against_home) + parseFloat(homeStats.goals_against_away)) / 2 || 1.2;
  }
  if (awayStats) {
    awayAttack = (parseFloat(awayStats.goals_for_home) + parseFloat(awayStats.goals_for_away)) / 2 || 1.2;
    awayDefence = (parseFloat(awayStats.goals_against_home) + parseFloat(awayStats.goals_against_away)) / 2 || 1.2;
  }

  // Expected goals
  const xgHome = homeAttack * awayDefence * 0.8;
  const xgAway = awayAttack * homeDefence * 0.8;
  const totalXg = xgHome + xgAway;

  // Poisson-based probability for over/under
  const over15 = Math.min(95, Math.round((1 - Math.exp(-totalXg * 0.7)) * 100));
  const over25 = Math.min(90, Math.round((1 - Math.exp(-totalXg * 0.45)) * 100));
  const over35 = Math.min(80, Math.round((1 - Math.exp(-totalXg * 0.25)) * 100));
  const under25 = Math.max(5, 100 - over25);

  // BTTS probability
  const btts = Math.min(90, Math.round((1 - Math.exp(-xgHome * 0.5)) * (1 - Math.exp(-xgAway * 0.5)) * 100));

  return {
    over_1_5: over15,
    over_2_5: over25,
    over_3_5: over35,
    under_2_5: under25,
    btts: btts,
    expected_goals: {
      home: parseFloat(xgHome.toFixed(2)),
      away: parseFloat(xgAway.toFixed(2)),
      total: parseFloat(totalXg.toFixed(2))
    }
  };
}

// Calculate live adjustments
function calculateLive(match, preMatch) {
  if (!['1H', 'HT', '2H', 'ET', 'LIVE'].includes(match.status_short)) {
    return preMatch;
  }

  const homeScore = match.home_score ?? 0;
  const awayScore = match.away_score ?? 0;
  const elapsed = match.elapsed || 0;

  let homeProb = preMatch.home;
  let drawProb = preMatch.draw;
  let awayProb = preMatch.away;

  // Goal impact
  const goalDiff = homeScore - awayScore;
  if (goalDiff > 0) {
    homeProb = Math.min(92, homeProb + goalDiff * 12);
    awayProb = Math.max(3, awayProb - goalDiff * 8);
  } else if (goalDiff < 0) {
    awayProb = Math.min(92, awayProb + Math.abs(goalDiff) * 12);
    homeProb = Math.max(3, homeProb - Math.abs(goalDiff) * 8);
  }

  // Time decay - as match progresses, draw probability increases if tied
  if (goalDiff === 0 && elapsed > 60) {
    const drawBoost = Math.min(20, (elapsed - 60) * 0.4);
    drawProb = Math.min(60, drawProb + drawBoost);
    const reduction = drawBoost / 2;
    homeProb = Math.max(15, homeProb - reduction);
    awayProb = Math.max(15, awayProb - reduction);
  }

  // Parse statistics if available
  let stats = null;
  try {
    stats = JSON.parse(match.statistics || '[]');
  } catch { stats = []; }

  if (stats && stats.length >= 2) {
    const homeStats = stats.find(s => s.team_id === match.home_team_id)?.stats || [];
    const awayStats = stats.find(s => s.team_id === match.away_team_id)?.stats || [];

    const getStat = (arr, type) => {
      const item = arr.find(s => s.type === type);
      return item ? parseInt(item.value) || 0 : 0;
    };

    const homePoss = getStat(homeStats, 'Ball Possession');
    const awayPoss = getStat(awayStats, 'Ball Possession');
    const homeShots = getStat(homeStats, 'Total Shots');
    const awayShots = getStat(awayStats, 'Total Shots');
    const homeSot = getStat(homeStats, 'Shots on Goal');
    const awaySot = getStat(awayStats, 'Shots on Goal');
    const homeCorners = getStat(homeStats, 'Corner Kicks');
    const awayCorners = getStat(awayStats, 'Corner Kicks');

    // Possession impact
    if (homePoss > 60) homeProb = Math.min(92, homeProb + 5);
    else if (awayPoss > 60) awayProb = Math.min(92, awayProb + 5);

    // Shots on target impact
    const sotDiff = homeSot - awaySot;
    if (sotDiff >= 3) homeProb = Math.min(92, homeProb + 4);
    else if (sotDiff <= -3) awayProb = Math.min(92, awayProb + 4);

    // Corners impact (momentum indicator)
    const cornerDiff = homeCorners - awayCorners;
    if (cornerDiff >= 3) homeProb = Math.min(92, homeProb + 2);
    else if (cornerDiff <= -3) awayProb = Math.min(92, awayProb + 2);
  }

  // Parse events for red cards
  try {
    const events = JSON.parse(match.events || '[]');
    let homeReds = 0, awayReds = 0;
    for (const e of events) {
      if (e.type === 'Card' && e.detail === 'Red Card') {
        if (e.team_id === match.home_team_id) homeReds++;
        else if (e.team_id === match.away_team_id) awayReds++;
      }
    }
    if (homeReds > awayReds) {
      homeProb = Math.max(5, homeProb - 20 * (homeReds - awayReds));
      awayProb = Math.min(92, awayProb + 15 * (homeReds - awayReds));
    }
    if (awayReds > homeReds) {
      awayProb = Math.max(5, awayProb - 20 * (awayReds - homeReds));
      homeProb = Math.min(92, homeProb + 15 * (awayReds - homeReds));
    }
  } catch {}

  // Normalize
  const total = homeProb + drawProb + awayProb;
  homeProb = Math.round((homeProb / total) * 100);
  drawProb = Math.round((drawProb / total) * 100);
  awayProb = 100 - homeProb - drawProb;

  return { home: homeProb, draw: drawProb, away: awayProb };
}

// Get confidence level
function getConfidence(prob) {
  if (prob >= 75) return { level: 'Strong', color: 'strong', emoji: '🟢' };
  if (prob >= 55) return { level: 'Moderate', color: 'moderate', emoji: '🟡' };
  return { level: 'Low', color: 'low', emoji: '🔴' };
}

// Calculate prediction factors for display
function calculateFactors(match) {
  const homeStats = getTeamStats(match.home_team_id);
  const awayStats = getTeamStats(match.away_team_id);
  const homeStanding = getTeamStanding(match.home_team_id, match.league_id);
  const awayStanding = getTeamStanding(match.away_team_id, match.league_id);
  const h2h = getH2H(match.home_team_id, match.away_team_id);

  const factors = {
    form: Math.round((parseForm(homeStats?.form) + parseForm(awayStats?.form)) / 2),
    attack: 50,
    defence: 50,
    h2h: 50,
    momentum: 50
  };

  if (homeStats && awayStats) {
    const homeAttack = Math.min(100, (parseFloat(homeStats.goals_for_home) + parseFloat(homeStats.goals_for_away)) / 2 * 25);
    const awayAttack = Math.min(100, (parseFloat(awayStats.goals_for_home) + parseFloat(awayStats.goals_for_away)) / 2 * 25);
    factors.attack = Math.round((homeAttack + awayAttack) / 2);

    const homeDef = Math.min(100, 100 - (parseFloat(homeStats.goals_against_home) + parseFloat(homeStats.goals_against_away)) / 2 * 15);
    const awayDef = Math.min(100, 100 - (parseFloat(awayStats.goals_against_home) + parseFloat(awayStats.goals_against_away)) / 2 * 15);
    factors.defence = Math.round((homeDef + awayDef) / 2);
  }

  if (h2h && h2h.length > 0) {
    let homeWins = 0;
    for (const m of h2h.slice(0, 5)) {
      if (m.winner === 'home') homeWins++;
    }
    factors.h2h = Math.round((homeWins / Math.min(5, h2h.length)) * 100);
  }

  // Live momentum
  if (['1H', 'HT', '2H', 'LIVE'].includes(match.status_short)) {
    const scoreDiff = (match.home_score || 0) - (match.away_score || 0);
    const elapsed = match.elapsed || 0;
    if (scoreDiff !== 0) {
      factors.momentum = Math.min(95, 50 + Math.abs(scoreDiff) * 15 + elapsed * 0.3);
    } else {
      factors.momentum = Math.min(80, 50 + elapsed * 0.4);
    }
  }

  return factors;
}

// Generate prediction history (movement)
function getPredictionHistory(match) {
  const history = [];
  try {
    const existing = JSON.parse(match.prediction_history || '[]');
    if (Array.isArray(existing)) history.push(...existing);
  } catch {}

  // Add current snapshot
  const now = new Date().toISOString();
  const current = {
    time: now,
    home: match.predictions ? JSON.parse(match.predictions).home : 33,
    draw: match.predictions ? JSON.parse(match.predictions).draw : 33,
    away: match.predictions ? JSON.parse(match.predictions).away : 33
  };

  // Keep last 20 entries
  history.push(current);
  if (history.length > 20) history.shift();

  return history;
}

// Main prediction function
function predictMatch(match) {
  const preMatch = calculatePreMatch(match);
  const live = calculateLive(match, preMatch);
  const markets = calculateMarkets(match, preMatch);
  const factors = calculateFactors(match);
  const history = getPredictionHistory(match);

  // Determine top pick
  const maxProb = Math.max(live.home, live.draw, live.away);
  const bestMarket = Object.entries(markets).filter(([k]) => k !== 'expected_goals').sort((a, b) => b[1] - a[1])[0];
  const isTopPick = maxProb >= 70 || (bestMarket && bestMarket[1] >= 80);

  // Confidence for best outcome
  const bestOutcome = live.home >= live.draw && live.home >= live.away ? 'home' : 
                      live.draw >= live.away ? 'draw' : 'away';
  const confidence = getConfidence(maxProb);

  const predictions = {
    home: live.home,
    draw: live.draw,
    away: live.away,
    best_outcome: bestOutcome,
    confidence: confidence,
    markets: markets,
    factors: factors,
    history: history,
    is_top_pick: isTopPick,
    top_pick_market: bestMarket ? { name: bestMarket[0], probability: bestMarket[1] } : null
  };

  return predictions;
}

// Run predictions for all uncached or live matches
function runPredictions() {
  const matches = db.prepare(`
    SELECT * FROM matches 
    WHERE date >= date('now', '-1 day') AND date <= date('now', '+3 days')
  `).all();

  const topPicks = [];

  for (const match of matches) {
    try {
      const preds = predictMatch(match);

      // Rank top picks
      let rank = null;
      if (preds.is_top_pick) {
        const score = Math.max(preds.home, preds.draw, preds.away, preds.top_pick_market?.probability || 0);
        topPicks.push({ api_id: match.api_id, score });
      }

      matchOps.updatePredictions.run({
        api_id: match.api_id,
        predictions: JSON.stringify({
          home: preds.home,
          draw: preds.draw,
          away: preds.away,
          markets: preds.markets,
          best_outcome: preds.best_outcome,
          top_pick_market: preds.top_pick_market
        }),
        confidence: JSON.stringify(preds.confidence),
        factors: JSON.stringify(preds.factors),
        history: JSON.stringify(preds.history),
        top_pick: preds.is_top_pick ? 1 : 0,
        rank: rank,
        featured: (match.league_id === 39 || match.league_id === 140 || match.league_id === 2) ? 1 : 0
      });
    } catch (err) {
      console.error('Prediction error for match', match.api_id, err.message);
    }
  }

  // Assign ranks to top picks
  topPicks.sort((a, b) => b.score - a.score);
  for (let i = 0; i < Math.min(5, topPicks.length); i++) {
    db.prepare('UPDATE matches SET top_pick_rank = ? WHERE api_id = ?').run(i + 1, topPicks[i].api_id);
  }

  console.log(`Predictions updated for ${matches.length} matches, ${topPicks.length} top picks`);
}

module.exports = {
  predictMatch,
  runPredictions,
  calculatePreMatch,
  calculateMarkets,
  calculateLive,
  getConfidence,
  calculateFactors
};
