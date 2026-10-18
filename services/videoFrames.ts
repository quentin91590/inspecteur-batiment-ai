// Outils image pour la visite guidée : détection de mouvement, luminosité, extraction d'images JPEG.

const SMALL_W = 64;
const SMALL_H = 48;

let smallCanvas: HTMLCanvasElement | null = null;

/** Vignette 64×48 en niveaux de gris : sert à mesurer le mouvement et la nouveauté de la scène. */
export function smallGray(video: HTMLVideoElement): Uint8ClampedArray | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  smallCanvas ??= document.createElement('canvas');
  smallCanvas.width = SMALL_W;
  smallCanvas.height = SMALL_H;
  const ctx = smallCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, SMALL_W, SMALL_H);
  const { data } = ctx.getImageData(0, 0, SMALL_W, SMALL_H);
  const gray = new Uint8ClampedArray(SMALL_W * SMALL_H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return gray;
}

/** Différence moyenne (0-255) entre deux vignettes. */
export function meanAbsDiff(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): number {
  if (!a || !b || a.length !== b.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export function meanLuma(a: Uint8ClampedArray | null): number {
  if (!a || !a.length) return 128;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return sum / a.length;
}

/** Éclaircissement appliqué quand la lampe n'est pas disponible (mode faible lumière). */
export const LOW_LIGHT_FILTER = 'brightness(1.75) contrast(1.12)';

/**
 * Image JPEG (data URL) de la vidéo, plus grand côté limité à maxSide ; filter = éclaircissement éventuel ;
 * crop = zoom numérique (on ne garde que le centre de l'image, 1/crop de chaque côté).
 */
export function grabJpeg(video: HTMLVideoElement, maxSide: number, quality: number, filter?: string, crop = 1): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const z = Math.max(1, crop);
  const sw = vw / z;
  const sh = vh / z;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (filter) ctx.filter = filter;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

let trackCanvas: HTMLCanvasElement | null = null;

/** Image en niveaux de gris (~240 px de grand côté) pour le suivi de l'élément visé. */
export function grayFrame(video: HTMLVideoElement, longSide = 240): { data: Uint8ClampedArray; w: number; h: number } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const s = longSide / Math.max(vw, vh);
  const w = Math.max(16, Math.round(vw * s));
  const h = Math.max(16, Math.round(vh * s));
  trackCanvas ??= document.createElement('canvas');
  trackCanvas.width = w;
  trackCanvas.height = h;
  const ctx = trackCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return { data: gray, w, h };
}
