import type { ModelInfo, Provider, Purpose } from './types.js';

/**
 * Catalogue des modèles proposés dans l'application.
 * Un modèle n'est « disponible » que si la clé de son fournisseur est configurée.
 * D'autres modèles peuvent être ajoutés sans redéployer via le document Firestore config/ai (champ extraModels).
 */
export const BUILTIN_MODELS: ModelInfo[] = [
  { id: 'gemini:gemini-3-flash-preview', provider: 'gemini', model: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', note: 'Modèle de la V1' },
  { id: 'gemini:gemini-3.8-flash', provider: 'gemini', model: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini:gemini-3.5-flash-lite', provider: 'gemini', model: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
  { id: 'gemini:gemini-3.1-flash-lite', provider: 'gemini', model: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', note: 'Rapide et économique' },
  { id: 'anthropic:claude-haiku-5-5', provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Le moins cher, très rapide' },
  { id: 'anthropic:claude-sonnet-5-5', provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Plus précis, plus cher' },
];

export const BUILTIN_DEFAULTS: Record<Purpose, string> = {
  analyze: 'gemini:gemini-3-flash-preview', // qualité connue de la V1
  text: 'gemini:gemini-3.1-flash-lite',
  guide: 'gemini:gemini-3.1-flash-lite', // rapidité avant tout
};

/** « qwen3.8-omni-flash|Qwen 3.8 Omni Flash, autre-modele » → modèles du fournisseur compatible OpenAI */
export function parseOpenAiModels(spec: string | undefined): ModelInfo[] {
  if (!spec) return [];
  return spec
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const [model, label] = entry.split('|').map(s => s.trim());
      return { id: `openai:${model}`, provider: 'openai' as Provider, model, label: label || model, note: 'Fournisseur compatible OpenAI' };
    });
}

export function parseModelId(id: string): { provider: Provider; model: string } | null {
  const idx = id.indexOf(':');
  if (idx <= 0) return null;
  const provider = id.slice(0, idx) as Provider;
  const model = id.slice(idx + 1);
  if (!['gemini', 'anthropic', 'openai'].includes(provider) || !model) return null;
  return { provider, model };
}
