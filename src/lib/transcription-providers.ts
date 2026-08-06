/**
 * Transcription provider abstraction layer.
 *
 * Currently supports:
 * - Groq (`whisper-large-v3-turbo`)
 * - OpenAI (`whisper-1`)
 * - OpenAI diarization (`gpt-4o-transcribe-diarize`)
 */

import Groq from 'groq-sdk';
import {
    ChunkResult,
    TranscriptSegment,
    TranscriptionProviderInfo,
    TranscriptionProviderName,
} from './types';

interface ProviderConfig {
    apiKey: string;
}

export interface TranscriptionProvider {
    name: TranscriptionProviderName;
    model: string;
    transcribe(file: File, language?: string, signal?: AbortSignal): Promise<ChunkResult>;
}

interface VerboseTranscriptionResponse {
    text: string;
    language?: string;
    segments?: Array<{
        id?: number;
        start?: number;
        end?: number;
        text: string;
    }>;
}

interface DiarizedTranscriptionResponse {
    text?: string;
    language?: string;
    segments?: Array<{
        id?: string;
        start?: number;
        end?: number;
        text?: string;
        speaker?: string;
    }>;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function describeFile(file: File): string {
    return `file="${file.name}" size=${(file.size / 1024 / 1024).toFixed(1)}MB`;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function mapSegments(response: VerboseTranscriptionResponse): TranscriptSegment[] {
    if (!response.segments || response.segments.length === 0) {
        return [
            {
                index: 0,
                start_ms: null,
                end_ms: null,
                text: response.text.trim(),
            },
        ];
    }

    return response.segments.map((segment, index) => ({
        index,
        start_ms: typeof segment.start === 'number' ? Math.round(segment.start * 1000) : null,
        end_ms: typeof segment.end === 'number' ? Math.round(segment.end * 1000) : null,
        text: segment.text.trim(),
    }));
}

function mapDiarizedSegments(response: DiarizedTranscriptionResponse): TranscriptSegment[] {
    if (!response.segments || response.segments.length === 0) {
        return [
            {
                index: 0,
                start_ms: null,
                end_ms: null,
                text: (response.text || '').trim(),
            },
        ];
    }

    return response.segments.map((segment, index) => ({
        index,
        start_ms: typeof segment.start === 'number' ? Math.round(segment.start * 1000) : null,
        end_ms: typeof segment.end === 'number' ? Math.round(segment.end * 1000) : null,
        text: (segment.text || '').trim(),
        ...(segment.speaker ? { speaker: segment.speaker } : {}),
    }));
}

class GroqTranscriptionProvider implements TranscriptionProvider {
    name: TranscriptionProviderName = 'groq';
    model = 'whisper-large-v3-turbo';
    private readonly client: Groq;

    constructor(config: ProviderConfig) {
        this.client = new Groq({ apiKey: config.apiKey });
    }

    async transcribe(file: File, language?: string, signal?: AbortSignal): Promise<ChunkResult> {
        let lastError: Error | null = null;
        console.log(`[provider:groq] start ${describeFile(file)} language=${language || 'auto'} model=${this.model}`);

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                if (signal?.aborted) {
                    throw new Error('Transcription cancelled');
                }

                const response = await this.client.audio.transcriptions.create({
                    file,
                    model: this.model,
                    response_format: 'verbose_json',
                    timestamp_granularities: ['segment'],
                    ...(language && { language }),
                }) as VerboseTranscriptionResponse;

                console.log(`[provider:groq] success ${describeFile(file)} attempt=${attempt + 1} segments=${response.segments?.length ?? 0} language=${response.language || 'unknown'}`);
                return {
                    index: 0,
                    text: response.text,
                    segments: mapSegments(response),
                    language: response.language,
                };
            } catch (error) {
                lastError = error as Error;
                console.warn(`[provider:groq] error ${describeFile(file)} attempt=${attempt + 1} message="${lastError.message}"`);

                if (signal?.aborted) {
                    throw error;
                }

                if (error instanceof Groq.RateLimitError) {
                    const retryAfter = 5000 * (attempt + 1);
                    await sleep(retryAfter);
                    continue;
                }

                if (error instanceof Groq.APIError && error.status && error.status >= 400 && error.status < 500) {
                    throw error;
                }

                if (attempt < MAX_RETRIES - 1) {
                    await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
                }
            }
        }

        throw lastError || new Error('Groq transcription failed after max retries');
    }
}

class OpenAITranscriptionProvider implements TranscriptionProvider {
    name: TranscriptionProviderName = 'openai';
    model = 'whisper-1';
    private readonly apiKey: string;

    constructor(config: ProviderConfig) {
        this.apiKey = config.apiKey;
    }

