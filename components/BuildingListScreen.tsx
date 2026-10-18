import React, { useState, useEffect } from 'react';
import { Building } from '../types';
import { Plus, Building as BuildingIcon, Trash2, ArrowRight, MapPin, Calendar, Diamond, Crown, Search, X, AlertTriangle, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';

interface BuildingListScreenProps {
  buildings: Building[];
  onCreateBuilding: (name: string, address: string, egid: string) => void;
  onSelectBuilding: (id: string) => void;
  onDeleteBuilding: (id: string) => void;
  userCoins?: number;
  userPlan?: 'free' | 'premium' | 'pro';
}

interface BuildingCardItemProps {
    building: Building;
    onSelect: () => void;
    onDelete: () => void;
}

// Internal component to manage individual card state (delete confirmation)
const BuildingCardItem: React.FC<BuildingCardItemProps> = ({ 
    building, 
    onSelect, 
    onDelete 
}) => {
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Auto-reset confirmation after 3 seconds
    useEffect(() => {
        if (confirmDelete) {
            const timer = setTimeout(() => setConfirmDelete(false), 3000);
            return () => clearTimeout(timer);
        }
    }, [confirmDelete]);

    return (
        <div className="group flex items-stretch bg-white rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-blue-300 transition-all overflow-hidden h-32 md:h-28 animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* ZONE 1 : CONTENT (Click to Open) - Layout Horizontal */}
            <div 
                onClick={onSelect}
                className="flex-1 flex items-center p-4 cursor-pointer relative hover:bg-slate-50/50 transition-colors gap-4 min-w-0"
            >
                {/* Icon Box */}
                <div className={`shrink-0 w-14 h-14 rounded-xl flex items-center justify-center shadow-sm transition-transform group-hover:scale-105 ${building.isConfigured ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                    <BuildingIcon size={26} strokeWidth={1.5} />
                </div>

                {/* Text Info */}
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-slate-900 truncate text-base">{building.name}</h3>
                        {/* Status Badge */}
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border flex items-center gap-1 shrink-0 ${building.isConfigured ? 'bg-green-50 text-green-700 border-green-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
                            {building.isConfigured ? <CheckCircle2 size={10} /> : <CircleDashed size={10} />}
                            <span className="hidden sm:inline">{building.isConfigured ? 'Actif' : 'Brouillon'}</span>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs text-slate-500">
                        {building.address ? (
                            <div className="flex items-center gap-1 truncate max-w-[200px]">
                                <MapPin size={12} className="shrink-0" />
                                <span className="truncate">{building.address}</span>
                            </div>
                        ) : (
                            <span className="italic text-slate-400">Sans adresse</span>
                        )}

                        {building.egid && (
                            <div className="flex items-center gap-1 text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                <span className="text-[10px] font-bold text-slate-500">EGID :</span>
                                <span className="font-mono font-medium">{building.egid}</span>
                            </div>
                        )}
                        
                        <div className="flex items-center gap-1 text-slate-400 whitespace-nowrap ml-auto sm:ml-0">
                            <Calendar size={12} />
                            <span>{new Date(building.updatedAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>

                {/* Chevron Arrow (Visual Hint) */}
                <div className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all">
                    <ArrowRight size={20} />
                </div>
            </div>

            {/* ZONE 2 : SIDEBAR ACTIONS (Delete) */}
            <div 
                className={`w-16 border-l border-slate-100 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer select-none shrink-0 ${
                    confirmDelete 
                    ? 'bg-red-500 text-white' 
                    : 'bg-slate-50 text-slate-400 hover:bg-red-50 hover:text-red-500'
                }`}
                onClick={(e) => { 
                    e.preventDefault();
                    e.stopPropagation(); 
                    if (confirmDelete) {
                        onDelete();
                    } else {
                        setConfirmDelete(true);
                    }
                }}
                title={confirmDelete ? "Confirmer la suppression" : "Supprimer"}
            >
                {confirmDelete ? (
                    <div className="flex flex-col items-center gap-1 animate-in zoom-in duration-200">
                        <AlertTriangle size={20} fill="currentColor" className="text-white" />
                        <span className="text-[9px] font-bold uppercase leading-tight">Sûr ?</span>
                    </div>
                ) : (
                    <Trash2 size={20} strokeWidth={1.5} />
                )}
            </div>
        </div>
    );
};

export const BuildingListScreen: React.FC<BuildingListScreenProps> = ({ 
  buildings, 
  onCreateBuilding, 
  onSelectBuilding, 
  onDeleteBuilding,
  userCoins,
  userPlan
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newEgid, setNewEgid] = useState(""); // State for EGID
  const [searchTerm, setSearchTerm] = useState("");

  // Address Autocomplete State
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // SEARCH ADDRESS EFFECT
  useEffect(() => {
    // Only search if user is actively typing (isSearchingAddress) and text is long enough
    if (!isSearchingAddress || newAddress.length < 3) {
        setAddressSuggestions([]);
        return;
    }

    const timer = setTimeout(async () => {
        try {
            const response = await fetch(`https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(newAddress)}&type=locations`);
            const data = await response.json();
            setAddressSuggestions(data.results || []);
            setShowSuggestions(true);
        } catch (error) {
            console.error("Erreur recherche adresse:", error);
        }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [newAddress, isSearchingAddress]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) {
      onCreateBuilding(newName, newAddress, newEgid);
      setIsCreating(false);
      resetForm();
    }
  };

  const resetForm = () => {
      setNewName("");
      setNewAddress("");
      setNewEgid("");
      setAddressSuggestions([]);
      setShowSuggestions(false);
  };

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setNewAddress(e.target.value);
      setIsSearchingAddress(true);
  };

  const selectAddress = (suggestion: any) => {
      // Nettoyage des balises HTML (ex: <b>) pour la valeur du champ
      const cleanLabel = suggestion.attrs.label.replace(/<[^>]*>?/gm, '');
      setNewAddress(cleanLabel);
      
      // Extraction automatique de l'EGID depuis le featureId
      // Format API: "2118772_0" -> On veut "2118772"
      if (suggestion.attrs.featureId) {
          const rawId = String(suggestion.attrs.featureId);
          const extractedEgid = rawId.split('_')[0];
          setNewEgid(extractedEgid);
      }
      
      setAddressSuggestions([]);
      setShowSuggestions(false);
      setIsSearchingAddress(false);
  };

  const filteredBuildings = buildings.filter(b => 
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (b.address && b.address.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (b.egid && b.egid.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-900/20 text-white">
                <BuildingIcon size={32} />
              </div>
              Mes Audits
            </h1>
            <p className="text-slate-500 mt-2 ml-1">
              Gérez vos bâtiments et rapports d'audit.
            </p>
          </div>

          {/* User Stats Card */}
          {userCoins !== undefined && (
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-6">
               <div className="flex flex-col">
                  <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Plan Actuel</span>
                  <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                     <Crown size={16} className={userPlan === 'pro' ? 'text-purple-500' : 'text-slate-400'} />
                     <span className="capitalize">{userPlan || 'Free'}</span>
                  </div>
               </div>
               <div className="w-px h-8 bg-slate-100"></div>
               <div className="flex flex-col">
                  <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Crédits</span>
                  <div className="flex items-center gap-1.5 text-slate-800 font-bold">
                     <Diamond size={16} className="text-sky-500 fill-sky-500/20" />
                     {userCoins.toLocaleString()}
                  </div>
               </div>
            </div>
          )}
        </div>

        {/* Action & Search Bar */}
        <div className="flex flex-col md:flex-row gap-4">
           <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input 
                type="text" 
                placeholder="Rechercher par nom, adresse ou EGID..." 
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
           </div>
           <button 
              onClick={() => setIsCreating(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all hover:scale-105 shrink-0"
           >
              <Plus size={20} />
              Nouvel Audit
           </button>
        </div>

        {/* Create Form */}
        {isCreating && (
            <div className="bg-white p-6 rounded-2xl shadow-xl border border-blue-100 animate-in slide-in-from-top-4 relative z-10">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-slate-800">Ajouter un audit</h3>
                    <button onClick={() => { setIsCreating(false); resetForm(); }} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                </div>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Nom de l'audit / Projet</label>
                        <input 
                            type="text" 
                            required 
                            autoFocus
                            className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Ex: Résidence Les Fleurs"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                        />
                    </div>
                    
                    {/* Row for Address and EGID */}
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <label className="block text-sm font-medium text-slate-700 mb-1">Adresse (Autocomplétion Suisse)</label>
                            <input 
                                type="text" 
                                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="Commencez à taper une adresse..."
                                value={newAddress}
                                onChange={handleAddressChange}
                                autoComplete="off"
                            />
                            {/* Autocomplete Dropdown */}
                            {showSuggestions && addressSuggestions.length > 0 && (
                                <ul className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto z-50">
                                    {addressSuggestions.map((suggestion: any) => (
                                        <li 
                                            key={suggestion.id}
                                            onClick={() => selectAddress(suggestion)}
                                            className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm text-slate-700 border-b border-slate-50 last:border-0 flex items-center gap-2"
                                        >
                                            <MapPin size={14} className="text-slate-400 shrink-0" />
                                            {/* Affichage du HTML (gras) pour meilleure lisibilité dans la liste */}
                                            <span dangerouslySetInnerHTML={{ __html: suggestion.attrs.label }}></span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className="w-full md:w-1/3">
                            <label className="block text-sm font-medium text-slate-700 mb-1">EGID</label>
                            <input 
                                type="text" 
                                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                                placeholder="Ex: 123456"
                                value={newEgid}
                                onChange={e => setNewEgid(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-2">
                        <button type="button" onClick={() => { setIsCreating(false); resetForm(); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium">Annuler</button>
                        <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-md">Créer</button>
                    </div>
                </form>
            </div>
        )}

        {/* Grid List - Single Column on Mobile, Two on Desktop */}
        <div className="grid grid-cols-1 gap-4">
            {filteredBuildings.length === 0 ? (
                <div className="py-12 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
                    <BuildingIcon size={48} className="mx-auto mb-4 opacity-20" />
                    <p>Aucun audit trouvé.</p>
                    {buildings.length === 0 && <p className="text-sm">Commencez par créer un nouvel audit.</p>}
                </div>
            ) : (
                filteredBuildings.map(building => (
                    <BuildingCardItem 
                        key={building.id}
                        building={building}
                        onSelect={() => onSelectBuilding(building.id)}
                        onDelete={() => onDeleteBuilding(building.id)}
                    />
                ))
            )}
        </div>

      </div>
    </div>
  );
};