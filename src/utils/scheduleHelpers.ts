import type { AppSettings, DayKey, WeeklySchedule } from '../types';

export const ORDERED_DAY_KEYS: DayKey[] = ['1', '2', '3', '4', '5', '6', '0'];

export const DAY_NAMES_FULL: Record<DayKey, string> = {
  '1': 'Lunes',
  '2': 'Martes',
  '3': 'Miércoles',
  '4': 'Jueves',
  '5': 'Viernes',
  '6': 'Sábado',
  '0': 'Domingo',
};

export const DAY_NAMES_SHORT: Record<DayKey, string> = {
  '1': 'Lun',
  '2': 'Mar',
  '3': 'Mié',
  '4': 'Jue',
  '5': 'Vie',
  '6': 'Sáb',
  '0': 'Dom',
};

export const VOICE_OPTIONS = [
  { id: 'Kore' as const, label: 'Kore', desc: 'Femenina · Serena y cálida' },
  { id: 'Zephyr' as const, label: 'Zephyr', desc: 'Femenina · Clara y luminosa' },
  { id: 'Puck' as const, label: 'Puck', desc: 'Masculina · Amable y cercana' },
  { id: 'Charon' as const, label: 'Charon', desc: 'Masculina · Pausada y profunda' },
  { id: 'Fenrir' as const, label: 'Fenrir', desc: 'Masculina · Firme y expresiva' },
];

export const CHIME_OPTIONS = [
  { id: 'chime' as const, label: 'Campana suave', desc: 'Acorde ascendente cálido' },
  { id: 'harp' as const, label: 'Arpa matutina', desc: 'Cuatro notas delicadas' },
  { id: 'tone' as const, label: 'Tono simple', desc: 'Dos pulsos discretos' },
];

export const DEFAULT_SCHEDULE: WeeklySchedule = {
  '1': { enabled: true, time: '08:00' },
  '2': { enabled: true, time: '08:00' },
  '3': { enabled: true, time: '08:00' },
  '4': { enabled: true, time: '08:00' },
  '5': { enabled: true, time: '08:00' },
  '6': { enabled: true, time: '09:00' },
  '0': { enabled: true, time: '09:00' },
};

export const DEFAULT_SETTINGS: AppSettings = {
  alarmMasterEnabled: true,
  autoReadOnAlarm: true,
  keepScreenAwake: true,
  voiceName: 'Kore',
  chimeType: 'chime',
  speechRate: 1.0,
  theme: 'light',
  schedule: DEFAULT_SCHEDULE,
};

export function getLocalDateIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftDateIso(dateIso: string, deltaDays: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return getLocalDateIso(dt);
}

export function formatTime12h(time24: string): string {
  const [hh, mm] = time24.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time24;
  const period = hh >= 12 ? 'p. m.' : 'a. m.';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

export interface NextAlarmInfo {
  dayKey: DayKey;
  dayName: string;
  time: string;
  targetDate: Date;
  countdownText: string;
  isToday: boolean;
}

export function getNextScheduledAlarm(
  settings: AppSettings,
  now = new Date()
): NextAlarmInfo | null {
  if (!settings.alarmMasterEnabled) return null;

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now.getTime());
    candidate.setDate(now.getDate() + offset);
    const dayKey = String(candidate.getDay()) as DayKey;
    const sched = settings.schedule[dayKey];
    if (!sched || !sched.enabled) continue;

    const [hh, mm] = sched.time.split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) continue;

    candidate.setHours(hh, mm, 0, 0);
    if (candidate.getTime() <= now.getTime()) continue;

    const diffMs = candidate.getTime() - now.getTime();
    const totalMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;

    let countdownText = '';
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      countdownText =
        remHours > 0 ? `en ${days} d y ${remHours} h` : `en ${days} día${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      countdownText = `en ${hours} h ${mins} min`;
    } else if (mins > 0) {
      countdownText = `en ${mins} min`;
    } else {
      countdownText = 'en menos de 1 min';
    }

    return {
      dayKey,
      dayName: offset === 0 ? 'Hoy' : offset === 1 ? 'Mañana' : DAY_NAMES_FULL[dayKey],
      time: sched.time,
      targetDate: candidate,
      countdownText,
      isToday: offset === 0,
    };
  }

  return null;
}

const ICS_DAY_MAP: Record<DayKey, string> = {
  '1': 'MO',
  '2': 'TU',
  '3': 'WE',
  '4': 'TH',
  '5': 'FR',
  '6': 'SA',
  '0': 'SU',
};

export function generateWeeklyIcsCalendar(schedule: WeeklySchedule): string {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TextoDiario//AlarmaVozIA//ES',
    'CALSCALE:GREGORIAN',
  ];

  ORDERED_DAY_KEYS.forEach((dayKey) => {
    const entry = schedule[dayKey];
    if (!entry.enabled) return;

    const [hh, mm] = entry.time.split(':').map(Number);
    const targetDayNum = Number(dayKey);
    const diff = (targetDayNum - now.getDay() + 7) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, hh, mm, 0);

    const pad = (n: number) => String(n).padStart(2, '0');
    const dtStart = `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}T${pad(hh)}${pad(mm)}00`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:texto-diario-${dayKey}@textodiario.app`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY_MAP[dayKey]}`);
    lines.push('SUMMARY:Hora de leer el texto diario');
    lines.push('DESCRIPTION:Abre Texto Diario para escuchar la lectura automática con voz IA.');
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:PT0M');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:Hora de leer el texto diario');
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function calculateReadingStreak(completedDates: string[], todayIso = getLocalDateIso()): number {
  const set = new Set(completedDates);
  if (set.size === 0) return 0;

  let cursor = todayIso;
  // If today isn't completed yet, start checking from yesterday so active streaks remain visible
  if (!set.has(cursor)) {
    cursor = shiftDateIso(cursor, -1);
    if (!set.has(cursor)) return 0;
  }

  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDateIso(cursor, -1);
  }
  return streak;
}

export interface RecentDayItem {
  dateIso: string;
  dayShort: string;
  dayNum: number;
  isToday: boolean;
}

export function getRecentDaysWindow(daysCount = 14, todayIso = getLocalDateIso()): RecentDayItem[] {
  const items: RecentDayItem[] = [];
  for (let offset = -(daysCount - 1); offset <= 0; offset++) {
    const dateIso = shiftDateIso(todayIso, offset);
    const [y, m, d] = dateIso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dayKey = String(dt.getDay()) as DayKey;
    items.push({
      dateIso,
      dayShort: DAY_NAMES_SHORT[dayKey],
      dayNum: d,
      isToday: offset === 0,
    });
  }
  return items;
}

