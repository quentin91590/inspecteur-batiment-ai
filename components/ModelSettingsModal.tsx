import React, { useEffect, useRef, useState } from 'react';
import { X, BrainCircuit, Loader2, FlaskConical, ImagePlus, Timer, Coins, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { InspectionResult, SchemaDefinition } from '../types';
import { AI_COSTS } from '../constants';
import {
  benchAnalyze, estimateCostUsd, getModelPrefs, isDemoMode, listModels, setModelPrefs,
  type AiMeta, type ModelInfo, type ModelPrefs, type Purpose,
} from '../services/aiService';

interface Props {
  schema: SchemaDefinition;
  userCoins: number;
  onSpendCoins: (amount: number) => Promise<boolean>;
  onClose: () => void;
  onSaved?: (prefs: ModelPrefs) => void;
}

const PURPOSES: { key: Purpose; label: string; help: string }[] = [
  { key: 'analyze', label: 'Analyse des photos', help: 'Précision : remplit les attributs et la vétusté' },
  { key: 'guide', label: 'Visite guidée (vidéo)', help: 'Rapidité : consignes à l’écran toutes les ~2 s' },
  { key: 'text', label: 'Notes vocales et synthèse', help: 'Texte uniquement' },
];

interface BenchRow {
  model: string;
  status: 'running' | 'done' | 'error';
  results?: InspectionResult[];
  meta?: AiMeta;
  error?: string;
}

const resizeFile = (file: File, maxSide = 1280): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

const fmtCost = (usd: number | null) => {
  if (usd === null) return '—';
  const cents = usd * 100;
  return cents < 0.01 ? '< 0,01 ct' : `${cents.toFixed(cents < 0.1 ? 3 : 2).replace('.', ',')} ct`;
};

export const ModelSettingsModal: React.FC<Props> = ({ schema, userCoins, onSpendCoins, onClose, onSaved }) => {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaults, setDefaults] = useState<Partial<Record<Purpose, string>>>({});
  const [prefs, setPrefs] = useState<ModelPrefs>(getModelPrefs());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [benchModels, setBenchModels] = useState<string[]>([]);
  const [benchImage, setBenchImage] = useState<string | null>(null);
  const [rows, setRows] = useState<BenchRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listModels(true)
      .then(res => {
        setModels(res.models);
        setDefaults(res.defaults);
        setBenchModels(res.models.filter(m => m.available).slice(0, 3).map(m => m.id));
      })
      .catch(err => setLoadError(err?.message ?? String(err)))
      .finally(() => setLoading(false));
  }, []);

  const available = models.filter(m => m.available);
  const labelOf = (id?: string) => models.find(m => m.id === id)?.label ?? id ?? '—';

  const save = () => {
    setModelPrefs(prefs);
    onSaved?.(prefs);
    onClose();
  };

  const runBench = async () => {
    if (!benchImage || benchModels.length === 0) return;
    const cost = benchModels.length * AI_COSTS.IMAGE_ANALYSIS;
    if (userCoins < cost) {
      alert(`Crédits insuffisants : le test coûte ${cost} crédits.`);
      return;
    }
    if (!(await onSpendCoins(cost))) return;
    setRows(benchModels.map(model => ({ model, status: 'running' })));
    await Promise.all(
      benchModels.map(async model => {
        try {
          const out = await benchAnalyze(benchImage, schema, model);
          setRows(prev => prev.map(r => (r.model === model ? { ...r, status: 'done', results: out.results, meta: out.meta } : r)));
        } catch (err: any) {
          setRows(prev => prev.map(r => (r.model === model ? { ...r, status: 'error', error: err?.message ?? String(err) } : r)));
        }
      }),
    );
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center" data-testid="model-settings">
      <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <BrainCircuit size={20} className="text-purple-600" /> Modèles d'IA
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100" aria-label="Fermer">
            <X size={22} className="text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {isDemoMode() && (
            <p className="text-sm bg-purple-50 text-purple-800 border border-purple-100 rounded-xl p-3">
              Mode invité : l'IA est simulée. Connectez-vous pour choisir et comparer les vrais modèles.
            </p>
          )}
          {loading && (
            <p className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 size={16} className="animate-spin" /> Chargement des modèles…</p>
          )}
          {loadError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3 flex gap-2">
              <AlertTriangle size={18} className="shrink-0" /> {loadError}
            </p>
          )}

          {!loading && !loadError && (
            <section className="space-y-4">
              {PURPOSES.map(p => (
                <label key={p.key} className="block">
                  <span className="text-sm font-bold text-slate-800">{p.label}</span>
                  <span className="block text-xs text-slate-500 mb-1.5">{p.help}</span>
                  <select
                    value={prefs[p.key] ?? ''}
                    onChange={e => setPrefs(prev => ({ ...prev, [p.key]: e.target.value || undefined }))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800"
                  >
                    <option value="">Par défaut du serveur ({labelOf(defaults[p.key])})</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id} disabled={!m.available}>
                        {m.label}{m.note ? ` — ${m.note}` : ''}{m.available ? '' : ' (clé non configurée)'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p className="text-xs text-slate-500">Ce choix est enregistré sur cet appareil.</p>
            </section>
          )}

          {!loading && !loadError && available.length > 0 && (
            <section className="space-y-3 border-t border-slate-100 pt-5">
              <h3 className="flex items-center gap-2 font-bold text-slate-900">
                <FlaskConical size={18} className="text-blue-600" /> Banc d'essai
              </h3>
              <p className="text-sm text-slate-600">
                Même photo, plusieurs modèles : comparez la justesse des champs, le temps de réponse et le coût.
              </p>
              <div className="flex flex-wrap gap-2">
                {available.map(m => {
                  const on = benchModels.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => setBenchModels(prev => (on ? prev.filter(x => x !== m.id) : [...prev, m.id].slice(-4)))}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <ImagePlus size={18} /> {benchImage ? 'Changer de photo' : 'Choisir une photo'}
                </button>
                {benchImage && <img src={benchImage} alt="Photo de test" className="w-14 h-14 rounded-lg object-cover border" />}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async e => {
                    const f = e.target.files?.[0];
                    if (f) setBenchImage(await resizeFile(f));
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={runBench}
                  disabled={!benchImage || benchModels.length === 0 || rows.some(r => r.status === 'running')}
                  className="ml-auto px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-40"
                >
                  Comparer ({benchModels.length * AI_COSTS.IMAGE_ANALYSIS} crédits)
                </button>
              </div>

              {rows.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {rows.map(r => (
                    <div key={r.model} className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-slate-900 truncate">{labelOf(r.model)}</span>
                        {r.status === 'running' && <Loader2 size={16} className="animate-spin text-blue-600" />}
                        {r.status === 'done' && <CheckCircle2 size={16} className="text-emerald-600" />}
                        {r.status === 'error' && <AlertTriangle size={16} className="text-red-600" />}
                      </div>
                      {r.meta && (
                        <div className="flex gap-3 text-xs text-slate-500">
                          <span className="flex items-center gap-1"><Timer size={12} /> {(r.meta.latencyMs / 1000).toFixed(1).replace('.', ',')} s</span>
                          <span className="flex items-center gap-1"><Coins size={12} /> {fmtCost(estimateCostUsd(r.meta))}</span>
                          {r.meta.inputTokens !== undefined && <span>{r.meta.inputTokens} → {r.meta.outputTokens} tokens</span>}
                        </div>
                      )}
                      {r.error && <p className="text-xs text-red-700">{r.error}</p>}
                      {r.results?.map((res, i) => (
                        <div key={i} className="text-xs bg-slate-50 rounded-lg p-2 space-y-1">
                          <div className="font-semibold text-slate-800">
                            {res.category} / {res.subCategory}
                            {res.conditionScore !== undefined && <span className="ml-1 text-slate-500">· vétusté {Math.round(res.conditionScore)}</span>}
                          </div>
                          {Object.entries(res.attributes).map(([k, v]) => (
                            <div key={k} className="text-slate-600"><span className="text-slate-400">{k} :</span> {v}</div>
                          ))}
                          {res.commentaire && <div className="text-slate-500 italic">{res.commentaire}</div>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">Annuler</button>
          <button onClick={save} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">Enregistrer</button>
        </div>
      </div>
    </div>
  );
};
