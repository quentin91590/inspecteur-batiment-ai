import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { defineInt, defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { AiError, handleAiRequest, type CoreDeps, type RemoteConfig } from './core.js';
import type { AiMeta, Purpose } from './types.js';

initializeApp();
const db = getFirestore();

// --- Clé Gemini (Secret Manager). Pour l'instant tout passe par Google.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// Pour réactiver Claude ou un fournisseur compatible OpenAI (Qwen, Infomaniak…) plus tard :
//   const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');  + l'ajouter à `secrets` et à `keys` ci-dessous
//   const OPENAI_COMPAT_API_KEY = defineSecret('OPENAI_COMPAT_API_KEY');  + OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_MODELS (defineString)
// App Check : mettre ENFORCE_APP_CHECK=true dans functions/.env une fois la clé reCAPTCHA configurée dans l'appli
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';
const MIN_INSTANCES = defineInt('AI_MIN_INSTANCES', { default: 0 });

// --- Réglages Firestore (config/ai), relus au plus toutes les 60 s
let configCache: { at: number; value: RemoteConfig } | null = null;
async function loadConfig(): Promise<RemoteConfig> {
  if (configCache && Date.now() - configCache.at < 60_000) return configCache.value;
  const snap = await db.doc('config/ai').get();
  const value = (snap.exists ? snap.data() : {}) as RemoteConfig;
  configCache = { at: Date.now(), value };
  return value;
}

// --- Quota journalier par utilisateur (compteurs en mémoire + Firestore)
const quotaCache = new Map<string, { day: string; counts: Record<Purpose, number> }>();
const today = () => new Date().toISOString().slice(0, 10);

async function checkQuota(uid: string, purpose: Purpose, limit: number): Promise<void> {
  const day = today();
  let entry = quotaCache.get(uid);
  if (!entry || entry.day !== day) {
    const snap = await db.doc(`usage/${uid}/days/${day}`).get();
    const d = (snap.data() ?? {}) as Record<string, any>;
    entry = {
      day,
      counts: { analyze: d.analyze?.count ?? 0, text: d.text?.count ?? 0, guide: d.guide?.count ?? 0 },
    };
    quotaCache.set(uid, entry);
  }
  if (entry.counts[purpose] >= limit) {
    throw new AiError('resource-exhausted', `Quota journalier atteint (${limit} appels « ${purpose} »). Réessayez demain.`);
  }
  entry.counts[purpose]++;
}

function recordUsage(uid: string, purpose: Purpose, meta: AiMeta): void {
  const modelKey = meta.model.replace(/[^a-zA-Z0-9_-]/g, '_');
  const inc = (n?: number) => FieldValue.increment(n ?? 0);
  db.doc(`usage/${uid}/days/${today()}`)
    .set(
      {
        [purpose]: { count: inc(1), inputTokens: inc(meta.inputTokens), outputTokens: inc(meta.outputTokens) },
        models: { [modelKey]: { count: inc(1), inputTokens: inc(meta.inputTokens), outputTokens: inc(meta.outputTokens), latencyMsTotal: inc(meta.latencyMs) } },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(err => logger.warn('Usage non enregistré', err));
}

export const ai = onCall(
  {
    region: 'europe-west6', // Zurich
    secrets: [GEMINI_API_KEY],
    enforceAppCheck: ENFORCE_APP_CHECK,
    minInstances: MIN_INSTANCES,
    memory: '512MiB',
    timeoutSeconds: 120,
    concurrency: 40,
  },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise pour utiliser l’IA.');

    const deps: CoreDeps = {
      keys: { gemini: GEMINI_API_KEY.value() },
      loadConfig,
      checkQuota,
      recordUsage,
    };

    try {
      return await handleAiRequest(request.data, request.auth.uid, deps);
    } catch (err) {
      if (err instanceof AiError) {
        if (err.code === 'internal' || err.code === 'unavailable') logger.error(err.message);
        throw new HttpsError(err.code, err.message);
      }
      logger.error('Erreur inattendue', err);
      throw new HttpsError('internal', 'Erreur interne du serveur IA');
    }
  },
);
