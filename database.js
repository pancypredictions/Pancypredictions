const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'pancy.db'));
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY,
    api_id INTEGER UNIQUE,
    league_id INTEGER,
    league_name TEXT,
    league_country TEXT,
    league_logo TEXT,
    season INTEGER,
    round TEXT,
    home_team_id INTEGER,
    home_team TEXT,
    home_team_logo TEXT,
    away_team_id INTEGER,
    away_team TEXT,
    away_team_logo TEXT,
    date TEXT,
    time TEXT,
    timestamp INTEGER,
    status TEXT,
    status_short TEXT,
    elapsed INTEGER,
    venue TEXT,
    referee TEXT,
    home_score INTEGER,
    away_score INTEGER,
    ht_home_score INTEGER,
    ht_away_score INTEGER,
    ft_home_score INTEGER,
    ft_away_score INTEGER,
    penalty_home INTEGER,
    penalty_away INTEGER,
    winner TEXT,
    events TEXT,
    statistics TEXT,
    lineups TEXT,
    odds TEXT,
    predictions TEXT,
    prediction_confidence TEXT,
    prediction_factors TEXT,
    prediction_history TEXT,
    featured INTEGER DEFAULT 0,
    top_pick INTEGER DEFAULT 0,
    top_pick_rank INTEGER,
    cached_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    api_id INTEGER UNIQUE,
    name TEXT,
    logo TEXT,
    country TEXT,
    founded INTEGER,
    venue_name TEXT,
    venue_capacity INTEGER,
    form TEXT,
    wins_home INTEGER,
    wins_away INTEGER,
    draws_home INTEGER,
    draws_away INTEGER,
    losses_home INTEGER,
    losses_away INTEGER,
    goals_for_home INTEGER,
    goals_for_away INTEGER,
    goals_against_home INTEGER,
    goals_against_away INTEGER,
    cached_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS standings (
    id INTEGER PRIMARY KEY,
    league_id INTEGER,
    season INTEGER,
    team_id INTEGER,
    rank INTEGER,
    points INTEGER,
    goals_diff INTEGER,
    form TEXT,
    played INTEGER,
    wins INTEGER,
    draws INTEGER,
    losses INTEGER,
    goals_for INTEGER,
    goals_against INTEGER,
    cached_at INTEGER,
    UNIQUE(league_id, season, team_id)
  );

  CREATE TABLE IF NOT EXISTS h2h (
    id INTEGER PRIMARY KEY,
    team1_id INTEGER,
    team2_id INTEGER,
    matches TEXT,
    cached_at INTEGER,
    UNIQUE(team1_id, team2_id)
  );

  CREATE TABLE IF NOT EXISTS headlines (
    id INTEGER PRIMARY KEY,
    title TEXT,
    description TEXT,
    url TEXT,
    image TEXT,
    source TEXT,
    published_at TEXT,
    category TEXT,
    cached_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS picks (
    id INTEGER PRIMARY KEY,
    match_api_id INTEGER,
    match_name TEXT,
    market TEXT,
    selection TEXT,
    odds REAL,
    confidence TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS api_logs (
    id INTEGER PRIMARY KEY,
    endpoint TEXT,
    source TEXT,
    status INTEGER,
    response_time INTEGER,
    error TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status_short);
  CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league_id);
  CREATE INDEX IF NOT EXISTS idx_matches_top_pick ON matches(top_pick);
  CREATE INDEX IF NOT EXISTS idx_standings_league ON standings(league_id, season);
`);

// Match operations
const matchOps = {
  upsert: db.prepare(`
    INSERT INTO matches (
      api_id, league_id, league_name, league_country, league_logo, season, round,
      home_team_id, home_team, home_team_logo, away_team_id, away_team, away_team_logo,
      date, time, timestamp, status, status_short, elapsed, venue, referee,
      home_score, away_score, ht_home_score, ht_away_score,
      ft_home_score, ft_away_score, penalty_home, penalty_away, winner,
      events, statistics, lineups, odds, cached_at, updated_at
    ) VALUES (
      @api_id, @league_id, @league_name, @league_country, @league_logo, @season, @round,
      @home_team_id, @home_team, @home_team_logo, @away_team_id, @away_team, @away_team_logo,
      @date, @time, @timestamp, @status, @status_short, @elapsed, @venue, @referee,
      @home_score, @away_score, @ht_home_score, @ht_away_score,
      @ft_home_score, @ft_away_score, @penalty_home, @penalty_away, @winner,
      @events, @statistics, @lineups, @odds, @cached_at, @updated_at
    )
    ON CONFLICT(api_id) DO UPDATE SET
      status=@status, status_short=@status_short, elapsed=@elapsed,
      home_score=@home_score, away_score=@away_score,
      ht_home_score=@ht_home_score, ht_away_score=@ht_away_score,
      ft_home_score=@ft_home_score, ft_away_score=@ft_away_score,
      penalty_home=@penalty_home, penalty_away=@penalty_away,
      winner=@winner, events=@events, statistics=@statistics,
      lineups=@lineups, odds=@odds, updated_at=@updated_at
  `),

  getByDate: db.prepare(`
    SELECT * FROM matches WHERE date = ? ORDER BY timestamp ASC
  `),

  getLive: db.prepare(`
    SELECT * FROM matches 
    WHERE status_short IN ('1H', 'HT', '2H', 'ET', 'P', 'LIVE') 
    ORDER BY elapsed DESC
  `),

  getUpcoming: db.prepare(`
    SELECT * FROM matches 
    WHERE status_short IN ('NS', 'TBD') AND date >= date('now')
    ORDER BY timestamp ASC LIMIT 50
  `),

  getFinished: db.prepare(`
    SELECT * FROM matches 
    WHERE status_short = 'FT' AND date >= date('now', '-2 days')
    ORDER BY timestamp DESC LIMIT 50
  `),

  getById: db.prepare('SELECT * FROM matches WHERE api_id = ?'),

  getTopPicks: db.prepare(`
    SELECT * FROM matches 
    WHERE top_pick = 1 AND date >= date('now', '-1 day')
    ORDER BY top_pick_rank ASC LIMIT 5
  `),

  updatePredictions: db.prepare(`
    UPDATE matches SET 
      predictions=@predictions, 
      prediction_confidence=@confidence,
      prediction_factors=@factors,
      prediction_history=@history,
      top_pick=@top_pick,
      top_pick_rank=@rank,
      featured=@featured
    WHERE api_id=@api_id
  `),

  search: db.prepare(`
    SELECT * FROM matches 
    WHERE (home_team LIKE ? OR away_team LIKE ?) AND date >= date('now', '-7 days')
    ORDER BY date DESC LIMIT 20
  `),

  getAllDates: db.prepare(`
    SELECT DISTINCT date FROM matches 
    WHERE date >= date('now', '-1 day') AND date <= date('now', '+7 days')
    ORDER BY date
  `)
};

// Team operations
const teamOps = {
  upsert: db.prepare(`
    INSERT INTO teams (api_id, name, logo, country, founded, venue_name, venue_capacity, cached_at)
    VALUES (@api_id, @name, @logo, @country, @founded, @venue_name, @venue_capacity, @cached_at)
    ON CONFLICT(api_id) DO UPDATE SET
      name=@name, logo=@logo, country=@country, founded=@founded,
      venue_name=@venue_name, venue_capacity=@venue_capacity, cached_at=@cached_at
  `),
  getById: db.prepare('SELECT * FROM teams WHERE api_id = ?'),
  updateStats: db.prepare(`
    UPDATE teams SET 
      form=@form, wins_home=@wins_home, wins_away=@wins_away,
      draws_home=@draws_home, draws_away=@draws_away,
      losses_home=@losses_home, losses_away=@losses_away,
      goals_for_home=@goals_for_home, goals_for_away=@goals_for_away,
      goals_against_home=@goals_against_home, goals_against_away=@goals_against_away,
      cached_at=@cached_at
    WHERE api_id=@api_id
  `)
};

// Standings operations
const standingOps = {
  upsert: db.prepare(`
    INSERT INTO standings (league_id, season, team_id, rank, points, goals_diff, form, played, wins, draws, losses, goals_for, goals_against, cached_at)
    VALUES (@league_id, @season, @team_id, @rank, @points, @goals_diff, @form, @played, @wins, @draws, @losses, @goals_for, @goals_against, @cached_at)
    ON CONFLICT(league_id, season, team_id) DO UPDATE SET
      rank=@rank, points=@points, goals_diff=@goals_diff, form=@form,
      played=@played, wins=@wins, draws=@draws, losses=@losses,
      goals_for=@goals_for, goals_against=@goals_against, cached_at=@cached_at
  `),
  getByLeague: db.prepare('SELECT * FROM standings WHERE league_id = ? AND season = ? ORDER BY rank')
};

// H2H operations
const h2hOps = {
  upsert: db.prepare(`
    INSERT INTO h2h (team1_id, team2_id, matches, cached_at)
    VALUES (@team1_id, @team2_id, @matches, @cached_at)
    ON CONFLICT(team1_id, team2_id) DO UPDATE SET
      matches=@matches, cached_at=@cached_at
  `),
  get: db.prepare('SELECT * FROM h2h WHERE (team1_id = ? AND team2_id = ?) OR (team1_id = ? AND team2_id = ?)')
};

// Picks operations
const pickOps = {
  add: db.prepare(`
    INSERT INTO picks (match_api_id, match_name, market, selection, odds, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getAll: db.prepare('SELECT * FROM picks ORDER BY created_at DESC'),
  delete: db.prepare('DELETE FROM picks WHERE id = ?'),
  clear: db.prepare('DELETE FROM picks'),
  count: db.prepare('SELECT COUNT(*) as count FROM picks')
};

// Headlines operations
const headlineOps = {
  upsert: db.prepare(`
    INSERT INTO headlines (title, description, url, image, source, published_at, category, cached_at)
    VALUES (@title, @description, @url, @image, @source, @published_at, @category, @cached_at)
  `),
  getRecent: db.prepare('SELECT * FROM headlines ORDER BY cached_at DESC LIMIT 20'),
  clearOld: db.prepare("DELETE FROM headlines WHERE cached_at < strftime('%s', 'now', '-7 days')")
};

// API log
const logApi = db.prepare(`
  INSERT INTO api_logs (endpoint, source, status, response_time, error)
  VALUES (?, ?, ?, ?, ?)
`);

module.exports = {
  db,
  matchOps,
  teamOps,
  standingOps,
  h2hOps,
  pickOps,
  headlineOps,
  logApi
};
