import React, { useState } from 'react';
import { Loader2, Moon, Sun, Volume2 } from 'lucide-react';
import type { AppSettings, ChimeType, VoiceName } from '../types';
import {
  fetchGeminiTtsBase64,
  playBase64Wav,
  playChime,
  speakWithWebSpeech,
  unlockAudioContext,
} from '../utils/audioEngine';
import { CHIME_OPTIONS, VOICE_OPTIONS } from '../utils/scheduleHelpers';

interface VoiceSettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const VoiceSettingsView: React.FC<VoiceSettingsViewProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [testingVoice, setTestingVoice] = useState<VoiceName | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const previewVoice = async (voiceName: VoiceName) => {
    setTestingVoice(voiceName);
    setPreviewError(null);
    await unlockAudioContext();
    try {
      const base64 = await fetchGeminiTtsBase64(
        'Hora de leer el texto diario. Escoge la vida y mantente cerca de Jehová.',
        voiceName,
        'Voz amable, serena y natural en español latinoamericano.'
      );
      const ctrl = playBase64Wav(base64, settings.speechRate);
      await ctrl.finished;
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : 'Se reprodujo con la voz del dispositivo.'
      );
      const fallback = speakWithWebSpeech('Hora de leer el texto diario.', settings.speechRate);
      await fallback.finished.catch(() => {});
    } finally {
      setTestingVoice(null);
    }
  };

  const previewChime = async (chimeType: ChimeType) => {
    await unlockAudioContext();
    await playChime(chimeType);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
      {/* Voice Selection */}
      <section className="lg:col-span-7 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
        <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
          Voz de IA y sonido
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Elige la voz que anunciará la alarma y leerá el texto diario automáticamente.
        </p>

        <div className="mt-5 divide-y divide-stone-200 dark:divide-slate-800">
          {VOICE_OPTIONS.map((voice) => {
            const isSelected = settings.voiceName === voice.id;
            const isTesting = testingVoice === voice.id;
            return (
              <div
                key={voice.id}
                className="flex items-center justify-between gap-3 py-3.5 min-h-[60px]"
              >
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings((prev) => ({ ...prev, voiceName: voice.id }))
                  }
                  className="flex flex-1 items-center gap-3 text-left cursor-pointer"
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      isSelected
                        ? 'border-[#1E4D7B] bg-[#1E4D7B] dark:border-[#5B9BD5] dark:bg-[#5B9BD5]'
                        : 'border-stone-300 dark:border-slate-600'
                    }`}
                  >
                    {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  <div>
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                      {voice.label}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {voice.desc}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => previewVoice(voice.id)}
                  disabled={testingVoice !== null}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-stone-200 bg-[#F8F7F4] px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-stone-200/70 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isTesting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5" />
                  )}
                  {isTesting ? 'Sonando...' : 'Escuchar'}
                </button>
              </div>
            );
          })}
        </div>

        {previewError && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{previewError}</p>
        )}

        {/* Speech speed */}
        <div className="mt-6 pt-5 border-t border-stone-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                Velocidad de lectura
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Ajusta el ritmo de la narración.
              </span>
            </div>
            <div className="inline-flex items-center gap-1 rounded-xl bg-stone-200/70 p-1 dark:bg-slate-800">
              {[0.9, 1.0, 1.1, 1.2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() =>
                    onUpdateSettings((prev) => ({ ...prev, speechRate: rate }))
                  }
                  className={`min-h-[36px] rounded-lg px-2.5 text-xs font-semibold tabular-nums transition-colors cursor-pointer ${
                    settings.speechRate === rate
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  {rate.toFixed(1)}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Right: Chime & Behavior preferences */}
      <aside className="lg:col-span-5 space-y-5">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26]">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Sonidito inicial de alarma
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Suena brevemente antes de decir “Hora de leer el texto diario”.
          </p>

          <div className="mt-4 space-y-2.5">
            {CHIME_OPTIONS.map((chime) => {
              const selected = settings.chimeType === chime.id;
              return (
                <div
                  key={chime.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                    selected
                      ? 'border-[#1E4D7B] bg-[#1E4D7B]/5 dark:border-[#5B9BD5] dark:bg-[#5B9BD5]/10'
                      : 'border-stone-200 dark:border-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings((prev) => ({ ...prev, chimeType: chime.id }))
                    }
                    className="flex-1 text-left cursor-pointer"
                  >
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                      {chime.label}
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {chime.desc}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => previewChime(chime.id)}
                    className="min-h-[38px] rounded-lg border border-stone-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
                  >
                    Probar
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#131C26] space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                Lectura automática al sonar
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Lee el texto diario completo tras el anuncio inicial.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoReadOnAlarm}
              onClick={() =>
                onUpdateSettings((prev) => ({
                  ...prev,
                  autoReadOnAlarm: !prev.autoReadOnAlarm,
                }))
              }
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                settings.autoReadOnAlarm
                  ? 'bg-[#1E4D7B] dark:bg-[#2F6BA3]'
                  : 'bg-stone-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  settings.autoReadOnAlarm ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 pt-4 border-t border-stone-200 dark:border-slate-800">
            <div>
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                Mantener pantalla activa
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Evita que el celular suspenda la app en modo espera.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.keepScreenAwake}
              onClick={() =>
                onUpdateSettings((prev) => ({
                  ...prev,
                  keepScreenAwake: !prev.keepScreenAwake,
                }))
              }
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                settings.keepScreenAwake
                  ? 'bg-[#1E4D7B] dark:bg-[#2F6BA3]'
                  : 'bg-stone-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  settings.keepScreenAwake ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 pt-4 border-t border-stone-200 dark:border-slate-800">
            <div>
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                Apariencia nocturna
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Ideal si dejas el teléfono en tu mesa de noche.
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings((prev) => ({
                  ...prev,
                  theme: prev.theme === 'dark' ? 'light' : 'dark',
                }))
              }
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {settings.theme === 'dark' ? (
                <>
                  <Sun className="h-4 w-4 text-amber-400" />
                  Modo claro
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-[#1E4D7B]" />
                  Modo oscuro
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
