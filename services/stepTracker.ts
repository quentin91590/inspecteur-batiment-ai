// Parcours relatif pendant la visite (comme les applis de métro) : on compte les pas avec l'accéléromètre
// et on prend la direction de marche donnée par l'orientation du téléphone.
// Position en mètres depuis le début de la visite : x vers l'« est » du repère, y vers le « nord », z vers le haut.
// L'erreur grandit en marchant (quelques % de la distance) : la maquette qui en sort est schématique.

import type { CameraPose } from './arTracker';

export interface StepOptions {
  /** Longueur d'un pas (m) */
  stepLength?: number;
  /** Écart minimal entre deux pas (ms) */
  minInterval?: number;
}

/** Cap de marche (radians, 0 = +y, sens horaire) d'après l'orientation du téléphone. */
export function headingOf(pose: CameraPose): number | null {
  // Téléphone tenu devant soi : on suit l'axe de la caméra ; s'il vise le sol, on suit le haut de l'écran
  const f = pose.forward;
  const u = pose.up;
  const fh = Math.hypot(f[0], f[1]);
  const uh = Math.hypot(u[0], u[1]);
  if (fh >= 0.45) return Math.atan2(f[0], f[1]);
  if (uh >= 0.45) return Math.atan2(u[0], u[1]);
  return null;
}

/**
 * Détecteur de pas sur la norme de l'accélération (gravité comprise) :
 * pic au-dessus de la ligne de base puis redescente = un pas.
 */
export class StepDetector {
  private base = 9.81;
  private filtered = 9.81;
  private inPeak = false;
  private peak = 0;
  private lastStepAt = -Infinity;
  steps = 0;

  constructor(private minInterval = 300) {}

  /** Renvoie true si un pas vient d'être détecté. t en ms. */
  push(ax: number, ay: number, az: number, t: number): boolean {
    const m = Math.hypot(ax, ay, az);
    if (!Number.isFinite(m)) return false;
    this.filtered = this.filtered * 0.75 + m * 0.25;
    this.base = this.base * 0.985 + m * 0.015; // gravité et biais du capteur
    const d = this.filtered - this.base;
    if (!this.inPeak && d > 0.9) {
      this.inPeak = true;
      this.peak = d;
    } else if (this.inPeak) {
      this.peak = Math.max(this.peak, d);
      if (d < 0.25) {
        this.inPeak = false;
        if (this.peak > 1.1 && t - this.lastStepAt > this.minInterval && this.peak < 12) {
          this.lastStepAt = t;
          this.steps++;
          return true;
        }
      }
    }
    return false;
  }
}

export class StepTracker {
  private detector: StepDetector;
  private stepLength: number;
  private heading: number | null = null;
  private x = 0;
  private y = 0;
  private listeners: ((p: { x: number; y: number }) => void)[] = [];
  private handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    if (this.detector.push(a.x, a.y, a.z, performance.now())) this.onStep();
  };

  constructor(private poseOf: () => CameraPose | null, opts: StepOptions = {}) {
    this.detector = new StepDetector(opts.minInterval ?? 300);
    this.stepLength = opts.stepLength ?? 0.68;
  }

  /** iPhone : l'accès aux capteurs de mouvement doit être demandé pendant un geste de l'utilisateur. */
  static async requestPermission(): Promise<boolean> {
    const DME: any = typeof window !== 'undefined' ? (window as any).DeviceMotionEvent : undefined;
    if (!DME) return false;
    if (typeof DME.requestPermission === 'function') {
      try {
        return (await DME.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  start(): void {
    window.addEventListener('devicemotion', this.handler);
  }

  stop(): void {
    window.removeEventListener('devicemotion', this.handler);
  }

  get steps(): number {
    return this.detector.steps;
  }

  position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /** Recalage (élément connu revu) : on corrige la position estimée. */
  correct(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  onMove(cb: (p: { x: number; y: number }) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  /** Un pas : on avance dans la direction de marche (dernière connue si le téléphone vise le sol ou le plafond). */
  onStep(): void {
    const pose = this.poseOf();
    const h = pose ? headingOf(pose) : null;
    if (h !== null) this.heading = h;
    if (this.heading === null) return;
    this.x += Math.sin(this.heading) * this.stepLength;
    this.y += Math.cos(this.heading) * this.stepLength;
    const p = { x: this.x, y: this.y };
    this.listeners.forEach(l => l(p));
  }
}
