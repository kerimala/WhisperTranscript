import { TranscriptSegment } from '@/lib/types';

export interface SpeakerTurn {
    speaker: string;
    text: string;
    startMs: number | null;
    endMs: number | null;
    segmentCount: number;
}

export interface SpeakerSummary {
    speaker: string;
    durationMs: number;
    percentage: number;
}

export function buildSpeakerTurns(segments: TranscriptSegment[]): SpeakerTurn[] {
    const turns: SpeakerTurn[] = [];

    for (const segment of segments) {
        const text = segment.text.trim();
        if (!text) continue;

        const speaker = segment.speaker?.trim() || 'Unknown';
        const previous = turns[turns.length - 1];

        if (previous?.speaker === speaker) {
            previous.text = `${previous.text} ${text}`.trim();
            previous.endMs = segment.end_ms ?? previous.endMs;
            previous.segmentCount += 1;
            continue;
        }

        turns.push({
            speaker,
            text,
            startMs: segment.start_ms,
            endMs: segment.end_ms,
            segmentCount: 1,
        });
    }

    return turns;
}

export function summarizeSpeakers(segments: TranscriptSegment[]): SpeakerSummary[] {
    const durations = new Map<string, number>();

    for (const segment of segments) {
        const speaker = segment.speaker?.trim() || 'Unknown';
        const duration = segment.start_ms !== null && segment.end_ms !== null
            ? Math.max(0, segment.end_ms - segment.start_ms)
            : 0;
        durations.set(speaker, (durations.get(speaker) || 0) + duration);
    }

    const total = Array.from(durations.values()).reduce((sum, duration) => sum + duration, 0);
    return Array.from(durations.entries()).map(([speaker, durationMs]) => ({
        speaker,
        durationMs,
        percentage: total > 0 ? (durationMs / total) * 100 : 0,
    }));
}

export function formatTranscriptTime(milliseconds: number | null): string {
    if (milliseconds === null || !Number.isFinite(milliseconds)) return '--:--';
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
