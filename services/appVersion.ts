// Version de l'application et détection d'une version plus récente publiée.
// Le navigateur du téléphone peut garder l'ancienne page en mémoire (onglet repris, cache de 10 min de GitHub Pages) :
// on compare la version embarquée avec version.json, publié à chaque déploiement et lu sans cache.

declare const __APP_VERSION__: string;
declare const __BUILT_AT__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const BUILT_AT: string = typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : '';

const isDevBuild = () => APP_VERSION.startsWith('dev');

/** Version publiée, ou null si inconnue (développement, hors réseau…). */
export async function fetchPublishedVersion(timeoutMs = 4000): Promise<string | null> {
  if (isDevBuild()) return null;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.version === 'string' ? json.version : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Charge la version publiée (adresse unique pour contourner le cache), une seule tentative par version. */
export function reloadToVersion(version: string): boolean {
  const key = `inspecteur.reloadedFor`;
  try {
    if (sessionStorage.getItem(key) === version) return false; // déjà essayé : pas de boucle
    sessionStorage.setItem(key, version);
  } catch {
    /* stockage indisponible : on tente quand même */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('v', version);
  window.location.replace(url.toString());
  return true;
}

/** Libellé court affiché dans l'appli (ex : « 5cd44ea · 18 oct. 19:20 »). */
export function versionLabel(): string {
  if (isDevBuild()) return 'développement';
  const d = BUILT_AT ? new Date(BUILT_AT) : null;
  const when = d && !isNaN(d.getTime())
    ? d.toLocaleString('fr-CH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
  return when ? `${APP_VERSION} · ${when}` : APP_VERSION;
}
