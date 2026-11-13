import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlarmStage, AppSettings, DailyTextData, DayKey } from '../types';
import {
  type AudioPlaybackController,
  fetchGeminiTtsBase64,
  playBase64Wav,
  playChime,
  speakWithWebSpeech,
  startSilentKeepAlive,
  stopSilentKeepAlive,
  unlockAudioContext,
  updateMediaSession,
} from '../utils/audioEngine';
import {
  DEFAULT_SETTINGS,
  getLocalDateIso,
  getNextScheduledAlarm,
} from '../utils/scheduleHelpers';

const SETTINGS_STORAGE_KEY = 'texto_diario_settings_v1';
const LAST_FIRED_STORAGE_KEY = 'texto_diario_last_fired_v1';
const SNOOZE_STORAGE_KEY = 'texto_diario_snooze_v1';

function loadSavedSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      schedule: {
        ...DEFAULT_SETTINGS.schedule,
        ...(parsed.schedule || {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadSavedSnooze(): number | null {
  try {
    const raw = localStorage.getItem(SNOOZE_STORAGE_KEY);
    if (!raw) return null;
    const val = Number(raw);
    if (!Number.isFinite(val) || val <= Date.now()) {
      localStorage.removeItem(SNOOZE_STORAGE_KEY);
      return null;
    }
    return val;
  } catch {
    return null;
  }
}

export function useDailyAlarm(
  todayText: DailyTextData | null,
  onReadingCompleted?: (dateIso: string) => void
) {
  const [settings, setSettings] = useState<AppSettings>(loadSavedSettings);
  const [now, setNow] = useState<Date>(() => new Date());
  const [alarmStage, setAlarmStage] = useState<AlarmStage>('idle');
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isInlinePlaying, setIsInlinePlaying] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioProgress, setAudioProgress] = useState<{ current: number; duration: number }>({
    current: 0,
    duration: 0,
  });
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
  const [isAudioArmed, setIsAudioArmed] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [snoozeTargetMs, setSnoozeTargetMs] = useState<number | null>(loadSavedSnooze);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  const activeControllerRef = useRef<AudioPlaybackController | null>(null);
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);
  const sequenceRunIdRef = useRef(0);
  const prewarmedKeyRef = useRef<string | null>(null);
  const todayTextRef = useRef<DailyTextData | null>(todayText);
  todayTextRef.current = todayText;

  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const snoozeRef = useRef<number | null>(snoozeTargetMs);
  snoozeRef.current = snoozeTargetMs;

  const onReadingCompletedRef = useRef(onReadingCompleted);
  onReadingCompletedRef.current = onReadingCompleted;

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore storage quota errors
    }
  }, [settings]);

  // Persist snooze target
  useEffect(() => {
    try {
      if (snoozeTargetMs) {
        localStorage.setItem(SNOOZE_STORAGE_KEY, String(snoozeTargetMs));
      } else {
        localStorage.removeItem(SNOOZE_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [snoozeTargetMs]);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  const stopActiveAudio = useCallback(() => {
    sequenceRunIdRef.current += 1;
    if (activeControllerRef.current) {
      activeControllerRef.current.stop();
      activeControllerRef.current = null;
    }
    setIsAudioLoading(false);
    setAudioProgress({ current: 0, duration: 0 });
    updateMediaSession('Texto Diario', 'Examinemos las Escrituras', 'none');
  }, []);

  const stopAlarm = useCallback(() => {
    stopActiveAudio();
    setAlarmStage('idle');
    setIsInlinePlaying(false);
    setIsOverlayOpen(false);
    setSnoozeTargetMs(null);
  }, [stopActiveAudio]);

  const pauseReading = useCallback(() => {
    if (activeControllerRef.current) {
      activeControllerRef.current.pause();
      setAlarmStage('paused');
      updateMediaSession('Texto Diario (en pausa)', 'Toca para continuar', 'paused');
    }
  }, []);

  const resumeReading = useCallback(async () => {
    if (activeControllerRef.current) {
      await activeControllerRef.current.resume();
      setAlarmStage('reading');
      updateMediaSession('Texto Diario · Voz IA', 'Leyendo el texto del día', 'playing');
    }
  }, []);

  const speakPhrase = useCallback(
    async (
      text: string,
      runId: number,
      style: string,
      trackProgress = false,
      mediaTitle = 'Texto Diario · Voz IA'
    ): Promise<void> => {
      const currentSettings = settingsRef.current;
      let controller: AudioPlaybackController;

      try {
        setIsAudioLoading(true);
        const base64 = await fetchGeminiTtsBase64(
          text,
          currentSettings.voiceName,
          style
        );
        if (sequenceRunIdRef.current !== runId) {
          setIsAudioLoading(false);
          return;
        }
        setIsAudioLoading(false);
        controller = playBase64Wav(
          base64,
          currentSettings.speechRate,
          trackProgress
            ? (current, duration) => setAudioProgress({ current, duration })
            : undefined
        );
      } catch (err) {
        setIsAudioLoading(false);
        if (sequenceRunIdRef.current !== runId) return;
        const msg = err instanceof Error ? err.message : '';
        setAudioNotice(
          msg
            ? `Voz IA en línea no disponible (${msg}). Se usó la voz del dispositivo.`
            : 'Se usó la voz del dispositivo.'
        );
        controller = speakWithWebSpeech(text, currentSettings.speechRate);
      }

      if (sequenceRunIdRef.current !== runId) {
        controller.stop();
        return;
      }

      activeControllerRef.current = controller;
      updateMediaSession(
        mediaTitle,
        todayTextRef.current?.dateTitle || 'Examinemos las Escrituras',
        'playing',
        {
          onPause: () => pauseReading(),
          onPlay: () => {
            resumeReading();
          },
          onStop: () => stopAlarm(),
        }
      );

      await controller.finished;
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    },
    [pauseReading, resumeReading, stopAlarm]
  );

  const ensureTodayText = useCallback(async (): Promise<DailyTextData> => {
    if (todayTextRef.current && todayTextRef.current.date === getLocalDateIso()) {
      return todayTextRef.current;
    }
    const todayIso = getLocalDateIso();
    const res = await fetch(`/api/daily-text?date=${todayIso}`);
    if (!res.ok) {
      throw new Error('No se pudo cargar el texto diario de hoy.');
    }
    return (await res.json()) as DailyTextData;
  }, []);

  const triggerAlarmSequence = useCallback(
    async (overrideText?: DailyTextData | null) => {
      stopActiveAudio();
      const runId = sequenceRunIdRef.current;
      const currentSettings = settingsRef.current;

      setAudioNotice(null);
      setIsInlinePlaying(false);
      setIsOverlayOpen(true);
      setAlarmStage('ringing');
      setSnoozeTargetMs(null);

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification('Hora de leer el texto diario', {
            body: 'Tu lectura matutina con voz IA está comenzando.',
            icon: '/pwa-192x192.png',
            tag: 'texto-diario-alarm',
          });
        } catch {
          // ignore notification constructor errors in restricted contexts
        }
      }

      await unlockAudioContext();
      if (sequenceRunIdRef.current !== runId) return;

      await playChime(currentSettings.chimeType);
      if (sequenceRunIdRef.current !== runId) return;

      setAlarmStage('announcing');
      await speakPhrase(
        'Hora de leer el texto diario.',
        runId,
        'Voz amable, serena y clara que anuncia suavemente la alarma matutina en español.',
        false,
        'Hora de leer el texto diario'
      );
      if (sequenceRunIdRef.current !== runId) return;

      if (currentSettings.autoReadOnAlarm) {
        setAlarmStage('reading');
        try {
          const textData = overrideText || (await ensureTodayText());
          if (sequenceRunIdRef.current !== runId) return;
          await speakPhrase(
            textData.spokenText,
            runId,
            'Narrador humano muy cálido, amable y expresivo en español latinoamericano. Lee con entonación natural, pausas suaves y respiración tranquila, nunca monótono ni robótico.',
            true,
            'Leyendo el texto diario'
          );
          if (sequenceRunIdRef.current === runId) {
            onReadingCompletedRef.current?.(textData.date);
          }
        } catch (err) {
          setAudioNotice(
            err instanceof Error ? err.message : 'No se pudo obtener el texto para lectura.'
          );
        }
      }

      if (sequenceRunIdRef.current === runId) {
        setAlarmStage('idle');
        updateMediaSession('Texto Diario', 'Lectura finalizada', 'none');
      }
    },
    [ensureTodayText, speakPhrase, stopActiveAudio]
  );

  const playReadingOnly = useCallback(
    async (textData: DailyTextData) => {
      stopActiveAudio();
      const runId = sequenceRunIdRef.current;
      setAudioNotice(null);
      setIsOverlayOpen(false);
      setAlarmStage('reading');
      setIsInlinePlaying(true);

      await unlockAudioContext();
      if (sequenceRunIdRef.current !== runId) return;

      try {
        await speakPhrase(
          textData.spokenText,
          runId,
          'Narrador humano muy cálido, amable y expresivo en español latinoamericano. Lee con entonación natural, pausas suaves y respiración tranquila, nunca monótono ni robótico.',
          true,
          'Leyendo el texto diario'
        );
        if (sequenceRunIdRef.current === runId) {
          onReadingCompletedRef.current?.(textData.date);
        }
      } catch (err) {
        setAudioNotice(err instanceof Error ? err.message : 'Error al reproducir el audio.');
      }

      if (sequenceRunIdRef.current === runId) {
        setIsInlinePlaying(false);
        setAlarmStage('idle');
        updateMediaSession('Texto Diario', 'Lectura finalizada', 'none');
      }
    },
    [speakPhrase, stopActiveAudio]
  );

  const snoozeAlarm = useCallback(
    (minutes: number) => {
      const safeMinutes = Math.max(1, Math.round(minutes));
      stopActiveAudio();
      setAlarmStage('idle');
      setIsInlinePlaying(false);
      setIsOverlayOpen(false);
      setSnoozeTargetMs(Date.now() + safeMinutes * 60 * 1000);
    },
    [stopActiveAudio]
  );

  const snoozeUntilTime = useCallback(
    (timeHHMM: string) => {
      const [hh, mm] = timeHHMM.split(':').map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) return;
      const target = new Date();
      target.setHours(hh, mm, 0, 0);
      if (target.getTime() <= Date.now()) {
        target.setDate(target.getDate() + 1);
      }
      stopActiveAudio();
      setAlarmStage('idle');
      setIsInlinePlaying(false);
      setIsOverlayOpen(false);
      setSnoozeTargetMs(target.getTime());
    },
    [stopActiveAudio]
  );

  const cancelSnooze = useCallback(() => {
    setSnoozeTargetMs(null);
  }, []);

  const requestNotificationAccess = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return 'unsupported' as const;
    }
    const perm = await Notification.requestPermission();
    setNotificationPermission(perm);
    return perm;
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!settingsRef.current.keepScreenAwake) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      if (wakeLockSentinelRef.current) return;
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinelRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener('release', () => {
        wakeLockSentinelRef.current = null;
        setWakeLockActive(false);
      });
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockSentinelRef.current) {
      try {
        await wakeLockSentinelRef.current.release();
      } catch {
        // ignore
      }
      wakeLockSentinelRef.current = null;
    }
    setWakeLockActive(false);
  }, []);

  const armAlarmAudio = useCallback(async () => {
    const unlocked = await unlockAudioContext();
    await startSilentKeepAlive();
    setIsAudioArmed(unlocked);
    if (settingsRef.current.keepScreenAwake) {
      await acquireWakeLock();
    }
    fetchGeminiTtsBase64(
      'Hora de leer el texto diario.',
      settingsRef.current.voiceName,
      'Voz amable, serena y clara que anuncia suavemente la alarma matutina en español.'
    ).catch(() => {});
  }, [acquireWakeLock]);

  const disarmAlarmAudio = useCallback(async () => {
    setIsAudioArmed(false);
    stopSilentKeepAlive();
    await releaseWakeLock();
  }, [releaseWakeLock]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isAudioArmed && settingsRef.current.keepScreenAwake) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [acquireWakeLock, isAudioArmed]);

  // Main 1-second scheduler loop
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = new Date();
      setNow(current);

      const s = settingsRef.current;
      const pendingSnooze = snoozeRef.current;

      if (pendingSnooze && current.getTime() >= pendingSnooze) {
        setSnoozeTargetMs(null);
        triggerAlarmSequence();
        return;
      }

      if (!s.alarmMasterEnabled) return;

      const dayKey = String(current.getDay()) as DayKey;
      const sched = s.schedule[dayKey];
      if (!sched || !sched.enabled) return;

      const currentHHMM = `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`;
      const todayKey = `${getLocalDateIso(current)}::${currentHHMM}`;

      const oneMinAhead = new Date(current.getTime() + 60000);
      const aheadHHMM = `${String(oneMinAhead.getHours()).padStart(2, '0')}:${String(oneMinAhead.getMinutes()).padStart(2, '0')}`;
      const aheadKey = `${getLocalDateIso(oneMinAhead)}::${aheadHHMM}`;
      if (
        String(oneMinAhead.getDay()) === dayKey &&
        sched.time === aheadHHMM &&
        prewarmedKeyRef.current !== aheadKey
      ) {
        prewarmedKeyRef.current = aheadKey;
        fetchGeminiTtsBase64(
          'Hora de leer el texto diario.',
          s.voiceName,
          'Voz amable, serena y clara que anuncia suavemente la alarma matutina en español.'
        ).catch(() => {});
        if (todayTextRef.current) {
          fetchGeminiTtsBase64(
            todayTextRef.current.spokenText,
            s.voiceName,
            'Lectura devocional pausada, cálida y bien articulada en español latinoamericano.'
          ).catch(() => {});
        }
      }

      if (sched.time === currentHHMM && current.getSeconds() < 15) {
        const lastFired = localStorage.getItem(LAST_FIRED_STORAGE_KEY);
        if (lastFired !== todayKey) {
          localStorage.setItem(LAST_FIRED_STORAGE_KEY, todayKey);
          triggerAlarmSequence();
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [triggerAlarmSequence]);

  const nextAlarm = getNextScheduledAlarm(settings, now);

  return {
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
    setAudioNotice,
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
  };
}
