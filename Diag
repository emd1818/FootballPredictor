import { redisGetJSON } from "../lib/redis.js";

const BASE = "https://v3.football.api-sports.io";

async function af(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { httpStatus: r.status, errors: text.slice(0, 200), response: null };
  }
  return { httpStatus: r.status, errors: data.errors, response: data.response };
}

export default async function handler(req, res) {
  const out = { serverTime: new Date().toISOString() };

  if (!process.env.API_FOOTBALL_KEY) {
    out.apiFootballKey = "MISSING";
    return res.status(200).json(out);
  }

  // 1) Account / plan / requests left today
  try {
    const s = await af("/status", {});
    const r = s.response;
    out.account = r && r.subscription
      ? { plan: r.subscription.plan, active: r.subscription.active, requests: r.requests }
      : s;
  } catch (e) {
    out.account = { error: e.message };
  }

  // 2) Can we read finished fixtures for recent seasons? (team 33 = a top Premier League club)
  out.seasonAccess = {};
  for (const season of [2026, 2025, 2024]) {
    try {
      const f = await af("/fixtures", { team: 33, season, status: "FT" });
      out.seasonAccess[season] = {
        httpStatus: f.httpStatus,
        finishedFixtures: Array.isArray(f.response) ? f.response.length : null,
        errors: f.errors
      };
    } catch (e) {
      out.seasonAccess[season] = { error: e.message };
    }
  }

  // 3) State of the Redis pipeline
  try {
    const q = await redisGetJSON("queue:state");
    const p = await redisGetJSON("picks:today");
    const pending = await redisGetJSON("history:pending");
    const stats = await redisGetJSON("stats:summary");
    out.pipeline = {
      queueDate: q?.date ?? null,
      remainingInPool: q?.remaining?.length ?? null,
      scoredToday: q?.scored?.length ?? null,
      picksPublished: p?.picks?.length ?? 0,
      picksGeneratedAt: p?.generatedAt ?? null,
      pendingResults: Array.isArray(pending) ? pending.length : 0,
      stats: stats ?? null
    };
  } catch (e) {
    out.pipeline = { error: e.message };
  }

  res.status(200).json(out);
}
