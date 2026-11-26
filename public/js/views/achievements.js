// Persönliche Erfolge: Level, Erfahrungspunkte, Abzeichen, Statistik.
import { get } from '../api.js';
import { esc } from '../ui.js';
import { state } from '../app.js';
import { checkAchievements } from '../reward.js';

export function levelBar(a) {
  const span = a.next_level_xp ? a.next_level_xp - a.level_xp : 1;
  const pct = a.next_level_xp ? Math.min(100, Math.round(((a.xp - a.level_xp) / span) * 100)) : 100;
  return `<div class="lvl"><div class="lvl-badge">⭐ ${a.level}</div><div class="grow"><div class="lvl-title"><b>${esc(a.level_title)}</b><span>${a.xp} XP${a.next_level_xp ? ` · noch ${a.next_level_xp - a.xp} bis „${esc(a.next_level_title)}“` : ' · Höchststufe erreicht!'}</span></div>
    <div class="lvl-track"><div class="lvl-fill" style="width:${pct}%"></div></div></div></div>`;
}

export async function render(el) {
  const a = await checkAchievements() || await get('/api/me/achievements');
  const s = a.stats;
  const stat = (icon, label, v) => `<div class="ach-stat"><span>${icon}</span><b>${v}</b><small>${label}</small></div>`;
  el.innerHTML = `
    <section class="card">${levelBar(a)}</section>
    <div class="ach-stats mt">
      ${stat('📦', 'Artikel gezählt', s.articles_counted)}${stat('☀️', 'heute gezählt', s.today_counted)}${stat('📋', 'Zählungen', s.counts_finished)}
      ${stat('💯', 'vollständige Zählungen', s.perfect_counts)}${stat('🛒', 'Listen fertiggestellt', s.lists_finished)}${stat('📅', 'Wochen in Folge', s.week_streak)}
    </div>
    <h2 class="mt">Abzeichen <small class="muted">${a.earned} von ${a.badges.length}</small></h2>
    <div class="ach-grid">${a.badges.map((b) => `<div class="ach ${b.earned ? 'earned' : 'locked'}">
      <div class="ach-icon">${b.icon}</div><strong>${esc(b.title)}</strong><small>${esc(b.desc)}</small>
      ${b.earned ? '<span class="ach-ok">✓ freigeschaltet</span>' : `<div class="ach-prog"><div style="width:${Math.round((b.progress / b.goal) * 100)}%"></div></div><small class="muted">${b.progress} / ${b.goal}</small>`}
    </div>`).join('')}</div>
    <p class="muted small mt">Erfahrungspunkte gibt es für gezählte Artikel (1), fertige Zählungen (10), vollständige Zählungen (+15), fertiggestellte Listen (5), Wareneingänge (5) und jedes Abzeichen (25). Erfolge sind persönlich – ${esc(state.user.display_name)}, du siehst nur deine eigenen.</p>`;
}
