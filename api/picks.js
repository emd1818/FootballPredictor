import { redisGetJSON } from "../lib/redis.js";

export default async function handler(req, res) {
  try {
    const [picks, stats] = await Promise.all([
      redisGetJSON("picks:today"),
      redisGetJSON("stats:summary")
    ]);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    res.status(200).json({
      ok: true,
      picks: picks?.picks || [],
      generatedAt: picks?.generatedAt || null,
      stats: stats || { totalChecked: 0, signCorrect: 0, dcCorrect: 0, bttsCorrect: 0 }
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
}
