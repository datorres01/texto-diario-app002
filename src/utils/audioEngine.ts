import type { ChimeType, VoiceName } from '../types';

let sharedAudioCtx: AudioContext | null = null;
let keepAliveOsc: OscillatorNode | null = null;
let keepAliveGain: GainNode | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

export async function unlockAudioContext(): Promise<boolean> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    return true;
  } catch {
    return false;
  }
}

export async function startSilentKeepAlive(): Promise<boolean> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (keepAliveOsc) return true;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(20, ctx.currentTime);
    gain.gain.setValueAtTime(0.00001, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    keepAliveOsc = osc;
    keepAliveGain = gain;
    return true;
  } catch {
    return false;
  }
}

export function stopSilentKeepAlive(): void {
  try {
    if (keepAliveOsc) {
      keepAliveOsc.stop();
      keepAliveOsc.disconnect();
      keepAliveOsc = null;
    }
    if (keepAliveGain) {
      keepAliveGain.disconnect();
      keepAliveGain = null;
    }
  } catch {
    keepAliveOsc = null;
    keepAliveGain = null;
  }
}

export function updateMediaSession(
  title: string,
  subtitle: string,
  state: 'playing' | 'paused' | 'none',
  handlers?: {
    onPlay?: () => void;
    onPause?: () => void;
    onStop?: () => void;
  }
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    if (state === 'none') {
      navigator.mediaSession.playbackState = 'none';
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: subtitle,
      album: 'Texto Diario · jw.org',
      artwork: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    navigator.mediaSession.playbackState = state;
    navigator.mediaSession.setActionHandler('play', handlers?.onPlay || null);
    navigator.mediaSession.setActionHandler('pause', handlers?.onPause || null);
    navigator.mediaSession.setActionHandler('stop', handlers?.onStop || null);
  } catch {
    // ignore browser mediaSession errors
  }
}

export async function playChime(type: ChimeType): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }

  const now = ctx.currentTime;

  const scheduleTone = (freq: number, startOffset: number, duration: number, peakGain: number) => {
    const osc = ctx.createOscillator();
    const harmonic = ctx.createOscillator();
    const gain = ctx.createGain();
    const harmGain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + startOffset);

    harmonic.type = 'triangle';
    harmonic.frequency.setValueAtTime(freq * 2, now + startOffset);

    gain.gain.setValueAtTime(0.0001, now + startOffset);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

    harmGain.gain.setValueAtTime(0.0001, now + startOffset);
    harmGain.gain.exponentialRampToValueAtTime(peakGain * 0.18, now + startOffset + 0.02);
    harmGain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration * 0.6);

    osc.connect(gain);
    harmonic.connect(harmGain);
    harmGain.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + startOffset);
    harmonic.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.05);
    harmonic.stop(now + startOffset + duration + 0.05);
  };

  let totalMs = 1800;

  if (type === 'chime') {
    scheduleTone(523.25, 0.0, 1.0, 0.24);
    scheduleTone(659.25, 0.28, 1.1, 0.22);
    scheduleTone(783.99, 0.56, 1.4, 0.2);
    totalMs = 1950;
  } else if (type === 'harp') {
    scheduleTone(440.0, 0.0, 0.9, 0.18);
    scheduleTone(554.37, 0.18, 0.9, 0.18);
    scheduleTone(659.25, 0.36, 1.0, 0.19);
    scheduleTone(880.0, 0.54, 1.3, 0.17);
    totalMs = 1900;
  } else {
    scheduleTone(587.33, 0.0, 0.85, 0.22);
    scheduleTone(587.33, 0.55, 1.1, 0.22);
    totalMs = 1650;
  }

  await new Promise((resolve) => setTimeout(resolve, totalMs));
}

const clientAudioCache = new Map<string, string>();

