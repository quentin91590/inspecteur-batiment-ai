// Tests sans clé réelle : un faux serveur local imite Gemini, Claude et un fournisseur compatible OpenAI,
// et vérifie la forme exacte des requêtes envoyées + la lecture des réponses.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { AiError, handleAiRequest, normalizeBox, type CoreDeps } from '../core.js';
import type { AiMeta, SchemaDefinition } from '../types.js';

const SCHEMA: SchemaDefinition = {
  Chauffage: {
    'Production de chaleur': { Type: ['Chaudière gaz', 'PAC', 'Mixte'], Etat: ['Neuf', 'Bon', 'Moyen', 'Mauvais'], Année: ['Numeric:1900:2026'] },
    Boiler: { Type: ['Thermique', 'Electrique', 'Mixte'], Année: ['Numeric:1900:2026'] },
  },
};
const IMG = Buffer.from('fake-jpeg').toString('base64');

interface Captured { url: string; body: any; headers: IncomingMessage['headers'] }
const captured: Captured[] = [];
let nextReply: (url: string) => unknown = () => ({});
let server: Server;
let base = '';

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      captured.push({ url: req.url ?? '', body, headers: req.headers });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(nextReply(req.url ?? '')));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
after(() => server.close());

const usage: { purpose: string; meta: AiMeta }[] = [];
function deps(over: Partial<CoreDeps['keys']> = {}, extra: Partial<CoreDeps> = {}): CoreDeps {
  return {
    keys: { gemini: 'g-key', anthropic: 'a-key', openai: 'o-key', openaiBaseUrl: `${base}/compat/v1`, geminiBaseUrl: base, anthropicBaseUrl: base, ...over },
    openaiModels: 'qwen3.8-omni-flash|Qwen 3.8 Omni Flash',
    loadConfig: async () => ({}),
    checkQuota: async () => {},
    recordUsage: (_uid, purpose, meta) => usage.push({ purpose, meta }),
    ...extra,
  };
}

const geminiReply = (obj: unknown) => ({
  candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 80, thoughtsTokenCount: 10 },
});
const claudeReply = (obj: unknown) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 300, output_tokens: 90, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
});

const GUIDE_OK = {
  instruction: 'Approchez-vous de la plaque de la chaudière',
  detail: '', target: 'Production de chaleur — plaque', capture: false, captureReason: '', sceneQuality: 'ok',
  seen: [{ category: 'Chauffage', subCategory: 'Production de chaleur' }],
};

describe('guidage', () => {
  it('Gemini 3.5 Flash-Lite par défaut : réflexion minimale, schéma JSON, image avant le texte', async () => {
    captured.length = 0;
    nextReply = () => geminiReply(GUIDE_OK);
    const res = await handleAiRequest(
      { task: 'guide', image: `data:image/jpeg;base64,${IMG}`, schema: SCHEMA, zone: 'Chauffage', missing: ['Chauffage / Boiler : non vu'], inProgress: [], transcript: 'la chaudière date de 2008' },
      'u1', deps(),
    );
    assert.equal(res.guide?.instruction, GUIDE_OK.instruction);
    assert.equal(res.meta?.model, 'gemini:gemini-3.5-flash-lite');
    const c = captured[0];
    assert.match(c.url, /models\/gemini-3\.5-flash-lite:generateContent/);
    assert.equal(c.body.generationConfig.thinkingConfig.thinkingLevel, 'MINIMAL');
    assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
    assert.ok(!JSON.stringify(c.body.generationConfig.responseJsonSchema).includes('additionalProperties'));
    const parts = c.body.contents[0].parts;
    assert.equal(parts[0].inlineData.data, IMG, 'le préfixe data: est retiré');
    assert.match(parts[1].text, /Chauffage \/ Boiler : non vu/);
    assert.match(parts[1].text, /2008/);
    assert.match(c.body.systemInstruction.parts[0].text, /copilote/);
    assert.equal(res.meta?.outputTokens, 90);
  });

  it('Claude Haiku : réflexion désactivée, effort bas, système en cache, sortie structurée', async () => {
    captured.length = 0;
    nextReply = () => claudeReply({ ...GUIDE_OK, capture: true });
    const res = await handleAiRequest(
      { task: 'guide', image: IMG, schema: SCHEMA, zone: 'Chauffage', missing: [], inProgress: ['Boiler — plaque'], model: 'anthropic:claude-haiku-5-5' },
      'u1', deps(),
    );
    assert.equal(res.guide?.capture, true);
    const b = captured[0].body;
    assert.equal(captured[0].url, '/v1/messages');
    assert.equal(b.model, 'claude-haiku-5-5');
    assert.deepEqual(b.thinking, { type: 'disabled' });
    assert.equal(b.output_config.effort, 'low');
    assert.equal(b.output_config.format.type, 'json_schema');
    assert.equal(b.output_config.format.schema.additionalProperties, false);
    assert.deepEqual(b.system[0].cache_control, { type: 'ephemeral' });
    assert.equal(b.messages[0].content[0].type, 'image');
    assert.equal(b.messages[0].content[0].source.media_type, 'image/jpeg');
    assert.equal(res.meta?.cachedTokens, 900);
  });

  it('modèle inconnu demandé → retombe sur le modèle par défaut', async () => {
    captured.length = 0;
    nextReply = () => geminiReply(GUIDE_OK);
    const res = await handleAiRequest(
      { task: 'guide', image: IMG, schema: SCHEMA, zone: 'Tout', missing: [], inProgress: [], model: 'anthropic:modele-inexistant' },
      'u1', deps(),
    );
    assert.equal(res.meta?.model, 'gemini:gemini-3.5-flash-lite');
  });

  it('réponse incomplète → valeurs par défaut sûres', async () => {
    nextReply = () => geminiReply({ instruction: '', sceneQuality: 'n_importe_quoi', capture: 'true' });
    const res = await handleAiRequest({ task: 'guide', image: IMG, schema: SCHEMA, zone: 'Tout', missing: [], inProgress: [] }, 'u1', deps());
    assert.equal(res.guide?.instruction, 'Continuez à filmer lentement');
    assert.equal(res.guide?.sceneQuality, 'ok');
    assert.equal(res.guide?.capture, true);
    assert.deepEqual(res.guide?.seen, []);
  });
});

