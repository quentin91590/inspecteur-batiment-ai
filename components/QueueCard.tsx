import React, { useState } from 'react';
import { QueueItem } from '../types';
import { Loader2, Clock, AlertCircle, RotateCcw, X, AlertTriangle, Mic, Link } from 'lucide-react';

interface QueueCardProps {
  item: QueueItem;
  onRetry: () => void;
  onRemove: () => void;
  onView: () => void;
  onManualResolve: () => void;
}

export const QueueCard: React.FC<QueueCardProps> = ({ item, onRetry, onRemove, onView, onManualResolve }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
        onRemove();
    } else {
        setConfirmDelete(true);
        setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  const isAudio = item.type === 'audio';

  return (
    <div className={`relative p-3 rounded-xl border shadow-sm flex gap-4 overflow-hidden group transition-all ${isAudio ? 'bg-indigo-50/50 border-indigo-200' : 'bg-white border-slate-200'}`}>
      
      {/* Remove Button */}
      <button 
        onClick={handleRemoveClick}
        className={`absolute top-2 right-2 p-1.5 rounded-full transition-colors z-30 ${
            confirmDelete 
            ? 'bg-red-600 text-white shadow-md animate-pulse' 
            : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
        }`}
        title={confirmDelete ? "Confirmer ?" : "Supprimer"}
        type="button"
      >
        {confirmDelete ? <AlertTriangle size={16} /> : <X size={16} />}
      </button>

      {/* Thumbnail or Audio Icon */}
      <div 
        className={`relative w-20 h-20 shrink-0 rounded-lg overflow-hidden border cursor-pointer flex items-center justify-center shadow-inner ${isAudio ? 'bg-gradient-to-br from-indigo-500 to-purple-600 border-indigo-300' : 'bg-slate-100 border-slate-100'}`}
        onClick={onView}
      >
        {isAudio ? (
             <div className="text-white flex flex-col items-center gap-1 animate-in zoom-in">
                 <Mic size={24} />
                 <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">Vocal</span>
             </div>
        ) : (
            <img 
              src={item.imageBase64} 
              alt="En attente" 
              className="w-full h-full object-cover opacity-90"
            />
        )}
        
        {/* Overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/10 transition-colors z-10">
          
          {item.status === 'pending' && !isAudio && (
            <Clock className="text-white drop-shadow-md" size={24} />
          )}
          
          {item.status === 'error' && (
            <div className="flex items-center gap-2 z-20">
                <button 
                    onClick={(e) => { e.stopPropagation(); onManualResolve(); }}
                    className="bg-orange-500 hover:bg-orange-600 text-white w-8 h-8 rounded-full shadow-lg transition-transform hover:scale-110 flex items-center justify-center animate-in zoom-in duration-200 cursor-pointer"
                    title="Lier / Classer manuellement"
                    type="button"
                >
                    <Link size={16} />
                </button>
                <button 
                    onClick={(e) => { e.stopPropagation(); onRetry(); }}
                    className="bg-red-500 hover:bg-red-600 text-white w-8 h-8 rounded-full shadow-lg transition-transform hover:scale-110 flex items-center justify-center animate-in zoom-in duration-200 cursor-pointer"
                    title="Réessayer"
                    type="button"
                >
                    <RotateCcw size={16} />
                </button>
            </div>
          )}
        </div>
      </div>

      {/* Content Placeholder */}
      <div className="flex-1 flex flex-col justify-center gap-2 pr-6 min-w-0">
        <div className="flex justify-between items-start">
           {isAudio ? (
               <div className="text-sm font-semibold text-indigo-900 line-clamp-2 italic bg-indigo-100/50 p-1.5 rounded-lg border border-indigo-100/50 w-full">
                   "{item.textPayload}"
               </div>
           ) : item.source === 'guided' ? (
               <div className="min-w-0 w-full">
                   <div className="text-[10px] font-bold uppercase tracking-wide text-purple-600">Visite guidée</div>
                   <div className="text-sm font-semibold text-slate-800 truncate">{item.target || 'Photo hors réseau'}</div>
                   {item.note && <div className="text-xs text-slate-500 italic truncate">« {item.note} »</div>}
               </div>
           ) : (
               <div className={`h-5 rounded w-1/3 ${item.status === 'error' ? 'bg-red-50' : 'bg-slate-100 animate-pulse'}`}></div>
           )}
        </div>
        
        {item.status === 'analyzing' ? (
          <div className="text-blue-600 text-xs font-bold uppercase tracking-wide flex items-center gap-2">
            <Loader2 size={12} className="animate-spin shrink-0" />
            <span className="truncate">{item.progressStep || "Analyse..."}</span>
          </div>
        ) : item.status === 'pending' ? (
           <div className="text-slate-400 text-xs font-medium flex items-center gap-1.5">
            <Clock size={12} />
            {item.progressStep || 'En attente...'}
          </div>
        ) : (
          <div className="text-red-600 text-sm font-medium flex flex-col gap-1">
             <div className="flex items-center gap-2">
                <AlertCircle size={14} />
                <span>Erreur</span>
             </div>
             <span className="text-xs text-red-400 truncate w-full" title={item.error}>{item.error || "Inconnue"}</span>
          </div>
        )}

        {item.status !== 'error' && !isAudio && item.source !== 'guided' && (
          <div className="space-y-1 opacity-60">
             <div className="h-2 bg-slate-100 rounded w-3/4 animate-pulse"></div>
          </div>
        )}
      </div>
      
      {/* Progress Bar for analyzing */}
      {item.status === 'analyzing' && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-100/50">
          <div className="h-full bg-blue-500 animate-[progress_2s_ease-in-out_infinite] w-full origin-left"></div>
        </div>
      )}
    </div>
  );
}