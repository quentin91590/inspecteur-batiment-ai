import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { APP_VERSION, fetchPublishedVersion, reloadToVersion } from '../services/appVersion';

const AUTO_RELOAD_WINDOW_MS = 10_000; // juste après l'ouverture, on recharge sans demander
const CHECK_EVERY_MS = 5 * 60_000;

const visitRunning = () => !!document.querySelector('[data-testid="guided-visit"]');

/** Recharge l'appli quand une version plus récente est publiée (bandeau si l'inspecteur est en train de travailler). */
export const UpdateBanner: React.FC = () => {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    const openedAt = Date.now();
    let stopped = false;
    const check = async () => {
      const published = await fetchPublishedVersion();
      if (stopped || !published || published === APP_VERSION) return;
      if (Date.now() - openedAt < AUTO_RELOAD_WINDOW_MS && !visitRunning() && reloadToVersion(published)) return;
      setLatest(published);
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const id = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(id);
    };
  }, []);

  if (!latest) return null;
  const update = () => {
    try {
      sessionStorage.removeItem('inspecteur.reloadedFor');
    } catch {
      /* ignore */
    }
    reloadToVersion(latest);
  };
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-[500] w-[calc(100%-2rem)] max-w-sm" data-testid="update-banner">
      <div className="flex items-center gap-3 rounded-2xl bg-slate-900 text-white shadow-2xl px-4 py-3">
        <RefreshCw size={18} className="shrink-0 text-sky-300" />
        <p className="flex-1 text-sm font-semibold">Nouvelle version disponible</p>
        <button onClick={update} className="shrink-0 px-3 py-1.5 rounded-full bg-sky-400 text-slate-900 text-sm font-bold">
          Mettre à jour
        </button>
      </div>
    </div>
  );
};