describe('guidage spatial et surbrillance', () => {
  it('transmet le mode, l’étape, l’espace, le déjà-relevé et la demande d’espace suivant', async () => {
    captured.length = 0;
    nextReply = () => geminiReply({ ...GUIDE_OK, space: 'Chambre', spaceDone: true, nextSpace: 'Couloir', targetBox: [400, 100, 700, 450], targetDirection: 'ici' });
    const res = await handleAiRequest(
      {
        task: 'guide', image: IMG, schema: SCHEMA, mode: 'parcours', theme: 'Tout le bâtiment',
        stage: 'Logements et locaux', nextStage: 'Combles et toiture',
        currentSpace: 'Chambre', spacesVisited: ['Façade', 'Hall d’entrée', 'Chambre'], requestNextSpace: true,
        missing: ['Chauffage : Boiler (pas vu)'], recorded: ['Chauffage / Emetteur : Etat=Bon'], inProgress: [],
        lastTarget: 'Radiateur — sous la fenêtre',
      },
      'u1', deps(),
    );
    const text = captured[0].body.contents[0].parts[1].text as string;
    assert.match(text, /Mode : Parcours guidé/);
    assert.match(text, /Étape en cours : Logements et locaux \(étape suivante : Combles et toiture\)/);
    assert.match(text, /Espace actuel \(images précédentes\) : Chambre/);
    assert.match(text, /Façade → Hall d’entrée → Chambre/);
    assert.match(text, /A TERMINÉ CET ESPACE/);
    assert.match(text, /Déjà relevé[^]*Emetteur : Etat=Bon/);
    assert.match(text, /Élément visé précédemment : « Radiateur — sous la fenêtre »/);
    const sys = captured[0].body.systemInstruction.parts[0].text as string;
    assert.match(sys, /INTERDIT de demander d'aller dans un autre espace/);
    assert.deepEqual(res.guide?.targetBox, [400, 100, 700, 450]);
    assert.equal(res.guide?.space, 'Chambre');
    assert.equal(res.guide?.spaceDone, true);
    assert.equal(res.guide?.nextSpace, 'Couloir');
    assert.equal(res.guide?.targetDirection, 'ici');
  });

  it('ancienne requête (zone, sans mode) toujours acceptée, mode « Commencer ici »', async () => {
    captured.length = 0;
    nextReply = () => geminiReply(GUIDE_OK);
    const res = await handleAiRequest({ task: 'guide', image: IMG, schema: SCHEMA, zone: 'Chauffage', missing: [], inProgress: [] }, 'u1', deps());
    const text = captured[0].body.contents[0].parts[1].text as string;
    assert.match(text, /Mode : Commencer ici/);
    assert.match(text, /Thème : Chauffage/);
    assert.deepEqual(res.guide?.targetBox, []);
    assert.equal(res.guide?.targetDirection, 'inconnu');
  });

  it('cadres : échelle 0-1 corrigée, cadres incohérents rejetés', () => {
    assert.deepEqual(normalizeBox([0.1, 0.2, 0.5, 0.6]), [100, 200, 500, 600]);
    assert.deepEqual(normalizeBox([100, 200, 500, 1200]), [100, 200, 500, 1000]);
    assert.deepEqual(normalizeBox([500, 200, 100, 600]), []);
    assert.deepEqual(normalizeBox([1, 2, 3]), []);
    assert.deepEqual(normalizeBox('x'), []);
  });

  it('élément hors image : direction conservée, pas de cadre', async () => {
    nextReply = () => geminiReply({ ...GUIDE_OK, targetBox: [], targetDirection: 'derrière' });
    const res = await handleAiRequest({ task: 'guide', image: IMG, schema: SCHEMA, missing: [], inProgress: [] }, 'u1', deps());
    assert.equal(res.guide?.targetDirection, 'derriere');
  });
});

describe('analyse détaillée', () => {
  const ELEMENTS = {
    elements: [
      { category: 'Chauffage', subCategory: 'Production de chaleur', attributes: [{ name: 'Type', value: 'Chaudière gaz' }, { name: 'Année', value: '2008' }], confiance: 0.9, commentaire: 'Traces de corrosion', conditionScore: 55, isPrimarySubject: true },
    ],
  };

  it('Gemini 3 Flash choisi dans l\'appli : réflexion par défaut, référentiel complet dans le système, note orale transmise', async () => {
    captured.length = 0;
    nextReply = () => geminiReply(ELEMENTS);
    const res = await handleAiRequest({ task: 'analyzeImage', image: IMG, schema: SCHEMA, note: 'marque Viessmann', hint: 'Production de chaleur — plaque', model: 'gemini:gemini-3-flash-preview' }, 'u1', deps());
    const c = captured[0];
    assert.match(c.url, /gemini-3-flash-preview:generateContent/);
    assert.equal(c.body.generationConfig.thinkingConfig, undefined);
    assert.match(c.body.systemInstruction.parts[0].text, /Choisir parmi \[Chaudière gaz, PAC, Mixte\]/);
    assert.match(c.body.systemInstruction.parts[0].text, /Nombre entre 1900 et 2026/);
    assert.match(c.body.contents[0].parts[1].text, /Viessmann/);
    assert.match(c.body.contents[0].parts[1].text, /élément visé : « Production de chaleur — plaque »/);
    assert.equal(res.elements?.length, 1);
    assert.equal(res.elements?.[0].conditionScore, 55);
  });

  it('Claude : effort moyen, pas de réglage de réflexion', async () => {
    captured.length = 0;
    nextReply = () => claudeReply(ELEMENTS);
    const res = await handleAiRequest({ task: 'analyzeImage', image: IMG, schema: SCHEMA, model: 'anthropic:claude-haiku-5-5' }, 'u1', deps());
    const b = captured[0].body;
    assert.equal(b.thinking, undefined);
    assert.equal(b.output_config.effort, 'medium');
    assert.equal(b.max_tokens, 4096);
    assert.equal(res.elements?.[0].attributes[1].value, '2008');
  });

  it('fournisseur compatible OpenAI (Qwen) : json_object + image en data URL', async () => {
    captured.length = 0;
    nextReply = () => ({ choices: [{ message: { content: '```json\n' + JSON.stringify(ELEMENTS) + '\n```' } }], usage: { prompt_tokens: 1000, completion_tokens: 70 } });
    const res = await handleAiRequest({ task: 'analyzeImage', image: IMG, schema: SCHEMA, model: 'openai:qwen3.8-omni-flash' }, 'u1', deps());
    const c = captured[0];
    assert.equal(c.url, '/compat/v1/chat/completions');
    assert.equal(c.headers.authorization, 'Bearer o-key');
    assert.deepEqual(c.body.response_format, { type: 'json_object' });
    assert.equal(c.body.messages[1].content[0].type, 'image_url');
    assert.match(c.body.messages[1].content[0].image_url.url, /^data:image\/jpeg;base64,/);
    assert.match(c.body.messages[0].content, /schéma JSON/);
    assert.equal(res.elements?.[0].category, 'Chauffage', 'les balises ``` sont tolérées');
  });

  it('attributs renvoyés en objet et score hors bornes → normalisés', async () => {
    nextReply = () => geminiReply([{ category: 'Chauffage', subCategory: 'Boiler', attributes: { Type: 'Electrique' }, confiance: '0,8', commentaire: '', conditionScore: 140, isPrimarySubject: true }]);
    const res = await handleAiRequest({ task: 'analyzeImage', image: IMG, schema: SCHEMA }, 'u1', deps());
    assert.deepEqual(res.elements?.[0].attributes, [{ name: 'Type', value: 'Electrique' }]);
    assert.equal(res.elements?.[0].conditionScore, 100);
    assert.equal(res.elements?.[0].confiance, 0.8);
  });
});

describe('note vocale, synthèse, modèles, erreurs', () => {
  it('synthèse : texte libre, balises retirées', async () => {
    nextReply = () => geminiReply('placeholder');
    nextReply = () => ({ candidates: [{ content: { role: 'model', parts: [{ text: '```markdown\n- Corrosion\n- Fuite\n```' }] }, finishReason: 'STOP' }] });
    const res = await handleAiRequest({ task: 'summarize', comment: 'corrosion et fuite', category: 'Chauffage', subCategory: 'Boiler' }, 'u1', deps());
    assert.equal(res.text, '- Corrosion\n- Fuite');
  });

  it('liste des modèles : disponibilité selon les clés configurées', async () => {
    const res = await handleAiRequest({ task: 'models' }, 'u1', deps({ anthropic: 'none' }));
    const haiku = res.models?.find(m => m.id === 'anthropic:claude-haiku-5-5');
    const qwen = res.models?.find(m => m.id === 'openai:qwen3.8-omni-flash');
    assert.equal(haiku?.available, false);
    assert.equal(qwen?.available, true);
    assert.equal(res.defaults?.guide, 'gemini:gemini-3.5-flash-lite');
    assert.equal(res.defaults?.analyze, 'gemini:gemini-3.5-flash-lite');
  });

  it('seule la clé Claude est configurée → les défauts basculent sur Claude', async () => {
    const res = await handleAiRequest({ task: 'models' }, 'u1', deps({ gemini: '', openai: 'none' }));
    assert.match(res.defaults?.analyze ?? '', /^anthropic:/);
  });

  it('aucune clé → erreur explicite', async () => {
    await assert.rejects(
      handleAiRequest({ task: 'analyzeText', text: 'radiateur en fonte', schema: SCHEMA }, 'u1', deps({ gemini: 'none', anthropic: '', openai: '' })),
      (e: unknown) => e instanceof AiError && e.code === 'failed-precondition',
    );
  });

  it('quota dépassé → resource-exhausted, aucun appel au fournisseur', async () => {
    captured.length = 0;
    const d = deps({}, { checkQuota: async () => { throw new AiError('resource-exhausted', 'Quota journalier atteint'); } });
    await assert.rejects(handleAiRequest({ task: 'analyzeText', text: 'x', schema: SCHEMA }, 'u1', d), (e: unknown) => e instanceof AiError && e.code === 'resource-exhausted');
    assert.equal(captured.length, 0);
  });

  it('erreur 429 du fournisseur → message contenant « quota »', async () => {
    const d = deps({}, { generateFn: async () => { const { ProviderError } = await import('../providers.js'); throw new ProviderError('Gemini : Too Many Requests', 429); } });
    await assert.rejects(handleAiRequest({ task: 'analyzeText', text: 'x', schema: SCHEMA }, 'u1', d), (e: unknown) => e instanceof AiError && e.code === 'resource-exhausted' && /quota/.test(e.message));
  });

  it('requêtes invalides refusées', async () => {
    await assert.rejects(handleAiRequest({ task: 'analyzeImage', schema: SCHEMA }, 'u1', deps()), /image/);
    await assert.rejects(handleAiRequest({ task: 'guide', image: IMG, zone: 'x', missing: [], inProgress: [] }, 'u1', deps()), /Référentiel/);
    await assert.rejects(handleAiRequest({ task: 'hack' }, 'u1', deps()), /Tâche inconnue/);
  });

  it("l'usage est enregistré avec le modèle et les tokens", () => {
    assert.ok(usage.length > 0);
    assert.ok(usage.every(u => u.meta.latencyMs >= 0 && u.meta.model.includes(':')));
  });
});
