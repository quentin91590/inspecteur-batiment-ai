// IA simulée : utilisée en mode invité (démo) et pour les tests (VITE_AI_MOCK=1).
// Aucune donnée ne quitte le téléphone, les réponses sont fabriquées à partir du référentiel.
import type { AiRequest, AiResponse, ModelInfo, RawElement, SchemaDefinition } from './aiTypes';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let guideCounter = 0;
let analyzeCounter = 0;

export const DEMO_MODEL_ID = 'demo:simulation';

const MOCK_MODELS: ModelInfo[] = [
  { id: DEMO_MODEL_ID, provider: 'gemini', model: 'simulation', label: 'IA simulée (démo)', available: true },
];

function pickValue(values: string[], seed: number): string {
  if (!values.length) return '';
  if (values[0].startsWith('Numeric:')) {
    const parts = values[0].replace('Numeric:', '').split(':').map(Number);
    const min = parts[0];
    const max = parts[parts.length - 1];
    if (min >= 1800 && max > 1900) return String(1990 + ((seed * 7) % 30));
    return String(Math.max(min, Math.round(min + (max - min) * 0.05)));
  }
  const real = values.filter(v => v !== 'Mixte');
  return real[seed % Math.max(1, real.length)] ?? values[0];
}

function parseMissingLine(line: string): { category: string; subCategory: string } | null {
  const m = line.match(/^(.+?) \/ (.+?) :/);
  return m ? { category: m[1].trim(), subCategory: m[2].trim() } : null;
}

function allEntries(schema: SchemaDefinition) {
  return Object.entries(schema).flatMap(([category, subs]) => Object.keys(subs).map(subCategory => ({ category, subCategory })));
}

function elementFor(schema: SchemaDefinition, category: string, subCategory: string, seed: number): RawElement {
  const attrs = schema[category]?.[subCategory] ?? {};
  const score = 45 + ((seed * 17) % 50);
  return {
    category,
    subCategory,
    attributes: Object.entries(attrs)
      .filter(([name]) => name !== 'Etat')
      .map(([name, values]) => ({ name, value: pickValue(values, seed) })),
    confiance: 0.8,
    commentaire: `Analyse simulée (mode démo) de « ${subCategory} ».`,
    conditionScore: score,
    isPrimarySubject: true,
  };
}

function findMentioned(schema: SchemaDefinition, text: string) {
  const lower = text.toLowerCase();
  return allEntries(schema).find(e => lower.includes(e.subCategory.toLowerCase()));
}

export async function handle(req: AiRequest): Promise<AiResponse> {
  const started = Date.now();
  const meta = () => ({ model: DEMO_MODEL_ID, provider: 'gemini' as const, latencyMs: Date.now() - started });

  switch (req.task) {
    case 'models':
      return { models: MOCK_MODELS, defaults: { analyze: DEMO_MODEL_ID, text: DEMO_MODEL_ID, guide: DEMO_MODEL_ID } };

    case 'guide': {
      await wait(450 + Math.random() * 350);
      guideCounter++;
      const target = req.missing.map(parseMissingLine).find(e => e && !req.inProgress.some(t => t.startsWith(e.subCategory)));
      if (!target) {
        return {
          guide: {
            instruction: 'Zone terminée : choisissez une autre zone',
            detail: 'Tous les éléments de la zone sont relevés ou en cours d’analyse.',
            target: '',
            capture: false,
            captureReason: '',
            sceneQuality: 'ok',
            seen: [],
          },
          meta: meta(),
        };
      }
      const step = guideCounter % 3;
      const capture = step === 0;
      const label = target.subCategory.toLowerCase();
      const instruction = capture
        ? `Ne bougez plus : photo de ${label}`
        : step === 1
          ? `Montrez-moi ${label}`
          : `Approchez-vous de ${label}`;
      return {
        guide: {
          instruction,
          detail: 'Consignes simulées (mode démo)',
          target: `${target.subCategory} — vue d’ensemble`,
          capture,
          captureReason: capture ? 'Élément bien cadré' : '',
          sceneQuality: 'ok',
          seen: capture ? [target] : [],
        },
        meta: meta(),
      };
    }

    case 'analyzeImage': {
      await wait(800);
      analyzeCounter++;
      const entries = allEntries(req.schema);
      const hinted = req.hint ? findMentioned(req.schema, req.hint.split('—')[0]) : undefined;
      const pick = hinted ?? entries[analyzeCounter % Math.max(1, entries.length)];
      if (!pick) return { elements: [], meta: meta() };
      return { elements: [elementFor(req.schema, pick.category, pick.subCategory, analyzeCounter)], meta: meta() };
    }

    case 'analyzeText': {
      await wait(500);
      analyzeCounter++;
      const mentioned = findMentioned(req.schema, req.text);
      const year = req.text.match(/\b(18|19|20)\d{2}\b/)?.[0];
      if (!mentioned) {
        return {
          elements: [{ category: 'Non catégorisé', subCategory: '', attributes: [], confiance: 0.5, commentaire: req.text, conditionScore: 50, isPrimarySubject: true }],
          meta: meta(),
        };
      }
      return {
        elements: [{
          category: mentioned.category,
          subCategory: mentioned.subCategory,
          attributes: year ? [{ name: 'Année', value: year }] : [],
          confiance: 0.7,
          commentaire: req.text,
          conditionScore: 50,
          isPrimarySubject: true,
        }],
        meta: meta(),
      };
    }

    case 'summarize': {
      await wait(300);
      const bullets = req.comment
        .split(/[.;\n]+/)
        .map(s => s.replace(/^\[[^\]]*\]:?\s*/, '').trim())
        .filter(Boolean)
        .map(s => `- ${s.charAt(0).toUpperCase()}${s.slice(1)}`);
      return { text: bullets.join('\n') || req.comment, meta: meta() };
    }
  }
}
