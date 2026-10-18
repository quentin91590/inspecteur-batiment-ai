import React, { useState, useEffect, useMemo } from 'react';
import { InspectionItem, SchemaDefinition } from '../types';
import { X, Save, Gauge, Trash2, AlertTriangle, ArrowDown, Calculator, Sparkles, Loader2, Diamond } from 'lucide-react';
import { summarizeInspectionComment } from '../services/aiService';
import { AI_COSTS } from '../constants';

interface Props {
  item: InspectionItem;
  schema: SchemaDefinition;
  onSave: (item: InspectionItem) => void;
  onDelete: (itemId: string) => void;
  onClose: () => void;
  userCoins?: number;
  onSpendCoins?: (amount: number) => Promise<boolean>;
}

// === LIFESPAN DATABASE (Durées de vie théoriques) ===
// Mappage basé sur les catégories de l'app vers les durées fournies
const LIFESPAN_DB: Record<string, number> = {
    // -- Gros Œuvre --
    "Gros Œuvre": 98, 
    "Gros Œuvre/Maçonnerie": 98,
    "Gros Œuvre/Charpente": 109, // "Gros œuvre autre"
    
    // -- Toiture --
    "Toiture": 49, // "Toit en pente" par défaut
    "Toiture/Plate": 28, // Si détecté comme toit plat via logique
    "Toiture/Structure": 49,
    "Toiture/Couverture": 49,
    "Toiture/Isolation": 28, // Souvent lié à l'étanchéité

    // -- Façade --
    "Façade": 54,
    
    // -- Fenêtres --
    "Fenêtres": 40,

    // -- Intérieur --
    "Substance & Surface": 29, // "Aménag. int. surfaces" (plus prudent que 42 ou 50)
    "Substance & Surface/Cuisine": 36, // "Agencement de cuisine"
    
    // -- Chauffage --
    "Chauffage": 30, // "Générateur de chaleur" par défaut
    "Chauffage/Distribution de chauffage": 71, // "Distribution de chaleur"
    "Chauffage/Distribution d'ECS": 57, // "Conduites sanitaires"
    
    // -- Ventilation / Clim --
    "Ventilation & Climatisation": 30, // "Install. techn. ventilation & climatisation"
    "Ventilation & Climatisation/Production de froid": 23, // "Installation de réfrigération"
    
    // -- Sanitaires --
    "Sanitaires": 43,
    "Sanitaires/Appareils sanitaires": 50,
    "Sanitaires/Distribution": 57, // "Conduites sanitaires"
    
    // -- Electricité --
    "Electricité courant fort": 57,
    "Electricité courant faible": 26,
    "Eclairage": 30, // Rapprochement "Installation techniques"
    
    // -- Autres --
    "Incendie": 30, // Rapprochement "Installation techniques"
    "Installations de transport": 41, // Ascenseur
    "Installations de transport/Ascenseur": 41,
    "Aménagements extérieurs": 30, // Rapprochement "Install. transport / techn. autres"
    "Parking": 50, // Générique
    "Normes": 999 // Non applicable
};

