const URL_BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function cmd(args) {
  if (!URL_BASE || !TOKEN) {
    throw new Error("Redis is not configured (KV_REST_API_URL / KV_REST_API_TOKEN missing).");
  }
  const r = await fetch(URL_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  const data = await r.json();
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

export async function redisGetJSON(key) {
  const raw = await cmd(["GET", key]);
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function redisSetJSON(key, value, ttlSeconds) {
  const raw = JSON.stringify(value);
  if (ttlSeconds) {
    return cmd(["SET", key, raw, "EX", String(ttlSeconds)]);
  }
  return cmd(["SET", key, raw]);
}

export async function redisDel(key) {
  return cmd(["DEL", key]);
}
