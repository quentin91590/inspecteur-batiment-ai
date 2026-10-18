// Icône d'un élément du bâtiment, pour les repères posés dans l'image et les listes.
// Choisie d'après l'élément, son libellé et sa catégorie (mots-clés), sinon une icône neutre.
import {
  AirVent, AppWindow, ArrowUpDown, Bath, Blinds, BrickWall, Building2, Car, CircleDot, Cylinder, DoorClosed, Fan, Fence,
  FireExtinguisher, Flame, Footprints, Grid3x3, Heater, House, Layers, Lightbulb, PaintRoller, PlugZap, Rows3, ShowerHead, SolarPanel,
  Thermometer, Toilet, Trees, Warehouse, Wrench, type LucideIcon,
} from 'lucide-react';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Mots-clés → icône, du plus précis au plus général (le premier qui correspond gagne). */
const RULES: [RegExp, LucideIcon][] = [
  [/store|volet|brise-soleil|persienne/, Blinds],
  [/fenetre|vitrage|velux|baie|lucarne|verriere/, AppWindow],
  [/porte|menuiserie|placard|huisserie/, DoorClosed],
  [/radiateur|emetteur|convecteur|chauffage au sol|plancher chauffant/, Heater],
  [/chaudiere|production de chaleur|bruleur|pompe a chaleur|\bpac\b|chauffage/, Flame],
  [/boiler|chauffe-eau|ballon|\becs\b|eau chaude/, Cylinder],
  [/wc|toilette/, Toilet],
  [/douche/, ShowerHead],
  [/baignoire|lavabo|evier|sanitaire|robinet|evacuation|distribution d'?eau/, Bath],
  [/tableau|electri|prise|interrupteur|compteur/, PlugZap],
  [/luminaire|eclairage|lampe|spot|plafonnier/, Lightbulb],
  [/vmc|ventilation|bouche|extraction|aeration/, AirVent],
  [/ventilateur|climatis/, Fan],
  [/photovolta|solaire|panneau/, SolarPanel],
  [/ascenseur|monte-charge/, ArrowUpDown],
  [/incendie|extincteur|detecteur|sprinkler|desenfumage/, FireExtinguisher],
  [/cave|sous-sol|local technique/, Warehouse],
  [/carrelage|faience|dalle/, Grid3x3],
  [/parquet|plancher|\bsols?\b|moquette|lino|stratifie/, Rows3],
  [/peinture|mur|crepi|papier peint|enduit|plafond/, PaintRoller],
  [/revetement|surface/, Layers],
  [/maconnerie|beton|brique|\bgros\b|structure|fissure/, BrickWall],
  [/facade|batiment/, Building2],
  [/toiture|toit|charpente|comble|couverture|isolation/, House],
  [/parking|garage/, Car],
  [/abords|jardin|espaces? verts|arbre/, Trees],
  [/cloture|portail|barriere/, Fence],
  [/thermostat|regulation|sonde/, Thermometer],
  [/escalier|garde-corps|rampe|marche/, Footprints],
  [/conduite|canalisation|vanne|pompe/, Wrench],
];

export function iconFor(category: string, element: string, label = ''): LucideIcon {
  // Le libellé et l'élément sont plus parlants que la catégorie : on les essaie d'abord
  for (const text of [label, element, category]) {
    const t = norm(text || '');
    if (!t) continue;
    for (const [re, icon] of RULES) if (re.test(t)) return icon;
  }
  return CircleDot;
}
