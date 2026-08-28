import { createStreamingMultipartBody, type StreamedUploadFile } from './multipart-upload';
import type { TranscriptSegment, TranscriptWord } from './types';

export interface LocalDiarizationInput {
    file: StreamedUploadFile;
    segments: TranscriptSegment[];
    words?: TranscriptWord[];
    hfToken: string;
    minSpeakers?: number;
    maxSpeakers?: number;
    backendUrl?: string;
    signal?: AbortSignal;
}

interface LocalDiarizationResponse {
    error?: boolean;
    message?: string;
    segments?: TranscriptSegment[];
    speaker_count?: number;
}

export async function diarizeExistingTranscriptLocally(
    input: LocalDiarizationInput
): Promise<{ segments: TranscriptSegment[]; speakerCount?: number }> {
    if (!input.hfToken.trim()) {
        throw new Error('A Hugging Face token is required for local speaker detection.');
    }

    const transcriptJson = JSON.stringify({
        segments: input.segments,
        ...(input.words?.length ? { words: input.words } : {}),
    });
    const upload = createStreamingMultipartBody(input.file, {
        transcript_json: transcriptJson,
        hf_token: input.hfToken.trim(),
        min_speakers: String(input.minSpeakers ?? 1),
        max_speakers: String(input.maxSpeakers ?? 10),
    });
    const backendUrl = input.backendUrl || process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:8001';
    const timeoutSignal = AbortSignal.timeout(60 * 60 * 1000);
    const signal = input.signal
        ? AbortSignal.any([input.signal, timeoutSignal])
        : timeoutSignal;

    let response: Response;
    try {
        response = await fetch(`${backendUrl}/diarize`, {
            method: 'POST',
            headers: { 'Content-Type': upload.contentType },
            body: upload.body,
            signal,
            duplex: 'half',
        } as RequestInit & { duplex: 'half' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Local speaker detection could not be reached. Start WhisperForFiles with its normal launcher, then try again. ${message}`
        );
    }

    const body = (await response.text()).trim();
    let data: LocalDiarizationResponse;
    try {
        data = JSON.parse(body) as LocalDiarizationResponse;
    } catch {
        throw new Error(`Local speaker detection returned an unreadable response (${response.status}).`);
    }

    if (!response.ok || data.error || !Array.isArray(data.segments)) {
        throw new Error(data.message || `Local speaker detection failed (${response.status}).`);
    }

    return {
        segments: data.segments,
        ...(typeof data.speaker_count === 'number' ? { speakerCount: data.speaker_count } : {}),
    };
}
