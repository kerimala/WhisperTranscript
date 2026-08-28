/**
 * TypeScript interfaces for the Whisper Transcription App
 */

// Supported audio file types for OpenAI-compatible transcription providers
export const SUPPORTED_AUDIO_TYPES = [
    'audio/flac',
    'audio/mp3',
    'audio/mpeg',
    'audio/mpga',
    'audio/m4a',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'video/mp4',
    'video/webm',
] as const;

export const SUPPORTED_EXTENSIONS = [
    '.flac',
    '.mp3',
    '.mp4',
    '.mpeg',
    '.mpga',
    '.m4a',
    '.ogg',
    '.wav',
    '.webm',
] as const;

// File size limits used by the app (in bytes)
export const MAX_FILE_SIZE_FREE = 25 * 1024 * 1024; // 25 MB
export const MAX_FILE_SIZE_DEV = 100 * 1024 * 1024; // 100 MB
export const MAX_CHUNK_SIZE = 24 * 1024 * 1024; // 24 MB (with 1 MB buffer)

/**
 * Supported transcription providers
 */
export type TranscriptionProviderName = 'groq' | 'openai' | 'openai_diarize' | 'local';

/**
 * Metadata for provider selection in the UI
 */
export interface TranscriptionProviderInfo {
    name: TranscriptionProviderName;
    displayName: string;
    model: string;
    configured: boolean;
}

/**
 * Source file metadata in output
 */
export interface SourceFile {
    name: string;
    type: string;
    size_bytes: number;
}

/**
 * Individual transcript segment with optional timing
 */
export interface TranscriptSegment {
    index: number;
    start_ms: number | null;
    end_ms: number | null;
    text: string;
    speaker?: string;
}

/**
 * Final transcription result matching the spec
 */
export interface TranscriptionResult {
    source_file: SourceFile;
    provider: TranscriptionProviderName;
    model: string;
    language: string | null;
    segments: TranscriptSegment[];
    full_text: string;
    diarized_text?: string;
    preparation?: {
        compressed: boolean;
        split: boolean;
        upload_size_bytes: number;
        upload_file_name: string;
        upload_mime_type: string;
        optimization_reason?: string;
        reduction_percent?: number;
        source_duration_seconds?: number;
        split_reason?: 'size' | 'duration' | 'size_and_duration';
    };
    pipelineSummary?: string;
    created_at: string;
}

/**
 * Progress update sent during transcription
 */
export interface ProgressUpdate {
    stage: 'uploading' | 'processing' | 'complete' | 'error';
    progress: number; // 0-100
    currentChunk?: number;
    totalChunks?: number;
    message: string;
}

/**
 * Chunk metadata for large file processing
 */
export interface AudioChunk {
    index: number;
    data: Blob;
    startByte: number;
    endByte: number;
}

/**
 * Result from transcribing a single chunk
 */
export interface ChunkResult {
    index: number;
    text: string;
    segments: TranscriptSegment[];
    language?: string;
}

/**
 * Groq API response for verbose_json format
 */
export interface GroqTranscriptionResponse {
    text: string;
    language?: string;
    duration?: number;
    segments?: Array<{
        id: number;
        seek: number;
        start: number;
        end: number;
        text: string;
        tokens: number[];
        temperature: number;
        avg_logprob: number;
        compression_ratio: number;
        no_speech_prob: number;
    }>;
    words?: Array<{
        word: string;
        start: number;
        end: number;
    }>;
}

/**
 * Rate limit information parsed from API errors
 */
export interface RateLimitInfo {
    limit: number;
    used: number;
    requested: number;
    retryAfterSeconds: number;
    retryAt: string; // ISO timestamp
    percentUsed: number;
}

/**
 * Partial results returned when transcription is interrupted (e.g., rate limit)
 */
export interface PartialTranscriptionResult {
    completedChunks: number[];          // Indices of successfully completed chunks
    results: ChunkResult[];             // Transcription results for completed chunks
    totalChunks: number;                // Total number of chunks
    failedAtChunk: number;              // Index where processing failed
    cumulativeDurationMs: number;       // Duration offset for resuming
    detectedLanguage: string | null;    // Language from first chunk
}

/**
 * State for resumable transcription stored in localStorage
 */
export interface SavedTranscriptionState {
    fileHash: string;                   // Unique identifier for the file
    fileName: string;
    fileSize: number;
    fileType: string;
    totalChunks: number;
    completedChunks: number[];
    results: ChunkResult[];
    cumulativeDurationMs: number;
    detectedLanguage: string | null;
    createdAt: string;
    lastUpdatedAt: string;
    expiresAt: string;                  // Auto-expire after 24 hours
}

/**
 * Error response structure
 */
export interface TranscriptionError {
    error: true;
    message: string;
    code?: string;
    retryable?: boolean;
    supportedTypes?: string[];
    rateLimit?: RateLimitInfo;
    partialResult?: PartialTranscriptionResult;
}

/**
 * API response type (success or error)
 */
export type TranscriptionResponse = TranscriptionResult | TranscriptionError;

/**
 * Type guard to check if response is an error
 */
export function isTranscriptionError(
    response: TranscriptionResponse
): response is TranscriptionError {
    return 'error' in response && response.error === true;
}

// ============================================
// AI Analysis Types
// ============================================

/**
 * Available AI analysis modes
 */
export type AnalysisMode = 'summarize' | 'tasks' | 'key_points';

/**
 * Supported AI providers
 */
export type AIProviderName = 'kimi' | 'deepseek';

/**
 * Request body for analysis API
 */
export interface AnalysisRequest {
    text: string;
    mode: AnalysisMode;
    provider?: AIProviderName;
}

/**
 * Analysis result from AI provider
 */
export interface AnalysisResult {
    provider: AIProviderName;
    model: string;
    mode: AnalysisMode;
    content: string;
    created_at: string;
}

/**
 * Cleaned transcript for AI analysis (minimal token usage)
 */
export interface CleanedTranscript {
    full_text: string;
    segments: string[]; // Just the text, no metadata
}

/**
 * Analysis error response
 */
export interface AnalysisError {
    error: true;
    message: string;
    code?: string;
}

/**
 * Type guard for analysis error
 */
export function isAnalysisError(
    response: AnalysisResult | AnalysisError
): response is AnalysisError {
    return 'error' in response && response.error === true;
}
