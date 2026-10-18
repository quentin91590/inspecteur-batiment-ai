

export interface InspectionResult {
  category: string;
  subCategory: string;
  attributes: Record<string, string>; // ex: { "Type": "Acier", "État": "Bon", "Année": "2010" }
  confiance: number;
  commentaire: string;
  isPrimarySubject: boolean;
  conditionScore?: number; // 0 to 100
}

/** Origine et coût d'une analyse (pour comparer les modèles) */
export interface AnalysisMeta {
  model?: string;
  latencyMs?: number;
  source?: QueueSource;
}

export interface InspectionItem extends InspectionResult {
  id: string; // Unique UUID
  photos: {
    imageUrl: string;
    timestamp: number;
    detectedAttributes?: Record<string, string>; // Attributes detected specifically in this photo
    meta?: AnalysisMeta;
  }[];

  // NEW: Stores the full history of detected values for every attribute
  // Key = Attribute Name, Value = Array of detected strings
  attributeHistory: Record<string, string[]>;

  // NEW: Store history of scores to calculate average independently of individual photos
  scoreHistory: number[];

  // removed separate 'scores' array to ensure 1-to-1 mapping with photos
  averageScore: number; // Current calculated average from photos
  lastUpdated: number;
  isManuallyEdited?: boolean;
}

export type QueueSource = 'upload' | 'camera' | 'voice' | 'guided';

export interface QueueItem {
  id: string;
  type: 'image' | 'audio'; // Distinction explicite
  imageBase64?: string; // Optional for audio
  textPayload?: string; // Content for audio/text items
  /** Paroles de l'inspecteur associées à une photo (visite guidée) */
  note?: string;
  /** Élément visé lors de la capture (visite guidée) */
  target?: string;
  source?: QueueSource;
  status: 'pending' | 'analyzing' | 'error';
  error?: string;
  progressStep?: string;
  timestamp: number;
}

// Structure du référentiel : Category -> SubCategory -> Attribute -> Options[]
export type SchemaDefinition = Record<string, Record<string, Record<string, string[]>>>;

export interface Building {
  id: string;
  name: string;
  address?: string;
  egid?: string; // Ajout du champ EGID
  createdAt: number;
  updatedAt: number;

  items: Record<string, InspectionItem>;
  queue: QueueItem[];

  // New Schema Structure
  schema: SchemaDefinition;

  /** Éléments du référentiel absents de ce bâtiment (« Catégorie::Élément ») : exclus de ce qui reste à faire */
  absent?: string[];

  /** Maquette 3D simple construite pendant les visites guidées */
  layout?: BuildingLayout;

  isConfigured: boolean;
}

// === MAQUETTE 3D SIMPLE (visite guidée) ===
// Positions en mètres, relatives au début de la visite : x et y à l'horizontale, z vers le haut.

export interface LayoutRoom {
  /** Identifiant : nom normalisé */
  id: string;
  name: string;
  /** Étage (0 = rez-de-chaussée, -1 = sous-sol…) */
  floor: number;
  center: [number, number];
  size: [number, number];
  visitedAt: number;
}

export interface LayoutElement {
  id: string;
  /** Identifiant de la pièce */
  room: string;
  category: string;
  element: string;
  label: string;
  status: 'todo' | 'done' | 'skipped';
  /** Position estimée (m) */
  pos?: [number, number, number];
  /** Sinon : direction vue depuis la pièce (radians) */
  azimuth?: number;
  elevation?: number;
  photos: number;
  /** Empreinte visuelle compacte */
  fp?: string;
}

export interface BuildingLayout {
  version: 1;
  updatedAt: number;
  rooms: LayoutRoom[];
  elements: LayoutElement[];
  /** Parcours de la dernière visite (allégé), à plat : x0, y0, x1, y1… (Firestore refuse les tableaux de tableaux) */
  path?: number[];
  /** Repère orienté au nord grâce à la boussole (sinon orientation arbitraire) */
  north?: boolean;
}
