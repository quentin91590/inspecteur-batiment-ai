import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Pause, Play, Mic, MicOff, Flashlight, FlashlightOff, SunMedium, WifiOff, Loader2, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronRight, Sparkles, Sun, ZoomIn, ZoomOut, Focus, Hand, Clock, MapPin,
  Route, ArrowRight, Navigation, DoorOpen, SkipForward, ListChecks, MoreHorizontal, Camera, Images,
} from 'lucide-react';
import type { InspectionItem, InspectionResult, QueueItem, SchemaDefinition } from '../types';
import { AI_COSTS, sortCategories } from '../constants';
import {
  ALL_ZONES, ALL_ZONES_LABEL, NON_VISUAL_CATEGORIES, buildChecklist, inProgressTargets, missingLines, recordedLines,
} from '../utils/checklist';
import { PARCOURS_STAGES, stageText } from '../utils/visit';
import { protocolFor, type Protocol } from '../utils/protocols';
import { AiCallError, checkStepPhoto, guideFrame, modelLabel, type AiMeta, type GuideResult, type PhotoCheck } from '../services/aiService';
import { LOW_LIGHT_FILTER, grabJpeg, grayFrame, meanAbsDiff, meanLuma, smallGray } from '../services/videoFrames';
import {
  OrientationSource, TargetTracker, angleBetween, fieldOfView, project, unproject, videoToScreen,
  type ARState, type NormBox, type Vec3,
} from '../services/arTracker';
import type { VisibleElement } from '../services/aiTypes';
import { versionLabel } from '../services/appVersion';

// ------------------------------------------------------------------ réglages du guidage

const TICK_MS = 250;              // analyse locale de l'image (mouvement, luminosité)
const MIN_SEND_GAP_MS = 1800;     // sans élément en cours : au plus une image toutes les ~2 s
const STEP_SEND_GAP_MS = 1100;    // étape en photo automatique : dès que l'image est stable
const STEP_SEND_GAP_MANUAL_MS = 3000; // étape en photo manuelle : l'IA n'a qu'à aider au cadrage
const MAX_STEP_GAP_MANUAL_MS = 5000;
const MAX_SEND_GAP_MS = 4000;     // même sans changement, on rafraîchit la consigne
const MOTION_STABLE = 6;          // différence moyenne (0-255) sous laquelle l'image est jugée stable
const NOVELTY_MIN = 9;            // différence avec la dernière image envoyée pour la juger « nouvelle »
const CAPTURE_GAP_MS = 1500;      // délai minimum entre deux photos automatiques
const SAME_TARGET_GAP_MS = 30000; // pas deux photos du même élément en 30 s
const PENDING_CAPTURE_MS = 5000;  // la photo demandée attend au plus 5 s que l'image soit stable
const OFFLINE_CAPTURE_GAP_MS = 8000;
const OFFLINE_RETRY_MS = 10000;
const GUIDE_MAX_SIDE = 768;       // image envoyée pour le guidage
const HD_MAX_SIDE = 1280;         // photo analysée en détail
const DARK_LUMA = 38;
const TRACK_EVERY_MS = 120;       // recalage du cadre par l'image
const MAX_POINTS = 30;            // repères par pièce
const SAME_DIR_DEG = 12;          // même élément signalé sous un autre nom s'il est dans la même direction
const RECENT_BOX_MS = 2500;       // sans gyroscope, un repère n'est affiché que peu après avoir été vu
const SPEECH_HINT_MS = 9000;
const MAX_DIGITAL_ZOOM = 4;       // zoom numérique (recadrage) quand le téléphone ne pilote pas le zoom
const MAX_HW_ZOOM = 10;
const RETAKE_OFFER_MS = 25000;    // proposition de reprendre une photo refusée d'un élément déjà fini
const AUTO_CAPTURE_KEY = 'inspecteur.guided.autoCapture';
const LEAVING_MS = 45000;         // après « Pièce suivante », on ne ramène pas l'inspecteur dans la pièce quittée

export interface GuidedCapture {
  id: string;
  imageBase64: string;
  note: string;
  target: string;
}

interface Props {
  schema: SchemaDefinition;
  items: Record<string, InspectionItem>;
  queue: QueueItem[];
  /** Analyses détaillées terminées des photos de la visite, par identifiant de photo */
  captureResults: Record<string, CaptureAnalysis>;
  isOffline: boolean;
  demoMode: boolean;
  userCoins: number;
  onSpendCoins: (amount: number) => Promise<boolean>;
  /** Ajoute la photo HD à la file d'analyse ; false si refusée (crédits) */
  onCapture: (capture: GuidedCapture) => Promise<boolean>;
  /** Paroles non rattachées à une photo, analysées comme une note vocale */
  onLeftoverSpeech: (text: string) => void;
  onClose: () => void;
}

interface InstructionState {
  text: string;
  detail: string;
  target: string;
  quality: GuideResult['sceneQuality'];
  key: number;
}

interface SessionCapture {
  id: string;
  target: string;
  thumb: string;
  at: number;
  /** Repère (élément) et étape photographiés */
  pointId?: string;
  title?: string;
  stepLabel?: string;
}

/** Résultat de l'analyse détaillée d'une photo de la visite (transmis par l'écran principal) */
export interface CaptureAnalysis {
  results: InspectionResult[];
  /** Résultat correspondant au sujet principal de la photo */
  primary: number;
}

interface SpaceVisit {
  name: string;
  photos: number;
}

/** Élément en cours de relevé : séquence d'étapes verrouillée jusqu'à la fin */
interface ActiveElement {
  protocol: Protocol;
  title: string;
  category: string;
  element: string;
  stepIdx: number;
  photos: number;
  pointId?: string;
  /** Identifiant de ce passage (une reprise est un nouveau passage) */
  runId: string;
  /** Étapes réglées : photo prise, absente ou passée */
  resolved: number[];
  /** Comment chaque étape réglée l'a été */
  outcomes: Record<number, 'photo' | 'absent' | 'skip'>;
  /** Reprise d'une photo refusée sur un élément déjà fini */
  retake?: boolean;
}

type CheckStatus = 'checking' | 'ok' | 'refused';

/** Photo refusée alors que l'élément est déjà fini : proposition de la reprendre */
interface RetakeOffer {
  element: ActiveElement;
  stepIdx: number;
  check: PhotoCheck;
}

interface DoneElement {
  title: string;
  photos: number;
  space: string;
}

/** Élément repéré dans l'espace actuel, ancré par sa direction (gyroscope) */
interface SpacePoint {
  id: string;
  category: string;
  element: string;
  label: string;
  dir: Vec3 | null;
  box: NormBox | null;
  seenAt: number;
  createdAt: number;
  status: 'todo' | 'active' | 'done' | 'skipped';
  photos: number;
}

interface RoomState {
  points: SpacePoint[];
  doneHere: string[];
}

type CameraState = 'idle' | 'starting' | 'ready' | 'error';
type VisitMode = 'libre' | 'parcours';
type LightMode = 'off' | 'torch' | 'boost';

const QUALITY_ICON: Record<GuideResult['sceneQuality'], React.ElementType> = {
  ok: Sparkles,
  sombre: Sun,
  flou: Focus,
  loin: ZoomIn,
  proche: ZoomOut,
  hors_sujet: AlertTriangle,
};

const HINT_VECTOR: Record<string, [number, number]> = {
  gauche: [-1, 0],
  droite: [1, 0],
  haut: [0, -1],
  bas: [0, 1],
  derriere: [0, 1],
};

/** [ymin, xmin, ymax, xmax] (0-1000) → cadre normalisé (0-1) */
const boxFromArray = (b: number[]): NormBox => ({ cx: (b[1] + b[3]) / 2000, cy: (b[0] + b[2]) / 2000, w: (b[3] - b[1]) / 1000, h: (b[2] - b[0]) / 1000 });
/** Cadre lu sur une image recadrée (zoom numérique d) → cadre dans l'image vidéo complète. */
const uncrop = (b: NormBox, d: number): NormBox =>
  d <= 1.001 ? b : { cx: 0.5 + (b.cx - 0.5) / d, cy: 0.5 + (b.cy - 0.5) / d, w: b.w / d, h: b.h / d };
/** Nom du référentiel le plus proche (l'IA écrit parfois « Menuiseries » pour « Menuiserie », sans accent…). */
const resolveKey = (keys: string[], name: string): string | null => {
  if (!name) return null;
  const n = normText(name);
  return (
    keys.find(k => k === name) ??
    keys.find(k => normText(k) === n) ??
    keys.find(k => normText(k).startsWith(n) || n.startsWith(normText(k))) ??
    keys.find(k => normText(k).includes(n) || n.includes(normText(k))) ??
    null
  );
};

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Zoom de la caméra : matériel si le téléphone le permet (meilleure netteté), sinon numérique. */
interface ZoomState {
  hw: number;
  hwTarget?: number;
  hwCaps: { min: number; max: number } | null;
  digital: number;
  applying: boolean;
}

const normText = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const readAutoCapture = () => {
  try {
    return localStorage.getItem(AUTO_CAPTURE_KEY) === '1';
  } catch {
    return false;
  }
};

/** Prochaine étape non réglée après « from » (puis depuis le début), -1 s'il n'y en a plus. */
const nextUnresolved = (count: number, from: number, resolved: number[]) => {
  for (let i = from + 1; i < count; i++) if (!resolved.includes(i)) return i;
  for (let i = 0; i < from; i++) if (!resolved.includes(i)) return i;
  return -1;
};

