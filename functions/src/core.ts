import { BUILTIN_DEFAULTS, BUILTIN_MODELS, parseModelId, parseOpenAiModels } from './models.js';
import {
  analysisSystem,
  analyzeImageUser,
  analyzeTextUser,
  CHECK_SYSTEM,
  checkPhotoUser,
  guideSystem,
  guideUser,
  summarizePrompt,
} from './prompts.js';
import { generate, providerAvailable, ProviderError, type GenerateParams, type ProviderKeys } from './providers.js';
import { ANALYSIS_SCHEMA, CHECK_SCHEMA, GUIDE_SCHEMA } from './schemas.js';
import type {
  AiMeta,
  AiRequest,
  AiResponse,
  GuideResult,
  ModelInfo,
  Purpose,
  RawElement,
  SceneQuality,
  SchemaDefinition,
  TargetDirection,
} from './types.js';

/** Réglages modifiables sans redéployer : document Firestore config/ai */
export interface RemoteConfig {
  defaults?: Partial<Record<Purpose, string>>;
  extraModels?: ModelInfo[];
  limits?: Partial<Record<Purpose, number>>;
  /** false = l'application ne peut pas choisir son modèle (seuls les défauts s'appliquent) */
  allowClientModelChoice?: boolean;
}

export const DEFAULT_LIMITS: Record<Purpose, number> = {
  guide: 4000, // ~2 h de visite guidée par jour et par utilisateur
  analyze: 800,
  text: 400,
};

export interface CoreDeps {
  keys: ProviderKeys;
  openaiModels?: string;
  loadConfig: () => Promise<RemoteConfig>;
  checkQuota: (uid: string, purpose: Purpose, limit: number) => Promise<void>;
  recordUsage: (uid: string, purpose: Purpose, meta: AiMeta) => void;
  generateFn?: typeof generate; // injectable pour les tests
}

export type AiErrorCode = 'invalid-argument' | 'resource-exhausted' | 'failed-precondition' | 'internal' | 'unavailable' | 'deadline-exceeded';

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string) {
    super(message);
  }
}

const MAX_IMAGE_CHARS = 6_000_000; // ~4,5 Mo de JPEG
const MAX_TEXT = 8_000;

// ------------------------------------------------------------------ validation

function str(v: unknown, field: string, max = MAX_TEXT, required = true): string {
  if (v === undefined || v === null || v === '') {
    if (required) throw new AiError('invalid-argument', `Champ manquant : ${field}`);
    return '';
  }
  if (typeof v !== 'string') throw new AiError('invalid-argument', `Champ invalide : ${field}`);
  return v.length > max ? v.slice(0, max) : v;
}

function image(v: unknown): string {
  const s = str(v, 'image', MAX_IMAGE_CHARS + 100);
  if (s.length > MAX_IMAGE_CHARS) throw new AiError('invalid-argument', 'Image trop lourde');
  const b64 = s.includes(',') ? s.slice(s.indexOf(',') + 1) : s;
  return b64.replace(/\s+/g, '');
}

function schemaOf(v: unknown): SchemaDefinition {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AiError('invalid-argument', 'Référentiel manquant');
  const json = JSON.stringify(v);
  if (json.length > 200_000) throw new AiError('invalid-argument', 'Référentiel trop volumineux');
  return v as SchemaDefinition;
}

function strList(v: unknown, max = 40): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string').slice(0, max).map(x => (x as string).slice(0, 300));
}

// ------------------------------------------------------------------ modèles

export function catalog(deps: CoreDeps, config: RemoteConfig): ModelInfo[] {
  const all = [...BUILTIN_MODELS, ...parseOpenAiModels(deps.openaiModels), ...(config.extraModels ?? [])];
  const seen = new Set<string>();
  return all
    .filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .map(m => ({ ...m, available: providerAvailable(m.provider, deps.keys) }));
}

