import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Ban, Camera, Undo2 } from 'lucide-react';
import type { InspectionItem, SchemaDefinition } from '../types';
import { sortCategories } from '../constants';
import { ALL_ZONES, NON_VISUAL_CATEGORIES, buildChecklist, elementKey } from '../utils/checklist';
import { iconFor } from '../utils/elementIcons';

/** Élément repéré pendant la visite (dans une pièce). */
export interface SpottedVariant {
  category: string;
  element: string;
  label: string;
  room: string;
  status: 'todo' | 'active' | 'done' | 'skipped';
}

interface Props {
  schema: SchemaDefinition;
  items: Record<string, InspectionItem>;
  absent: string[];
  spotted: SpottedVariant[];
  onStart: (category: string, element: string) => void;
  onSetAbsent: (key: string, isAbsent: boolean) => void;
}

type ElState = 'complet' | 'incomplet' | 'pasvu' | 'absent';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const STATE_DOT: Record<ElState, string> = {
  complet: 'bg-emerald-400',
  incomplet: 'bg-amber-400',
  pasvu: 'bg-white/25',
  absent: 'bg-transparent border border-white/40',
};

/**
 * Référentiel complet, consultable pendant la visite : catégories → éléments → détail
 * (variantes repérées, informations relevées, ce qui manque), avec « Relever maintenant » et « Absent du bâtiment ».
 */
