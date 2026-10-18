import React, { useState, useMemo } from 'react';
import { InspectionItem, SchemaDefinition } from '../types';
import { X, Merge, ArrowRight, FolderPlus } from 'lucide-react';
import { sortCategories } from '../constants';

interface Props {
  sourceItem: InspectionItem;
  items: Record<string, InspectionItem>;
  schema: SchemaDefinition;
  onMerge: (targetId: string) => void;
  onRename: (newCategory: string, newSubCategory: string) => void;
  onClose: () => void;
}

export const MergeItemModal: React.FC<Props> = ({ sourceItem, items, schema, onMerge, onRename, onClose }) => {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  
  // For 'new' mode
  const [newCategory, setNewCategory] = useState('');
  const [newSubCategory, setNewSubCategory] = useState('');

  // Group existing items for selection
  const groupedItems = useMemo(() => {
    const groups: Record<string, InspectionItem[]> = {};
    (Object.values(items) as InspectionItem[]).forEach((item) => {
        // Don't list the source item itself or other unknown items
        if (item.id === sourceItem.id) return;
        if (item.category === "Non catégorisé") return;

        const label = `${item.category} > ${item.subCategory}`;
        if (!groups[label]) groups[label] = [];
        groups[label].push(item);
    });
    return groups;
  }, [items, sourceItem.id]);

  // Sort the keys of groupedItems based on Category priority then SubCategory name
  const sortedGroupKeys = useMemo(() => {
     return Object.keys(groupedItems).sort((a, b) => {
         const [catA, subA] = a.split(' > ');
         const [catB, subB] = b.split(' > ');
         
         const catComparison = sortCategories([catA, catB]);
         if (catComparison[0] === catA && catA !== catB) return -1;
         if (catComparison[0] === catB && catA !== catB) return 1;

         return subA.localeCompare(subB);
     });
  }, [groupedItems]);

  const categories = useMemo(() => sortCategories(Object.keys(schema)), [schema]);
  const subCategories = useMemo(() => newCategory ? Object.keys(schema[newCategory] || {}).sort() : [], [newCategory, schema]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50 rounded-t-2xl">
           <h3 className="font-bold text-slate-900 flex items-center gap-2">
             <Merge size={20} className="text-blue-600"/>
             Assigner l'élément
           </h3>
           <button onClick={onClose}><X size={20} className="text-slate-400"/></button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm">
                <span className="text-slate-500 block mb-1">Élément source :</span>
                <span className="font-bold text-slate-800">{sourceItem.subCategory}</span>
                <div className="text-xs text-slate-400 mt-1">{sourceItem.photos.length} photo(s), {Object.keys(sourceItem.attributes).length} attributs</div>
            </div>

            {/* Mode Toggle */}
            <div className="flex bg-slate-100 p-1 rounded-lg">
                <button 
                    onClick={() => setMode('existing')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === 'existing' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Joindre à l'existant
                </button>
                <button 
                    onClick={() => setMode('new')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === 'new' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Créer / Renommer
                </button>
            </div>

            {mode === 'existing' ? (
                <div className="space-y-3 animate-in fade-in">
                    <p className="text-sm text-slate-500">
                        Choisissez un élément existant. Les photos, attributs et commentaires seront fusionnés.
                    </p>
                    <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y">
                        {sortedGroupKeys.length === 0 ? (
                            <div className="p-4 text-center text-slate-400 text-sm italic">Aucun élément existant disponible.</div>
                        ) : (
                            sortedGroupKeys.map((label) => (
                                (groupedItems[label] as InspectionItem[]).map((item: InspectionItem) => (
                                    <button
                                        key={item.id}
                                        onClick={() => onMerge(item.id)}
                                        className="w-full text-left p-3 hover:bg-blue-50 transition-colors flex justify-between items-center group"
                                    >
                                        <div>
                                            <div className="font-medium text-slate-800">{item.subCategory}</div>
                                            <div className="text-xs text-slate-400">{item.category} • {item.photos.length} photos</div>
                                        </div>
                                        <ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500"/>
                                    </button>
                                ))
                            ))
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-4 animate-in fade-in">
                    <p className="text-sm text-slate-500">
                        Définissez la catégorie correcte pour cet élément. Il sera converti en un nouvel élément standard.
                    </p>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Catégorie</label>
                        <select 
                            className="w-full p-2 border rounded-lg" 
                            value={newCategory} 
                            onChange={e => { setNewCategory(e.target.value); setNewSubCategory(""); }}
                        >
                            <option value="">-- Choisir --</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>

                    {newCategory && (
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Sous-catégorie</label>
                            <select 
                                className="w-full p-2 border rounded-lg" 
                                value={newSubCategory} 
                                onChange={e => setNewSubCategory(e.target.value)}
                            >
                                <option value="">-- Choisir --</option>
                                {subCategories.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    )}
                    
                    <button 
                        disabled={!newCategory || !newSubCategory}
                        onClick={() => onRename(newCategory, newSubCategory)}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <FolderPlus size={18} />
                        Créer l'élément
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};