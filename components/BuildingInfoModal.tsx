import React, { useState, useEffect } from 'react';
import { X, Building, MapPin, Hash, Navigation, Loader2, ExternalLink, Calendar, Maximize, Home, Flame, Zap, Droplets, Layers, LayoutTemplate } from 'lucide-react';

interface BuildingInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  buildingName?: string;
  buildingAddress?: string;
  buildingEgid?: string;
}

// MAPPING CODES REGBL
const ENERGY_CODES: Record<number, string> = {
    7500: "Aucune",
    7501: "Air",
    7510: "Géothermie (générique)",
    7511: "Sonde géothermique",
    7512: "Serpentin géothermique",
    7513: "Eau (nappe, eaux sup., résid.)",
    7520: "Gaz",
    7530: "Mazout",
    7540: "Bois (générique)",
    7541: "Bois (bûches)",
    7542: "Bois (pellets)",
    7543: "Bois (copeaux)",
    7550: "Rejets thermiques (bat.)",
    7560: "Électricité",
    7570: "Soleil (thermique)",
    7580: "CAD (générique)",
    7581: "CAD (haute temp.)",
    7582: "CAD (basse temp.)",
    7598: "Indéterminée",
    7599: "Autre"
};

const GENERATOR_CODES: Record<number, string> = {
    7400: "Pas de générateur de chaleur",
    7410: "PAC (1 bât.)",
    7411: "PAC (+ bât.)",
    7420: "Solaire thermique (1 bât.)",
    7421: "Solaire thermique (+ bât.)",
    7430: "Chaudière générique (1 bât.)",
    7431: "Chaudière générique (+ bât.)",
    7432: "Chaudière standard (1 bât.)",
    7433: "Chaudière standard (+ bât.)",
    7434: "Chaudière condensation (1 bât.)",
    7435: "Chaudière condensation (+ bât.)",
    7436: "Poêle",
    7440: "Couplage chaleur-force (1 bât.)",
    7441: "Couplage chaleur-force (+ bât.)",
    7450: "Chauffage central élec. (1 bât.)",
    7451: "Chauffage central élec. (+ bât.)",
    7452: "Chauffage élec. direct",
    7460: "Echangeur (CAD) (1 bât.)",
    7461: "Echangeur (CAD) (+ bât.)",
    7499: "Autre"
};

// MAPPING EAU CHAUDE SANITAIRE (ECS)
const HOT_WATER_ENERGY_CODES: Record<number, string> = {
    7500: "Aucune",
    7501: "Air",
    7510: "Géothermie (générique)",
    7511: "Sonde géothermique",
    7512: "Serpentin géothermique",
    7513: "Eau (nappe, eaux sup., résid.)",
    7520: "Gaz",
    7530: "Mazout",
    7540: "Bois (générique)",
    7541: "Bois (bûches)",
    7542: "Bois (pellets)",
    7543: "Bois (copeaux)",
    7550: "Rejets thermiques (bat.)",
    7560: "Électricité",
    7570: "Soleil (thermique)",
    7580: "CAD (générique)",
    7581: "CAD (haute temp.)",
    7582: "CAD (basse temp.)",
    7598: "Indéterminée",
    7599: "Autre"
};

const HOT_WATER_GENERATOR_CODES: Record<number, string> = {
    7600: "Pas de générateur de chaleur",
    7610: "Pompe à chaleur PAC",
    7620: "Installation solaire thermique",
    7630: "Chaudière (générique)",
    7632: "Chaudière standard",
    7634: "Chaudière à condensation",
    7640: "Installation couplage chaleur-force",
    7650: "Boiler électrique central",
    7651: "Petit boiler",
    7660: "Echangeur de chaleur (y compris CAD)",
    7699: "Autre"
};

