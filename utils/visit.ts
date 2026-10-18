// Parcours guidé : ordre de visite logique, de l'extérieur jusqu'à la toiture.
export interface ParcoursStage {
  id: string;
  label: string;
  detail: string;
}

export const PARCOURS_STAGES: ParcoursStage[] = [
  { id: 'exterieur', label: 'Extérieur', detail: 'façades, fenêtres vues de dehors, toiture visible, abords et parking' },
  { id: 'communs', label: 'Entrée et parties communes', detail: 'hall, escaliers, paliers, ascenseur, sécurité incendie' },
  { id: 'technique', label: 'Sous-sol et locaux techniques', detail: 'chaufferie, eau, électricité, ventilation, caves, parking souterrain' },
  { id: 'locaux', label: 'Logements et locaux', detail: 'pièces types de chaque étage : revêtements, fenêtres, radiateurs, sanitaires, cuisine' },
  { id: 'toiture', label: 'Combles et toiture', detail: 'charpente, structure, isolation' },
];

export const stageText = (i: number): string | undefined => {
  const s = PARCOURS_STAGES[i];
  return s ? `${s.label} (${s.detail})` : undefined;
};
