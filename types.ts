

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

  isConfigured: boolean;
}
