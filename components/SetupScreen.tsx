
import React, { useRef } from 'react';
import { FileSpreadsheet, BookOpen, Upload, ClipboardList } from 'lucide-react';

interface SetupScreenProps {
  onSelectStandard: () => void;
  onSelectCustom: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSelectStandard, onSelectCustom }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerUpload = () => fileInputRef.current?.click();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 p-8 text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-900/50">
            <ClipboardList size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Nouvelle Inspection</h1>
          <p className="text-slate-400">Configurez le référentiel technique avant de commencer.</p>
        </div>

        <div className="p-8 grid md:grid-cols-2 gap-6">
          {/* Option 1: Standard */}
          <button 
            onClick={onSelectStandard}
            className="flex flex-col items-center text-center p-6 rounded-xl border-2 border-slate-100 hover:border-blue-600 hover:bg-blue-50 transition-all group"
          >
            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors">
              <BookOpen size={28} className="text-slate-600 group-hover:text-blue-600" />
            </div>
            <h3 className="font-bold text-slate-800 mb-2">Référentiel Standard</h3>
            <p className="text-sm text-slate-500">
              Utiliser la liste par défaut (~100 champs : Toiture, Façade, Élec, Plomberie...).
            </p>
          </button>

          {/* Option 2: Custom CSV */}
          <button 
            onClick={triggerUpload}
            className="flex flex-col items-center text-center p-6 rounded-xl border-2 border-slate-100 hover:border-indigo-600 hover:bg-indigo-50 transition-all group relative"
          >
            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-indigo-100 transition-colors">
              <FileSpreadsheet size={28} className="text-slate-600 group-hover:text-indigo-600" />
            </div>
            <h3 className="font-bold text-slate-800 mb-2">Importer CSV</h3>
            <p className="text-sm text-slate-500">
              Charger votre propre structure (Catégorie, Sous-catégorie, Champ, Valeur).
            </p>
            <input 
              type="file" 
              ref={fileInputRef}
              className="hidden"
              accept=".csv,.txt"
              onChange={onSelectCustom}
            />
          </button>
        </div>

        <div className="p-6 bg-slate-50 text-center text-xs text-slate-400 border-t border-slate-100">
          Ce choix est définitif pour la durée de cette session. Pour changer, il faudra réinitialiser.
        </div>
      </div>
    </div>
  );
};
