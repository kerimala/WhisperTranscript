import { TranscriptionProviderName } from './types';

// The model returned a 1,400-second maximum in a real API rejection. Keep an
// empirical safety margin for container/ffprobe rounding and segment boundaries.
export const OPENAI_DIARIZE_REQUEST_LIMIT_SECONDS = 1400;
export const OPENAI_DIARIZE_SEGMENT_TARGET_SECONDS = 1300;

export function getProviderSegmentDurationLimit(
    provider: TranscriptionProviderName
): number | null {
    return provider === 'openai_diarize'
        ? OPENAI_DIARIZE_SEGMENT_TARGET_SECONDS
        : null;
}

export function needsProviderDurationSplit(
    provider: TranscriptionProviderName,
    durationSeconds: number
): boolean {
    const limit = getProviderSegmentDurationLimit(provider);
    return limit !== null && durationSeconds > limit;
}
