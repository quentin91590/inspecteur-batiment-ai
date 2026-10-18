// Accès à l'IA depuis l'application : tout passe par la fonction serveur « ai » (aucune clé dans l'appli).
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebaseConfig';
import type { InspectionResult, SchemaDefinition } from '../types';
import type { AiMeta, AiRequest, AiResponse, GuideRequest, GuideResult, ModelInfo, PhotoCheck, Purpose, RawElement } from './aiTypes';
import * as mock from './mockAi';

export type { AiMeta, GuideResult, ModelInfo, PhotoCheck, Purpose } from './aiTypes';

// ------------------------------------------------------------------ mode démo

const FORCED_MOCK = import.meta.env.VITE_AI_MOCK === '1';
let demoMode = FORCED_MOCK;
/** Mode invité : IA simulée (la fonction serveur exige un compte connecté). */
export const setDemoMode = (on: boolean) => {
  demoMode = on || FORCED_MOCK;
  modelsCache = null;
};
export const isDemoMode = () => demoMode;

// ------------------------------------------------------------------ erreurs

export type AiErrorKind = 'quota' | 'auth' | 'config' | 'network' | 'other';

export class AiCallError extends Error {
  constructor(public kind: AiErrorKind, message: string) {
    super(message);
  }
}

function normalizeError(err: any): AiCallError {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? err ?? 'Erreur inconnue');
  if (code.endsWith('resource-exhausted')) return new AiCallError('quota', `Quota atteint : ${msg}`);
  if (code.endsWith('unauthenticated')) return new AiCallError('auth', 'Connectez-vous pour utiliser l’IA.');
  if (code.endsWith('failed-precondition')) return new AiCallError('config', msg);
  if (
    !navigator.onLine ||
    code.endsWith('unavailable') ||
    code.endsWith('deadline-exceeded') ||
    (code.endsWith('internal') && msg.trim().toLowerCase() === 'internal')
  ) {
    return new AiCallError('network', 'Réseau indisponible');
  }
  return new AiCallError('other', msg);
}

// ------------------------------------------------------------------ appel

const callable = httpsCallable<AiRequest, AiResponse>(functions, 'ai', { timeout: 120_000 });

async function callAi(req: AiRequest): Promise<AiResponse> {
  if (demoMode) return mock.handle(req);
  try {
    const res = await callable(req);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

// ------------------------------------------------------------------ choix des modèles (par appareil)

const PREFS_KEY = 'inspecteur.v2.aiModels';
export type ModelPrefs = Partial<Record<Purpose, string>>;

export function getModelPrefs(): ModelPrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as ModelPrefs;
  } catch {
    return {};
  }
}

export function setModelPrefs(prefs: ModelPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
  sessionPrefs = prefs;
}

let sessionPrefs: ModelPrefs | null = null;
const prefFor = (purpose: Purpose): string | undefined => (sessionPrefs ?? getModelPrefs())[purpose] || undefined;

let modelsCache: { at: number; value: { models: ModelInfo[]; defaults: Record<Purpose, string> } } | null = null;

export async function listModels(force = false): Promise<{ models: ModelInfo[]; defaults: Record<Purpose, string> }> {
  if (!force && modelsCache && Date.now() - modelsCache.at < 5 * 60_000) return modelsCache.value;
  const res = await callAi({ task: 'models' });
  const value = { models: res.models ?? [], defaults: res.defaults ?? ({} as Record<Purpose, string>) };
  modelsCache = { at: Date.now(), value };
  return value;
}

/** « gemini:gemini-3.1-flash-lite » → « Gemini 3.1 Flash-Lite » */
export function modelLabel(id: string | undefined, models?: ModelInfo[]): string {
  if (!id) return '—';
  const found = (models ?? modelsCache?.value.models ?? []).find(m => m.id === id);
  if (found) return found.label;
  if (id === mock.DEMO_MODEL_ID) return 'IA simulée';
  return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
}

/** Prix publics (USD par million de tokens) pour estimer le coût dans le banc d'essai. */
export const MODEL_PRICES: Record<string, { in: number; out: number; cached?: number }> = {
  'gemini:gemini-3-flash-preview': { in: 0.5, out: 3 },
  'gemini:gemini-3.8-flash': { in: 0.75, out: 3.75 },
  'gemini:gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
  'gemini:gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
  'anthropic:claude-haiku-5-5': { in: 0.1, out: 0.5, cached: 0.01 },
  'anthropic:claude-sonnet-5-5': { in: 2, out: 10, cached: 0.1 },
};

