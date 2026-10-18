import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Pause, Play, Mic, MicOff, Flashlight, FlashlightOff, SunMedium, WifiOff, Loader2, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronRight, Sparkles, Sun, ZoomIn, ZoomOut, Focus, Hand, Clock, MapPin,
  Route, ArrowRight, Navigation, DoorOpen,
} from 'lucide-react';
import type { InspectionItem, QueueItem, SchemaDefinition } from '../types';
import { AI_COSTS, sortCategories } from '../constants';
import {
  ALL_ZONES, ALL_ZONES_LABEL, NON_VISUAL_CATEGORIES, buildChecklist, inProgressTargets, missingLines, recordedLines,
} from '../utils/checklist';
import { PARCOURS_STAGES, stageText } from '../utils/visit';
import { AiCallError, guideFrame, modelLabel, type AiMeta, type GuideResult } from '../services/aiService';
import { LOW_LIGHT_FILTER, grabJpeg, grayFrame, meanAbsDiff, meanLuma, smallGray } from '../services/videoFrames';
import { OrientationSource, TargetTracker, videoToScreen, type ARState } from '../services/arTracker';

// ------------------------------------------------------------------ réglages du guidage

const TICK_MS = 400;              // analyse locale de l'image (mouvement, luminosité)
const MIN_SEND_GAP_MS = 1800;     // au plus une image envoyée à l'IA toutes les ~2 s
const MAX_SEND_GAP_MS = 7000;     // même sans changement, on rafraîchit la consigne
const MOTION_STABLE = 6;          // différence moyenne (0-255) sous laquelle l'image est jugée stable
const NOVELTY_MIN = 9;            // différence avec la dernière image envoyée pour la juger « nouvelle »
const CAPTURE_GAP_MS = 3500;      // délai minimum entre deux photos automatiques
const SAME_TARGET_GAP_MS = 30000; // pas deux photos du même élément en 30 s
const PENDING_CAPTURE_MS = 5000;  // la photo demandée attend au plus 5 s que l'image soit stable
const OFFLINE_CAPTURE_GAP_MS = 8000;
const OFFLINE_RETRY_MS = 10000;
const GUIDE_MAX_SIDE = 768;       // image envoyée pour le guidage
const HD_MAX_SIDE = 1280;         // photo analysée en détail
const DARK_LUMA = 38;
const TRACK_EVERY_MS = 120;       // recalage du cadre par l'image

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
}

