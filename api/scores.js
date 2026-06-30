// Vercel serverless function — fetch WC2026 scores from ESPN (double-check via summary)
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const FINISHED_STATUSES = ['STATUS_FULL_TIME','STATUS_END_PERIOD','STATUS_FINAL_PEN','STATUS_FINAL_AET','STATUS_FINAL'];

async function fetchSummary(eventId) {
  try {
    const r = await fetch(`${ESPN_BASE}/summary?event=${eventId}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    const comps = d?.header?.competitions?.[0]?.competitors || [];
    const h = comps.find(c => c.homeAway === 'home');
    const a = comps.find(c => c.homeAway === 'away');
    if (!h || !a) return null;
    return {
      homeScore: parseInt(h.score, 10),
      awayScore: parseInt(a.score, 10),
      homeWinner: h.winner === true,
      awayWinner: a.winner === true,
    };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    const url = `${ESPN_BASE}/scoreboard?dates=20260611-20260719&limit=200`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`ESPN scoreboard ${r.status}`);
    const data = await r.json();

    // Identifier les matchs éliminatoires terminés pour double-check
    // (les matchs de groupes ne sont plus nécessaires)
    const KO_ROUND_NAMES = ['Round of 32','Round of 16','Quarterfinals','Semifinals','Third Place','Final'];
    const finished_ko_events = [];

    for (const event of data.events || []) {
      const comp = (event.competitions || [])[0];
      if (!comp) continue;
      const statusType = comp.status?.type?.name || '';
      if (!FINISHED_STATUSES.includes(statusType)) continue;
      // Vérifier si c'est un match éliminatoire
      const roundName = event.season?.slug || event.seasonType?.name || comp.type?.abbreviation || '';
      const isKO = KO_ROUND_NAMES.some(n => (event.name||'').includes(n))
                || comp.type?.id > 2
                || !event.name?.match(/Group/i) && statusType !== 'STATUS_FULL_TIME' // TAB = forcément KO
                || true; // on double-checke tout par sécurité
      if (isKO) finished_ko_events.push({ event, comp, statusType });
    }

    // Double-check en parallèle via summary endpoint
    const summaries = await Promise.all(
      finished_ko_events.map(({ event }) => fetchSummary(event.id))
    );

    const results = [];
    for (let i = 0; i < finished_ko_events.length; i++) {
      const { event, comp, statusType } = finished_ko_events[i];
      const summary = summaries[i];
      const competitors = comp.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      // Scores : on préfère le summary (plus fiable) sinon scoreboard
      const homeScore = summary?.homeScore ?? parseInt(home.score, 10);
      const awayScore = summary?.awayScore ?? parseInt(away.score, 10);

      // Vainqueur TAB : summary fait autorité (scoreboard parfois null)
      const isPen = statusType === 'STATUS_FINAL_PEN';
      let penWinner = null;
      if (isPen) {
        if (summary) {
          penWinner = summary.homeWinner ? 'home' : summary.awayWinner ? 'away' : null;
        } else {
          penWinner = home.winner === true ? 'home' : away.winner === true ? 'away' : null;
        }
      }

      // Vérification croisée : log si divergence
      const boardHome = parseInt(home.score, 10);
      const boardAway = parseInt(away.score, 10);
      const mismatch = summary && (summary.homeScore !== boardHome || summary.awayScore !== boardAway);

      results.push({
        date: event.date,
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeScore,
        awayScore,
        penWinner,
        finished: true,
        status: statusType,
        verified: !!summary && !mismatch,
        mismatch: mismatch ? { scoreboard: `${boardHome}-${boardAway}`, summary: `${summary.homeScore}-${summary.awayScore}` } : undefined,
      });
    }

    res.json({ ok: true, matches: results, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