    async transcribe(file: File, language?: string, signal?: AbortSignal): Promise<ChunkResult> {
        let lastError: Error | null = null;
        console.log(`[provider:openai] start ${describeFile(file)} language=${language || 'auto'} model=${this.model}`);

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                if (signal?.aborted) {
                    throw new Error('Transcription cancelled');
                }

                const form = new FormData();
                form.append('file', file);
                form.append('model', this.model);
                form.append('response_format', 'verbose_json');
                if (language) {
                    form.append('language', language);
                }

                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                    body: form,
                    signal,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    let message = errorText;
                    try {
                        const parsed = JSON.parse(errorText);
                        message = parsed?.error?.message || errorText;
                    } catch {
                        // Keep raw text
                    }
                    throw new Error(`OpenAI transcription failed: ${response.status} - ${message}`);
                }

                const data = await response.json() as VerboseTranscriptionResponse;

                console.log(`[provider:openai] success ${describeFile(file)} attempt=${attempt + 1} segments=${data.segments?.length ?? 0} language=${data.language || 'unknown'}`);
                return {
                    index: 0,
                    text: data.text,
                    segments: mapSegments(data),
                    language: data.language,
                };
            } catch (error) {
                lastError = error as Error;
                console.warn(`[provider:openai] error ${describeFile(file)} attempt=${attempt + 1} message="${lastError.message}"`);

                if (signal?.aborted) {
                    throw error;
                }

                const message = (error as Error).message.toLowerCase();
                if (message.includes('429') || message.includes('rate limit')) {
                    const retryAfter = 5000 * (attempt + 1);
                    await sleep(retryAfter);
                    continue;
                }

                if (message.includes('400') || message.includes('401') || message.includes('403')) {
                    throw error;
                }

                if (attempt < MAX_RETRIES - 1) {
                    await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
                }
            }
        }

        throw lastError || new Error('OpenAI transcription failed after max retries');
    }
}

class OpenAIDiarizeTranscriptionProvider implements TranscriptionProvider {
    name: TranscriptionProviderName = 'openai_diarize';
    model = 'gpt-4o-transcribe-diarize';
    private readonly apiKey: string;

    constructor(config: ProviderConfig) {
        this.apiKey = config.apiKey;
    }

    async transcribe(file: File, language?: string, signal?: AbortSignal): Promise<ChunkResult> {
        let lastError: Error | null = null;
        console.log(`[provider:openai_diarize] start ${describeFile(file)} language=${language || 'auto'} model=${this.model}`);

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                if (signal?.aborted) {
                    throw new Error('Transcription cancelled');
                }

                const form = new FormData();
                form.append('file', file);
                form.append('model', this.model);
                form.append('response_format', 'diarized_json');
                form.append('chunking_strategy', 'auto');
                if (language) {
                    form.append('language', language);
                }

                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                    body: form,
                    signal,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    let message = errorText;
                    try {
                        const parsed = JSON.parse(errorText);
                        message = parsed?.error?.message || errorText;
                    } catch {
                        // Keep raw text
                    }
                    throw new Error(`OpenAI diarized transcription failed: ${response.status} - ${message}`);
                }

                const data = await response.json() as DiarizedTranscriptionResponse;
                const segments = mapDiarizedSegments(data);
                const text = (data.text || '').trim() || segments.map((seg) => seg.text).filter(Boolean).join(' ').trim();

                console.log(`[provider:openai_diarize] success ${describeFile(file)} attempt=${attempt + 1} segments=${segments.length} language=${data.language || 'unknown'}`);
                return {
                    index: 0,
                    text,
                    segments,
                    language: data.language,
                };
            } catch (error) {
                lastError = error as Error;
                console.warn(`[provider:openai_diarize] error ${describeFile(file)} attempt=${attempt + 1} message="${lastError.message}"`);

                if (signal?.aborted) {
                    throw error;
                }

                const message = (error as Error).message.toLowerCase();
                if (message.includes('429') || message.includes('rate limit')) {
                    const retryAfter = 5000 * (attempt + 1);
                    await sleep(retryAfter);
                    continue;
                }

                if (message.includes('400') || message.includes('401') || message.includes('403')) {
                    throw error;
                }

                if (attempt < MAX_RETRIES - 1) {
                    await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
                }
            }
        }

        throw lastError || new Error('OpenAI diarized transcription failed after max retries');
    }
}

class LocalMetalProvider implements TranscriptionProvider {
    name: TranscriptionProviderName = 'local';
    model = 'whisper-large-v3-turbo';
    private readonly backendUrl: string;
    private readonly hfToken: string;
    private readonly minSpeakers: number;
    private readonly maxSpeakers: number;