export function stripParenthesesForSpeech(input: string): string {
  let cleaned = input;
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/\([^()]*\)/g, ' ').replace(/\[[^[\]]*\]/g, ' ');
  }
  return cleaned
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+([.,;:!?»”])/g, '$1')
    .replace(/([.,;:!?])\s*\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchGeminiTtsBase64(
  text: string,
  voiceName: VoiceName,
  style?: string
): Promise<string> {
  const cleanText = stripParenthesesForSpeech(text);
  const key = `v2::${voiceName}::${style || ''}::${cleanText}`;
  const cached = clientAudioCache.get(key);
  if (cached) return cached;

  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanText, voiceName, style }),
  });

  if (!response.ok) {
    let errMsg = `Error de voz IA (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) errMsg = data.error;
    } catch {
      // ignore json parse failure
    }
    throw new Error(errMsg);
  }

  const data = (await response.json()) as { audioBase64?: string };
  if (!data.audioBase64) {
    throw new Error('No se recibió audio del servidor.');
  }

  if (clientAudioCache.size >= 15) {
    const firstKey = clientAudioCache.keys().next().value;
    if (firstKey) clientAudioCache.delete(firstKey);
  }
  clientAudioCache.set(key, data.audioBase64);
  return data.audioBase64;
}

export interface AudioPlaybackController {
  pause: () => void;
  resume: () => Promise<void>;
  stop: () => void;
  setRate: (rate: number) => void;
  finished: Promise<void>;
}

export function playBase64Wav(
  base64Audio: string,
  playbackRate = 1.0,
  onProgress?: (current: number, duration: number) => void
): AudioPlaybackController {
  const binary = atob(base64Audio);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'audio/wav' });
  const objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(objectUrl);
  audio.playbackRate = playbackRate;

  let stopped = false;

  const cleanup = () => {
    URL.revokeObjectURL(objectUrl);
  };

  if (onProgress) {
    audio.addEventListener('timeupdate', () => {
      onProgress(audio.currentTime || 0, audio.duration || 0);
    });
  }

  const finished = new Promise<void>((resolve, reject) => {
    audio.addEventListener('ended', () => {
      cleanup();
      resolve();
    });
    audio.addEventListener('error', () => {
      cleanup();
      if (!stopped) {
        reject(new Error('No se pudo reproducir el archivo de audio.'));
      } else {
        resolve();
      }
    });
    audio.play().catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error('El navegador bloqueó la reproducción automática.'));
    });
  });

  return {
    pause: () => {
      audio.pause();
    },
    resume: async () => {
      await audio.play();
    },
    stop: () => {
      stopped = true;
      audio.pause();
      audio.currentTime = 0;
      cleanup();
    },
    setRate: (rate: number) => {
      audio.playbackRate = rate;
    },
    finished,
  };
}

export function speakWithWebSpeech(text: string, rate = 1.0): AudioPlaybackController {
  let cancelled = false;

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return {
      pause: () => {},
      resume: async () => {},
      stop: () => {},
      setRate: () => {},
      finished: Promise.reject(new Error('Síntesis de voz no disponible en este navegador.')),
    };
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-MX';
  utterance.rate = rate;

  const voices = window.speechSynthesis.getVoices();
  const spanishVoice =
    voices.find((v) => v.lang.startsWith('es-419') || v.lang.startsWith('es-MX') || v.lang.startsWith('es-US')) ||
    voices.find((v) => v.lang.startsWith('es'));
  if (spanishVoice) {
    utterance.voice = spanishVoice;
  }

  const finished = new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (ev) => {
      if (cancelled) {
        resolve();
      } else {
        reject(new Error(`Error en voz del dispositivo: ${ev.error}`));
      }
    };
    window.speechSynthesis.speak(utterance);
  });

  return {
    pause: () => {
      window.speechSynthesis.pause();
    },
    resume: async () => {
      window.speechSynthesis.resume();
    },
    stop: () => {
      cancelled = true;
      window.speechSynthesis.cancel();
    },
    setRate: () => {},
    finished,
  };
}
