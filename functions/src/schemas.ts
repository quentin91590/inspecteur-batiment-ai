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
  required: ['instruction', 'detail', 'target', 'capture', 'captureReason', 'sceneQuality', 'seen'],
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
