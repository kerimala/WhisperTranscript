import {
    calculateContiguousCompletedDurationMs,
    createPartialTranscriptionResult,
    getChunkConcurrency,
    preparePreviousChunkResults,
} from '../src/lib/chunk-resume';
import { ChunkResult } from '../src/lib/types';

function chunkResult(index: number, text = `chunk-${index}`): ChunkResult {
    return {
        index,
        text,
        segments: [{ index: 0, start_ms: 0, end_ms: 1000, text }],
    };
}

describe('chunk resume safety', () => {
    it('forces OpenAI diarization chunks to run sequentially', () => {
        expect(getChunkConcurrency('openai_diarize', 4, 4)).toBe(1);
        expect(getChunkConcurrency('openai', 4, 4)).toBe(4);
    });

    it('only accepts skip candidates backed by valid previous results', () => {
        const prepared = preparePreviousChunkResults([
            chunkResult(0),
            chunkResult(2),
            chunkResult(7),
            { index: 1, text: 'invalid', segments: null as never },
        ], 3);

        expect(Array.from(prepared.keys())).toEqual([0, 2]);
    });

    it('preserves completed chunks in sorted partial results', () => {
        const results = new Map([
            [2, chunkResult(2)],
            [0, chunkResult(0)],
        ]);

        expect(createPartialTranscriptionResult(results, 3, 1, 1000, 'de')).toEqual({
            completedChunks: [0, 2],
            results: [chunkResult(0), chunkResult(2)],
            totalChunks: 3,
            failedAtChunk: 1,
            cumulativeDurationMs: 1000,
            detectedLanguage: 'de',
        });
    });

    it('reports only the contiguous completed duration prefix', () => {
        const chunks = [
            { index: 0, startOffsetMs: 0, durationMs: 1000 },
            { index: 1, startOffsetMs: 1000, durationMs: 1000 },
            { index: 2, startOffsetMs: 2000, durationMs: 1000 },
        ];

        expect(calculateContiguousCompletedDurationMs(
            chunks,
            new Map([[0, chunkResult(0)], [2, chunkResult(2)]])
        )).toBe(1000);
    });
});
