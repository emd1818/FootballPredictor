import { redisGetJSON, redisSetJSON } from "./redis.js";

const BASE = "https://v3.football.api-sports.io";

// API-Football free tier allows only ~10 requests/minute. Space every call
// out by this much to stay safely under that, regardless of call site.
const MIN_GAP_MS = 6500;
let lastCallAt = 0;

async function throttle() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function apiFootball(path, params) {
  await throttle();
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

function sanitize(s) {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Capped to at most 2 variants to keep worst-case API calls per team low.
function nameVariants(name) {
  const trimmed = sanitize(name);
  const variants = [trimmed];
  const noAffix = sanitize(trimmed.replace(CLUB_AFFIXES, ""));
  if (noAffix && noAffix !== trimmed && noAffix.length >= 3) variants.push(noAffix);
  return variants.filter(v => v && v.length >= 3);
}

export async function findTeamId(name) {
  const cacheKey = `teamid:${name.toLowerCase().trim()}`;
  const cached = await redisGetJSON(cacheKey).catch(() => null);
  if (cached) return cached.id;

  let lastError = null;
  for (const variant of nameVariants(name)) {
    let teams;
    try {
      teams = await apiFootball("/teams", { search: variant });
    } catch (e) {
      lastError = e.message;
      continue;
    }
    if (!teams.length) continue;
    const exact = teams.find(t => (t.team?.name || "").toLowerCase() === variant.toLowerCase());
    const id = exact ? exact.team.id : (variant.length >= 4 ? teams[0].team?.id : null);
    if (id) {
      await redisSetJSON(cacheKey, { id }, 60 * 60 * 24 * 90).catch(() => {});
      return id;
    }
  }
  if (lastError) {
    const err = new Error(`No match for "${name}" — last API error: ${lastError}`);
    throw err;
  }
  return null;
}

// Single-season lookup only, to keep this to one API call per team.
export async function recentFixtures(teamId) {
  const season = new Date().getUTCFullYear();
  const all = await apiFootball("/fixtures", { team: teamId, season, status: "FT" }).catch(() => []);
  all.sort((a, b) => new Date(b.fixture?.date) - new Date(a.fixture?.date));
  return all.slice(0, 5);
}

export async function recentH2H(homeId, awayId) {
  const all = await apiFootball("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, status: "FT" }).catch(() => []);
  all.sort((a, b) => new Date(b.fixture?.date) - new Date(a.fixture?.date));
  return all.slice(0, 5);
}

function formScore(fixtures, teamId) {
  if (!fixtures.length) return { ppg: 1, gdAvg: 0, goalsForAvg: 1, played: 0 };
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
    goalsForAvg: played ? gf / played : 1,
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
  return { home: home / sum, draw: draw / sum, away: away / sum };
}

function bttsProbability(homeForm, awayForm) {
  const pHomeScores = 1 - Math.exp(-Math.max(homeForm.goalsForAvg, 0.15));
  const pAwayScores = 1 - Math.exp(-Math.max(awayForm.goalsForAvg, 0.15));
  return pHomeScores * pAwayScores;
}

export async function predictMatch(homeTeam, awayTeam, bookOdds) {
  const homeId = await findTeamId(homeTeam);
  const awayId = await findTeamId(awayTeam);
  if (!homeId || !awayId) {
    throw new Error(`Could not resolve team IDs (home=${homeId}, away=${awayId})`);
  }

  const homeFixtures = await recentFixtures(homeId);
  const awayFixtures = await recentFixtures(awayId);
  const h2hFixtures = await recentH2H(homeId, awayId);

  const homeForm = formScore(homeFixtures, homeId);
  const awayForm = formScore(awayFixtures, awayId);
  const h2h = h2hScore(h2hFixtures, homeId, awayId);
  const model = buildProbabilities(homeForm, awayForm, h2h);
  const btts = bttsProbability(homeForm, awayForm);

  const doubleChance = {
    homeOrDraw: model.home + model.draw,
    awayOrDraw: model.away + model.draw,
    homeOrAway: model.home + model.away
  };

  let market = null;
  let value = null;
  if (bookOdds && bookOdds.home > 1 && bookOdds.draw > 1 && bookOdds.away > 1) {
    const inv = { home: 1 / bookOdds.home, draw: 1 / bookOdds.draw, away: 1 / bookOdds.away };
    const invSum = inv.home + inv.draw + inv.away;
    market = { home: inv.home / invSum, draw: inv.draw / invSum, away: inv.away / invSum };

    const diffs = { home: model.home - market.home, draw: model.draw - market.draw, away: model.away - market.away };
    const [bestSide, bestDiff] = Object.entries(diffs).sort((a, b) => b[1] - a[1])[0];
    if (bestDiff >= 0.05) value = { side: bestSide, edge: bestDiff };
  }

  const confidence = Math.max(model.home, model.draw, model.away);
  const sampleSize = Math.min(homeFixtures.length, awayFixtures.length);

  return {
    homeId, awayId, homeForm, awayForm, h2h,
    model, btts, doubleChance, market, value,
    confidence, sampleSize
  };
}
