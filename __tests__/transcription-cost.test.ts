import {
    estimateOpenAIDiarizationUsageCost,
    estimateTranscriptionCost,
    formatUsdCost,
    GROQ_MINIMUM_BILLABLE_AUDIO_SECONDS,
} from '../src/lib/transcription-cost';

describe('transcription cost estimates', () => {
    it('estimates Groq turbo from audio duration at the published hourly list price', () => {
        const estimate = estimateTranscriptionCost({
            provider: 'groq',
            audioDurationSeconds: 3600,
        });

        expect(estimate).toMatchObject({
            status: 'estimated',
            amountUsd: 0.04,
            pricingUnit: 'audio_hour',
            billableAudioSeconds: 3600,
        });
        expect(estimate.label).toBe('Estimated API list price: $0.04');
    });

    it('applies Groq’s minimum billable duration to every split request', () => {
        const estimate = estimateTranscriptionCost({
            provider: 'groq',
            requestDurationsSeconds: [1, 2, 11],
        });

        expect(estimate.billableAudioSeconds).toBe(
            GROQ_MINIMUM_BILLABLE_AUDIO_SECONDS * 2 + 11
        );
        expect(estimate.amountUsd).toBeCloseTo((31 / 3600) * 0.04, 6);
    });

    it('estimates OpenAI whisper-1 by its published per-minute list price', () => {
        const estimate = estimateTranscriptionCost({
            provider: 'openai',
            audioDurationSeconds: 90,
        });

        expect(estimate).toMatchObject({
            status: 'estimated',
            amountUsd: 0.009,
            pricingUnit: 'audio_minute',
            billableAudioSeconds: 90,
        });
    });

    it('reports no cloud API charge for local transcription', () => {
        expect(estimateTranscriptionCost({ provider: 'local' })).toMatchObject({
            status: 'free',
            amountUsd: 0,
            label: 'Estimated API cost: $0.00',
        });
    });

    it('does not invent a duration-based price for OpenAI diarization', () => {
        const estimate = estimateTranscriptionCost({
            provider: 'openai_diarize',
            audioDurationSeconds: 600,
        });

        expect(estimate).toMatchObject({
            status: 'unavailable',
            amountUsd: null,
            pricingUnit: 'tokens',
        });
        expect(estimate.detail).toContain('duration-only estimate would be misleading');
    });

    it('calculates OpenAI diarization cost only when both token counters exist', () => {
        expect(estimateOpenAIDiarizationUsageCost({
            inputAudioTokens: 1_000_000,
            outputTokens: 1_000_000,
        })).toBe(12.5);
        expect(estimateOpenAIDiarizationUsageCost({ inputAudioTokens: 1_000_000 })).toBeNull();

        const estimate = estimateTranscriptionCost({
            provider: 'openai_diarize',
            tokenUsage: {
                inputAudioTokens: 100_000,
                outputTokens: 10_000,
            },
        });
        expect(estimate).toMatchObject({
            status: 'usage_based',
            amountUsd: 0.35,
        });
    });

    it('waits for a usable audio duration instead of showing a false zero', () => {
        expect(estimateTranscriptionCost({ provider: 'groq', audioDurationSeconds: 0 }))
            .toMatchObject({ status: 'unavailable', amountUsd: null });
    });
});

describe('cost display formatting', () => {
    it('preserves small non-zero prices', () => {
        expect(formatUsdCost(0)).toBe('$0.00');
        expect(formatUsdCost(0.000111)).toBe('$0.0001');
        expect(formatUsdCost(0.04)).toBe('$0.04');
        expect(formatUsdCost(1.2)).toBe('$1.20');
        expect(formatUsdCost(-1)).toBe('—');
    });
});