// MAPPING TYPOLOGIE (GKLAS)
const BUILDING_CATEGORY_CODES: Record<number, string> = {
    1110: "Maison à un logement",
    1121: "Maison à deux logements",
    1122: "Immeuble à trois logements et plus",
    1130: "Habitat communautaire",
    1211: "Hôtel",
    1212: "Bâtiment d’hébergement touristique",
    1220: "Immeuble de bureaux",
    1230: "Bâtiment commercial",
    1231: "Restaurant ou bar sans usage résidentiel",
    1241: "Gare, aéroport ou bâtiment de télécommunications",
    1242: "Garage ou parking",
    1251: "Bâtiment industriel",
    1252: "Réservoir, silo ou entrepôt",
    1261: "Bâtiment culturel ou récréatif",
    1262: "Musée ou bibliothèque",
    1263: "Bâtiment d’enseignement ou de recherche",
    1264: "Hôpital ou établissement de santé",
    1265: "Salle de sport",
    1271: "Bâtiment d’exploitation agricole (ancien)",
    1272: "Édifice culturel ou religieux",
    1273: "Monument historique ou classé",
    1274: "Bâtiment non classé ailleurs",
    1275: "Bâtiment d’hébergement collectif spécifique",
    1276: "Bâtiment pour la garde d’animaux",
    1277: "Bâtiment pour les cultures végétales",
    1278: "Autre bâtiment d’exploitation agricole"
};

