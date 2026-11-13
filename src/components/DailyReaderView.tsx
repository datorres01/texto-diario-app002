import React, { useState } from 'react';
import {
  AlarmClock,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import type { AlarmStage, AppSettings, DailyTextData } from '../types';
import {
  formatTime12h,
  getLocalDateIso,
  shiftDateIso,
  type NextAlarmInfo,
} from '../utils/scheduleHelpers';

interface DailyReaderViewProps {
  selectedDate: string;
  onSelectDate: (dateIso: string) => void;
  dailyText: DailyTextData | null;
  loading: boolean;
  error: string | null;
  onRetryFetch: () => void;
  settings: AppSettings;
  nextAlarm: NextAlarmInfo | null;
  alarmStage: AlarmStage;
  isInlinePlaying: boolean;
  isAudioLoading: boolean;
  audioProgress: { current: number; duration: number };
  audioNotice: string | null;
  isAudioArmed: boolean;
  wakeLockActive: boolean;
  snoozeTargetMs: number | null;
  onPlayReading: () => void;
  onPauseReading: () => void;
  onResumeReading: () => void;
  onStopAudio: () => void;
  onTestAlarm: () => void;
  onSnoozeMinutes: (minutes: number) => void;
  onSnoozeUntilTime: (timeHHMM: string) => void;
  onCancelSnooze: () => void;
  onArmAudio: () => void;
  onDisarmAudio: () => void;
  onOpenScheduleTab: () => void;
  onOpenLiveChat: () => void;
  isSelectedDateCompleted: boolean;
  onToggleCompletedDate: (dateIso: string) => void;
}

export const DailyReaderView: React.FC<DailyReaderViewProps> = ({
  selectedDate,
  onSelectDate,
  dailyText,
  loading,
  error,
  onRetryFetch,
  settings,
  nextAlarm,
  alarmStage,
  isInlinePlaying,
  isAudioLoading,
  audioProgress,
  audioNotice,
  isAudioArmed,
  wakeLockActive,
  snoozeTargetMs,
  onPlayReading,
  onPauseReading,
  onResumeReading,
  onStopAudio,
  onTestAlarm,
  onSnoozeMinutes,
  onSnoozeUntilTime,
  onCancelSnooze,
  onArmAudio,
  onDisarmAudio,
  onOpenScheduleTab,
  onOpenLiveChat,
  isSelectedDateCompleted,
  onToggleCompletedDate,
}) => {
  const [showInlinePostpone, setShowInlinePostpone] = useState(false);
  const [customHours, setCustomHours] = useState(1);
  const [customMinutes, setCustomMinutes] = useState(0);
  const [customClock, setCustomClock] = useState('10:00');
  const [customMode, setCustomMode] = useState<'duration' | 'clock'>('duration');

  const todayIso = getLocalDateIso();
  const yesterdayIso = shiftDateIso(todayIso, -1);
  const tomorrowIso = shiftDateIso(todayIso, 1);

  const progressPct =
    audioProgress.duration > 0
      ? Math.min(100, Math.round((audioProgress.current / audioProgress.duration) * 100))
      : 0;

  const formatSnoozeRemaining = (targetMs: number) => {
    const diffMins = Math.max(1, Math.ceil((targetMs - Date.now()) / 60000));
    if (diffMins < 60) return `en ${diffMins} min`;
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    return m > 0 ? `en ${h} h ${m} min` : `en ${h} h`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
      {/* Main reading column */}
      <section className="lg:col-span-8 space-y-5">
        {/* Scheduled postponed reading banner */}
        {snoozeTargetMs && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1E4D7B]/25 bg-[#1E4D7B]/5 p-4 dark:border-[#5B9BD5]/30 dark:bg-[#2F6BA3]/15">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-[#1E4D7B] dark:text-[#7AB3E8] shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Lectura pospuesta para las{' '}
                  <span className="tabular-nums">
                    {new Date(snoozeTargetMs).toLocaleTimeString('es-ES', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Se leerá automáticamente {formatSnoozeRemaining(snoozeTargetMs)}.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onTestAlarm}
                className="min-h-[40px] rounded-xl bg-[#1E4D7B] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#163B5E] dark:bg-[#2F6BA3] cursor-pointer"
              >
                Leer ahora
              </button>
              <button
                type="button"
                onClick={onCancelSnooze}
                aria-label="Cancelar lectura pospuesta"
                className="flex h-[40px] w-[40px] items-center justify-center rounded-xl border border-stone-300 bg-white text-slate-600 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Date switcher bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-xl bg-stone-200/70 p-1 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => onSelectDate(yesterdayIso)}
              className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedDate === yesterdayIso
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Ayer
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(todayIso)}
              className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedDate === todayIso
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(tomorrowIso)}
              className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedDate === tomorrowIso
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Mañana
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSelectDate(shiftDateIso(selectedDate, -1))}
              aria-label="Día anterior"
              className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-stone-200 bg-white text-slate-700 hover:bg-stone-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <label className="relative flex min-h-[42px] items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
              <Calendar className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) onSelectDate(e.target.value);
                }}
                aria-label="Seleccionar fecha"
                className="bg-transparent text-xs font-medium tabular-nums outline-none cursor-pointer"
              />
            </label>
            <button
              type="button"
              onClick={() => onSelectDate(shiftDateIso(selectedDate, 1))}
              aria-label="Día siguiente"
              className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-stone-200 bg-white text-slate-700 hover:bg-stone-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Main daily text card */}
        <article className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
          {loading ? (
            <div className="space-y-4 py-8">
              <div className="h-4 w-40 rounded bg-stone-200 dark:bg-slate-800" />
              <div className="h-8 w-3/4 rounded bg-stone-200 dark:bg-slate-800" />
              <div className="h-20 w-full rounded bg-stone-100 dark:bg-slate-800/60" />
              <div className="h-32 w-full rounded bg-stone-100 dark:bg-slate-800/60" />
            </div>
          ) : error ? (
            <div className="py-8 text-center space-y-4">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              <button
                type="button"
                onClick={onRetryFetch}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1E4D7B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#163B5E] cursor-pointer"
              >
                <RefreshCw className="h-4 w-4" />
                Reintentar carga
              </button>
            </div>
          ) : dailyText ? (
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Examinemos las Escrituras todos los días</span>
                <span aria-hidden="true">·</span>
                <span>jw.org</span>
              </div>

              <h1 className="mt-2 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 dark:text-white text-balance">
                {dailyText.dateTitle}
              </h1>

              <div className="mt-5 rounded-xl border border-stone-200 bg-[#F8F7F4] p-5 dark:border-slate-800 dark:bg-[#0D141C]">
                <p className="font-display text-lg sm:text-xl italic leading-relaxed text-slate-900 dark:text-slate-100">
                  {dailyText.themeScripture}
                </p>
              </div>

              {/* AI Voice + Live Chat + Postpone Toolbar */}
              <div className="mt-5 flex flex-wrap items-center gap-2.5 border-b border-stone-200 pb-5 dark:border-slate-800">
                {isInlinePlaying && alarmStage === 'reading' ? (
                  <button
                    type="button"
                    onClick={() => {
                      onPauseReading();
                      setShowInlinePostpone(true);
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1E4D7B] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#163B5E] dark:bg-[#2F6BA3] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Pause className="h-4 w-4" aria-hidden="true" />
                    Pausar
                  </button>
                ) : isInlinePlaying && alarmStage === 'paused' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowInlinePostpone(false);
                      onResumeReading();
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1E4D7B] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#163B5E] dark:bg-[#2F6BA3] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    Continuar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onPlayReading}
                    disabled={isAudioLoading}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1E4D7B] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#163B5E] disabled:opacity-70 dark:bg-[#2F6BA3] dark:hover:bg-[#3A7BB8] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isAudioLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    {isAudioLoading ? 'Generando voz...' : 'Escuchar'}
                  </button>
                )}

                {isInlinePlaying && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowInlinePostpone(false);
                      onStopAudio();
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    Detener
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowInlinePostpone((v) => !v)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Clock className="h-4 w-4 text-[#1E4D7B] dark:text-[#7AB3E8]" aria-hidden="true" />
                  Leer después
                </button>

                <button
                  type="button"
                  onClick={onOpenLiveChat}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Mic className="h-4 w-4 text-[#1E4D7B] dark:text-[#7AB3E8]" aria-hidden="true" />
                  Conversar
                </button>

                <button
                  type="button"
                  onClick={onTestAlarm}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Bell className="h-4 w-4 text-[#1E4D7B] dark:text-[#7AB3E8]" aria-hidden="true" />
                  Probar alarma
                </button>
              </div>

              {/* Inline Pause / Postpone options panel */}
              {showInlinePostpone && (
                <div className="mt-4 rounded-xl border border-stone-200 bg-[#F8F7F4] p-4 dark:border-slate-800 dark:bg-[#0D141C] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Pausar y leer automáticamente dentro de:
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowInlinePostpone(false)}
                      className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 cursor-pointer"
                    >
                      Cerrar
                    </button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {[
                      { label: '15 min', mins: 15 },
                      { label: '30 min', mins: 30 },
                      { label: '1 hora', mins: 60 },
                      { label: '2 horas', mins: 120 },
                      { label: '3 horas', mins: 180 },
                    ].map((opt) => (
                      <button
                        key={opt.mins}
                        type="button"
                        onClick={() => {
                          onSnoozeMinutes(opt.mins);
                          setShowInlinePostpone(false);
                        }}
                        className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-slate-800 hover:border-[#1E4D7B] hover:bg-[#1E4D7B] hover:text-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-[#2F6BA3] cursor-pointer"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-200 dark:border-slate-800">
                    <div className="inline-flex rounded-lg bg-stone-200/70 p-0.5 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setCustomMode('duration')}
                        className={`rounded-md px-2 py-1 text-xs font-semibold cursor-pointer ${
                          customMode === 'duration'
                            ? 'bg-white text-slate-900 dark:bg-slate-900 dark:text-white'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Tiempo
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomMode('clock')}
                        className={`rounded-md px-2 py-1 text-xs font-semibold cursor-pointer ${
                          customMode === 'clock'
                            ? 'bg-white text-slate-900 dark:bg-slate-900 dark:text-white'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Hora exacta
                      </button>
                    </div>
                    {customMode === 'duration' ? (
                      <>
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={customHours}
                          onChange={(e) => setCustomHours(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                          aria-label="Horas"
                          className="w-14 min-h-[38px] rounded-lg border border-stone-300 bg-white px-2 text-center text-xs font-semibold tabular-nums dark:border-slate-700 dark:bg-slate-900"
                        />
                        <span className="text-xs text-slate-600 dark:text-slate-400">h</span>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          step={5}
                          value={customMinutes}
                          onChange={(e) => setCustomMinutes(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                          aria-label="Minutos"
                          className="w-14 min-h-[38px] rounded-lg border border-stone-300 bg-white px-2 text-center text-xs font-semibold tabular-nums dark:border-slate-700 dark:bg-slate-900"
                        />
                        <span className="text-xs text-slate-600 dark:text-slate-400">min</span>
                      </>
                    ) : (
                      <input
                        type="time"
                        value={customClock}
                        onChange={(e) => setCustomClock(e.target.value)}
                        aria-label="Hora exacta para posponer"
                        className="min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold tabular-nums dark:border-slate-700 dark:bg-slate-900"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (customMode === 'duration') {
                          const total = customHours * 60 + customMinutes;
                          if (total > 0) {
                            onSnoozeMinutes(total);
                            setShowInlinePostpone(false);
                          }
                        } else if (customClock) {
                          onSnoozeUntilTime(customClock);
                          setShowInlinePostpone(false);
                        }
                      }}
                      className="ml-auto min-h-[38px] rounded-lg bg-[#1E4D7B] px-3.5 text-xs font-semibold text-white hover:bg-[#163B5E] dark:bg-[#2F6BA3] cursor-pointer"
                    >
                      Programar
                    </button>
                  </div>
                </div>
              )}

              {isInlinePlaying && audioProgress.duration > 0 && (
                <div className="mt-4">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-slate-800">
                    <div
                      className="h-full bg-[#1E4D7B] dark:bg-[#5B9BD5] transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {audioNotice && (
                <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{audioNotice}</p>
              )}

              {/* Body paragraphs */}
              <div className="mt-6 space-y-4 text-[16px] leading-[1.7] text-slate-800 dark:text-slate-200 max-w-[68ch]">
                {dailyText.bodyParagraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>

              <div className="mt-6 pt-5 border-t border-stone-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={() => onToggleCompletedDate(dailyText.date)}
                  className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    isSelectedDateCompleted
                      ? 'border-emerald-600/30 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'border-stone-300 bg-white text-slate-700 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {isSelectedDateCompleted ? 'Lectura completada' : 'Marcar como leído'}
                </button>
                <a
                  href={dailyText.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-[#1E4D7B] hover:underline dark:text-[#7AB3E8]"
                >
                  Ver en wol.jw.org
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          ) : null}
        </article>
      </section>

      {/* Right companion alarm column */}
      <aside className="lg:col-span-4 space-y-5">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Próxima alarma
            </h2>
            <button
              type="button"
              onClick={onOpenScheduleTab}
              className="text-xs font-semibold text-[#1E4D7B] hover:underline dark:text-[#7AB3E8] cursor-pointer"
            >
              Editar horario
            </button>
          </div>

          {snoozeTargetMs ? (
            <div className="mt-4">
              <div className="font-display text-3xl font-semibold tabular-nums text-[#1E4D7B] dark:text-[#7AB3E8]">
                {new Date(snoozeTargetMs).toLocaleTimeString('es-ES', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Lectura pospuesta · {formatSnoozeRemaining(snoozeTargetMs)}
              </p>
            </div>
          ) : nextAlarm ? (
            <div className="mt-4">
              <div className="font-display text-3xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatTime12h(nextAlarm.time)}
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {nextAlarm.dayName} · {nextAlarm.countdownText}
              </p>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Voz IA: {settings.voiceName} ·{' '}
                {settings.autoReadOnAlarm
                  ? 'Lectura automática activada'
                  : 'Solo anuncio'}
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No tienes horarios activos en este momento.
              </p>
              <button
                type="button"
                onClick={onOpenScheduleTab}
                className="mt-3 inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#1E4D7B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163B5E] cursor-pointer"
              >
                <AlarmClock className="h-4 w-4" />
                Configurar horario
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Modo espera automática
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Activa el audio una vez para que la sesión quede lista en segundo plano o con la pantalla atenuada y suene sola al llegar la hora.
          </p>

          <div className="mt-4">
            {isAudioArmed ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Audio listo para sonar solo
                    {wakeLockActive ? ' · Pantalla activa' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onDisarmAudio}
                  className="w-full min-h-[44px] rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Desactivar modo espera
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onArmAudio}
                className="w-full min-h-[46px] rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white cursor-pointer"
              >
                Activar audio automático ahora
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
