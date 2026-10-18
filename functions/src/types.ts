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

export interface GuideRequest {
  task: 'guide';
  /** Image basse définition de la caméra (JPEG base64, sans préfixe) */
  image: string;
  schema: SchemaDefinition;
  /** Zone en cours (catégorie du référentiel) ou « Tout le bâtiment » */
  zone: string;
  /** Lignes « Catégorie / Élément : ce qui manque » */
  missing: string[];
  /** Éléments déjà capturés dont l'analyse HD est en cours */
  inProgress: string[];
  /** Ce que l'inspecteur a dit depuis la dernière image */
  transcript?: string;
  lastInstruction?: string;
  model?: string;
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

export interface GuideResult {
  instruction: string;
  detail: string;
  target: string;
  capture: boolean;
  captureReason: string;
  sceneQuality: SceneQuality;
  seen: { category: string; subCategory: string }[];
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
