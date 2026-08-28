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

export function getChunkConcurrency(
    provider: TranscriptionProviderName,
    pendingChunkCount: number,
    maxParallel: number
): number {
    if (provider === 'openai_diarize') {
        return 1;
    }
    return Math.min(maxParallel, Math.max(1, pendingChunkCount));
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
