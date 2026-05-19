import type { StravaActivityDTO } from './strava.repository.js';

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPace(distanceM: number, seconds: number): string {
  if (distanceM <= 0 || seconds <= 0) return 'n/a';
  const paceSeconds = seconds / (distanceM / 1000);
  const m = Math.floor(paceSeconds / 60);
  const s = Math.round(paceSeconds % 60);
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

function formatWib(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d) + ' WIB';
}

function effortSignal(activity: StravaActivityDTO): string {
  const raw = activity.raw ?? {};
  const avgHr = asNumber(raw.average_heartrate);
  const maxHr = asNumber(raw.max_heartrate);
  const distanceKm = activity.distance_m / 1000;
  const elevationPerKm = distanceKm > 0 ? activity.total_elevation_gain_m / distanceKm : 0;
  const pace = activity.distance_m > 0 ? activity.moving_time_s / (activity.distance_m / 1000) : 0;

  if (avgHr >= 165 || maxHr >= 185) {
    return 'High cardiovascular load. Treat this as a hard effort unless it was intentionally easy terrain with sensor noise.';
  }
  if (elevationPerKm >= 20) {
    return 'Elevation likely shaped the effort. Judge pace against grade, not flat-road expectations.';
  }
  if (distanceKm >= 12) {
    return 'Endurance stimulus logged. Recovery and fueling matter more than adding speed immediately.';
  }
  if (pace > 0 && pace <= 330) {
    return 'Fast relative pace signal. Keep the next session controlled unless this was a planned workout.';
  }
  return 'Steady aerobic signal. Useful training data, but not enough alone to justify increasing load aggressively.';
}

function recommendation(activity: StravaActivityDTO): string {
  const raw = activity.raw ?? {};
  const avgHr = asNumber(raw.average_heartrate);
  const distanceKm = activity.distance_m / 1000;
  const elevationPerKm = distanceKm > 0 ? activity.total_elevation_gain_m / distanceKm : 0;

  if (avgHr >= 165) return 'Next run: easy Zone 2, 30–45 min. Do not stack intensity on fatigue.';
  if (distanceKm >= 12) return 'Next session: recovery jog or rest. Let the long-run adaptation land.';
  if (elevationPerKm >= 20) return 'Next run: flat easy route. Separate hill stress from speed work.';
  return 'Next run: keep it easy or add short strides only if legs feel normal.';
}

export function buildStravaActivityAnalysis(activity: StravaActivityDTO): string {
  const raw = activity.raw ?? {};
  const avgHr = asNumber(raw.average_heartrate);
  const maxHr = asNumber(raw.max_heartrate);
  const cadence = asNumber(raw.average_cadence);
  const calories = asNumber(raw.calories);

  const hrLine = avgHr > 0 ? `${Math.round(avgHr)} bpm${maxHr > 0 ? ` / max ${Math.round(maxHr)}` : ''}` : 'not available';
  const cadenceLine = cadence > 0 ? `${Math.round(cadence)} spm` : 'not available';
  const calorieLine = calories > 0 ? `${Math.round(calories)} kcal` : 'not available';

  return [
    '🏃 **New Strava Activity Analyzed**',
    '━━━━━━━━━━━━━━━━━━━━',
    `**${activity.name}**`,
    `Type      : ${activity.sport_type}`,
    `Started   : ${formatWib(activity.start_date)}`,
    '',
    '📊 **Snapshot**',
    `Distance  : ${formatKm(activity.distance_m)}`,
    `Moving    : ${formatDuration(activity.moving_time_s)}`,
    `Pace      : ${formatPace(activity.distance_m, activity.moving_time_s)}`,
    `Elevation : ${Math.round(activity.total_elevation_gain_m)} m`,
    `HR        : ${hrLine}`,
    `Cadence   : ${cadenceLine}`,
    `Calories  : ${calorieLine}`,
    '',
    '🔎 **Signal**',
    effortSignal(activity),
    '',
    '🧭 **Recommendation**',
    recommendation(activity),
  ].join('\n');
}
