const BASE = "https://v3.football.api-sports.io";

async function apiFootball(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const r = await fetch(url, {
    headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY }
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`API-Football ${path} failed: ${r.status} ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(text);
  if (data.errors && Object.keys(data.errors).length) {
    throw new Error(`API-Football ${path} error: ${JSON.stringify(data.errors)}`);
  }
  return data.response || [];
}

const CLUB_AFFIXES = /\b(FC|CF|SC|AFC|AC|CD|SK|SV|AS|US|RC|CA|EC|IF|BK|IK|VV)\b/gi;

function nameVariants(name) {
  const variants = new Set();
  const sanitize = s => s.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const trimmed = sanitize(name);
  if (trimmed) variants.add(trimmed);

  const noAffix = sanitize(trimmed.replace(CLUB_AFFIXES, ""));
  if (noAffix && noAffix !== trimmed) variants.add(noAffix);

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    variants.add(words[words.length - 1]); // last word (e.g. "Telstar" from "SC Telstar")
    variants.add(words[0]); // first word
  }

  return [...variants].filter(Boolean);
}

function currentSeasonYears() {
  const now = new Date();
  const y = now.getUTCFullYear();
  // European season naming: season "2025" covers Aug 2025–May 2026, etc.
  // Fetch both the current-labelled season and the previous one to make sure
  // we have finished matches even right after a new season starts.
  return [y, y - 1];
}

async function recentFixtures(teamId) {
  const seasons = currentSeasonYears();
  const batches = await Promise.all(
    seasons.map(season =>
      apiFootball("/fixtures", { team: teamId, season, status: "FT" }).catch(() => [])
    )
  );
  const all = batches.flat();
  all.sort((a, b) => new Date(b.fixture?.date) - new Date(a.fixture?.date));
  return all.slice(0, 5);
}

async function recentH2H(homeId, awayId) {
  const all = await apiFootball("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, status: "FT" }).catch(() => []);
  all.sort((a, b) => new Date(b.fixture?.date) - new Date(a.fixture?.date));
  return all.slice(0, 5);
}

async function findTeamId(name) {
  for (const variant of nameVariants(name)) {
    const teams = await apiFootball("/teams", { search: variant });
    if (!teams.length) continue;
    const exact = teams.find(t => (t.team?.name || "").toLowerCase() === variant.toLowerCase());
    if (exact) return exact.team.id;
    // fall back to first result only if the variant is reasonably specific (not a 1-3 letter fragment)
    if (variant.length >= 4) return teams[0].team?.id || null;
  }
  return null;
}

function formScore(fixtures, teamId) {
  if (!fixtures.length) return { ppg: 1, gdAvg: 0, played: 0 };
  let points = 0, gf = 0, ga = 0, played = 0;
  for (const f of fixtures) {
    const home = f.teams?.home?.id === teamId;
    const goalsFor = home ? f.goals?.home : f.goals?.away;
    const goalsAgainst = home ? f.goals?.away : f.goals?.home;
    if (goalsFor === null || goalsFor === undefined) continue;
    played++;
    gf += goalsFor;
    ga += goalsAgainst;
    const won = home ? f.teams?.home?.winner : f.teams?.away?.winner;
    if (won === true) points += 3;
    else if (won === null) points += 1;
  }
  return {
    ppg: played ? points / played : 1,
    gdAvg: played ? (gf - ga) / played : 0,
    played
  };
}

function h2hScore(fixtures, homeId, awayId) {
  if (!fixtures.length) return { homeWinRate: 1 / 3, drawRate: 1 / 3, awayWinRate: 1 / 3, played: 0 };
  let homeWins = 0, draws = 0, awayWins = 0, played = 0;
  for (const f of fixtures) {
    if (f.goals?.home === null || f.goals?.home === undefined) continue;
    played++;
    const homeIsHomeTeam = f.teams?.home?.id === homeId;
    const homeGoals = homeIsHomeTeam ? f.goals.home : f.goals.away;
    const awayGoals = homeIsHomeTeam ? f.goals.away : f.goals.home;
    if (homeGoals > awayGoals) homeWins++;
    else if (homeGoals < awayGoals) awayWins++;
    else draws++;
  }
  if (!played) return { homeWinRate: 1 / 3, drawRate: 1 / 3, awayWinRate: 1 / 3, played: 0 };
  return { homeWinRate: homeWins / played, drawRate: draws / played, awayWinRate: awayWins / played, played };
}

function buildProbabilities(homeForm, awayForm, h2h) {
  // Strength: points-per-game (0-3) plus small goal-difference adjustment, home advantage bonus
  const HOME_ADVANTAGE = 0.35;
  const homeStrength = homeForm.ppg + homeForm.gdAvg * 0.2 + HOME_ADVANTAGE;
  const awayStrength = awayForm.ppg + awayForm.gdAvg * 0.2;

  const total = homeStrength + awayStrength;
  let homeBase = total > 0 ? homeStrength / total : 0.5;
  let awayBase = total > 0 ? awayStrength / total : 0.5;

  // Draw likelihood shrinks as the strength gap grows
  const gap = Math.abs(homeBase - awayBase);
  const drawBase = Math.max(0.16, 0.30 - gap * 0.4);

  let home = homeBase * (1 - drawBase);
  let away = awayBase * (1 - drawBase);
  let draw = drawBase;

  // Blend in head-to-head history at 25% weight (only if we have real H2H data)
  if (h2h.played > 0) {
    const w = 0.25;
    home = home * (1 - w) + h2h.homeWinRate * w;
    draw = draw * (1 - w) + h2h.drawRate * w;
    away = away * (1 - w) + h2h.awayWinRate * w;
  }

  const sum = home + draw + away;
  return {
    home: home / sum,
    draw: draw / sum,
    away: away / sum
  };
}

export default async function handler(req, res) {
  if (!process.env.API_FOOTBALL_KEY) {
    return res.status(500).json({ ok: false, error: "API_FOOTBALL_KEY is not configured in Vercel Environment Variables." });
  }

  const home = String(req.query?.home || "").trim();
  const away = String(req.query?.away || "").trim();
  const bookOdds = {
    home: Number(req.query?.homeOdds),
    draw: Number(req.query?.drawOdds),
    away: Number(req.query?.awayOdds)
  };

  if (!home || !away) {
    return res.status(400).json({ ok: false, error: "Query params 'home' and 'away' are required." });
  }

  try {
    const [homeId, awayId] = await Promise.all([findTeamId(home), findTeamId(away)]);
    if (!homeId || !awayId) {
      return res.status(404).json({ ok: false, error: `Could not resolve team IDs (home=${homeId}, away=${awayId}). API-Football team names may differ from bookmaker names.` });
    }

    const [homeFixtures, awayFixtures, h2hFixtures] = await Promise.all([
      recentFixtures(homeId),
      recentFixtures(awayId),
      recentH2H(homeId, awayId)
    ]);

    const homeForm = formScore(homeFixtures, homeId);
    const awayForm = formScore(awayFixtures, awayId);
    const h2h = h2hScore(h2hFixtures, homeId, awayId);

    const model = buildProbabilities(homeForm, awayForm, h2h);

    // Normalize bookmaker prices into implied probabilities for a fair comparison
    let market = null;
    let value = null;
    if (bookOdds.home > 1 && bookOdds.draw > 1 && bookOdds.away > 1) {
      const inv = { home: 1 / bookOdds.home, draw: 1 / bookOdds.draw, away: 1 / bookOdds.away };
      const invSum = inv.home + inv.draw + inv.away;
      market = { home: inv.home / invSum, draw: inv.draw / invSum, away: inv.away / invSum };

      const THRESHOLD = 0.05; // 5 percentage points
      const diffs = {
        home: model.home - market.home,
        draw: model.draw - market.draw,
        away: model.away - market.away
      };
      const [bestSide, bestDiff] = Object.entries(diffs).sort((a, b) => b[1] - a[1])[0];
      if (bestDiff >= THRESHOLD) {
        value = { side: bestSide, edge: bestDiff };
      }
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    res.status(200).json({
      ok: true,
      home: { name: home, teamId: homeId, form: homeForm, sampleSize: homeFixtures.length },
      away: { name: away, teamId: awayId, form: awayForm, sampleSize: awayFixtures.length },
      h2h: { ...h2h },
      model,
      market,
      value
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}
