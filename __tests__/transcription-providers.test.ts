/** @jest-environment node */

import {
    describeNetworkError,
    fetchWithOpenAITransport,
    OPENAI_TRANSCRIPTION_TIMEOUT_MS,
} from '../src/lib/openai-transport';
import { createTranscriptionProvider } from '../src/lib/transcription-providers';

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