const newId = () => `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const fmtSeconds = (ms?: number) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const sameText = (a?: string, b?: string) => !!a && !!b && normText(a) === normText(b);

export const GuidedVisit: React.FC<Props> = ({
  schema, items, queue, captureResults, isOffline, demoMode, userCoins, onSpendCoins, onCapture, onLeftoverSpeech, onClose,
}) => {
  // ---------------------------------------------------------------- état affiché
  const [phase, setPhase] = useState<'setup' | 'running' | 'summary'>('setup');
  const [showSetup, setShowSetup] = useState(false);
  const [mode, setMode] = useState<VisitMode>('libre');
  const [theme, setTheme] = useState<string>(ALL_ZONES);
  const [stageIdx, setStageIdx] = useState(0);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraError, setCameraError] = useState('');
  const [paused, setPaused] = useState(false);
  const [blockMsg, setBlockMsg] = useState('');
  const [toast, setToast] = useState('');
  const [instruction, setInstruction] = useState<InstructionState | null>(null);
  const [localHint, setLocalHint] = useState<'sombre' | null>(null);
  const [pendingCapture, setPendingCapture] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [captures, setCaptures] = useState<SessionCapture[]>([]);
  const [seenNow, setSeenNow] = useState<string[]>([]);
  const [interim, setInterim] = useState('');
  const [lastSpoken, setLastSpoken] = useState('');
  const [micOn, setMicOn] = useState(false);
  const [micMsg, setMicMsg] = useState('');
  const [light, setLight] = useState<LightMode>('off');
  const [lightBusy, setLightBusy] = useState(false);
  const [netMode, setNetMode] = useState<'online' | 'offline'>(isOffline ? 'offline' : 'online');
  const [waiting, setWaiting] = useState(false);
  const [lastMeta, setLastMeta] = useState<AiMeta | undefined>();
  const [stats, setStats] = useState({ frames: 0, latencyTotal: 0, startedAt: 0, endedAt: 0 });
  const [currentSpace, setCurrentSpace] = useState('');
  const [spaces, setSpaces] = useState<SpaceVisit[]>([]);
  const [spaceDone, setSpaceDone] = useState<string | null>(null);
  const [askingNext, setAskingNext] = useState(false);
  const [active, setActive] = useState<ActiveElement | null>(null);
  const [doneElements, setDoneElements] = useState<DoneElement[]>([]);
  const [roomPoints, setRoomPoints] = useState<SpacePoint[]>([]);
  const [roomListOpen, setRoomListOpen] = useState(false);
  const [speechHint, setSpeechHint] = useState(false);
  const [spokenSent, setSpokenSent] = useState(false);
  const [autoCapture, setAutoCapture] = useState(readAutoCapture);
  const [ready, setReadyState] = useState(false);
  const readyRef = useRef(false);
  const setReady = (v: boolean) => {
    readyRef.current = v;
    setReadyState(v);
  };
  const [checks, setChecks] = useState<Record<string, CheckStatus>>({});
  const [zoomShown, setZoomShown] = useState(1);
  const [refusedCaptures, setRefusedCaptures] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetPointId, setSheetPointId] = useState<string | null>(null);
  const [spokenVisible, setSpokenVisible] = useState(false);
  const spokenTimerRef = useRef<number | undefined>(undefined);
  const [retakeOffer, setRetakeOffer] = useState<RetakeOffer | null>(null);

  // ---------------------------------------------------------------- références (lues par les boucles)
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const micActiveRef = useRef(false);
  const micErrorsRef = useRef(0);
  const wakeLockRef = useRef<any>(null);
  const orientationRef = useRef(new OrientationSource());
  const trackerRef = useRef(new TargetTracker(orientationRef.current));
  const boxRef = useRef<HTMLDivElement>(null);
  const boxLabelRef = useRef<HTMLSpanElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const arrowIconRef = useRef<HTMLDivElement>(null);
  const arrowLabelRef = useRef<HTMLSpanElement>(null);

  const propsRef = useRef({ schema, items, queue, userCoins, isOffline });
  propsRef.current = { schema, items, queue, userCoins, isOffline };
  // Callbacks du parent lus via des refs : les boucles ne sont pas recréées à chaque rendu de l'écran principal
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;
  const onSpendCoinsRef = useRef(onSpendCoins);
  onSpendCoinsRef.current = onSpendCoins;
  const visitRef = useRef({ mode, theme, stageIdx, currentSpace, spaces });
  visitRef.current = { mode, theme, stageIdx, currentSpace, spaces };
  const pausedRef = useRef(paused);
  pausedRef.current = paused || showSetup || !!blockMsg;
  // (les fiches et listes ouvertes ne mettent pas la visite en pause : la caméra continue de repérer)
  const netModeRef = useRef(netMode);
  netModeRef.current = netMode;
  const instructionRef = useRef<InstructionState | null>(null);
  instructionRef.current = instruction;
  const lightRef = useRef(light);
  lightRef.current = light;
  const showSetupRef = useRef(showSetup);
  showSetupRef.current = showSetup;
  const autoCaptureRef = useRef(autoCapture);
  autoCaptureRef.current = autoCapture;
  const activeRef = useRef<ActiveElement | null>(active);
  activeRef.current = active;
  const doneHereRef = useRef<string[]>([]);
  const pointsRef = useRef<SpacePoint[]>([]);
  const pinsLayerRef = useRef<HTMLDivElement>(null);
  const pinElsRef = useRef(new Map<string, HTMLDivElement>());
  const onPinTapRef = useRef<(id: string) => void>(() => undefined);
  const chipsRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomZoneRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomState>({ hw: 1, hwCaps: null, digital: 1, applying: false });
  const roomsRef = useRef(new Map<string, RoomState>());

  const prevSmallRef = useRef<Uint8ClampedArray | null>(null);
  const lastSentSmallRef = useRef<Uint8ClampedArray | null>(null);
  const lastCaptureSmallRef = useRef<Uint8ClampedArray | null>(null);
  const stableTicksRef = useRef(0);
  const movingSinceRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const lastCaptureAtRef = useRef(0);
  const targetTimesRef = useRef(new Map<string, number>());
  const pendingCaptureRef = useRef<{ target: string; until: number } | null>(null);
  const failuresRef = useRef(0);
  const speechBufferRef = useRef('');       // envoyé avec la prochaine image
  const speechSinceCaptureRef = useRef(''); // rattaché à la prochaine photo HD
  const capturingRef = useRef(false);
  const capturesRef = useRef<SessionCapture[]>([]);
  capturesRef.current = captures;
  const requestNextRef = useRef(false);
  const spaceCandidateRef = useRef<{ name: string; count: number } | null>(null);
  // Éléments vus pendant qu'un changement de pièce n'est pas encore confirmé : rangés une fois la pièce connue
  const deferredRef = useRef<
    { elements: VisibleElement[]; pose: ReturnType<OrientationSource['pose']>; dims: { w: number; h: number }; zoom: { hw: number; d: number } }[]
  >([]);
  // « Pièce suivante » : en route vers une autre pièce
  const leavingRef = useRef<{ from: string; to: string; until: number } | null>(null);
  // Parcours guidé : espace où l'IA a commencé les relevés (avant, elle guide vers le point de départ)
  const startedSpaceRef = useRef<string | null>(null);

  // ---------------------------------------------------------------- thèmes et progression
  const themes = useMemo(() => sortCategories(Object.keys(schema)).filter(c => !NON_VISUAL_CATEGORIES.includes(c)), [schema]);
  const checklist = useMemo(() => buildChecklist(schema, items, theme, { visualOnly: true }), [schema, items, theme]);
  const themeLabel = theme === ALL_ZONES ? ALL_ZONES_LABEL : theme;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(t => (t === msg ? '' : t)), 2600);
  }, []);
  const setToastRef = useRef(showToast);
  setToastRef.current = showToast;

  // ---------------------------------------------------------------- caméra
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const attachStream = (stream: MediaStream) => {
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.style.transform = '';
      void video.play().catch(() => undefined);
    }
    // Nouveau flux : zoom remis à 1× ; zoom matériel s'il est proposé par la caméra
    const track = stream.getVideoTracks()[0];
    const caps: any = track?.getCapabilities?.() ?? {};
    const settings: any = track?.getSettings?.() ?? {};
    const hasHw = caps.zoom && typeof caps.zoom.max === 'number' && caps.zoom.max > Math.max(1, caps.zoom.min ?? 1) + 0.05;
    zoomRef.current = {
      hw: typeof settings.zoom === 'number' ? settings.zoom : 1,
      hwCaps: hasHw ? { min: Math.max(1, caps.zoom.min ?? 1), max: Math.min(MAX_HW_ZOOM, caps.zoom.max) } : null,
      digital: 1,
      applying: false,
    };
    setZoomShown(zoomRef.current.hw);
  };

  /** Contraintes de la caméra en gardant le zoom et la lampe en cours (une contrainte remplace les précédentes). */
  const withCurrent = (c: Record<string, unknown>): Record<string, unknown> => {
    const zr = zoomRef.current;
    return {
      ...(zr.hwCaps ? { zoom: zr.hwTarget ?? zr.hw } : {}),
      ...(lightRef.current === 'torch' ? { torch: true } : {}),
      ...c,
    };
  };

  /** Zoom demandé (pincement ou pastille) : facteur 1 à max. */
  const setZoom = useCallback((zoom: number) => {
    const z = zoom < 1.05 ? 1 : zoom; // presque 1× : on revient exactement à 1×
    const zr = zoomRef.current;
    if (zr.hwCaps) {
      const value = Math.round(clampNum(z, zr.hwCaps.min, zr.hwCaps.max) * 100) / 100;
      zr.hwTarget = value;
      setZoomShown(value);
      if (zr.applying) return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      zr.applying = true;
      void (async () => {
        try {
          // On suit le doigt : on applique la dernière valeur demandée tant qu'elle change
          while (zr.hwTarget !== undefined && Math.abs(zr.hwTarget - zr.hw) > 0.01) {
            const target = zr.hwTarget;
            await track.applyConstraints({
              advanced: [{ zoom: target, ...(lightRef.current === 'torch' ? { torch: true } : {}) } as any],
            });
            const actual = (track.getSettings?.() as any)?.zoom;
            zr.hw = typeof actual === 'number' ? actual : target;
          }
        } catch {
          // Zoom refusé par la caméra : on passe au zoom numérique
          zr.hwCaps = null;
          zr.hw = 1;
        } finally {
          zr.applying = false;
        }
      })();
      return;
    }
    const d = clampNum(z, 1, MAX_DIGITAL_ZOOM);
    zr.digital = d;
    const video = videoRef.current;
    if (video) video.style.transform = d > 1.001 ? `scale(${d})` : '';
    setZoomShown(d);
  }, []);
  const setZoomRef = useRef(setZoom);
  setZoomRef.current = setZoom;
  const currentZoom = () => {
    const zr = zoomRef.current;
    return zr.hwCaps ? zr.hwTarget ?? zr.hw : zr.digital;
  };

  const startCamera = useCallback(async () => {
    setCameraState('starting');
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      attachStream(stream);
      setCameraState('ready');
    } catch (err: any) {
      setCameraState('error');
      setCameraError(
        err?.name === 'NotAllowedError'
          ? 'Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur.'
          : err?.name === 'NotFoundError' || err?.name === 'NotSupportedError'
            ? 'Aucune caméra disponible sur cet appareil.'
            : `Impossible d'ouvrir la caméra (${err?.message ?? err}).`,
      );
    }
  }, []);

  // ---------------------------------------------------------------- lampe
  const setTorch = async (track: MediaStreamTrack, on: boolean): Promise<boolean> => {
    try {
      await track.applyConstraints({ advanced: [withCurrent({ torch: on }) as any] });
      const settings: any = track.getSettings?.() ?? {};
      const caps: any = track.getCapabilities?.() ?? {};
      if (settings.torch !== undefined) return settings.torch === on;
      return !!caps.torch; // certains navigateurs ne renvoient pas l'état : on se fie aux capacités
    } catch {
      return false;
    }
  };

  /** Android à plusieurs caméras : la caméra choisie n'a pas toujours la lampe ; on cherche celle qui l'a. */
  const switchToTorchCamera = async (): Promise<boolean> => {
    const current = streamRef.current?.getVideoTracks()[0];
    const currentId = current?.getSettings?.().deviceId;
    const devices = (await navigator.mediaDevices.enumerateDevices?.().catch(() => [])) ?? [];
    const candidates = devices
      .filter(d => d.kind === 'videoinput' && d.deviceId && d.deviceId !== currentId)
      .filter(d => !d.label || /back|rear|arri|environment|0/i.test(d.label))
      .slice(0, 4);
    for (const d of candidates) {
      let test: MediaStream | null = null;
      try {
        test = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: d.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        const t = test.getVideoTracks()[0];
        const caps: any = t.getCapabilities?.() ?? {};
        if (caps.torch && (await setTorch(t, true))) {
          const old = streamRef.current;
          attachStream(test);
          old?.getTracks().forEach(tr => tr.stop());
          return true;
        }
      } catch {
        /* caméra occupée ou refusée : suivante */
      }
      test?.getTracks().forEach(tr => tr.stop());
    }
    return false;
  };

  const setExposureBoost = async (track: MediaStreamTrack, on: boolean) => {
    const caps: any = track.getCapabilities?.() ?? {};
    if (!caps.exposureCompensation) return;
    try {
      await track.applyConstraints({ advanced: [withCurrent({ exposureCompensation: on ? caps.exposureCompensation.max : 0 }) as any] });
    } catch {
      /* non pris en charge */
    }
  };

  const toggleLight = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || lightBusy) return;
    setLightBusy(true);
    try {
      if (light === 'torch') {
        await setTorch(track, false);
        setLight('off');
      } else if (light === 'boost') {
        await setExposureBoost(track, false);
        setLight('off');
      } else if (await setTorch(track, true)) {
        setLight('torch');
      } else if (await switchToTorchCamera()) {
        setLight('torch');
        showToast('Lampe allumée');
      } else {
        await setTorch(track, false);
        await setExposureBoost(track, true);
        setLight('boost');
        showToast('Lampe non pilotable par ce navigateur : image éclaircie');
      }
    } finally {
      setLightBusy(false);
    }
  };

  // ---------------------------------------------------------------- micro (dictée continue)
  const speechSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const isFirefox = typeof navigator !== 'undefined' && /firefox|fxios/i.test(navigator.userAgent);

  const stopSpeech = useCallback(() => {
    micActiveRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* déjà arrêtée */
    }
    recognitionRef.current = null;
    setInterim('');
  }, []);

  const startSpeech = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: any) => {
      micErrorsRef.current = 0;
      let partial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = String(r[0]?.transcript ?? '').trim();
        if (!t) continue;
        if (r.isFinal) {
          speechBufferRef.current = `${speechBufferRef.current} ${t}`.trim();
          speechSinceCaptureRef.current = `${speechSinceCaptureRef.current} ${t}`.trim();
          setLastSpoken(t);
          setSpokenSent(false);
          // Ce qui vient d'être dit s'affiche quelques secondes, puis s'efface
          setSpokenVisible(true);
          window.clearTimeout(spokenTimerRef.current);
          spokenTimerRef.current = window.setTimeout(() => setSpokenVisible(false), 4500);
        } else {
          partial += `${t} `;
        }
      }
      setInterim(partial.trim());
    };
    rec.onerror = (ev: any) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        micActiveRef.current = false;
        setMicOn(false);
        setMicMsg('Micro refusé : la visite continue sans dictée.');
      } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        micErrorsRef.current++;
        if (micErrorsRef.current >= 3) {
          micActiveRef.current = false;
          setMicOn(false);
          setMicMsg('Dictée indisponible pour le moment.');
        }
      }
    };
    rec.onend = () => {
      if (!micActiveRef.current) return;
      const delay = micErrorsRef.current ? 2500 : 250;
      window.setTimeout(() => {
        if (!micActiveRef.current) return;
        try {
          rec.start();
        } catch {
          /* redémarrage déjà en cours */
        }
      }, delay);
    };
    recognitionRef.current = rec;
    micActiveRef.current = true;
    try {
      rec.start();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!micMsg) return;
    const t = window.setTimeout(() => setMicMsg(''), 8000);
    return () => window.clearTimeout(t);
  }, [micMsg]);

  useEffect(() => {
    if (phase === 'running' && cameraState === 'ready' && micOn && !paused) startSpeech();
    else stopSpeech();
    return stopSpeech;
  }, [phase, cameraState, micOn, paused, startSpeech, stopSpeech]);

  // ---------------------------------------------------------------- écran allumé, capteurs, nettoyage
  useEffect(() => {
    if (phase !== 'running') return;
    (navigator as any).wakeLock?.request?.('screen').then((l: any) => (wakeLockRef.current = l)).catch(() => undefined);
    return () => {
      wakeLockRef.current?.release?.().catch?.(() => undefined);
      wakeLockRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    const orientation = orientationRef.current;
    return () => {
      stopCamera();
      stopSpeech();
      orientation.stop();
    };
  }, [stopCamera, stopSpeech]);

  useEffect(() => {
    if (isOffline) setNetMode('offline');
  }, [isOffline]);

  // Retour dans l'appli (sélecteur d'applis, écran verrouillé) : le navigateur a pu couper la caméra.
  // On vérifie que l'image avance encore ; sinon on rouvre la caméra toute seule.
  const restartingRef = useRef(false);
  useEffect(() => {
    if (phase !== 'running') return;
    let lastTime = -1;
    let frozenChecks = 0;
    let sawProgress = false; // on ne juge « figée » qu'une image qu'on a déjà vue avancer
    const restart = async () => {
      if (restartingRef.current) return;
      restartingRef.current = true;
      sawProgress = false;
      lastTime = -1;
      try {
        stopCamera();
        if (lightRef.current === 'torch') setLight('off'); // la lampe s'éteint avec l'ancienne caméra
        await startCamera();
      } finally {
        restartingRef.current = false;
      }
    };
    const check = () => {
      if (document.hidden || restartingRef.current) return;
      const video = videoRef.current;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!video || !streamRef.current) return;
      if (!track || track.readyState === 'ended') {
        void restart();
        return;
      }
      if (video.paused) void video.play().catch(() => undefined);
      // Image figée (piste coupée sans être terminée) : deux contrôles de suite → on relance
      if (lastTime >= 0 && video.currentTime > lastTime) sawProgress = true;
      if (sawProgress && video.currentTime === lastTime) frozenChecks++;
      else frozenChecks = 0;
      lastTime = video.currentTime;
      if (frozenChecks >= 2) {
        frozenChecks = 0;
        void restart();
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      lastTime = -1;
      frozenChecks = 0;
      window.setTimeout(check, 600);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    const id = window.setInterval(check, 1500);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.clearInterval(id);
    };
  }, [phase, startCamera, stopCamera]);

  // Pincer l'image = zoomer la caméra. Le zoom de la page est bloqué pendant la visite.
  useEffect(() => {
    if (phase !== 'running') return;
    const el = containerRef.current;
    if (!el) return;
    const meta = document.querySelector('meta[name="viewport"]');
    const previous = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');

    let pinch: { dist: number; zoom: number } | null = null;
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinch = { dist: spread(e.touches), zoom: currentZoom() };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      e.preventDefault();
      if (!pinch) pinch = { dist: spread(e.touches), zoom: currentZoom() };
      setZoomRef.current((pinch.zoom * spread(e.touches)) / pinch.dist);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const block = (e: Event) => e.preventDefault(); // Safari : gestes de zoom de la page
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('gesturestart', block as EventListener, { passive: false } as AddEventListenerOptions);
    el.addEventListener('gesturechange', block as EventListener, { passive: false } as AddEventListenerOptions);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', block as EventListener);
      el.removeEventListener('gesturechange', block as EventListener);
      if (meta && previous !== null) meta.setAttribute('content', previous);
    };
  }, [phase]);

  // Branche le flux caméra sur la vidéo dès qu'elle est affichée
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
  }, [phase, cameraState]);

  // ---------------------------------------------------------------- espaces parcourus
  /** Mémorise les repères de la pièce actuelle (pour y revenir et pour le bilan). */
  const saveRoom = useCallback(() => {
    const name = visitRef.current.currentSpace;
    if (name) roomsRef.current.set(normText(name), { points: pointsRef.current, doneHere: doneHereRef.current });
  }, []);

  /** Nouvelle pièce : ses repères repartent de zéro (ou de ceux mémorisés si on y revient). */
  const enterSpace = useCallback((name: string) => {
    const prevName = visitRef.current.currentSpace;
    const prev = pointsRef.current;
    if (!prevName) {
      // Pièce identifiée pour la première fois : les repères déjà posés sont les siens
      roomsRef.current.set(normText(name), { points: prev, doneHere: doneHereRef.current });
    } else {
      const staying = prev;
      // L'élément en cours appartient à la pièce quittée : il reste à faire là-bas
      const a = activeRef.current;
      if (a && staying.some(pt => pt.id === a.pointId)) {
        staying.forEach(pt => {
          if (pt.id === a.pointId) pt.status = 'todo';
        });
        activeRef.current = null;
        setActive(null);
        trackerRef.current.clear();
        pendingCaptureRef.current = null;
        setPendingCapture(false);
        setInstruction(null);
      }
      roomsRef.current.set(normText(prevName), { points: staying, doneHere: doneHereRef.current });
      const saved = roomsRef.current.get(normText(name));
      pointsRef.current = saved?.points ?? [];
      doneHereRef.current = saved?.doneHere ?? [];
      leavingRef.current = null;
    }
    visitRef.current = { ...visitRef.current, currentSpace: name };
    setRoomPoints([...pointsRef.current]);
    setCurrentSpace(name);
    setSpaces(prev => (prev.length && sameText(prev[prev.length - 1].name, name) ? prev : [...prev, { name, photos: 0 }]));
    setSpaceDone(null);
  }, []);

  /** L'IA nomme l'espace à chaque image ; on ne change d'espace qu'après deux réponses concordantes (évite les sauts). */
  const onSpaceSeen = useCallback((name: string) => {
    const current = visitRef.current.currentSpace;
    if (!name) return;
    if (!current) {
      enterSpace(name);
      return;
    }
    if (sameText(name, current)) {
      spaceCandidateRef.current = null;
      return;
    }
    const cand = spaceCandidateRef.current;
    if (cand && sameText(cand.name, name)) {
      cand.count++;
      if (cand.count >= 2) {
        spaceCandidateRef.current = null;
        enterSpace(name);
      }
    } else {
      spaceCandidateRef.current = { name, count: 1 };
    }
  }, [enterSpace]);

  // ---------------------------------------------------------------- séquence par élément
  const stepTarget = (a: ActiveElement) => `${a.title} — ${a.protocol.steps[a.stepIdx].label}`;

  const setActiveNow = (a: ActiveElement | null) => {
    activeRef.current = a;
    setActive(a);
  };

  // ---------------------------------------------------------------- repères : éléments repérés dans la pièce
  const syncPoints = useCallback(() => setRoomPoints([...pointsRef.current]), []);

  /** Repère de la pièce actuelle ou d'une pièce déjà parcourue. */
  const findPoint = (id?: string): SpacePoint | undefined => {
    if (!id) return undefined;
    const here = pointsRef.current.find(pt => pt.id === id);
    if (here) return here;
    for (const room of roomsRef.current.values()) {
      const found = room.points.find(pt => pt.id === id);
      if (found) return found;
    }
    return undefined;
  };

  const addPoint = (pt: Pick<SpacePoint, 'category' | 'element' | 'label' | 'dir' | 'box'>): SpacePoint => {
    const now = Date.now();
    const point: SpacePoint = { ...pt, id: newId(), seenAt: now, createdAt: now, status: 'todo', photos: 0 };
    pointsRef.current = [...pointsRef.current, point];
    return point;
  };

  /**
   * Éléments signalés par l'IA sur l'image envoyée : chacun devient un repère, ancré par sa direction
   * (orientation du téléphone au moment de l'image). Un élément déjà repéré (même libellé) est simplement mis à jour.
   */
  const ingestElements = (
    elements: VisibleElement[], pose: ReturnType<OrientationSource['pose']>, vdims: { w: number; h: number }, zoom = { hw: 1, d: 1 },
  ) => {
    if (!elements.length) return;
    const { schema: sch } = propsRef.current;
    const th = visitRef.current.theme;
    const fov = fieldOfView(vdims.w || 16, vdims.h || 9, zoom.hw);
    const now = Date.now();
    let changed = false;
    for (const e of elements) {
      const category = resolveKey(Object.keys(sch), e.category);
      if (!category || NON_VISUAL_CATEGORIES.includes(category)) continue;
      if (th !== ALL_ZONES && category !== th) continue;
      if (e.box.length !== 4) continue;
      const element = resolveKey(Object.keys(sch[category]), e.element) ?? e.element;
      // Jamais le nom de la catégorie comme libellé (« Substance & Surface ») : on prend l'élément
      const label = e.label && !sameText(e.label, category) ? e.label : element;
      if (!label) continue;
      const box = uncrop(boxFromArray(e.box), zoom.d);
      const dir = pose ? unproject(box.cx, box.cy, pose, fov) : null;
      const pts = pointsRef.current;
      let pt = pts.find(q => q.category === category && sameText(q.label, label));
      if (!pt && dir) pt = pts.find(q => q.category === category && q.element === element && !!q.dir && angleBetween(q.dir, dir) < SAME_DIR_DEG);
      if (pt) {
        if (dir && (!pt.dir || pt.status === 'todo')) pt.dir = dir;
        pt.box = box;
        pt.seenAt = now;
        continue;
      }
      if (pts.length >= MAX_POINTS) continue;
      addPoint({ category, element, label, dir, box });
      changed = true;
    }
    if (changed) syncPoints();
  };

  /** Prochain élément : le repère « à faire » le plus proche de là où vise le téléphone. */
  const pickNextPoint = useCallback((): SpacePoint | null => {
    const todo = pointsRef.current.filter(pt => pt.status === 'todo');
    if (!todo.length) return null;
    const pose = orientationRef.current.pose();
    const withDir = pose ? todo.filter(pt => pt.dir) : [];
    if (pose && withDir.length) {
      return withDir.reduce((best, pt) => (angleBetween(pt.dir!, pose.forward) < angleBetween(best.dir!, pose.forward) ? pt : best));
    }
    return todo.reduce((best, pt) => (pt.seenAt > best.seenAt ? pt : best)); // sans gyroscope : le dernier vu
  }, []);

  const startPoint = useCallback((pt: SpacePoint) => {
    const protocol = protocolFor(pt.category, pt.element);
    pt.status = 'active';
    const a: ActiveElement = {
      protocol, title: pt.label || protocol.title, category: pt.category, element: pt.element, stepIdx: 0, photos: 0, pointId: pt.id,
      runId: newId(), resolved: [], outcomes: {},
    };
    setActiveNow(a);
    pendingCaptureRef.current = null;
    setPendingCapture(false);
    setReady(false);
    const recent = Date.now() - pt.seenAt < RECENT_BOX_MS;
    trackerRef.current.setKnown(stepTarget(a), pt.dir, pt.dir || recent ? pt.box : null);
    lastSentAtRef.current = 0;
    setInstruction({
      text: protocol.steps[0].instruction,
      detail: '',
      target: stepTarget(a),
      quality: 'ok',
      key: Date.now(),
    });
    syncPoints();
  }, [syncPoints]);

  /** Remet l'élément en cours dans la liste (« à faire » ou « passé »). */
  const releaseActive = (status: 'todo' | 'skipped' = 'todo') => {
    const a = activeRef.current;
    const pt = findPoint(a?.pointId);
    if (pt && pt.status === 'active') pt.status = status;
    setActiveNow(null);
    trackerRef.current.clear();
    pendingCaptureRef.current = null;
    setPendingCapture(false);
    syncPoints();
  };

  const finishElement = useCallback((a: ActiveElement, photos: number, status: 'done' | 'skipped' = 'done') => {
    const final = a.retake ? 'done' : status === 'done' && photos === 0 ? 'skipped' : status;
    const pt = findPoint(a.pointId);
    if (pt) {
      pt.status = final;
      pt.photos += photos;
    }
    if (!doneHereRef.current.some(t => sameText(t, a.title))) doneHereRef.current = [...doneHereRef.current, a.title];
    if (a.retake) {
      setDoneElements(prev => prev.map(d => (d.title === a.title ? { ...d, photos: d.photos + photos } : d)));
    } else if (final === 'done') {
      setDoneElements(prev => [...prev, { title: a.title, photos, space: visitRef.current.currentSpace }]);
    }
    setActiveNow(null);
    trackerRef.current.clear();
    pendingCaptureRef.current = null;
    setPendingCapture(false);
    setReady(false);
    lastSentAtRef.current = 0;
    const msg = a.retake
      ? `${a.title} : photo reprise ✓`
      : final === 'done'
        ? `${a.title} ✓ (${photos} photo${photos > 1 ? 's' : ''})`
        : `${a.title} : passé`;
    // On enchaîne sur le repère le plus proche
    const next = pickNextPoint();
    if (next) {
      startPoint(next);
      setToastRef.current(`${msg} · ensuite : ${next.label}`);
    } else {
      setInstruction(null);
      syncPoints();
      setToastRef.current(msg);
    }
  }, [pickNextPoint, startPoint, syncPoints]);

  /** Passe à l'étape suivante (photo prise, étape absente ou passée par l'inspecteur). */
  const advanceStep = useCallback((reason: 'photo' | 'absent' | 'skip') => {
    const a = activeRef.current;
    if (!a) return;
    pendingCaptureRef.current = null;
    setPendingCapture(false);
    setReady(false);
    const photos = a.photos + (reason === 'photo' ? 1 : 0);
    const resolved = a.resolved.includes(a.stepIdx) ? a.resolved : [...a.resolved, a.stepIdx];
    const next = nextUnresolved(a.protocol.steps.length, a.stepIdx, resolved);
    if (next < 0) {
      finishElement({ ...a, resolved, outcomes: { ...a.outcomes, [a.stepIdx]: reason } }, photos);
      return;
    }
    const na: ActiveElement = { ...a, stepIdx: next, photos, resolved, outcomes: { ...a.outcomes, [a.stepIdx]: reason } };
    setActiveNow(na);
    // Le repère reste sur l'élément ; l'IA le recale sur le sujet de la nouvelle étape
    const pt = findPoint(a.pointId);
    trackerRef.current.setKnown(stepTarget(na), pt?.dir ?? null, pt && (pt.dir || Date.now() - pt.seenAt < RECENT_BOX_MS) ? pt.box : null);
    lastSentAtRef.current = 0; // la nouvelle étape part tout de suite
    const prevLabel = a.protocol.steps[a.stepIdx].label;
    setInstruction({
      text: na.protocol.steps[next].instruction,
      detail: reason === 'absent' ? `${prevLabel} : absent ici, étape passée` : reason === 'photo' ? `${prevLabel} ✓` : '',
      target: stepTarget(na),
      quality: 'ok',
      key: Date.now(),
    });
  }, [finishElement]);

  /** Retour sur une étape dont la photo a été refusée, dans l'élément en cours ou dans un élément déjà fini (reprise). */
  const goToStep = (a: ActiveElement, stepIdx: number, check: PhotoCheck) => {
    const outcomes = { ...a.outcomes };
    delete outcomes[stepIdx];
    const na: ActiveElement = { ...a, stepIdx, resolved: a.resolved.filter(i => i !== stepIdx), outcomes };
    setActiveNow(na);
    pendingCaptureRef.current = null;
    setPendingCapture(false);
    setReady(false);
    const pt = findPoint(a.pointId);
    if (pt) pt.status = 'active';
    trackerRef.current.setKnown(stepTarget(na), pt?.dir ?? null, pt && (pt.dir || Date.now() - pt.seenAt < RECENT_BOX_MS) ? pt.box : null);
    lastSentAtRef.current = 0;
    setChecks(c => ({ ...c, [`${na.runId}:${stepIdx}`]: 'refused' }));
    const advice = check.advice || `Reprenez : ${na.protocol.steps[stepIdx].label.toLowerCase()}`;
    setInstruction({
      text: check.problem ? `${check.problem.charAt(0).toUpperCase()}${check.problem.slice(1)} : ${advice.charAt(0).toLowerCase()}${advice.slice(1)}` : advice,
      detail: 'Photo refusée',
      target: stepTarget(na),
      quality: 'ok',
      key: Date.now(),
    });
    syncPoints();
  };

  const onCheckFailed = (a: ActiveElement, stepIdx: number, check: PhotoCheck) => {
    try {
      navigator.vibrate?.([70, 90, 70]);
    } catch {
      /* pas de vibreur */
    }
    const current = activeRef.current;
    if (current && current.runId === a.runId) {
      // Toujours sur cet élément : on revient tout de suite sur l'étape refusée (la photo refusée ne compte pas)
      goToStep({ ...current, photos: Math.max(0, current.photos - 1) }, stepIdx, check);
      return;
    }
    // Élément déjà fini : on propose de reprendre, sans interrompre l'élément en cours
    const offer: RetakeOffer = { element: a, stepIdx, check };
    setRetakeOffer(offer);
    window.setTimeout(() => setRetakeOffer(o => (o === offer ? null : o)), RETAKE_OFFER_MS);
  };
  const onCheckFailedRef = useRef(onCheckFailed);
  onCheckFailedRef.current = onCheckFailed;

  const acceptRetake = () => {
    const offer = retakeOffer;
    if (!offer) return;
    setRetakeOffer(null);
    leavingRef.current = null;
    releaseActive('todo');
    const steps = offer.element.protocol.steps.map((_, i) => i);
    const a: ActiveElement = {
      ...offer.element, runId: newId(), photos: 0, retake: true, stepIdx: offer.stepIdx, resolved: steps.filter(i => i !== offer.stepIdx),
    };
    goToStep(a, offer.stepIdx, offer.check);
  };

  /** Contrôle rapide de la photo d'étape prise à la main ; l'inspecteur continue pendant ce temps. */
  const verifyStepPhoto = useCallback((image: string, a: ActiveElement, stepIdx: number, captureId: string) => {
    if (netModeRef.current === 'offline' || propsRef.current.isOffline) return;
    const step = a.protocol.steps[stepIdx];
    const key = `${a.runId}:${stepIdx}`;
    setChecks(c => ({ ...c, [key]: 'checking' }));
    checkStepPhoto(image, { element: a.title, step: step.label, aim: step.aim, optional: step.optional })
      .then(({ check }) => {
        setChecks(c => ({ ...c, [key]: check.ok ? 'ok' : 'refused' }));
        if (!check.ok) {
          setRefusedCaptures(r => [...r, captureId]);
          onCheckFailedRef.current(a, stepIdx, check);
        }
      })
      .catch(() => {
        // Contrôle impossible (réseau…) : la photo est gardée, on ne bloque pas
        setChecks(c => ({ ...c, [key]: 'ok' }));
      });
  }, []);

  /** « Autre élément » : celui-ci passe en gris (on pourra y revenir), on va au repère le plus proche. */
  const abandonElement = () => {
    const a = activeRef.current;
    if (!a) return;
    finishElement(a, a.photos, 'skipped');
  };

  /** Choix d'un repère (toucher le repère ou la liste de la pièce). */
  const choosePoint = (id: string, allowDone: boolean) => {
    const pt = pointsRef.current.find(q => q.id === id);
    if (!pt || pt.status === 'active') return;
    if (pt.status === 'done' && !allowDone) {
      setSheetPointId(pt.id);
      return;
    }
    leavingRef.current = null;
    releaseActive('todo');
    startPoint(pt);
    setRoomListOpen(false);
    setSheetPointId(null);
  };
  onPinTapRef.current = id => choosePoint(id, false);

  /** L'inspecteur choisit lui-même l'étape (puce de la liste des photos à prendre). */
  const jumpToStep = (idx: number) => {
    const a = activeRef.current;
    if (!a || idx === a.stepIdx) return;
    const outcomes = { ...a.outcomes };
    delete outcomes[idx];
    const na: ActiveElement = { ...a, stepIdx: idx, resolved: a.resolved.filter(i => i !== idx), outcomes };
    setActiveNow(na);
    pendingCaptureRef.current = null;
    setPendingCapture(false);
    setReady(false);
    const pt = findPoint(a.pointId);
    trackerRef.current.setKnown(stepTarget(na), pt?.dir ?? null, pt && (pt.dir || Date.now() - pt.seenAt < RECENT_BOX_MS) ? pt.box : null);
    lastSentAtRef.current = 0;
    setInstruction({ text: na.protocol.steps[idx].instruction, detail: '', target: stepTarget(na), quality: 'ok', key: Date.now() });
  };

  // ---------------------------------------------------------------- photo haute définition
  const doCapture = useCallback(async (requested: string, origin: 'ai' | 'manuel' | 'auto') => {
    const video = videoRef.current;
    if (!video || capturingRef.current) return;
    // Pendant une séquence, la photo documente l'étape en cours (et la fait avancer)
    const stepAtCapture = origin !== 'auto' ? activeRef.current : null;
    const step = stepAtCapture ? stepAtCapture.protocol.steps[stepAtCapture.stepIdx] : null;
    const target = stepAtCapture && step ? `${stepTarget(stepAtCapture)} (${step.aim})` : requested;
    if (propsRef.current.userCoins < AI_COSTS.IMAGE_ANALYSIS) {
      setBlockMsg(`Crédits insuffisants pour analyser une photo (${AI_COSTS.IMAGE_ANALYSIS} crédits).`);
      return;
    }
    const filter = lightRef.current === 'boost' ? LOW_LIGHT_FILTER : undefined;
    const crop = zoomRef.current.digital;
    const hd = grabJpeg(video, HD_MAX_SIDE, 0.82, filter, crop);
    const thumb = grabJpeg(video, 200, 0.6, filter, crop);
    // Image plus légère pour le contrôle rapide de la photo (prise au même instant)
    const checkImg = origin === 'manuel' && stepAtCapture ? grabJpeg(video, 1024, 0.78, filter, crop) : null;
    if (!hd || !thumb) return;
    capturingRef.current = true;
    const id = newId();
    const note = speechSinceCaptureRef.current.trim();
    speechSinceCaptureRef.current = '';
    try {
      const ok = await onCaptureRef.current({ id, imageBase64: hd, note, target });
      if (!ok) {
        speechSinceCaptureRef.current = `${note} ${speechSinceCaptureRef.current}`.trim();
        return;
      }
      const now = Date.now();
      lastCaptureAtRef.current = now;
      lastCaptureSmallRef.current = smallGray(video);
      if (target) targetTimesRef.current.set(target, now);
      setCaptures(prev => [
        ...prev,
        {
          id, target, thumb, at: now,
          pointId: stepAtCapture?.pointId, title: stepAtCapture?.title, stepLabel: step?.label,
        },
      ]);
      setSpaces(prev => (prev.length ? [...prev.slice(0, -1), { ...prev[prev.length - 1], photos: prev[prev.length - 1].photos + 1 }] : prev));
      if (target && sameText(target, trackerRef.current.currentLabel)) trackerRef.current.clear();
      setFlashKey(k => k + 1);
      try {
        navigator.vibrate?.(60);
      } catch {
        /* pas de vibreur */
      }
      if (stepAtCapture && activeRef.current && activeRef.current.runId === stepAtCapture.runId && activeRef.current.stepIdx === stepAtCapture.stepIdx) {
        if (origin === 'manuel') verifyStepPhoto(checkImg ?? hd, stepAtCapture, stepAtCapture.stepIdx, id);
        advanceStep('photo');
      } else {
        showToast(origin === 'auto' ? 'Photo enregistrée (hors réseau)' : `Photo prise${requested ? ` : ${requested}` : ''}`);
      }
    } finally {
      capturingRef.current = false;
    }
  }, [showToast, advanceStep, verifyStepPhoto]);

  const requestCapture = useCallback((target: string, fromStep = false) => {
    const now = Date.now();
    if (now - lastCaptureAtRef.current < CAPTURE_GAP_MS) return;
    const last = target && !fromStep ? targetTimesRef.current.get(target) : undefined;
    if (last && now - last < SAME_TARGET_GAP_MS) return;
    pendingCaptureRef.current = { target, until: now + PENDING_CAPTURE_MS };
    setPendingCapture(true);
  }, []);

  // ---------------------------------------------------------------- envoi d'une image au guidage
  const sendFrame = useCallback(async (small: Uint8ClampedArray | null) => {
    const video = videoRef.current;
    if (!video) return;
    const zoomAtSend = { hw: zoomRef.current.hw, d: zoomRef.current.digital };
    const stableAtSend = stableTicksRef.current >= 2;
    const image = grabJpeg(video, GUIDE_MAX_SIDE, 0.6, lightRef.current === 'boost' ? LOW_LIGHT_FILTER : undefined, zoomAtSend.d);
    if (!image) return;

    // État du téléphone au moment de l'image : sert à placer le cadre quand la réponse arrivera
    const poseAtSend = orientationRef.current.pose();
    const grayAtSend = grayFrame(video);
    const videoDims = { w: video.videoWidth, h: video.videoHeight };

    inFlightRef.current = true;
    lastSentAtRef.current = Date.now();
    lastSentSmallRef.current = small;
    setWaiting(true);

    const { schema: sch, items: its, queue: q } = propsRef.current;
    const v = visitRef.current;
    const list = buildChecklist(sch, its, v.theme, { visualOnly: true });
    const recentTargets = capturesRef.current.filter(c => c.target && Date.now() - c.at < 120_000).map(c => c.target);
    const transcript = speechBufferRef.current;
    speechBufferRef.current = '';
    const askNext = requestNextRef.current;
    const activeAtSend = activeRef.current;
    const leaving = leavingRef.current;
    const goingTo = leaving && Date.now() < leaving.until && sameText(leaving.from, v.currentSpace) ? leaving.to : undefined;
    const stepAtSend = activeAtSend ? activeAtSend.protocol.steps[activeAtSend.stepIdx] : undefined;

    try {
      const { guide, meta } = await guideFrame({
        image,
        schema: sch,
        mode: v.mode,
        theme: v.theme === ALL_ZONES ? ALL_ZONES_LABEL : v.theme,
        stage: v.mode === 'parcours' ? stageText(v.stageIdx) : undefined,
        nextStage: v.mode === 'parcours' ? stageText(v.stageIdx + 1) : undefined,
        currentSpace: v.currentSpace || undefined,
        spacesVisited: v.spaces.map(s => s.name),
        requestNextSpace: askNext,
        missing: missingLines(list),
        recorded: recordedLines(sch, its, v.theme),
        inProgress: Array.from(new Set([...inProgressTargets(q), ...recentTargets])),
        transcript,
        lastInstruction: instructionRef.current?.text,
        lastTarget: instructionRef.current?.target,
        element: activeAtSend?.title,
        elementCategory: activeAtSend?.category,
        step: stepAtSend?.label,
        stepIndex: activeAtSend?.stepIdx,
        stepCount: activeAtSend?.protocol.steps.length,
        stepAim: stepAtSend?.aim,
        stepOptional: stepAtSend?.optional,
        nextSteps: activeAtSend ? activeAtSend.protocol.steps.slice(activeAtSend.stepIdx + 1).map(st => st.label) : undefined,
        elementsDoneHere: doneHereRef.current,
        spotted: pointsRef.current.map(pt => pt.label).slice(0, 30),
        goingTo,
      });
      failuresRef.current = 0;
      if (transcript) setSpokenSent(true);
      if (askNext) {
        requestNextRef.current = false;
        setAskingNext(false);
      }
      if (netModeRef.current === 'offline' && !propsRef.current.isOffline) {
        setNetMode('online');
        showToast('Réseau retrouvé : guidage réactivé');
      }
      // La réponse concerne-t-elle toujours l'étape en cours ? (l'inspecteur a pu passer l'étape entre-temps)
      const current = activeRef.current;
      const sameStep = !!activeAtSend && !!current && current.runId === activeAtSend.runId && current.stepIdx === activeAtSend.stepIdx;
      const staleStep = !!activeAtSend && !sameStep;

      // Photo manuelle : l'IA signale que c'est bien cadré, l'inspecteur déclenche
      const readyNow = sameStep && guide.capture && !autoCaptureRef.current && stableAtSend && stableTicksRef.current >= 1;
      if (sameStep) setReady(readyNow);
      if (!staleStep) {
        setInstruction({
          text: readyNow ? 'Bien cadré : prenez la photo' : guide.instruction,
          detail: guide.detail,
          target: current ? stepTarget(current) : guide.target,
          quality: guide.sceneQuality,
          key: Date.now(),
        });
      }
      setSeenNow(guide.seen.map(s => s.subCategory));
      setLastMeta(meta);
      setStats(s => ({ ...s, frames: s.frames + 1, latencyTotal: s.latencyTotal + (meta?.latencyMs ?? 0) }));
      if (askNext) {
        leavingRef.current = v.currentSpace ? { from: v.currentSpace, to: guide.nextSpace, until: Date.now() + LEAVING_MS } : null;
      }
      onSpaceSeen(guide.space);
      const stillLeaving = !!goingTo && !!leavingRef.current;
      setSpaceDone(
        guide.spaceDone && guide.nextSpace ? guide.nextSpace : askNext && guide.nextSpace ? guide.nextSpace : stillLeaving ? leavingRef.current!.to || null : null,
      );
      // Repères : tout ce que l'IA a vu sur cette image (même pendant un élément en cours).
      // Si l'IA croit voir une autre pièce sans que ce soit confirmé, on attend de savoir où ranger ces éléments.
      if (spaceCandidateRef.current) {
        deferredRef.current = [...deferredRef.current, { elements: guide.elements ?? [], pose: poseAtSend, dims: videoDims, zoom: zoomAtSend }].slice(-3);
      } else {
        for (const d of deferredRef.current.splice(0)) ingestElements(d.elements, d.pose, d.dims, d.zoom);
        ingestElements(guide.elements ?? [], poseAtSend, videoDims, zoomAtSend);
      }

      // Séquence : étape absente, photo de l'étape, ou démarrage du prochain élément
      let started: 'point' | 'ai' | null = null;
      if (sameStep && current) {
        const step = current.protocol.steps[current.stepIdx];
        if (guide.stepAbsent && step.optional) {
          advanceStep('absent');
          return;
        }
        if (guide.capture && autoCaptureRef.current && !pausedRef.current) requestCapture(stepTarget(current), true);
      } else if (!activeAtSend && !current && !askNext && !(leavingRef.current && Date.now() < leavingRef.current.until)) {
        // Parcours guidé : on attend que l'IA lance les relevés dans cet espace (elle peut d'abord guider vers l'étape)
        const here = normText(visitRef.current.currentSpace || guide.space || '');
        if (v.mode === 'parcours' && guide.nextCategory) startedSpaceRef.current = here;
        const canStart = v.mode !== 'parcours' || startedSpaceRef.current === here;
        const next = canStart ? pickNextPoint() : null;
        if (next) {
          startPoint(next);
          started = 'point';
        } else if (canStart && guide.nextCategory) {
          // Rien de repéré à faire : l'IA propose un élément
          const sch = propsRef.current.schema;
          const category = resolveKey(Object.keys(sch), guide.nextCategory);
          if (category && !NON_VISUAL_CATEGORIES.includes(category)) {
            const element = resolveKey(Object.keys(sch[category]), guide.nextElement) ?? guide.nextElement;
            const box = guide.targetBox.length === 4 ? uncrop(boxFromArray(guide.targetBox), zoomAtSend.d) : null;
            const dir = box && poseAtSend ? unproject(box.cx, box.cy, poseAtSend, fieldOfView(videoDims.w || 16, videoDims.h || 9, zoomAtSend.hw)) : null;
            // Libellé : celui proposé, sinon l'élément du référentiel — jamais le nom de la catégorie
            let label = guide.nextLabel || element || protocolFor(category, element).title;
            if (sameText(label, category)) label = element || protocolFor(category, element).title;
            // Déjà repéré ici (même libellé, ou même élément au même endroit) : on ne crée pas de doublon
            const same = pointsRef.current.find(
              pt => sameText(pt.label, label) || (pt.category === category && pt.element === element && !!dir && !!pt.dir && angleBetween(pt.dir, dir) < 15),
            );
            if (same) {
              if (same.status === 'todo') {
                startPoint(same);
                started = 'point';
              }
            } else if (!doneHereRef.current.some(t => sameText(t, label))) {
              startPoint(addPoint({ category, element, label, dir, box }));
              started = 'ai';
            }
          }
        }
      }
      if (staleStep || started === 'point') return;

      // Surbrillance de l'élément visé
      const tracker = trackerRef.current;
      const label = activeRef.current ? stepTarget(activeRef.current) : guide.target || guide.instruction;
      if (guide.targetBox.length === 4) {
        tracker.setTarget(uncrop(boxFromArray(guide.targetBox), zoomAtSend.d), label, poseAtSend, grayAtSend, videoDims, zoomAtSend.hw);
      } else if (!sameText(label, tracker.currentLabel)) {
        const d = guide.targetDirection;
        if (d === 'gauche' || d === 'droite' || d === 'haut' || d === 'bas' || d === 'derriere') tracker.setHint(d, label);
        else tracker.clear();
      }

      if (!activeAtSend && !activeRef.current && guide.capture && autoCaptureRef.current && !pausedRef.current) requestCapture(guide.target);
    } catch (err) {
      speechBufferRef.current = `${transcript} ${speechBufferRef.current}`.trim();
      if (err instanceof AiCallError) {
        if (err.kind === 'network') {
          failuresRef.current++;
          if (failuresRef.current >= 2 && netModeRef.current !== 'offline') setNetMode('offline');
        } else if (err.kind === 'quota' || err.kind === 'auth' || err.kind === 'config') {
          setBlockMsg(err.message);
        } else {
          showToast(`IA : ${err.message}`);
        }
      } else {
        showToast('Erreur de guidage');
      }
    } finally {
      inFlightRef.current = false;
      setWaiting(false);
    }
  }, [onSpaceSeen, requestCapture, showToast, advanceStep, pickNextPoint, startPoint]);

  // ---------------------------------------------------------------- boucle principale (mouvement, envoi, photos)
  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video || cameraState !== 'ready' || document.hidden) return;
    const small = smallGray(video);
    if (!small) return;
    const now = Date.now();

    const motion = meanAbsDiff(small, prevSmallRef.current);
    prevSmallRef.current = small;
    if (motion < MOTION_STABLE) {
      stableTicksRef.current++;
      movingSinceRef.current = null;
    } else {
      stableTicksRef.current = 0;
      movingSinceRef.current ??= now;
    }
    const stable = stableTicksRef.current >= 2;
    const dark = meanLuma(small) < DARK_LUMA && lightRef.current === 'off';
    setLocalHint(dark ? 'sombre' : null);
    // « Bien cadré » ne vaut que tant qu'on ne bouge pas
    if (readyRef.current && movingSinceRef.current && now - movingSinceRef.current > 350) {
      readyRef.current = false;
      setReady(false);
    }

    if (pausedRef.current) return;

    // Photo demandée par l'IA : prise dès que l'image est stable
    const pending = pendingCaptureRef.current;
    if (pending) {
      if (stable) {
        pendingCaptureRef.current = null;
        setPendingCapture(false);
        void doCapture(pending.target, 'ai');
      } else if (now > pending.until) {
        pendingCaptureRef.current = null;
        setPendingCapture(false);
      }
    }

    const offline = netModeRef.current === 'offline' || propsRef.current.isOffline;
    if (offline) {
      // Hors réseau : on enregistre une photo à chaque nouvelle scène stable, analysée plus tard
      const novelty = meanAbsDiff(small, lastCaptureSmallRef.current);
      if (autoCaptureRef.current && stable && !dark && novelty > NOVELTY_MIN * 1.5 && now - lastCaptureAtRef.current > OFFLINE_CAPTURE_GAP_MS) {
        void doCapture('', 'auto');
      }
      if (navigator.onLine && !inFlightRef.current && now - lastSentAtRef.current > OFFLINE_RETRY_MS) {
        void sendFrame(small);
      }
      return;
    }

    if (inFlightRef.current) return;
    if (requestNextRef.current) {
      void sendFrame(small); // l'inspecteur attend : pas besoin d'image stable
      return;
    }
    const sinceSent = now - lastSentAtRef.current;
    if (activeRef.current) {
      // Pendant une étape : dès que l'image est stable, on demande à l'IA si le sujet est bien cadré
      const gap = autoCaptureRef.current ? STEP_SEND_GAP_MS : STEP_SEND_GAP_MANUAL_MS;
      const maxGap = autoCaptureRef.current ? MAX_SEND_GAP_MS : MAX_STEP_GAP_MANUAL_MS;
      if ((stable && sinceSent >= gap) || sinceSent > maxGap) void sendFrame(small);
      return;
    }
    if (sinceSent < MIN_SEND_GAP_MS) return;
    const novelty = meanAbsDiff(small, lastSentSmallRef.current);
    const hasSpeech = speechBufferRef.current.length > 0;
    if ((stable && (novelty > NOVELTY_MIN || hasSpeech)) || sinceSent > MAX_SEND_GAP_MS) {
      void sendFrame(small);
    }
  }, [cameraState, doCapture, sendFrame]);

  useEffect(() => {
    if (phase !== 'running' || cameraState !== 'ready') return;
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [phase, cameraState, tick]);

  // ---------------------------------------------------------------- surbrillance (60 images/s, sans re-rendu React)
  useEffect(() => {
    if (phase !== 'running' || cameraState !== 'ready') return;
    let raf = 0;
    let lastGrayAt = 0;
    let gray: ReturnType<typeof grayFrame> = null;

    const hide = (el: HTMLElement | null) => {
      if (el && el.style.display !== 'none') el.style.display = 'none';
    };

    // Zone de l'image non couverte par la barre du haut et le panneau du bas (mesurée régulièrement)
    let zone = { top: 80, bottom: 600, at: 0 };
    const visibleZone = (vh: number) => {
      const t = performance.now();
      if (t - zone.at > 250) {
        const topEl = topBarRef.current;
        const botEl = bottomZoneRef.current;
        zone = {
          top: topEl ? topEl.getBoundingClientRect().bottom + 6 : 80,
          bottom: botEl ? botEl.getBoundingClientRect().top - 6 : vh - 260,
          at: t,
        };
      }
      return zone;
    };

    /** Image vidéo (0-1) → écran, avec l'agrandissement du zoom numérique autour du centre. */
    const toScreen = (cx: number, cy: number, vdim: { w: number; h: number }, vw: number, vh: number) => {
      const p = videoToScreen(cx, cy, vdim, { w: vw, h: vh });
      const d = zoomRef.current.digital;
      return d > 1.001 ? { x: vw / 2 + (p.x - vw / 2) * d, y: vh / 2 + (p.y - vh / 2) * d } : p;
    };

    // Repères des éléments repérés : jaune = à faire, vert = fait, gris = passé.
    // Hors écran, un élément à faire reste signalé par un petit point au bord, du côté où il se trouve.
    const pinEls = pinElsRef.current;
    const makePin = (id: string) => {
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'ar-mini');
      const dot = document.createElement('span');
      dot.className = 'ar-mini-dot';
      const lab = document.createElement('span');
      lab.className = 'ar-mini-label';
      el.append(dot, lab);
      const tap = (ev: Event) => {
        ev.stopPropagation();
        onPinTapRef.current(id);
      };
      dot.addEventListener('click', tap);
      lab.addEventListener('click', tap);
      return el;
    };
    const renderPins = (vdim: { w: number; h: number }, vw: number, vh: number) => {
      const layer = pinsLayerRef.current;
      if (!layer) return;
      const pts = pointsRef.current;
      for (const [id, el] of pinEls) {
        if (!pts.some(pt => pt.id === id)) {
          el.remove();
          pinEls.delete(id);
        }
      }
      layer.style.display = showSetupRef.current ? 'none' : '';
      if (showSetupRef.current) return;
      const pose = orientationRef.current.pose();
      const fov = fieldOfView(vdim.w, vdim.h, zoomRef.current.hw);
      const now = Date.now();
      const activeId = activeRef.current?.pointId;
      const { top, bottom } = visibleZone(vh);
      const placed: { x: number; y: number }[] = [];
      // À faire d'abord : en cas de chevauchement, c'est leur nom qui reste lisible
      const order = [...pts].sort((a, b) => (a.status === 'todo' ? 0 : 1) - (b.status === 'todo' ? 0 : 1));
      for (const pt of order) {
        let el = pinEls.get(pt.id);
        if (!el) {
          el = makePin(pt.id);
          layer.appendChild(el);
          pinEls.set(pt.id, el);
        }
        const lab = el.lastChild as HTMLElement;
        if (lab.textContent !== pt.label) lab.textContent = pt.label;
        if (pt.id === activeId || pt.status === 'active') {
          hide(el); // l'élément en cours a son grand repère
          continue;
        }
        let x = 0;
        let y = 0;
        let edge = false;
        let visible = false;
        if (pose && pt.dir) {
          const pr = project(pt.dir, pose, fov);
          const sc = toScreen(pr.cx, pr.cy, vdim, vw, vh);
          if (!pr.behind && sc.x > 6 && sc.x < vw - 6 && sc.y > top && sc.y < bottom) {
            x = sc.x;
            y = sc.y;
            visible = true;
          } else if (pt.status === 'todo') {
            const cx = vw / 2;
            const cy = (top + bottom) / 2;
            const dx = sc.x - cx;
            const dy = pr.behind ? 0 : sc.y - cy;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const tx = ux > 0 ? (vw - 14 - cx) / ux : ux < 0 ? (14 - cx) / ux : Infinity;
            const ty = uy > 0 ? (bottom - cy) / uy : uy < 0 ? (top - cy) / uy : Infinity;
            const t = Math.min(tx, ty);
            x = cx + ux * t;
            y = cy + uy * t;
            visible = true;
            edge = true;
          }
        } else if (pt.box && now - pt.seenAt < RECENT_BOX_MS) {
          const sc = toScreen(pt.box.cx, pt.box.cy, vdim, vw, vh);
          if (sc.x > 6 && sc.x < vw - 6 && sc.y > top && sc.y < bottom) {
            x = sc.x;
            y = sc.y;
            visible = true;
          }
        }
        if (!visible) {
          hide(el);
          continue;
        }
        const cls = `ar-mini ar-${pt.status}${edge ? ' ar-edge' : ''}`;
        if (el.className !== cls) {
          el.className = cls;
          el.setAttribute('data-status', pt.status);
          (el.firstChild as HTMLElement).textContent = pt.status === 'done' ? '✓' : pt.status === 'skipped' ? '–' : '';
        }
        if (el.style.display !== 'block') el.style.display = 'block';
        el.style.transform = `translate(${x}px, ${y}px)`;
        // Deux repères presque au même endroit : un seul nom affiché
        const crowded = !edge && placed.some(q => Math.abs(q.x - x) < 90 && Math.abs(q.y - y) < 22);
        lab.style.visibility = crowded ? 'hidden' : '';
        if (!edge) placed.push({ x, y });
      }
    };

    const render = () => {
      raf = requestAnimationFrame(render);
      const video = videoRef.current;
      const view = containerRef.current;
      const box = boxRef.current;
      const arrow = arrowRef.current;
      if (!video || !view || !box || !arrow || !video.videoWidth) return;
      renderPins({ w: video.videoWidth, h: video.videoHeight }, view.clientWidth, view.clientHeight);
      const tracker = trackerRef.current;
      if (!tracker.active || showSetupRef.current) {
        hide(box);
        hide(arrow);
        return;
      }
      const now = performance.now();
      if (now - lastGrayAt > TRACK_EVERY_MS) {
        gray = grayFrame(video);
        lastGrayAt = now;
      } else {
        gray = null;
      }
      const vdim = { w: video.videoWidth, h: video.videoHeight };
      const vw = view.clientWidth;
      const vh = view.clientHeight;
      const state: ARState = tracker.update(vdim, gray, zoomRef.current.hw);

      const zoneNow = visibleZone(vh);
      let arrowTo: { dx: number; dy: number; behind: boolean } | null = null;
      if (state.kind === 'box') {
        // Repère posé sur la partie visible de l'élément (un sol ou un mur peut dépasser sous le panneau du bas)
        const c = toScreen(state.box.cx, state.box.cy, vdim, vw, vh);
        const r1 = toScreen(state.box.cx - state.box.w / 2, state.box.cy - state.box.h / 2, vdim, vw, vh);
        const r2 = toScreen(state.box.cx + state.box.w / 2, state.box.cy + state.box.h / 2, vdim, vw, vh);
        const minY = Math.max(zoneNow.top + 76, Math.min(c.y, r1.y));
        const maxY = Math.min(zoneNow.bottom - 10, Math.max(c.y, r2.y));
        const minX = Math.max(12, Math.min(c.x, r1.x));
        const maxX = Math.min(vw - 12, Math.max(c.x, r2.x));
        const onScreen = minY <= maxY && minX <= maxX;
        if (onScreen) {
          const px = Math.min(Math.max(c.x, minX), maxX);
          const py = Math.min(Math.max(c.y, minY), maxY);
          box.style.display = 'block';
          box.style.transform = `translate(${px}px, ${py}px)`;
          box.classList.toggle('ar-weak', !state.confident);
          const lab = boxLabelRef.current;
          if (lab) {
            const short = state.label.replace(' — ', ' · ');
            if (lab.textContent !== short) lab.textContent = short;
            // Étiquette gardée dans l'écran
            const lw = lab.offsetWidth;
            const shift = Math.min(Math.max(px - lw / 2, 8), vw - 8 - lw) - (px - lw / 2);
            lab.style.transform = `translateX(calc(-50% + ${shift}px))`;
          }
          hide(arrow);
          return;
        }
        // Élément entièrement caché par le haut ou le bas de l'écran : flèche vers lui
        hide(box);
        arrowTo = { dx: c.x - vw / 2, dy: c.y - (zoneNow.top + zoneNow.bottom) / 2, behind: false };
      }

      hide(box);
      if (state.kind === 'none') {
        hide(arrow);
        return;
      }
      // Flèche au bord de l'écran vers l'élément
      let dx: number;
      let dy: number;
      let behind = false;
      if (arrowTo) {
        ({ dx, dy, behind } = arrowTo);
      } else if (state.kind === 'offscreen') {
        const c = toScreen(0.5 + state.dx, 0.5 + state.dy, vdim, vw, vh);
        dx = c.x - vw / 2;
        dy = c.y - vh / 2;
        behind = state.behind;
        if (behind) dy = 0;
      } else if (state.kind === 'hint') {
        [dx, dy] = HINT_VECTOR[state.direction];
        behind = state.direction === 'derriere';
      } else {
        hide(arrow);
        return;
      }
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // Zone utile entre la barre du haut et le panneau du bas
      const top = zoneNow.top + 30;
      const bottom = zoneNow.bottom - 30;
      const left = 44;
      const right = vw - 44;
      const cx = vw / 2;
      const cy = (top + bottom) / 2;
      const tx = ux > 0 ? (right - cx) / ux : ux < 0 ? (left - cx) / ux : Infinity;
      const ty = uy > 0 ? (bottom - cy) / uy : uy < 0 ? (top - cy) / uy : Infinity;
      const t = Math.min(tx, ty);
      arrow.style.display = 'flex';
      arrow.style.transform = `translate(${cx + ux * t}px, ${cy + uy * t}px) translate(-50%, -50%)`;
      if (arrowIconRef.current) arrowIconRef.current.style.transform = `rotate(${Math.atan2(uy, ux)}rad)`;
      const text = behind ? `${tracker.currentLabel} · derrière vous` : tracker.currentLabel;
      const lab = arrowLabelRef.current;
      if (lab) {
        if (lab.textContent !== text) lab.textContent = text;
        // Étiquette gardée dans l'écran (la flèche est collée au bord)
        const ax = cx + ux * t;
        const lw = lab.offsetWidth;
        const shift = Math.min(Math.max(ax - lw / 2, 8), vw - 8 - lw) - (ax - lw / 2);
        lab.style.transform = `translateX(${shift}px)`;
      }
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      pinEls.forEach(el => el.remove());
      pinEls.clear();
    };
  }, [phase, cameraState]);

  // La photo à prendre reste visible dans la liste des étapes
  useEffect(() => {
    const cur = chipsRef.current?.querySelector('[data-state="current"], [data-state="refused"]') as HTMLElement | null;
    const box = chipsRef.current;
    if (cur && box) box.scrollTo({ left: Math.max(0, cur.offsetLeft - box.clientWidth / 2 + cur.clientWidth / 2), behavior: 'smooth' });
  }, [active?.runId, active?.stepIdx]);

  // ---------------------------------------------------------------- crédits par minute de guidage
  const chargeMinute = useCallback(async () => {
    if (propsRef.current.userCoins < AI_COSTS.GUIDED_MINUTE) {
      setBlockMsg(`Crédits insuffisants pour poursuivre le guidage (${AI_COSTS.GUIDED_MINUTE} crédits par minute).`);
      return;
    }
    const ok = await onSpendCoinsRef.current(AI_COSTS.GUIDED_MINUTE);
    if (!ok) setBlockMsg('Crédits insuffisants pour poursuivre le guidage.');
  }, []);

  // Une minute est due dès qu'elle commence ; une pause ne remet pas le compteur à zéro.
  const lastChargeAtRef = useRef(0);
  const guidanceActive = phase === 'running' && cameraState === 'ready' && !paused && !showSetup && !blockMsg && netMode === 'online';
  useEffect(() => {
    if (!guidanceActive) return;
    const check = () => {
      if (Date.now() - lastChargeAtRef.current >= 60_000) {
        lastChargeAtRef.current = Date.now();
        void chargeMinute();
      }
    };
    check();
    const id = window.setInterval(check, 5_000);
    return () => window.clearInterval(id);
  }, [guidanceActive, chargeMinute]);

  // ---------------------------------------------------------------- actions
  const beginVisit = (m: VisitMode) => {
    const changedMode = m !== mode;
    setMode(m);
    setShowSetup(false);
    setInstruction(null);
    releaseActive('todo');
    lastSentAtRef.current = 0;
    if (changedMode || phase !== 'running') setStageIdx(0);
    if (phase !== 'running') {
      // iPhone : l'accès au gyroscope doit être demandé pendant ce toucher
      void OrientationSource.requestPermission().then(ok => {
        if (ok) orientationRef.current.start();
      });
      setPhase('running');
      setMicOn(speechSupported);
      flashSpeechHint(true);
      setStats(s => ({ ...s, startedAt: Date.now() }));
      void startCamera();
    }
  };

  /** Astuce sur la dictée : au démarrage, une seule fois par téléphone ; à chaque fois qu'on rallume le micro. */
  const flashSpeechHint = (onceOnly = false) => {
    const key = `inspecteur.speechHint.${speechSupported ? 'ok' : 'ko'}`;
    if (onceOnly) {
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
      } catch {
        /* stockage indisponible : on montre l'astuce */
      }
    }
    setSpeechHint(true);
    window.setTimeout(() => setSpeechHint(false), SPEECH_HINT_MS);
  };

  const changeAutoCapture = (on: boolean) => {
    setAutoCapture(on);
    autoCaptureRef.current = on;
    setReady(false);
    pendingCaptureRef.current = null;
    setPendingCapture(false);
    try {
      localStorage.setItem(AUTO_CAPTURE_KEY, on ? '1' : '0');
    } catch {
      /* stockage indisponible : réglage gardé pour cette visite */
    }
  };

  const askNextSpace = () => {
    releaseActive('todo');
    setInstruction(null);
    requestNextRef.current = true;
    setAskingNext(true);
    setSpaceDone(null);
    trackerRef.current.clear();
    spaceCandidateRef.current = null;
  };

  const nextStage = () => {
    if (stageIdx >= PARCOURS_STAGES.length - 1) return;
    setStageIdx(i => i + 1);
    askNextSpace();
  };

  const finishVisit = () => {
    const leftover = (speechSinceCaptureRef.current || '').trim();
    speechSinceCaptureRef.current = '';
    if (leftover) onLeftoverSpeech(leftover);
    stopSpeech();
    stopCamera();
    orientationRef.current.stop();
    saveRoom();
    setStats(s => ({ ...s, endedAt: Date.now() }));
    setPhase('summary');
  };

  // Statut d'analyse des photos de la session
  const captureStatus = (id: string): 'attente' | 'analyse' | 'erreur' | 'fait' => {
    const q = queue.find(i => i.id === id);
    if (!q) return 'fait';
    if (q.status === 'error') return 'erreur';
    return q.status === 'analyzing' ? 'analyse' : 'attente';
  };
  const doneCount = captures.filter(c => captureStatus(c.id) === 'fait').length;
  const progressPct = checklist.total ? Math.round((checklist.done / checklist.total) * 100) : 0;
  const offline = netMode === 'offline' || isOffline;
  const QualityIcon = instruction ? QUALITY_ICON[instruction.quality] ?? Sparkles : Sparkles;
  const spacePhotos = spaces.length ? spaces[spaces.length - 1].photos : 0;
  const roomDone = roomPoints.filter(pt => pt.status === 'done').length;
  const roomStats = (name: string) => {
    const r = roomsRef.current.get(normText(name));
    return r ? { total: r.points.length, done: r.points.filter(pt => pt.status === 'done').length } : null;
  };

  // ---------------------------------------------------------------- rendu : choix du mode de visite
  const setupScreen = (
    <div className="fixed inset-0 z-[320] bg-slate-950/95 text-white flex flex-col safe-top safe-bottom" data-testid="visit-setup">
      <div className="flex items-center justify-between px-4 pb-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-blue-300 font-semibold">Visite guidée</p>
          <h2 className="text-xl font-bold">Comment voulez-vous visiter ?</h2>
        </div>
        <button
          onClick={() => (phase === 'setup' ? onClose() : setShowSetup(false))}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20"
          aria-label="Fermer"
        >
          <X size={22} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <button
          onClick={() => beginVisit('libre')}
          className={`w-full text-left p-4 rounded-2xl border transition-colors ${phase === 'running' && mode === 'libre' ? 'bg-blue-600 border-blue-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
          data-testid="mode-libre"
        >
          <div className="flex items-center gap-3">
            <MapPin size={22} className="text-blue-300 shrink-0" />
            <span className="font-bold text-lg">Commencer ici</span>
          </div>
          <p className="text-sm text-white/75 mt-1.5">
            L'IA reconnaît la pièce où vous êtes et vous guide sur ce qui s'y trouve. Vous passez à la pièce suivante quand vous voulez.
          </p>
        </button>

        <button
          onClick={() => beginVisit('parcours')}
          className={`w-full text-left p-4 rounded-2xl border transition-colors ${phase === 'running' && mode === 'parcours' ? 'bg-blue-600 border-blue-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
          data-testid="mode-parcours"
        >
          <div className="flex items-center gap-3">
            <Route size={22} className="text-emerald-300 shrink-0" />
            <span className="font-bold text-lg">Parcours guidé</span>
          </div>
          <p className="text-sm text-white/75 mt-1.5">L'IA vous dit où aller, dans un ordre logique :</p>
          <ol className="mt-1.5 text-xs text-white/65 space-y-0.5 list-decimal list-inside">
            {PARCOURS_STAGES.map(s => <li key={s.id}>{s.label}</li>)}
          </ol>
        </button>

        <div className="pt-2" data-testid="capture-mode">
          <p className="text-sm font-semibold text-white/85 mb-2">Prise de photo</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              [false, 'Manuelle', 'Vous déclenchez ; l’IA vérifie la photo et vous fait reprendre si elle est inexploitable.'],
              [true, 'Mains libres', 'L’IA déclenche quand c’est bien cadré (sous un évier, vers un plafond…).'],
            ] as const).map(([on, title, text]) => (
              <button
                key={title}
                onClick={() => changeAutoCapture(on)}
                className={`text-left p-3 rounded-2xl border ${autoCapture === on ? 'bg-white text-slate-900 border-white' : 'bg-white/5 border-white/10 text-white'}`}
                data-testid={on ? 'capture-auto' : 'capture-manual'}
              >
                <span className="block font-bold text-sm">{title}{!on && <span className={`font-normal ${autoCapture === on ? 'text-slate-500' : 'text-white/50'}`}> · conseillé</span>}</span>
                <span className={`block text-xs mt-1 ${autoCapture === on ? 'text-slate-600' : 'text-white/65'}`}>{text}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <p className="text-sm font-semibold text-white/85 mb-2">Thème (facultatif)</p>
          <div className="flex flex-wrap gap-2">
            {[ALL_ZONES, ...themes].map(t => {
              const cl = buildChecklist(schema, items, t, { visualOnly: true });
              const on = t === theme;
              return (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${on ? 'bg-white text-slate-900 border-white' : 'bg-white/5 border-white/15 text-white/85'}`}
                >
                  {t === ALL_ZONES ? 'Tout' : t} <span className={on ? 'text-slate-500' : 'text-white/50'}>{cl.done}/{cl.total}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="pt-3 text-center text-[11px] text-white/40" data-testid="app-version">Version {versionLabel()}</p>
      </div>
    </div>
  );

  if (phase === 'setup') return setupScreen;

  // ---------------------------------------------------------------- rendu : bilan
  if (phase === 'summary') {
    const duration = Math.max(0, Math.round(((stats.endedAt || Date.now()) - stats.startedAt) / 60000));
    const avg = stats.frames ? stats.latencyTotal / stats.frames : undefined;
    const waitingCount = captures.length - doneCount;
    return (
      <div className="fixed inset-0 z-[320] bg-slate-950 text-white flex flex-col items-center justify-center p-6 safe-top safe-bottom overflow-y-auto" data-testid="guided-summary">
        <div className="w-full max-w-sm space-y-5">
          <div className="text-center space-y-2">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 size={30} className="text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold">Visite terminée</h2>
            <p className="text-slate-300 text-sm">{mode === 'parcours' ? 'Parcours guidé' : 'Visite libre'} · {themeLabel}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-2xl font-bold">{captures.length}</div>
              <div className="text-xs text-slate-400">photos prises</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-2xl font-bold">{checklist.done}/{checklist.total}</div>
              <div className="text-xs text-slate-400">éléments complets</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-2xl font-bold">{duration} min</div>
              <div className="text-xs text-slate-400">de visite</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-2xl font-bold">{avg ? fmtSeconds(avg) : '—'}</div>
              <div className="text-xs text-slate-400">par consigne ({stats.frames} images)</div>
            </div>
          </div>
          {doneElements.length > 0 && (
            <div className="rounded-2xl bg-white/5 p-4" data-testid="elements-done">
              <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Éléments relevés</p>
              <ol className="space-y-1 text-sm">
                {doneElements.map((d, i) => (
                  <li key={`${d.title}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{d.title}{d.space ? <span className="text-slate-400"> · {d.space}</span> : null}</span>
                    <span className="text-slate-400 shrink-0">{d.photos} photo{d.photos > 1 ? 's' : ''}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {spaces.length > 0 && (
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Espaces parcourus</p>
              <ol className="space-y-1 text-sm">
                {spaces.map((s, i) => {
                  const rs = roomStats(s.name);
                  return (
                    <li key={`${s.name}-${i}`} className="flex justify-between gap-2">
                      <span className="truncate">{i + 1}. {s.name}</span>
                      <span className="text-slate-400 shrink-0">
                        {rs && rs.total ? `${rs.done}/${rs.total} éléments · ` : ''}{s.photos} photo{s.photos > 1 ? 's' : ''}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          {waitingCount > 0 && (
            <p className="text-sm text-amber-200 bg-amber-500/10 border border-amber-400/20 rounded-xl p-3 flex gap-2">
              <Clock size={18} className="shrink-0 mt-0.5" />
              {waitingCount} photo{waitingCount > 1 ? 's' : ''} encore dans la file d'analyse{offline ? ' : elles partiront au retour du réseau.' : '.'}
            </p>
          )}
          <button onClick={onClose} className="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 font-bold">
            Revenir à l'inspection
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- rendu : caméra
  const LightIcon = light === 'torch' ? Flashlight : light === 'boost' ? SunMedium : FlashlightOff;
  const step = active ? active.protocol.steps[active.stepIdx] : null;
  const lastCapture = captures.length ? captures[captures.length - 1] : null;

  // Une seule ligne de message à la fois, la plus importante
  type Msg = { tone: string; icon?: React.ReactNode; text: React.ReactNode; action?: React.ReactNode; testid: string };
  const msg: Msg | null = retakeOffer
    ? {
        tone: 'bg-rose-600/95 text-white',
        icon: <AlertTriangle size={16} />,
        text: `${retakeOffer.element.title} · ${retakeOffer.element.protocol.steps[retakeOffer.stepIdx].label} : ${retakeOffer.check.problem || 'photo inexploitable'}`,
        action: (
          <>
            <button onClick={acceptRetake} className="shrink-0 px-2.5 py-1 rounded-full bg-white text-rose-700 text-xs font-bold" data-testid="retake-accept">
              Reprendre
            </button>
            <button onClick={() => setRetakeOffer(null)} className="shrink-0 p-1 rounded-full bg-white/15" aria-label="Ignorer">
              <X size={14} />
            </button>
          </>
        ),
        testid: 'retake-offer',
      }
    : pendingCapture
      ? { tone: 'bg-white text-black', icon: <Hand size={16} />, text: 'Ne bougez plus…', testid: 'pending-capture' }
      : offline
        ? {
            tone: 'bg-amber-400 text-black',
            icon: <WifiOff size={16} />,
            text: autoCapture ? 'Hors réseau : photos prises seules, analysées au retour du réseau' : 'Hors réseau : vos photos seront analysées au retour du réseau',
            testid: 'offline-banner',
          }
        : toast
          ? { tone: 'bg-emerald-500 text-black', icon: <CheckCircle2 size={16} />, text: toast, testid: 'guided-toast' }
          : interim || (spokenVisible && lastSpoken)
            ? {
                tone: 'bg-black/70 text-white',
                icon: <Mic size={15} className="text-rose-300" />,
                text: <span className="italic">« {interim || lastSpoken} »</span>,
                action: !interim ? (
                  <span className={`shrink-0 text-xs font-semibold ${spokenSent ? 'text-emerald-300' : 'text-white/60'}`}>{spokenSent ? 'transmis ✓' : 'envoi…'}</span>
                ) : undefined,
                testid: 'mic-status',
              }
            : spaceDone && !active
              ? { tone: 'bg-blue-600 text-white', icon: <DoorOpen size={16} />, text: `Ensuite : ${spaceDone}`, testid: 'space-done' }
            : speechHint
              ? {
                  tone: 'bg-black/70 text-white',
                  icon: micOn ? <Mic size={15} className="text-rose-300" /> : <MicOff size={15} />,
                  text: micOn
                    ? 'Parlez pour préciser : « fenêtre de 1985 », « pas de store ici »…'
                    : speechSupported
                      ? 'Dictée coupée : touchez le micro pour parler à l’IA'
                      : isFirefox
                        ? 'Firefox n’a pas de dictée vocale : ouvrez l’appli dans Chrome pour parler à l’IA'
                        : 'Dictée vocale non disponible sur ce navigateur',
                  testid: 'speech-hint',
                }
              : micMsg
                ? { tone: 'bg-amber-400 text-black', icon: <MicOff size={15} />, text: micMsg, testid: 'mic-message' }
                : localHint === 'sombre'
                    ? { tone: 'bg-amber-400 text-black', icon: <Sun size={16} />, text: 'Image sombre : touchez la lampe en haut', testid: 'dark-hint' }
                    : null;

  // État de chaque photo à prendre (puces du panneau du bas)
  const chipState = (i: number): 'current' | 'refused' | 'checking' | 'done' | 'skipped' | 'todo' => {
    if (!active) return 'todo';
    const chk = checks[`${active.runId}:${i}`];
    if (i === active.stepIdx) return chk === 'refused' ? 'refused' : 'current';
    const outcome = active.outcomes[i];
    if (outcome === 'photo') return chk === 'checking' ? 'checking' : 'done';
    if (outcome === 'absent' || outcome === 'skip') return 'skipped';
    return 'todo';
  };
  const CHIP_CLASS: Record<ReturnType<typeof chipState>, string> = {
    current: 'bg-amber-300 text-slate-900',
    refused: 'bg-rose-500 text-white',
    checking: 'bg-white/20 text-white',
    done: 'bg-emerald-500/30 text-emerald-100',
    skipped: 'bg-white/5 text-white/40 line-through',
    todo: 'bg-white/10 text-white/85',
  };

  // Fiche d'un élément (repère vert, liste de la pièce, dernière photo)
  const ALL_PHOTOS = '__all__';
  const sheetPoint = sheetPointId && sheetPointId !== ALL_PHOTOS ? (roomPoints.find(p => p.id === sheetPointId) ?? findPoint(sheetPointId)) : null;
  const sheetCaptures = sheetPointId === ALL_PHOTOS ? captures : sheetPoint ? captures.filter(c => c.pointId === sheetPoint.id) : [];
  const sheetInfo = (() => {
    const attrs = new Map<string, string>();
    const comments: string[] = [];
    const scores: number[] = [];
    for (const c of sheetCaptures) {
      if (refusedCaptures.includes(c.id)) continue; // photo refusée : pas prise en compte ici
      const analysis = captureResults[c.id];
      if (!analysis) continue;
      const res = analysis.results[analysis.primary] ?? analysis.results[0];
      if (!res) continue;
      Object.entries(res.attributes ?? {}).forEach(([k, v]) => {
        if (v && String(v).trim() && v !== 'Non défini') attrs.set(k, String(v));
      });
      if (res.commentaire && !comments.includes(res.commentaire)) comments.push(res.commentaire);
      if (typeof res.conditionScore === 'number') scores.push(res.conditionScore);
    }
    const pending = sheetCaptures.filter(c => !captureResults[c.id] && captureStatus(c.id) !== 'erreur' && captureStatus(c.id) !== 'fait').length;
    const failed = sheetCaptures.filter(c => captureStatus(c.id) === 'erreur').length;
    const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    return { attrs: Array.from(attrs.entries()), comments, score, pending, failed };
  })();
  const openLastPhoto = () => {
    if (!lastCapture) {
      setRoomListOpen(true);
      return;
    }
    setSheetPointId(lastCapture.pointId && findPoint(lastCapture.pointId) ? lastCapture.pointId : ALL_PHOTOS);
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[300] bg-black text-white overflow-hidden select-none"
      style={{ touchAction: 'none' }}
      data-testid="guided-visit"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={light === 'boost' ? { filter: LOW_LIGHT_FILTER } : undefined}
        playsInline
        muted
        autoPlay
      />
      {flashKey > 0 && <div key={flashKey} className="absolute inset-0 bg-white pointer-events-none capture-flash" />}

      {/* Repères des éléments repérés dans la pièce (positionnés image par image) */}
      <div ref={pinsLayerRef} className="ar-pins" data-testid="ar-pins" />

      {/* Repère sur l'élément en cours (positionné image par image) */}
      <div ref={boxRef} className="ar-pin" style={{ display: 'none' }} data-testid="ar-pin">
        <span ref={boxLabelRef} className="ar-pin-label" />
        <span className="ar-pin-head"><MapPin size={16} strokeWidth={2.5} /></span>
        <span className="ar-pin-dot" />
      </div>
      <div ref={arrowRef} className="ar-arrow" style={{ display: 'none' }} data-testid="ar-arrow">
        <div ref={arrowIconRef} className="ar-arrow-icon"><Navigation size={20} style={{ transform: 'rotate(45deg)' }} /></div>
        <span ref={arrowLabelRef} className="ar-arrow-label" />
      </div>

      {/* Haut : une seule ligne */}
      <div className="absolute top-0 inset-x-0 z-10 bg-gradient-to-b from-black/55 to-transparent px-3 pb-5 safe-top">
        <div ref={topBarRef} className="flex items-center gap-2 pt-1">
          <button onClick={finishVisit} className="p-2.5 rounded-full bg-black/40" aria-label="Terminer la visite">
            <X size={20} />
          </button>
          <button
            onClick={() => setRoomListOpen(true)}
            className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/40 text-sm font-semibold text-left"
            data-testid="space-chip"
          >
            <MapPin size={15} className="shrink-0 text-blue-300" />
            <span className="truncate">{offline ? 'Hors réseau' : currentSpace || 'Pièce en cours d’identification'}</span>
            {roomPoints.length > 0 && (
              <span className="shrink-0 flex items-center gap-1 text-emerald-300" data-testid="room-count">
                · <ListChecks size={13} /> {roomDone}/{roomPoints.length}
              </span>
            )}
          </button>
          <button
            onClick={() => void toggleLight()}
            className={`p-2.5 rounded-full ${light === 'torch' ? 'bg-amber-400 text-black' : light === 'boost' ? 'bg-sky-300 text-black' : localHint === 'sombre' ? 'bg-amber-400/30 ring-2 ring-amber-300' : 'bg-black/40'}`}
            aria-label={light === 'off' ? 'Allumer la lampe' : 'Éteindre la lampe'}
            data-testid="light-toggle"
          >
            {lightBusy ? <Loader2 size={20} className="animate-spin" /> : <LightIcon size={20} />}
          </button>
          {speechSupported && (
            <button
              onClick={() => {
                setMicMsg('');
                micErrorsRef.current = 0;
                if (!micOn) flashSpeechHint();
                setMicOn(m => !m);
              }}
              className={`relative p-2.5 rounded-full ${micOn ? 'bg-rose-500' : 'bg-black/40'}`}
              aria-label={micOn ? 'Couper la dictée' : 'Activer la dictée'}
              data-testid="mic-toggle"
            >
              {micOn && !paused && <span className="absolute inset-0 rounded-full listen-ring" />}
              {micOn ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
          )}
          <button onClick={() => setMenuOpen(true)} className="p-2.5 rounded-full bg-black/40" aria-label="Menu de la visite" data-testid="menu-button">
            <MoreHorizontal size={20} />
          </button>
        </div>
      </div>

      {/* Milieu : seulement la pause ou un blocage */}
      {(paused || blockMsg) && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-10 flex justify-center px-6">
          <div className="px-5 py-3 rounded-2xl bg-black/75 text-center max-w-sm">
            <p className="font-bold">{blockMsg ? 'Guidage interrompu' : 'Visite en pause'}</p>
            {blockMsg && <p className="text-sm text-white/80 mt-1">{blockMsg}</p>}
            <button
              onClick={() => (blockMsg ? setBlockMsg('') : setPaused(false))}
              className="mt-3 px-4 py-2 rounded-full bg-white/15 text-sm font-semibold"
            >
              {blockMsg ? 'Réessayer' : 'Reprendre'}
            </button>
          </div>
        </div>
      )}

      {cameraState === 'error' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-black/85">
          <div className="max-w-sm text-center space-y-4">
            <AlertTriangle size={36} className="mx-auto text-amber-400" />
            <p className="font-semibold">{cameraError}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => void startCamera()} className="px-4 py-2 rounded-full bg-blue-600 font-bold">Réessayer</button>
              <button onClick={onClose} className="px-4 py-2 rounded-full bg-white/15 font-bold">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Bas : message, consigne, déclencheur */}
      <div className="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-8 safe-bottom">
        <div ref={bottomZoneRef} />
        {zoomShown > 1.04 && (
          <div className="flex justify-center mb-2">
            <button
              onClick={() => setZoom(1)}
              className="px-3 py-1 rounded-full bg-black/60 border border-white/20 text-sm font-bold flex items-center gap-1.5"
              aria-label="Revenir à 1×"
              data-testid="zoom-chip"
            >
              <ZoomIn size={14} /> {zoomShown.toFixed(1).replace('.', ',')}× <span className="text-white/60 font-semibold">· 1×</span>
            </button>
          </div>
        )}
        {msg && (
          <div className={`mx-3 mb-2 px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 shadow-lg ${msg.tone}`} data-testid={msg.testid}>
            {msg.icon && <span className="shrink-0">{msg.icon}</span>}
            <span className="min-w-0 flex-1 line-clamp-2">{msg.text}</span>
            {msg.action}
          </div>
        )}

        <div className="mx-3 mb-3 rounded-2xl bg-black/55 backdrop-blur-md border border-white/10 px-3 py-2.5" data-testid="guide-panel" aria-live="polite">
          {askingNext ? (
            <div className="flex items-center gap-2.5">
              <Loader2 size={18} className="animate-spin text-blue-300 shrink-0" />
              <p className="text-[17px] font-semibold" data-testid="guide-instruction">Je regarde où aller ensuite…</p>
            </div>
          ) : active && step ? (
            <>
              <div
                className="flex items-center gap-2"
                data-testid="step-bar"
                data-element={active.title}
                data-index={active.stepIdx}
                data-step={step.label}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-amber-200">{active.title}</span>
                <button onClick={() => advanceStep('skip')} className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 text-xs font-semibold" data-testid="skip-step">
                  <SkipForward size={13} /> Passer
                </button>
                <button onClick={abandonElement} className="shrink-0 px-2 py-1 rounded-full bg-white/10 text-xs font-semibold" data-testid="next-element">
                  Autre
                </button>
              </div>
              <div ref={chipsRef} className="mt-2 flex gap-1.5 overflow-x-auto scrollbar-hide" data-testid="step-chips">
                {active.protocol.steps.map((st, i) => {
                  const state = chipState(i);
                  return (
                    <button
                      key={st.key}
                      onClick={() => jumpToStep(i)}
                      className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${CHIP_CLASS[state]}`}
                      data-testid="step-chip"
                      data-state={state}
                    >
                      {state === 'done' && <CheckCircle2 size={12} />}
                      {state === 'checking' && <Loader2 size={12} className="animate-spin" />}
                      {state === 'refused' && <AlertTriangle size={12} />}
                      {st.label}
                    </button>
                  );
                })}
              </div>
              <p
                key={instruction?.key}
                className={`mt-2 text-[17px] leading-snug font-semibold line-clamp-2 guide-pop ${ready && !autoCapture ? 'text-emerald-300' : ''}`}
                data-testid="guide-instruction"
              >
                {instruction?.text ?? step.instruction}
              </p>
            </>
          ) : (
            <div className="flex items-start gap-2.5">
              {!instruction && cameraState !== 'error' && <Loader2 size={18} className="animate-spin text-blue-300 shrink-0 mt-1" />}
              <div className="min-w-0">
                <p className="text-[17px] leading-snug font-semibold line-clamp-2 guide-pop" key={instruction?.key} data-testid="guide-instruction">
                  {instruction
                    ? instruction.text
                    : cameraState !== 'ready'
                      ? 'Ouverture de la caméra…'
                      : mode === 'parcours'
                        ? 'Je prépare le parcours…'
                        : 'Filmez la pièce : je repère les éléments'}
                </p>
                {roomPoints.some(p => p.status === 'todo') && (
                  <p className="mt-0.5 text-xs text-white/60">Touchez un repère jaune pour le relever</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 pb-2">
          <button
            onClick={openLastPhoto}
            className="relative w-14 h-14 rounded-xl overflow-hidden border-2 border-white/70 bg-black/40 flex items-center justify-center"
            aria-label="Voir ce qui a été relevé"
            data-testid="last-photo"
          >
            {lastCapture ? <img src={lastCapture.thumb} alt="" className="w-full h-full object-cover" /> : <Images size={22} className="text-white/70" />}
            {captures.length > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-black text-[11px] font-bold flex items-center justify-center">
                {captures.length}
              </span>
            )}
          </button>

          <button
            onClick={() => void doCapture(instruction?.target ?? '', 'manuel')}
            disabled={cameraState !== 'ready'}
            className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-colors ${ready && !autoCapture ? 'border-emerald-400 ring-4 ring-emerald-400/40' : 'border-white'} disabled:opacity-40`}
            aria-label="Prendre une photo"
            data-testid="shutter"
          >
            <span className={`w-16 h-16 rounded-full ${autoCapture ? 'bg-sky-200' : 'bg-white'}`} />
          </button>

          <button
            onClick={askNextSpace}
            disabled={askingNext || offline || cameraState !== 'ready'}
            className={`h-12 px-3 rounded-full flex items-center gap-1 text-xs font-bold ${spaceDone ? 'bg-blue-500' : 'bg-white/15'} disabled:opacity-40`}
            data-testid="next-space"
          >
            <DoorOpen size={16} /> Pièce suivante
          </button>
        </div>
      </div>

      {/* Menu de la visite : tout ce qui est secondaire */}
      {menuOpen && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40" onClick={() => setMenuOpen(false)}>
          <div
            className="rounded-t-3xl bg-slate-950/95 backdrop-blur-md border-t border-white/10 px-4 pt-4 pb-4 safe-bottom max-h-[75vh] overflow-y-auto space-y-3"
            onClick={e => e.stopPropagation()}
            data-testid="visit-menu"
          >
            <div className="flex items-center justify-between">
              <p className="font-bold text-lg">Visite</p>
              <button onClick={() => setMenuOpen(false)} className="p-2 rounded-full bg-white/10" aria-label="Fermer le menu">
                <X size={18} />
              </button>
            </div>

            <button
              onClick={() => { setMenuOpen(false); setShowSetup(true); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-white/5 text-left"
            >
              {mode === 'parcours' ? <Route size={18} className="text-emerald-300 shrink-0" /> : <MapPin size={18} className="text-blue-300 shrink-0" />}
              <span className="flex-1 min-w-0 truncate font-semibold">{mode === 'parcours' ? 'Parcours guidé' : 'Visite libre'} · {theme === ALL_ZONES ? 'Tout' : theme}</span>
              <ChevronRight size={18} className="text-white/50 shrink-0" />
            </button>

            {mode === 'parcours' && (
              <div className="flex items-center gap-2 px-3 py-3 rounded-xl bg-white/5" data-testid="stage-line">
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/25 text-emerald-200 text-xs font-semibold shrink-0">
                  Étape {stageIdx + 1}/{PARCOURS_STAGES.length}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm">{PARCOURS_STAGES[stageIdx].label}</span>
                {stageIdx < PARCOURS_STAGES.length - 1 && (
                  <button onClick={() => { setMenuOpen(false); nextStage(); }} className="shrink-0 px-2.5 py-1 rounded-full bg-white/15 text-xs font-semibold">
                    Étape suivante
                  </button>
                )}
              </div>
            )}

            <div className="px-3 py-3 rounded-xl bg-white/5">
              <p className="text-sm font-semibold mb-2 flex items-center gap-2"><Camera size={16} /> Prise de photo</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => changeAutoCapture(false)}
                  className={`py-2 rounded-lg text-sm font-semibold ${!autoCapture ? 'bg-white text-slate-900' : 'bg-white/10'}`}
                  data-testid="menu-capture-manual"
                >
                  Manuelle
                </button>
                <button
                  onClick={() => changeAutoCapture(true)}
                  className={`py-2 rounded-lg text-sm font-semibold ${autoCapture ? 'bg-white text-slate-900' : 'bg-white/10'}`}
                  data-testid="auto-toggle"
                >
                  Mains libres
                </button>
              </div>
            </div>

            <div className="px-3 py-3 rounded-xl bg-white/5 text-sm space-y-2">
              <div className="flex justify-between text-white/80">
                <span>{checklist.done}/{checklist.total} éléments complets</span>
                <span>{captures.length} photo{captures.length > 1 ? 's' : ''} · {doneCount} analysée{doneCount > 1 ? 's' : ''}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                <div className="h-full bg-emerald-400" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs text-white/50">
                {demoMode ? 'IA simulée (mode invité)' : lastMeta ? `${modelLabel(lastMeta.model)} · ${fmtSeconds(lastMeta.latencyMs)} par consigne` : 'IA : en attente de la première consigne'}
                {' · '}Version {versionLabel()}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setPaused(p => !p); setMenuOpen(false); }}
                className="py-3 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"
              >
                {paused ? <Play size={18} /> : <Pause size={18} />} {paused ? 'Reprendre' : 'Pause'}
              </button>
              <button onClick={finishVisit} className="py-3 rounded-xl bg-rose-600 font-bold" data-testid="menu-finish">
                Terminer la visite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fiche d'un élément : photos et informations relevées */}
      {sheetPointId && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={() => setSheetPointId(null)}>
          <div
            className="rounded-t-3xl bg-slate-950/95 backdrop-blur-md border-t border-white/10 px-4 pt-4 pb-4 safe-bottom max-h-[75vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
            data-testid="element-sheet"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-lg truncate">{sheetPoint ? sheetPoint.label : 'Photos de la visite'}</p>
                {sheetPoint && (
                  <p className="text-xs text-white/60 truncate">
                    {!sameText(sheetPoint.element, sheetPoint.label) && `${sheetPoint.element || sheetPoint.category} · `}
                    {sheetPoint.status === 'done' ? 'relevé ✓' : sheetPoint.status === 'active' ? 'en cours' : sheetPoint.status === 'skipped' ? 'passé' : 'à faire'}
                  </p>
                )}
              </div>
              <button onClick={() => setSheetPointId(null)} className="p-2 rounded-full bg-white/10 shrink-0" aria-label="Fermer la fiche">
                <X size={18} />
              </button>
            </div>

            {sheetCaptures.length > 0 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                {sheetCaptures.map(c => {
                  const st = captureStatus(c.id);
                  const refused = refusedCaptures.includes(c.id);
                  return (
                    <div key={c.id} className={`shrink-0 w-20 ${refused ? 'opacity-60' : ''}`} data-testid="sheet-photo" data-refused={refused ? '1' : '0'}>
                      <div className={`relative w-20 h-20 rounded-xl overflow-hidden border ${refused ? 'border-rose-400' : 'border-white/15'}`}>
                        <img src={c.thumb} alt={c.stepLabel || c.target || 'Photo'} className="w-full h-full object-cover" />
                        <span className="absolute bottom-0.5 right-0.5 rounded-full bg-black/70 p-0.5">
                          {st === 'fait' && <CheckCircle2 size={13} className="text-emerald-400" />}
                          {st === 'analyse' && <Loader2 size={13} className="animate-spin text-blue-300" />}
                          {st === 'attente' && <Clock size={13} className="text-amber-300" />}
                          {st === 'erreur' && <AlertTriangle size={13} className="text-red-400" />}
                        </span>
                      </div>
                      <p className={`mt-1 text-[11px] truncate ${refused ? 'text-rose-300' : 'text-white/70'}`}>{refused ? 'Refusée' : c.stepLabel || c.title || 'Photo'}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/60">Pas encore de photo de cet élément.</p>
            )}

            <div className="mt-3" data-testid="element-info">
              <p className="text-xs uppercase tracking-wider text-white/50 mb-1.5">Informations relevées</p>
              {sheetInfo.attrs.length > 0 || sheetInfo.score !== null ? (
                <dl className="rounded-xl bg-white/5 divide-y divide-white/5 text-sm">
                  {sheetInfo.attrs.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 px-3 py-2">
                      <dt className="text-white/60">{k}</dt>
                      <dd className="font-semibold text-right">{v}</dd>
                    </div>
                  ))}
                  {sheetInfo.score !== null && (
                    <div className="flex justify-between gap-3 px-3 py-2">
                      <dt className="text-white/60">État estimé</dt>
                      <dd className="font-semibold">{sheetInfo.score}/100</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-white/60">
                  {sheetInfo.pending ? '' : sheetCaptures.length ? 'Aucune information lue sur ces photos.' : 'Rien pour l’instant.'}
                </p>
              )}
              {sheetInfo.pending > 0 && (
                <p className="mt-2 text-sm text-blue-200 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Analyse en cours ({sheetInfo.pending} photo{sheetInfo.pending > 1 ? 's' : ''})…
                </p>
              )}
              {sheetInfo.failed > 0 && (
                <p className="mt-2 text-sm text-rose-300">{sheetInfo.failed} analyse{sheetInfo.failed > 1 ? 's' : ''} en échec (à relancer depuis l’inspection)</p>
              )}
              {sheetInfo.comments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {sheetInfo.comments.map((cm, i) => (
                    <p key={i} className="text-xs text-white/70 bg-white/5 rounded-lg px-3 py-2">{cm}</p>
                  ))}
                </div>
              )}
            </div>

            {sheetPoint && sheetPoint.status !== 'active' && (
              <button
                onClick={() => choosePoint(sheetPoint.id, true)}
                className="mt-4 w-full py-3 rounded-xl bg-white/10 font-semibold"
                data-testid="sheet-start"
              >
                {sheetPoint.status === 'done' ? 'Refaire cet élément' : 'Relever maintenant'}
              </button>
            )}
          </div>
        </div>
      )}

      {roomListOpen && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40" onClick={() => setRoomListOpen(false)}>
          <div
            className="rounded-t-3xl bg-slate-950/95 backdrop-blur-md border-t border-white/10 px-4 pt-4 pb-4 safe-bottom max-h-[65vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
            data-testid="room-list"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-bold text-lg truncate">{currentSpace || 'Pièce actuelle'}</p>
              <button onClick={() => setRoomListOpen(false)} className="p-2 rounded-full bg-white/10 shrink-0" aria-label="Fermer la liste">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-white/60 mb-3">
              {roomPoints.length
                ? `${roomDone}/${roomPoints.length} éléments faits · touchez un élément jaune pour le relever, vert pour voir ce qui a été relevé`
                : 'Rien de repéré pour l’instant : filmez la pièce, les repères apparaissent au fur et à mesure.'}
            </p>
            <ul className="space-y-1.5">
              {roomPoints.map(pt => {
                const isActive = pt.status === 'active';
                return (
                  <li key={pt.id}>
                    <button
                      onClick={() => {
                        if (pt.status === 'done' || isActive) {
                          setRoomListOpen(false);
                          setSheetPointId(pt.id);
                        } else {
                          choosePoint(pt.id, true);
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left ${isActive ? 'bg-amber-400/20 border border-amber-300/50' : 'bg-white/5 hover:bg-white/10'}`}
                      data-testid="room-item"
                      data-status={pt.status}
                    >
                      <span
                        className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs font-black border-2 border-white ${pt.status === 'done' ? 'bg-emerald-500' : pt.status === 'skipped' ? 'bg-slate-400' : 'bg-amber-400 text-slate-900'}`}
                      >
                        {pt.status === 'done' ? '✓' : pt.status === 'skipped' ? '–' : ''}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold truncate">{pt.label}</span>
                        {!sameText(pt.element, pt.label) && <span className="block text-xs text-white/55 truncate">{pt.element || pt.category}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-white/60">
                        {isActive ? 'en cours' : pt.status === 'done' ? `${pt.photos} photo${pt.photos > 1 ? 's' : ''} · voir` : pt.status === 'skipped' ? 'passé · reprendre' : 'à faire'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {showSetup && setupScreen}
    </div>
  );
};
