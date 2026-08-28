import { TranscriptionProviderName } from './types';

/**
 * Provider list prices verified against the linked official model documentation
 * on 2026-08-28. These are list prices only: account credits, free-tier
 * allowances, taxes, failed requests, and provider-side retries are excluded.
 */
export const TRANSCRIPTION_COST_PRICING_VERIFIED_ON = '2026-08-28';

export const GROQ_WHISPER_LARGE_V3_TURBO_USD_PER_AUDIO_HOUR = 0.04;
export const GROQ_MINIMUM_BILLABLE_AUDIO_SECONDS = 10;
export const OPENAI_WHISPER_USD_PER_AUDIO_MINUTE = 0.006;
export const OPENAI_DIARIZE_USD_PER_MILLION_AUDIO_INPUT_TOKENS = 2.5;
export const OPENAI_DIARIZE_USD_PER_MILLION_OUTPUT_TOKENS = 10;

export const TRANSCRIPTION_COST_SOURCES = {
    groq: 'https://console.groq.com/docs/speech-to-text',
    openai: 'https://developers.openai.com/api/docs/models/whisper-1',
    openai_diarize: 'https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize',
} as const;

export type TranscriptionCostStatus =
    | 'estimated'
    | 'usage_based'
    | 'free'
    | 'unavailable';

export type TranscriptionCostPricingUnit =
    | 'audio_hour'
    | 'audio_minute'
    | 'tokens'
    | 'none';

/**
 * Token counts must be aggregated over every completed provider request before
 * being passed in. This is relevant when the server split one upload into
 * multiple chunks.
 */
export interface TranscriptionTokenUsage {
    inputAudioTokens?: number | null;
    outputTokens?: number | null;
}

export interface EstimateTranscriptionCostInput {
    provider: TranscriptionProviderName;
    /**
     * Total audio duration used for an estimate when request-level durations
     * are not known yet.
     */
    audioDurationSeconds?: number | null;
    /**
     * One duration per provider request. Groq applies its 10-second minimum to
     * each request, so this produces a more faithful estimate for split audio.
     */
    requestDurationsSeconds?: readonly number[] | null;
    /**
     * Returned provider usage, when available. It is used only for the
     * token-priced OpenAI diarization model.
     */
    tokenUsage?: TranscriptionTokenUsage | null;
}

/**
 * A UI-ready cost model. `amountUsd` is intentionally null where duration is
 * insufficient to price a token-billed model; callers should render `label`
 * and `detail` rather than inventing a dollar amount.
 */
export interface TranscriptionCostEstimate {
    provider: TranscriptionProviderName;
    status: TranscriptionCostStatus;
    amountUsd: number | null;
    label: string;
    detail: string;
    pricingUnit: TranscriptionCostPricingUnit;
    sourceUrl?: string;
    pricingVerifiedOn?: string;
    billableAudioSeconds?: number;
}

function isPositiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getRequestDurations(input: EstimateTranscriptionCostInput): number[] {
    const requestDurations = input.requestDurationsSeconds
        ?.filter(isPositiveFiniteNumber);

    if (requestDurations && requestDurations.length > 0) {
        return requestDurations;
    }

    return isPositiveFiniteNumber(input.audioDurationSeconds)
        ? [input.audioDurationSeconds]
        : [];
}