export const EditFieldModal: React.FC<Props> = ({ item, schema, onSave, onDelete, onClose, userCoins = 0, onSpendCoins }) => {
  const [attributes, setAttributes] = useState(item.attributes);
  const [comment, setComment] = useState(item.commentaire);
  const [score, setScore] = useState(item.averageScore || 50);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  // Get definition for this item type
  const requiredAttrs = (schema[item.category]?.[item.subCategory] || {}) as Record<string, string[]>;

  // Combine requiredAttrs with any extra attributes the item might have
  const allAttrNames = Array.from(new Set([
      ...Object.keys(requiredAttrs), 
      ...Object.keys(attributes)
  ]));

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

  // === AUTOMATIC SCORE RECOMMENDATION LOGIC ===
  const recommendedScore = useMemo(() => {
      // 1. Determine Lifespan (DV)
      let dv = LIFESPAN_DB[`${item.category}/${item.subCategory}`] || LIFESPAN_DB[item.category];
      
      // Special Logic for Roof Type (Plate vs Pente)
      if (item.category === "Toiture" && attributes["Type"]) {
          if (attributes["Type"].toLowerCase().includes("plate")) {
              dv = 28;
          } else {
              dv = 49;
          }
      }

      // Fallback if generic category not found
      if (!dv) dv = 50; // Moyenne par défaut

      // 2. Determine Delta (Age)
      const currentYear = new Date().getFullYear();
      const itemYearStr = attributes["Année"];
      let delta = 0;
      let hasYear = false;

      if (itemYearStr) {
          // Extract first 4 digit number found
          const yearMatch = itemYearStr.match(/\d{4}/);
          if (yearMatch) {
              const year = parseInt(yearMatch[0]);
              if (!isNaN(year) && year > 1800 && year <= currentYear + 1) {
                  delta = currentYear - year;
                  hasYear = true;
              }
          }
      }

      // Rule: Si aucune année n’est renseignée : Utiliser 50 % de la durée de vie théorique comme delta
      if (!hasYear) {
          delta = dv * 0.5;
      }

      // 3. Calculate Wear Ratio (Vétusté %)
      // Vétusté (%) = (delta / DV) * 100
      let wearPercent = (delta / dv) * 100;
      
      // Clamp wear between 0 and 100
      wearPercent = Math.max(0, Math.min(100, wearPercent));

      // 4. Convert Wear to Condition Score (0=Ruine, 100=Neuf)
      // Score = 100 - Vétusté
      const calculatedScore = Math.round(100 - wearPercent);

      return { score: calculatedScore, dv, delta, hasYear };
  }, [item.category, item.subCategory, attributes]);

  const handleAttrChange = (key: string, val: string) => {
      const newAttributes = { ...attributes, [key]: val };
      setAttributes(newAttributes);

      // If user changes 'Etat' dropdown manually, update the numeric score
      // BUT if 'Année' is changed, the useEffect below handles the recommendation visual, 
      // we don't auto-force the score to avoid overwriting user intent immediately.
      if (key === 'Etat' && STATE_MAPPING[val]) {
          setScore(STATE_MAPPING[val]);
      }
  };

  const handleScoreChange = (newScore: number) => {
      setScore(newScore);
      // Update the 'Etat' attribute based on the new score
      const newLabel = getLabelFromScore(newScore);
      if (attributes['Etat'] !== newLabel) {
          setAttributes(prev => ({ ...prev, "Etat": newLabel }));
      }
  };

  const applyRecommendation = () => {
      handleScoreChange(recommendedScore.score);
  };

  const handleSave = () => {
      onSave({
          ...item,
          attributes,
          commentaire: comment,
          averageScore: score, // Save manual score
          isManuallyEdited: true, // Mark as manually edited
          lastUpdated: Date.now()
      });
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (showConfirmDelete) {
          onDelete(item.id);
      } else {
          setShowConfirmDelete(true);
          // Reset confirmation state after 3 seconds if not confirmed
          setTimeout(() => setShowConfirmDelete(false), 3000);
      }
  };

  const handleSummarize = async () => {
      if (!comment || comment.trim().length < 5) return;
      if (userCoins < AI_COSTS.SUMMARY) {
          alert(`Crédits insuffisants. Coût: ${AI_COSTS.SUMMARY} coins.`);
          return;
      }

      // Deduct coins if handler provided
      if (onSpendCoins) {
          const success = await onSpendCoins(AI_COSTS.SUMMARY);
          if (!success) return;
      }

      setIsSummarizing(true);
      try {
          const summary = await summarizeInspectionComment(comment, item.category, item.subCategory);
          setComment(summary);
      } catch (e) {
          console.error("Erreur résumé", e);
      } finally {
          setIsSummarizing(false);
      }
  };

  // Determine color for slider track
  const getScoreColorClass = (s: number) => {
    if (s > 90) return 'accent-emerald-500';
    if (s >= 70) return 'accent-lime-500';
    if (s >= 50) return 'accent-orange-500';
    return 'accent-red-500';
  };

  const canAffordSummary = userCoins >= AI_COSTS.SUMMARY;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50 rounded-t-2xl">
           <div>
               <h3 className="font-bold text-slate-900">Modifier : {item.subCategory}</h3>
               <p className="text-xs text-slate-500">{item.category}</p>
           </div>
           <button onClick={onClose}><X size={20} className="text-slate-400"/></button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
            
            {/* Vétusté / Score Slider */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                <div className="flex justify-between items-end">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <Gauge size={16} className="text-blue-600"/>
                        Niveau de Vétusté
                    </label>
                    <div className="text-right">
                        <span className="text-2xl font-bold text-slate-900">{score}%</span>
                        <span className="text-xs text-slate-500 ml-1">({getLabelFromScore(score)})</span>
                    </div>
                </div>

                <div className="relative h-8 flex items-center">
                    {/* Recommendation Marker */}
                    <div 
                        className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center group/marker z-10 cursor-pointer transition-all duration-500"
                        style={{ left: `${recommendedScore.score}%`, transform: 'translate(-50%, -50%)' }}
                        onClick={applyRecommendation}
                        title={`Préconisation : ${recommendedScore.score}% (Basé sur ${recommendedScore.hasYear ? 'âge réel' : 'défaut'})`}
                    >
                        <ArrowDown size={24} className="text-purple-600 drop-shadow-sm animate-bounce" fill="currentColor" />
                    </div>

                    <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={score} 
                        onChange={(e) => handleScoreChange(parseInt(e.target.value))}
                        className={`w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer relative z-0 ${getScoreColorClass(score)}`}
                    />
                </div>

                <div className="flex justify-between text-[10px] text-slate-400 px-1">
                    <span>Mauvais (0-50)</span>
                    <span>Moyen (50-70)</span>
                    <span>Bon (70-90)</span>
                    <span>Neuf (90+)</span>
                </div>

                {/* Recommendation Info Box */}
                <div className="flex items-center gap-3 bg-purple-50 p-3 rounded-lg border border-purple-100 cursor-pointer hover:bg-purple-100 transition-colors" onClick={applyRecommendation}>
                    <div className="p-2 bg-purple-200 rounded-full text-purple-700">
                        <Calculator size={16} />
                    </div>
                    <div className="flex-1">
                        <div className="text-xs font-bold text-purple-900">
                            Préconisation Auto : {recommendedScore.score}%
                        </div>
                        <div className="text-[10px] text-purple-700">
                            {recommendedScore.hasYear 
                                ? `Âge: ${Math.round(recommendedScore.delta)} ans / Vie: ${recommendedScore.dv} ans`
                                : `Année inconnue (Défaut: 50% de ${recommendedScore.dv} ans)`
                            }
                        </div>
                    </div>
                    <button className="text-xs bg-purple-600 text-white px-2 py-1 rounded shadow-sm hover:bg-purple-700">
                        Appliquer
                    </button>
                </div>
            </div>

            {/* Dynamic Attributes */}
            <div className="grid grid-cols-2 gap-4">
                {allAttrNames.map(attrName => {
                    const options = requiredAttrs[attrName];
                    
                    // If attribute is not in schema, render a simple text input
                    if (!options) {
                        return (
                            <div key={attrName}>
                                <label className="block text-xs font-bold text-slate-700 mb-1">{attrName} <span className="text-orange-500 font-normal ml-1">(Hors schéma)</span></label>
                                <input 
                                    type="text" 
                                    className="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={attributes[attrName] || ""}
                                    onChange={e => handleAttrChange(attrName, e.target.value)}
                                />
                            </div>
                        );
                    }

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
                            <label className="block text-xs font-bold text-slate-700 mb-1">{attrName}</label>
                            {isNumericRange ? (
                                <input 
                                    type="number" 
                                    min={minVal}
                                    max={maxVal}
                                    step={stepVal}
                                    className="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder={`${minVal}-${maxVal}`}
                                    value={attributes[attrName] || ""}
                                    onChange={e => handleAttrChange(attrName, e.target.value)}
                                />
                            ) : (
                                <select 
                                    className="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={attributes[attrName] || ""}
                                    onChange={e => handleAttrChange(attrName, e.target.value)}
                                >
                                    <option value="">Non défini</option>
                                    {attributes[attrName] && !options.includes(attributes[attrName]) && (
                                        <option value={attributes[attrName]}>{attributes[attrName]} (Actuel)</option>
                                    )}
                                    {options.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Comment */}
            <div className="relative">
                <div className="flex justify-between items-end mb-1">
                    <label className="block text-sm font-medium text-slate-700">Commentaire</label>
                    <button 
                        onClick={handleSummarize}
                        disabled={isSummarizing || !comment || !canAffordSummary}
                        className={`text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${canAffordSummary ? 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed'}`}
                        title={canAffordSummary ? `Coût: ${AI_COSTS.SUMMARY} crédits` : "Crédits insuffisants"}
                    >
                        {isSummarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        <span className="flex items-center gap-1">
                            Résumer avec l'IA ({AI_COSTS.SUMMARY} <Diamond size={10} className="text-indigo-600 fill-indigo-600/20" />)
                        </span>
                    </button>
                </div>
                <textarea 
                    className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                    rows={4} 
                    value={comment} 
                    onChange={e => setComment(e.target.value)}
                />
            </div>
        </div>

        <div className="px-6 py-4 border-t bg-slate-50 rounded-b-2xl flex justify-between items-center">
            {/* Delete Button (Icon Only, Homogenized) */}
            <button 
                type="button"
                onClick={handleDeleteClick}
                className={`p-3 rounded-lg transition-all flex items-center justify-center ${
                    showConfirmDelete 
                    ? 'bg-red-600 text-white shadow-md scale-105' 
                    : 'text-red-500 hover:bg-red-50 hover:text-red-700'
                }`}
                title={showConfirmDelete ? "Confirmer la suppression" : "Supprimer"}
            >
                {showConfirmDelete ? <AlertTriangle size={20} className="animate-pulse" /> : <Trash2 size={20} />}
            </button>

            {/* Action Buttons (Right) */}
            <div className="flex gap-3">
                <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium">Annuler</button>
                <button type="button" onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"><Save size={16}/> Enregistrer</button>
            </div>
        </div>
      </div>
    </div>
  );
};