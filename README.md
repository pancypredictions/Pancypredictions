# ⚽ PANCY — Football Prediction Intelligence

A personal football prediction and analytics platform. Fetches live match data, calculates statistical predictions, and presents them in a clean, betting-inspired interface.

## Features

- **Live Match Tracking** — Real-time scores, stats, and events
- **Statistical Predictions** — Home/Draw/Away, Over/Under, BTTS probabilities
- **Top Picks** — Auto-ranked strongest predictions of the day
- **Prediction Factors** — Form, attack, defence, H2H, live momentum
- **Prediction Movement** — Track how probabilities shift during matches
- **My Picks** — Personal selection slip
- **Dark/Light Mode** — Theme preference persists
- **Mobile-First** — Works perfectly on phone, tablet, and desktop
- **Zero Cost** — Built on free API tiers with aggressive caching

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (file-based, zero config)
- **Frontend:** Vanilla HTML/CSS/JS (single-page app)
- **Data:** API-Football (primary) + football-data.org (backup)
- **Hosting:** Railway (free tier compatible)

## Setup

### 1. Get API Keys (Free)

**API-Football** (primary source — 100 requests/day free)
1. Go to [https://www.api-football.com/](https://www.api-football.com/)
2. Sign up and get your API key from the dashboard

**football-data.org** (backup — 10 requests/minute free)
1. Go to [https://www.football-data.org/](https://www.football-data.org/)
2. Register and get your free API token

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
API_FOOTBALL_KEY=your_api_football_key_here
FOOTBALL_DATA_KEY=your_football_data_key_here

# Optional: set a password to keep PANCY private
PANCY_PASSWORD=your_secret_password

PORT=3000
NODE_ENV=production
```

### 3. Install & Run

```bash
npm install
npm start
```

PANCY will be available at `http://localhost:3000`

If you set `PANCY_PASSWORD`, you'll be asked for it on first visit. It will be remembered for 30 days.

## Deploy to Railway

### Option A: One-Click (Recommended)

1. Push this project to a GitHub repository
2. Go to [https://railway.app/](https://railway.app/)
3. Click **New Project** → **Deploy from GitHub repo**
4. Select your PANCY repo
5. Add environment variables in Railway dashboard:
   - `API_FOOTBALL_KEY`
   - `FOOTBALL_DATA_KEY`
   - `PANCY_PASSWORD` (optional)
   - `NODE_ENV=production`
6. Railway will auto-deploy. Your URL will be something like `https://pancy.up.railway.app`

### Option B: Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway add --database sqlite  # or use Railway's managed Postgres if you prefer
railway up
```

## How It Works

### Data Flow
1. Server fetches fixtures from API-Football every 6 hours
2. Live matches are polled every 15 minutes
3. Standings and team stats refresh daily at 2 AM
4. All data is cached in SQLite to stay within free API limits

### Prediction Engine
Pre-match probabilities are calculated from:
- **Form** (last 5 matches) — weight 30%
- **Home/Away strength** — weight 20%
- **League position** — weight 15%
- **Head-to-head record** — weight 15%
- **Goals scored/conceded** — weight 20%

Live adjustments:
- Goals scored (+/- 12% per goal)
- Red cards (-20% to carded team)
- Possession, shots on target, corners
- Time decay (draw probability rises late in tied matches)

### Markets
- Home / Draw / Away
- Over 1.5 / Over 2.5 / Over 3.5
- Under 2.5
- Both Teams To Score (BTTS/GG)

## Project Structure

```
pancy/
├── server.js          # Express server + cron jobs
├── database.js        # SQLite schema and queries
├── api-service.js     # API-Football + football-data.org clients
├── predictor.js       # Statistical prediction engine
├── package.json
├── .env.example
├── .gitignore
└── public/
    ├── index.html     # Main SPA shell
    ├── style.css      # All styles (dark/light themes)
    └── app.js         # Frontend logic
```

## API Rate Limits (Free Tiers)

| Source | Limit | PANCY Usage |
|--------|-------|-------------|
| API-Football | 100/day | ~80-90/day with caching |
| football-data.org | 10/min | Fallback only |

With one user, you will never hit these limits.

## Important Notes

- **Predictions are statistical estimates, not guarantees.** PANCY uses team form, historical data, and live match state to calculate probabilities. It does not predict winners with certainty.
- **No real betting integration.** "My Picks" is a personal tracking list only. PANCY does not connect to Betika or any betting platform.
- **Data accuracy** depends on the upstream APIs. Occasionally there may be delays in live data.

## Troubleshooting

**"No API-Football key" warning**
→ Add your key to `.env` or Railway environment variables

**Empty match list**
→ Click the refresh button (🔄) or wait for the next scheduled fetch

**Predictions showing 33%/33%/33%**
→ Team stats haven't been fetched yet. They populate after the first standings refresh (daily at 2 AM or manually via refresh).

**Slow loading**
→ First load builds the SQLite cache. Subsequent loads are instant.

## License

MIT — Personal use only.