function roundUsd(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function unavailableEstimate(
    provider: TranscriptionProviderName,
    detail: string,
    pricingUnit: TranscriptionCostPricingUnit,
    sourceUrl?: string
): TranscriptionCostEstimate {
    return {
        provider,
        status: 'unavailable',
        amountUsd: null,
        label: 'Cost pending',
        detail,
        pricingUnit,
        ...(sourceUrl ? {
            sourceUrl,
            pricingVerifiedOn: TRANSCRIPTION_COST_PRICING_VERIFIED_ON,
        } : {}),
    };
}

/**
 * Estimate a provider's API list price from the known audio duration. The
 * estimate is deliberately not an invoice: it does not include account-level
 * credits, taxes, or charges caused by retries after an indeterminate failure.
 */
export function estimateTranscriptionCost(
    input: EstimateTranscriptionCostInput
): TranscriptionCostEstimate {
    const { provider } = input;

    if (provider === 'local') {
        return {
            provider,
            status: 'free',
            amountUsd: 0,
            label: 'Estimated API cost: $0.00',
            detail: 'Local transcription does not make a metered cloud transcription API call.',
            pricingUnit: 'none',
        };
    }

    if (provider === 'openai_diarize') {
        const usageEstimate = estimateOpenAIDiarizationUsageCost(input.tokenUsage);
        if (usageEstimate !== null) {
            return {
                provider,
                status: 'usage_based',
                amountUsd: usageEstimate,
                label: `Usage-based API cost: ${formatUsdCost(usageEstimate)}`,
                detail: 'Calculated from aggregated audio-input and output token usage returned by OpenAI.',
                pricingUnit: 'tokens',
                sourceUrl: TRANSCRIPTION_COST_SOURCES.openai_diarize,
                pricingVerifiedOn: TRANSCRIPTION_COST_PRICING_VERIFIED_ON,
            };
        }

        return unavailableEstimate(
            provider,
            'OpenAI diarization is token-priced. A duration-only estimate would be misleading; cost is shown once aggregate token usage is available.',
            'tokens',
            TRANSCRIPTION_COST_SOURCES.openai_diarize
        );
    }

    const requestDurations = getRequestDurations(input);
    if (requestDurations.length === 0) {
        return unavailableEstimate(
            provider,
            'Waiting for the audio duration before estimating the provider list price.',
            provider === 'groq' ? 'audio_hour' : 'audio_minute',
            provider === 'groq'
                ? TRANSCRIPTION_COST_SOURCES.groq
                : TRANSCRIPTION_COST_SOURCES.openai
        );
    }

    if (provider === 'groq') {
        const billableAudioSeconds = requestDurations.reduce(
            (total, duration) => total + Math.max(duration, GROQ_MINIMUM_BILLABLE_AUDIO_SECONDS),
            0
        );
        const amountUsd = roundUsd(
            (billableAudioSeconds / 3600) * GROQ_WHISPER_LARGE_V3_TURBO_USD_PER_AUDIO_HOUR
        );

        return {
            provider,
            status: 'estimated',
            amountUsd,
            label: `Estimated API list price: ${formatUsdCost(amountUsd)}`,
            detail: `Groq whisper-large-v3-turbo list price is $${GROQ_WHISPER_LARGE_V3_TURBO_USD_PER_AUDIO_HOUR.toFixed(2)} per audio hour; each request has a ${GROQ_MINIMUM_BILLABLE_AUDIO_SECONDS}-second minimum. Credits and free-tier allowances are not included.`,
            pricingUnit: 'audio_hour',
            sourceUrl: TRANSCRIPTION_COST_SOURCES.groq,
            pricingVerifiedOn: TRANSCRIPTION_COST_PRICING_VERIFIED_ON,
            billableAudioSeconds,
        };
    }

    const billableAudioSeconds = requestDurations.reduce((total, duration) => total + duration, 0);
    const amountUsd = roundUsd(
        (billableAudioSeconds / 60) * OPENAI_WHISPER_USD_PER_AUDIO_MINUTE
    );

    return {
        provider,
        status: 'estimated',
        amountUsd,
        label: `Estimated API list price: ${formatUsdCost(amountUsd)}`,
        detail: `OpenAI whisper-1 list price is $${OPENAI_WHISPER_USD_PER_AUDIO_MINUTE.toFixed(3)} per audio minute. Credits, taxes, and retry-related charges are not included.`,
        pricingUnit: 'audio_minute',
        sourceUrl: TRANSCRIPTION_COST_SOURCES.openai,
        pricingVerifiedOn: TRANSCRIPTION_COST_PRICING_VERIFIED_ON,
        billableAudioSeconds,
    };
}

/**
 * Returns null until both token counters are available. This avoids presenting
 * an incomplete diarization charge as if it were an exact number.
 */
export function estimateOpenAIDiarizationUsageCost(
    tokenUsage?: TranscriptionTokenUsage | null
): number | null {
    const inputAudioTokens = tokenUsage?.inputAudioTokens;
    const outputTokens = tokenUsage?.outputTokens;

    if (
        !isPositiveOrZeroFiniteNumber(inputAudioTokens) ||
        !isPositiveOrZeroFiniteNumber(outputTokens)
    ) {
        return null;
    }

    return roundUsd(
        (inputAudioTokens / 1_000_000) * OPENAI_DIARIZE_USD_PER_MILLION_AUDIO_INPUT_TOKENS +
        (outputTokens / 1_000_000) * OPENAI_DIARIZE_USD_PER_MILLION_OUTPUT_TOKENS
    );
}

function isPositiveOrZeroFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Avoid rendering sub-cent charges as "$0.00", which would falsely suggest a
 * zero cost. Values are kept at a compact precision suitable for a status UI.
 */
export function formatUsdCost(amountUsd: number): string {
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
        return '—';
    }

    if (amountUsd === 0) {
        return '$0.00';
    }

    const maximumFractionDigits = amountUsd < 0.01 ? 4 : 2;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits,
    }).format(amountUsd);
}
