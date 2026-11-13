import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, BookOpen, CalendarClock, SlidersHorizontal, WifiOff } from 'lucide-react';
import { AlarmOverlay } from './components/AlarmOverlay';
import { DailyReaderView } from './components/DailyReaderView';
import { LiveConversationModal } from './components/LiveConversationModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ScheduleView } from './components/ScheduleView';
import { VoiceSettingsView } from './components/VoiceSettingsView';
import { useDailyAlarm } from './hooks/useDailyAlarm';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import type { AppTab, DailyTextData } from './types';
import { getLocalDateIso } from './utils/scheduleHelpers';

const COMPLETED_STORAGE_KEY = 'texto_diario_completed_v1';

function loadCompletedDates(): string[] {
  try {
    const raw = localStorage.getItem(COMPLETED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

function getCachedDailyText(dateIso: string): DailyTextData | null {
  try {
    const raw = localStorage.getItem(`texto_diario_cache_v2_${dateIso}`);
    return raw ? (JSON.parse(raw) as DailyTextData) : null;
  } catch {
    return null;
  }
}

function saveCachedDailyText(dateIso: string, data: DailyTextData) {
  try {
    localStorage.setItem(`texto_diario_cache_v2_${dateIso}`, JSON.stringify(data));
  } catch {
    // ignore storage quota
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('today');
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateIso());
  const [dailyText, setDailyText] = useState<DailyTextData | null>(() =>
    getCachedDailyText(getLocalDateIso())
  );
  const [todayText, setTodayText] = useState<DailyTextData | null>(() =>
    getCachedDailyText(getLocalDateIso())
  );
  const [loading, setLoading] = useState<boolean>(!dailyText);
  const [error, setError] = useState<string | null>(null);
  const [isLiveChatOpen, setIsLiveChatOpen] = useState(false);
  const [completedDates, setCompletedDates] = useState<string[]>(loadCompletedDates);

  useEffect(() => {
    try {
      localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(completedDates));
    } catch {
      // ignore
    }
  }, [completedDates]);

  const markDateCompleted = useCallback((dateIso: string) => {
    setCompletedDates((prev) => (prev.includes(dateIso) ? prev : [...prev, dateIso]));
  }, []);

  const toggleCompletedDate = useCallback((dateIso: string) => {
    setCompletedDates((prev) =>
      prev.includes(dateIso) ? prev.filter((d) => d !== dateIso) : [...prev, dateIso]
    );
  }, []);

  const isOnline = useOnlineStatus();

  const loadDailyText = useCallback(async (dateIso: string) => {
    const localCached = getCachedDailyText(dateIso);
    if (localCached) {
      setDailyText(localCached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(`/api/daily-text?date=${encodeURIComponent(dateIso)}`);
      if (!response.ok) {
        let errText = 'No se pudo cargar el texto diario.';
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) errText = payload.error;
        } catch {
          // ignore
        }
        throw new Error(errText);
      }
      const data = (await response.json()) as DailyTextData;
      setDailyText(data);
      saveCachedDailyText(dateIso, data);
      if (dateIso === getLocalDateIso()) {
        setTodayText(data);
      }
    } catch (err) {
      if (!localCached) {
        setError(
          err instanceof Error ? err.message : 'Error de conexión al consultar jw.org.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDailyText(selectedDate);
  }, [loadDailyText, selectedDate]);

  useEffect(() => {
    const todayIso = getLocalDateIso();
    if (!todayText) {
      fetch(`/api/daily-text?date=${todayIso}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: DailyTextData | null) => {
          if (data) {
            setTodayText(data);
            saveCachedDailyText(todayIso, data);
          }
        })
        .catch(() => {});
    }
  }, [todayText]);

  const {
    settings,
    setSettings,
    now,
    nextAlarm,
    alarmStage,
    isOverlayOpen,
    setIsOverlayOpen,
    isInlinePlaying,
    isAudioLoading,
    audioProgress,
    audioNotice,
    isAudioArmed,
    wakeLockActive,
    snoozeTargetMs,
    notificationPermission,
    requestNotificationAccess,
    armAlarmAudio,
    disarmAlarmAudio,
    triggerAlarmSequence,
    playReadingOnly,
    stopAlarm,
    pauseReading,
    resumeReading,
    snoozeAlarm,
    snoozeUntilTime,
    cancelSnooze,
  } = useDailyAlarm(todayText, markDateCompleted);

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F7F4] text-slate-900 dark:bg-[#0D131A] dark:text-slate-100">
      {/* Clean 3-zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-12 md:h-16 border-b border-stone-200 bg-[#F8F7F4]/90 backdrop-blur-md dark:border-slate-800 dark:bg-[#0D131A]/90">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('today')}
            className="font-display text-lg sm:text-xl font-semibold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Texto Diario
          </button>

          <nav
            aria-label="Navegación principal"
            className="hidden md:flex items-center gap-7 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => setActiveTab('today')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'today'
                  ? 'text-[#1E4D7B] underline decoration-2 underline-offset-8 dark:text-[#7AB3E8]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Texto de hoy
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('schedule')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'schedule'
                  ? 'text-[#1E4D7B] underline decoration-2 underline-offset-8 dark:text-[#7AB3E8]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Horario semanal
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('voice')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'voice'
                  ? 'text-[#1E4D7B] underline decoration-2 underline-offset-8 dark:text-[#7AB3E8]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Voz y alarma
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => triggerAlarmSequence(dailyText)}
              className="hidden sm:inline-flex md:hidden lg:inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <AlarmClock className="h-3.5 w-3.5 text-[#1E4D7B] dark:text-[#7AB3E8]" aria-hidden="true" />
              Probar alarma
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 pt-5 sm:pt-8 pb-24 md:pb-12">
        {activeTab === 'today' && (
          <DailyReaderView
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            dailyText={dailyText}
            loading={loading}
            error={error}
            onRetryFetch={() => loadDailyText(selectedDate)}
            settings={settings}
            nextAlarm={nextAlarm}
            alarmStage={alarmStage}
            isInlinePlaying={isInlinePlaying}
            isAudioLoading={isAudioLoading}
            audioProgress={audioProgress}
            audioNotice={audioNotice}
            isAudioArmed={isAudioArmed}
            wakeLockActive={wakeLockActive}
            snoozeTargetMs={snoozeTargetMs}
            onPlayReading={() => {
              if (dailyText) playReadingOnly(dailyText);
            }}
            onPauseReading={pauseReading}
            onResumeReading={resumeReading}
            onStopAudio={stopAlarm}
            onTestAlarm={() => triggerAlarmSequence(dailyText)}
            onSnoozeMinutes={snoozeAlarm}
            onSnoozeUntilTime={snoozeUntilTime}
            onCancelSnooze={cancelSnooze}
            onArmAudio={armAlarmAudio}
            onDisarmAudio={disarmAlarmAudio}
            onOpenScheduleTab={() => setActiveTab('schedule')}
            onOpenLiveChat={() => {
              stopAlarm();
              setIsLiveChatOpen(true);
            }}
            isSelectedDateCompleted={completedDates.includes(selectedDate)}
            onToggleCompletedDate={toggleCompletedDate}
          />
        )}

        {activeTab === 'schedule' && (
          <ScheduleView
            settings={settings}
            onUpdateSettings={setSettings}
            notificationPermission={notificationPermission}
            onRequestNotifications={requestNotificationAccess}
            completedDates={completedDates}
            onToggleCompletedDate={toggleCompletedDate}
          />
        )}

        {activeTab === 'voice' && (
          <VoiceSettingsView settings={settings} onUpdateSettings={setSettings} />
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Navegación móvil"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 pb-safe border-t border-stone-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-[#101822]/95"
      >
        <div className="grid h-full grid-cols-3 items-center">
          <button
            type="button"
            onClick={() => setActiveTab('today')}
            className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'today'
                ? 'text-[#1E4D7B] dark:text-[#7AB3E8]'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <BookOpen className="h-5 w-5" aria-hidden="true" />
            <span className="text-[11px] font-semibold tracking-tight">Texto</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'schedule'
                ? 'text-[#1E4D7B] dark:text-[#7AB3E8]'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
            <span className="text-[11px] font-semibold tracking-tight">Horario</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('voice')}
            className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'voice'
                ? 'text-[#1E4D7B] dark:text-[#7AB3E8]'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
            <span className="text-[11px] font-semibold tracking-tight">Voz</span>
          </button>
        </div>
      </nav>

      {!isOnline && (
        <div className="fixed bottom-16 md:bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 shadow-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Sin conexión · Mostrando texto guardado</span>
        </div>
      )}

      <AlarmOverlay
        isOpen={isOverlayOpen}
        stage={alarmStage}
        now={now}
        dailyText={todayText || dailyText}
        voiceName={settings.voiceName}
        isAudioLoading={isAudioLoading}
        audioProgress={audioProgress}
        audioNotice={audioNotice}
        onStop={stopAlarm}
        onPause={pauseReading}
        onResume={resumeReading}
        onSnoozeMinutes={snoozeAlarm}
        onSnoozeUntilTime={snoozeUntilTime}
        onMinimize={() => setIsOverlayOpen(false)}
      />

      <LiveConversationModal
        isOpen={isLiveChatOpen}
        onClose={() => setIsLiveChatOpen(false)}
        dailyText={dailyText || todayText}
        voiceName={settings.voiceName}
      />
    </div>
  );
}
