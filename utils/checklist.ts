import type { InspectionItem, QueueItem, SchemaDefinition } from '../types';

export const ALL_ZONES = '__ALL__';
export const ALL_ZONES_LABEL = 'Tout le bâtiment';

/** Attributs du référentiel encore vides pour un élément. */
export const getMissingAttributes = (item: InspectionItem, schema: SchemaDefinition): string[] => {
  // Les éléments hors référentiel sont considérés complets (rien à valider)
  if (item.category === 'Non catégorisé') return [];
  const subDef = schema[item.category]?.[item.subCategory];
  if (!subDef) return [];
  return Object.keys(subDef).filter(key => {
    const val = item.attributes[key];
    return !val || val.trim() === '' || val === 'Non défini';
  });
};

export interface ChecklistEntry {
  category: string;
  subCategory: string;
  status: 'absent' | 'incomplet' | 'complet';
  missingAttributes: string[];
}

export interface Checklist {
  entries: ChecklistEntry[];
  total: number;
  done: number;
}

/** État du référentiel pour une zone (catégorie) ou pour tout le bâtiment. */
export function buildChecklist(schema: SchemaDefinition, items: Record<string, InspectionItem>, zone: string): Checklist {
  const all = Object.values(items);
  const cats = zone === ALL_ZONES ? Object.keys(schema) : [zone].filter(c => schema[c]);
  const entries: ChecklistEntry[] = [];
  for (const cat of cats) {
    for (const sub of Object.keys(schema[cat] ?? {})) {
      const item = all.find(i => i.category === cat && i.subCategory === sub);
      if (!item) {
        entries.push({ category: cat, subCategory: sub, status: 'absent', missingAttributes: Object.keys(schema[cat][sub]) });
        continue;
      }
      const missing = getMissingAttributes(item, schema);
      entries.push({ category: cat, subCategory: sub, status: missing.length ? 'incomplet' : 'complet', missingAttributes: missing });
    }
  }
  return { entries, total: entries.length, done: entries.filter(e => e.status === 'complet').length };
}

/** Lignes « À relever » envoyées au modèle de guidage (les plus utiles d'abord). */
export function missingLines(checklist: Checklist, max = 25): string[] {
  const absent = checklist.entries.filter(e => e.status === 'absent').map(e => `${e.category} / ${e.subCategory} : pas encore vu`);
  const incomplete = checklist.entries
    .filter(e => e.status === 'incomplet')
    .map(e => `${e.category} / ${e.subCategory} : manque ${e.missingAttributes.join(', ')}`);
  return [...incomplete, ...absent].slice(0, max);
}

/** Captures de la visite guidée dont l'analyse détaillée n'est pas terminée. */
export function inProgressTargets(queue: QueueItem[]): string[] {
  return queue
    .filter(q => q.source === 'guided' && q.status !== 'error' && q.target)
    .map(q => q.target as string)
    .slice(-15);
}
