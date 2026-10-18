// Maquette 3D simple : pièces (volumes) et éléments repérés, construites à partir du parcours (pas + orientation)
// et de la position estimée de chaque élément (direction + taille apparente).
import type { BuildingLayout, LayoutElement, LayoutRoom } from '../types';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
export const roomId = (name: string) => norm(name);

/** Étage d'après le nom de la pièce (« Cave », « Combles », « 1er étage »…) ; 0 par défaut. */
export function floorOf(name: string): number {
  const n = norm(name);
  if (/sous-sol|cave|garage souterrain|parking souterrain|chaufferie en sous/.test(n)) return -1;
  const m = n.match(/(\d+)\s*(?:er|e|eme|ème)?\s*etage|etage\s*(\d+)/);
  if (m) return Number(m[1] ?? m[2]) || 0;
  if (/combles?|grenier|toiture|toit/.test(n)) return 2;
  return 0;
}

/** Revêtements, peintures, façades… : des surfaces, pas des objets qu'on place à un endroit précis. */
export function isSurface(category: string, element: string, label = ''): boolean {
  const t = norm(`${label} ${element} ${category}`);
  if (/fenetre|porte|radiateur|chaudiere|boiler|tableau|luminaire|lavabo|wc|douche|baignoire|evier|climat|vmc|bouche|extincteur|detecteur|ascenseur|compteur|pompe/.test(t)) return false;
  return /revetement|parquet|carrelage|moquette|sol|peinture|mur|plafond|crepi|facade|toiture|isolation|surface|enduit|papier peint/.test(t);
}

/** Dimensions courantes (m) pour estimer la distance d'après la taille apparente. */
export function typicalSize(category: string, element: string, label = ''): { w: number; h: number } | null {
  if (isSurface(category, element, label)) return null;
  const t = norm(`${label} ${element} ${category}`);
  const table: [RegExp, { w: number; h: number }][] = [
    [/porte/, { w: 0.9, h: 2.05 }],
    [/fenetre|baie|velux/, { w: 1.2, h: 1.35 }],
    [/radiateur|emetteur|convecteur/, { w: 1.0, h: 0.6 }],
    [/boiler|chauffe-eau|ballon/, { w: 0.55, h: 1.2 }],
    [/chaudiere|production de chaleur|pompe a chaleur|pac/, { w: 0.6, h: 0.85 }],
    [/tableau|electri|compteur/, { w: 0.5, h: 0.7 }],
    [/climat/, { w: 0.9, h: 0.3 }],
    [/luminaire|eclairage|lampe|plafonnier/, { w: 0.4, h: 0.25 }],
    [/vmc|bouche|ventilation/, { w: 0.2, h: 0.2 }],
    [/wc|toilette/, { w: 0.4, h: 0.8 }],
    [/lavabo|evier/, { w: 0.6, h: 0.5 }],
    [/douche|baignoire/, { w: 1.6, h: 0.6 }],
    [/extincteur|detecteur/, { w: 0.2, h: 0.5 }],
  ];
  for (const [re, size] of table) if (re.test(t)) return size;
  return { w: 0.8, h: 0.8 };
}

/**
 * Distance (m) d'un objet de taille connue d'après la part de l'image qu'il occupe.
 * boxW / boxH : largeur / hauteur du cadre (0-1) ; fov : champ de vision (radians).
 */
export function estimateDistance(boxW: number, boxH: number, size: { w: number; h: number }, fov: { h: number; v: number }): number {
  const dw = boxW > 0.01 ? size.w / (2 * boxW * Math.tan(fov.h / 2)) : NaN;
  const dh = boxH > 0.01 ? size.h / (2 * boxH * Math.tan(fov.v / 2)) : NaN;
  const ds = [dw, dh].filter(Number.isFinite);
  const d = ds.length === 2 ? Math.sqrt(ds[0] * ds[1]) : ds.length ? ds[0] : 2.5;
  return Math.min(8, Math.max(0.4, d));
}

/** Données d'une pièce parcourue pendant la visite, pour construire la maquette. */
export interface RoomInput {
  name: string;
  path: [number, number][];
  elements: Omit<LayoutElement, 'room'>[];
  visitedAt: number;
}

const MIN_ROOM = 2.6;
const MAX_ROOM = 14;
const PAD = 0.5;

