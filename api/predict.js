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

async function findTeamId(name) {
  const teams = await apiFootball("/teams", { search: name });
  if (!teams.length) return null;
  const exact = teams.find(t => (t.team?.name || "").toLowerCase() === name.toLowerCase());
  return (exact || teams[0]).team?.id || null;
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
  const HOME_ADVANTAGE = 0.35;
  const homeStrength = homeForm.ppg + homeForm.gdAvg * 0.2 + HOME_ADVANTAGE;
  const awayStrength = awayForm.ppg + awayForm.gdAvg * 0.2;

  const total = homeStrength + awayStrength;
  let homeBase = total > 0 ? homeStrength / total : 0.5;
  let awayBase = total > 0 ? awayStrength / total : 0.5;

  const gap = Math.abs(homeBase - awayBase);
  const drawBase = Math.max(0.16, 0.30 - gap * 0.4);

  let home = homeBase * (1 - drawBase);
  let away = awayBase * (1 - drawBase);
  let draw = drawBase;

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
      apiFootball("/fixtures", { team: homeId, last: 5 }),
      apiFootball("/fixtures", { team: awayId, last: 5 }),
      apiFootball("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 5 })
    ]);

    const homeForm = formScore(homeFixtures, homeId);
    const awayForm = formScore(awayFixtures, awayId);
    const h2h = h2hScore(h2hFixtures, homeId, awayId);

    const model = buildProbabilities(homeForm, awayForm, h2h);

    let market = null;
    let value = null;
    if (bookOdds.home > 1 && bookOdds.draw > 1 && bookOdds.away > 1) {
      const inv = { home: 1 / bookOdds.home, draw: 1 / bookOdds.draw, away: 1 / bookOdds.away };
      const invSum = inv.home + inv.draw + inv.away;
      market = { home: inv.home / invSum, draw: inv.draw / invSum, away: inv.away / invSum };

      const THRESHOLD = 0.05;
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