export function resolveModel(
  requested: string | undefined,
  purpose: Purpose,
  deps: CoreDeps,
  config: RemoteConfig,
): ModelInfo {
  const models = catalog(deps, config);
  const byId = (id?: string) => (id ? models.find(m => m.id === id && m.available) : undefined);

  if (requested && config.allowClientModelChoice !== false) {
    const m = byId(requested);
    if (m) return m;
    // Modèle hors catalogue mais d'un fournisseur configuré : accepté seulement s'il est explicitement ajouté (extraModels).
  }
  const preferred = byId(config.defaults?.[purpose]) ?? byId(BUILTIN_DEFAULTS[purpose]);
  if (preferred) return preferred;
  const anyAvailable = models.find(m => m.available);
  if (anyAvailable) return anyAvailable;
  throw new AiError('failed-precondition', "Aucune clé d'IA n'est configurée sur le serveur.");
}

export function defaultsFor(deps: CoreDeps, config: RemoteConfig): Record<Purpose, string> {
  const out = {} as Record<Purpose, string>;
  for (const purpose of ['analyze', 'text', 'guide'] as Purpose[]) {
    try {
      out[purpose] = resolveModel(undefined, purpose, deps, config).id;
    } catch {
      out[purpose] = '';
    }
  }
  return out;
}

// ------------------------------------------------------------------ parsing

export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* on essaie de nettoyer */
  }
  const unfenced = trimmed.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    /* dernier essai : premier bloc {…} ou […] */
  }
  const start = unfenced.search(/[[{]/);
  const end = Math.max(unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      /* rien */
    }
  }
  throw new AiError('internal', "Réponse de l'IA illisible (JSON invalide)");
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeElements(parsed: unknown): RawElement[] {
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as any).elements)
      ? (parsed as any).elements
      : parsed && typeof parsed === 'object'
        ? [parsed]
        : [];

  return list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map(e => {
      let attributes: { name: string; value: string }[] = [];
      if (Array.isArray(e.attributes)) {
        attributes = (e.attributes as any[])
          .filter(a => a && a.name !== undefined && a.value !== undefined && String(a.value).trim() !== '')
          .map(a => ({ name: String(a.name), value: String(a.value) }));
      } else if (e.attributes && typeof e.attributes === 'object') {
        attributes = Object.entries(e.attributes as Record<string, unknown>).map(([name, value]) => ({ name, value: String(value) }));
      }
      return {
        category: String(e.category ?? '').trim(),
        subCategory: String(e.subCategory ?? '').trim(),
        attributes,
        confiance: Math.min(1, Math.max(0, num(e.confiance, 0.5))),
        commentaire: String(e.commentaire ?? ''),
        conditionScore: Math.min(100, Math.max(0, num(e.conditionScore, 50))),
        isPrimarySubject: Boolean(e.isPrimarySubject),
      };
    });
}

const QUALITIES: SceneQuality[] = ['ok', 'sombre', 'flou', 'loin', 'proche', 'hors_sujet'];
const DIRECTIONS: TargetDirection[] = ['ici', 'gauche', 'droite', 'haut', 'bas', 'derriere', 'inconnu'];

/** Cadre [ymin, xmin, ymax, xmax] sur 0-1000, ou [] s'il est absent / incohérent. */
export function normalizeBox(v: unknown): number[] {
  if (!Array.isArray(v) || v.length !== 4) return [];
  const n = v.map(x => (typeof x === 'number' ? x : parseFloat(String(x))));
  if (n.some(x => !Number.isFinite(x))) return [];
  // Certains modèles répondent en 0-1 : on remet à l'échelle
  const scaled = n.every(x => x >= 0 && x <= 1) && n.some(x => x > 0) ? n.map(x => x * 1000) : n;
  const [ymin, xmin, ymax, xmax] = scaled.map(x => Math.round(Math.min(1000, Math.max(0, x))));
  if (ymax - ymin < 8 || xmax - xmin < 8) return [];
  return [ymin, xmin, ymax, xmax];
}

