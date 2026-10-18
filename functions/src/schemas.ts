// Schémas JSON des réponses attendues.
// Écrits pour être acceptés par les sorties structurées de Claude
// (additionalProperties: false, pas de minimum/maximum) ; adaptés à la volée pour Gemini.

export type JsonSchema = Record<string, unknown>;

const ELEMENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', description: 'Catégorie exacte du référentiel, ou « Non catégorisé »' },
    subCategory: { type: 'string', description: 'Élément (sous-catégorie) exact du référentiel' },
    attributes: {
      type: 'array',
      description: 'Attributs techniques détectés (nom/valeur), valeurs prises dans le référentiel',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['name', 'value'],
        additionalProperties: false,
      },
    },
    confiance: { type: 'number', description: 'Confiance entre 0 et 1' },
    commentaire: { type: 'string' },
    conditionScore: { type: 'number', description: 'Vétusté sur 100 : 0 = hors service, 100 = neuf' },
    isPrimarySubject: { type: 'boolean' },
  },
  required: ['category', 'subCategory', 'attributes', 'confiance', 'commentaire', 'conditionScore', 'isPrimarySubject'],
  additionalProperties: false,
};

export const ANALYSIS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    elements: { type: 'array', items: ELEMENT_SCHEMA },
  },
  required: ['elements'],
  additionalProperties: false,
};

export const GUIDE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    instruction: { type: 'string', description: 'Consigne affichée à l’écran, impérative, 12 mots maximum' },
    detail: { type: 'string', description: 'Précision facultative (15 mots maximum) ou chaîne vide' },
    target: { type: 'string', description: 'Élément visé par la consigne ou la capture' },
    capture: { type: 'boolean', description: 'true pour déclencher une photo haute définition maintenant' },
    captureReason: { type: 'string' },
    sceneQuality: { type: 'string', enum: ['ok', 'sombre', 'flou', 'loin', 'proche', 'hors_sujet'] },
    space: { type: 'string', description: 'Type d’espace où se trouve l’inspecteur (Chambre, Couloir, Chaufferie, Façade…)' },
    spaceDone: { type: 'boolean', description: 'true si tout ce qui est utile dans cet espace est relevé' },
    nextSpace: { type: 'string', description: 'Espace suivant conseillé, ou chaîne vide' },
    targetBox: {
      type: 'array',
      description: 'Cadre de l’élément visé [ymin, xmin, ymax, xmax] normalisé de 0 à 1000 ; tableau vide s’il n’est pas visible',
      items: { type: 'integer' },
    },
    targetDirection: { type: 'string', enum: ['ici', 'gauche', 'droite', 'haut', 'bas', 'derriere', 'inconnu'] },
    stepAbsent: { type: 'boolean', description: 'true si l’étape facultative en cours n’existe pas ici' },
    nextCategory: { type: 'string', description: 'Sans élément en cours : catégorie exacte du prochain élément, sinon chaîne vide' },
    nextElement: { type: 'string', description: 'Sans élément en cours : élément exact du référentiel, sinon chaîne vide' },
    elements: {
      type: 'array',
      description: 'Tous les éléments du référentiel visibles, une entrée par variante distincte (10 maximum)',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          element: { type: 'string' },
          label: { type: 'string', description: 'Libellé court qui distingue la variante (« Parquet chêne », « Peinture blanche »)' },
          box: { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax] de 0 à 1000' },
        },
        required: ['category', 'element', 'label', 'box'],
        additionalProperties: false,
      },
    },
    seen: {
      type: 'array',
      description: 'Éléments du référentiel clairement visibles sur l’image',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          subCategory: { type: 'string' },
        },
        required: ['category', 'subCategory'],
        additionalProperties: false,
      },
    },
  },
  required: ['instruction', 'detail', 'target', 'capture', 'captureReason', 'sceneQuality', 'space', 'spaceDone', 'nextSpace', 'targetBox', 'targetDirection', 'stepAbsent', 'nextCategory', 'nextElement', 'elements', 'seen'],
  additionalProperties: false,
};

export const CHECK_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'true si la photo est exploitable pour l’étape' },
    problem: { type: 'string', description: 'Problème en 2 à 5 mots, chaîne vide si ok' },
    advice: { type: 'string', description: 'Consigne courte pour reprendre la photo, chaîne vide si ok' },
  },
  required: ['ok', 'problem', 'advice'],
  additionalProperties: false,
};

/** Gemini n'a pas besoin de additionalProperties : on le retire pour rester dans le sous-ensemble sûr. */
export function forGemini(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'additionalProperties') continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(schema) as JsonSchema;
}