/** Géométrie d'une pièce : enveloppe du parcours et des éléments placés, bornée. */
export function roomGeometry(input: RoomInput): { center: [number, number]; size: [number, number]; moved: boolean } {
  const xs: number[] = [];
  const ys: number[] = [];
  input.path.forEach(([x, y]) => {
    xs.push(x);
    ys.push(y);
  });
  const px = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const py = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
  input.elements.forEach(e => {
    if (!e.pos) return;
    // Un élément très loin du parcours est sans doute mal estimé : il ne doit pas déformer la pièce
    if (Math.hypot(e.pos[0] - px, e.pos[1] - py) > 7) return;
    xs.push(e.pos[0]);
    ys.push(e.pos[1]);
  });
  const pathSpan = input.path.length
    ? Math.max(
        Math.max(...input.path.map(p => p[0])) - Math.min(...input.path.map(p => p[0])),
        Math.max(...input.path.map(p => p[1])) - Math.min(...input.path.map(p => p[1])),
      )
    : 0;
  if (!xs.length) return { center: [0, 0], size: [3.5, 3.5], moved: false };
  const minX = Math.min(...xs) - PAD;
  const maxX = Math.max(...xs) + PAD;
  const minY = Math.min(...ys) - PAD;
  const maxY = Math.max(...ys) + PAD;
  const w = Math.min(MAX_ROOM, Math.max(MIN_ROOM, maxX - minX));
  const d = Math.min(MAX_ROOM, Math.max(MIN_ROOM, maxY - minY));
  return { center: [(minX + maxX) / 2, (minY + maxY) / 2], size: [w, d], moved: pathSpan > 0.5 };
}

/** Rectangles qui se chevauchent nettement (même étage) ? */
function overlaps(a: LayoutRoom, b: LayoutRoom): boolean {
  if (a.floor !== b.floor) return false;
  const ox = Math.min(a.center[0] + a.size[0] / 2, b.center[0] + b.size[0] / 2) - Math.max(a.center[0] - a.size[0] / 2, b.center[0] - b.size[0] / 2);
  const oy = Math.min(a.center[1] + a.size[1] / 2, b.center[1] + b.size[1] / 2) - Math.max(a.center[1] - a.size[1] / 2, b.center[1] - b.size[1] / 2);
  return ox > 0.6 && oy > 0.6 && ox * oy > 0.35 * Math.min(a.size[0] * a.size[1], b.size[0] * b.size[1]);
}

/**
 * Maquette du bâtiment : pièces de cette visite (géométrie d'après le parcours) + pièces des visites précédentes
 * non revisitées. Une pièce sans déplacement mesuré (téléphone resté sur place) est rangée à côté des autres.
 */
export function buildLayout(rooms: RoomInput[], previous: BuildingLayout | undefined, path: [number, number][]): BuildingLayout {
  const visited = new Set(rooms.map(r => roomId(r.name)));
  const keptRooms = (previous?.rooms ?? []).filter(r => !visited.has(r.id));
  const keptElements = (previous?.elements ?? []).filter(e => !visited.has(e.room));
  const placed: LayoutRoom[] = [...keptRooms];
  const elements: LayoutElement[] = [...keptElements];

  for (const r of rooms) {
    const id = roomId(r.name);
    const geo = roomGeometry(r);
    const room: LayoutRoom = { id, name: r.name, floor: floorOf(r.name), center: geo.center, size: geo.size, visitedAt: r.visitedAt };
    // Pas de déplacement mesuré et chevauchement : on la pose à droite de la dernière pièce du même étage
    if (!geo.moved && placed.some(p => overlaps(p, room))) {
      const sameFloor = placed.filter(p => p.floor === room.floor);
      const right = Math.max(...sameFloor.map(p => p.center[0] + p.size[0] / 2));
      const dx = right + 0.3 + room.size[0] / 2 - room.center[0];
      room.center = [room.center[0] + dx, room.center[1]];
      r.elements.forEach(e => {
        if (e.pos) e.pos = [e.pos[0] + dx, e.pos[1], e.pos[2]];
      });
    }
    placed.push(room);
    r.elements.forEach(e => elements.push({ ...e, room: id }));
  }
  separateRooms(placed, new Set(rooms.map(r => roomId(r.name))));
  const step = Math.max(1, Math.ceil(path.length / 400));
  const flat: number[] = [];
  path.forEach(([x, y], i) => {
    if (i % step === 0 || i === path.length - 1) flat.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  });
  return { version: 1, updatedAt: Date.now(), rooms: placed, elements, path: flat };
}

/**
 * Pièces voisines qui se chevauchent (une position d'élément estimée trop loin agrandit une pièce) :
 * on recule les deux murs face à face jusqu'à ce qu'ils se rejoignent, comme sur un plan.
 * Seules les pièces de « movable » sont modifiées ; une petite pièce entièrement dans une grande est laissée.
 */