interface SpaceVisit {
  name: string;
  photos: number;
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

const newId = () => `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const fmtSeconds = (ms?: number) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const sameText = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === b.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const GuidedVisit: React.FC<Props> = ({
  schema, items, queue, isOffline, demoMode, userCoins, onSpendCoins, onCapture, onLeftoverSpeech, onClose,
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
  const [localHint, setLocalHint] = useState<'mouvement' | 'sombre' | null>(null);
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
  const netModeRef = useRef(netMode);
  netModeRef.current = netMode;
  const instructionRef = useRef<InstructionState | null>(null);
  instructionRef.current = instruction;
  const lightRef = useRef(light);
  lightRef.current = light;
  const showSetupRef = useRef(showSetup);
  showSetupRef.current = showSetup;

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

  // ---------------------------------------------------------------- thèmes et progression
  const themes = useMemo(() => sortCategories(Object.keys(schema)).filter(c => !NON_VISUAL_CATEGORIES.includes(c)), [schema]);
  const checklist = useMemo(() => buildChecklist(schema, items, theme, { visualOnly: true }), [schema, items, theme]);
  const themeLabel = theme === ALL_ZONES ? ALL_ZONES_LABEL : theme;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(t => (t === msg ? '' : t)), 2600);
  }, []);

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
      void video.play().catch(() => undefined);
    }
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
      await track.applyConstraints({ advanced: [{ torch: on } as any] });
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
      await track.applyConstraints({ advanced: [{ exposureCompensation: on ? caps.exposureCompensation.max : 0 } as any] });
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
  const enterSpace = useCallback((name: string) => {
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

  // ---------------------------------------------------------------- photo haute définition
  const doCapture = useCallback(async (target: string, origin: 'ai' | 'manuel' | 'auto') => {
    const video = videoRef.current;
    if (!video || capturingRef.current) return;
    if (propsRef.current.userCoins < AI_COSTS.IMAGE_ANALYSIS) {
      setBlockMsg(`Crédits insuffisants pour analyser une photo (${AI_COSTS.IMAGE_ANALYSIS} crédits).`);
      return;
    }
    const filter = lightRef.current === 'boost' ? LOW_LIGHT_FILTER : undefined;
    const hd = grabJpeg(video, HD_MAX_SIDE, 0.82, filter);
    const thumb = grabJpeg(video, 200, 0.6, filter);
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
      setCaptures(prev => [...prev, { id, target, thumb, at: now }]);
      setSpaces(prev => (prev.length ? [...prev.slice(0, -1), { ...prev[prev.length - 1], photos: prev[prev.length - 1].photos + 1 }] : prev));
      if (target && sameText(target, trackerRef.current.currentLabel)) trackerRef.current.clear();
      setFlashKey(k => k + 1);
      try {
        navigator.vibrate?.(60);
      } catch {
        /* pas de vibreur */
      }
      showToast(origin === 'auto' ? 'Photo enregistrée (hors réseau)' : `Photo prise${target ? ` : ${target}` : ''}`);
    } finally {
      capturingRef.current = false;
    }
  }, [showToast]);

  const requestCapture = useCallback((target: string) => {
    const now = Date.now();
    if (now - lastCaptureAtRef.current < CAPTURE_GAP_MS) return;
    const last = target ? targetTimesRef.current.get(target) : undefined;
    if (last && now - last < SAME_TARGET_GAP_MS) return;
    pendingCaptureRef.current = { target, until: now + PENDING_CAPTURE_MS };
    setPendingCapture(true);
  }, []);

  // ---------------------------------------------------------------- envoi d'une image au guidage
  const sendFrame = useCallback(async (small: Uint8ClampedArray | null) => {
    const video = videoRef.current;
    if (!video) return;
    const image = grabJpeg(video, GUIDE_MAX_SIDE, 0.6, lightRef.current === 'boost' ? LOW_LIGHT_FILTER : undefined);
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
      });
      failuresRef.current = 0;
      if (askNext) {
        requestNextRef.current = false;
        setAskingNext(false);
      }
      if (netModeRef.current === 'offline' && !propsRef.current.isOffline) {
        setNetMode('online');
        showToast('Réseau retrouvé : guidage réactivé');
      }
      setInstruction({ text: guide.instruction, detail: guide.detail, target: guide.target, quality: guide.sceneQuality, key: Date.now() });
      setSeenNow(guide.seen.map(s => s.subCategory));
      setLastMeta(meta);
      setStats(s => ({ ...s, frames: s.frames + 1, latencyTotal: s.latencyTotal + (meta?.latencyMs ?? 0) }));
      onSpaceSeen(guide.space);
      setSpaceDone(guide.spaceDone && guide.nextSpace ? guide.nextSpace : askNext && guide.nextSpace ? guide.nextSpace : null);

      // Surbrillance de l'élément visé
      const tracker = trackerRef.current;
      const label = guide.target || guide.instruction;
      if (guide.targetBox.length === 4) {
        const [ymin, xmin, ymax, xmax] = guide.targetBox;
        tracker.setTarget(
          { cx: (xmin + xmax) / 2000, cy: (ymin + ymax) / 2000, w: (xmax - xmin) / 1000, h: (ymax - ymin) / 1000 },
          label,
          poseAtSend,
          grayAtSend,
          videoDims,
        );
      } else if (!sameText(label, tracker.currentLabel)) {
        const d = guide.targetDirection;
        if (d === 'gauche' || d === 'droite' || d === 'haut' || d === 'bas' || d === 'derriere') tracker.setHint(d, label);
        else tracker.clear();
      }

      if (guide.capture && !pausedRef.current) requestCapture(guide.target);
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
  }, [onSpaceSeen, requestCapture, showToast]);

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
    setLocalHint(dark ? 'sombre' : movingSinceRef.current && now - movingSinceRef.current > 1500 ? 'mouvement' : null);

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
      if (stable && !dark && novelty > NOVELTY_MIN * 1.5 && now - lastCaptureAtRef.current > OFFLINE_CAPTURE_GAP_MS) {
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

    const render = () => {
      raf = requestAnimationFrame(render);
      const video = videoRef.current;
      const view = containerRef.current;
      const box = boxRef.current;
      const arrow = arrowRef.current;
      if (!video || !view || !box || !arrow || !video.videoWidth) return;
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
      const state: ARState = tracker.update(vdim, gray);

      if (state.kind === 'box') {
        const c = videoToScreen(state.box.cx, state.box.cy, vdim, { w: vw, h: vh });
        const w = Math.max(56, state.box.w * vdim.w * c.scale);
        const h = Math.max(56, state.box.h * vdim.h * c.scale);
        const onScreen = c.x > -w / 2 && c.x < vw + w / 2 && c.y > -h / 2 && c.y < vh + h / 2;
        if (onScreen) {
          box.style.display = 'block';
          box.style.transform = `translate(${c.x - w / 2}px, ${c.y - h / 2}px)`;
          box.style.width = `${w}px`;
          box.style.height = `${h}px`;
          box.classList.toggle('ar-weak', !state.confident);
          const lab = boxLabelRef.current;
          if (lab) {
            if (lab.textContent !== state.label) lab.textContent = state.label;
            // Étiquette toujours lisible : recalée dans l'écran, et dans le cadre s'il touche le haut
            lab.style.left = `${Math.max(-3, 8 - (c.x - w / 2))}px`;
            lab.style.bottom = c.y - h / 2 < 40 ? 'auto' : '';
            lab.style.top = c.y - h / 2 < 40 ? '6px' : '';
          }
          hide(arrow);
          return;
        }
        hide(box);
        return;
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
      if (state.kind === 'offscreen') {
        const c = videoToScreen(0.5 + state.dx, 0.5 + state.dy, vdim, { w: vw, h: vh });
        dx = c.x - vw / 2;
        dy = c.y - vh / 2;
        behind = state.behind;
        if (behind) dy = 0;
      } else {
        [dx, dy] = HINT_VECTOR[state.direction];
        behind = state.direction === 'derriere';
      }
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // Zone utile entre le haut (consigne) et le bas (commandes)
      const top = Math.min(240, vh * 0.32);
      const bottom = vh - Math.min(260, vh * 0.34);
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
      const text = behind ? `${state.label} · derrière vous` : state.label;
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
    return () => cancelAnimationFrame(raf);
  }, [phase, cameraState]);

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
    trackerRef.current.clear();
    lastSentAtRef.current = 0;
    if (changedMode || phase !== 'running') setStageIdx(0);
    if (phase !== 'running') {
      // iPhone : l'accès au gyroscope doit être demandé pendant ce toucher
      void OrientationSource.requestPermission().then(ok => {
        if (ok) orientationRef.current.start();
      });
      setPhase('running');
      setMicOn(speechSupported);
      setStats(s => ({ ...s, startedAt: Date.now() }));
      void startCamera();
    }
  };

  const askNextSpace = () => {
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
          {spaces.length > 0 && (
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Espaces parcourus</p>
              <ol className="space-y-1 text-sm">
                {spaces.map((s, i) => (
                  <li key={`${s.name}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{i + 1}. {s.name}</span>
                    <span className="text-slate-400 shrink-0">{s.photos} photo{s.photos > 1 ? 's' : ''}</span>
                  </li>
                ))}
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
  return (
    <div ref={containerRef} className="fixed inset-0 z-[300] bg-black text-white overflow-hidden select-none" data-testid="guided-visit">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={light === 'boost' ? { filter: LOW_LIGHT_FILTER } : undefined}
        playsInline
        muted
        autoPlay
      />
      {flashKey > 0 && <div key={flashKey} className="absolute inset-0 bg-white pointer-events-none capture-flash" />}

      {/* Surbrillance de l'élément visé (positionnée image par image) */}
      <div ref={boxRef} className="ar-box" style={{ display: 'none' }} data-testid="ar-box">
        <span ref={boxLabelRef} className="ar-label" />
      </div>
      <div ref={arrowRef} className="ar-arrow" style={{ display: 'none' }} data-testid="ar-arrow">
        <div ref={arrowIconRef} className="ar-arrow-icon"><Navigation size={20} style={{ transform: 'rotate(45deg)' }} /></div>
        <span ref={arrowLabelRef} className="ar-arrow-label" />
      </div>

      {/* Haut : fermer, mode, lampe, micro */}
      <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-3 pb-6 safe-top">
        <div className="flex items-center gap-2">
          <button onClick={finishVisit} className="p-2.5 rounded-full bg-black/40 hover:bg-black/60" aria-label="Terminer la visite">
            <X size={22} />
          </button>
          <button
            onClick={() => setShowSetup(true)}
            className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/40 hover:bg-black/60 text-sm font-semibold"
          >
            {mode === 'parcours' ? <Route size={16} className="shrink-0 text-emerald-300" /> : <MapPin size={16} className="shrink-0 text-blue-300" />}
            <span className="truncate">{mode === 'parcours' ? 'Parcours guidé' : 'Visite libre'} · {theme === ALL_ZONES ? 'Tout' : theme}</span>
            <ChevronDown size={16} className="shrink-0 opacity-70" />
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
              onClick={() => { setMicMsg(''); micErrorsRef.current = 0; setMicOn(m => !m); }}
              className={`p-2.5 rounded-full ${micOn ? 'bg-rose-500' : 'bg-black/40'}`}
              aria-label={micOn ? 'Couper la dictée' : 'Activer la dictée'}
            >
              {micOn ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
          )}
        </div>

        {/* Progression */}
        <div className="mt-3 px-1">
          <div className="flex justify-between text-[11px] font-medium text-white/80 mb-1">
            <span>{checklist.done}/{checklist.total} éléments complets</span>
            <span className="flex items-center gap-1.5">
              {demoMode && <span className="px-1.5 py-0.5 rounded bg-purple-500/80 text-white">IA simulée</span>}
              {!demoMode && lastMeta && <span>{modelLabel(lastMeta.model)} · {fmtSeconds(lastMeta.latencyMs)}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          {mode === 'parcours' && (
            <div className="mt-2 flex items-center gap-2 text-xs" data-testid="stage-line">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/25 text-emerald-200 font-semibold shrink-0">
                Étape {stageIdx + 1}/{PARCOURS_STAGES.length}
              </span>
              <span className="truncate text-white/85">{PARCOURS_STAGES[stageIdx].label}</span>
              {stageIdx < PARCOURS_STAGES.length - 1 && (
                <button onClick={nextStage} className="ml-auto shrink-0 flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-white/15 font-semibold">
                  Étape suivante <ChevronRight size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {offline && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/90 text-black px-3 py-2 text-sm font-semibold" data-testid="offline-banner">
            <WifiOff size={18} className="shrink-0 mt-0.5" />
            <span>Hors réseau : chaque nouvelle scène stable est photographiée et sera analysée au retour du réseau.</span>
          </div>
        )}

        {/* Consigne */}
        {!offline && (
          <div className="mt-3" aria-live="polite">
            {askingNext ? (
              <div className="rounded-2xl bg-black/60 backdrop-blur-md px-4 py-3 flex items-center gap-3">
                <Loader2 size={20} className="animate-spin text-blue-300" />
                <p className="text-lg font-semibold">Je regarde où aller ensuite…</p>
              </div>
            ) : instruction ? (
              <div key={instruction.key} className="guide-pop rounded-2xl bg-black/60 backdrop-blur-md border border-white/10 px-4 py-3 shadow-2xl" data-testid="guide-instruction">
                <div className="flex items-start gap-3">
                  <QualityIcon size={22} className="text-blue-300 shrink-0 mt-1" />
                  <div className="min-w-0">
                    <p className="text-[22px] leading-tight font-bold">{instruction.text}</p>
                    {instruction.detail && <p className="mt-1 text-sm text-white/75">{instruction.detail}</p>}
                  </div>
                </div>
                {seenNow.length > 0 && (
                  <p className="mt-2 text-xs text-emerald-200/90 truncate">Vu : {seenNow.join(' · ')}</p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-black/50 backdrop-blur-md px-4 py-3 flex items-center gap-3">
                <Loader2 size={20} className="animate-spin text-blue-300" />
                <p className="text-lg font-semibold">
                  {cameraState === 'ready' ? (mode === 'parcours' ? 'Je prépare le parcours…' : 'Je regarde où vous êtes…') : 'Ouverture de la caméra…'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Milieu : indications locales */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 pointer-events-none px-6">
        {pendingCapture && (
          <div className="px-4 py-2 rounded-full bg-white text-black font-bold text-base flex items-center gap-2 shadow-xl">
            <Hand size={18} /> Ne bougez plus…
          </div>
        )}
        {!pendingCapture && localHint === 'mouvement' && !offline && (
          <div className="px-4 py-2 rounded-full bg-black/60 text-white font-semibold text-sm">Ralentissez pour que l'IA voie bien</div>
        )}
        {localHint === 'sombre' && (
          <div className="px-4 py-2 rounded-full bg-amber-400 text-black font-semibold text-sm flex items-center gap-2">
            <Sun size={16} /> Image sombre : touchez la lampe en haut
          </div>
        )}
        {(paused || blockMsg) && (
          <div className="px-5 py-3 rounded-2xl bg-black/75 text-center max-w-sm pointer-events-auto">
            <p className="font-bold">{blockMsg ? 'Guidage interrompu' : 'Visite en pause'}</p>
            {blockMsg && <p className="text-sm text-white/80 mt-1">{blockMsg}</p>}
            {blockMsg && (
              <button onClick={() => setBlockMsg('')} className="mt-3 px-4 py-2 rounded-full bg-white/15 text-sm font-semibold">
                Réessayer
              </button>
            )}
          </div>
        )}
      </div>

      {cameraState === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/85">
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

      {/* Bas : dictée, espace, photos, commandes */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent pt-10 safe-bottom">
        {(interim || lastSpoken || micMsg) && (
          <p className="px-4 mb-2 text-sm text-white/85 italic truncate">
            {micMsg ? micMsg : `« ${interim || lastSpoken} »`}
          </p>
        )}
        {toast && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-emerald-500/90 text-black text-sm font-semibold truncate" data-testid="guided-toast">{toast}</div>
        )}
        {spaceDone && !offline && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-blue-600/90 text-white text-sm font-semibold flex items-center gap-2" data-testid="space-done">
            <DoorOpen size={16} className="shrink-0" />
            <span className="truncate">Ensuite : {spaceDone}</span>
          </div>
        )}

        <div className="flex items-center gap-2 px-4 mb-3">
          <span className="min-w-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 text-sm font-semibold" data-testid="space-chip">
            <MapPin size={14} className="shrink-0 text-blue-300" />
            <span className="truncate">{currentSpace || 'Lieu en cours d’identification'}</span>
            {currentSpace && <span className="text-white/60 font-normal shrink-0">· {spacePhotos} photo{spacePhotos > 1 ? 's' : ''}</span>}
          </span>
          <button
            onClick={askNextSpace}
            disabled={askingNext || offline || cameraState !== 'ready'}
            className={`ml-auto shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold ${spaceDone ? 'bg-blue-500 text-white' : 'bg-white/15 text-white'} disabled:opacity-40`}
            data-testid="next-space"
          >
            Pièce suivante <ArrowRight size={15} />
          </button>
        </div>

        {captures.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide" data-testid="capture-strip">
            {[...captures].reverse().map(c => {
              const st = captureStatus(c.id);
              return (
                <div key={c.id} className="relative shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-white/20">
                  <img src={c.thumb} alt={c.target || 'Photo'} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0.5 right-0.5 rounded-full bg-black/70 p-0.5">
                    {st === 'fait' && <CheckCircle2 size={13} className="text-emerald-400" />}
                    {st === 'analyse' && <Loader2 size={13} className="animate-spin text-blue-300" />}
                    {st === 'attente' && <Clock size={13} className="text-amber-300" />}
                    {st === 'erreur' && <AlertTriangle size={13} className="text-red-400" />}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between px-6">
          <button
            onClick={() => setPaused(p => !p)}
            className="w-14 h-14 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center"
            aria-label={paused ? 'Reprendre' : 'Pause'}
          >
            {paused ? <Play size={24} /> : <Pause size={24} />}
          </button>

          <button
            onClick={() => void doCapture(instruction?.target ?? '', 'manuel')}
            disabled={cameraState !== 'ready'}
            className={`w-20 h-20 rounded-full border-4 border-white flex items-center justify-center ${waiting ? 'pulse-ring' : ''} disabled:opacity-40`}
            aria-label="Prendre une photo"
            data-testid="shutter"
          >
            <span className="w-16 h-16 rounded-full bg-white" />
          </button>

          <button onClick={finishVisit} className="h-14 px-4 rounded-full bg-white/15 hover:bg-white/25 text-sm font-bold">
            Terminer
          </button>
        </div>
        <p className="text-center text-[11px] text-white/60 mt-2">
          {captures.length} photo{captures.length > 1 ? 's' : ''} · {doneCount} analysée{doneCount > 1 ? 's' : ''}
        </p>
      </div>

      {showSetup && setupScreen}
    </div>
  );
};
