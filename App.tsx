import React, { useState, useRef, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
// FIREBASE IMPORTS
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

import { Header } from './components/Header';
import { FieldCard } from './components/FieldCard';
import { QueueCard } from './components/QueueCard';
import { ImageViewer } from './components/ImageViewer';
import { EditFieldModal } from './components/EditFieldModal';
import { AddManualFieldModal } from './components/AddManualFieldModal';
import { MergeItemModal } from './components/MergeItemModal'; 
import { SetupScreen } from './components/SetupScreen';
import { BuildingListScreen } from './components/BuildingListScreen';
import { LoginScreen } from './components/LoginScreen'; 
import { analyzeInspectionImage, analyzeInspectionText, summarizeInspectionComment, setDemoMode, isDemoMode, listModels, modelLabel, getModelPrefs, AiCallError, type AnalysisOutput } from './services/aiService';
import { loadLocalQueue, saveLocalQueue } from './services/localQueue';
import { GuidedVisit, type GuidedCapture } from './components/GuidedVisit';
import { ModelSettingsModal } from './components/ModelSettingsModal';
import { getMissingAttributes } from './utils/checklist';
import { uploadInspectionImage } from './services/storageService';
import { generatePDF, generateDOCX } from './services/reportGenerator';
import { InspectionItem, QueueItem, Building, SchemaDefinition, InspectionResult, AnalysisMeta } from './types';
import { DEFAULT_SCHEMA_CSV, CATEGORY_ORDER, sortCategories, AI_COSTS } from './constants';
import { 
    Upload, Camera, PenTool, ChevronRight, ChevronDown, ChevronUp, PieChart, Image as ImageIcon, 
    CheckCircle2, AlertCircle, Plus, AlertTriangle, LayoutGrid, X,
    Thermometer, PaintBucket, Hammer, Building as BuildingIcon, Grid2x2, Home, 
    Trees, Car, FireExtinguisher, ShieldCheck, Wind, Droplets, Zap, Wifi, Lightbulb, 
    MoveVertical, Folder, BrickWall, LogOut, Loader2, ZapOff, Mic, StopCircle, Sparkles,
    Wand2, BrainCircuit, Aperture, Activity, Diamond, FileText, Download, Video, Settings2
} from 'lucide-react';

// Helper to resize image - OPTIMIZED FOR FIRESTORE (0.6 quality)
const resizeImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const MAX_SIDE = 1024; 

      if (width > height) {
        if (width > MAX_SIDE) {
          height *= MAX_SIDE / width;
          width = MAX_SIDE;
        }
      } else {
        if (height > MAX_SIDE) {
          width *= MAX_SIDE / height;
          height = MAX_SIDE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        // Reduced quality to 0.6 to fit more photos in Firestore document
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } else {
        reject(new Error("Failed to get canvas context"));
      }
      URL.revokeObjectURL(img.src);
    };
    img.onerror = (error) => {
      URL.revokeObjectURL(img.src);
      reject(error);
    };
  });
};