    constructor(options: { hfToken?: string; minSpeakers?: number; maxSpeakers?: number; backendUrl?: string } = {}) {
        this.backendUrl = options.backendUrl || 'http://127.0.0.1:8001';
        this.hfToken = options.hfToken || '';
        this.minSpeakers = options.minSpeakers ?? 1;
        this.maxSpeakers = options.maxSpeakers ?? 10;
    }

    async transcribe(file: File, _language?: string, signal?: AbortSignal): Promise<ChunkResult> {
        console.log(`[provider:local] start ${describeFile(file)} model=${this.model} backend=${this.backendUrl}`);
        const form = new FormData();
        form.append('file', file);
        if (this.hfToken) {
            form.append('hf_token', this.hfToken);
        }
        form.append('min_speakers', String(this.minSpeakers));
        form.append('max_speakers', String(this.maxSpeakers));

        const response = await fetch(`${this.backendUrl}/transcribe`, {
            method: 'POST',
            body: form,
            signal,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Local backend error: ${response.status} - ${text}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(`Local backend: ${data.message}`);
        }

        // Map Python backend segments → TranscriptSegment[]
        const segments: TranscriptSegment[] = (data.segments as Array<{
            start_ms?: number;
            end_ms?: number;
            start?: number;
            end?: number;
            text?: string;
            speaker?: string;
        }>).map((seg, index) => ({
            index,
            start_ms: typeof seg.start_ms === 'number'
                ? seg.start_ms
                : typeof seg.start === 'number'
                    ? Math.round(seg.start * 1000)
                    : null,
            end_ms: typeof seg.end_ms === 'number'
                ? seg.end_ms
                : typeof seg.end === 'number'
                    ? Math.round(seg.end * 1000)
                    : null,
            text: (seg.text || '').trim(),
            ...(seg.speaker ? { speaker: seg.speaker } : {}),
        }));

        console.log(`[provider:local] success ${describeFile(file)} segments=${segments.length} language=${data.language || 'unknown'}`);
        return {
            index: 0,
            text: data.full_text || segments.map(s => s.text).join(' '),
            segments,
            language: data.language || undefined,
        };
    }
}

export function isValidTranscriptionProvider(value: string): value is TranscriptionProviderName {
    return value === 'groq' || value === 'openai' || value === 'openai_diarize' || value === 'local';
}

export function getTranscriptionProviderInfo(name: TranscriptionProviderName): Omit<TranscriptionProviderInfo, 'configured'> {
    switch (name) {
        case 'groq':
            return {
                name: 'groq',
                displayName: 'Groq',
                model: 'whisper-large-v3-turbo',
            };
        case 'openai':
            return {
                name: 'openai',
                displayName: 'OpenAI',
                model: 'whisper-1',
            };
        case 'openai_diarize':
            return {
                name: 'openai_diarize',
                displayName: 'OpenAI (Diarize)',
                model: 'gpt-4o-transcribe-diarize',
            };
        case 'local':
            return {
                name: 'local',
                displayName: 'Local (Metal)',
                model: 'whisper-large-v3-turbo',
            };
        default:
            return {
                name,
                displayName: name,
                model: 'unknown',
            };
    }
}

export function getAllTranscriptionProviders(): TranscriptionProviderInfo[] {
    return (['groq', 'openai', 'openai_diarize', 'local'] as TranscriptionProviderName[]).map((name) => {
        const info = getTranscriptionProviderInfo(name);
        return {
            ...info,
            // local provider is always "configured" (no API key needed server-side)
            configured: name === 'local' ? true : Boolean(getProviderApiKeyFromEnv(name)),
        };
    });
}

export function getProviderApiKeyFromEnv(name: TranscriptionProviderName): string | null {
    if (name === 'groq') {
        return process.env.GROQ_API_KEY || null;
    }
    if (name === 'openai' || name === 'openai_diarize') {
        return process.env.OPENAI_API_KEY || null;
    }
    // local provider needs no API key
    return null;
}

export interface LocalProviderOptions {
    hfToken?: string;
    minSpeakers?: number;
    maxSpeakers?: number;
}

export function createTranscriptionProvider(
    name: TranscriptionProviderName,
    apiKeyOverride?: string,
    localOptions?: LocalProviderOptions
): TranscriptionProvider {
    if (name === 'local') {
        return new LocalMetalProvider(localOptions);
    }

    const apiKey = (apiKeyOverride || getProviderApiKeyFromEnv(name) || '').trim();
    if (!apiKey) {
        throw new Error(`${name.toUpperCase()} API key is missing`);
    }

    if (name === 'groq') {
        return new GroqTranscriptionProvider({ apiKey });
    }
    if (name === 'openai') {
        return new OpenAITranscriptionProvider({ apiKey });
    }
    if (name === 'openai_diarize') {
        return new OpenAIDiarizeTranscriptionProvider({ apiKey });
    }

    throw new Error(`Unknown transcription provider: ${name}`);
}
