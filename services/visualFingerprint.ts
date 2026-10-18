// Empreinte visuelle d'un élément (calculée dans le navigateur, sans modèle à télécharger).
// Couleur (histogramme teinte / saturation / luminosité) + texture (orientation des contours sur 4 zones) :
// assez pour distinguer « fenêtre PVC blanche » de « fenêtre bois », « radiateur fonte » de « radiateur alu »,
// « parquet » de « carrelage », et reconnaître la même variante revue sous un autre angle.

export type Fingerprint = Float32Array;

const H_BINS = 12;
const S_BINS = 3;
const V_BINS = 3;
const COLOR_LEN = H_BINS * S_BINS * V_BINS; // 108
const ORI_BINS = 8;
const CELLS = 2; // 2 × 2 zones
const GRAD_LEN = ORI_BINS * CELLS * CELLS; // 32
export const FP_LEN = COLOR_LEN + GRAD_LEN; // 140
const SIDE = 32; // l'élément est rééchantillonné en 32 × 32

/** Petite copie de l'image envoyée à l'IA (pour calculer l'empreinte des éléments quand la réponse arrive). */
export interface FrameSample {
  data: Uint8ClampedArray; // RGBA
  w: number;
  h: number;
}

let sampleCanvas: HTMLCanvasElement | null = null;

/** Copie réduite (≈256 px) de la vidéo, avec le même recadrage (zoom numérique) que l'image envoyée. */
export function sampleFrame(video: HTMLVideoElement, crop = 1, longSide = 256): FrameSample | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const z = Math.max(1, crop);
  const sw = vw / z;
  const sh = vh / z;
  const s = longSide / Math.max(sw, sh);
  const w = Math.max(16, Math.round(sw * s));
  const h = Math.max(16, Math.round(sh * s));
  sampleCanvas ??= document.createElement('canvas');
  sampleCanvas.width = w;
  sampleCanvas.height = h;
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

/**
 * Empreinte de la zone box (coordonnées 0-1 dans l'image) ; null si la zone est trop petite pour être fiable.
 * box : { x0, y0, x1, y1 } normalisés.
 */
export function fingerprintOf(sample: FrameSample, box: { x0: number; y0: number; x1: number; y1: number }): Fingerprint | null {
  const x0 = Math.max(0, Math.min(1, box.x0)) * sample.w;
  const x1 = Math.max(0, Math.min(1, box.x1)) * sample.w;
  const y0 = Math.max(0, Math.min(1, box.y0)) * sample.h;
  const y1 = Math.max(0, Math.min(1, box.y1)) * sample.h;
  if (x1 - x0 < 6 || y1 - y0 < 6) return null;

  // Rééchantillonnage 32 × 32 (plus proche voisin, suffisant à cette échelle)
  const rgb = new Float32Array(SIDE * SIDE * 3);
  for (let j = 0; j < SIDE; j++) {
    const sy = Math.min(sample.h - 1, Math.floor(y0 + ((j + 0.5) * (y1 - y0)) / SIDE));
    for (let i = 0; i < SIDE; i++) {
      const sx = Math.min(sample.w - 1, Math.floor(x0 + ((i + 0.5) * (x1 - x0)) / SIDE));
      const k = (sy * sample.w + sx) * 4;
      const o = (j * SIDE + i) * 3;
      rgb[o] = sample.data[k];
      rgb[o + 1] = sample.data[k + 1];
      rgb[o + 2] = sample.data[k + 2];
    }
  }

  const fp = new Float32Array(FP_LEN);
  // Couleur
  const gray = new Float32Array(SIDE * SIDE);
  for (let p = 0; p < SIDE * SIDE; p++) {
    const r = rgb[p * 3];
    const g = rgb[p * 3 + 1];
    const b = rgb[p * 3 + 2];
    gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    const [h, s, v] = rgbToHsv(r, g, b);
    const hb = Math.min(H_BINS - 1, Math.floor(h * H_BINS));
    const sb = Math.min(S_BINS - 1, Math.floor(s * S_BINS));
    const vb = Math.min(V_BINS - 1, Math.floor(v * V_BINS));
    // Couleurs peu saturées : la teinte n'a pas de sens, on la range toujours dans la même case
    fp[(s < 0.15 ? 0 : hb) * S_BINS * V_BINS + sb * V_BINS + vb] += 1;
  }
  // Texture : orientation des contours, 4 zones
  for (let j = 1; j < SIDE - 1; j++) {
    for (let i = 1; i < SIDE - 1; i++) {
      const gx = gray[j * SIDE + i + 1] - gray[j * SIDE + i - 1];
      const gy = gray[(j + 1) * SIDE + i] - gray[(j - 1) * SIDE + i];
      const mag = Math.hypot(gx, gy);
      if (mag < 8) continue;
      let a = Math.atan2(gy, gx);
      if (a < 0) a += Math.PI; // orientation non signée
      const ob = Math.min(ORI_BINS - 1, Math.floor((a / Math.PI) * ORI_BINS));
      const cell = (j < SIDE / 2 ? 0 : 2) + (i < SIDE / 2 ? 0 : 1);
      fp[COLOR_LEN + cell * ORI_BINS + ob] += mag;
    }
  }
  // Normalisation par bloc (racine = distance de Hellinger), couleur un peu plus importante que la texture
  normalizeBlock(fp, 0, COLOR_LEN, 0.62);
  normalizeBlock(fp, COLOR_LEN, FP_LEN, 0.38);
  return fp;
}

function normalizeBlock(fp: Float32Array, from: number, to: number, weight: number) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += fp[i];
  if (sum <= 0) return;
  let sq = 0;
  for (let i = from; i < to; i++) {
    fp[i] = Math.sqrt(fp[i] / sum);
    sq += fp[i] * fp[i];
  }
  const k = Math.sqrt(weight) / Math.sqrt(sq || 1);
  for (let i = from; i < to; i++) fp[i] *= k;
}

/** Ressemblance 0 (rien à voir) à 1 (identique). */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Moyenne de deux empreintes (a compte pour wA). */
export function blendFingerprint(a: Fingerprint, b: Fingerprint, wA: number): Fingerprint {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] * wA + b[i]) / (wA + 1);
  return out;
}

/** Empreinte compacte (texte) pour l'enregistrer avec le bâtiment. */
export function encodeFingerprint(fp: Fingerprint): string {
  let max = 0;
  for (let i = 0; i < fp.length; i++) max = Math.max(max, fp[i]);
  const bytes = new Uint8Array(fp.length);
  for (let i = 0; i < fp.length; i++) bytes[i] = max ? Math.round((fp[i] / max) * 255) : 0;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function decodeFingerprint(text: string | undefined): Fingerprint | null {
  if (!text) return null;
  try {
    const s = atob(text);
    if (s.length !== FP_LEN) return null;
    const fp = new Float32Array(FP_LEN);
    let sq = 0;
    for (let i = 0; i < FP_LEN; i++) {
      fp[i] = s.charCodeAt(i) / 255;
      sq += fp[i] * fp[i];
    }
    // Même échelle que les empreintes calculées (norme 1), pour pouvoir les moyenner
    const k = sq ? 1 / Math.sqrt(sq) : 0;
    for (let i = 0; i < FP_LEN; i++) fp[i] *= k;
    return fp;
  } catch {
    return null;
  }
}
