import { Agent } from 'undici';

export const OPENAI_TRANSCRIPTION_TIMEOUT_MS = 20 * 60 * 1000;

const globalForOpenAITransport = globalThis as typeof globalThis & {
    __openAITranscriptionDispatcher?: Agent;
};

const openAITranscriptionDispatcher = globalForOpenAITransport.__openAITranscriptionDispatcher ?? new Agent({
    connectTimeout: 30_000,
    headersTimeout: OPENAI_TRANSCRIPTION_TIMEOUT_MS,
    bodyTimeout: OPENAI_TRANSCRIPTION_TIMEOUT_MS,
});

if (process.env.NODE_ENV !== 'production') {
    globalForOpenAITransport.__openAITranscriptionDispatcher = openAITranscriptionDispatcher;
}

interface DispatcherRequestInit extends RequestInit {
    dispatcher: Agent;
}

interface ErrorCauseLike {
    code?: unknown;
    message?: unknown;
}

export function fetchWithOpenAITransport(
    input: string | URL | Request,
    init: RequestInit
): Promise<Response> {
    return fetch(input, {
        ...init,
        dispatcher: openAITranscriptionDispatcher,
    } as DispatcherRequestInit);
}

export function describeNetworkError(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }

    const cause = (error as Error & { cause?: ErrorCauseLike }).cause;
    const causeCode = typeof cause?.code === 'string' ? cause.code : null;
    const causeMessage = typeof cause?.message === 'string' ? cause.message : null;

    if (causeCode && causeMessage) {
        return `${error.message} (${causeCode}: ${causeMessage})`;
    }
    if (causeCode) {
        return `${error.message} (${causeCode})`;
    }
    if (causeMessage && causeMessage !== error.message) {
        return `${error.message} (${causeMessage})`;
    }

    return error.message;
}

export function isNetworkFetchError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const cause = (error as Error & { cause?: ErrorCauseLike }).cause;
    return error instanceof TypeError || typeof cause?.code === 'string';
}
