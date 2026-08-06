/**
 * Groq API client wrapper for audio transcription
 * 
 * Uses Groq SDK with whisper-large-v3-turbo model.
 * Handles retries and error responses.
 */

import Groq from 'groq-sdk';
import {
    GroqTranscriptionResponse,
    ChunkResult,
    TranscriptSegment,
} from './types';

// Lazy-loaded Groq client to avoid build-time initialization
let groqClient: Groq | null = null;

function getGroqClient(): Groq {
    if (!groqClient) {
        if (!process.env.GROQ_API_KEY) {
            throw new Error('GROQ_API_KEY environment variable is not set');
        }
        groqClient = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        });
    }
    return groqClient;
}

const MODEL = 'whisper-large-v3-turbo';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Transcribe a single audio file using Groq API
 * 
 * @param file - The audio file to transcribe
 * @param language - Optional language hint (ISO-639-1)
 * @param signal - Optional AbortSignal for cancellation
 */
export async function transcribeAudio(
    file: File,
    language?: string,
    signal?: AbortSignal
): Promise<ChunkResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            // Check for cancellation before making request
            if (signal?.aborted) {
                throw new Error('Transcription cancelled');
            }

            const response = await getGroqClient().audio.transcriptions.create({
                file,
                model: MODEL,
                response_format: 'verbose_json',
                timestamp_granularities: ['segment'],
                ...(language && { language }),
            }) as GroqTranscriptionResponse;

            // Convert Groq segments to our format
            const segments: TranscriptSegment[] = (response.segments || []).map((seg, idx) => ({
                index: idx,
                start_ms: seg.start ? Math.round(seg.start * 1000) : null,
                end_ms: seg.end ? Math.round(seg.end * 1000) : null,
                text: seg.text.trim(),
            }));

            return {
                index: 0, // Will be set by caller for chunked files
                text: response.text,
                segments,
                language: response.language,
            };
        } catch (error) {
            lastError = error as Error;

            // Don't retry on cancellation
            if (signal?.aborted) {
                throw error;
            }

            // Check for rate limiting
            if (error instanceof Groq.RateLimitError) {
                // Wait longer for rate limits
                const retryAfter = 5000 * (attempt + 1);
                console.warn(`Rate limited, waiting ${retryAfter}ms before retry...`);
                await sleep(retryAfter);
                continue;
            }

            // Don't retry on client errors (4xx except rate limit)
            if (error instanceof Groq.APIError && error.status && error.status >= 400 && error.status < 500) {
                throw error;
            }

            // Exponential backoff for other errors
            if (attempt < MAX_RETRIES - 1) {
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
                console.warn(`Transcription failed, retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw lastError || new Error('Transcription failed after max retries');
}

/**
 * Transcribe a chunk with proper index tracking
 */
export async function transcribeChunk(
    file: File,
    chunkIndex: number,
    language?: string,
    signal?: AbortSignal
): Promise<ChunkResult> {
    const result = await transcribeAudio(file, language, signal);
    return {
        ...result,
        index: chunkIndex,
    };
}