export const BuildingInfoModal: React.FC<BuildingInfoModalProps> = ({ 
  isOpen, 
  onClose, 
  buildingName, 
  buildingAddress, 
  buildingEgid 
}) => {
  const [gps, setGps] = useState<{lat: number, lon: number} | null>(null);
  const [buildingStats, setBuildingStats] = useState<{
      gbauj?: number; // Année constr.
      garea?: number; // Surface sol
      ganzwhg?: number; // Nombre logements
      gastw?: number; // Nombre niveaux
      gklas?: number; // Typologie
      // CHAUFFAGE
      gwaerzh1?: number; // Generateur 1
      genh1?: number;    // Energie 1
      gwaerzh2?: number; // Generateur 2
      genh2?: number;    // Energie 2
      // EAU CHAUDE
      gwaerzw1?: number; // Generateur ECS 1
      genw1?: number;    // Energie ECS 1
      gwaerzw2?: number; // Generateur ECS 2
      genw2?: number;    // Energie ECS 2
  } | null>(null);
  const [loadingCoords, setLoadingCoords] = useState(false);

  // Fetch coordinates and stats when modal opens and EGID exists
  useEffect(() => {
    if (isOpen && buildingEgid) {
        setLoadingCoords(true);
        // Reset previous data
        setGps(null);
        setBuildingStats(null);
        
        // On demande returnGeometry=true et sr=4326 pour obtenir Latitude/Longitude (WGS84) compatibles Google Maps
        fetch(`https://api3.geo.admin.ch/rest/services/ech/MapServer/find?layer=ch.bfs.gebaeude_wohnungs_register&searchText=${buildingEgid}&searchField=egid&returnGeometry=true&sr=4326&contains=false`)
        .then(res => res.json())
        .then(data => {
            if (data.results && data.results.length > 0) {
                const result = data.results[0];

                // 1. Coordonnées GPS
                if (result.geometry) {
                    setGps({
                        lat: result.geometry.y,
                        lon: result.geometry.x
                    });
                }

                // 2. Données techniques du bâtiment (RegBL)
                if (result.attributes) {
                    setBuildingStats({
                        gbauj: result.attributes.gbauj, // Année
                        garea: result.attributes.garea, // Surface sol
                        ganzwhg: result.attributes.ganzwhg, // Logements
                        gastw: result.attributes.gastw, // Niveaux
                        gklas: result.attributes.gklas, // Typologie
                        
                        // Chauffage
                        gwaerzh1: result.attributes.gwaerzh1,
                        genh1: result.attributes.genh1,
                        gwaerzh2: result.attributes.gwaerzh2,
                        genh2: result.attributes.genh2,

                        // Eau Chaude
                        gwaerzw1: result.attributes.gwaerzw1,
                        genw1: result.attributes.genw1,
                        gwaerzw2: result.attributes.gwaerzw2,
                        genw2: result.attributes.genw2
                    });
                }
            }
        })
        .catch(err => console.error("Erreur récupération données bâtiment", err))
        .finally(() => setLoadingCoords(false));
    }
  }, [isOpen, buildingEgid]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl shadow-xl w-full max-w-md md:max-w-2xl text-slate-900 relative animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* FIXED HEADER */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white shrink-0">
           <h3 className="text-lg font-bold flex items-center gap-2 truncate">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                <Building size={20}/>
              </div>
              <span className="truncate">{buildingName}</span>
           </h3>
           <button 
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full p-2 transition-colors shrink-0"
            >
              <X size={20}/>
            </button>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="overflow-y-auto p-6 space-y-4">
          
          {/* Typologie (GKLAS) - Moved to top */}
          {buildingStats && (
              <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl flex flex-col gap-1 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wide">
                      <LayoutTemplate size={12} />
                      <span>Typologie</span>
                  </div>
                  <div className="font-mono font-bold text-slate-800 text-sm leading-tight">
                      {buildingStats.gklas ? (BUILDING_CATEGORY_CODES[buildingStats.gklas] || buildingStats.gklas) : <span className="text-slate-300 text-sm">-</span>}
                  </div>
              </div>
          )}

          {/* ADRESSE */}
          <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <MapPin className="text-slate-400 mt-0.5 shrink-0" size={18}/>
            <div className="min-w-0">
              <span className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-0.5">Adresse</span>
              <span className="font-medium text-slate-900 block break-words">
                {buildingAddress || "Aucune adresse renseignée"}
              </span>
            </div>
          </div>

          {/* EGID */}
          {buildingEgid && (
            <div className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
              <Hash className="text-slate-400 mt-0.5 shrink-0" size={18}/>
              <div>
                <span className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-0.5">EGID</span>
                <span className="font-mono font-medium text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {buildingEgid}
                </span>
              </div>
            </div>
          )}

          {/* GOOGLE MAPS PREVIEW */}
          {buildingEgid && (
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <Navigation className="text-slate-400 shrink-0" size={18}/>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Localisation</span>
                </div>
                
                {loadingCoords ? (
                    <div className="flex items-center justify-center py-4 text-slate-400 gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-xs">Recherche GPS...</span>
                    </div>
                ) : gps ? (
                    <div className="relative group overflow-hidden rounded-lg shadow-md border border-slate-200">
                         {/* Map Preview (Embed) - Satellite View (t=h for hybrid), Zoom reduced to 18 */}
                         <iframe 
                             width="100%" 
                             height="200" 
                             frameBorder="0" 
                             style={{ border: 0 }} 
                             src={`https://maps.google.com/maps?q=${gps.lat},${gps.lon}&hl=fr&z=18&t=h&output=embed`} 
                             allowFullScreen
                             title="Aperçu Carte Satellite"
                         ></iframe>

                         {/* Direct Link Button */}
                         <a 
                            href={`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lon}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full py-2.5 bg-white hover:bg-slate-50 text-blue-600 font-bold text-xs border-t border-slate-200 transition-colors"
                        >
                            <ExternalLink size={14} />
                            Voir le bâtiment
                        </a>
                    </div>
                ) : (
                    <div className="text-center">
                         <p className="text-xs text-red-400 italic mb-2">Coordonnées introuvables via l'EGID.</p>
                         {buildingAddress && (
                            <a 
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(buildingAddress)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline font-medium"
                            >
                                Essayer via l'adresse
                            </a>
                         )}
                    </div>
                )}
            </div>
          )}

          {/* BUILDING TECHNICAL STATS */}
          {buildingStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-in slide-in-from-bottom-2 duration-300">
                  {/* Année de construction */}
                  <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wide">
                          <Calendar size={12} />
                          <span>Année</span>
                      </div>
                      <div className="font-mono font-bold text-slate-800 text-lg">
                          {buildingStats.gbauj || <span className="text-slate-300 text-sm">-</span>}
                      </div>
                  </div>

                  {/* Surface au sol */}
                  <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wide">
                          <Maximize size={12} />
                          <span>Surface Sol</span>
                      </div>
                      <div className="font-mono font-bold text-slate-800 text-lg">
                          {buildingStats.garea ? `${buildingStats.garea} m²` : <span className="text-slate-300 text-sm">-</span>}
                      </div>
                  </div>

                  {/* Nombre de logements */}
                  <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wide">
                          <Home size={12} />
                          <span>Logements</span>
                      </div>
                      <div className="font-mono font-bold text-slate-800 text-lg">
                          {buildingStats.ganzwhg !== undefined ? buildingStats.ganzwhg : <span className="text-slate-300 text-sm">-</span>}
                      </div>
                  </div>

                  {/* Nombre de niveaux */}
                  <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wide">
                          <Layers size={12} />
                          <span>Niveaux</span>
                      </div>
                      <div className="font-mono font-bold text-slate-800 text-lg">
                          {buildingStats.gastw !== undefined ? buildingStats.gastw : <span className="text-slate-300 text-sm">-</span>}
                      </div>
                  </div>
              </div>
          )}

          {/* HEATING INFO - ALWAYS VISIBLE IF STATS LOADED */}
          {buildingStats && (
            <div className="mt-4 p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-3 animate-in slide-in-from-bottom-3 duration-500">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <Flame className="text-orange-500 shrink-0" size={18}/>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Système de Chauffage</span>
                </div>

                {/* Primary System */}
                <div className="grid grid-cols-2 gap-3">
                     <div className="flex flex-col gap-1">
                         <span className="text-[10px] text-slate-400 font-bold uppercase">Énergie Principale</span>
                         <div className="flex items-center gap-2">
                             <div className="font-medium text-slate-800 text-sm">
                                 {buildingStats.genh1 ? (ENERGY_CODES[buildingStats.genh1] || buildingStats.genh1) : "Inconnu"}
                             </div>
                         </div>
                     </div>
                     <div className="flex flex-col gap-1">
                         <span className="text-[10px] text-slate-400 font-bold uppercase">Générateur P.</span>
                         <div className="flex items-center gap-2">
                             <div className="font-medium text-slate-800 text-sm">
                                 {buildingStats.gwaerzh1 ? (GENERATOR_CODES[buildingStats.gwaerzh1] || buildingStats.gwaerzh1) : "Inconnu"}
                             </div>
                         </div>
                     </div>
                </div>

                {/* Secondary System - Always displayed if buildingStats exists */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 border-dashed">
                    <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                                <Zap size={10} />
                                Énergie Sec.
                            </span>
                            <div className="font-medium text-slate-600 text-sm">
                                {buildingStats.genh2 ? (ENERGY_CODES[buildingStats.genh2] || buildingStats.genh2) : "Inconnu"}
                            </div>
                    </div>
                    <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">Générateur Sec.</span>
                            <div className="font-medium text-slate-600 text-sm">
                                {buildingStats.gwaerzh2 ? (GENERATOR_CODES[buildingStats.gwaerzh2] || buildingStats.gwaerzh2) : "Inconnu"}
                            </div>
                    </div>
                </div>
            </div>
          )}

          {/* HOT WATER INFO (ECS) - NEW SECTION */}
          {buildingStats && (
            <div className="mt-4 p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-3 animate-in slide-in-from-bottom-3 duration-500">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <Droplets className="text-blue-500 shrink-0" size={18}/>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Eau Chaude Sanitaire</span>
                </div>

                {/* Primary ECS */}
                <div className="grid grid-cols-2 gap-3">
                     <div className="flex flex-col gap-1">
                         <span className="text-[10px] text-slate-400 font-bold uppercase">Énergie ECS Princ.</span>
                         <div className="flex items-center gap-2">
                             <div className="font-medium text-slate-800 text-sm">
                                 {buildingStats.genw1 ? (HOT_WATER_ENERGY_CODES[buildingStats.genw1] || buildingStats.genw1) : "Inconnu"}
                             </div>
                         </div>
                     </div>
                     <div className="flex flex-col gap-1">
                         <span className="text-[10px] text-slate-400 font-bold uppercase">Générateur ECS Princ.</span>
                         <div className="flex items-center gap-2">
                             <div className="font-medium text-slate-800 text-sm">
                                 {buildingStats.gwaerzw1 ? (HOT_WATER_GENERATOR_CODES[buildingStats.gwaerzw1] || buildingStats.gwaerzw1) : "Inconnu"}
                             </div>
                         </div>
                     </div>
                </div>

                {/* Secondary ECS - Always displayed if buildingStats exists */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 border-dashed">
                    <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                                <Zap size={10} />
                                Énergie ECS Sec.
                            </span>
                            <div className="font-medium text-slate-600 text-sm">
                                {buildingStats.genw2 ? (HOT_WATER_ENERGY_CODES[buildingStats.genw2] || buildingStats.genw2) : "Inconnu"}
                            </div>
                    </div>
                    <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">Générateur ECS Sec.</span>
                            <div className="font-medium text-slate-600 text-sm">
                                {buildingStats.gwaerzw2 ? (HOT_WATER_GENERATOR_CODES[buildingStats.gwaerzw2] || buildingStats.gwaerzw2) : "Inconnu"}
                            </div>
                    </div>
                </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};