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

/** Image JPEG (data URL) de la vidéo, plus grand côté limité à maxSide. */
export function grabJpeg(video: HTMLVideoElement, maxSide: number, quality: number): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
