// Maquette 3D simple du bâtiment : les pièces parcourues (volumes) et les éléments repérés (modèles simples),
// colorés selon l'avancement. Chargée seulement à l'ouverture (three.js n'alourdit pas le reste de l'appli).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Box as BoxIcon, Crosshair, Map as MapIcon, X } from 'lucide-react';
import type { BuildingLayout, LayoutElement, LayoutRoom } from '../types';
import { isSurface, pathPoints, placeElement } from '../utils/layout';
import { iconFor } from '../utils/elementIcons';

const WALL_H = 2.5;
const FLOOR_GAP = 3.1;
const STATUS_COLOR: Record<LayoutElement['status'], string> = { done: '#10b981', todo: '#f59e0b', skipped: '#94a3b8' };
const STATUS_LABEL: Record<LayoutElement['status'], string> = { done: 'Relevé', todo: 'À relever', skipped: 'Ignoré' };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmt = (n: number) => n.toFixed(1).replace('.', ',');
const floorChip = (f: number) => (f < 0 ? 'Sous-sol' : f === 0 ? 'RDC' : f === 1 ? '1er' : `${f}e`);
const floorName = (f: number) => (f < 0 ? 'Sous-sol' : f === 0 ? 'Rez-de-chaussée' : f === 1 ? '1er étage' : `${f}e étage`);
const isFloorSurface = (e: LayoutElement) => /\bsols?\b|parquet|carrelage|moquette|lino|plancher/.test(norm(`${e.label} ${e.element}`));

type Selection = { kind: 'element'; el: LayoutElement; room?: LayoutRoom } | { kind: 'room'; room: LayoutRoom } | null;

interface Props {
  layout: BuildingLayout;
  /** Pièce où se trouve l'inspecteur (identifiant) */
  currentRoom?: string;
  /** Position de l'inspecteur dans la maquette (m) */
  user?: { x: number; y: number } | null;
  onClose: () => void;
}

// ------------------------------------------------------------------ modèles simples
interface ModelSpec {
  mount: 'wall' | 'floor' | 'ceiling';
  /** Hauteur du centre (fixé au mur) */
  z?: number;
  /** Hauteur du modèle (posé au sol / au plafond) */
  h: number;
  /** Décalage depuis le mur vers l'intérieur de la pièce */
  inset: number;
  build: (mat: THREE.MeshStandardMaterial) => THREE.Object3D;
}

