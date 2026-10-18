import React, { useRef, useState } from 'react';
import { InspectionItem } from '../types';
import { Pencil, Camera, Image as ImageIcon, Clock, Upload, X, ChevronRight, Gauge, Link, AlertTriangle } from 'lucide-react';

interface FieldCardProps {
  field: InspectionItem;
  missingAttributes?: string[]; // New Prop
  onEdit: () => void;
  onViewGallery: () => void;
  onAddPhoto: (file: File) => Promise<void> | void;
  onMerge?: () => void; // Optional merge handler
}

export const FieldCard: React.FC<FieldCardProps> = ({ field, missingAttributes = [], onEdit, onViewGallery, onAddPhoto, onMerge }) => {
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  
  // Last image logic
  const lastImage = field.photos.length > 0 ? field.photos[field.photos.length - 1].imageUrl : null;
  const isUnknown = field.category === "Non catégorisé";

  // Determine color based on average score
  const getScoreColor = (score: number) => {
      if (score > 90) return { bg: 'bg-emerald-500', text: 'text-emerald-700', bgLight: 'bg-emerald-50' };
      if (score >= 70) return { bg: 'bg-lime-500', text: 'text-lime-700', bgLight: 'bg-lime-50' };
      if (score >= 50) return { bg: 'bg-orange-500', text: 'text-orange-700', bgLight: 'bg-orange-50' };
      return { bg: 'bg-red-500', text: 'text-red-700', bgLight: 'bg-red-50' };
  };

  const score = field.averageScore ?? 50; // Default to 50 if undefined
  const color = getScoreColor(score);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          onAddPhoto(file);
          setShowSourceMenu(false);
      }
      // Reset value to allow selecting same file again if needed
      e.target.value = '';
  };

  return (
    <div className={`bg-white rounded-lg shadow-sm border p-3 hover:border-blue-300 transition-colors flex flex-col gap-2 relative overflow-hidden group ${isUnknown ? 'border-orange-200 bg-orange-50/30' : 'border-slate-200'}`}>
      
      {/* ALERT BANNER FOR MISSING ATTRIBUTES */}
      {missingAttributes.length > 0 && !isUnknown && (
          <div className="flex items-start gap-2 p-2 bg-orange-50 border border-orange-100 rounded-md text-xs text-orange-800 mb-1">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-orange-600" />
              <div>
                  <span className="font-bold block">Incomplet</span>
                  <span className="opacity-80">Manque : {missingAttributes.join(', ')}</span>
              </div>
          </div>
      )}

      <div className="flex gap-4">
        {/* Source Selection Overlay - Minimalist Design */}
        {showSourceMenu && (
            <div className="absolute inset-0 z-20 bg-white flex items-center animate-in fade-in duration-200">
                {/* Close Button */}
                <button 
                    onClick={(e) => { e.stopPropagation(); setShowSourceMenu(false); }}
                    className="absolute top-1 right-1 p-2 text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-full transition-colors z-30"
                >
                    <X size={18} />
                </button>
                
                <div className="flex w-full h-full">
                    {/* Camera Option */}
                    <button 
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center text-indigo-600 hover:bg-indigo-50 transition-colors active:scale-95"
                        title="Appareil Photo"
                    >
                        <Camera size={28} strokeWidth={1.5} />
                    </button>

                    {/* Fine Divider */}
                    <div className="w-px h-12 bg-slate-100 self-center"></div>

                    {/* Gallery Option */}
                    <button 
                        onClick={() => galleryInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center text-blue-600 hover:bg-blue-50 transition-colors active:scale-95"
                        title="Galerie"
                    >
                        <Upload size={28} strokeWidth={1.5} />
                    </button>
                </div>
            </div>
        )}

        {/* Hidden Inputs */}
        <input type="file" ref={galleryInputRef} hidden accept="image/*" onChange={handleFileChange} />
        <input type="file" ref={cameraInputRef} hidden accept="image/*" capture="environment" onChange={handleFileChange} />

        {/* Thumbnail - Clean View Only */}
        <div 
            className="w-24 h-24 bg-slate-100 rounded-lg overflow-hidden shrink-0 relative cursor-pointer border border-slate-100 group/thumb"
            onClick={lastImage ? onViewGallery : () => setShowSourceMenu(true)}
        >
            {lastImage ? (
                <>
                    <img src={lastImage} className="w-full h-full object-cover" alt="Thumbnail" />
                    <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover/thumb:opacity-100">
                        <ChevronRight className="text-white drop-shadow-md" size={24} />
                    </div>
                </>
            ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors">
                    <ImageIcon size={24}/>
                </div>
            )}
            
            {/* Photo Count Badge */}
            {field.photos.length > 0 && (
                <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-sm font-medium">
                    {field.photos.length}
                </div>
            )}
        </div>

        {/* Content Side */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div>
                <div className="flex justify-between items-start gap-2 mb-1">
                    <div className="flex flex-col">
                        <h4 className={`font-bold leading-tight truncate text-sm sm:text-base ${isUnknown ? 'text-orange-700' : 'text-slate-900'}`}>{field.subCategory}</h4>
                        {/* Condition Badge */}
                        <div className={`flex items-center gap-1.5 mt-1 self-start px-2 py-0.5 rounded-md ${color.bgLight} border border-transparent`}>
                            <div className={`w-2 h-2 rounded-full ${color.bg}`}></div>
                            <span className={`text-[10px] font-bold uppercase ${color.text}`}>
                                {field.attributes["Etat"] || "Inconnu"}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium border-l border-slate-200 pl-1.5 ml-0.5">
                                {score}%
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-1">
                        {/* Merge Button for Unknown items */}
                        {isUnknown && onMerge && (
                            <button 
                                onClick={onMerge}
                                className="p-1.5 text-orange-400 hover:text-orange-600 hover:bg-orange-100 rounded-md transition-colors animate-pulse"
                                title="Lier à un élément existant"
                            >
                                <Link size={16} />
                            </button>
                        )}
                        <button 
                            onClick={onEdit}
                            className={`p-1.5 rounded-md transition-colors ${missingAttributes.length > 0 ? 'text-orange-500 bg-orange-50 hover:bg-orange-100' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                            title="Modifier les détails"
                        >
                            <Pencil size={16} />
                        </button>
                    </div>
                </div>
                
                {/* Dynamic Attributes Grid (Filtered: Don't show "Etat" again as we show it in header) */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2">
                    {Object.entries(field.attributes)
                    .filter(([key]) => key !== "Etat")
                    .map(([key, val]) => (
                        <div key={key} className="text-xs truncate">
                            <span className="text-slate-500">{key}: </span>
                            <span className="font-medium text-slate-800">{val}</span>
                        </div>
                    ))}
                </div>
            </div>
            
            {/* Footer Actions */}
            <div className="flex justify-between items-end gap-2 mt-2">
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500 italic line-clamp-1">{field.commentaire}</p>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
                        <Clock size={10}/>
                        <span>{new Date(field.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                </div>

                <button 
                    onClick={() => setShowSourceMenu(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-all shadow-sm active:scale-95 shrink-0"
                >
                    <Camera size={14} />
                    <span>Ajouter</span>
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};