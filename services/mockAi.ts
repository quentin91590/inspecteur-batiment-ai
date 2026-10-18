// IA simulée : utilisée en mode invité (démo) et pour les tests (VITE_AI_MOCK=1).
// Aucune donnée ne quitte le téléphone, les réponses sont fabriquées à partir du référentiel.
import type { AiRequest, AiResponse, ModelInfo, RawElement, SchemaDefinition } from './aiTypes';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let guideCounter = 0;
let stepCalls = 0;
let lastStep = '';
let analyzeCounter = 0;
let demoSpace = ''; // pièce simulée après « Pièce suivante »
let plateChecks = 0; // une photo de plaque sur deux est refusée (pour montrer la reprise)
const DEMO_SPACES = ['Couloir (démo)', 'Cuisine (démo)', 'Salle de bain (démo)'];

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

/** « Chauffage : Boiler (pas vu), Emetteur (manque Etat) » → premier élément de la ligne */
function parseMissingLine(line: string): { category: string; subCategory: string } | null {
  const m = line.match(/^(.+?) : (.+?) \(/);
  return m ? { category: m[1].trim(), subCategory: m[2].trim() } : null;
}

/** Éléments « visibles » simulés : les trois premiers éléments à relever, à des positions fixes de l'image. */
const DEMO_BOXES = [[300, 250, 620, 750], [380, 40, 640, 220], [80, 760, 320, 960]];
function demoElements(missing: string[], done: string[]) {
  const names: { category: string; element: string }[] = [];
  for (const line of missing) {
    const m = line.match(/^(.+?) : (.+)$/);
    if (!m) continue;
    for (const part of m[2].split(/\),\s*/)) {
      const el = part.split(' (')[0].trim();
      if (el) names.push({ category: m[1].trim(), element: el });
    }
  }
  return names
    .slice(0, 3)
    .map((n, i) => ({ ...n, label: n.element, box: DEMO_BOXES[i] }))
    .filter(e => !done.includes(e.label));
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
      await wait(350 + Math.random() * 300);
      guideCounter++;
      const base = {
        detail: 'Consignes simulées (mode démo)',
        captureReason: '',
        sceneQuality: 'ok' as const,
        seen: [] as { category: string; subCategory: string }[],
        spaceDone: false,
        nextSpace: '',
        targetBox: [] as number[],
        targetDirection: 'inconnu' as const,
        stepAbsent: false,
        nextCategory: '',
        nextElement: '',
        nextLabel: '',
        elements: demoElements(req.missing, req.elementsDoneHere ?? []),
      };
      if (!req.currentSpace && !(req.spacesVisited ?? []).length) demoSpace = ''; // nouvelle visite
      const space = demoSpace || req.currentSpace || 'Pièce (démo)';
      if (req.mode === 'parcours' && !(req.spacesVisited ?? []).length && !req.currentSpace) {
        return { guide: { ...base, instruction: 'Placez-vous face à l’entrée principale, côté rue', target: 'Façade — entrée principale', capture: false, space: 'Abords' }, meta: meta() };
      }
      if (req.requestNextSpace) {
        const next = DEMO_SPACES[(DEMO_SPACES.indexOf(demoSpace) + 1) % DEMO_SPACES.length];
        demoSpace = next; // les images suivantes montrent la nouvelle pièce
        return {
          guide: { ...base, elements: [], instruction: `Passez dans : ${next.replace(' (démo)', '').toLowerCase()}`, target: '', capture: false, space, spaceDone: true, nextSpace: next, targetDirection: 'droite' },
          meta: meta(),
        };
      }
      if (req.goingTo && !req.element) {
        return { guide: { ...base, instruction: `Avancez vers : ${req.goingTo.replace(' (démo)', '').toLowerCase()}`, target: '', capture: false, space }, meta: meta() };
      }
      // Séquence en cours : étape facultative « absente », sinon photo à la 2e image stable
      if (req.element) {
        const absent = !!req.stepOptional;
        stepCalls = req.step === lastStep ? stepCalls + 1 : 1;
        lastStep = req.step ?? '';
        const ready = !absent && stepCalls >= 2;
        return {
          guide: {
            ...base,
            instruction: ready ? 'Ne bougez plus' : `Cadrez : ${(req.step ?? '').toLowerCase()}`,
            target: `${req.element} — ${req.step}`,
            capture: ready,
            stepAbsent: absent,
            space,
            targetBox: ((globalThis as any).__demoTargetBox as number[] | undefined) ?? [320, 300, 600, 700], // réglable pour les tests
            targetDirection: 'ici',
          },
          meta: meta(),
        };
      }
      const target = req.missing.map(parseMissingLine).find(e => e && !(req.elementsDoneHere ?? []).some(d => d.toLowerCase().includes(e.subCategory.toLowerCase())));
      if (!target) {
        return {
          guide: { ...base, instruction: 'Pièce terminée : passez à la suivante', target: '', capture: false, space, spaceDone: true, nextSpace: 'Couloir (démo)' },
          meta: meta(),
        };
      }
      return {
        guide: {
          ...base,
          instruction: `Montrez ${target.subCategory.toLowerCase()}`,
          target: target.subCategory,
          capture: false,
          space,
          nextCategory: target.category,
          nextElement: target.subCategory,
          nextLabel: target.subCategory,
          targetBox: [300, 250, 620, 750],
          targetDirection: 'ici',
        },
        meta: meta(),
      };
    }

    case 'checkPhoto': {
      await wait(500);
      if (/plaque/i.test(req.step) && plateChecks++ % 2 === 0) {
        return { check: { ok: false, problem: 'plaque illisible', advice: 'Rapprochez-vous de la plaque' }, meta: meta() };
      }
      return { check: { ok: true, problem: '', advice: '' }, meta: meta() };
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