export function normalizeGuide(parsed: unknown): GuideResult {
  const g = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
  const quality = String(g.sceneQuality ?? 'ok') as SceneQuality;
  const seen = Array.isArray(g.seen)
    ? (g.seen as any[])
        .filter(s => s && s.category && s.subCategory)
        .slice(0, 10)
        .map(s => ({ category: String(s.category), subCategory: String(s.subCategory) }))
    : [];
  const direction = String(g.targetDirection ?? '').toLowerCase().replace('è', 'e') as TargetDirection;
  const targetBox = normalizeBox(g.targetBox);
  return {
    instruction: clip(g.instruction, 140) || 'Continuez à filmer lentement',
    detail: clip(g.detail, 160),
    target: clip(g.target, 120),
    capture: g.capture === true || g.capture === 'true',
    captureReason: clip(g.captureReason, 160),
    sceneQuality: QUALITIES.includes(quality) ? quality : 'ok',
    seen,
    space: clip(g.space, 60),
    spaceDone: g.spaceDone === true || g.spaceDone === 'true',
    nextSpace: clip(g.nextSpace, 80),
    targetBox,
    targetDirection: targetBox.length ? 'ici' : DIRECTIONS.includes(direction) ? direction : 'inconnu',
    stepAbsent: g.stepAbsent === true || g.stepAbsent === 'true',
    nextCategory: clip(g.nextCategory, 80),
    nextElement: clip(g.nextElement, 120),
    nextLabel: clip(g.nextLabel, 60),
    elements: Array.isArray(g.elements)
      ? (g.elements as any[])
          .filter(e => e && e.category && (e.label || e.element))
          .slice(0, 12)
          .map(e => ({
            category: clip(e.category, 80),
            element: clip(e.element, 120),
            label: clip(e.label || e.element, 60),
            box: normalizeBox(e.box),
          }))
          .filter(e => e.box.length === 4)
      : [],
  };
}

/** En cas de doute (réponse illisible), la photo est acceptée : on ne bloque jamais l'inspecteur. */
export function normalizeCheck(parsed: unknown): { ok: boolean; problem: string; advice: string } {
  const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
  const c = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const ok = !(c.ok === false || c.ok === 'false');
  return { ok, problem: ok ? '' : clip(c.problem, 80), advice: ok ? '' : clip(c.advice, 120) };
}

// ------------------------------------------------------------------ point d'entrée

function purposeOf(task: AiRequest['task']): Purpose | null {
  if (task === 'analyzeImage') return 'analyze';
  if (task === 'guide' || task === 'checkPhoto') return 'guide'; // modèle rapide, quota du guidage
  if (task === 'analyzeText' || task === 'summarize') return 'text';
  return null;
}

