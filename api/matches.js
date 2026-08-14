
const SPORTS = [
  ["soccer_epl", "Premier League"],
  ["soccer_spain_la_liga", "La Liga"],
  ["soccer_germany_bundesliga", "Bundesliga"],
  ["soccer_italy_serie_a", "Serie A"],
  ["soccer_france_ligue_one", "Ligue 1"],
  ["soccer_uefa_champs_league", "Champions League"],
  ["soccer_uefa_europa_league", "Europa League"],
  ["soccer_uefa_europa_conference_league", "Conference League"],
  ["soccer_netherlands_eredivisie", "Eredivisie"],
  ["soccer_portugal_primeira_liga", "Primeira Liga"],
  ["soccer_turkey_super_league", "Super Lig"]
];

function americanToDecimal(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function normalizeMarket(outcomes) {
  const rows = (outcomes || [])
    .map(o => ({ name: o.name, price: Number(o.price), point: o.point ?? null }))
    .filter(o => Number.isFinite(o.price) && o.price > 1);
  if (!rows.length) return [];
  const inv = rows.reduce((s, o) => s + 1 / o.price, 0);
  return rows.map(o => ({ ...o, impliedProbability: (1 / o.price) / inv }));
}

function simplifyMatch(m, leagueName) {
  const bookmakers = m.bookmakers || [];
  const markets = {};
  for (const b of bookmakers) {
    for (const market of (b.markets || [])) {
      if (!markets[market.key]) markets[market.key] = [];
      markets[market.key].push({
        bookmaker: b.title,
        outcomes: normalizeMarket(market.outcomes)
      });
    }
  }

  const h2h = [];
  for (const b of bookmakers) {
    const market = (b.markets || []).find(x => x.key === "h2h");
    if (!market) continue;
    for (const o of market.outcomes || []) {
      const dec = Number(o.price);
      if (dec > 1) h2h.push({ bookmaker: b.title, name: o.name, price: dec });
    }
  }

  const best = {};
  for (const o of h2h) {
    if (!best[o.name] || o.price > best[o.name].price) best[o.name] = o;
  }

  return {
    id: m.id,
    sportKey: m.sport_key,
    league: leagueName || m.sport_title,
    commenceTime: m.commence_time,
    homeTeam: m.home_team,
    awayTeam: m.away_team,
    bookmakersCount: bookmakers.length,
    markets: Object.keys(markets),
    bestH2H: Object.values(best),
    bookmakers: bookmakers.map(b => ({
      key: b.key,
      title: b.title,
      lastUpdate: b.last_update,
      markets: (b.markets || []).map(x => ({
        key: x.key,
        outcomes: normalizeMarket(x.outcomes)
      }))
    }))
  };
}

export default async function handler(req, res) {
  if (!process.env.ODDS_API_KEY) {
    return res.status(500).json({ ok: false, error: "ODDS_API_KEY is not configured in Vercel Environment Variables." });
  }

  const wanted = String(req.query?.leagues || "").split(",").map(s => s.trim()).filter(Boolean);
  const selected = wanted.length
    ? SPORTS.filter(([key]) => wanted.includes(key))
    : SPORTS;

  const regions = req.query?.regions || "eu";
  const markets = req.query?.markets || "h2h";
  const oddsFormat = req.query?.oddsFormat || "decimal";
  const days = Math.min(Math.max(Number(req.query?.days || 3), 1), 7);

  const results = [];
  const errors = [];

  for (const [sportKey, leagueName] of selected) {
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`);
    url.searchParams.set("apiKey", process.env.ODDS_API_KEY);
    url.searchParams.set("regions", regions);
    url.searchParams.set("markets", markets);
    url.searchParams.set("oddsFormat", oddsFormat);
    url.searchParams.set("dateFormat", "iso");

    try {
      const r = await fetch(url);
      const text = await r.text();
      if (!r.ok) {
        errors.push({ sportKey, status: r.status, message: text.slice(0, 300) });
        continue;
      }
      const data = JSON.parse(text);
      for (const m of data) {
        const ms = new Date(m.commence_time).getTime();
        if (Number.isFinite(ms) && ms <= Date.now() + days * 86400000) {
          results.push(simplifyMatch(m, leagueName));
        }
      }
    } catch (e) {
      errors.push({ sportKey, message: e.message });
    }
  }

  results.sort((a,b) => new Date(a.commenceTime) - new Date(b.commenceTime));
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
  res.status(200).json({
    ok: true,
    provider: "The Odds API",
    fetchedAt: new Date().toISOString(),
    count: results.length,
    matches: results,
    errors
  });
}
