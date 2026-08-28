import {
    buildSpeakerTurns,
    formatTranscriptTime,
    summarizeSpeakers,
} from '../src/lib/diarized-preview';
import { TranscriptSegment } from '../src/lib/types';

const segments: TranscriptSegment[] = [
    { index: 0, start_ms: 0, end_ms: 1000, speaker: 'A', text: 'Hello' },
    { index: 1, start_ms: 1000, end_ms: 3000, speaker: 'A', text: 'there.' },
    { index: 2, start_ms: 3000, end_ms: 4000, speaker: 'B', text: 'Hi!' },
    { index: 3, start_ms: 4000, end_ms: 5000, text: 'Unassigned.' },
];

describe('buildSpeakerTurns', () => {
    it('groups adjacent segments from the same speaker', () => {
        expect(buildSpeakerTurns(segments)).toEqual([
            {
                speaker: 'A',
                text: 'Hello there.',
                startMs: 0,
                endMs: 3000,
                segmentCount: 2,
            },
            {
                speaker: 'B',
                text: 'Hi!',
                startMs: 3000,
                endMs: 4000,
                segmentCount: 1,
            },
            {
                speaker: 'Unknown',
                text: 'Unassigned.',
                startMs: 4000,
                endMs: 5000,
                segmentCount: 1,
            },
        ]);
    });
});

describe('summarizeSpeakers', () => {
    it('calculates speaking-time shares', () => {
        const summary = summarizeSpeakers(segments);
        expect(summary.find((item) => item.speaker === 'A')?.percentage).toBe(60);
        expect(summary.find((item) => item.speaker === 'B')?.percentage).toBe(20);
        expect(summary.find((item) => item.speaker === 'Unknown')?.percentage).toBe(20);
    });
});

describe('formatTranscriptTime', () => {
    it('formats short and hour-long timestamps', () => {
        expect(formatTranscriptTime(65_000)).toBe('1:05');
        expect(formatTranscriptTime(3_665_000)).toBe('1:01:05');
        expect(formatTranscriptTime(null)).toBe('--:--');
    });
});
