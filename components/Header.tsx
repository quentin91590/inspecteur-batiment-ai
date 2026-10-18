import React, { useState } from 'react';
import { HardHat, WifiOff, ArrowLeft, Archive, Diamond, Crown, FileText, Loader2, Check, AlertTriangle, Info } from 'lucide-react';
import { BuildingInfoModal } from './BuildingInfoModal';

interface HeaderProps {
  isOffline?: boolean;
  buildingName?: string;
  buildingAddress?: string;
  buildingEgid?: string;
  onBack?: () => void;
  onDownload?: () => void;
  onViewReport?: () => void;
  isDownloading?: boolean;
  isGeneratingReport?: boolean;
  userCoins?: number;
  userPlan?: 'free' | 'premium' | 'pro';
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
}

export const Header: React.FC<HeaderProps> = ({ 
  isOffline, 
  buildingName, 
  buildingAddress,
  buildingEgid,
  onBack, 
  onDownload, 
  onViewReport,
  isDownloading,
  isGeneratingReport,
  userCoins,
  userPlan,
  saveStatus
}) => {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <button 
                onClick={onBack}
                className="p-2 -ml-2 hover:bg-slate-800 rounded-full text-slate-300 hover:text-white transition-colors"
                title="Retour à la liste"
              >
                <ArrowLeft size={24} />
              </button>
            )}
            
            <div className="p-2 bg-blue-600 rounded-lg hidden xs:block">
              <HardHat size={24} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                  <h1 className="text-xl font-bold tracking-tight line-clamp-1">
                  {buildingName || "Inspecteur Bâtiment AI"}
                  </h1>

                  {/* INFO BUTTON */}
                  {buildingName && (
                    <button 
                      onClick={() => setShowInfo(true)}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
                      title="Informations du bâtiment"
                    >
                      <Info size={18} />
                    </button>
                  )}
                  
                  {/* SAVE STATUS INDICATOR */}
                  {saveStatus && saveStatus !== 'idle' && (
                      <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 bg-slate-800 rounded-md text-xs font-medium animate-in fade-in zoom-in duration-300">
                          {saveStatus === 'saving' && (
                              <>
                                  <Loader2 size={12} className="text-slate-400 animate-spin" />
                                  <span className="text-slate-400">Sauvegarde...</span>
                              </>
                          )}
                          {saveStatus === 'saved' && (
                              <>
                                  <Check size={12} className="text-green-400" />
                                  <span className="text-green-400">Enregistré</span>
                              </>
                          )}
                          {saveStatus === 'error' && (
                              <>
                                  <AlertTriangle size={12} className="text-red-400" />
                                  <span className="text-red-400">Erreur Sauvegarde</span>
                              </>
                          )}
                      </div>
                  )}
              </div>
              
              <p className="text-xs text-slate-400 hidden sm:block">
                {buildingName ? "Rapport d'inspection" : "Assistant d'inspection IA"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            
            {/* Credits / Plan Display */}
            {userCoins !== undefined && (
              <div className="flex items-center gap-3 bg-slate-800 rounded-full px-3 py-1.5 border border-slate-700">
                  <div className="flex items-center gap-1.5" title="Solde de crédits">
                      <Diamond size={14} className="text-sky-400 shrink-0 fill-sky-400/20" />
                      <span className="font-bold text-sm text-sky-100">{userCoins}</span>
                  </div>
                  {userPlan && (
                      <div className="hidden sm:flex items-center gap-1.5 border-l border-slate-600 pl-3">
                          <Crown size={14} className={userPlan === 'pro' ? 'text-purple-400' : 'text-slate-400'} />
                          <span className="text-xs font-bold uppercase text-slate-300">{userPlan}</span>
                      </div>
                  )}
              </div>
            )}

            {/* Report Viewer Button (Placed between Credits and Export) */}
            {onViewReport && (
               <button 
                  onClick={onViewReport}
                  disabled={isGeneratingReport}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg border border-indigo-500 transition-all disabled:opacity-50 shadow-sm"
                  title="Voir le rapport PDF"
               >
                  {isGeneratingReport ? (
                      <Loader2 size={18} className="animate-spin text-white/80" />
                  ) : (
                      <FileText size={18} className="text-white" />
                  )}
                  <span className="hidden sm:inline text-sm font-medium">Rapport</span>
               </button>
            )}

            {/* Export Button */}
            {onDownload && (
               <button 
                  onClick={onDownload}
                  disabled={isDownloading}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg border border-slate-700 transition-all disabled:opacity-50"
                  title="Télécharger Rapport + Photos (ZIP)"
               >
                  {isDownloading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                      <Archive size={18} className="text-blue-400" />
                  )}
                  <span className="hidden sm:inline text-sm font-medium">Export</span>
               </button>
            )}

            {isOffline && (
              <div className="flex items-center gap-2 px-2 sm:px-3 py-1 bg-red-500/20 border border-red-500/50 text-red-200 rounded-full text-sm font-medium animate-pulse" title="Hors ligne">
                <WifiOff size={14} />
                <span className="hidden sm:inline">Hors ligne</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* BUILDING INFO MODAL */}
      <BuildingInfoModal 
        isOpen={showInfo} 
        onClose={() => setShowInfo(false)} 
        buildingName={buildingName}
        buildingAddress={buildingAddress}
        buildingEgid={buildingEgid}
      />
    </>
  );
};