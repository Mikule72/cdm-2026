// ESPN WC2026 — scores éliminatoires uniquement (groupes terminés)
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const FINISHED = ['STATUS_FULL_TIME','STATUS_END_PERIOD','STATUS_FINAL_PEN','STATUS_FINAL_AET','STATUS_FINAL'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    // 1. Scoreboard — tous les matchs de la compétition
    const r = await fetch(`${ESPN_BASE}/scoreboard?dates=20260628-20260719&limit=100`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const data = await r.json();

    const results = [];

    for (const event of data.events || []) {
      const comp = (event.competitions || [])[0];
      if (!comp) continue;
      const statusType = comp.status?.type?.name || '';
      if (!FINISHED.includes(statusType)) continue;

      const competitors = comp.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeScore = parseInt(home.score, 10);
      const awayScore = parseInt(away.score, 10);

      // Tirs au but : double-check via summary pour être sûr du vainqueur
      let penWinner = null;
      if (statusType === 'STATUS_FINAL_PEN') {
        // Source 1 : scoreboard
        let hw = home.winner === true;
        let aw = away.winner === true;

        // Source 2 : summary (cross-validation)
        try {
          const s = await fetch(`${ESPN_BASE}/summary?event=${event.id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (s.ok) {
            const sd = await s.json();
            const sc = sd?.header?.competitions?.[0]?.competitors || [];
            const sh = sc.find(c => c.homeAway === 'home');
            const sa = sc.find(c => c.homeAway === 'away');
            if (sh && sa) { hw = sh.winner === true; aw = sa.winner === true; }
          }
        } catch {}

        penWinner = hw ? 'home' : aw ? 'away' : null;
      }

      results.push({
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore,
        awayScore,
        penWinner,
        finished: true,
        status: statusType,
      });
    }

    res.json({ ok: true, matches: results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
