import React, { useState, useMemo, useEffect } from 'react';
import { InspectionItem, SchemaDefinition } from '../types';
import { X, Save, Plus, Gauge } from 'lucide-react';
import { sortCategories } from '../constants';

interface Props {
  schema: SchemaDefinition;
  initialCategory?: string;
  initialSubCategory?: string;
  onSave: (item: InspectionItem) => void;
  onClose: () => void;
}

export const AddManualFieldModal: React.FC<Props> = ({ schema, initialCategory, initialSubCategory, onSave, onClose }) => {
  const [category, setCategory] = useState(initialCategory || "");
  const [subCategory, setSubCategory] = useState(initialSubCategory || "");
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [score, setScore] = useState(50);

  const categories = useMemo(() => sortCategories(Object.keys(schema)), [schema]);
  const subCategories = useMemo(() => category ? Object.keys(schema[category] || {}).sort() : [], [category, schema]);
  const requiredAttrs = useMemo(() => (category && subCategory) ? schema[category]?.[subCategory] || {} : {}, [category, subCategory, schema]) as Record<string, string[]>;

  const STATE_MAPPING: Record<string, number> = {
      "Neuf": 95,
      "Bon": 80,
      "Moyen": 60,
      "Mauvais": 40
  };

  const getLabelFromScore = (s: number): string => {
      if (s > 90) return "Neuf";
      if (s >= 70) return "Bon";
      if (s >= 50) return "Moyen";
      return "Mauvais";
  };

  // Determine color for slider track
  const getScoreColorClass = (s: number) => {
    if (s > 90) return 'accent-emerald-500';
    if (s >= 70) return 'accent-lime-500';
    if (s >= 50) return 'accent-orange-500';
    return 'accent-red-500';
  };

  // Reset attributes if category changes manually, but preserve if it was initial load
  const handleCategoryChange = (val: string) => {
      setCategory(val);
      setSubCategory("");
      setAttributes({});
      setScore(50);
  };

  const handleSubChange = (val: string) => {
      setSubCategory(val);
      setAttributes({});
      setScore(50);
  };

  const handleAttrChange = (key: string, val: string) => {
      setAttributes(prev => ({ ...prev, [key]: val }));
      
      // Sync score with Etat selection
      if (key === 'Etat' && STATE_MAPPING[val]) {
          setScore(STATE_MAPPING[val]);
      }
  };

  const handleScoreChange = (newScore: number) => {
      setScore(newScore);
      // Optional: reverse sync to update 'Etat' dropdown if it exists in attributes
      const newLabel = getLabelFromScore(newScore);
      if (Object.keys(requiredAttrs).includes("Etat") && attributes['Etat'] !== newLabel) {
           setAttributes(prev => ({ ...prev, "Etat": newLabel }));
      }
  };

  const handleSave = () => {
      if (!category || !subCategory) return;
      
      const newItem: InspectionItem = {
          id: `${subCategory}_${Math.random().toString(36).substr(2, 6)}`,
          category,
          subCategory,
          attributes,
          attributeHistory: {}, // Initialize empty history for manual items
          scoreHistory: [score], // Initialize score history
          confiance: 1,
          commentaire: comment,
          isPrimarySubject: true,
          photos: [], // Empty photos
          lastUpdated: Date.now(),
          isManuallyEdited: true,
          averageScore: score 
      };
      onSave(newItem);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50 rounded-t-2xl">
           <h3 className="font-bold text-slate-900">Ajout Manuel</h3>
           <button onClick={onClose}><X size={20} className="text-slate-400"/></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
            {/* Category */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Catégorie</label>
                <select 
                    className="w-full p-2 border rounded-lg" 
                    value={category} 
                    onChange={e => handleCategoryChange(e.target.value)}
                    disabled={!!initialCategory} // Lock if passed initially? Or allow change. Let's allow change but it starts filled.
                >
                    <option value="">-- Choisir --</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            {/* SubCategory */}
            {category && (
                <div className="animate-in fade-in">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Sous-catégorie</label>
                    <select 
                        className="w-full p-2 border rounded-lg" 
                        value={subCategory} 
                        onChange={e => handleSubChange(e.target.value)}
                        disabled={!!initialSubCategory && category === initialCategory}
                    >
                        <option value="">-- Choisir --</option>
                        {subCategories.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
            )}

            {/* Attributes */}
            {subCategory && (
                <div className="space-y-4 animate-in fade-in pt-2 border-t border-slate-100">
                    
                    {/* Score Slider */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                        <div className="flex justify-between items-end">
                            <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                <Gauge size={16} className="text-blue-600"/>
                                État / Vétusté
                            </label>
                            <div className="text-right">
                                <span className="text-xl font-bold text-slate-900">{score}%</span>
                                <span className="text-xs text-slate-500 ml-1">({getLabelFromScore(score)})</span>
                            </div>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={score} 
                            onChange={(e) => handleScoreChange(parseInt(e.target.value))}
                            className={`w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer ${getScoreColorClass(score)}`}
                        />
                        <div className="flex justify-between text-[10px] text-slate-400 px-1">
                            <span>Mauvais</span>
                            <span>Moyen</span>
                            <span>Bon</span>
                            <span>Neuf</span>
                        </div>
                    </div>

                    <h4 className="text-sm font-bold text-slate-900">Caractéristiques</h4>
                    {Object.keys(requiredAttrs).length === 0 ? (
                        <p className="text-sm text-slate-400 italic">Aucun attribut spécifique défini pour cet élément.</p>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            {Object.entries(requiredAttrs).map(([attrName, options]) => {
                                // Check if the attribute definition is a compact numeric range
                                const isNumericRange = options.length === 1 && options[0].startsWith('Numeric:');
                                let minVal = 1900;
                                let maxVal = new Date().getFullYear() + 5;
                                let stepVal = 1;

                                if (isNumericRange) {
                                    const parts = options[0].split(':');
                                    if (parts.length >= 3) {
                                        minVal = parseFloat(parts[1]);
                                        maxVal = parseFloat(parts[parts.length - 1]);
                                        if (parts.length === 4) {
                                            stepVal = parseFloat(parts[2]);
                                        }
                                    }
                                }

                                return (
                                    <div key={attrName}>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">{attrName}</label>
                                        {isNumericRange ? (
                                            <input 
                                                type="number" 
                                                min={minVal}
                                                max={maxVal}
                                                step={stepVal}
                                                className="w-full p-2 border rounded-lg text-sm"
                                                placeholder={`${minVal}-${maxVal}`}
                                                value={attributes[attrName] || ""}
                                                onChange={e => handleAttrChange(attrName, e.target.value)}
                                            />
                                        ) : (
                                            <select 
                                                className="w-full p-2 border rounded-lg text-sm"
                                                value={attributes[attrName] || ""}
                                                onChange={e => handleAttrChange(attrName, e.target.value)}
                                            >
                                                <option value="">-</option>
                                                {options.map(o => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Comment */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Commentaire</label>
                <textarea 
                    className="w-full p-2 border rounded-lg text-sm" 
                    rows={3} 
                    value={comment} 
                    onChange={e => setComment(e.target.value)}
                />
            </div>
        </div>

        <div className="px-6 py-4 border-t bg-slate-50 rounded-b-2xl flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg">Annuler</button>
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50" disabled={!subCategory}>Ajouter</button>
        </div>
      </div>
    </div>
  );
};