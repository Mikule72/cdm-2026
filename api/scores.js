// Vercel serverless function — fetch WC2026 scores from ESPN public API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200';
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) throw new Error(`ESPN API ${r.status}`);
    const data = await r.json();

    const results = [];
    for (const event of data.events || []) {
      const comp = (event.competitions || [])[0];
      if (!comp) continue;
      const competitors = comp.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      const statusType = comp.status?.type?.name || '';
      const finished = ['STATUS_FULL_TIME','STATUS_END_PERIOD','STATUS_FINAL_PEN','STATUS_FINAL_AET','STATUS_FINAL'].includes(statusType);
      const isPen = statusType === 'STATUS_FINAL_PEN';
      let penWinner = null;
      if (isPen) {
        if (home.winner === true) penWinner = 'home';
        else if (away.winner === true) penWinner = 'away';
      }
      results.push({
        date: event.date,
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore: finished ? parseInt(home.score, 10) : null,
        awayScore: finished ? parseInt(away.score, 10) : null,
        penWinner,
        finished,
        status: statusType,
      });
    }

    res.json({ ok: true, matches: results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
