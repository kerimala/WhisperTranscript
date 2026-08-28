/** @jest-environment node */

import { diarizeExistingTranscriptLocally } from '../src/lib/local-diarization';

describe('local diarization handoff', () => {
    it('streams the original audio and timed Groq words to the local backend', async () => {
        const originalFetch = global.fetch;
        const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            const requestBody = init?.body as ReadableStream<Uint8Array>;
            const multipart = await new Response(requestBody).text();
            expect(multipart).toContain('name="transcript_json"');
            expect(multipart).toContain('"word":"Hello"');
            expect(multipart).toContain('name="hf_token"');
            expect(multipart).toContain('test-token');
            return new Response(
                `   ${JSON.stringify({
                    segments: [{
                        index: 0,
                        start_ms: 0,
                        end_ms: 500,
                        text: 'Hello',
                        speaker: 'SPEAKER_00',
                    }],
                    speaker_count: 1,
                })}`,
                { status: 200 }
            );
        });
        global.fetch = fetchMock as typeof fetch;

        try {
            await expect(diarizeExistingTranscriptLocally({
                file: {
                    name: 'test.wav',
                    type: 'audio/wav',
                    size: 44,
                    path: 'local_backend/test_audio.wav',
                },
                segments: [{ index: 0, start_ms: 0, end_ms: 500, text: 'Hello' }],
                words: [{ word: 'Hello', start_ms: 0, end_ms: 500 }],
                hfToken: 'test-token',
                backendUrl: 'http://127.0.0.1:8001',
            })).resolves.toEqual({
                segments: [{
                    index: 0,
                    start_ms: 0,
                    end_ms: 500,
                    text: 'Hello',
                    speaker: 'SPEAKER_00',
                }],
                speakerCount: 1,
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('requires the speaker token before uploading audio', async () => {
        await expect(diarizeExistingTranscriptLocally({
            file: { name: 'test.wav', type: 'audio/wav', size: 44, path: 'local_backend/test_audio.wav' },
            segments: [],
            hfToken: '',
        })).rejects.toThrow('Hugging Face token');
    });
});
