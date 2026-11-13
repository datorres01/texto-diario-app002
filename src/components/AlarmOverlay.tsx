import React, { useState } from 'react';
import { BellOff, Clock, Loader2, Pause, Play, Square, Volume2 } from 'lucide-react';
import type { AlarmStage, DailyTextData, VoiceName } from '../types';

interface AlarmOverlayProps {
  isOpen: boolean;
  stage: AlarmStage;
  now: Date;
  dailyText: DailyTextData | null;
  voiceName: VoiceName;
  isAudioLoading: boolean;
  audioProgress: { current: number; duration: number };
  audioNotice: string | null;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onSnoozeMinutes: (minutes: number) => void;
  onSnoozeUntilTime: (timeHHMM: string) => void;
  onMinimize: () => void;
}

const POSTPONE_PRESETS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: '3 horas', minutes: 180 },
];

export const AlarmOverlay: React.FC<AlarmOverlayProps> = ({
  isOpen,
  stage,
  now,
  dailyText,
  voiceName,
  isAudioLoading,
  audioProgress,
  audioNotice,
  onStop,
  onPause,
  onResume,
  onSnoozeMinutes,
  onSnoozeUntilTime,
  onMinimize,
}) => {
  const [showPostponePanel, setShowPostponePanel] = useState(false);
  const [customMode, setCustomMode] = useState<'duration' | 'clock'>('duration');
  const [customHours, setCustomHours] = useState(1);
  const [customMinutes, setCustomMinutes] = useState(0);
  const [customClockTime, setCustomClockTime] = useState('10:00');

  if (!isOpen) return null;

  const formattedClock = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const stageLabel =
    stage === 'ringing'
      ? 'Sonando alarma matutina'
      : stage === 'announcing'
      ? 'Anuncio por voz de IA'
      : stage === 'reading'
      ? `Leyendo el texto diario · Voz ${voiceName}`
      : stage === 'paused'
      ? 'Lectura en pausa'
      : 'Lectura finalizada';

  const progressPct =
    audioProgress.duration > 0
      ? Math.min(100, Math.round((audioProgress.current / audioProgress.duration) * 100))
      : 0;

  const handlePauseAndShowOptions = () => {
    if (stage === 'reading') {
      onPause();
    }
    setShowPostponePanel(true);
  };

  const handleApplyCustomPostpone = () => {
    if (customMode === 'duration') {
      const totalMinutes = customHours * 60 + customMinutes;
      if (totalMinutes > 0) {
        setShowPostponePanel(false);
        onSnoozeMinutes(totalMinutes);
      }
    } else if (customClockTime) {
      setShowPostponePanel(false);
      onSnoozeUntilTime(customClockTime);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#F8F7F4] text-slate-900 dark:bg-[#0B1117] dark:text-slate-100 px-5 py-6 sm:p-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alarm-overlay-title"
    >
      {/* Top clock & status */}
      <div className="mx-auto w-full max-w-xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
            <Volume2 className="h-4 w-4 text-[#1E4D7B] dark:text-[#6DA6DB]" aria-hidden="true" />
            <span>{stageLabel}</span>
          </div>
          <button
            type="button"
            onClick={onMinimize}
            className="min-h-[40px] px-3 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
          >
            Ir al texto completo
          </button>
        </div>

        <div className="mt-5 text-center">
          <div className="font-display text-5xl sm:text-6xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">
            {formattedClock}
          </div>
          <h2
            id="alarm-overlay-title"
            className="mt-3 font-display text-2xl sm:text-3xl font-medium text-[#1E4D7B] dark:text-[#7AB3E8] text-balance"
          >
            Hora de leer el texto diario
          </h2>
        </div>
      </div>

      {/* Center scripture preview + Pause/Postpone panel */}
      <div className="mx-auto my-5 w-full max-w-xl space-y-4">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
          {isAudioLoading && (
            <div className="mb-4 flex items-center gap-2.5 text-sm font-medium text-[#1E4D7B] dark:text-[#7AB3E8]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Preparando voz de IA...</span>
            </div>
          )}

          {dailyText ? (
            <>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {dailyText.dateTitle} · {dailyText.publicationTitle}
              </p>
              <p className="mt-3 font-display text-lg sm:text-xl italic leading-relaxed text-slate-900 dark:text-slate-100">
                {dailyText.themeScripture}
              </p>
              {dailyText.bodyParagraphs[0] && (
                <p className="mt-4 text-sm sm:text-base leading-relaxed text-slate-700 dark:text-slate-300 line-clamp-4">
                  {dailyText.bodyParagraphs[0]}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Cargando el texto diario de jw.org...
            </p>
          )}

          {stage === 'reading' && audioProgress.duration > 0 && (
            <div className="mt-5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-slate-800">
                <div
                  className="h-full bg-[#1E4D7B] dark:bg-[#5B9BD5] transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {audioNotice && (
            <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">{audioNotice}</p>
          )}
        </div>

        {/* Postpone options (shown immediately when user pauses or taps Leer más tarde) */}
        {(showPostponePanel || stage === 'paused') && (
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Clock className="h-4 w-4 text-[#1E4D7B] dark:text-[#7AB3E8]" aria-hidden="true" />
                <span>¿Cuándo quieres que vuelva a leerse?</span>
              </div>
              {showPostponePanel && stage !== 'paused' && (
                <button
                  type="button"
                  onClick={() => setShowPostponePanel(false)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 cursor-pointer"
                >
                  Ocultar
                </button>
              )}
            </div>

            <div className="mt-3.5 grid grid-cols-3 sm:grid-cols-5 gap-2">
              {POSTPONE_PRESETS.map((preset) => (
                <button
                  key={preset.minutes}
                  type="button"
                  onClick={() => {
                    setShowPostponePanel(false);
                    onSnoozeMinutes(preset.minutes);
                  }}
                  className="min-h-[44px] rounded-xl border border-stone-300 bg-[#F8F7F4] px-2.5 py-2 text-xs font-semibold text-slate-900 transition-colors hover:border-[#1E4D7B] hover:bg-[#1E4D7B] hover:text-white dark:border-slate-700 dark:bg-[#0D141C] dark:text-slate-100 dark:hover:bg-[#2F6BA3] cursor-pointer"
                >
                  En {preset.label}
                </button>
              ))}
            </div>

            {/* Custom delay or target time */}
            <div className="mt-4 pt-4 border-t border-stone-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  O elige el tiempo exacto:
                </span>
                <div className="inline-flex rounded-lg bg-stone-200/70 p-0.5 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setCustomMode('duration')}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                      customMode === 'duration'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    En horas/min
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomMode('clock')}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                      customMode === 'clock'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    A una hora
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {customMode === 'duration' ? (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={customHours}
                        onChange={(e) => setCustomHours(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                        className="w-16 min-h-[42px] rounded-xl border border-stone-300 bg-white px-2.5 text-center text-sm font-semibold tabular-nums dark:border-slate-700 dark:bg-slate-900"
                      />
                      <span>h</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="number"
                        min={0}
                        max={59}
                        step={5}
                        value={customMinutes}
                        onChange={(e) => setCustomMinutes(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                        className="w-16 min-h-[42px] rounded-xl border border-stone-300 bg-white px-2.5 text-center text-sm font-semibold tabular-nums dark:border-slate-700 dark:bg-slate-900"
                      />
                      <span>min</span>
                    </label>
                  </>
                ) : (
                  <input
                    type="time"
                    value={customClockTime}
                    onChange={(e) => setCustomClockTime(e.target.value)}
                    aria-label="Elegir hora para volver a leer"
                    className="min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-sm font-semibold tabular-nums dark:border-slate-700 dark:bg-slate-900"
                  />
                )}

                <button
                  type="button"
                  onClick={handleApplyCustomPostpone}
                  disabled={customMode === 'duration' && customHours === 0 && customMinutes === 0}
                  className="ml-auto min-h-[42px] rounded-xl bg-[#1E4D7B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163B5E] disabled:opacity-40 dark:bg-[#2F6BA3] cursor-pointer"
                >
                  Programar lectura
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom ergonomic thumb-zone controls */}
      <div className="mx-auto w-full max-w-xl space-y-3 pb-safe">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stage === 'paused' ? (
            <button
              type="button"
              onClick={() => {
                setShowPostponePanel(false);
                onResume();
              }}
              className="flex min-h-[54px] items-center justify-center gap-2.5 rounded-2xl bg-[#1E4D7B] px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-[#163B5E] dark:bg-[#2F6BA3] dark:hover:bg-[#3A7BB8] cursor-pointer"
            >
              <Play className="h-5 w-5" aria-hidden="true" />
              Continuar lectura
            </button>
          ) : stage === 'reading' || stage === 'announcing' || stage === 'ringing' ? (
            <button
              type="button"
              onClick={handlePauseAndShowOptions}
              className="flex min-h-[54px] items-center justify-center gap-2.5 rounded-2xl border border-stone-300 bg-white px-5 py-3 text-base font-semibold text-slate-800 transition-colors hover:bg-stone-50 dark:border-slate-700 dark:bg-[#16202B] dark:text-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Pause className="h-5 w-5" aria-hidden="true" />
              Pausar y leer después
            </button>
          ) : (
            <button
              type="button"
              onClick={onMinimize}
              className="flex min-h-[54px] items-center justify-center gap-2.5 rounded-2xl bg-[#1E4D7B] px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-[#163B5E] dark:bg-[#2F6BA3] cursor-pointer"
            >
              Leer texto completo
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setShowPostponePanel(false);
              onStop();
            }}
            className="flex min-h-[54px] items-center justify-center gap-2.5 rounded-2xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white cursor-pointer"
          >
            {stage === 'idle' ? (
              <>
                <BellOff className="h-5 w-5" aria-hidden="true" />
                Cerrar alarma
              </>
            ) : (
              <>
                <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                Detener alarma
              </>
            )}
          </button>
        </div>

        {!showPostponePanel && stage !== 'paused' && (
          <button
            type="button"
            onClick={() => setShowPostponePanel(true)}
            className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-stone-200/60 dark:text-slate-400 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            Estoy ocupado · Leer en 1h, 2h, 3h u otra hora
          </button>
        )}
      </div>
    </div>
  );
};