export function estimateCostUsd(meta?: AiMeta): number | null {
  if (!meta) return null;
  const price = MODEL_PRICES[meta.model];
  if (!price || meta.inputTokens === undefined || meta.outputTokens === undefined) return null;
  const cached = Math.min(meta.cachedTokens ?? 0, meta.inputTokens);
  const fresh = meta.inputTokens - cached;
  return (fresh * price.in + cached * (price.cached ?? price.in) + meta.outputTokens * price.out) / 1_000_000;
}

// ------------------------------------------------------------------ conversion des résultats

const UNKNOWN = ['inconnu', 'unknown', 'n/a', 'non défini', 'undefined', ''];

export function toInspectionResult(raw: RawElement): InspectionResult {
  const attributes: Record<string, string> = {};
  (raw.attributes ?? []).forEach(a => {
    if (a?.name && a.value !== undefined && String(a.value).trim() !== '') attributes[a.name] = String(a.value);
  });

  let category = String(raw.category || '').trim();
  let subCategory = String(raw.subCategory || '').trim();
  let isPrimary = Boolean(raw.isPrimarySubject);

  // Éléments hors référentiel : un élément distinct par détection
  if (UNKNOWN.includes(category.toLowerCase()) || category === 'Non catégorisé') {
    category = 'Non catégorisé';
    const stamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    subCategory = `Objet détecté ${stamp}`;
    isPrimary = true;
  }

  return {
    category,
    subCategory,
    attributes,
    confiance: typeof raw.confiance === 'number' ? raw.confiance : 0.5,
    commentaire: String(raw.commentaire || ''),
    isPrimarySubject: isPrimary,
    conditionScore: typeof raw.conditionScore === 'number' ? raw.conditionScore : undefined,
  };
}

const stripDataUrl = (b64: string) => (b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64).replace(/\s+/g, '');

// ------------------------------------------------------------------ fonctions utilisées par l'application

export interface AnalysisOutput {
  results: InspectionResult[];
  meta?: AiMeta;
}

export async function analyzeInspectionImage(
  imageBase64: string,
  schema: SchemaDefinition,
  onProgress?: (step: string) => void,
  opts: { note?: string; hint?: string; model?: string } = {},
): Promise<AnalysisOutput> {
  onProgress?.(demoMode ? 'Analyse simulée…' : 'Envoi au serveur IA…');
  const res = await callAi({
    task: 'analyzeImage',
    image: stripDataUrl(imageBase64),
    schema,
    note: opts.note,
    hint: opts.hint,
    model: opts.model ?? prefFor('analyze'),
  });
  onProgress?.('Validation des résultats…');
  return { results: (res.elements ?? []).map(toInspectionResult), meta: res.meta };
}

export async function analyzeInspectionText(
  text: string,
  schema: SchemaDefinition,
  onProgress?: (step: string) => void,
): Promise<AnalysisOutput> {
  onProgress?.('Analyse de la note vocale…');
  const res = await callAi({ task: 'analyzeText', text, schema, model: prefFor('text') });
  return { results: (res.elements ?? []).map(toInspectionResult), meta: res.meta };
}

export async function summarizeInspectionComment(currentComment: string, category: string, subCategory: string): Promise<string> {
  if (!currentComment || currentComment.trim() === '') return currentComment;
  try {
    const res = await callAi({ task: 'summarize', comment: currentComment, category, subCategory, model: prefFor('text') });
    return res.text?.trim() || currentComment;
  } catch (e) {
    console.error('Synthèse impossible', e);
    return currentComment;
  }
}

export async function guideFrame(
  req: Omit<GuideRequest, 'task' | 'model'>,
): Promise<{ guide: GuideResult; meta?: AiMeta }> {
  const res = await callAi({ ...req, image: stripDataUrl(req.image), task: 'guide', model: prefFor('guide') });
  if (!res.guide) throw new AiCallError('other', 'Réponse de guidage vide');
  return { guide: res.guide, meta: res.meta };
}

/** Contrôle rapide d'une photo d'étape prise à la main (modèle du guidage). */
export async function checkStepPhoto(
  imageBase64: string,
  info: { element: string; step: string; aim?: string; optional?: boolean },
): Promise<{ check: PhotoCheck; meta?: AiMeta }> {
  const res = await callAi({ task: 'checkPhoto', image: stripDataUrl(imageBase64), ...info, model: prefFor('guide') });
  return { check: res.check ?? { ok: true, problem: '', advice: '' }, meta: res.meta };
}

/** Banc d'essai : même photo, modèle imposé. */
export async function benchAnalyze(imageBase64: string, schema: SchemaDefinition, model: string): Promise<AnalysisOutput> {
  const res = await callAi({ task: 'analyzeImage', image: stripDataUrl(imageBase64), schema, model });
  return { results: (res.elements ?? []).map(toInspectionResult), meta: res.meta };
}
