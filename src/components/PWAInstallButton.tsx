import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#1E4D7B] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#163B5E] dark:bg-[#2F6BA3] dark:hover:bg-[#3A7BB8] whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Instalar app
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Instalar en iPhone
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <h3
                  id="ios-install-title"
                  className="font-display text-lg font-semibold text-slate-900 dark:text-white"
                >
                  Instalar en iPhone o iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Cerrar guía"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-stone-100 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-300">
                <li className="flex items-start gap-2.5">
                  <span className="font-semibold text-[#1E4D7B] dark:text-[#6DA6DB]">1.</span>
                  <span>
                    Toca el botón <strong className="inline-flex items-center gap-1 font-semibold">Compartir <Share className="h-3.5 w-3.5 inline" /></strong> en la barra inferior de Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-semibold text-[#1E4D7B] dark:text-[#6DA6DB]">2.</span>
                  <span>
                    Desliza hacia abajo y selecciona <strong className="font-semibold">Agregar a inicio</strong>.
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-[#1E4D7B] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#163B5E] dark:bg-[#2F6BA3] cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
