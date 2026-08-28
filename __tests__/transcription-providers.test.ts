/** @jest-environment node */

import {
    describeNetworkError,
    fetchWithOpenAITransport,
    OPENAI_TRANSCRIPTION_TIMEOUT_MS,
} from '../src/lib/openai-transport';
import {
    createTranscriptionProvider,
    getTranscriptionProviderInfo,
} from '../src/lib/transcription-providers';

describe('transcription provider capability metadata', () => {
    it('does not advertise Groq speaker diarization that its hosted speech API does not provide', () => {
        expect(getTranscriptionProviderInfo('groq')).toEqual(expect.objectContaining({
            model: 'whisper-large-v3-turbo',
            supportsSpeakerDiarization: false,
        }));
    });

    it('identifies the providers that can return speaker labels', () => {
        expect(getTranscriptionProviderInfo('openai_diarize').supportsSpeakerDiarization).toBe(true);
        expect(getTranscriptionProviderInfo('local').supportsSpeakerDiarization).toBe(true);
    });
});

describe('Groq transcription provider', () => {
    it('forwards cancellation to the Groq SDK request', async () => {
        const provider = createTranscriptionProvider('groq', 'test-key');
        const client = (provider as unknown as {
            client: {
                audio: {
                    transcriptions: {
                        create: (...args: unknown[]) => Promise<unknown>;
                    };
                };
            };
        }).client;
        const createSpy = jest.spyOn(client.audio.transcriptions, 'create').mockResolvedValue({
            text: 'Hello',
            language: 'en',
            segments: [{ start: 0, end: 0.5, text: 'Hello' }],
            words: [{ start: 0, end: 0.5, word: 'Hello' }],
        });
        const controller = new AbortController();
        const file = new File(['audio'], 'chunk.webm', { type: 'audio/webm' });

        await provider.transcribe(file, 'en', controller.signal);

        expect(createSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                file,
                model: 'whisper-large-v3-turbo',
                response_format: 'verbose_json',
                timestamp_granularities: ['word', 'segment'],
            }),
            { signal: controller.signal }
        );

        await expect(provider.transcribe(file, 'en')).resolves.toEqual(expect.objectContaining({
            words: [{ word: 'Hello', start_ms: 0, end_ms: 500 }],
        }));
    });
});

describe('OpenAI transcription transport', () => {
    it('allows substantially longer than the default five-minute Undici timeout', () => {
        expect(OPENAI_TRANSCRIPTION_TIMEOUT_MS).toBe(20 * 60 * 1000);
        expect(OPENAI_TRANSCRIPTION_TIMEOUT_MS).toBeGreaterThan(300_000);
    });

    it('keeps the underlying transport code in fetch failure diagnostics', () => {
        const error = new TypeError('fetch failed', {
            cause: Object.assign(new Error('Headers Timeout Error'), {
                code: 'UND_ERR_HEADERS_TIMEOUT',
            }),
        });

        expect(describeNetworkError(error)).toBe(
            'fetch failed (UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error)'
        );
    });

    it('passes a custom dispatcher to the runtime fetch implementation', async () => {
        const originalFetch = global.fetch;
        const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        global.fetch = fetchMock;

        try {
            await fetchWithOpenAITransport('https://example.test', { method: 'POST' });
            expect(fetchMock).toHaveBeenCalledWith(
                'https://example.test',
                expect.objectContaining({
                    method: 'POST',
                    dispatcher: expect.any(Object),
                })
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('does not retry an ambiguous diarized transcription network failure', async () => {
        const originalFetch = global.fetch;
        const fetchError = new TypeError('fetch failed', {
            cause: Object.assign(new Error('Headers Timeout Error'), {
                code: 'UND_ERR_HEADERS_TIMEOUT',
            }),
        });
        const fetchMock = jest.fn().mockRejectedValue(fetchError);
        global.fetch = fetchMock;

        try {
            const provider = createTranscriptionProvider('openai_diarize', 'test-key');
            const file = new File(['audio'], 'chunk.webm', { type: 'audio/webm' });

            await expect(provider.transcribe(file)).rejects.toThrow(
                'It was not retried automatically because the request may already have been processed.'
            );
            expect(fetchMock).toHaveBeenCalledTimes(1);

            const init = fetchMock.mock.calls[0][1] as RequestInit;
            const body = init.body as FormData;
            expect(body.get('model')).toBe('gpt-4o-transcribe-diarize');
            expect(body.get('chunking_strategy')).toBe('auto');
            expect(body.get('service_tier')).toBeNull();
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('does not retry a non-rate-limit provider response', async () => {
        const originalFetch = global.fetch;
        const fetchMock = jest.fn().mockResolvedValue(new Response(
            JSON.stringify({ error: { message: 'upstream failure' } }),
            { status: 500 }
        ));
        global.fetch = fetchMock;

        try {
            const provider = createTranscriptionProvider('openai_diarize', 'test-key');
            const file = new File(['audio'], 'chunk.webm', { type: 'audio/webm' });

            await expect(provider.transcribe(file)).rejects.toThrow(
                'OpenAI diarized transcription failed: 500 - upstream failure'
            );
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
