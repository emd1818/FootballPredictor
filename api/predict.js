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