// CSV Parser
const parseSchemaCSV = (csvText: string): SchemaDefinition => {
    const schema: SchemaDefinition = {};
    const lines = csvText.split('\n');

    lines.forEach(line => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        
        let separator = '/';
        
        // Better separator detection based on count outside brackets
        const lineWithoutBrackets = trimmedLine.replace(/\[.*?\]/g, '');
        const tabCount = (lineWithoutBrackets.match(/\t/g) || []).length;
        const semiCount = (lineWithoutBrackets.match(/;/g) || []).length;
        const commaCount = (lineWithoutBrackets.match(/,/g) || []).length;
        const slashCount = (lineWithoutBrackets.match(/\//g) || []).length;

        if (tabCount >= 3) separator = '\t';
        else if (semiCount >= 3) separator = ';';
        else if (commaCount >= 3) separator = ',';
        else if (slashCount >= 3) separator = '/';

        const parts: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < trimmedLine.length; i++) {
            const char = trimmedLine[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === separator && !inQuotes) {
                parts.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        parts.push(current);

        if (parts.length < 4) return;

        const category = parts[0].trim();
        const subCategory = parts[1].trim();
        const attribute = parts[2].trim();
        
        // If there are more than 4 parts (due to unquoted separators in the values array), join them back
        let valuesRaw = parts.slice(3).join(separator).trim();
        
        // Remove quotes and brackets
        valuesRaw = valuesRaw.replace(/^"|"$/g, '').trim();
        const cleanValues = valuesRaw.replace(/^\[|\]$/g, '');
        let values: string[] = [];

        // OPTIMISATION POUR LES PLAGES NUMÉRIQUES : Stockage Compact "Numeric:Start:End"
        if (cleanValues.includes(':') && !cleanValues.includes(';')) {
             const normalizedValues = cleanValues.replace(/,/g, '.');
             values = [`Numeric:${normalizedValues}`];
        } else {
            values = cleanValues.split(';').map(v => v.trim()).filter(v => v);
        }

        // On ne reverse PAS si c'est notre format compact Numeric
        if (attribute.toLowerCase() === 'année' && !values[0]?.startsWith('Numeric')) values.reverse();
        
        if (!schema[category]) schema[category] = {};
        if (!schema[category][subCategory]) schema[category][subCategory] = {};
        
        const lowerAttr = attribute.toLowerCase();
        const isNumeric = lowerAttr.includes('année') || lowerAttr.includes('nombre') || lowerAttr.includes('surface') || (values.length > 0 && values[0].match(/^\d/));
        const isBoolean = values.length === 2 && values.includes('Oui') && values.includes('Non');
        
        if (!isNumeric && !isBoolean && !values.includes('Mixte') && !values[0]?.startsWith('Numeric')) {
            if (attribute !== 'Etat') {
                values.push('Mixte');
            }
        }

        schema[category][subCategory][attribute] = values;
    });
    return schema;
};

// ... (Keep existing helpers: getStateFromScore, calculateAverageScore, calculateDominantAttributes, getCategoryIcon)
const getStateFromScore = (score: number): string => {
    if (score > 90) return "Neuf";
    if (score >= 70) return "Bon";
    if (score >= 50) return "Moyen";
    return "Mauvais";
};

const calculateAverageScore = (scores: number[]): number => {
    if (scores.length === 0) return 50;
    const total = scores.reduce((a, b) => a + b, 0);
    return Math.round(total / scores.length);
};

const calculateDominantAttributes = (
    currentAttributes: Record<string, string>,
    history: Record<string, string[]>
): Record<string, string> => {
    const resolvedAttributes: Record<string, string> = { ...currentAttributes };
    const keys = new Set([...Object.keys(currentAttributes), ...Object.keys(history)]);
    
    keys.forEach(key => {
        if (key === 'Etat') return;
        const values = history[key];
        if (!values || values.length === 0) return;

        // LOGIC FOR YEAR AVERAGE
        if (key === 'Année') {
            const validYears = values
                .map(v => {
                    const match = String(v).match(/\d{4}/);
                    return match ? parseInt(match[0], 10) : null;
                })
                // Sanity check: ensure reasonable years (e.g. between 1800 and 2100)
                .filter((y): y is number => y !== null && y > 1800 && y < 2100);

            if (validYears.length > 0) {
                const sum = validYears.reduce((a, b) => a + b, 0);
                const avg = Math.round(sum / validYears.length);
                resolvedAttributes[key] = String(avg);
                return; // Skip frequency logic
            }
        }

        // Standard Frequency Logic
        const counts: Record<string, number> = {};
        values.forEach(v => counts[v] = (counts[v] || 0) + 1);
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
            const topValue = sorted[0][0];
            const topCount = sorted[0][1];
            const totalCount = values.length;
            if (topCount / totalCount > 0.5 || values.length === 1) {
                resolvedAttributes[key] = topValue;
            } else {
                resolvedAttributes[key] = "Mixte";
            }
        }
    });
    return resolvedAttributes;
};

const getCategoryIcon = (category: string) => {
    const lower = category.toLowerCase();
    if (lower.includes('chauffage')) return Thermometer;
    if (lower.includes('surface') || lower.includes('peinture')) return PaintBucket;
    if (lower.includes('gros') || lower.includes('œuvre')) return Hammer; 
    if (lower.includes('façade')) return BuildingIcon;
    if (lower.includes('fenêtre')) return Grid2x2; 
    if (lower.includes('toiture')) return Home; 
    if (lower.includes('extérieur')) return Trees;
    if (lower.includes('parking')) return Car;
    if (lower.includes('incendie')) return FireExtinguisher;
    if (lower.includes('norme')) return ShieldCheck;
    if (lower.includes('ventilation') || lower.includes('climatisation')) return Wind;
    if (lower.includes('sanitaire')) return Droplets;
    if (lower.includes('fort')) return Zap;
    if (lower.includes('faible')) return Wifi;
    if (lower.includes('eclairage')) return Lightbulb;
    if (lower.includes('transport') || lower.includes('ascenseur')) return MoveVertical;
    return Folder;
};

export default function App() {
  // === AUTH STATE ===
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // === USER ECONOMY STATE ===
  // OPTIMISTIC INIT: On commence à 200 pour éviter de bloquer l'UI si le fetch Firestore échoue/tarde
  const [userCoins, setUserCoins] = useState(200); 
  const [userPlan, setUserPlan] = useState<'free' | 'premium' | 'pro'>('free');

  // === GLOBAL STATE (Buildings List) ===
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null);

  // === ACTIVE SESSION STATE ===
  const [items, setItems] = useState<Record<string, InspectionItem>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [schema, setSchema] = useState<SchemaDefinition>({});
  
  // === UI STATE ===
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [isBatchSummarizing, setIsBatchSummarizing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 }); // Added for batch progress tracking

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  
  // New State for Saving Status
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
  const [viewingQueueItem, setViewingQueueItem] = useState<QueueItem | null>(null);
  const [editingItem, setEditingItem] = useState<InspectionItem | null>(null);
  const [mergingItem, setMergingItem] = useState<InspectionItem | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [manualModalConfig, setManualModalConfig] = useState<{category?: string, subCategory?: string} | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [isQueueCollapsed, setIsQueueCollapsed] = useState(true); // Default collapsed
  const [isMissingItemsCollapsed, setIsMissingItemsCollapsed] = useState(true); // Default collapsed
  
  // REPORT VIEWING STATE
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // VOICE STATE
  const [isRecording, setIsRecording] = useState(false);

  // V2 : VISITE GUIDÉE + CHOIX DES MODÈLES
  const [showGuided, setShowGuided] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [analysisModelLabel, setAnalysisModelLabel] = useState<string>('');
  const [networkRetryAt, setNetworkRetryAt] = useState(0);
  const queueLoadedFor = useRef<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isHydrating = useRef(false);
  
  // === REFS ===
  const wakeLockRef = useRef<any>(null);
  const wakeLockEnabledRef = useRef(true); // Flag to disable WakeLock if permissions are denied
  const categoryNavRef = useRef<HTMLElement>(null); // Ref for sticky nav

  // === 1. AUTH LISTENER & CREDITS LOADING ===
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      // Compte réel : IA du serveur ; invité : IA simulée
      if (currentUser) setDemoMode(false);
      
      if (currentUser && currentUser.uid !== 'guest_user') {
          // Fetch user profile (coins) from Firestore
          try {
              const userDocRef = doc(db, "users", currentUser.uid);
              const userSnapshot = await getDoc(userDocRef);
              
              if (userSnapshot.exists()) {
                  const userData = userSnapshot.data();
                  setUserCoins(userData.coins ?? 200);
                  setUserPlan(userData.plan || 'free');
              } else {
                  // Initialize new user with 200 coins for Free plan
                  const initialData = { coins: 200, plan: 'free', createdAt: Date.now() };
                  // We try to write, but if it fails (security rules), we just keep local state at 200
                  try {
                    await setDoc(userDocRef, initialData);
                  } catch (e) {
                    // CRITICAL: This is where we catch rule violations if the rules are not set up
                    console.error("Firestore Permission Error: Impossible de créer le profil utilisateur. Vérifiez l'onglet 'Règles' dans la console Firebase.", e);
                  }
                  setUserCoins(200);
                  setUserPlan('free');
              }
          } catch (e) {
              console.error("Error fetching user profile (using fallback):", e);
              // Fallback for errors: Ensure user isn't blocked
              setUserCoins(200);
          }
      } else if (currentUser && currentUser.uid === 'guest_user') {
          // Guest User Defaults
          setUserCoins(3500);
          setUserPlan('pro');
      } else {
          // Logged out
          setUserCoins(0);
      }

      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // === COINS MANAGEMENT HANDLER ===
  const handleSpendCoins = async (amount: number): Promise<boolean> => {
      if (userCoins < amount) {
          alert(`Crédits insuffisants ! Il vous faut ${amount} coins (Solde: ${userCoins})`);
          return false;
      }

      // Optimistic update
      const newBalance = userCoins - amount;
      setUserCoins(newBalance);

      // Persist to Cloud if not guest
      if (user && user.uid !== 'guest_user') {
          try {
              const userRef = doc(db, "users", user.uid);
              await updateDoc(userRef, { coins: newBalance });
          } catch (e) {
              // Silent fail on cloud sync is acceptable for demo, we keep local state
              console.warn("Error updating coins cloud:", e);
          }
      }
      return true;
  };

  // === 2. FIRESTORE LISTENER (Load Buildings) ===
  useEffect(() => {
    if (!user) {
        setBuildings([]);
        return;
    }
    
    if (user.uid === 'guest_user') {
        return;
    }

    const unsubscribe = onSnapshot(collection(db, "users", user.uid, "buildings"), (snapshot) => {
        const loadedBuildings: Building[] = [];
        snapshot.forEach((doc) => {
            loadedBuildings.push(doc.data() as Building);
        });
        setBuildings(loadedBuildings);
    }, (error) => {
        console.error("Firestore sync error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // === 3. LOCAL STATE HYDRATION (Select Building) ===
  useEffect(() => {
    if (isHydrating.current || !activeBuildingId) return;

    if (!user) return;
    
    const currentBuilding = buildings.find(b => b.id === activeBuildingId);
    if (!currentBuilding) return;

  }, [activeBuildingId, user]); 

  // === 4. SAVE TO FIRESTORE EFFECT (ROBUST) ===
  useEffect(() => {
    if (!user || !activeBuildingId) return;
    if (isHydrating.current) return;
    
    if (user.uid === 'guest_user') return;

    const buildingToSave = buildings.find(b => b.id === activeBuildingId);
    if (!buildingToSave) return;

    // Trigger saving state
    setSaveStatus('saving');

    // Use JSON stringify/parse to strip undefined values automatically
    const safeItems = JSON.parse(JSON.stringify(items));
    
    // We do NOT save the queue to Cloud to save bandwidth and storage limit (1MB max per doc)
    // The queue contains raw base64 images which are huge.
    // const safeQueue = JSON.parse(JSON.stringify(queue)); 

    const updatedBuilding = {
        ...buildingToSave,
        items: safeItems,
        queue: [], // FORCE EMPTY QUEUE IN CLOUD
        schema,
        updatedAt: Date.now(),
        isConfigured: buildingToSave.isConfigured || Object.keys(schema).length > 0
    };

    const timeoutId = setTimeout(async () => {
        try {
            await setDoc(doc(db, "users", user.uid, "buildings", activeBuildingId), updatedBuilding);
            setSaveStatus('saved');
            
            // Reset to idle after a moment
            setTimeout(() => {
                setSaveStatus((prev) => prev === 'saved' ? 'idle' : prev);
            }, 2000);

        } catch (err: any) {
            console.error("Error saving to cloud:", err);
            setSaveStatus('error');
            
            // Handle quota/size limit explicitly
            if (err.code === 'resource-exhausted' || err.message?.includes('maximum size')) {
                alert("Attention : Ce bâtiment contient trop de données (photos). La sauvegarde a échoué car le document dépasse 1 Mo. Veuillez supprimer des photos.");
            }
        }
    }, 1500); // Debounce increased to 1.5s to reduce writes

    return () => clearTimeout(timeoutId);

  }, [items, queue, schema, activeBuildingId, user]);

  // === RÉSEAU (V2) ===
  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Après une coupure réseau, la file reprend toute seule au bout de 15 s
  useEffect(() => {
    if (!networkRetryAt) return;
    const t = setTimeout(() => setNetworkRetryAt(0), Math.max(0, networkRetryAt - Date.now()));
    return () => clearTimeout(t);
  }, [networkRetryAt]);

  // Libellé du modèle d'analyse affiché dans l'assistant
  const refreshModelLabel = async () => {
      if (!user) return;
      try {
          const { models, defaults } = await listModels();
          const id = getModelPrefs().analyze || defaults.analyze;
          setAnalysisModelLabel(modelLabel(id, models));
      } catch {
          setAnalysisModelLabel('');
      }
  };
  useEffect(() => { refreshModelLabel(); }, [user]);

  // === FILE D'ATTENTE CONSERVÉE SUR L'APPAREIL (V2) ===
  useEffect(() => {
    if (!user || !activeBuildingId) return;
    let cancelled = false;
    queueLoadedFor.current = null;
    loadLocalQueue(user.uid, activeBuildingId).then(saved => {
        if (cancelled) return;
        if (saved.length) {
            setQueue(prev => {
                const known = new Set(prev.map(q => q.id));
                return [...prev, ...saved.filter(q => !known.has(q.id))];
            });
        }
        queueLoadedFor.current = activeBuildingId;
    });
    return () => { cancelled = true; };
  }, [activeBuildingId, user]);

  useEffect(() => {
    if (!user || !activeBuildingId || queueLoadedFor.current !== activeBuildingId) return;
    const t = setTimeout(() => saveLocalQueue(user.uid, activeBuildingId, queue), 400);
    return () => clearTimeout(t);
  }, [queue, activeBuildingId, user]);

  // === WAKE LOCK LOGIC ===
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator && wakeLockEnabledRef.current) {
        try {
            if (wakeLockRef.current) return; // Already locked
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            console.log("Screen Wake Lock active");
            
            wakeLockRef.current.addEventListener('release', () => {
                console.log("Screen Wake Lock released");
                wakeLockRef.current = null;
            });
        } catch (err: any) {
             // Handle NotAllowedError gracefully without crashing or spamming console errors
            if (err.name === 'NotAllowedError') {
                console.warn("Wake Lock permission denied by policy. Disabling Wake Lock feature.");
                wakeLockEnabledRef.current = false;
            } else {
                console.error("Wake Lock Error:", err.name, err.message);
            }
        }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
        try {
            await wakeLockRef.current.release();
            wakeLockRef.current = null;
        } catch (err) {
            console.error("Release Wake Lock Error", err);
        }
    }
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && queue.length > 0 && !quotaExceeded) {
            requestWakeLock();
        }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (queue.length > 0 && !quotaExceeded) {
        requestWakeLock();
    } else {
        releaseWakeLock();
    }

    return () => {
        releaseWakeLock();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [queue.length, quotaExceeded]);
  
  useEffect(() => {
    if (activeCategory) {
        const safeId = `nav-cat-${activeCategory.replace(/[^a-z0-9]/gi, '_')}`;
        const el = document.getElementById(safeId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }
  }, [activeCategory]);


  // === HANDLERS ===
  const handleCreateBuilding = async (name: string, address: string, egid: string) => {
    if (!user) return;
    const newBuilding: Building = {
      id: Math.random().toString(36).substring(7),
      name,
      address,
      egid: egid || undefined, // Add EGID here
      createdAt: Date.now(),
      updatedAt: Date.now(),
      items: {},
      queue: [],
      schema: {},
      isConfigured: false
    };
    
    setBuildings(prev => [...prev, newBuilding]);
    
    if (user.uid === 'guest_user') {
        handleSelectBuilding(newBuilding.id, newBuilding);
        return;
    }

    try {
        await setDoc(doc(db, "users", user.uid, "buildings", newBuilding.id), newBuilding);
        handleSelectBuilding(newBuilding.id, newBuilding);
    } catch (e) {
        console.error(e);
        alert("Erreur lors de la création sur le Cloud (Vérifiez vos droits)");
    }
  };

  const handleSelectBuilding = (buildingId: string, directObj?: Building) => {
    const building = directObj || buildings.find(b => b.id === buildingId);
    if (!building) return;

    isHydrating.current = true;
    setActiveBuildingId(building.id);
    setItems(building.items || {});
    setQueue(building.queue || []);
    setSchema(building.schema || {});
    setQuotaExceeded(false);

    setTimeout(() => { isHydrating.current = false; }, 500);
  };

  const handleBack = async () => {
    // 1. Capture references to current state
    const currentId = activeBuildingId;
    const currentItems = items;
    // const currentQueue = queue; // IGNORE QUEUE
    const currentSchema = schema;

    // 2. IMMEDIATE UI UPDATE: Navigate back to the list
    setActiveBuildingId(null);
    setSaveStatus('idle');

    // 3. Perform background save
    if (user && currentId) {
         const buildingToSave = buildings.find(b => b.id === currentId);
         if (buildingToSave) {
             const safeItems = JSON.parse(JSON.stringify(currentItems));
             // const safeQueue = JSON.parse(JSON.stringify(currentQueue));

             const updatedBuilding = {
                ...buildingToSave,
                items: safeItems, 
                queue: [], // FORCE EMPTY
                schema: currentSchema,
                updatedAt: Date.now(),
                isConfigured: buildingToSave.isConfigured || Object.keys(currentSchema).length > 0
             };

             // Optimistically update local buildings list
             setBuildings(prev => prev.map(b => b.id === currentId ? updatedBuilding : b));

             if (user.uid !== 'guest_user') {
                try {
                    await setDoc(doc(db, "users", user.uid, "buildings", currentId), updatedBuilding);
                } catch (e) {
                    console.error("Error saving on exit", e);
                }
             }
         }
    }
  };

  const handleDeleteBuilding = async (buildingId: string) => {
    if (!user) return;
    setBuildings(prev => prev.filter(b => b.id !== buildingId));
    if (activeBuildingId === buildingId) setActiveBuildingId(null);
    
    if (user.uid === 'guest_user') return;

    try {
        await deleteDoc(doc(db, "users", user.uid, "buildings", buildingId));
    } catch (e) {
        console.error("Error deleting", e);
    }
  };
  
  const handleLogout = () => {
      setDemoMode(false);
      if (user?.uid === 'guest_user') {
          setUser(null);
      } else {
          signOut(auth);
      }
      setActiveBuildingId(null);
  };
  
  const handleUseStandardReference = async () => {
      const newSchema = parseSchemaCSV(DEFAULT_SCHEMA_CSV);
      setSchema(newSchema);
      
      if (user && activeBuildingId) {
           const building = buildings.find(b => b.id === activeBuildingId);
           if (building) {
               const updatedBuilding = {
                   ...building,
                   schema: newSchema,
                   items, 
                   queue, // Queue local only
                   isConfigured: true,
                   updatedAt: Date.now()
               };
               
               setBuildings(prev => prev.map(b => b.id === activeBuildingId ? updatedBuilding : b));

               if (user.uid !== 'guest_user') {
                   // Safe save
                   try {
                       const safeItems = JSON.parse(JSON.stringify(items));
                       const safeUpdated = { ...updatedBuilding, items: safeItems, queue: [] }; // FORCE EMPTY
                       await setDoc(doc(db, "users", user.uid, "buildings", activeBuildingId), safeUpdated, { merge: true });
                   } catch(e) {
                       console.error("Error saving standard ref", e);
                   }
               }
           }
      }
  };

  const handleReferenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (text) {
          const newSchema = parseSchemaCSV(text);
          const mergedSchema = { ...schema };
          Object.keys(newSchema).forEach(cat => {
              if (!mergedSchema[cat]) mergedSchema[cat] = {};
              Object.keys(newSchema[cat]).forEach(sub => {
                  if (!mergedSchema[cat][sub]) mergedSchema[cat][sub] = {};
                  Object.keys(newSchema[cat][sub]).forEach(attr => {
                      mergedSchema[cat][sub][attr] = newSchema[cat][sub][attr];
                  });
              });
          });
          setSchema(mergedSchema);
          
          if (user && activeBuildingId) {
               const building = buildings.find(b => b.id === activeBuildingId);
               if (building) {
                   const updatedBuilding = {
                       ...building,
                       schema: mergedSchema,
                       items,
                       queue,
                       isConfigured: true,
                       updatedAt: Date.now()
                   };

                   setBuildings(prev => prev.map(b => b.id === activeBuildingId ? updatedBuilding : b));

                   if (user.uid !== 'guest_user') {
                       try {
                           const safeItems = JSON.parse(JSON.stringify(items));
                           const safeUpdated = { ...updatedBuilding, items: safeItems, queue: [] }; // FORCE EMPTY
                           await setDoc(doc(db, "users", user.uid, "buildings", activeBuildingId), safeUpdated, { merge: true });
                       } catch(e) {
                           console.error("Error saving custom ref", e);
                       }
                   }
               }
          }
      }
    };
    reader.readAsText(file);
  };

  const retryQueueItem = (itemId: string) => {
      setQueue(prev => prev.map(item => 
          item.id === itemId ? { ...item, status: 'pending', error: undefined } : item
      ));
      setQuotaExceeded(false); 
  };

  const handleManualQueueResolve = (qItem: QueueItem) => {
      if (!qItem.imageBase64) return;
      
      // Create a temporary inspection item to pass to MergeItemModal
      const tempItem: InspectionItem = {
          id: qItem.id, // Use queue ID to track it
          category: "Non catégorisé",
          subCategory: "Image non analysée",
          attributes: {},
          attributeHistory: {},
          scoreHistory: [50],
          averageScore: 50,
          confiance: 0,
          commentaire: "Ajout manuel suite à erreur d'analyse",
          isPrimarySubject: true,
          photos: [{
              imageUrl: qItem.imageBase64,
              timestamp: qItem.timestamp
          }],
          lastUpdated: Date.now(),
          isManuallyEdited: true
      };

      // Set as merging item to trigger the modal
      setMergingItem(tempItem);
  };

  const handleMergeItem = (targetId: string) => {
    if (!mergingItem) return;
    setItems(prev => {
        const target = prev[targetId];
        const source = mergingItem;
        if (!target) return prev;
        const newPhotos = [...target.photos, ...source.photos];
        const updatedHistory = { ...target.attributeHistory };
        const updatedScores = [...(target.scoreHistory || []), ...(source.scoreHistory || [])];
        source.photos.forEach(p => {
            if (p.detectedAttributes) {
                Object.entries(p.detectedAttributes).forEach(([key, val]) => {
                     if (key === 'Etat') return;
                     if (!updatedHistory[key]) updatedHistory[key] = [];
                     updatedHistory[key].push(val);
                });
            }
        });
        let mergedComment = target.commentaire;
        if (source.commentaire && source.commentaire !== target.commentaire) {
            mergedComment += `\n\n[Fusionné]: ${source.commentaire}`;
        }
        let mergedAttributes = calculateDominantAttributes(target.attributes, updatedHistory);
        const newAverage = calculateAverageScore(updatedScores);
        // Force state from score
        mergedAttributes["Etat"] = getStateFromScore(newAverage);
        
        const newItems = { ...prev };
        newItems[targetId] = {
            ...target,
            photos: newPhotos,
            attributeHistory: updatedHistory,
            scoreHistory: updatedScores,
            attributes: mergedAttributes,
            commentaire: mergedComment,
            averageScore: newAverage,
            lastUpdated: Date.now()
        };
        // If the source was in the list (real item), delete it. 
        if (newItems[source.id]) delete newItems[source.id];
        return newItems;
    });
    
    // Remove from queue if it was a queue item
    setQueue(prev => prev.filter(q => q.id !== mergingItem.id));
    
    setMergingItem(null);
    setQuotaExceeded(false); // Restart queue
  };

  const handleRenameItem = (newCat: string, newSubCat: string) => {
      if (!mergingItem) return;
      setItems(prev => {
          const source = mergingItem;
          const existingTargetId = Object.keys(prev).find(key => 
              prev[key].category === newCat && prev[key].subCategory === newSubCat
          );
          if (existingTargetId) {
             const target = prev[existingTargetId];
             const newPhotos = [...target.photos, ...source.photos];
             const updatedHistory = { ...target.attributeHistory };
             const updatedScores = [...(target.scoreHistory || []), ...(source.scoreHistory || [])];
             source.photos.forEach(p => {
                if (p.detectedAttributes) {
                    Object.entries(p.detectedAttributes).forEach(([key, val]) => {
                         if (key === 'Etat') return;
                         if (!updatedHistory[key]) updatedHistory[key] = [];
                         updatedHistory[key].push(val);
                    });
                }
             });
             let mergedComment = target.commentaire;
             if (source.commentaire) mergedComment += `\n\n[Fusionné]: ${source.commentaire}`;
             let mergedAttributes = calculateDominantAttributes(target.attributes, updatedHistory);
             const newAverage = calculateAverageScore(updatedScores);
             // Force state from score
             mergedAttributes["Etat"] = getStateFromScore(newAverage);
             
             const newItems = { ...prev };
             newItems[existingTargetId] = { ...target, photos: newPhotos, attributeHistory: updatedHistory, scoreHistory: updatedScores, attributes: mergedAttributes, commentaire: mergedComment, averageScore: newAverage, lastUpdated: Date.now() };
             if (newItems[source.id]) delete newItems[source.id];
             return newItems;
          }
          const newItems = { ...prev };
          // If renaming from existing, delete old ID first
          if (newItems[source.id]) delete newItems[source.id];
          // Create new
          newItems[source.id] = { ...source, category: newCat, subCategory: newSubCat, lastUpdated: Date.now() };
          return newItems;
      });

      // Remove from queue if it was a queue item
      setQueue(prev => prev.filter(q => q.id !== mergingItem.id));

      setMergingItem(null);
      setQuotaExceeded(false); // Restart queue
  };

  const handleSelectCategory = (cat: string) => {
      setActiveCategory(cat);
      setShowCategoryMenu(false);
      
      if (categoryNavRef.current) {
          const yOffset = -90; 
          const y = categoryNavRef.current.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({top: y, behavior: 'smooth'});
      }
  };

  const handleDeleteItem = (itemId: string) => {
      setItems(prev => {
          const newItems = { ...prev };
          delete newItems[itemId];
          return newItems;
      });
      setEditingItem(null);
  };

  // === PDF GENERATION FOR PREVIEW ===
  const handleViewReport = async () => {
    const building = buildings.find(b => b.id === activeBuildingId);
    if (!building) return;
    
    setIsGeneratingPdf(true);
    try {
        const blob = await generatePDF(building, items);
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
    } catch (e) {
        console.error("Erreur génération PDF", e);
        alert("Erreur lors de la génération du rapport PDF. Vérifiez la connexion pour le téléchargement des images.");
    } finally {
        setIsGeneratingPdf(false);
    }
  };

  // === BATCH SUMMARY LOGIC (RESTARTED LOGIC) ===
  const handleBatchSummarize = async () => {
    // 1. Identify items to process: Get all values, force typed as Array
    const allItems = Object.values(items) as InspectionItem[];
    
    // Filter only those with comments that are not empty
    const itemsToProcess = allItems.filter(i => i.commentaire && i.commentaire.trim().length > 0);
    console.log(`Starting Batch Summary. Found ${itemsToProcess.length} candidates.`);

    if (itemsToProcess.length === 0) {
        alert("Aucun commentaire à synthétiser n'a été trouvé dans vos éléments.");
        return;
    }

    const totalCost = itemsToProcess.length * AI_COSTS.SUMMARY;
    
    // CHECK BALANCE
    if (userCoins < totalCost) {
        alert(`Crédits insuffisants. Il vous faut ${totalCost} coins.`);
        return;
    }

    const confirmMsg = `Synthétiser ${itemsToProcess.length} commentaires ?\nCoût estimé : ${totalCost} coins.\n\nCette action utilisera l'IA pour standardiser vos notes.`;
    if (!window.confirm(confirmMsg)) return;

    // DEDUCT COINS (Upfront)
    const success = await handleSpendCoins(totalCost);
    if (!success) return;
    
    // 2. Initialize UI State
    setIsBatchSummarizing(true);
    setBatchProgress({ current: 0, total: itemsToProcess.length });
    
    // 3. SEQUENTIAL PROCESSING (No Promise.all, strictly one by one)
    for (const item of itemsToProcess) {
        try {
            // Call AI Service
            const summary = await summarizeInspectionComment(item.commentaire, item.category, item.subCategory);
            
            // Check if summary is actually different to avoid useless updates
            if (summary !== item.commentaire) {
                // UPDATE STATE IMMEDIATELY using functional update to respect concurrent changes
                setItems(prev => {
                    // Safety check: ensure item still exists in state
                    if (!prev[item.id]) return prev;

                    return {
                        ...prev,
                        [item.id]: {
                            ...prev[item.id],
                            commentaire: summary,
                            isManuallyEdited: true, // Lock it so AI scanning doesn't overwrite it later
                            lastUpdated: Date.now()
                        }
                    };
                });
            }

        } catch (err) {
            console.error(`Failed to summarize item ${item.id}`, err);
            // We continue to next item even if one fails
        }

        // Update progress bar
        setBatchProgress(prev => ({ ...prev, current: prev.current + 1 }));

        // 4. RATE LIMIT PROTECTION
        // Wait 500ms between calls to be gentle with the AI provider rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 5. Finish
    setIsBatchSummarizing(false);
    alert("Synthèse terminée avec succès !");
  };

  // === VOICE RECORDING LOGIC ===
  const handleVoiceCommand = async () => {
    if (isRecording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        // State update handled in onend
      }
      return;
    }

    // Check Balance AND Deduct upfront
    // Voice allows 1 command per click for now
    const success = await handleSpendCoins(AI_COSTS.AUDIO_TRANSCRIPTION);
    if (!success) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("La reconnaissance vocale n'est pas supportée par votre navigateur.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        setIsRecording(true);
    };
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (!transcript) return;

      console.log("Voice Transcript:", transcript);
      
      setQueue(prev => [...prev, { 
          id: Math.random().toString(), 
          type: 'audio', 
          textPayload: transcript, 
          status: 'pending', 
          timestamp: Date.now() 
      }]);
    };

    recognition.onerror = (event: any) => {
      console.error("Voice error", event.error);
      setIsRecording(false);
      if (event.error === 'not-allowed') {
         alert("Accès au microphone refusé. Veuillez vérifier vos permissions de navigateur.");
      } else if (event.error === 'no-speech') {
         // Ignore no-speech errors, just stop
      } else {
         alert("Erreur vocale : " + event.error);
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
        recognition.start();
    } catch (e) {
        console.error("Failed to start recognition", e);
        setIsRecording(false);
    }
  };

  // === QUEUE PROCESSOR ===
  useEffect(() => {
    const processNext = async () => {
      if (isProcessingQueue || isOffline || quotaExceeded) return;
      if (networkRetryAt && Date.now() < networkRetryAt) return; // coupure réseau récente : on attend
      
      const pendingIdx = queue.findIndex(i => i.status === 'pending');
      if (pendingIdx === -1) return;
      
      setIsProcessingQueue(true);
      const queueItem = queue[pendingIdx];
      
      // Mark as analyzing
      const startMessage = queueItem.type === 'audio' ? "Analyse du texte..." : "Préparation de l'image...";
      setQueue(prev => prev.map(item => 
          item.id === queueItem.id ? { ...item, status: 'analyzing', progressStep: startMessage } : item
      ));

      // Update progress step helper
      const updateProgress = (step: string) => {
            setQueue(prev => prev.map(item => 
                item.id === queueItem.id ? { ...item, progressStep: step } : item
            ));
      };

      try {
          let results: InspectionResult[] = [];
          let analysis: AnalysisOutput | null = null;

          // DISPATCH BASED ON TYPE (V2 : via la fonction serveur, modèle au choix)
          if (queueItem.type === 'audio' && queueItem.textPayload) {
              analysis = await analyzeInspectionText(queueItem.textPayload, schema, updateProgress);
          } else if (queueItem.type === 'image' && queueItem.imageBase64) {
              analysis = await analyzeInspectionImage(queueItem.imageBase64, schema, updateProgress, {
                  note: queueItem.note,
                  hint: queueItem.target,
              });
          }
          if (analysis) {
              results = analysis.results;
          } else {
             // Invalid item (no content)
             setQueue(prev => prev.filter(i => i.id !== queueItem.id));
             setIsProcessingQueue(false);
             return;
          }
          
          // === NEW: UPLOAD IMAGE TO FIREBASE STORAGE (IF LOGGED IN) ===
          let finalImageUrl = queueItem.imageBase64;
          
          // Only upload if:
          // 1. It is an image
          // 2. We have a valid base64
          // 3. User is logged in AND not Guest
          // 4. We are online (implicit via processNext logic but good to handle)
          if (queueItem.type === 'image' && queueItem.imageBase64 && user && user.uid !== 'guest_user' && activeBuildingId) {
             updateProgress("Sauvegarde de la photo...");
             try {
                // The storage service now handles the base64 upload
                const downloadUrl = await uploadInspectionImage(user.uid, activeBuildingId, queueItem.imageBase64);
                finalImageUrl = downloadUrl;
                console.log("Image uploaded successfully:", downloadUrl);
             } catch (uploadError) {
                console.warn("Upload failed, falling back to base64 for now:", uploadError);
                // Proceed with base64 so we don't lose the analysis
             }
          }

          updateProgress("Mise à jour du rapport...");

          // === GENERIC MERGING LOGIC (Shared for Audio & Image) ===
          // For audio, we don't have a specific "photo target", so photoTargetIndex = -1
          let photoTargetIndex = -1;
          
          // For images, detect primary target
          if (queueItem.type === 'image' && results.length > 0) {
             photoTargetIndex = 0; // Default
             if (results.length > 1) {
                const primaries = results.map((r, i) => ({ index: i, ...r })).filter(r => r.isPrimarySubject);
                if (primaries.length > 0) {
                    primaries.sort((a, b) => b.confiance - a.confiance);
                    photoTargetIndex = primaries[0].index;
                } else {
                    const sortedByConf = results.map((r, i) => ({ index: i, ...r })).sort((a, b) => b.confiance - a.confiance);
                    photoTargetIndex = sortedByConf[0].index;
                }
             }
          }

          setItems(prevItems => {
              const nextItems = { ...prevItems };
              results.forEach((res, index) => {
                  const existingId = Object.keys(nextItems).find(key => 
                      nextItems[key].category === res.category && 
                      nextItems[key].subCategory === res.subCategory
                  );
                  const score = res.conditionScore !== undefined ? res.conditionScore : 50;
                  
                  let targetId = existingId;
                  let itemToUpdate = existingId ? nextItems[existingId] : null;
                  
                  // CREATE NEW ITEM IF NOT EXISTS
                  if (!itemToUpdate) {
                      targetId = `${Math.random().toString(36).substr(2, 9)}`;
                      itemToUpdate = {
                          ...res,
                          id: targetId,
                          photos: [],
                          attributeHistory: {},
                          scoreHistory: [score],
                          averageScore: score,
                          lastUpdated: Date.now(),
                          attributes: { ...res.attributes, "Etat": getStateFromScore(score) },
                          isManuallyEdited: false
                      };
                  }
                  
                  const isManual = itemToUpdate.isManuallyEdited;
                  const updatedHistory = { ...itemToUpdate.attributeHistory };
                  const updatedScoreHistory = [...(itemToUpdate.scoreHistory || [])];
                  
                  // UPDATE HISTORY & SCORES (Unless manually locked)
                  if (!isManual) {
                    Object.entries(res.attributes).forEach(([key, val]) => {
                         if (key === 'Etat') return;
                         if (!updatedHistory[key]) updatedHistory[key] = [];
                         updatedHistory[key].push(val);
                    });
                    updatedScoreHistory.push(score);
                  }
                  
                  // UPDATE ATTRIBUTES
                  let mergedAttributes = { ...itemToUpdate.attributes };
                  if (!isManual) {
                      mergedAttributes = calculateDominantAttributes(mergedAttributes, updatedHistory);
                  }
                  
                  // ATTACH PHOTO (Only if Image type AND match target index)
                  let newPhotos = [...itemToUpdate.photos];
                  if (queueItem.type === 'image' && index === photoTargetIndex && finalImageUrl) {
                      const meta: AnalysisMeta = {
                          model: analysis?.meta?.model,
                          latencyMs: analysis?.meta?.latencyMs,
                          source: queueItem.source,
                      };
                      newPhotos.push({
                          imageUrl: finalImageUrl, // NOW USING URL OR BASE64 FALLBACK
                          timestamp: Date.now(),
                          detectedAttributes: res.attributes,
                          meta: JSON.parse(JSON.stringify(meta)),
                      });
                  }

                  // MERGE COMMENTS
                  let mergedComment = itemToUpdate.commentaire;
                  if (res.commentaire && res.commentaire.trim() !== '') {
                      if (!mergedComment) {
                          mergedComment = res.commentaire;
                      } else if (!mergedComment.includes(res.commentaire)) {
                          const prefix = queueItem.type === 'audio' ? '[Vocal]' : queueItem.source === 'guided' ? '[Visite]' : '[+]';
                          mergedComment = `${mergedComment}\n\n${prefix}: ${res.commentaire}`;
                      }
                  }
                  
                  // RECALCULATE SCORE
                  let newAverage = itemToUpdate.averageScore;
                  if (!isManual) {
                      newAverage = calculateAverageScore(updatedScoreHistory);
                      // Force State from Score
                      mergedAttributes["Etat"] = getStateFromScore(newAverage);
                  }

                  nextItems[targetId] = {
                      ...itemToUpdate,
                      category: res.category,
                      subCategory: res.subCategory,
                      attributes: mergedAttributes,
                      attributeHistory: updatedHistory,
                      scoreHistory: updatedScoreHistory,
                      confiance: res.confiance,
                      commentaire: mergedComment, 
                      photos: newPhotos,
                      averageScore: newAverage,
                      lastUpdated: Date.now()
                  };
              });
              return nextItems;
          });
          
          updateProgress("Terminé");
          
          // Success: Remove from queue
          setQueue(prev => prev.filter(i => i.id !== queueItem.id));

      } catch (e: any) {
          console.error(e);
          // Réseau coupé : la photo reste en attente et repartira toute seule
          if (e instanceof AiCallError && e.kind === 'network') {
              setQueue(prev => prev.map(item =>
                  item.id === queueItem.id ? { ...item, status: 'pending', progressStep: 'En attente du réseau' } : item
              ));
              setNetworkRetryAt(Date.now() + 15000);
              return;
          }
          const msg = String(e?.message || "Erreur Analyse");
          const isQuota = (e instanceof AiCallError && e.kind === 'quota') || msg.includes("429") || msg.toLowerCase().includes("quota");
          setQuotaExceeded(!!isQuota);
          
          // Set error state by ID
          setQueue(prev => prev.map(item => 
              item.id === queueItem.id ? { ...item, status: 'error', error: isQuota ? `Quota atteint — ${msg}` : msg } : item
          ));
      } finally {
          setIsProcessingQueue(false);
      }
    };
    processNext();
  }, [queue, isProcessingQueue, items, schema, isOffline, quotaExceeded, activeBuildingId, user, networkRetryAt]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      
      const totalCost = files.length * AI_COSTS.IMAGE_ANALYSIS;
      
      // CHECK & DEDUCT COINS
      if (userCoins < totalCost) {
          alert(`Crédits insuffisants. L'analyse coûte ${totalCost} coins (${files.length} images).`);
          return;
      }
      const success = await handleSpendCoins(totalCost);
      if (!success) return;

      setQuotaExceeded(false);
      const newQ: QueueItem[] = [];
      for (let i=0; i<files.length; i++) {
          try {
              const b64 = await resizeImage(files[i]);
              newQ.push({ 
                  id: Math.random().toString(), 
                  type: 'image', // Standard image type
                  imageBase64: b64, 
                  status: 'pending', 
                  timestamp: Date.now() 
              });
          } catch {}
      }
      setQueue(prev => [...prev, ...newQ]);
      e.target.value = '';
  };
  // === VISITE GUIDÉE (V2) ===
  // Photo HD prise pendant la visite : analysée en détail par la file, avec les paroles de l'inspecteur
  const handleGuidedCapture = async (capture: GuidedCapture): Promise<boolean> => {
      if (userCoins < AI_COSTS.IMAGE_ANALYSIS) return false;
      const ok = await handleSpendCoins(AI_COSTS.IMAGE_ANALYSIS);
      if (!ok) return false;
      setQuotaExceeded(false);
      setQueue(prev => [...prev, {
          id: capture.id,
          type: 'image',
          imageBase64: capture.imageBase64,
          note: capture.note || undefined,
          target: capture.target || undefined,
          source: 'guided',
          status: 'pending',
          timestamp: Date.now(),
      }]);
      return true;
  };

  // Paroles prononcées après la dernière photo : traitées comme une note vocale
  const handleGuidedLeftoverSpeech = async (text: string) => {
      if (!text.trim() || userCoins < AI_COSTS.AUDIO_TRANSCRIPTION) return;
      const ok = await handleSpendCoins(AI_COSTS.AUDIO_TRANSCRIPTION);
      if (!ok) return;
      setQueue(prev => [...prev, {
          id: `v_${Date.now().toString(36)}`,
          type: 'audio',
          textPayload: text,
          source: 'voice',
          status: 'pending',
          timestamp: Date.now(),
      }]);
  };

  const handleManualSave = (newItem: InspectionItem) => {
      setItems(prev => ({ ...prev, [newItem.id]: newItem }));
      setManualModalConfig(null);
  };
  const handleUpdateItem = (id: string, updated: InspectionItem) => {
      setItems(prev => ({ ...prev, [id]: updated }));
      setEditingItem(null);
  };
  const handleAddPhotoToItem = async (itemId: string, file: File) => {
      // MODIFIED: As requested, we now purely add the photo without triggering Gemini analysis.
      // This allows manual photo attachment without consuming credits or altering attributes/scores automatically.
      
      try {
        const b64 = await resizeImage(file);
        
        let finalUrl = b64;
        // Upload immediately if logged in
        if (user && user.uid !== 'guest_user' && activeBuildingId) {
            try {
               finalUrl = await uploadInspectionImage(user.uid, activeBuildingId, b64);
            } catch (err) {
               console.warn("Manual photo upload failed, using base64");
            }
        }
        
        setItems(prev => {
            const item = prev[itemId];
            if (!item) return prev;

            const newPhoto = { 
                imageUrl: finalUrl, 
                timestamp: Date.now()
                // detectedAttributes undefined
            };

            return {
                ...prev,
                [itemId]: {
                    ...item,
                    photos: [...item.photos, newPhoto],
                    lastUpdated: Date.now()
                }
            };
        });
      } catch (e) {
        console.error("Error adding photo manually", e);
        alert("Erreur lors de l'ajout de la photo.");
      }
  };
  const handleDeletePhoto = (photoIndex: number) => {
      if (!viewingItemId) return;
      setItems(prev => {
          const item = prev[viewingItemId];
          if (!item) return prev;
          const newPhotos = [...item.photos];
          newPhotos.splice(photoIndex, 1);
          return { ...prev, [viewingItemId]: { ...item, photos: newPhotos } };
      });
  };
  // === EXPORTS ===
  const handleGlobalDownload = async () => {
      setIsDownloading(true);
      try {
          const zip = new JSZip();
          const activeBuilding = buildings.find(b => b.id === activeBuildingId);
          if (!activeBuilding) return;

          const buildingNameSafe = activeBuilding.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'batiment';
          const dateStr = new Date().toISOString().split('T')[0];
          
          // 1. CSV
          const headers = ["ID", "Catégorie", "Sous-Catégorie", "Score Moyen", "Nb Photos", "Attributs", "Confiance", "Commentaire"];
          const rows = (Object.values(items) as InspectionItem[]).map((item) => {
              const attrString = Object.entries(item.attributes).map(([k, v]) => `${k}: ${v}`).join(" | ");
              return [item.id, item.category, item.subCategory, `${item.averageScore}%`, item.photos.length, attrString, item.confiance, item.commentaire];
          });
          const csvContent = [headers.join(","), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
          zip.file(`donnees_${dateStr}.csv`, csvContent);

          // 2. Photos Folder
          const photosFolder = zip.folder("photos");
          if (photosFolder) {
              // DOWNLOAD LOGIC REWRITTEN FOR SEQUENTIAL FETCHING
              const allItems = Object.values(items) as InspectionItem[];
              
              for (const item of allItems) {
                  for (let i = 0; i < item.photos.length; i++) {
                      const photo = item.photos[i];
                      const safeCat = item.category.replace(/[^a-z0-9]/gi, '-');
                      const safeSub = item.subCategory.replace(/[^a-z0-9]/gi, '-');
                      const fileName = `${safeCat}_${safeSub}_${item.id.substring(0,4)}_${i + 1}.jpg`;

                      try {
                          if (photo.imageUrl.startsWith('http')) {
                              // Use specific CORS mode
                              const response = await fetch(photo.imageUrl, { mode: 'cors' });
                              if (response.ok) {
                                  const blob = await response.blob();
                                  photosFolder.file(fileName, blob);
                              } else {
                                  console.warn(`Failed to fetch image: ${response.status} for ${fileName}`);
                              }
                          } else if (photo.imageUrl.startsWith('data:image')) {
                              // Base64
                              const parts = photo.imageUrl.split(',');
                              if (parts.length === 2) {
                                  photosFolder.file(fileName, parts[1], {base64: true});
                              }
                          }
                      } catch (err) {
                          console.warn(`Failed to download photo ${fileName} for zip. Possible CORS issue on Storage Bucket.`, err);
                      }
                  }
              }
          }

          // 3. Generate PDF Report
          try {
             const pdfBlob = await generatePDF(activeBuilding, items);
             zip.file(`Rapport_Audit_${buildingNameSafe}.pdf`, pdfBlob);
          } catch (e) {
             console.error("PDF generation error", e);
          }

          // 4. Generate DOCX Report
          try {
             const docxBlob = await generateDOCX(activeBuilding, items);
             zip.file(`Rapport_Audit_${buildingNameSafe}.docx`, docxBlob);
          } catch (e) {
             console.error("DOCX generation error", e);
          }

          // 5. Finalize Zip
          const blob = await zip.generateAsync({type:"blob"});
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `Inspection_${buildingNameSafe}_${dateStr}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      } catch (error) {
          console.error("ZIP Generation failed", error);
          alert("Erreur lors de la création du ZIP. Vérifiez la console pour les détails CORS.");
      } finally {
          setIsDownloading(false);
      }
  };

  // NEW STATS CALCULATION WITH STRICT COMPLETENESS
  const stats = useMemo(() => {
      const totalPhotos = (Object.values(items) as InspectionItem[]).reduce((acc: number, i) => acc + i.photos.length, 0);
      let schemaItemCount = 0;
      let completedItemCount = 0; // Changed from detected to completed
      const categoryStats: Record<string, { total: number, detected: number, completed: number }> = {};
      
      Object.entries(schema).forEach(([cat, subCats]) => {
          const subs = Object.keys(subCats);
          categoryStats[cat] = { total: subs.length, detected: 0, completed: 0 };
          
          subs.forEach(sub => {
              schemaItemCount++;
              const item = (Object.values(items) as InspectionItem[]).find((i) => i.category === cat && i.subCategory === sub);
              
              if (item) { 
                  categoryStats[cat].detected++;
                  const missing = getMissingAttributes(item, schema);
                  if (missing.length === 0) {
                      categoryStats[cat].completed++;
                      completedItemCount++;
                  }
              }
          });
      });
      // Percentage based on COMPLETED items
      const percent = schemaItemCount > 0 ? Math.round((completedItemCount / schemaItemCount) * 100) : 0;
      return { totalPhotos, schemaItemCount, completedItemCount, percent, categoryStats };
  }, [items, schema]);

  const activeBuilding = buildings.find(b => b.id === activeBuildingId);
  const allCategories = useMemo(() => {
      const schemaCats = Object.keys(schema);
      const itemCats = (Object.values(items) as InspectionItem[]).map((i) => i.category);
      const unique = Array.from(new Set([...schemaCats, ...itemCats]));
      return sortCategories(unique);
  }, [schema, items]);

  const uncategorizedCount = useMemo(() => {
      return (Object.values(items) as InspectionItem[]).filter((i) => i.category === "Non catégorisé").length;
  }, [items]);
  const groupedItems = useMemo(() => {
      const groups: Record<string, Record<string, InspectionItem[]>> = {};
      (Object.values(items) as InspectionItem[]).forEach((item) => {
          if (!groups[item.category]) groups[item.category] = {};
          if (!groups[item.category][item.subCategory]) groups[item.category][item.subCategory] = [];
          groups[item.category][item.subCategory].push(item);
      });
      return groups;
  }, [items]);

  const allMissingItems = useMemo(() => {
      const missing: {category: string, subCategory: string}[] = [];
      Object.keys(schema).forEach(cat => {
          const allSubCats = Object.keys(schema[cat] || {});
          const existingSubCats = Object.keys(groupedItems[cat] || {});
          const missingForCat = allSubCats.filter(sub => !existingSubCats.includes(sub));
          missingForCat.forEach(sub => missing.push({ category: cat, subCategory: sub }));
      });
      
      // Use shared sort function for categories
      return missing.sort((a, b) => {
          const catCompare = sortCategories([a.category, b.category]);
          if (catCompare[0] === a.category && a.category !== b.category) return -1;
          if (catCompare[0] === b.category && a.category !== b.category) return 1;
          return a.subCategory.localeCompare(b.subCategory);
      });
  }, [schema, groupedItems]);

  // Logic for UI disables based on balance
  const canAffordImage = userCoins >= AI_COSTS.IMAGE_ANALYSIS;
  const canAffordAudio = userCoins >= AI_COSTS.AUDIO_TRANSCRIPTION;
  const canAffordBatch = (count: number) => userCoins >= (count * AI_COSTS.SUMMARY);

  // === RENDERING ===
  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>;
  
  if (!user) return <LoginScreen onGuestLogin={() => {
      const guestUser = {
          uid: 'guest_user',
          displayName: 'Invité (Mode Démo)',
          email: 'guest@example.com',
          isAnonymous: true,
          emailVerified: true,
          providerData: [],
          metadata: {},
          refreshToken: '',
          tenantId: null,
          delete: async () => {},
          getIdToken: async () => 'guest-token',
          getIdTokenResult: async () => ({} as any),
          reload: async () => {},
          toJSON: () => ({}),
          phoneNumber: null,
          photoURL: null,
          providerId: 'guest'
      } as unknown as User;
      
      setUser(guestUser);
      setDemoMode(true); // pas de compte = pas d'accès au serveur IA : IA simulée
      // FIXED: Set credits explicitly for guest mode here, as onAuthStateChanged won't fire for local user object
      setUserCoins(3500);
      setUserPlan('pro');
  }} />;

  if (!activeBuildingId) {
      return (
        <>
            <div className="absolute top-4 right-4 z-50">
                <button 
                    onClick={handleLogout} 
                    className="p-3 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-all shadow-sm"
                    title={`Déconnexion ${user.uid === 'guest_user' ? '(Invité)' : ''}`}
                >
                    <LogOut size={20}/>
                </button>
            </div>
            <BuildingListScreen 
                buildings={buildings} 
                onCreateBuilding={handleCreateBuilding} 
                onSelectBuilding={handleSelectBuilding} 
                onDeleteBuilding={handleDeleteBuilding}
                userCoins={userCoins}
                userPlan={userPlan}
            />
        </>
      );
  }
  
  if (!activeBuilding?.isConfigured && Object.keys(schema).length === 0) {
      return (
          <>
            <Header buildingName={activeBuilding?.name} onBack={() => setActiveBuildingId(null)} />
            <SetupScreen onSelectStandard={handleUseStandardReference} onSelectCustom={handleReferenceUpload} />
          </>
      );
  }

  return (
    <div className="min-h-screen pb-12 bg-slate-50">

      {/* V2 : VISITE GUIDÉE PLEIN ÉCRAN */}
      {showGuided && (
        <GuidedVisit
          schema={schema}
          items={items}
          queue={queue}
          isOffline={isOffline}
          demoMode={isDemoMode()}
          userCoins={userCoins}
          onSpendCoins={handleSpendCoins}
          onCapture={handleGuidedCapture}
          onLeftoverSpeech={handleGuidedLeftoverSpeech}
          onClose={() => { setShowGuided(false); setIsQueueCollapsed(false); }}
        />
      )}

      {/* V2 : CHOIX DES MODÈLES + BANC D'ESSAI */}
      {showModelSettings && (
        <ModelSettingsModal
          schema={schema}
          userCoins={userCoins}
          onSpendCoins={handleSpendCoins}
          onClose={() => setShowModelSettings(false)}
          onSaved={() => refreshModelLabel()}
        />
      )}
      
      {/* PDF VIEWER MODAL */}
      {pdfUrl && (
          <div className="fixed inset-0 z-[150] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden mx-4">
                  <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center shrink-0">
                      <div className="flex items-center gap-2">
                          <FileText size={20} className="text-blue-400" />
                          <h3 className="font-bold hidden sm:block">Aperçu du Rapport</h3>
                          <h3 className="font-bold sm:hidden">Rapport</h3>
                      </div>
                      <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                                if (pdfUrl) {
                                    const link = document.createElement('a');
                                    link.href = pdfUrl;
                                    link.download = `Rapport_${(activeBuilding?.name || 'Inspection').replace(/\s+/g, '_')}.pdf`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                }
                            }}
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-colors shadow-sm"
                          >
                            <Download size={16} />
                            <span>Télécharger</span>
                          </button>
                          <button 
                            onClick={() => setPdfUrl(null)}
                            className="p-2 hover:bg-slate-800 rounded-full transition-colors"
                          >
                              <X size={24} />
                          </button>
                      </div>
                  </div>
                  <div className="flex-1 bg-slate-100 relative">
                      <iframe 
                          src={pdfUrl} 
                          className="w-full h-full border-0" 
                          title="PDF Preview"
                      />
                  </div>
              </div>
          </div>
      )}

      {/* RECORDING OVERLAY */}
      {isRecording && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-6 animate-in zoom-in-95 max-w-sm w-full mx-4">
                <div className="relative">
                    <div className="absolute inset-0 bg-red-400 rounded-full animate-ping opacity-25"></div>
                    <div className="p-6 bg-red-500 rounded-full text-white relative z-10 shadow-lg shadow-red-200">
                        <Mic size={40} />
                    </div>
                </div>
                
                <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold text-slate-900">Je vous écoute...</h3>
                    <p className="text-slate-500 text-sm">Décrivez l'élément, son état et ses caractéristiques.</p>
                </div>
                
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                     <div className="h-full bg-red-500 animate-[progress_1.5s_ease-in-out_infinite] w-1/2 rounded-full mx-auto"></div>
                </div>

                <button 
                    onClick={() => {
                        if (recognitionRef.current) recognitionRef.current.stop();
                    }}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                >
                    <StopCircle size={20} />
                    Arrêter
                </button>
            </div>
        </div>
      )}

      {/* BATCH PROCESSING LOADING OVERLAY */}
      {isBatchSummarizing && (
        <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
            <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full mx-6 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 relative">
                    <Loader2 size={32} className="text-indigo-600 animate-spin" />
                    <div className="absolute inset-0 border-4 border-indigo-100 rounded-full opacity-50"></div>
                </div>
                
                <h3 className="text-xl font-bold text-slate-900 mb-2">Synthèse en cours</h3>
                <p className="text-slate-500 text-sm mb-6">
                    L'intelligence artificielle reformule et structure vos commentaires...
                </p>

                {/* Progress Bar */}
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden mb-3">
                    <div 
                        className="h-full bg-indigo-600 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${Math.round((batchProgress.current / batchProgress.total) * 100)}%` }}
                    ></div>
                </div>
                
                <div className="flex justify-between w-full text-xs font-medium text-slate-400">
                    <span>Traitement...</span>
                    <span className="text-indigo-600 font-bold">{batchProgress.current} / {batchProgress.total}</span>
                </div>
            </div>
        </div>
      )}

      <Header 
        isOffline={isOffline} 
        buildingName={activeBuilding?.name} 
        buildingAddress={activeBuilding?.address}
        buildingEgid={activeBuilding?.egid}
        onBack={handleBack}
        onDownload={handleGlobalDownload}
        onViewReport={handleViewReport}
        isGeneratingReport={isGeneratingPdf}
        isDownloading={isDownloading}
        userCoins={userCoins}
        userPlan={userPlan}
        saveStatus={saveStatus}
      />
      
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        
        {/* STATS DASHBOARD */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
             <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                 <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><PieChart size={20}/></div>
                 <div>
                     <div className="text-xs text-slate-500 font-medium">Progression</div>
                     {/* Show COMPLETED / TOTAL */}
                     <div className="text-lg font-bold text-slate-900">{stats.completedItemCount} / {stats.schemaItemCount} <span className="text-xs text-slate-400 font-normal">({stats.percent}%)</span></div>
                 </div>
             </div>
             <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                 <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><ImageIcon size={20}/></div>
                 <div>
                     <div className="text-xs text-slate-500 font-medium">Photos</div>
                     <div className="text-lg font-bold text-slate-900">{stats.totalPhotos}</div>
                 </div>
             </div>
             <div className="col-span-2 bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center gap-2">
                 <div className="flex justify-between text-xs font-medium text-slate-500">
                     <span>Couverture de l'inspection (Complet)</span>
                     <span>{stats.percent}%</span>
                 </div>
                 <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                     <div className="bg-blue-600 h-full rounded-full transition-all duration-500" style={{ width: `${stats.percent}%` }}></div>
                 </div>
             </div>
        </div>

        {/* ACTION BAR (MAGIC DESIGN) */}
        <section className="relative overflow-hidden bg-white rounded-2xl shadow-xl border border-slate-100">
            {/* Gradient Top Bar */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>
            
            <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <Sparkles className="text-purple-600 animate-pulse" size={20} />
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-purple-700">
                            Assistant Intelligent
                        </span>
                    </h2>
                    <button
                        onClick={() => setShowModelSettings(true)}
                        className="text-xs font-semibold px-2 py-1 bg-purple-50 text-purple-700 rounded-lg border border-purple-100 flex items-center gap-1 hover:bg-purple-100 transition-colors max-w-[55%]"
                        title="Choisir et comparer les modèles d'IA"
                        data-testid="model-badge"
                    >
                        <BrainCircuit size={12} className="shrink-0" />
                        <span className="truncate">{analysisModelLabel || 'Modèles IA'}</span>
                        <Settings2 size={12} className="shrink-0 opacity-70" />
                    </button>
                </div>

                {/* V2 : VISITE GUIDÉE */}
                <button
                    onClick={() => setShowGuided(true)}
                    disabled={userCoins < AI_COSTS.GUIDED_MINUTE}
                    className="w-full mb-4 flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-200 hover:from-blue-500 hover:to-purple-500 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="start-guided"
                >
                    <div className="p-3 bg-white/15 rounded-full shrink-0">
                        <Video size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-bold">Visite guidée (vidéo)</div>
                        <div className="text-xs text-white/80">Filmez : l'IA vous dit quoi montrer et prend les photos utiles</div>
                    </div>
                    <span className="text-[10px] font-semibold bg-white/15 rounded-lg px-2 py-1 flex items-center gap-1 shrink-0">
                        {AI_COSTS.GUIDED_MINUTE} <Diamond size={10} />/min
                    </span>
                </button>

                <div className="grid grid-cols-3 gap-4 mt-2">
                    {/* IMPORT */}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!canAffordImage}
                        className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border shadow-sm transition-all group ${
                            !canAffordImage ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-100' : 'bg-white border-slate-100 hover:shadow-md hover:border-blue-300 hover:bg-blue-50/30'
                        }`}
                    >
                        <div className={`p-2.5 rounded-full transition-transform ${!canAffordImage ? 'bg-slate-200 text-slate-400' : 'bg-blue-100 text-blue-600 group-hover:scale-110'}`}>
                            <Upload size={22} />
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="text-xs font-bold text-slate-700 group-hover:text-blue-700">Galerie</span>
                            <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                                {AI_COSTS.IMAGE_ANALYSIS} <Diamond size={10} className="text-sky-500 fill-sky-500/20" />
                            </span>
                        </div>
                    </button>

                    {/* CAMERA */}
                    <button
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={!canAffordImage}
                        className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border shadow-sm transition-all group ${
                            !canAffordImage ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-100' : 'bg-white border-slate-100 hover:shadow-md hover:border-indigo-300 hover:bg-indigo-50/30'
                        }`}
                    >
                        <div className={`p-2.5 rounded-full transition-transform ${!canAffordImage ? 'bg-slate-200 text-slate-400' : 'bg-indigo-100 text-indigo-600 group-hover:scale-110'}`}>
                            <Camera size={22} />
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-700">Photo</span>
                            <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                                {AI_COSTS.IMAGE_ANALYSIS} <Diamond size={10} className="text-sky-500 fill-sky-500/20" />
                            </span>
                        </div>
                    </button>

                    {/* MIC */}
                    <button
                        onClick={handleVoiceCommand}
                        disabled={!canAffordAudio && !isRecording}
                        className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border shadow-sm transition-all group ${
                            isRecording
                            ? 'bg-red-50 border-red-200 shadow-inner'
                            : !canAffordAudio 
                                ? 'opacity-50 cursor-not-allowed bg-slate-50 border-slate-100'
                                : 'bg-white border-slate-100 hover:shadow-md hover:border-rose-300 hover:bg-rose-50/30'
                        }`}
                    >
                        <div className={`p-2.5 rounded-full transition-transform ${
                            isRecording
                            ? 'bg-red-500 text-white animate-pulse'
                            : !canAffordAudio ? 'bg-slate-200 text-slate-400' : 'bg-rose-100 text-rose-600 group-hover:scale-110'
                        }`}>
                            {isRecording ? <Loader2 size={22} className="animate-spin"/> : <Mic size={22} />}
                        </div>
                        <div className="flex flex-col items-center">
                            <span className={`text-xs font-bold ${isRecording ? 'text-red-600' : 'text-slate-700 group-hover:text-rose-700'}`}>
                                {isRecording ? "Stop" : "Vocal"}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                                {AI_COSTS.AUDIO_TRANSCRIPTION} <Diamond size={10} className="text-sky-500 fill-sky-500/20" />
                            </span>
                        </div>
                    </button>

                    {/* HIDDEN INPUTS */}
                    <input type="file" ref={fileInputRef} hidden multiple accept="image/*" onChange={handleFileUpload} />
                    <input type="file" ref={cameraInputRef} hidden accept="image/*" capture="environment" onChange={handleFileUpload} />
                </div>
            </div>
        </section>

        {/* QUEUE */}
        {queue.length > 0 && (
            <section className="space-y-3">
                <div 
                    onClick={() => setIsQueueCollapsed(!isQueueCollapsed)}
                    className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-all shadow-sm"
                >
                     <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg relative">
                            <Loader2 size={18} className={queue.some(i => i.status === 'analyzing') ? "animate-spin" : ""} />
                            {queue.some(i => i.status === 'error') && (
                                <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full border-2 border-white"></span>
                            )}
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm font-bold text-slate-800">File d'attente d'analyse</h3>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span>{queue.length} élément{queue.length > 1 ? 's' : ''} en cours</span>
                                {!isQueueCollapsed && (
                                    <span className="flex items-center gap-1 text-orange-600 font-medium bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">
                                        <ZapOff size={10} />
                                        Gardez l'écran allumé
                                    </span>
                                )}
                            </div>
                        </div>
                     </div>
                     <button className="text-slate-400">
                        {isQueueCollapsed ? <ChevronDown size={20}/> : <ChevronUp size={20}/>}
                     </button>
                </div>
                
                {!isQueueCollapsed && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {queue.map(q => (
                            <QueueCard 
                                key={q.id} 
                                item={q} 
                                onRetry={() => retryQueueItem(q.id)} 
                                onRemove={() => setQueue(prev => prev.filter(i => i.id !== q.id))} 
                                onView={() => q.imageBase64 && setViewingQueueItem(q)}
                                onManualResolve={() => handleManualQueueResolve(q)}
                            />
                        ))}
                    </div>
                )}
            </section>
        )}

        {/* CATEGORY NAV (STICKY) + SUMMARY BUTTON INTEGRATED */}
        <section ref={categoryNavRef} className="sticky top-[72px] z-30 bg-slate-50/95 backdrop-blur-sm py-2 -mx-4 px-4 border-b border-slate-200/50 shadow-sm transition-all">
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setShowCategoryMenu(true)}
                    className="p-2 bg-white text-slate-700 border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-colors shrink-0"
                    title="Voir toutes les catégories"
                >
                    <LayoutGrid size={20} />
                </button>

                <div className="flex-1 overflow-x-auto pb-0 gap-2 scrollbar-hide flex items-center">
                    
                    {allCategories.includes("Non catégorisé") && (
                        <button 
                            id="nav-cat-Non_cat_goris_"
                            onClick={() => setActiveCategory("Non catégorisé")}
                            className={`px-4 py-2 rounded-full text-sm font-bold border whitespace-nowrap transition flex items-center gap-2 shrink-0 ${activeCategory === "Non catégorisé" ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-orange-700 border-orange-200'}`}
                        >
                            <AlertTriangle size={16} />
                            Non catégorisé ({uncategorizedCount})
                        </button>
                    )}

                    <button id="nav-cat-ALL" onClick={() => setActiveCategory('ALL')} className={`px-4 py-2 rounded-full text-sm font-bold border transition shrink-0 ${activeCategory === 'ALL' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600'}`}>Tout</button>
                    
                    {allCategories.filter(cat => cat !== "Non catégorisé").map(cat => {
                        // Logic for indicators in horizontal scroll
                        const stat = stats.categoryStats[cat];
                        const isIncomplete = stat && stat.detected > stat.completed;
                        const isFullyComplete = stat && stat.total > 0 && stat.completed === stat.total;

                        return (
                            <button 
                                key={cat} 
                                id={`nav-cat-${cat.replace(/[^a-z0-9]/gi, '_')}`}
                                onClick={() => setActiveCategory(cat)} 
                                className={`px-4 py-2 rounded-full text-sm font-bold border whitespace-nowrap transition shrink-0 flex items-center gap-2 ${activeCategory === cat ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600'}`}
                            >
                                {cat} 
                                {/* Status Indicator */}
                                {isIncomplete && (
                                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="Éléments incomplets"></span>
                                )}
                                {isFullyComplete && (
                                    <CheckCircle2 size={12} className="text-green-500" />
                                )}
                                <span className={`opacity-70 font-normal ml-1 ${activeCategory === cat ? 'text-white' : 'text-slate-400'}`}>({stat?.completed || 0}/{stat?.total || 0})</span>
                            </button>
                        );
                    })}
                </div>

                {/* INTEGRATED SUMMARY BUTTON */}
                {Object.keys(items).length > 0 && (
                    <div className="pl-1 shrink-0 border-l border-slate-200 ml-1">
                        <button
                            onClick={handleBatchSummarize}
                            disabled={isBatchSummarizing}
                            className={`flex items-center gap-2 px-3 py-2 rounded-full font-bold text-xs transition-all shadow-sm ${
                                isBatchSummarizing 
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
                            }`}
                            title="Résumer tous les commentaires"
                        >
                           {isBatchSummarizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                           <span className="hidden sm:inline flex items-center gap-1">
                               Synthèse IA ({(Object.values(items) as any[]).filter(i => i.commentaire?.trim()).length * AI_COSTS.SUMMARY} <Diamond size={10} className="text-indigo-200 fill-indigo-200/20" />)
                           </span>
                           <span className="sm:hidden">IA</span>
                        </button>
                    </div>
                )}
            </div>
        </section>

        {/* FULL SCREEN CATEGORY MENU OVERLAY */}
        {showCategoryMenu && (
            <div className="fixed inset-0 z-[100] bg-white flex flex-col animate-in slide-in-from-bottom-5 duration-200">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50">
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <LayoutGrid size={20} className="text-blue-600" />
                        Navigation Rapide
                    </h2>
                    <button 
                        onClick={() => setShowCategoryMenu(false)}
                        className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                    >
                        <X size={24} className="text-slate-500" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {/* Special Buttons */}
                        {allCategories.includes("Non catégorisé") && (
                            <button 
                                onClick={() => handleSelectCategory("Non catégorisé")}
                                className="p-4 rounded-xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 hover:border-orange-300 transition-all text-left flex flex-col gap-2 group"
                            >
                                <div className="p-2 bg-orange-500 w-fit rounded-lg text-white group-hover:scale-110 transition-transform shadow-sm">
                                    <AlertTriangle size={24} />
                                </div>
                                <div>
                                    <div className="font-bold text-orange-900">Non catégorisé</div>
                                    <div className="text-xs text-orange-700 font-medium">{uncategorizedCount} éléments</div>
                                </div>
                            </button>
                        )}

                        <button 
                            onClick={() => handleSelectCategory("ALL")}
                            className="p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-slate-400 hover:shadow-md transition-all text-left flex flex-col gap-2 group"
                        >
                            <div className="p-2 bg-slate-700 w-fit rounded-lg text-white group-hover:scale-110 transition-transform shadow-sm">
                                <LayoutGrid size={24} />
                            </div>
                            <div>
                                <div className="font-bold text-slate-900">Tout Voir</div>
                                <div className="text-xs text-slate-500 font-medium">{Object.keys(items).length} éléments</div>
                            </div>
                        </button>

                        {allCategories.filter(cat => cat !== "Non catégorisé").map(cat => {
                            const stat = stats.categoryStats[cat];
                            const isComplete = stat?.completed > 0 && stat?.completed === stat?.total;
                            const hasStarted = stat?.detected > 0;
                            const hasIncomplete = stat?.detected > stat?.completed;
                            const Icon = getCategoryIcon(cat);

                            return (
                                <button 
                                    key={cat}
                                    onClick={() => handleSelectCategory(cat)}
                                    className={`p-4 rounded-xl border-2 transition-all text-left flex flex-col gap-2 group ${hasStarted ? 'bg-white border-blue-100 hover:border-blue-400' : 'bg-slate-50 border-slate-200 hover:border-slate-300'}`}
                                >
                                    <div className={`p-2 w-fit rounded-lg group-hover:scale-110 transition-transform shadow-sm ${
                                        isComplete ? 'bg-green-500 text-white' : 
                                        hasIncomplete ? 'bg-orange-500 text-white' : 
                                        hasStarted ? 'bg-blue-500 text-white' : 
                                        'bg-slate-300 text-white'
                                    }`}>
                                        {hasIncomplete ? <AlertCircle size={24} /> : isComplete ? <CheckCircle2 size={24} /> : <Icon size={24} />}
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-900 truncate" title={cat}>{cat}</div>
                                        <div className={`text-xs font-medium ${
                                            isComplete ? 'text-green-600' : 
                                            hasIncomplete ? 'text-orange-600' : 
                                            hasStarted ? 'text-blue-600' : 
                                            'text-slate-400'
                                        }`}>
                                            {stat?.completed || 0} / {stat?.total || 0}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        )}

        {/* ITEMS LIST */}
        <section className="space-y-6">

            {activeCategory === 'ALL' && allMissingItems.length > 0 && (
                <div className="bg-white rounded-xl border border-dashed border-orange-200 shadow-sm overflow-hidden">
                    <div 
                        onClick={() => setIsMissingItemsCollapsed(!isMissingItemsCollapsed)}
                        className="p-4 flex items-center justify-between cursor-pointer hover:bg-orange-50/50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-50 rounded-lg text-orange-500">
                                <AlertCircle size={20} />
                            </div>
                            <div>
                                 <h3 className="font-bold text-slate-800">À inspecter ({allMissingItems.length})</h3>
                                 <p className="text-xs text-slate-500">Éléments du référentiel non encore détectés.</p>
                            </div>
                        </div>
                        <button className="text-slate-400">
                            {isMissingItemsCollapsed ? <ChevronDown size={20}/> : <ChevronUp size={20}/>}
                        </button>
                    </div>
                    
                    {!isMissingItemsCollapsed && (
                        <div className="px-5 pb-5 pt-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar border-t border-orange-100/50 mt-2">
                            {allMissingItems.map((item) => (
                                <button 
                                    key={`${item.category}-${item.subCategory}`}
                                    onClick={() => setManualModalConfig({ category: item.category, subCategory: item.subCategory })}
                                    className="group relative flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-white hover:border-blue-300 hover:shadow-md transition-all text-left"
                                >
                                    <div className="flex flex-col min-w-0 pr-8">
                                        <span className="text-sm font-bold text-slate-700 w-full truncate">{item.subCategory}</span>
                                        <span className="text-[10px] uppercase font-semibold text-slate-400 mt-0.5 w-full truncate group-hover:text-blue-500 transition-colors">{item.category}</span>
                                    </div>
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300 shadow-sm group-hover:border-blue-300 group-hover:text-blue-600 transition-all">
                                        <Plus size={16} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {allCategories.map(cat => {
                if (activeCategory !== 'ALL' && activeCategory !== cat) return null;
                const subCats = groupedItems[cat] || {};
                const catStat = stats.categoryStats[cat];

                const allSubCatsForThisCategory = Object.keys(schema[cat] || {});
                const existingSubCatsForThisCategory = Object.keys(subCats);
                const missingSubCats = allSubCatsForThisCategory.filter(sub => !existingSubCatsForThisCategory.includes(sub));
                
                const showMissingHere = activeCategory !== 'ALL' && missingSubCats.length > 0;
                
                return (
                    <div key={cat} className="space-y-4">
                        {activeCategory === 'ALL' && Object.keys(subCats).length > 0 && (
                            <div className={`flex items-center gap-3 border-l-4 pl-3 py-1 ${cat === "Non catégorisé" ? 'border-orange-400' : 'border-blue-400'}`}>
                                <h3 className={`text-lg font-bold ${cat === "Non catégorisé" ? 'text-orange-700' : 'text-slate-700'}`}>{cat}</h3>
                                {catStat && (
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catStat.completed === catStat.total ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                                        {catStat.completed} / {catStat.total} complétés
                                    </span>
                                )}
                            </div>
                        )}
                        
                        {showMissingHere && (
                            <div className="bg-white rounded-xl border border-dashed border-orange-200 shadow-sm overflow-hidden mb-6">
                                <div 
                                    onClick={() => setIsMissingItemsCollapsed(!isMissingItemsCollapsed)}
                                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-orange-50/50 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-orange-50 rounded-lg text-orange-500">
                                            <AlertCircle size={20} />
                                        </div>
                                        <div>
                                             <h3 className="font-bold text-slate-800">À inspecter ({missingSubCats.length})</h3>
                                             <p className="text-xs text-slate-500">Éléments du référentiel non encore détectés dans cette catégorie.</p>
                                        </div>
                                    </div>
                                    <button className="text-slate-400">
                                        {isMissingItemsCollapsed ? <ChevronDown size={20}/> : <ChevronUp size={20}/>}
                                    </button>
                                </div>

                                {!isMissingItemsCollapsed && (
                                    <div className="px-5 pb-5 pt-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 border-t border-orange-100/50 mt-2">
                                        {missingSubCats.map(missingSub => (
                                            <button 
                                                key={missingSub}
                                                onClick={() => setManualModalConfig({ category: cat, subCategory: missingSub })}
                                                className="group relative flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-white hover:border-blue-300 hover:shadow-md transition-all text-left"
                                            >
                                                <div className="flex flex-col min-w-0 pr-8">
                                                    <span className="text-sm font-bold text-slate-700 w-full truncate">{missingSub}</span>
                                                    <span className="text-[10px] uppercase font-semibold text-slate-400 mt-0.5 w-full truncate group-hover:text-blue-500 transition-colors">Ajouter manuellement</span>
                                                </div>
                                                <div className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300 shadow-sm group-hover:border-blue-300 group-hover:text-blue-600 transition-all">
                                                    <Plus size={16} />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {Object.entries(subCats).map(([sub, itemsList]: [string, InspectionItem[]]) => (
                            <div key={sub} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 p-3 flex justify-between items-center cursor-pointer" onClick={() => setCollapsedSections(p => ({ ...p, [sub]: !p[sub] }))}>
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-slate-800">{sub}</span>
                                        {/* Show check circle only if ALL items in this subcategory are complete */}
                                        {itemsList.every(i => getMissingAttributes(i, schema).length === 0) && (
                                            <CheckCircle2 size={16} className="text-green-500 fill-green-50" />
                                        )}
                                        {/* Show Warning if any item has missing attrs */}
                                        {itemsList.some(i => getMissingAttributes(i, schema).length > 0) && (
                                            <AlertTriangle size={16} className="text-orange-500 fill-orange-50" />
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {collapsedSections[sub] ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}
                                    </div>
                                </div>
                                {!collapsedSections[sub] && (
                                    <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                                        {itemsList.map(item => (
                                            <FieldCard 
                                                key={item.id} 
                                                field={item} 
                                                missingAttributes={getMissingAttributes(item, schema)}
                                                onEdit={() => setEditingItem(item)} 
                                                onViewGallery={() => setViewingItemId(item.id)} 
                                                onAddPhoto={(f) => handleAddPhotoToItem(item.id, f)}
                                                onMerge={() => setMergingItem(item)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                );
            })}
        </section>
      </main>

      {viewingItemId && items[viewingItemId] && <ImageViewer images={items[viewingItemId].photos} title={items[viewingItemId].subCategory} onClose={() => setViewingItemId(null)} onDelete={handleDeletePhoto} />}
      
      {viewingQueueItem && (
        <ImageViewer 
            images={[{ imageUrl: viewingQueueItem.imageBase64 || '', timestamp: viewingQueueItem.timestamp }]} 
            title="Analyse en cours" 
            onClose={() => setViewingQueueItem(null)} 
            onDelete={() => {
                setQueue(prev => prev.filter(i => i.id !== viewingQueueItem.id));
                setViewingQueueItem(null);
            }} 
        />
      )}

      {editingItem && (
          <EditFieldModal 
            item={editingItem} 
            schema={schema} 
            onSave={(updated) => handleUpdateItem(editingItem.id, updated)} 
            onDelete={handleDeleteItem} 
            onClose={() => setEditingItem(null)} 
            userCoins={userCoins} 
            onSpendCoins={handleSpendCoins}
          />
      )}
      {manualModalConfig && <AddManualFieldModal schema={schema} initialCategory={manualModalConfig.category} initialSubCategory={manualModalConfig.subCategory} onSave={handleManualSave} onClose={() => setManualModalConfig(null)} />}
      
      {mergingItem && (
          <MergeItemModal 
              sourceItem={mergingItem}
              items={items}
              schema={schema}
              onMerge={handleMergeItem}
              onRename={handleRenameItem}
              onClose={() => setMergingItem(null)}
          />
      )}
    </div>
  );
}