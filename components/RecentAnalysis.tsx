import React from 'react';
import { InspectionResult } from '../types';
import { Check, ArrowRight } from 'lucide-react';

interface RecentAnalysisProps {
  result: InspectionResult | null;
  loading: boolean;
  imagePreview: string | null;
}

export const RecentAnalysis: React.FC<RecentAnalysisProps> = ({ result, loading, imagePreview }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 animate-pulse">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:w-1/3 h-48 bg-slate-200 rounded-xl"></div>
          <div className="w-full md:w-2/3 space-y-4">
            <div className="h-8 bg-slate-200 rounded w-3/4"></div>
            <div className="h-4 bg-slate-200 rounded w-1/2"></div>
            <div className="h-20 bg-slate-200 rounded w-full"></div>
            <div className="h-10 bg-slate-200 rounded w-full"></div>
          </div>
        </div>
        <div className="mt-4 text-center text-blue-600 font-medium flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            Analyse de l'image par l'IA...
        </div>
      </div>
    );
  }

  if (!result || !imagePreview) return null;

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-hidden ring-1 ring-blue-50">
      <div className="bg-blue-50 px-6 py-3 border-b border-blue-100 flex items-center gap-2">
         <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
        </span>
        <h2 className="text-blue-900 font-bold text-sm uppercase tracking-wider">Dernière Analyse</h2>
      </div>
      
      <div className="p-6 flex flex-col md:flex-row gap-6">
        {/* Image Section */}
        <div className="w-full md:w-1/3 shrink-0">
          <div className="relative aspect-video md:aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shadow-inner group">
            <img src={imagePreview} alt="Analysed" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
            <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded backdrop-blur-sm">
              Source
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="mb-1 text-slate-500 text-sm font-medium">Champ identifié</div>
          <h3 className="text-2xl font-bold text-slate-900 mb-2">{result.category} / {result.subCategory}</h3>
          
          <div className="flex items-center gap-4 mb-4">
             <div className="px-3 py-1 bg-slate-100 rounded-lg text-slate-700 font-semibold border border-slate-200">
                {result.attributes["Etat"] || "N/A"}
             </div>
             <div className="text-sm text-slate-500">
               Confiance: <span className="text-slate-900 font-bold">{(result.confiance * 100).toFixed(0)}%</span>
             </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 relative">
            <div className="absolute -left-2 top-6 w-4 h-4 bg-slate-50 border-l border-t border-slate-100 transform -rotate-45 hidden md:block"></div>
            <p className="text-slate-700 italic leading-relaxed">
              "{result.commentaire}"
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};