export const ReferentielPanel: React.FC<Props> = ({ schema, items, absent, spotted, onStart, onSetAbsent }) => {
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [openEl, setOpenEl] = useState<string | null>(null);

  const checklist = useMemo(() => buildChecklist(schema, items, ALL_ZONES, { visualOnly: true }), [schema, items]);
  const categories = useMemo(
    () => sortCategories(Object.keys(schema)).filter(c => !NON_VISUAL_CATEGORIES.includes(c) && Object.keys(schema[c] ?? {}).length > 0),
    [schema],
  );

  const stateOf = (category: string, sub: string): { state: ElState; missing: string[] } => {
    if (absent.includes(elementKey(category, sub))) return { state: 'absent', missing: [] };
    const e = checklist.entries.find(x => x.category === category && x.subCategory === sub);
    if (!e || e.status === 'absent') return { state: 'pasvu', missing: [] };
    return { state: e.status === 'complet' ? 'complet' : 'incomplet', missing: e.missingAttributes };
  };
  const visible = (state: ElState) => !onlyMissing || state === 'incomplet' || state === 'pasvu';
  const subLine = (state: ElState, missing: string[]) =>
    state === 'complet' ? 'complet' : state === 'absent' ? 'absent du bâtiment' : state === 'pasvu' ? 'pas encore vu' : `manque ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`;

  const q = norm(query.trim());
  const matches = q
    ? categories.flatMap(c =>
        Object.keys(schema[c]).filter(sub => norm(sub).includes(q) || norm(c).includes(q)).map(sub => ({ category: c, sub })),
      )
    : [];

  const detail = (category: string, sub: string) => {
    const key = elementKey(category, sub);
    const { state, missing } = stateOf(category, sub);
    const item = (Object.values(items) as InspectionItem[]).find(i => i.category === category && i.subCategory === sub);
    const attrs = item ? Object.entries(item.attributes).filter(([, v]) => v && v !== 'Non défini') : [];
    const variants = spotted.filter(v => v.category === category && v.element === sub);
    return (
      <div className="mt-1 mb-2 ml-9 mr-1 space-y-2 text-sm" data-testid="ref-detail">
        {variants.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {variants.map((v, i) => (
              <span
                key={`${v.label}-${v.room}-${i}`}
                className={`px-2 py-0.5 rounded-full text-xs ${v.status === 'done' ? 'bg-emerald-500/25 text-emerald-100' : 'bg-amber-400/20 text-amber-100'}`}
              >
                {v.label}
                {v.room ? ` · ${v.room}` : ''}
                {v.status === 'done' ? ' ✓' : ''}
              </span>
            ))}
          </div>
        )}
        {attrs.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            {attrs.slice(0, 8).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-white/50 truncate">{k}</dt>
                <dd className="font-semibold truncate">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        {state === 'incomplet' && missing.length > 0 && <p className="text-xs text-amber-200">Manque : {missing.join(', ')}</p>}
        <div className="flex gap-2 pt-0.5">
          {state !== 'absent' ? (
            <>
              <button
                onClick={() => onStart(category, sub)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-amber-400 text-slate-900 text-sm font-bold"
                data-testid="ref-start"
              >
                <Camera size={15} /> Relever maintenant
              </button>
              <button
                onClick={() => onSetAbsent(key, true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 text-xs font-semibold text-white/75"
                data-testid="ref-absent"
              >
                <Ban size={14} /> Absent du bâtiment
              </button>
            </>
          ) : (
            <button
              onClick={() => onSetAbsent(key, false)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 text-xs font-semibold"
              data-testid="ref-present"
            >
              <Undo2 size={14} /> Présent finalement
            </button>
          )}
        </div>
      </div>
    );
  };

  const elementRow = (category: string, sub: string, showCategory = false) => {
    const { state, missing } = stateOf(category, sub);
    if (!visible(state)) return null;
    const key = elementKey(category, sub);
    const Icon = iconFor(category, sub);
    const open = openEl === key;
    return (
      <li key={key}>
        <button
          onClick={() => setOpenEl(open ? null : key)}
          className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-left ${open ? 'bg-white/10' : 'hover:bg-white/5'}`}
          data-testid="ref-element"
          data-state={state}
        >
          <Icon size={16} className={`shrink-0 ${state === 'absent' ? 'text-white/30' : 'text-white/80'}`} />
          <span className="min-w-0 flex-1">
            <span className={`block text-sm font-semibold truncate ${state === 'absent' ? 'line-through text-white/40' : ''}`}>{sub}</span>
            <span className="block text-[11px] text-white/50 truncate">
              {showCategory ? `${category} · ` : ''}
              {subLine(state, missing)}
            </span>
          </span>
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATE_DOT[state]}`} />
        </button>
        {open && detail(category, sub)}
      </li>
    );
  };

  return (
    <div data-testid="ref-panel">
      <div className="flex items-center gap-2 mb-2">
        <label className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10">
          <Search size={15} className="text-white/50 shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Chercher (tableau, boiler…)"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/40"
            data-testid="ref-search"
          />
        </label>
        <button
          onClick={() => setOnlyMissing(v => !v)}
          className={`shrink-0 px-3 py-2 rounded-xl text-xs font-semibold ${onlyMissing ? 'bg-white text-slate-900' : 'bg-white/10 text-white/80'}`}
          data-testid="ref-only-missing"
        >
          À faire
        </button>
      </div>

      {q ? (
        <ul className="space-y-0.5">
          {matches.length ? matches.map(m => elementRow(m.category, m.sub, true)) : <li className="text-sm text-white/50 px-2 py-3">Rien ne correspond.</li>}
        </ul>
      ) : (
        <ul className="space-y-1">
          {categories.map(cat => {
            const subs = Object.keys(schema[cat]);
            const states = subs.map(sub => stateOf(cat, sub).state);
            const counted = states.filter(s => s !== 'absent');
            const done = counted.filter(s => s === 'complet').length;
            if (onlyMissing && !states.some(s => s === 'incomplet' || s === 'pasvu')) return null;
            const Icon = iconFor(cat, '');
            const open = openCat === cat;
            return (
              <li key={cat}>
                <button
                  onClick={() => {
                    setOpenCat(open ? null : cat);
                    setOpenEl(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-2 py-2.5 rounded-xl bg-white/5 text-left"
                  data-testid="ref-category"
                >
                  <Icon size={17} className="shrink-0 text-white/80" />
                  <span className="flex-1 min-w-0 font-semibold truncate">{cat}</span>
                  <span className={`shrink-0 text-xs ${done === counted.length && counted.length ? 'text-emerald-300' : 'text-white/55'}`}>
                    {done}/{counted.length}
                  </span>
                  {open ? <ChevronDown size={16} className="shrink-0 text-white/50" /> : <ChevronRight size={16} className="shrink-0 text-white/50" />}
                </button>
                {open && <ul className="mt-0.5 ml-2 space-y-0.5">{subs.map(sub => elementRow(cat, sub))}</ul>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
