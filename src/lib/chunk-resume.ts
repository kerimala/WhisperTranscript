import {
    ChunkResult,
    PartialTranscriptionResult,
    TranscriptionProviderName,
} from './types';

interface ChunkDuration {
    index: number;
    startOffsetMs: number;
    durationMs?: number;
}

/**
 * Diarization requests are billable and may take longer than a regular
 * transcription. Two concurrent requests materially improves multi-chunk
 * jobs while avoiding an uncontrolled burst of paid work by default.
 */
export const DEFAULT_OPENAI_DIARIZE_CHUNK_CONCURRENCY = 2;

/**
 * Keep the provider-specific override within the route's established worker
 * ceiling. Raising this requires an explicit code change and capacity review.
 */
export const MAX_OPENAI_DIARIZE_CHUNK_CONCURRENCY = 4;

function normalizeWorkerLimit(value: number): number {
    if (!Number.isFinite(value)) {
        return 1;
    }

    return Math.max(1, Math.floor(value));
}

/**
 * Resolve the optional OpenAI diarization worker override safely. Invalid
 * values fall back to the bounded default; no environment setting can exceed
 * the route's global worker limit or the hard diarization ceiling.
 */
export function getOpenAIDiarizeChunkConcurrency(
    configuredValue: string | undefined,
    maxParallel: number
): number {
    const allowedMaximum = Math.min(
        normalizeWorkerLimit(maxParallel),
        MAX_OPENAI_DIARIZE_CHUNK_CONCURRENCY
    );
    const fallback = Math.min(DEFAULT_OPENAI_DIARIZE_CHUNK_CONCURRENCY, allowedMaximum);
    const normalizedValue = configuredValue?.trim();

    if (!normalizedValue || !/^\d+$/.test(normalizedValue)) {
        return fallback;
    }

    const requested = Number.parseInt(normalizedValue, 10);
    if (requested < 1) {
        return fallback;
    }

    return Math.min(requested, allowedMaximum);
}

export function getChunkConcurrency(
    provider: TranscriptionProviderName,
    pendingChunkCount: number,
    maxParallel: number,
    openAIDiarizeConfiguredConcurrency?: string
): number {
    const safeMaxParallel = normalizeWorkerLimit(maxParallel);
    const providerMaxParallel = provider === 'openai_diarize'
        ? getOpenAIDiarizeChunkConcurrency(
            openAIDiarizeConfiguredConcurrency,
            safeMaxParallel
        )
        : safeMaxParallel;

    return Math.min(providerMaxParallel, Math.max(1, pendingChunkCount));
}

export function preparePreviousChunkResults(
    previousResults: ChunkResult[],
    totalChunks: number
): Map<number, ChunkResult> {
    const results = new Map<number, ChunkResult>();

    for (const result of previousResults) {
        if (!Number.isInteger(result.index) || result.index < 0 || result.index >= totalChunks) {
            continue;
        }
        if (typeof result.text !== 'string' || !Array.isArray(result.segments)) {
            continue;
        }
        results.set(result.index, result);
    }

    return results;
}

export function createPartialTranscriptionResult(
    resultsByIndex: Map<number, ChunkResult>,
    totalChunks: number,
    failedAtChunk: number,
    cumulativeDurationMs: number,
    detectedLanguage: string | null
): PartialTranscriptionResult {
    const results = Array.from(resultsByIndex.values()).sort((a, b) => a.index - b.index);

    return {
        completedChunks: results.map(result => result.index),
        results,
        totalChunks,
        failedAtChunk,
        cumulativeDurationMs,
        detectedLanguage,
    };
}

export function calculateContiguousCompletedDurationMs(
    chunks: ChunkDuration[],
    resultsByIndex: Map<number, ChunkResult>
): number {
    let contiguousEndMs = 0;

    for (const chunk of [...chunks].sort((a, b) => a.index - b.index)) {
        if (!resultsByIndex.has(chunk.index)) {
            break;
        }
        contiguousEndMs = chunk.startOffsetMs + (chunk.durationMs || 0);
    }

    return contiguousEndMs;
}
