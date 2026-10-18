import type { InspectionItem, QueueItem, SchemaDefinition } from '../types';

export const ALL_ZONES = '__ALL__';
export const ALL_ZONES_LABEL = 'Tout le bâtiment';

/** Catégories qui ne se filment pas (nombres, surfaces) : ignorées par la visite guidée. */
export const NON_VISUAL_CATEGORIES = ['Administratif'];

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
export function buildChecklist(
  schema: SchemaDefinition,
  items: Record<string, InspectionItem>,
  zone: string,
  opts: { visualOnly?: boolean } = {},
): Checklist {
  const all = Object.values(items);
  const cats = (zone === ALL_ZONES ? Object.keys(schema) : [zone].filter(c => schema[c])).filter(
    c => !opts.visualOnly || !NON_VISUAL_CATEGORIES.includes(c),
  );
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

/** Lignes « à relever » envoyées au modèle de guidage, regroupées par catégorie (compact). */
export function missingLines(checklist: Checklist, max = 30): string[] {
  const byCat = new Map<string, string[]>();
  for (const e of checklist.entries) {
    if (e.status === 'complet') continue;
    const what = e.status === 'absent' ? `${e.subCategory} (pas vu)` : `${e.subCategory} (manque ${e.missingAttributes.join(', ')})`;
    byCat.set(e.category, [...(byCat.get(e.category) ?? []), what]);
  }
  return Array.from(byCat.entries()).slice(0, max).map(([cat, list]) => `${cat} : ${list.join(', ')}`);
}

/** Lignes « déjà relevé » : éléments documentés et leurs valeurs, pour éviter les doublons dans les grands bâtiments. */
export function recordedLines(schema: SchemaDefinition, items: Record<string, InspectionItem>, zone: string, max = 45): string[] {
  return Object.values(items)
    .filter(i => i.category !== 'Non catégorisé' && !NON_VISUAL_CATEGORIES.includes(i.category))
    .filter(i => zone === ALL_ZONES || i.category === zone)
    .filter(i => schema[i.category]?.[i.subCategory])
    .slice(0, max)
    .map(i => {
      const attrs = Object.entries(i.attributes)
        .filter(([, v]) => v && v !== 'Non défini')
        .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
        .join(', ');
      return `${i.category} / ${i.subCategory} : ${attrs || 'sans détail'} (${i.photos.length} photo${i.photos.length > 1 ? 's' : ''})`;
    });
}

/** Captures de la visite guidée dont l'analyse détaillée n'est pas terminée. */
export function inProgressTargets(queue: QueueItem[]): string[] {
  return queue
    .filter(q => q.source === 'guided' && q.status !== 'error' && q.target)
    .map(q => q.target as string)
    .slice(-15);
}
