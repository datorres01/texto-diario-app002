import React, { useState } from 'react';
import { Bell, CalendarPlus, Check, Clock, Flame, Info, Smartphone } from 'lucide-react';
import type { AppSettings, DayKey } from '../types';
import {
  calculateReadingStreak,
  DAY_NAMES_FULL,
  formatTime12h,
  generateWeeklyIcsCalendar,
  getLocalDateIso,
  getRecentDaysWindow,
  ORDERED_DAY_KEYS,
} from '../utils/scheduleHelpers';

interface ScheduleViewProps {
  settings: AppSettings;
  onUpdateSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  notificationPermission: NotificationPermission | 'unsupported';
  onRequestNotifications: () => Promise<NotificationPermission | 'unsupported'>;
  completedDates: string[];
  onToggleCompletedDate: (dateIso: string) => void;
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  settings,
  onUpdateSettings,
  notificationPermission,
  onRequestNotifications,
  completedDates,
  onToggleCompletedDate,
}) => {
  const [bulkTime, setBulkTime] = useState('08:00');
  const [appliedBulk, setAppliedBulk] = useState(false);

  const todayIso = getLocalDateIso();
  const completedSet = new Set(completedDates);
  const currentStreak = calculateReadingStreak(completedDates, todayIso);
  const recentDays = getRecentDaysWindow(14, todayIso);
  const todayDone = completedSet.has(todayIso);

  const toggleMaster = () => {
    onUpdateSettings((prev) => ({
      ...prev,
      alarmMasterEnabled: !prev.alarmMasterEnabled,
    }));
  };

  const toggleDay = (dayKey: DayKey) => {
    onUpdateSettings((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [dayKey]: {
          ...prev.schedule[dayKey],
          enabled: !prev.schedule[dayKey].enabled,
        },
      },
    }));
  };

  const changeDayTime = (dayKey: DayKey, newTime: string) => {
    if (!newTime) return;
    onUpdateSettings((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [dayKey]: {
          ...prev.schedule[dayKey],
          time: newTime,
          enabled: true,
        },
      },
    }));
  };

  const applyToAllDays = () => {
    onUpdateSettings((prev) => {
      const nextSchedule = { ...prev.schedule };
      ORDERED_DAY_KEYS.forEach((k) => {
        nextSchedule[k] = { enabled: true, time: bulkTime };
      });
      return {
        ...prev,
        alarmMasterEnabled: true,
        schedule: nextSchedule,
      };
    });
    setAppliedBulk(true);
    window.setTimeout(() => setAppliedBulk(false), 2000);
  };

  const downloadCalendarBackup = () => {
    const ics = generateWeeklyIcsCalendar(settings.schedule);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'horario-texto-diario.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
      {/* Left: Weekly schedule editor */}
      <section className="lg:col-span-7 space-y-5">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
                Horario semanal
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Elige la hora exacta para cada día de la semana.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.alarmMasterEnabled}
              aria-label="Activar alarma diaria"
              onClick={toggleMaster}
              className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                settings.alarmMasterEnabled
                  ? 'bg-[#1E4D7B] dark:bg-[#2F6BA3]'
                  : 'bg-stone-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                  settings.alarmMasterEnabled ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Bulk preset */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-[#F8F7F4] p-3.5 dark:border-slate-800 dark:bg-[#0D141C]">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
              <Clock className="h-4 w-4 text-[#1E4D7B] dark:text-[#7AB3E8]" aria-hidden="true" />
              <span>Misma hora todos los días:</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={bulkTime}
                onChange={(e) => setBulkTime(e.target.value)}
                aria-label="Hora para toda la semana"
                className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2.5 text-sm font-semibold tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={applyToAllDays}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E4D7B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#163B5E] dark:bg-[#2F6BA3] whitespace-nowrap shrink-0 cursor-pointer"
              >
                {appliedBulk ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Aplicado
                  </>
                ) : (
                  'Aplicar a todos'
                )}
              </button>
            </div>
          </div>

          {/* 7-day rows */}
          <div className="mt-5 divide-y divide-stone-200 dark:divide-slate-800">
            {ORDERED_DAY_KEYS.map((dayKey) => {
              const entry = settings.schedule[dayKey];
              return (
                <div
                  key={dayKey}
                  className="flex items-center justify-between gap-4 py-3.5 min-h-[60px]"
                >
                  <div className="flex items-center gap-3.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={entry.enabled}
                      aria-label={`Activar alarma del ${DAY_NAMES_FULL[dayKey]}`}
                      onClick={() => toggleDay(dayKey)}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                        entry.enabled && settings.alarmMasterEnabled
                          ? 'bg-[#1E4D7B] dark:bg-[#2F6BA3]'
                          : 'bg-stone-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          entry.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>

                    <div>
                      <span
                        className={`block text-sm font-semibold ${
                          entry.enabled && settings.alarmMasterEnabled
                            ? 'text-slate-900 dark:text-white'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {DAY_NAMES_FULL[dayKey]}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {entry.enabled ? formatTime12h(entry.time) : 'Sin alarma'}
                      </span>
                    </div>
                  </div>

                  <input
                    type="time"
                    value={entry.time}
                    onChange={(e) => changeDayTime(dayKey, e.target.value)}
                    aria-label={`Hora del ${DAY_NAMES_FULL[dayKey]}`}
                    className={`min-h-[44px] rounded-xl border px-3 text-sm font-semibold tabular-nums transition-colors ${
                      entry.enabled
                        ? 'border-stone-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white'
                        : 'border-stone-200 bg-stone-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-500'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Reading Consistency History */}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Constancia diaria
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {todayDone
                  ? 'Lectura de hoy completada. Cada día cuenta para mantener el hábito.'
                  : currentStreak > 0
                  ? `Llevas ${currentStreak} ${currentStreak === 1 ? 'día seguido' : 'días seguidos'}. Completa hoy para seguir tu racha.`
                  : 'Se marca automáticamente al escuchar la lectura o tocando cualquier día.'}
              </p>
            </div>
            <div className="flex items-center gap-5 text-right">
              <div>
                <div className="flex items-center justify-end gap-1 text-xl font-semibold tabular-nums text-[#1E4D7B] dark:text-[#7AB3E8]">
                  <Flame className="h-4 w-4" aria-hidden="true" />
                  <span>{currentStreak}</span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {currentStreak === 1 ? 'día seguido' : 'días seguidos'}
                </span>
              </div>
              <div>
                <div className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {completedDates.length}
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  total leídos
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-7 gap-2">
            {recentDays.map((day) => {
              const isDone = completedSet.has(day.dateIso);
              return (
                <button
                  key={day.dateIso}
                  type="button"
                  onClick={() => onToggleCompletedDate(day.dateIso)}
                  aria-pressed={isDone}
                  aria-label={`${day.dayShort} ${day.dayNum}: ${isDone ? 'leído' : 'pendiente'}`}
                  className={`flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-xl border p-1.5 transition-colors cursor-pointer ${
                    isDone
                      ? 'border-[#1E4D7B] bg-[#1E4D7B] text-white dark:border-[#2F6BA3] dark:bg-[#2F6BA3]'
                      : day.isToday
                      ? 'border-[#1E4D7B]/60 bg-[#F8F7F4] text-slate-900 dark:border-[#7AB3E8]/50 dark:bg-[#0D141C] dark:text-white'
                      : 'border-stone-200 bg-[#F8F7F4] text-slate-600 hover:border-stone-300 dark:border-slate-800 dark:bg-[#0D141C] dark:text-slate-400'
                  }`}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">
                    {day.dayShort}
                  </span>
                  <span className="text-xs font-semibold tabular-nums">{day.dayNum}</span>
                  <span className="flex h-4 w-4 items-center justify-center">
                    {isDone ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          day.isToday
                            ? 'bg-[#1E4D7B] dark:bg-[#7AB3E8]'
                            : 'bg-stone-300 dark:bg-slate-700'
                        }`}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Right: Mobile behavior honesty + Notifications & ICS Backup */}
      <aside className="lg:col-span-5 space-y-5">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
          <div className="flex items-center gap-2.5 text-slate-900 dark:text-white">
            <Smartphone className="h-5 w-5 text-[#1E4D7B] dark:text-[#7AB3E8]" aria-hidden="true" />
            <h2 className="text-base font-semibold">Cómo funciona en tu celular</h2>
          </div>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <p>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Lectura automática manos libres:
              </strong>{' '}
              Si dejas la app abierta en <strong className="font-semibold">Modo espera activa</strong> (por ejemplo, en tu mesa de noche o escritorio), al llegar tu hora sonará el tono suave, la voz de IA dirá <em>“Hora de leer el texto diario”</em> y leerá el texto completo automáticamente sin que toques el celular.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nota importante de Android e iOS: por seguridad del sistema, ninguna app web/PWA puede encender el altavoz automáticamente si la pantalla está bloqueada y la app completamente cerrada. Para esos casos puedes activar notificaciones o exportar tu horario al calendario del teléfono.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26] space-y-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Recordatorios adicionales
          </h2>

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-400">
              <p className="font-semibold text-slate-900 dark:text-white text-sm">
                Notificaciones del navegador
              </p>
              <p className="mt-0.5">
                {notificationPermission === 'granted'
                  ? 'Permiso concedido'
                  : notificationPermission === 'denied'
                  ? 'Bloqueado en ajustes del navegador'
                  : notificationPermission === 'unsupported'
                  ? 'No compatible en este navegador'
                  : 'Muestra aviso cuando la pestaña está abierta'}
              </p>
            </div>
            {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && (
              <button
                type="button"
                onClick={onRequestNotifications}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#1E4D7B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#163B5E] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Bell className="h-3.5 w-3.5" />
                Activar
              </button>
            )}
          </div>

          <div className="pt-4 border-t border-stone-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-400">
              <p className="font-semibold text-slate-900 dark:text-white text-sm">
                Respaldo en Calendario (.ics)
              </p>
              <p className="mt-0.5">
                Descarga tu horario semanal para recibir alertas nativas incluso con el celular bloqueado.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadCalendarBackup}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Exportar
            </button>
          </div>

          <div className="flex items-start gap-2 pt-2 text-xs text-slate-500 dark:text-slate-400">
            <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>Tus horarios se guardan localmente en este dispositivo.</span>
          </div>
        </div>
      </aside>
    </div>
  );
};
