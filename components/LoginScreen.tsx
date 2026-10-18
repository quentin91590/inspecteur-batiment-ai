
import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../firebaseConfig';
import { HardHat, ShieldCheck, Cloud, AlertTriangle, Globe, User } from 'lucide-react';

interface LoginScreenProps {
  onGuestLogin: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onGuestLogin }) => {
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    try {
      if (!isFirebaseConfigured) {
        setError("Firebase n'est pas configuré. Veuillez mettre à jour firebaseConfig.ts");
        return;
      }
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Login Error:", err);
      
      const errorCode = err.code || '';
      const errorMessage = err.message || '';

      // Gestion des erreurs courantes de configuration Firebase
      if (errorCode === 'auth/configuration-not-found' || errorCode === 'auth/operation-not-allowed') {
        setError("Erreur de configuration : L'authentification Google n'est pas activée dans votre console Firebase.");
      } else if (errorCode === 'auth/popup-closed-by-user') {
        setError("La connexion a été annulée.");
      } else if (errorCode === 'auth/unauthorized-domain' || errorMessage.includes('auth/unauthorized-domain')) {
        // On force la détection du domaine ici pour être sûr
        const currentDomain = window.location.hostname;
        setError(`Domaine non autorisé détecté.`);
      } else {
        setError("Erreur : " + errorMessage);
      }
    }
  };

  // Helper pour obtenir le domaine actuel de façon robuste pour l'affichage
  const getCurrentDomain = () => {
    return window.location.hostname || window.location.host || 'Domaine inconnu';
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-blue-600 p-8 text-center">
          <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6 backdrop-blur-sm">
            <HardHat size={40} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Inspecteur Bâtiment AI</h1>
          <p className="text-blue-100">Assistant d'inspection intelligent</p>
        </div>

        <div className="p-8">
          <div className="space-y-6">
            
            <div className="space-y-4">
               <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                 <Cloud className="text-blue-500 shrink-0 mt-0.5" size={20} />
                 <div>
                   <h3 className="font-bold text-slate-800 text-sm">Sauvegarde Cloud</h3>
                   <p className="text-xs text-slate-500">Vos inspections sont synchronisées et accessibles partout.</p>
                 </div>
               </div>
               <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                 <ShieldCheck className="text-emerald-500 shrink-0 mt-0.5" size={20} />
                 <div>
                   <h3 className="font-bold text-slate-800 text-sm">Sécurité Google</h3>
                   <p className="text-xs text-slate-500">Authentification sécurisée via votre compte Google.</p>
                 </div>
               </div>
            </div>

            {/* Error Display with actionable advice */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                <div className="flex items-start gap-2 mb-2 font-bold text-red-700">
                   <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                   Problème de connexion
                </div>
                <p className="mb-2 break-words font-medium">{error}</p>
                
                {error.includes("configuration") && (
                   <div className="mt-2 pt-2 border-t border-red-200 text-xs bg-white/50 p-2 rounded">
                      <strong>Solution Rapide :</strong>
                      <ol className="list-decimal ml-4 mt-1 space-y-1">
                        <li>Allez sur <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="underline font-bold text-blue-700">console.firebase.google.com</a></li>
                        <li>Ouvrez votre projet <b>inspectionbat</b></li>
                        <li>Dans le menu gauche, cliquez sur <b>Authentication</b></li>
                        <li>Cliquez sur le bouton <b>Get Started</b> (si visible)</li>
                        <li>Allez dans l'onglet <b>Sign-in method</b></li>
                        <li>Cliquez sur <b>Google</b> et activez le switch (Enable).</li>
                        <li>N'oubliez pas de renseigner l'email de support et de <b>Sauvegarder</b>.</li>
                      </ol>
                   </div>
                )}

                {(error.includes("Domaine non autorisé")) && (
                   <div className="mt-3 pt-3 border-t border-red-200 text-xs bg-white/80 p-3 rounded shadow-sm">
                      <div className="flex items-center gap-2 font-bold text-slate-800 mb-2">
                        <Globe size={14} className="text-blue-600" />
                        ACTION REQUISE : Autoriser ce domaine
                      </div>
                      <p className="mb-2 text-slate-600">Pour des raisons de sécurité, Firebase bloque les domaines inconnus. Copiez l'adresse ci-dessous :</p>
                      
                      <div className="relative group">
                        <code className="block w-full bg-slate-800 text-white p-3 rounded mb-2 font-mono text-center font-bold select-all break-all border-2 border-slate-200">
                            {getCurrentDomain()}
                        </code>
                        <div className="text-[10px] text-center text-slate-400 mb-2">(Double-cliquez pour sélectionner)</div>
                      </div>

                      <ol className="list-decimal ml-4 mt-2 space-y-2 text-slate-700">
                        <li>Allez sur la <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="underline font-bold text-blue-600">Console Firebase</a></li>
                        <li>Allez dans <b>Authentication</b> &gt; <b>Settings</b></li>
                        <li>Cliquez sur l'onglet <b>Authorized domains</b></li>
                        <li>Cliquez sur <b>Add domain</b></li>
                        <li>Collez le domaine ci-dessus et validez.</li>
                      </ol>
                   </div>
                )}
              </div>
            )}

            {!isFirebaseConfigured && (
                 <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-800">
                    <strong>Configuration requise :</strong>
                    <ol className="list-decimal ml-4 mt-1 space-y-1">
                        <li>Ouvrez le fichier <code>firebaseConfig.ts</code></li>
                        <li>Remplacez les valeurs par celles de votre projet Firebase</li>
                    </ol>
                 </div>
            )}

            <div className="space-y-3">
              {/* Skip Auth Button */}
              <button
                onClick={onGuestLogin}
                className="w-full flex items-center justify-center gap-2 bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-600 font-semibold py-2 px-4 rounded-xl transition-all text-sm"
              >
                <User size={16} />
                <span>Mode Invité (Skip Auth)</span>
              </button>

              <button
                onClick={handleLogin}
                className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-3 px-4 rounded-xl transition-all shadow-sm group"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                <span>Continuer avec Google</span>
              </button>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-slate-50 text-center text-xs text-slate-400 border-t border-slate-100">
          En continuant, vous acceptez de sauvegarder vos données sur les serveurs sécurisés Google Cloud.
        </div>
      </div>
    </div>
  );
};