export function separateRooms(rooms: LayoutRoom[], movable: Set<string>, minSize = 1.6): void {
  const edges = (r: LayoutRoom) => ({
    x0: r.center[0] - r.size[0] / 2, x1: r.center[0] + r.size[0] / 2,
    y0: r.center[1] - r.size[1] / 2, y1: r.center[1] + r.size[1] / 2,
  });
  const set = (r: LayoutRoom, e: { x0: number; x1: number; y0: number; y1: number }) => {
    r.center = [(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2];
    r.size = [Math.max(0.5, e.x1 - e.x0), Math.max(0.5, e.y1 - e.y0)];
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        if (a.floor !== b.floor || (!movable.has(a.id) && !movable.has(b.id))) continue;
        const ea = edges(a);
        const eb = edges(b);
        const ox = Math.min(ea.x1, eb.x1) - Math.max(ea.x0, eb.x0);
        const oy = Math.min(ea.y1, eb.y1) - Math.max(ea.y0, eb.y0);
        if (ox <= 0.05 || oy <= 0.05) continue;
        const containedX = (ea.x0 <= eb.x0 && ea.x1 >= eb.x1) || (eb.x0 <= ea.x0 && eb.x1 >= ea.x1);
        const containedY = (ea.y0 <= eb.y0 && ea.y1 >= eb.y1) || (eb.y0 <= ea.y0 && eb.y1 >= ea.y1);
        const alongX = containedX ? false : containedY ? true : ox <= oy;
        if (containedX && containedY) continue; // placard dans une grande pièce : on laisse
        const [lo, hi, k0, k1] = alongX
          ? ea.x0 + ea.x1 <= eb.x0 + eb.x1 ? [ea, eb, 'x1', 'x0'] as const : [eb, ea, 'x1', 'x0'] as const
          : ea.y0 + ea.y1 <= eb.y0 + eb.y1 ? [ea, eb, 'y1', 'y0'] as const : [eb, ea, 'y1', 'y0'] as const;
        // Le mur commun : au milieu du chevauchement, ou du côté de la pièce qu'on ne peut pas modifier
        const loRoom = lo === ea ? a : b;
        const hiRoom = hi === ea ? a : b;
        let wall = (lo[k0] + hi[k1]) / 2;
        if (!movable.has(loRoom.id)) wall = lo[k0];
        else if (!movable.has(hiRoom.id)) wall = hi[k1];
        const loMin = (alongX ? lo.x0 : lo.y0) + minSize;
        const hiMax = (alongX ? hi.x1 : hi.y1) - minSize;
        if (movable.has(loRoom.id)) lo[k0] = Math.max(loMin, Math.min(lo[k0], wall));
        if (movable.has(hiRoom.id)) hi[k1] = Math.min(hiMax, Math.max(hi[k1], wall));
        set(a, ea);
        set(b, eb);
      }
    }
  }
}

/** Parcours enregistré (à plat) → liste de points. */
export function pathPoints(layout: BuildingLayout | undefined): [number, number][] {
  const flat = layout?.path ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** Où poser un élément dans la maquette (repère de la pièce) : sur un mur, au sol, au plafond… */
export function placeElement(
  e: LayoutElement,
  room: LayoutRoom,
  index: number,
  height = 2.5,
): { x: number; y: number; z: number; wallAngle: number } {
  const [cx, cy] = room.center;
  const hw = room.size[0] / 2;
  const hd = room.size[1] / 2;
  let ax: number;
  let ay: number;
  if (e.pos) {
    ax = e.pos[0] - cx;
    ay = e.pos[1] - cy;
  } else if (e.azimuth !== undefined) {
    ax = Math.sin(e.azimuth);
    ay = Math.cos(e.azimuth);
  } else {
    // Sans position ni direction : répartis le long des murs
    const a = index * 1.1;
    ax = Math.sin(a);
    ay = Math.cos(a);
  }
  // Sur le mur le plus proche dans cette direction
  const tx = ax !== 0 ? hw / Math.abs(ax) : Infinity;
  const ty = ay !== 0 ? hd / Math.abs(ay) : Infinity;
  const t = Math.min(tx, ty);
  const onWallX = cx + ax * t * 0.97;
  const onWallY = cy + ay * t * 0.97;
  const wallAngle = tx < ty ? (ax > 0 ? Math.PI / 2 : -Math.PI / 2) : ay > 0 ? 0 : Math.PI;
  const label = norm(`${e.label} ${e.element}`);
  let z = 1.1;
  if (/porte/.test(label)) z = 1.02;
  else if (/radiateur|emetteur|convecteur/.test(label)) z = 0.45;
  else if (/climat/.test(label)) z = height - 0.35;
  else if (/luminaire|eclairage|plafonnier|lampe/.test(label)) z = height - 0.15;
  else if (/fenetre|baie/.test(label)) z = 1.45;
  else if (/wc|lavabo|evier|douche|baignoire|chaudiere|boiler/.test(label)) z = 0.6;
  else if (e.pos) z = Math.min(height - 0.2, Math.max(0.2, e.pos[2]));
  // Luminaires : au plafond, au-dessus de leur position estimée
  if (/luminaire|eclairage|plafonnier/.test(label)) {
    const ix = e.pos ? Math.min(cx + hw - 0.3, Math.max(cx - hw + 0.3, e.pos[0])) : cx;
    const iy = e.pos ? Math.min(cy + hd - 0.3, Math.max(cy - hd + 0.3, e.pos[1])) : cy;
    return { x: ix, y: iy, z, wallAngle };
  }
  return { x: onWallX, y: onWallY, z, wallAngle };
}
