// Séquences de relevé par type d'élément : l'appli fait les étapes dans l'ordre, une photo par étape,
// et ne passe à un autre élément qu'une fois la séquence finie (ou passée par l'inspecteur).

export interface ProtocolStep {
  key: string;
  /** Libellé court affiché (« Vitrage et intercalaire ») */
  label: string;
  /** Consigne par défaut à l'écran */
  instruction: string;
  /** Ce que la photo doit montrer (transmis à l'IA de guidage et d'analyse) */
  aim: string;
  /** Étape qui peut ne pas exister ici (pas de store, pas de plaque…) */
  optional?: boolean;
}

export interface Protocol {
  id: string;
  category: string;
  /** Éléments (sous-catégories) concernés ; absent = toute la catégorie */
  elements?: string[];
  title: string;
  steps: ProtocolStep[];
}

export const PROTOCOLS: Protocol[] = [
  {
    id: 'fenetre',
    category: 'Fenêtres',
    title: 'Fenêtre',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez toute la fenêtre', aim: 'la fenêtre entière, ouvrants et dormant visibles, pour l’état général' },
      { key: 'cadre', label: 'Cadre', instruction: 'Approchez-vous du cadre, en gros plan', aim: 'gros plan du cadre / dormant pour reconnaître le matériau (bois, PVC, aluminium, bois-métal)' },
      { key: 'vitrage', label: 'Vitrage et intercalaire', instruction: 'Filmez un coin du vitrage, de près', aim: 'coin du vitrage avec l’intercalaire visible : nombre de vitrages, inscriptions et année sur l’intercalaire' },
      { key: 'ferrures', label: 'Poignée et ferrures', instruction: 'Montrez la poignée et les ferrures', aim: 'poignée, paumelles, quincaillerie et joints, pour l’état et l’époque' },
      { key: 'protection', label: 'Protection solaire', instruction: 'Montrez le store ou le volet', aim: 'store, volet, lamelles ou caisson', optional: true },
      { key: 'defauts', label: 'Défauts', instruction: 'Montrez les défauts éventuels', aim: 'joints abîmés, condensation, bois dégradé, fissures du vitrage', optional: true },
    ],
  },
  {
    id: 'radiateur',
    category: 'Chauffage',
    elements: ['Emetteur', 'Distribution de chauffage'],
    title: 'Radiateur',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez tout le radiateur', aim: 'le radiateur entier (type : acier, fonte, convecteur, sol) et son état' },
      { key: 'vanne', label: 'Vanne', instruction: 'Approchez-vous de la vanne', aim: 'vanne ou tête thermostatique, de près' },
      { key: 'conduites', label: 'Raccords et conduites', instruction: 'Montrez les tuyaux de raccordement', aim: 'raccords et conduites de chauffage visibles, isolation éventuelle', optional: true },
    ],
  },
  {
    id: 'production',
    category: 'Chauffage',
    elements: ['Production de chaleur', 'Solaire thermique'],
    title: 'Production de chaleur',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez toute la chaudière ou la PAC', aim: 'générateur entier (chaudière, PAC, chaudière à bois…) et son environnement' },
      { key: 'plaque', label: 'Plaque signalétique', instruction: 'Approchez-vous de la plaque signalétique', aim: 'plaque signalétique lisible : marque, modèle, puissance, année' },
      { key: 'regulation', label: 'Brûleur et régulation', instruction: 'Montrez le brûleur ou la régulation', aim: 'brûleur, tableau de régulation, écran', optional: true },
      { key: 'departs', label: 'Départs et isolation', instruction: 'Montrez les départs de chauffage', aim: 'conduites de départ, pompes, isolation des tuyaux' },
      { key: 'vase', label: 'Vase d’expansion', instruction: 'Montrez le vase d’expansion', aim: 'vase d’expansion et sécurités', optional: true },
    ],
  },
  {
    id: 'boiler',
    category: 'Chauffage',
    elements: ['Boiler', 'Boiler électrique'],
    title: 'Boiler',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez tout le boiler', aim: 'le chauffe-eau entier et son isolation' },
      { key: 'plaque', label: 'Plaque signalétique', instruction: 'Approchez-vous de la plaque du boiler', aim: 'plaque lisible : type (électrique / thermique), contenance, année' },
    ],
  },
  {
    id: 'sanitaire',
    category: 'Sanitaires',
    elements: ['Appareils sanitaires', 'Evacuation', 'Distribution', 'Distribution d\'ECS'],
    title: 'Équipement sanitaire',
    steps: [
      { key: 'ensemble', label: 'Appareil', instruction: 'Cadrez l’appareil sanitaire', aim: 'lavabo, WC, douche ou baignoire entier, pour l’état' },
      { key: 'robinet', label: 'Robinetterie', instruction: 'Approchez-vous de la robinetterie', aim: 'robinet ou mitigeur de près' },
      { key: 'evacuation', label: 'Évacuation et alimentation', instruction: 'Montrez le siphon et les tuyaux', aim: 'siphon, évacuation, alimentations visibles', optional: true },
    ],
  },
  {
    id: 'sanitaire-technique',
    category: 'Sanitaires',
    title: 'Installation d’eau',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez l’installation', aim: 'introduction d’eau, compteur, batterie de gaz ou pompe de relevage' },
      { key: 'plaque', label: 'Plaque ou étiquette', instruction: 'Approchez-vous de l’étiquette', aim: 'plaque, étiquette ou compteur lisible', optional: true },
    ],
  },
  {
    id: 'tableau',
    category: 'Electricité courant fort',
    elements: ['Tableau principal', 'Tableau électrique d\'étage', 'Local BT'],
    title: 'Tableau électrique',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez tout le tableau, porte ouverte', aim: 'tableau électrique entier' },
      { key: 'etiquette', label: 'Étiquette', instruction: 'Approchez-vous de l’étiquette du tableau', aim: 'étiquette fabricant / année, schéma', optional: true },
      { key: 'protections', label: 'Disjoncteurs', instruction: 'Filmez les disjoncteurs de près', aim: 'disjoncteurs, différentiels, fusibles (type et époque)' },
    ],
  },
  {
    id: 'photovoltaique',
    category: 'Electricité courant fort',
    elements: ['Production'],
    title: 'Production électrique',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez les panneaux ou l’onduleur', aim: 'panneaux photovoltaïques ou onduleur' },
      { key: 'plaque', label: 'Plaque de l’onduleur', instruction: 'Approchez-vous de la plaque de l’onduleur', aim: 'plaque lisible : puissance, année', optional: true },
    ],
  },
  {
    id: 'luminaire',
    category: 'Eclairage',
    title: 'Luminaire',
    steps: [
      { key: 'ensemble', label: 'Luminaire', instruction: 'Cadrez le luminaire', aim: 'luminaire entier' },
      { key: 'lampe', label: 'Type de lampe', instruction: 'Approchez-vous de la lampe', aim: 'source lumineuse de près : LED, tube fluorescent, halogène…' },
    ],
  },
  {
    id: 'ventilation',
    category: 'Ventilation & Climatisation',
    title: 'Ventilation / climatisation',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez l’appareil ou la bouche', aim: 'monobloc, bouche de ventilation, split ou groupe froid' },
      { key: 'plaque', label: 'Plaque signalétique', instruction: 'Approchez-vous de la plaque', aim: 'plaque lisible : type, année', optional: true },
    ],
  },
  {
    // Un revêtement repéré = une variante (« Parquet chêne », « Peinture blanche »…)
    id: 'revetement',
    category: 'Substance & Surface',
    elements: ['Revêtements', 'Hall d\'entrée', 'Communs', 'Paliers'],
    title: 'Revêtement',
    steps: [
      { key: 'ensemble', label: 'Surface entière', instruction: 'Cadrez toute la surface', aim: 'la surface revêtue entière (sol, mur ou plafond), pour l’étendue et l’état général' },
      { key: 'detail', label: 'Détail du matériau', instruction: 'Approchez-vous du revêtement', aim: 'gros plan du matériau : essence du bois, type de carrelage et joints, texture de la peinture ou du papier' },
      { key: 'defauts', label: 'Défauts', instruction: 'Montrez les défauts éventuels', aim: 'usure, fissures, taches, décollements, humidité', optional: true },
    ],
  },
  {
    id: 'menuiserie',
    category: 'Substance & Surface',
    elements: ['Menuiseries intérieures'],
    title: 'Menuiserie intérieure',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez toute la porte ou le placard', aim: 'porte, placard ou menuiserie entière' },
      { key: 'detail', label: 'Huisserie et poignée', instruction: 'Approchez-vous de la poignée et du cadre', aim: 'huisserie, poignée, paumelles, matériau' },
      { key: 'defauts', label: 'Défauts', instruction: 'Montrez les défauts éventuels', aim: 'chocs, usure, jeu, dégradations', optional: true },
    ],
  },
  {
    id: 'escalier',
    category: 'Substance & Surface',
    elements: ['Escaliers'],
    title: 'Escalier',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez l’escalier', aim: 'escalier entier' },
      { key: 'marches', label: 'Marches', instruction: 'Filmez les marches de près', aim: 'revêtement des marches et nez de marche' },
      { key: 'gardecorps', label: 'Garde-corps', instruction: 'Montrez le garde-corps', aim: 'main courante et garde-corps', optional: true },
    ],
  },
  {
    id: 'cave',
    category: 'Substance & Surface',
    elements: ['Caves'],
    title: 'Cave',
    steps: [
      { key: 'plafond', label: 'Plafond', instruction: 'Levez le téléphone vers le plafond', aim: 'plafond de la cave : isolé ou non' },
      { key: 'murs', label: 'Murs', instruction: 'Filmez un mur', aim: 'murs, humidité éventuelle' },
    ],
  },
  {
    id: 'facade',
    category: 'Façade',
    title: 'Façade',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Reculez pour cadrer toute la façade', aim: 'façade entière, part de surfaces vitrées' },
      { key: 'detail', label: 'Revêtement', instruction: 'Approchez-vous du revêtement de façade', aim: 'détail du revêtement (crépi, pierre, bardage…) et de l’isolation éventuelle' },
      { key: 'fissures', label: 'Fissures et dégradations', instruction: 'Montrez les fissures ou éclats', aim: 'fissures, carbonatation, éclats de béton', optional: true },
      { key: 'eaux', label: 'Descentes d’eau pluviale', instruction: 'Montrez une descente d’eau pluviale', aim: 'descente d’eau pluviale et chéneau', optional: true },
    ],
  },
  {
    id: 'toiture',
    category: 'Toiture',
    title: 'Toiture',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez la toiture', aim: 'toiture entière (type : tuiles, plate, tôle…)' },
      { key: 'structure', label: 'Structure', instruction: 'Montrez la structure ou la charpente', aim: 'charpente ou dalle de toiture', optional: true },
      { key: 'isolation', label: 'Isolation', instruction: 'Montrez l’isolation de la toiture', aim: 'isolation sous toiture ou des combles', optional: true },
    ],
  },
  {
    id: 'grosoeuvre',
    category: 'Gros Œuvre',
    title: 'Structure',
    steps: [
      { key: 'maconnerie', label: 'Maçonnerie', instruction: 'Filmez un mur porteur', aim: 'maçonnerie apparente, fissures' },
      { key: 'charpente', label: 'Charpente', instruction: 'Montrez la charpente', aim: 'charpente', optional: true },
    ],
  },
  {
    id: 'incendie',
    category: 'Incendie',
    title: 'Sécurité incendie',
    steps: [
      { key: 'extincteur', label: 'Extincteur', instruction: 'Montrez l’extincteur et son étiquette', aim: 'extincteur et étiquette de contrôle', optional: true },
      { key: 'secours', label: 'Éclairage de secours', instruction: 'Montrez l’éclairage de secours', aim: 'bloc d’éclairage de secours, balisage', optional: true },
      { key: 'detection', label: 'Détection', instruction: 'Montrez le détecteur ou le bouton d’alarme', aim: 'détecteur de fumée, déclencheur manuel', optional: true },
    ],
  },
  {
    id: 'ascenseur',
    category: 'Installations de transport',
    title: 'Ascenseur',
    steps: [
      { key: 'cabine', label: 'Cabine', instruction: 'Cadrez l’intérieur de la cabine', aim: 'cabine et tableau de commande' },
      { key: 'plaque', label: 'Plaque', instruction: 'Approchez-vous de la plaque de l’ascenseur', aim: 'plaque : fabricant, année, charge' },
      { key: 'portes', label: 'Portes palières', instruction: 'Montrez la porte palière', aim: 'porte palière et encadrement', optional: true },
    ],
  },
  {
    id: 'abords',
    category: 'Aménagements extérieurs',
    title: 'Abords',
    steps: [
      { key: 'verts', label: 'Espaces verts', instruction: 'Filmez les espaces verts', aim: 'espaces verts', optional: true },
      { key: 'durs', label: 'Zones dures', instruction: 'Filmez les cheminements et le revêtement', aim: 'zones dures, enrobé, pavés', optional: true },
    ],
  },
  {
    id: 'parking',
    category: 'Parking',
    title: 'Parking',
    steps: [
      { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez le parking', aim: 'parking, sol et éclairage' },
      { key: 'porte', label: 'Porte et barrière', instruction: 'Montrez la porte ou la barrière', aim: 'porte principale, barrière', optional: true },
    ],
  },
];

const GENERIC_STEPS: ProtocolStep[] = [
  { key: 'ensemble', label: 'Vue d’ensemble', instruction: 'Cadrez l’élément entier', aim: 'l’élément entier, pour son type et son état' },
  { key: 'detail', label: 'Plaque ou détail', instruction: 'Approchez-vous de la plaque ou d’un détail', aim: 'plaque signalétique, étiquette ou détail révélant le type et l’année', optional: true },
  { key: 'defauts', label: 'Défauts', instruction: 'Montrez les défauts éventuels', aim: 'défauts, usure, dégradations', optional: true },
];

/** Séquence pour un élément proposé par l'IA (catégorie / élément du référentiel). */
export function protocolFor(category: string, element: string): Protocol {
  const byElement = PROTOCOLS.find(p => p.category === category && p.elements?.includes(element));
  if (byElement) return byElement;
  const byCategory = PROTOCOLS.find(p => p.category === category && !p.elements);
  if (byCategory) return byCategory;
  const sameCategory = PROTOCOLS.find(p => p.category === category);
  if (sameCategory && !element) return sameCategory;
  return { id: `generique-${category}-${element}`, category, elements: [element], title: element || category, steps: GENERIC_STEPS };
}
