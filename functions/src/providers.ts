import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { forGemini, type JsonSchema } from './schemas.js';
import type { Provider } from './types.js';

export interface GenerateParams {
  provider: Provider;
  model: string;
  system: string;
  user: string;
  /** JPEG base64 sans préfixe */
  imageB64?: string;
  /** Schéma JSON de la réponse ; absent = texte libre */
  schema?: JsonSchema;
  /** fast = guidage (réflexion coupée, réponse courte) ; normal = analyse détaillée */
  speed: 'fast' | 'normal';
}

export interface GenerateOutput {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}

export interface ProviderKeys {
  gemini?: string;
  anthropic?: string;
  openai?: string;
  openaiBaseUrl?: string;
  /** Uniquement pour les tests (serveur local) */
  geminiBaseUrl?: string;
  anthropicBaseUrl?: string;
}

export class ProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export function isKeySet(key: string | undefined): key is string {
  return !!key && key.trim() !== '' && key.trim().toLowerCase() !== 'none';
}

export function providerAvailable(provider: Provider, keys: ProviderKeys): boolean {
  if (provider === 'gemini') return isKeySet(keys.gemini);
  if (provider === 'anthropic') return isKeySet(keys.anthropic);
  return isKeySet(keys.openai) && !!keys.openaiBaseUrl;
}

export async function generate(p: GenerateParams, keys: ProviderKeys): Promise<GenerateOutput> {
  if (p.provider === 'gemini') return generateGemini(p, keys);
  if (p.provider === 'anthropic') return generateAnthropic(p, keys);
  return generateOpenAiCompatible(p, keys);
}

// ---------------------------------------------------------------- Gemini

/** Niveau de réflexion le plus bas accepté par chaque famille Gemini 3+. */
function geminiFastThinking(model: string): ThinkingLevel | undefined {
  if (/^gemini-2/.test(model)) return undefined; // série 2.x : pas de thinkingLevel
  if (/3\.8-flash|gemini-4/.test(model)) return ThinkingLevel.LOW; // « minimal » refusé
  return ThinkingLevel.MINIMAL;
}

async function generateGemini(p: GenerateParams, keys: ProviderKeys): Promise<GenerateOutput> {
  if (!isKeySet(keys.gemini)) throw new ProviderError('Clé Gemini non configurée', 412);
  const ai = new GoogleGenAI({
    apiKey: keys.gemini,
    ...(keys.geminiBaseUrl ? { httpOptions: { baseUrl: keys.geminiBaseUrl } } : {}),
  });

  const parts: Array<Record<string, unknown>> = [];
  if (p.imageB64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: p.imageB64 } });
  parts.push({ text: p.user });

  const thinkingLevel = p.speed === 'fast' ? geminiFastThinking(p.model) : undefined;

  try {
    const response = await ai.models.generateContent({
      model: p.model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: p.system,
        ...(p.schema ? { responseMimeType: 'application/json', responseJsonSchema: forGemini(p.schema) } : {}),
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        ...(p.speed === 'fast' ? { maxOutputTokens: 1536, temperature: 0.2 } : {}),
      },
    });
    const usage = response.usageMetadata;
    return {
      text: response.text ?? '',
      inputTokens: usage?.promptTokenCount,
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      cachedTokens: usage?.cachedContentTokenCount,
    };
  } catch (err: any) {
    throw new ProviderError(`Gemini : ${err?.message ?? err}`, err?.status);
  }
}

// ---------------------------------------------------------------- Claude

function claudeThinking(model: string, speed: 'fast' | 'normal'): Anthropic.Messages.ThinkingConfigParam | undefined {
  if (speed !== 'fast') return undefined; // réflexion adaptative par défaut
  if (/haiku/.test(model)) return { type: 'disabled' };
  if (/sonnet-5-5/.test(model)) return { type: 'between_tools' } as Anthropic.Messages.ThinkingConfigParam;
  return undefined; // Opus / Fable : réflexion non désactivable, on baisse l'effort
}

async function generateAnthropic(p: GenerateParams, keys: ProviderKeys): Promise<GenerateOutput> {
  if (!isKeySet(keys.anthropic)) throw new ProviderError('Clé Anthropic non configurée', 412);
  const client = new Anthropic({
    apiKey: keys.anthropic,
    ...(keys.anthropicBaseUrl ? { baseURL: keys.anthropicBaseUrl } : {}),
    maxRetries: p.speed === 'fast' ? 0 : 2,
    timeout: p.speed === 'fast' ? 20_000 : 80_000,
  });

  const content: Anthropic.Messages.ContentBlockParam[] = [];
  if (p.imageB64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.imageB64 } });
  }
  content.push({ type: 'text', text: p.user });

  const thinking = claudeThinking(p.model, p.speed);

  try {
    const response = await client.messages.create({
      model: p.model,
      max_tokens: p.speed === 'fast' ? 1500 : 4096,
      // Le système (règles + référentiel) est identique d'un appel à l'autre : mis en cache.
      system: [{ type: 'text', text: p.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      output_config: {
        effort: p.speed === 'fast' ? 'low' : 'medium',
        ...(p.schema ? { format: { type: 'json_schema', schema: p.schema } } : {}),
      },
      ...(thinking ? { thinking } : {}),
    });

    if (response.stop_reason === 'refusal') throw new ProviderError('Claude a refusé de répondre', 400);
    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    const u = response.usage;
    return {
      text,
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens,
      cachedTokens: u.cache_read_input_tokens ?? 0,
    };
  } catch (err: any) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`Claude : ${err?.message ?? err}`, err?.status);
  }
}

// ---------------------------------------------------------------- Compatible OpenAI (Qwen, Infomaniak, Mistral, OpenRouter…)

async function generateOpenAiCompatible(p: GenerateParams, keys: ProviderKeys): Promise<GenerateOutput> {
  if (!isKeySet(keys.openai) || !keys.openaiBaseUrl) throw new ProviderError('Fournisseur compatible OpenAI non configuré', 412);

  const system = p.schema
    ? `${p.system}\n\nRéponds uniquement avec un objet JSON valide conforme à ce schéma JSON :\n${JSON.stringify(p.schema)}`
    : p.system;

  const userContent = p.imageB64
    ? [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.imageB64}` } },
        { type: 'text', text: p.user },
      ]
    : p.user;

  const body = {
    model: p.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    max_tokens: p.speed === 'fast' ? 1500 : 4096,
    temperature: 0.2,
    ...(p.schema ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetch(`${keys.openaiBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${keys.openai}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(p.speed === 'fast' ? 20_000 : 80_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ProviderError(`Fournisseur compatible OpenAI : HTTP ${res.status} ${detail.slice(0, 300)}`, res.status);
  }
  const data: any = await res.json();
  const msg = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(msg) ? msg.map((c: any) => c?.text ?? '').join('') : String(msg ?? '');
  return {
    text,
    inputTokens: data?.usage?.prompt_tokens,
    outputTokens: data?.usage?.completion_tokens,
    cachedTokens: data?.usage?.prompt_tokens_details?.cached_tokens,
  };
}