const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
const cyl = (r: number, h: number, mat: THREE.Material, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
const group = (...parts: THREE.Object3D[]) => {
  const g = new THREE.Group();
  parts.forEach(p => g.add(p));
  return g;
};

function specFor(e: LayoutElement): ModelSpec {
  const t = norm(`${e.label} ${e.element} ${e.category}`);
  if (/porte/.test(t)) return { mount: 'floor', h: 2.05, inset: 0.04, build: m => box(0.9, 2.05, 0.07, m) };
  if (/fenetre|baie|velux|vitrage/.test(t))
    return {
      mount: 'wall', z: 1.45, h: 1.35, inset: 0.05,
      build: m => {
        const glass = m.clone();
        glass.transparent = true;
        glass.opacity = 0.35;
        return group(
          box(1.2, 0.08, 0.08, m, 0, 0.635), box(1.2, 0.08, 0.08, m, 0, -0.635),
          box(0.08, 1.35, 0.08, m, -0.56), box(0.08, 1.35, 0.08, m, 0.56), box(0.05, 1.2, 0.06, m),
          box(1.05, 1.2, 0.02, glass),
        );
      },
    };
  if (/radiateur|emetteur|convecteur|seche-serviette/.test(t))
    return {
      mount: 'wall', z: 0.45, h: 0.6, inset: 0.08,
      build: m => group(...Array.from({ length: 7 }, (_, i) => box(0.11, 0.6, 0.09, m, -0.45 + i * 0.15)), box(1.0, 0.05, 0.05, m, 0, 0.25)),
    };
  if (/boiler|chauffe-eau|ballon/.test(t)) return { mount: 'wall', z: 1.3, h: 1.2, inset: 0.3, build: m => cyl(0.27, 1.2, m) };
  if (/chaudiere|pompe a chaleur|\bpac\b|production de chaleur|chauffage central/.test(t))
    return { mount: 'wall', z: 1.25, h: 0.85, inset: 0.25, build: m => box(0.6, 0.85, 0.45, m) };
  if (/tableau|electri|compteur|disjoncteur/.test(t)) return { mount: 'wall', z: 1.5, h: 0.7, inset: 0.07, build: m => box(0.5, 0.7, 0.12, m) };
  if (/climat|split/.test(t)) return { mount: 'wall', z: WALL_H - 0.35, h: 0.3, inset: 0.12, build: m => box(0.9, 0.3, 0.22, m) };
  if (/luminaire|eclairage|plafonnier|lampe|spot/.test(t)) return { mount: 'ceiling', h: 0.06, inset: 0.6, build: m => cyl(0.22, 0.06, m) };
  if (/detecteur/.test(t)) return { mount: 'ceiling', h: 0.04, inset: 0.6, build: m => cyl(0.07, 0.04, m) };
  if (/vmc|bouche|ventilation|aeration/.test(t))
    return {
      mount: 'wall', z: WALL_H - 0.25, h: 0.2, inset: 0.03,
      build: m => {
        const c = cyl(0.1, 0.04, m);
        c.rotation.x = Math.PI / 2;
        return c;
      },
    };
  if (/\bwc\b|toilette|cuvette/.test(t))
    return { mount: 'floor', h: 0.8, inset: 0.32, build: m => group(box(0.38, 0.42, 0.5, m, 0, -0.19, -0.05), box(0.4, 0.36, 0.16, m, 0, 0.2, 0.22)) };
  if (/lavabo|evier|vasque/.test(t)) return { mount: 'wall', z: 0.82, h: 0.18, inset: 0.25, build: m => box(0.6, 0.18, 0.45, m) };
  if (/douche/.test(t)) return { mount: 'floor', h: 0.08, inset: 0.46, build: m => box(0.9, 0.08, 0.9, m) };
  if (/baignoire/.test(t)) return { mount: 'floor', h: 0.55, inset: 0.38, build: m => box(1.7, 0.55, 0.75, m) };
  if (/extincteur/.test(t)) return { mount: 'wall', z: 0.55, h: 0.5, inset: 0.1, build: m => cyl(0.08, 0.5, m, 14) };
  if (/ascenseur/.test(t)) return { mount: 'floor', h: 2.2, inset: 0.05, build: m => box(1.1, 2.2, 0.1, m) };
  if (/escalier/.test(t))
    return {
      mount: 'floor', h: 1.0, inset: 0.6,
      build: m => group(...Array.from({ length: 5 }, (_, i) => box(0.9, 0.2 * (i + 1), 0.25, m, 0, -0.5 + 0.1 * (i + 1), 0.5 - i * 0.25))),
    };
  return {
    mount: 'wall', z: 1.1, h: 0.32, inset: 0.2,
    build: m => new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), m),
  };
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as any).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose());
    else mat?.dispose();
    if (o instanceof CSS2DObject) o.element.remove();
  });
}

function labelEl(text: string, cls: string): CSS2DObject {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  return new CSS2DObject(div);
}