export async function handleAiRequest(data: unknown, uid: string, deps: CoreDeps): Promise<AiResponse> {
  if (!data || typeof data !== 'object') throw new AiError('invalid-argument', 'Requête vide');
  const req = data as AiRequest;
  const config = await deps.loadConfig().catch(() => ({}) as RemoteConfig);

  if (req.task === 'models') {
    return { models: catalog(deps, config), defaults: defaultsFor(deps, config) };
  }

  const purpose = purposeOf(req.task);
  if (!purpose) throw new AiError('invalid-argument', `Tâche inconnue : ${(req as any).task}`);

  // Construction de l'appel
  let params: Omit<GenerateParams, 'provider' | 'model'>;
  switch (req.task) {
    case 'analyzeImage':
      params = {
        system: analysisSystem(schemaOf(req.schema)),
        user: analyzeImageUser(str(req.note, 'note', 2000, false), str(req.hint, 'hint', 200, false)),
        imageB64: image(req.image),
        schema: ANALYSIS_SCHEMA,
        speed: 'normal',
      };
      break;
    case 'analyzeText':
      params = {
        system: analysisSystem(schemaOf(req.schema)),
        user: analyzeTextUser(str(req.text, 'text')),
        schema: ANALYSIS_SCHEMA,
        speed: 'normal',
      };
      break;
    case 'summarize':
      params = {
        system: 'Tu es un expert en pathologie du bâtiment. Tu réponds en français.',
        user: summarizePrompt(str(req.comment, 'comment'), str(req.category, 'category', 200), str(req.subCategory, 'subCategory', 200)),
        speed: 'fast',
      };
      break;
    case 'checkPhoto':
      params = {
        system: CHECK_SYSTEM,
        user: checkPhotoUser(
          str(req.element, 'element', 120),
          str(req.step, 'step', 120),
          str(req.aim, 'aim', 300, false),
          req.optional === true,
        ),
        imageB64: image(req.image),
        schema: CHECK_SCHEMA,
        speed: 'fast',
      };
      break;
    case 'guide':
      params = {
        system: guideSystem(schemaOf(req.schema)),
        user: guideUser({
          task: 'guide',
          image: '',
          schema: {},
          mode: req.mode === 'parcours' ? 'parcours' : 'libre',
          theme: str(req.theme ?? req.zone, 'theme', 200, false) || 'Tout le bâtiment',
          stage: str(req.stage, 'stage', 200, false),
          nextStage: str(req.nextStage, 'nextStage', 200, false),
          currentSpace: str(req.currentSpace, 'currentSpace', 80, false),
          spacesVisited: strList(req.spacesVisited, 30),
          requestNextSpace: req.requestNextSpace === true,
          missing: strList(req.missing),
          recorded: strList(req.recorded, 60),
          inProgress: strList(req.inProgress, 20),
          transcript: str(req.transcript, 'transcript', 1500, false),
          lastInstruction: str(req.lastInstruction, 'lastInstruction', 200, false),
          lastTarget: str(req.lastTarget, 'lastTarget', 200, false),
          element: str(req.element, 'element', 120, false),
          elementCategory: str(req.elementCategory, 'elementCategory', 120, false),
          step: str(req.step, 'step', 120, false),
          stepIndex: typeof req.stepIndex === 'number' ? req.stepIndex : undefined,
          stepCount: typeof req.stepCount === 'number' ? req.stepCount : undefined,
          stepAim: str(req.stepAim, 'stepAim', 300, false),
          stepOptional: req.stepOptional === true,
          nextSteps: strList(req.nextSteps, 10),
          elementsDoneHere: strList(req.elementsDoneHere, 30),
          spotted: strList(req.spotted, 40),
          goingTo: str(req.goingTo, 'goingTo', 80, false),
        }),
        imageB64: image(req.image),
        schema: GUIDE_SCHEMA,
        speed: 'fast',
      };
      break;
  }

  const model = resolveModel(req.model, purpose, deps, config);
  await deps.checkQuota(uid, purpose, config.limits?.[purpose] ?? DEFAULT_LIMITS[purpose]);

  const started = Date.now();
  let out;
  try {
    out = await (deps.generateFn ?? generate)({ ...params, provider: model.provider, model: model.model }, deps.keys);
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.status === 429) throw new AiError('resource-exhausted', `${err.message} (quota 429 du fournisseur)`);
      if (err.status === 412) throw new AiError('failed-precondition', err.message);
      if (err.status === 400 || err.status === 404) throw new AiError('invalid-argument', err.message);
      if (err.status && err.status >= 500) throw new AiError('unavailable', err.message);
      throw new AiError('internal', err.message);
    }
    throw err;
  }

  const meta: AiMeta = {
    model: model.id,
    provider: model.provider,
    latencyMs: Date.now() - started,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    cachedTokens: out.cachedTokens,
  };
  deps.recordUsage(uid, purpose, meta);

  if (req.task === 'summarize') {
    const text = out.text.replace(/```(?:markdown)?/gi, '').trim();
    return { text, meta };
  }
  if (req.task === 'checkPhoto') {
    let parsed: unknown = {};
    try {
      parsed = parseJsonLoose(out.text);
    } catch {
      /* réponse illisible : la photo est acceptée */
    }
    return { check: normalizeCheck(parsed), meta };
  }
  const parsed = parseJsonLoose(out.text);
  if (req.task === 'guide') return { guide: normalizeGuide(parsed), meta };
  return { elements: normalizeElements(parsed), meta };
}
