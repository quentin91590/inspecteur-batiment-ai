import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Pause, Play, Mic, MicOff, Flashlight, FlashlightOff, WifiOff, Loader2, CheckCircle2,
  AlertTriangle, ChevronDown, Sparkles, Sun, ZoomIn, ZoomOut, Focus, Video, Hand, Clock, Layers,
} from 'lucide-react';
import type { InspectionItem, QueueItem, SchemaDefinition } from '../types';
import { AI_COSTS, sortCategories } from '../constants';
import { ALL_ZONES, ALL_ZONES_LABEL, buildChecklist, inProgressTargets, missingLines } from '../utils/checklist';
import { AiCallError, guideFrame, modelLabel, type AiMeta, type GuideResult } from '../services/aiService';
import { grabJpeg, meanAbsDiff, meanLuma, smallGray } from '../services/videoFrames';

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

type CameraState = 'idle' | 'starting' | 'ready' | 'error';

const QUALITY_ICON: Record<GuideResult['sceneQuality'], React.ElementType> = {
  ok: Sparkles,
  sombre: Sun,
  flou: Focus,
  loin: ZoomIn,
  proche: ZoomOut,
  hors_sujet: AlertTriangle,
};

const newId = () => `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const fmtSeconds = (ms?: number) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);

export const GuidedVisit: React.FC<Props> = ({
  schema, items, queue, isOffline, demoMode, userCoins, onSpendCoins, onCapture, onLeftoverSpeech, onClose,
}) => {
  // ---------------------------------------------------------------- état affiché
  const [phase, setPhase] = useState<'zone' | 'running' | 'summary'>('zone');
  const [showZonePicker, setShowZonePicker] = useState(false);
  const [zone, setZone] = useState<string>(ALL_ZONES);
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
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [netMode, setNetMode] = useState<'online' | 'offline'>(isOffline ? 'offline' : 'online');
  const [waiting, setWaiting] = useState(false);
  const [lastMeta, setLastMeta] = useState<AiMeta | undefined>();
  const [stats, setStats] = useState({ frames: 0, latencyTotal: 0, startedAt: 0, endedAt: 0 });

  // ---------------------------------------------------------------- références (lues par la boucle)
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const micActiveRef = useRef(false);
  const micErrorsRef = useRef(0);
  const wakeLockRef = useRef<any>(null);

  const propsRef = useRef({ schema, items, queue, userCoins, isOffline });
  propsRef.current = { schema, items, queue, userCoins, isOffline };
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const pausedRef = useRef(paused);
  pausedRef.current = paused || showZonePicker || !!blockMsg;
  const netModeRef = useRef(netMode);
  netModeRef.current = netMode;
  const instructionRef = useRef<InstructionState | null>(null);
  instructionRef.current = instruction;

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

  // ---------------------------------------------------------------- zones et progression
  const zones = useMemo(() => sortCategories(Object.keys(schema)), [schema]);
  const checklist = useMemo(() => buildChecklist(schema, items, zone), [schema, items, zone]);
  const zoneLabel = zone === ALL_ZONES ? ALL_ZONES_LABEL : zone;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(t => (t === msg ? '' : t)), 2600);
  }, []);

  // ---------------------------------------------------------------- caméra
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCameraState('starting');
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      const track = stream.getVideoTracks()[0];
      const caps: any = track?.getCapabilities?.() ?? {};
      setTorchSupported(!!caps.torch);
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

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as any] });
      setTorchOn(!torchOn);
    } catch {
      showToast('Lampe indisponible sur cet appareil');
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

  // ---------------------------------------------------------------- écran allumé
  useEffect(() => {
    if (phase !== 'running') return;
    (navigator as any).wakeLock?.request?.('screen').then((l: any) => (wakeLockRef.current = l)).catch(() => undefined);
    return () => {
      wakeLockRef.current?.release?.().catch?.(() => undefined);
      wakeLockRef.current = null;
    };
  }, [phase]);

  // Fermeture du composant : tout couper
  useEffect(() => () => { stopCamera(); stopSpeech(); }, [stopCamera, stopSpeech]);

  // Réseau du navigateur
  useEffect(() => {
    if (isOffline) setNetMode('offline');
  }, [isOffline]);

  // ---------------------------------------------------------------- photo haute définition
  const doCapture = useCallback(async (target: string, origin: 'ai' | 'manuel' | 'auto') => {
    const video = videoRef.current;
    if (!video || capturingRef.current) return;
    if (propsRef.current.userCoins < AI_COSTS.IMAGE_ANALYSIS) {
      setBlockMsg(`Crédits insuffisants pour analyser une photo (${AI_COSTS.IMAGE_ANALYSIS} crédits).`);
      return;
    }
    const hd = grabJpeg(video, HD_MAX_SIDE, 0.82);
    const thumb = grabJpeg(video, 200, 0.6);
    if (!hd || !thumb) return;
    capturingRef.current = true;
    const id = newId();
    const note = speechSinceCaptureRef.current.trim();
    speechSinceCaptureRef.current = '';
    try {
      const ok = await onCapture({ id, imageBase64: hd, note, target });
      if (!ok) {
        speechSinceCaptureRef.current = `${note} ${speechSinceCaptureRef.current}`.trim();
        return;
      }
      const now = Date.now();
      lastCaptureAtRef.current = now;
      lastCaptureSmallRef.current = smallGray(video);
      if (target) targetTimesRef.current.set(target, now);
      setCaptures(prev => [...prev, { id, target, thumb, at: now }]);
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
  }, [onCapture, showToast]);

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
    const image = grabJpeg(video, GUIDE_MAX_SIDE, 0.6);
    if (!image) return;

    inFlightRef.current = true;
    lastSentAtRef.current = Date.now();
    lastSentSmallRef.current = small;
    setWaiting(true);

    const { schema: sch, items: its, queue: q } = propsRef.current;
    const list = buildChecklist(sch, its, zoneRef.current);
    const recentTargets = capturesRef.current.filter(c => c.target && Date.now() - c.at < 120_000).map(c => c.target);
    const transcript = speechBufferRef.current;
    speechBufferRef.current = '';

    try {
      const { guide, meta } = await guideFrame({
        image,
        schema: sch,
        zone: zoneRef.current === ALL_ZONES ? ALL_ZONES_LABEL : zoneRef.current,
        missing: missingLines(list),
        inProgress: Array.from(new Set([...inProgressTargets(q), ...recentTargets])),
        transcript,
        lastInstruction: instructionRef.current?.text,
      });
      failuresRef.current = 0;
      if (netModeRef.current === 'offline' && !propsRef.current.isOffline) {
        setNetMode('online');
        showToast('Réseau retrouvé : guidage réactivé');
      }
      setInstruction({ text: guide.instruction, detail: guide.detail, target: guide.target, quality: guide.sceneQuality, key: Date.now() });
      setSeenNow(guide.seen.map(s => s.subCategory));
      setLastMeta(meta);
      setStats(s => ({ ...s, frames: s.frames + 1, latencyTotal: s.latencyTotal + (meta?.latencyMs ?? 0) }));
      if (guide.capture && !pausedRef.current) requestCapture(guide.target);
    } catch (err) {
      speechBufferRef.current = `${transcript} ${speechBufferRef.current}`.trim();
      if (err instanceof AiCallError) {
        if (err.kind === 'network') {
          failuresRef.current++;
          if (failuresRef.current >= 2 && netModeRef.current !== 'offline') {
            setNetMode('offline');
          }
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
  }, [requestCapture, showToast]);

  // ---------------------------------------------------------------- boucle principale
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
    const dark = meanLuma(small) < DARK_LUMA;
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
      // Essai régulier pour détecter le retour du réseau
      if (navigator.onLine && !inFlightRef.current && now - lastSentAtRef.current > OFFLINE_RETRY_MS) {
        void sendFrame(small);
      }
      return;
    }

    if (inFlightRef.current) return;
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

  // ---------------------------------------------------------------- crédits par minute de guidage
  const chargeMinute = useCallback(async () => {
    if (propsRef.current.userCoins < AI_COSTS.GUIDED_MINUTE) {
      setBlockMsg(`Crédits insuffisants pour poursuivre le guidage (${AI_COSTS.GUIDED_MINUTE} crédits par minute).`);
      return;
    }
    const ok = await onSpendCoins(AI_COSTS.GUIDED_MINUTE);
    if (!ok) setBlockMsg('Crédits insuffisants pour poursuivre le guidage.');
  }, [onSpendCoins]);

  // Une minute est due dès qu'elle commence ; une pause ne remet pas le compteur à zéro.
  const lastChargeAtRef = useRef(0);
  const guidanceActive = phase === 'running' && cameraState === 'ready' && !paused && !showZonePicker && !blockMsg && netMode === 'online';
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

  // Branche le flux caméra sur la vidéo dès qu'elle est affichée
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
  }, [phase, cameraState]);

  // ---------------------------------------------------------------- actions
  const beginVisit = (z: string) => {
    setZone(z);
    setShowZonePicker(false);
    setInstruction(null);
    lastSentAtRef.current = 0;
    if (phase !== 'running') {
      setPhase('running');
      setMicOn(speechSupported);
      setStats(s => ({ ...s, startedAt: Date.now() }));
      void startCamera();
    }
  };

  const finishVisit = () => {
    const leftover = (speechSinceCaptureRef.current || '').trim();
    speechSinceCaptureRef.current = '';
    if (leftover) onLeftoverSpeech(leftover);
    stopSpeech();
    stopCamera();
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

  // ---------------------------------------------------------------- rendu : choix de la zone
  const zonePicker = (
    <div className="fixed inset-0 z-[320] bg-slate-950/95 text-white flex flex-col safe-top safe-bottom" data-testid="zone-picker">
      <div className="flex items-center justify-between px-4 pb-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-blue-300 font-semibold">Visite guidée</p>
          <h2 className="text-xl font-bold">Quelle zone visitez-vous ?</h2>
        </div>
        <button
          onClick={() => (phase === 'zone' ? onClose() : setShowZonePicker(false))}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20"
          aria-label="Fermer"
        >
          <X size={22} />
        </button>
      </div>
      <p className="px-4 text-sm text-slate-300 mb-3">
        L'IA vous guidera vers les éléments du référentiel qui manquent encore dans cette zone.
      </p>
      <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-4">
        {[ALL_ZONES, ...zones].map(z => {
          const cl = buildChecklist(schema, items, z);
          const complete = cl.total > 0 && cl.done === cl.total;
          const active = z === zone && phase === 'running';
          return (
            <button
              key={z}
              onClick={() => beginVisit(z)}
              className={`w-full flex items-center justify-between gap-3 p-4 rounded-2xl border text-left transition-colors ${
                active ? 'bg-blue-600 border-blue-400' : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                {z === ALL_ZONES ? <Layers size={20} className="text-blue-300 shrink-0" /> : complete ? <CheckCircle2 size={20} className="text-emerald-400 shrink-0" /> : <Video size={20} className="text-slate-300 shrink-0" />}
                <span className="font-semibold truncate">{z === ALL_ZONES ? ALL_ZONES_LABEL : z}</span>
              </span>
              <span className={`text-sm shrink-0 ${complete ? 'text-emerald-300' : 'text-slate-300'}`}>
                {cl.done}/{cl.total}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  if (phase === 'zone') return zonePicker;

  // ---------------------------------------------------------------- rendu : bilan
  if (phase === 'summary') {
    const duration = Math.max(0, Math.round(((stats.endedAt || Date.now()) - stats.startedAt) / 60000));
    const avg = stats.frames ? stats.latencyTotal / stats.frames : undefined;
    const waitingCount = captures.length - doneCount;
    return (
      <div className="fixed inset-0 z-[320] bg-slate-950 text-white flex flex-col items-center justify-center p-6 safe-top safe-bottom" data-testid="guided-summary">
        <div className="w-full max-w-sm space-y-5">
          <div className="text-center space-y-2">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 size={30} className="text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold">Visite terminée</h2>
            <p className="text-slate-300 text-sm">{zoneLabel}</p>
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
  return (
    <div className="fixed inset-0 z-[300] bg-black text-white overflow-hidden select-none" data-testid="guided-visit">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted autoPlay />
      {flashKey > 0 && <div key={flashKey} className="absolute inset-0 bg-white pointer-events-none capture-flash" />}

      {/* Haut : fermer, zone, état */}
      <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-3 pb-6 safe-top">
        <div className="flex items-center gap-2">
          <button onClick={finishVisit} className="p-2.5 rounded-full bg-black/40 hover:bg-black/60" aria-label="Terminer la visite">
            <X size={22} />
          </button>
          <button
            onClick={() => setShowZonePicker(true)}
            className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/40 hover:bg-black/60 text-sm font-semibold"
          >
            <span className="truncate">{zoneLabel}</span>
            <ChevronDown size={16} className="shrink-0 opacity-70" />
          </button>
          {torchSupported && (
            <button onClick={toggleTorch} className={`p-2.5 rounded-full ${torchOn ? 'bg-amber-400 text-black' : 'bg-black/40'}`} aria-label="Lampe">
              {torchOn ? <Flashlight size={20} /> : <FlashlightOff size={20} />}
            </button>
          )}
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

        {/* Progression de la zone */}
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
            {instruction ? (
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
                  {cameraState === 'ready' ? 'Filmez la zone lentement…' : 'Ouverture de la caméra…'}
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
            <Sun size={16} /> Image sombre{torchSupported ? ' : allumez la lampe' : ''}
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

      {/* Bas : dictée, photos, commandes */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent pt-10 safe-bottom">
        {(interim || lastSpoken || micMsg) && (
          <p className="px-4 mb-2 text-sm text-white/85 italic truncate">
            {micMsg ? micMsg : `« ${interim || lastSpoken} »`}
          </p>
        )}
        {toast && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-emerald-500/90 text-black text-sm font-semibold truncate" data-testid="guided-toast">{toast}</div>
        )}

        {captures.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide" data-testid="capture-strip">
            {[...captures].reverse().map(c => {
              const st = captureStatus(c.id);
              return (
                <div key={c.id} className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-white/20">
                  <img src={c.thumb} alt={c.target || 'Photo'} className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 right-1 rounded-full bg-black/70 p-0.5">
                    {st === 'fait' && <CheckCircle2 size={14} className="text-emerald-400" />}
                    {st === 'analyse' && <Loader2 size={14} className="animate-spin text-blue-300" />}
                    {st === 'attente' && <Clock size={14} className="text-amber-300" />}
                    {st === 'erreur' && <AlertTriangle size={14} className="text-red-400" />}
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

          <button
            onClick={finishVisit}
            className="h-14 px-4 rounded-full bg-white/15 hover:bg-white/25 text-sm font-bold"
          >
            Terminer
          </button>
        </div>
        <p className="text-center text-[11px] text-white/60 mt-2">
          {captures.length} photo{captures.length > 1 ? 's' : ''} · {doneCount} analysée{doneCount > 1 ? 's' : ''}
        </p>
      </div>

      {showZonePicker && zonePicker}
    </div>
  );
};