// ------------------------------------------------------------------ composant
const Building3D: React.FC<Props> = ({ layout, currentRoom, user, onClose }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    labels: CSS2DRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group;
    pickables: THREE.Object3D[];
    elementObjs: Map<string, THREE.Object3D>;
    selectedLabel: CSS2DObject | null;
  } | null>(null);
  const [error, setError] = useState('');
  const [floor, setFloor] = useState<number | 'all'>('all');
  const [topView, setTopView] = useState(false);
  const topViewRef = useRef(topView);
  topViewRef.current = topView;
  const [selected, setSelected] = useState<Selection>(null);
  const selectRef = useRef<(s: Selection) => void>(setSelected);
  selectRef.current = setSelected;

  const floors = useMemo(() => Array.from(new Set<number>(layout.rooms.map(r => r.floor))).sort((a: number, b: number) => a - b), [layout]);
  const roomsById = useMemo(() => new Map(layout.rooms.map(r => [r.id, r])), [layout]);
  const stats = useMemo(() => {
    const els = layout.elements;
    return { rooms: layout.rooms.length, elements: els.length, done: els.filter(e => e.status === 'done').length };
  }, [layout]);

  // ---------------------------------------------------------------- moteur (une fois)
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError('Ce navigateur ne peut pas afficher la 3D (WebGL indisponible).');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor('#0b1220');
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.setAttribute('data-testid', 'building3d-canvas');
    mount.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.style.position = 'absolute';
    labels.domElement.style.inset = '0';
    labels.domElement.style.pointerEvents = 'none';
    mount.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#334155', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(6, 12, 8);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.04; // jamais sous le sol
    controls.minDistance = 1.5;
    controls.maxDistance = 150;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    const content = new THREE.Group();
    scene.add(content);
    engineRef.current = { renderer, labels, scene, camera, controls, content, pickables: [], elementObjs: new Map(), selectedLabel: null };

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // Toucher bref (sans glisser) : on sélectionne ce qui est touché
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      down = null;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(engineRef.current?.pickables ?? [], true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.pick) o = o.parent;
      selectRef.current((o?.userData.pick as Selection) ?? null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
      engineRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------- contenu (pièces, éléments, parcours)
  const fitRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const { content } = eng;
    disposeTree(content);
    content.clear();
    eng.pickables = [];
    eng.elementObjs = new Map();
    eng.selectedLabel = null;

    const shown = layout.rooms.filter(r => floor === 'all' || r.floor === floor);
    const at = (x: number, y: number, h: number) => new THREE.Vector3(x, h, -y); // repère maquette → three.js

    for (const room of shown) {
      const base = room.floor * FLOOR_GAP;
      const [cx, cy] = room.center;
      const [w, d] = room.size;
      const els = layout.elements.filter(e => e.room === room.id);
      const here = room.id === currentRoom;
      // Sol (teinté si le revêtement de sol a été relevé)
      const floorEl = els.find(e => isSurface(e.category, e.element, e.label) && isFloorSurface(e));
      const floorMat = new THREE.MeshStandardMaterial({
        color: floorEl ? STATUS_COLOR[floorEl.status] : here ? '#26406b' : '#334155',
        transparent: true,
        opacity: floorEl ? 0.55 : 0.9,
        roughness: 0.9,
      });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), floorMat);
      slab.position.copy(at(cx, cy, base - 0.03));
      slab.userData.pick = { kind: 'room', room } satisfies Selection;
      content.add(slab);
      eng.pickables.push(slab);
      // Murs : volume translucide et arêtes
      const shell = new THREE.BoxGeometry(w, WALL_H, d);
      const walls = new THREE.Mesh(
        shell,
        new THREE.MeshBasicMaterial({ color: '#e2e8f0', transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }),
      );
      walls.position.copy(at(cx, cy, base + WALL_H / 2));
      content.add(walls);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(shell),
        new THREE.LineBasicMaterial({ color: here ? '#60a5fa' : '#cbd5e1', transparent: true, opacity: here ? 0.9 : 0.45 }),
      );
      edges.position.copy(walls.position);
      content.add(edges);
      // Nom de la pièce
      const done = els.filter(e => e.status === 'done').length;
      const name = labelEl(els.length ? `${room.name} · ${done}/${els.length}` : room.name, here ? 'b3d-room b3d-here' : 'b3d-room');
      name.position.copy(at(cx, cy, base + WALL_H + 0.5));
      content.add(name);

      // Éléments (les surfaces — revêtements, peintures — ne sont pas des objets : elles sont listées dans la fiche)
      els
        .filter(e => !isSurface(e.category, e.element, e.label))
        .forEach((e, i) => {
          const spec = specFor(e);
          const p = placeElement(e, room, i, WALL_H);
          const mat = new THREE.MeshStandardMaterial({ color: STATUS_COLOR[e.status], roughness: 0.55, metalness: 0.05 });
          const obj = spec.build(mat);
          // Vers l'intérieur de la pièce, perpendiculairement au mur
          const ix = -Math.sin(p.wallAngle) * spec.inset;
          const iy = -Math.cos(p.wallAngle) * spec.inset;
          const onCeiling = spec.mount === 'ceiling';
          const height =
            spec.mount === 'floor' ? spec.h / 2 : onCeiling ? WALL_H - spec.h / 2 - 0.02 : (spec.z ?? p.z);
          const ceilingPlaced = onCeiling && /luminaire|eclairage|plafonnier/.test(norm(`${e.label} ${e.element}`));
          obj.position.copy(at(p.x + (ceilingPlaced ? 0 : ix), p.y + (ceilingPlaced ? 0 : iy), base + height));
          obj.rotation.y = p.wallAngle;
          obj.userData.pick = { kind: 'element', el: e, room } satisfies Selection;
          content.add(obj);
          eng.pickables.push(obj);
          eng.elementObjs.set(e.id, obj);
        });
    }

    // Parcours de la dernière visite (au rez si tous les étages sont affichés)
    const pts = pathPoints(layout);
    if (pts.length > 1 && (floor === 'all' || floor === 0)) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => at(x, y, 0.05)));
      content.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#93c5fd', transparent: true, opacity: 0.85 })));
    }
    // Vous êtes ici
    const userRoom = currentRoom ? roomsById.get(currentRoom) : undefined;
    if (user && (floor === 'all' || !userRoom || userRoom.floor === floor)) {
      const base = (userRoom?.floor ?? 0) * FLOOR_GAP;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 18), new THREE.MeshStandardMaterial({ color: '#3b82f6', emissive: '#1d4ed8' }));
      cone.rotation.x = Math.PI; // pointe vers le bas
      cone.position.copy(at(user.x, user.y, base + 1.9));
      content.add(cone);
      const you = labelEl('Vous', 'b3d-you');
      you.position.copy(at(user.x, user.y, base + 1.45));
      content.add(you);
    }

    fitRef.current = () => {
      const bb = new THREE.Box3().setFromObject(content);
      if (bb.isEmpty()) bb.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 2.5, 3));
      const c = bb.getCenter(new THREE.Vector3());
      const size = bb.getSize(new THREE.Vector3());
      // Tout doit tenir à l'écran (téléphone en portrait : c'est la largeur qui limite)
      const plan = topViewRef.current;
      const cam = eng.camera;
      cam.fov = plan ? 12 : 50; // plan : vue du dessus au téléobjectif (les murs ne « s'ouvrent » pas)
      cam.updateProjectionMatrix();
      const v = (cam.fov * Math.PI) / 180;
      const h = 2 * Math.atan(Math.tan(v / 2) * cam.aspect);
      eng.controls.target.copy(c);
      if (plan) {
        const w = Math.max(size.x, 3) * 1.12;
        const d = Math.max(size.z, 3) * 1.12;
        const dist = Math.max(w / 2 / Math.tan(h / 2), d / 2 / Math.tan(v / 2)) + size.y;
        cam.position.set(c.x, c.y + dist, c.z + 0.01);
      } else {
        const radius = Math.max(size.length() / 2, 2.5);
        const dist = (radius / Math.sin(Math.min(h, v) / 2)) * 0.92;
        const dir = new THREE.Vector3(0.55, 0.75, 0.8).normalize();
        cam.position.copy(c).addScaledVector(dir, dist);
      }
      eng.controls.maxDistance = plan ? 800 : 200;
      eng.controls.update();
    };
    fitRef.current();
    setSelected(null);
  }, [layout, floor, currentRoom, user, roomsById]);

  // Plan (vue du dessus) ou 3D
  useEffect(() => {
    fitRef.current();
  }, [topView]);

  // ---------------------------------------------------------------- sélection : mise en évidence + nom
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.elementObjs.forEach(obj => {
      obj.scale.setScalar(1);
      obj.traverse(o => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && 'emissive' in m) m.emissive.set('#000000');
      });
    });
    if (eng.selectedLabel) {
      eng.selectedLabel.removeFromParent();
      eng.selectedLabel.element.remove();
      eng.selectedLabel = null;
    }
    if (selected?.kind !== 'element') return;
    const obj = eng.elementObjs.get(selected.el.id);
    if (!obj) return;
    obj.scale.setScalar(1.25);
    obj.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'emissive' in m) m.emissive.set('#555555');
    });
    const tag = labelEl(selected.el.label, 'b3d-el');
    tag.position.copy(obj.position).add(new THREE.Vector3(0, 0.55, 0));
    eng.content.add(tag);
    eng.selectedLabel = tag;
  }, [selected]);

  // ---------------------------------------------------------------- rendu
  const selRoom = selected?.kind === 'room' ? selected.room : null;
  const selEl = selected?.kind === 'element' ? selected.el : null;
  const SelIcon = selEl ? iconFor(selEl.category, selEl.element, selEl.label) : null;

  return createPortal(
    <div className="fixed inset-0 z-[400] bg-[#0b1220] text-white flex flex-col" data-testid="building3d">
      <div className="flex items-center gap-2 px-3 pt-2 pb-2 safe-top">
        <button onClick={onClose} className="p-2.5 rounded-full bg-white/10" aria-label="Fermer la maquette" data-testid="close-3d">
          <X size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold leading-tight">Maquette 3D</p>
          <p className="text-xs text-white/60 truncate" data-testid="building3d-stats">
            {stats.rooms} pièce{stats.rooms > 1 ? 's' : ''} · {stats.done}/{stats.elements} élément{stats.elements > 1 ? 's' : ''} relevé{stats.elements > 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setTopView(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/10 text-sm font-semibold"
          data-testid="toggle-top-view"
        >
          {topView ? <BoxIcon size={16} /> : <MapIcon size={16} />}
          {topView ? '3D' : 'Plan'}
        </button>
        <button onClick={() => fitRef.current()} className="p-2.5 rounded-full bg-white/10" aria-label="Recentrer">
          <Crosshair size={18} />
        </button>
      </div>

      {floors.length > 1 && (
        <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto" data-testid="floor-chips">
          {(['all', ...floors] as (number | 'all')[]).map(f => (
            <button
              key={String(f)}
              onClick={() => setFloor(f)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${floor === f ? 'bg-white text-slate-900' : 'bg-white/10 text-white/80'}`}
            >
              {f === 'all' ? 'Tout' : floorChip(f)}
            </button>
          ))}
        </div>
      )}

      <div ref={mountRef} className="relative flex-1 min-h-0" style={{ touchAction: 'none' }}>
        {error && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-white/80">{error}</p>}
        {!error && layout.rooms.length === 0 && (
          <div className="absolute inset-x-6 top-1/3 text-center text-white/80 pointer-events-none" data-testid="building3d-empty">
            <p className="font-semibold">La maquette se construit pendant la visite</p>
            <p className="text-sm text-white/60 mt-1">Passez d'une pièce à l'autre : les pièces et les éléments repérés y apparaissent.</p>
          </div>
        )}
      </div>

      <div className="px-3 pt-2 pb-3 safe-bottom space-y-2">
        {selEl && SelIcon && (
          <div className="rounded-2xl bg-white/10 p-3 flex items-center gap-3" data-testid="building3d-info">
            <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: STATUS_COLOR[selEl.status] }}>
              <SelIcon size={20} className="text-slate-900" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{selEl.label}</p>
              <p className="text-xs text-white/60 truncate">
                {selEl.element}
                {selected?.kind === 'element' && selected.room ? ` · ${selected.room.name}` : ''}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-semibold" style={{ color: STATUS_COLOR[selEl.status] }}>{STATUS_LABEL[selEl.status]}</p>
              <p className="text-xs text-white/60">{selEl.photos} photo{selEl.photos > 1 ? 's' : ''}</p>
            </div>
          </div>
        )}
        {selRoom && (
          <div className="rounded-2xl bg-white/10 p-3" data-testid="building3d-info">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold truncate">{selRoom.name}</p>
              <p className="text-xs text-white/60 shrink-0">
                {floorName(selRoom.floor)} · ≈ {fmt(selRoom.size[0])} × {fmt(selRoom.size[1])} m
              </p>
            </div>
            <ul className="mt-2 max-h-32 overflow-y-auto space-y-1 text-sm">
              {layout.elements
                .filter(e => e.room === selRoom.id)
                .map(e => (
                  <li key={e.id} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[e.status] }} />
                    <span className="truncate flex-1">{e.label}</span>
                    <span className="text-xs text-white/50 shrink-0">{STATUS_LABEL[e.status]}</span>
                  </li>
                ))}
              {!layout.elements.some(e => e.room === selRoom.id) && <li className="text-white/50">Aucun élément repéré</li>}
            </ul>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-[11px] text-white/60">
          <span className="flex items-center gap-3">
            {(['done', 'todo', 'skipped'] as const).map(s => (
              <span key={s} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]}
              </span>
            ))}
          </span>
          <span className="text-right">Schéma : dimensions estimées</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default Building3D;
