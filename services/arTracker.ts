// Surbrillance « réalité augmentée » de l'élément visé.
// Entre deux réponses de l'IA (toutes les ~2 s), le cadre est maintenu à l'écran par :
//  1. l'orientation du téléphone (gyroscope / boussole) : le cadre reste « accroché » à sa direction quand on tourne,
//  2. une recherche d'image locale (corrélation) : recale le cadre sur l'élément quand on se déplace.
// Quand l'élément sort de l'écran, on indique de quel côté il se trouve.

export type Vec3 = [number, number, number];

/** Axes de la caméra dans le repère terrestre au moment de la mesure. */
export interface CameraPose {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

/** Position dans l'image vidéo complète (0-1). */
export interface NormBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface GrayFrame {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export type ARState =
  | { kind: 'none' }
  | { kind: 'box'; box: NormBox; label: string; confident: boolean }
  | { kind: 'offscreen'; dx: number; dy: number; behind: boolean; label: string }
  | { kind: 'hint'; direction: 'gauche' | 'droite' | 'haut' | 'bas' | 'derriere'; label: string };

const DEG = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Angle (degrés) entre deux directions. */
export const angleBetween = (a: Vec3, b: Vec3): number => Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) / DEG;
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ------------------------------------------------------------------ orientation du téléphone

/** Pose de la caméra arrière à partir des angles deviceorientation (W3C : R = Rz(α)·Rx(β)·Ry(γ)). */
export function poseFromAngles(alphaDeg: number, betaDeg: number, gammaDeg: number, screenAngleDeg = 0): CameraPose {
  const a = alphaDeg * DEG, b = betaDeg * DEG, g = gammaDeg * DEG;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  const X: Vec3 = [cA * cG - sA * sB * sG, sA * cG + cA * sB * sG, -cB * sG];
  const Y: Vec3 = [-sA * cB, cA * cB, sB];
  const Z: Vec3 = [cA * sG + sA * sB * cG, sA * sG - cA * sB * cG, cB * cG];
  const forward = scale(Z, -1); // la caméra arrière regarde « dans » l'écran
  const angle = ((Math.round(screenAngleDeg / 90) * 90) % 360 + 360) % 360;
  if (angle === 90) return { right: scale(Y, -1), up: X, forward };
  if (angle === 180) return { right: scale(X, -1), up: scale(Y, -1), forward };
  if (angle === 270) return { right: Y, up: scale(X, -1), forward };
  return { right: X, up: Y, forward };
}

/** Moyenne pondérée de deux directions (a compte pour wA, b pour 1), renormalisée. */
export const blendDir = (a: Vec3, b: Vec3, wA: number): Vec3 => norm(add(scale(a, wA), b));

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class OrientationSource {
  // Pose lissée de l'appareil (écran en portrait) : les capteurs tremblent, surtout la boussole ;
  // un lissage léger stabilise les repères sans retard perceptible.
  private smooth: { x: Vec3; y: Vec3; at: number } | null = null;
  private handler = (e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    const raw = poseFromAngles(e.alpha, e.beta, e.gamma, 0);
    const now = Date.now();
    const prev = this.smooth;
    if (!prev || now - prev.at > 500) {
      this.smooth = { x: raw.right, y: raw.up, at: now };
      return;
    }
    // Grand saut (recalage de la boussole) : on suit plus vite ; petit tremblement : on lisse fort
    const jump = angleBetween(prev.y, raw.up) + angleBetween(prev.x, raw.right);
    const k = jump > 20 ? 0.6 : 0.3;
    const x = norm(add(scale(prev.x, 1 - k), raw.right, k));
    const yRaw = add(scale(prev.y, 1 - k), raw.up, k);
    const y = norm(add(yRaw, x, -dot(yRaw, x))); // orthogonal à x
    this.smooth = { x, y, at: now };
  };

  /** iPhone : l'accès aux capteurs doit être demandé pendant un geste de l'utilisateur. */
  static async requestPermission(): Promise<boolean> {
    const DOE: any = typeof window !== 'undefined' ? (window as any).DeviceOrientationEvent : undefined;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        return (await DOE.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  start(): void {
    window.addEventListener('deviceorientation', this.handler);
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.handler);
  }

  /** Pose actuelle, ou null si le téléphone ne fournit pas (ou plus) son orientation. */
  pose(): CameraPose | null {
    const s = this.smooth;
    if (!s || Date.now() - s.at > 1500) return null;
    const X = s.x;
    const Y = s.y;
    const forward = scale(cross(X, Y), -1); // la caméra arrière regarde « dans » l'écran (−Z)
    const screenAngle = (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;
    const angle = ((Math.round(screenAngle / 90) * 90) % 360 + 360) % 360;
    if (angle === 90) return { right: scale(Y, -1), up: X, forward };
    if (angle === 180) return { right: scale(X, -1), up: scale(Y, -1), forward };
    if (angle === 270) return { right: Y, up: scale(X, -1), forward };
    return { right: X, up: Y, forward };
  }
}

// ------------------------------------------------------------------ projection caméra

/**
 * Champs de vision (radians) de l'image vidéo : ~66° sur le grand côté d'un capteur de téléphone,
 * divisé par le zoom de la caméra (zoom matériel : l'image vidéo elle-même est agrandie).
 */
export function fieldOfView(videoW: number, videoH: number, zoom = 1, longSideDeg = 66): { h: number; v: number } {
  const t = Math.tan((longSideDeg * DEG) / 2) / Math.max(0.25, zoom);
  const long = 2 * Math.atan(t);
  if (videoW >= videoH) return { h: long, v: 2 * Math.atan((t * videoH) / videoW) };
  return { h: 2 * Math.atan((t * videoW) / videoH), v: long };
}

export function unproject(cx: number, cy: number, pose: CameraPose, fov: { h: number; v: number }): Vec3 {
  const x = (cx - 0.5) * 2 * Math.tan(fov.h / 2);
  const y = -(cy - 0.5) * 2 * Math.tan(fov.v / 2);
  return norm(add(add(pose.forward, pose.right, x), pose.up, y));
}

export function project(dir: Vec3, pose: CameraPose, fov: { h: number; v: number }): { cx: number; cy: number; behind: boolean } {
  const x = dot(dir, pose.right);
  const y = dot(dir, pose.up);
  const z = dot(dir, pose.forward);
  if (z < 0.05) {
    // Derrière : on garde le côté (gauche/droite, haut/bas) pour orienter la flèche
    return { cx: 0.5 + Math.sign(x || 1) * 10, cy: 0.5 - y * 2, behind: true };
  }
  return {
    cx: 0.5 + x / z / (2 * Math.tan(fov.h / 2)),
    cy: 0.5 - y / z / (2 * Math.tan(fov.v / 2)),
    behind: false,
  };
}

// ------------------------------------------------------------------ recherche d'image (corrélation normalisée)

export class TemplateMatcher {
  private tpl: Float32Array | null = null;
  private tw = 0;
  private th = 0;
  private tplNorm = 0;

  clear(): void {
    this.tpl = null;
  }

  get ready(): boolean {
    return this.tpl !== null;
  }

  /** Mémorise l'apparence de l'élément (zone du cadre, réduite à 12-36 px). */
  setFrom(frame: GrayFrame, box: NormBox): boolean {
    const tw = Math.round(Math.min(36, Math.max(12, box.w * frame.w)));
    const th = Math.round(Math.min(36, Math.max(12, box.h * frame.h)));
    const x0 = Math.round(box.cx * frame.w - tw / 2);
    const y0 = Math.round(box.cy * frame.h - th / 2);
    if (x0 < 0 || y0 < 0 || x0 + tw > frame.w || y0 + th > frame.h) {
      this.tpl = null;
      return false;
    }
    const tpl = new Float32Array(tw * th);
    let mean = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) mean += tpl[y * tw + x] = frame.data[(y0 + y) * frame.w + x0 + x];
    mean /= tpl.length;
    let ss = 0;
    for (let i = 0; i < tpl.length; i++) {
      tpl[i] -= mean;
      ss += tpl[i] * tpl[i];
    }
    if (ss / tpl.length < 25) {
      // zone uniforme (mur blanc…) : impossible à suivre de façon fiable
      this.tpl = null;
      return false;
    }
    this.tpl = tpl;
    this.tw = tw;
    this.th = th;
    this.tplNorm = Math.sqrt(ss);
    return true;
  }

  /** Cherche l'élément autour de (cx, cy) ; renvoie la meilleure position et sa ressemblance (-1 à 1). */
  search(frame: GrayFrame, cx: number, cy: number, radius: number): { cx: number; cy: number; score: number } | null {
    if (!this.tpl) return null;
    const { tw, th, tpl } = this;
    const px = Math.round(cx * frame.w);
    const py = Math.round(cy * frame.h);
    const r = Math.max(4, Math.round(radius * Math.max(frame.w, frame.h)));
    let best = { x: px, y: py, s: -2 };
    const scoreAt = (cxp: number, cyp: number): number => {
      const x0 = cxp - (tw >> 1);
      const y0 = cyp - (th >> 1);
      if (x0 < 0 || y0 < 0 || x0 + tw > frame.w || y0 + th > frame.h) return -2;
      let mean = 0;
      for (let y = 0; y < th; y++) {
        const row = (y0 + y) * frame.w + x0;
        for (let x = 0; x < tw; x++) mean += frame.data[row + x];
      }
      mean /= tw * th;
      let num = 0;
      let den = 0;
      for (let y = 0; y < th; y++) {
        const row = (y0 + y) * frame.w + x0;
        for (let x = 0; x < tw; x++) {
          const v = frame.data[row + x] - mean;
          num += v * tpl[y * tw + x];
          den += v * v;
        }
      }
      return den > 0 ? num / (Math.sqrt(den) * this.tplNorm) : -1;
    };
    // Recherche grossière (pas de 2) puis fine autour du meilleur point
    for (let y = py - r; y <= py + r; y += 2) for (let x = px - r; x <= px + r; x += 2) {
      const s = scoreAt(x, y);
      if (s > best.s) best = { x, y, s };
    }
    for (let y = best.y - 1; y <= best.y + 1; y++) for (let x = best.x - 1; x <= best.x + 1; x++) {
      const s = scoreAt(x, y);
      if (s > best.s) best = { x, y, s };
    }
    if (best.s < -1) return null;
    return { cx: best.x / frame.w, cy: best.y / frame.h, score: best.s };
  }
}

// ------------------------------------------------------------------ cible suivie

const MATCH_OK = 0.62;
const LOST_AFTER_MS = 1800;

export class TargetTracker {
  private dir: Vec3 | null = null;
  private box: NormBox | null = null;
  private label = '';
  private hintDir: Exclude<ARState, { kind: 'none' | 'box' | 'offscreen' }>['direction'] | null = null;
  private lastSeenAt = 0;
  private matcher = new TemplateMatcher();

  constructor(private orientation: OrientationSource) {}

  get active(): boolean {
    return !!this.box || !!this.hintDir;
  }

  get currentLabel(): string {
    return this.label;
  }

  clear(): void {
    this.dir = null;
    this.box = null;
    this.hintDir = null;
    this.label = '';
    this.matcher.clear();
  }

  /**
   * Nouvelle position donnée par l'IA pour l'image envoyée à l'instant t0.
   * poseAtCapture / frameAtCapture : état du téléphone et de l'image à t0 (la réponse arrive 1-2 s plus tard).
   */
  setTarget(
    box: NormBox, label: string, poseAtCapture: CameraPose | null, frameAtCapture: GrayFrame | null, video: { w: number; h: number }, zoomAtCapture = 1,
  ): void {
    this.box = { ...box };
    this.label = label;
    this.hintDir = null;
    this.lastSeenAt = Date.now();
    this.dir = poseAtCapture ? unproject(box.cx, box.cy, poseAtCapture, fieldOfView(video.w, video.h, zoomAtCapture)) : null;
    if (frameAtCapture) this.matcher.setFrom(frameAtCapture, box);
    else this.matcher.clear();
  }

  /** Vise un élément déjà repéré (direction connue au gyroscope, ou position dans l'image). */
  setKnown(label: string, dir: Vec3 | null, box: NormBox | null): void {
    this.clear();
    this.label = label;
    this.dir = dir;
    this.box = box ? { ...box } : { cx: 0.5, cy: 0.5, w: 0.1, h: 0.1 };
    this.lastSeenAt = dir ? Date.now() : box ? Date.now() : 0;
    if (!dir && !box) this.box = null;
  }

  /** Pas de cadre (élément hors image) : simple indication de direction. */
  setHint(direction: 'gauche' | 'droite' | 'haut' | 'bas' | 'derriere', label: string): void {
    this.clear();
    this.hintDir = direction;
    this.label = label;
  }

  /** À appeler à chaque image d'affichage ; frame (facultatif) permet le recalage par l'image. */
  update(video: { w: number; h: number }, frame: GrayFrame | null, zoom = 1): ARState {
    if (this.hintDir && !this.box) return { kind: 'hint', direction: this.hintDir, label: this.label };
    if (!this.box) return { kind: 'none' };

    const fov = fieldOfView(video.w, video.h, zoom);
    const pose = this.orientation.pose();
    let pred = { cx: this.box.cx, cy: this.box.cy, behind: false };
    if (this.dir && pose) pred = project(this.dir, pose, fov);

    const inView = !pred.behind && pred.cx > -0.05 && pred.cx < 1.05 && pred.cy > -0.05 && pred.cy < 1.05;

    // Recalage par l'image quand l'élément est censé être visible
    if (frame && inView && this.matcher.ready) {
      const m = this.matcher.search(frame, pred.cx, pred.cy, this.dir && pose ? 0.08 : 0.16);
      if (m && m.score >= MATCH_OK) {
        pred = { cx: m.cx, cy: m.cy, behind: false };
        this.lastSeenAt = Date.now();
        if (pose) this.dir = unproject(m.cx, m.cy, pose, fov);
      }
    } else if (inView && this.dir && pose) {
      this.lastSeenAt = Date.now(); // suivi au gyroscope seul
    }

    this.box = { ...this.box, cx: pred.cx, cy: pred.cy };
    const fresh = Date.now() - this.lastSeenAt < LOST_AFTER_MS;

    if (!inView) {
      if (!this.dir || !pose) return fresh ? { kind: 'box', box: this.box, label: this.label, confident: false } : { kind: 'none' };
      return { kind: 'offscreen', dx: pred.cx - 0.5, dy: pred.cy - 0.5, behind: pred.behind, label: this.label };
    }
    if (!fresh && !(this.dir && pose)) return { kind: 'none' }; // perdu sans gyroscope : on attend la prochaine réponse
    return { kind: 'box', box: this.box, label: this.label, confident: fresh };
  }
}

/** Passage image vidéo (0-1) → écran, avec le recadrage « object-cover » de la vidéo. */
export function videoToScreen(
  cx: number,
  cy: number,
  video: { w: number; h: number },
  view: { w: number; h: number },
): { x: number; y: number; scale: number } {
  const s = Math.max(view.w / video.w, view.h / video.h);
  const dw = video.w * s;
  const dh = video.h * s;
  return { x: (view.w - dw) / 2 + cx * dw, y: (view.h - dh) / 2 + cy * dh, scale: s };
}
