'use strict';
/**
 * Persönliche Erfolge (Abzeichen, Erfahrungspunkte, Level) – werden aus den
 * vorhandenen Daten berechnet, es wird nichts zusätzlich gespeichert.
 * Bewusst ohne Ranglisten/Vergleiche zwischen Mitarbeitern.
 */

const LEVELS = [
  { xp: 0, title: 'Neuling' },
  { xp: 50, title: 'Lagerhelfer' },
  { xp: 150, title: 'Zählprofi' },
  { xp: 350, title: 'Bestandsmeister' },
  { xp: 700, title: 'Einkaufs-Ass' },
  { xp: 1200, title: 'Lager-Legende' },
  { xp: 2000, title: 'Inventur-Großmeister' },
];

const BADGES = [
  { key: 'first_count', icon: '🎯', title: 'Erste Zählung', desc: 'Eine Bestandszählung fertiggestellt', stat: 'counts_finished', goal: 1 },
  { key: 'counted_50', icon: '📦', title: 'Lager-Kenner', desc: '50 Artikel gezählt', stat: 'articles_counted', goal: 50 },
  { key: 'counted_250', icon: '🏅', title: 'Lager-Profi', desc: '250 Artikel gezählt', stat: 'articles_counted', goal: 250 },
  { key: 'counted_1000', icon: '🏆', title: 'Inventur-Legende', desc: '1000 Artikel gezählt', stat: 'articles_counted', goal: 1000 },
  { key: 'perfect', icon: '💯', title: 'Vollständig', desc: 'Eine Zählung ohne übersprungene Artikel abgeschlossen', stat: 'perfect_counts', goal: 1 },
  { key: 'perfect_5', icon: '💎', title: 'Perfektionist', desc: '5 vollständige Zählungen', stat: 'perfect_counts', goal: 5 },
  { key: 'lists_10', icon: '🛒', title: 'Einkaufsplaner', desc: '10 Einkaufslisten fertiggestellt', stat: 'lists_finished', goal: 10 },
  { key: 'speed', icon: '⚡', title: 'Blitzzähler', desc: 'Mindestens 15 Artikel in einer Zählung mit Ø unter 20 Sekunden', stat: 'speed_counts', goal: 1 },
  { key: 'early', icon: '🌅', title: 'Frühaufsteher', desc: 'Vor 8 Uhr gezählt', stat: 'early_counts', goal: 1 },
  { key: 'streak_4', icon: '📅', title: 'Dranbleiber', desc: '4 Wochen hintereinander gezählt', stat: 'best_week_streak', goal: 4 },
  { key: 'printer', icon: '🧾', title: 'Druckfrisch', desc: 'Einen Einkaufsbon gedruckt', stat: 'prints', goal: 1 },
  { key: 'mail', icon: '✉️', title: 'Postbote', desc: 'Eine Einkaufsliste per E-Mail versendet', stat: 'mails', goal: 1 },
  { key: 'receipt', icon: '📥', title: 'Ware ist da', desc: 'Einen Wareneingang gebucht', stat: 'receipts', goal: 1 },
];

/** ISO-Kalenderwoche als fortlaufende Zahl (für Wochenserien). */
function weekIndex(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day); // Montag
  return Math.floor(t.getTime() / (7 * 86400e3));
}

function computeStats(db, userId) {
  const moves = db.all("SELECT at FROM stock_movements WHERE type = 'count' AND user_id = ? AND qty_after IS NOT NULL", userId);
  const today = new Date().toDateString();
  const weeks = [...new Set(moves.map((m) => weekIndex(new Date(m.at))))].sort((a, b) => a - b);
  let best = 0; let run = 0; let prev = null;
  for (const w of weeks) { run = prev !== null && w === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = w; }
  const nowW = weekIndex(new Date());
  let current = 0;
  if (weeks.length && (weeks.at(-1) === nowW || weeks.at(-1) === nowW - 1)) {
    current = 1;
    for (let i = weeks.length - 1; i > 0 && weeks[i - 1] === weeks[i] - 1; i--) current++;
  }

  const counts = db.all(`SELECT sc.id, COUNT(ci.id) AS total,
      SUM(CASE WHEN ci.counted_qty IS NOT NULL THEN 1 ELSE 0 END) AS counted,
      MIN(ci.counted_at) AS first_at, MAX(ci.counted_at) AS last_at
    FROM stock_counts sc JOIN stock_count_items ci ON ci.count_id = sc.id
    WHERE sc.status = 'completed' AND (sc.completed_by = ? OR sc.created_by = ?) GROUP BY sc.id`, userId, userId);
  const speed = counts.filter((c) => c.counted >= 15 && c.first_at && (Date.parse(c.last_at) - Date.parse(c.first_at)) / 1000 / Math.max(1, c.counted - 1) <= 20).length;

  return {
    articles_counted: moves.length,
    today_counted: moves.filter((m) => new Date(m.at).toDateString() === today).length,
    counts_finished: counts.length,
    perfect_counts: counts.filter((c) => c.total > 0 && c.counted === c.total).length,
    speed_counts: speed,
    early_counts: moves.filter((m) => new Date(m.at).getHours() < 8).length,
    week_streak: current,
    best_week_streak: best,
    lists_finished: db.get("SELECT COUNT(*) AS n FROM purchase_lists WHERE created_by = ? AND ready_at IS NOT NULL AND status <> 'cancelled'", userId).n,
    prints: db.get("SELECT COUNT(*) AS n FROM print_jobs WHERE user_id = ? AND status = 'ok' AND kind <> 'test'", userId).n,
    mails: db.get("SELECT COUNT(*) AS n FROM list_events WHERE user_id = ? AND action = 'E-Mail versendet'", userId).n,
    receipts: db.get("SELECT COUNT(DISTINCT list_id) AS n FROM stock_movements WHERE user_id = ? AND type = 'receipt'", userId).n,
  };
}

function achievements(db, userId) {
  const stats = computeStats(db, userId);
  const badges = BADGES.map((b) => ({
    key: b.key, icon: b.icon, title: b.title, desc: b.desc, goal: b.goal,
    progress: Math.min(stats[b.stat] || 0, b.goal),
    earned: (stats[b.stat] || 0) >= b.goal,
  }));
  const earned = badges.filter((b) => b.earned).length;
  const xp = stats.articles_counted * 1 + stats.counts_finished * 10 + stats.perfect_counts * 15
    + stats.lists_finished * 5 + stats.receipts * 5 + earned * 25;
  let li = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) li = i;
  const next = LEVELS[li + 1] || null;
  return {
    xp,
    level: li + 1,
    level_title: LEVELS[li].title,
    level_xp: LEVELS[li].xp,
    next_level_xp: next ? next.xp : null,
    next_level_title: next ? next.title : null,
    stats,
    badges,
    earned,
  };
}

module.exports = { achievements, computeStats, BADGES, LEVELS, weekIndex };
