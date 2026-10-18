// Contrat partagé entre l'application et la fonction serveur « ai ».
// (Copie côté client : services/aiTypes.ts — garder les deux synchronisés.)

export type SchemaDefinition = Record<string, Record<string, Record<string, string[]>>>;

/** À quoi sert l'appel : chaque usage a son modèle par défaut. */
export type Purpose = 'analyze' | 'text' | 'guide';

export type Provider = 'gemini' | 'anthropic' | 'openai';

export interface AnalyzeImageRequest {
  task: 'analyzeImage';
  /** JPEG en base64, sans préfixe data: */
  image: string;
  schema: SchemaDefinition;
  /** Paroles de l'inspecteur au moment de la photo (visite guidée) */
  note?: string;
  /** Élément visé lors de la capture (visite guidée), ex : « Boiler — plaque signalétique » */
  hint?: string;
  model?: string;
}

export interface AnalyzeTextRequest {
  task: 'analyzeText';
  text: string;
  schema: SchemaDefinition;
  model?: string;
}

export interface SummarizeRequest {
  task: 'summarize';
  comment: string;
  category: string;
  subCategory: string;
  model?: string;
}

/** libre = l'inspecteur commence où il est ; parcours = l'IA propose un ordre de visite */
export type VisitMode = 'libre' | 'parcours';

export interface GuideRequest {
  task: 'guide';
  /** Image basse définition de la caméra (JPEG base64, sans préfixe) */
  image: string;
  schema: SchemaDefinition;
  mode?: VisitMode;
  /** Thème : « Tout le bâtiment » ou une catégorie du référentiel */
  theme?: string;
  /** Ancien nom de « theme » (V2.0) */
  zone?: string;
  /** Parcours : étape en cours et suivante */
  stage?: string;
  nextStage?: string;
  /** Espace reconnu aux images précédentes, et espaces déjà parcourus */
  currentSpace?: string;
  spacesVisited?: string[];
  /** L'inspecteur a fini l'espace actuel et demande où aller */
  requestNextSpace?: boolean;
  /** Lignes « Catégorie : élément (ce qui manque) » */
  missing: string[];
  /** Éléments déjà documentés avec leurs valeurs */
  recorded?: string[];
  /** Éléments déjà capturés dont l'analyse HD est en cours */
  inProgress: string[];
  /** Ce que l'inspecteur a dit depuis la dernière image */
  transcript?: string;
  lastInstruction?: string;
  /** Élément visé à l'image précédente (pour garder la même cible) */
  lastTarget?: string;
  /** Séquence en cours, imposée par l'application (ex : « Fenêtre », étape « Vitrage et intercalaire ») */
  element?: string;
  elementCategory?: string;
  step?: string;
  stepIndex?: number;
  stepCount?: number;
  stepAim?: string;
  stepOptional?: boolean;
  nextSteps?: string[];
  /** Éléments déjà faits dans l'espace actuel */
  elementsDoneHere?: string[];
  /** Éléments déjà repérés dans cet espace (libellés) */
  spotted?: string[];
  /** Espace vers lequel l'inspecteur se dirige (après « Pièce suivante ») */
  goingTo?: string;
  model?: string;
}

/** Élément visible à l'image (une entrée par variante : chaque revêtement, chaque peinture…) */
export interface VisibleElement {
  category: string;
  element: string;
  label: string;
  box: number[];
}

export interface ModelsRequest {
  task: 'models';
}

export type AiRequest =
  | AnalyzeImageRequest
  | AnalyzeTextRequest
  | SummarizeRequest
  | GuideRequest
  | ModelsRequest;

export interface RawElement {
  category: string;
  subCategory: string;
  attributes: { name: string; value: string }[];
  confiance: number;
  commentaire: string;
  conditionScore: number;
  isPrimarySubject: boolean;
}

export type SceneQuality = 'ok' | 'sombre' | 'flou' | 'loin' | 'proche' | 'hors_sujet';

export type TargetDirection = 'ici' | 'gauche' | 'droite' | 'haut' | 'bas' | 'derriere' | 'inconnu';

export interface GuideResult {
  instruction: string;
  detail: string;
  target: string;
  capture: boolean;
  captureReason: string;
  sceneQuality: SceneQuality;
  seen: { category: string; subCategory: string }[];
  /** Type d'espace reconnu (Chambre, Couloir, Chaufferie, Façade…) */
  space: string;
  /** Tout ce qui est utile dans cet espace est relevé */
  spaceDone: boolean;
  /** Espace suivant conseillé (quand spaceDone ou demandé) */
  nextSpace: string;
  /** Cadre de l'élément visé [ymin, xmin, ymax, xmax] de 0 à 1000 ; [] s'il n'est pas visible */
  targetBox: number[];
  /** Où chercher l'élément visé s'il n'est pas dans l'image */
  targetDirection: TargetDirection;
  /** Étape facultative dont le sujet n'existe pas ici (pas de store…) */
  stepAbsent: boolean;
  /** Sans séquence en cours : prochain élément proposé (catégorie et élément exacts du référentiel) */
  nextCategory: string;
  nextElement: string;
  /** Tous les éléments du référentiel visibles à l'image, avec leur cadre */
  elements: VisibleElement[];
}

export interface ModelInfo {
  id: string; // « fournisseur:modèle »
  provider: Provider;
  model: string;
  label: string;
  note?: string;
  available?: boolean;
}

export interface AiMeta {
  model: string;
  provider: Provider;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}

export interface AiResponse {
  elements?: RawElement[];
  text?: string;
  guide?: GuideResult;
  models?: ModelInfo[];
  defaults?: Record<Purpose, string>;
  meta?: AiMeta;
}
