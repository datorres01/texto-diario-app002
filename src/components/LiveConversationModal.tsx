import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, PhoneOff, Radio, X } from 'lucide-react';
import type { DailyTextData, VoiceName } from '../types';

interface LiveConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  dailyText: DailyTextData | null;
  voiceName: VoiceName;
}

interface TranscriptEntry {
  id: number;
  speaker: 'user' | 'ai';
  text: string;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

export const LiveConversationModal: React.FC<LiveConversationModalProps> = ({
  isOpen,
  onClose,
  dailyText,
  voiceName,
}) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const queuedSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const isMutedRef = useRef<boolean>(false);
  const transcriptIdRef = useRef<number>(1);

  isMutedRef.current = isMuted;

  const clearQueuedPlayback = useCallback(() => {
    for (const src of queuedSourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // ignore already-stopped nodes
      }
    }
    queuedSourcesRef.current = [];
    nextStartTimeRef.current = 0;
    setIsAiSpeaking(false);
  }, []);

  const teardownSession = useCallback(() => {
    clearQueuedPlayback();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  }, [clearQueuedPlayback]);

  const appendTranscript = useCallback((speaker: 'user' | 'ai', text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text} ${clean}`.replace(/\s+/g, ' ').trim() },
        ];
      }
      return [...prev, { id: transcriptIdRef.current++, speaker, text: clean }];
    });
  }, []);

  const schedulePcmChunk = useCallback((base64Audio: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;

    const floatData = pcm16Base64ToFloat32(base64Audio);
    if (floatData.length === 0) return;

    const audioBuffer = outCtx.createBuffer(1, floatData.length, 24000);
    audioBuffer.getChannelData(0).set(floatData);

    const src = outCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(outCtx.destination);

    const now = outCtx.currentTime;
    if (nextStartTimeRef.current < now) {
      nextStartTimeRef.current = now + 0.02;
    }

    const startAt = nextStartTimeRef.current;
    nextStartTimeRef.current = startAt + audioBuffer.duration;
    queuedSourcesRef.current.push(src);
    setIsAiSpeaking(true);

    src.onended = () => {
      queuedSourcesRef.current = queuedSourcesRef.current.filter((item) => item !== src);
      if (queuedSourcesRef.current.length === 0) {
        setIsAiSpeaking(false);
      }
    };

    src.start(startAt);
  }, []);

  const startSession = useCallback(async () => {
    teardownSession();
    setStatus('connecting');
    setErrorMsg(null);
    setTranscripts([]);

    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const inputCtx = new Ctx({ sampleRate: 16000 });
      const outputCtx = new Ctx({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/api/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        const dailyContext = dailyText
          ? `${dailyText.dateTitle}\nCita: ${dailyText.themeScripture}\nComentario: ${dailyText.bodyParagraphs.join(' ')}`
          : '';
        ws.send(
          JSON.stringify({
            type: 'init',
            voiceName,
            dailyContext,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            ready?: boolean;
            audio?: string;
            inputTranscript?: string;
            outputTranscript?: string;
            interrupted?: boolean;
            error?: string;
            closed?: boolean;
          };

          if (msg.ready) {
            setStatus('active');
            // Begin microphone capture once Live session is open
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            sourceNodeRef.current = source;
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (isMutedRef.current) return;
              if (ws.readyState !== WebSocket.OPEN) return;
              const pcmBase64 = float32ToPcm16Base64(e.inputBuffer.getChannelData(0));
              ws.send(JSON.stringify({ audio: pcmBase64 }));
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          }

          if (msg.audio) {
            schedulePcmChunk(msg.audio);
          }
          if (msg.interrupted) {
            clearQueuedPlayback();
          }
          if (msg.inputTranscript) {
            appendTranscript('user', msg.inputTranscript);
          }
          if (msg.outputTranscript) {
            appendTranscript('ai', msg.outputTranscript);
          }
          if (msg.error) {
            setErrorMsg(msg.error);
            setStatus('error');
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        setErrorMsg('No se pudo conectar con el servicio de voz en vivo.');
        setStatus('error');
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
        }
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Permite el acceso al micrófono para iniciar la conversación.';
      setErrorMsg(msg);
      setStatus('error');
      teardownSession();
    }
  }, [appendTranscript, clearQueuedPlayback, dailyText, schedulePcmChunk, teardownSession, voiceName]);

  useEffect(() => {
    if (isOpen) {
      startSession();
    } else {
      teardownSession();
      setStatus('idle');
    }
    return () => {
      teardownSession();
    };
  }, [isOpen, startSession, teardownSession]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-voice-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-2xl border border-stone-200 bg-white shadow-xl dark:border-slate-800 dark:bg-[#131C26]">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-stone-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2
              id="live-voice-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-white"
            >
              Conversar sobre el texto
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Voz en tiempo real · {dailyText?.dateTitle || 'Texto del día'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar conversación"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-stone-100 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {status === 'connecting' && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#1E4D7B] dark:text-[#7AB3E8]" />
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                Conectando micrófono y voz en vivo...
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
              <p>{errorMsg || 'Ocurrió un problema al iniciar la conversación.'}</p>
              <button
                type="button"
                onClick={startSession}
                className="mt-3 inline-flex min-h-[40px] items-center rounded-lg bg-[#1E4D7B] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                Reintentar conexión
              </button>
            </div>
          )}

          {status === 'active' && (
            <div className="rounded-xl border border-stone-200 bg-[#F8F7F4] p-4 dark:border-slate-800 dark:bg-[#0D141C]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <Radio
                    className={`h-4 w-4 ${
                      isAiSpeaking
                        ? 'text-[#1E4D7B] dark:text-[#7AB3E8]'
                        : isMuted
                        ? 'text-slate-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  />
                  <span>
                    {isAiSpeaking
                      ? 'Respondiendo en voz...'
                      : isMuted
                      ? 'Micrófono silenciado'
                      : 'Escuchando · Habla cuando quieras'}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Pregunta por el significado, cómo aplicarlo hoy o pide un resumen breve. Puedes interrumpir hablando en cualquier momento.
              </p>
            </div>
          )}

          {transcripts.length > 0 && (
            <div className="space-y-3 pt-1">
              {transcripts.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    item.speaker === 'user'
                      ? 'ml-6 bg-[#1E4D7B] text-white dark:bg-[#2F6BA3]'
                      : 'mr-6 border border-stone-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-[#192430] dark:text-slate-100'
                  }`}
                >
                  <span className="block text-[11px] font-semibold opacity-75 mb-1">
                    {item.speaker === 'user' ? 'Tú' : `Voz IA (${voiceName})`}
                  </span>
                  {item.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="flex items-center gap-3 border-t border-stone-200 px-6 py-4 pb-safe dark:border-slate-800">
          <button
            type="button"
            onClick={() => setIsMuted((prev) => !prev)}
            disabled={status !== 'active'}
            className={`flex flex-1 min-h-[48px] items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
              isMuted
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100'
                : 'border-stone-300 bg-white text-slate-800 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {isMuted ? (
              <>
                <MicOff className="h-4 w-4" />
                Activar micrófono
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                Silenciar micrófono
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex flex-1 min-h-[48px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white cursor-pointer"
          >
            <PhoneOff className="h-4 w-4" />
            Terminar
          </button>
        </div>
      </div>
    </div>
  );
};
