import {
    getProviderSegmentDurationLimit,
    needsProviderDurationSplit,
    OPENAI_DIARIZE_SEGMENT_TARGET_SECONDS,
} from '../src/lib/transcription-limits';
import { getAdaptiveSegmentDuration } from '../src/lib/audio-splitter';

describe('provider duration limits', () => {
    it('requires long diarization audio to be split even when it is below 24 MB', () => {
        expect(needsProviderDurationSplit('openai_diarize', 2257.6)).toBe(true);
    });

    it('allows diarization audio within the safe request duration', () => {
        expect(needsProviderDurationSplit('openai_diarize', 1200)).toBe(false);
        expect(needsProviderDurationSplit(
            'openai_diarize',
            OPENAI_DIARIZE_SEGMENT_TARGET_SECONDS
        )).toBe(false);
    });

    it('does not impose the diarization duration limit on other providers', () => {
        expect(getProviderSegmentDurationLimit('openai')).toBeNull();
        expect(needsProviderDurationSplit('openai', 5000)).toBe(false);
        expect(needsProviderDurationSplit('groq', 5000)).toBe(false);
    });
});

describe('adaptive audio segment duration', () => {
    it('caps low-bitrate chunks at the provider duration limit', () => {
        const compressedSizeBytes = 14 * 1024 * 1024;
        const durationSeconds = 2257.6;

        expect(getAdaptiveSegmentDuration(
            compressedSizeBytes,
            durationSeconds,
            OPENAI_DIARIZE_SEGMENT_TARGET_SECONDS
        )).toBe(OPENAI_DIARIZE_SEGMENT_TARGET_SECONDS);
    });

    it('can still choose a shorter duration to satisfy the file-size limit', () => {
        expect(getAdaptiveSegmentDuration(
            100 * 1024 * 1024,
            1800,
            OPENAI_DIARIZE_SEGMENT_TARGET_SECONDS
        )).toBeLessThan(OPENAI_DIARIZE_SEGMENT_TARGET_SECONDS);
    });
});
