/**
 * Transcription API Route
 *
 * POST /api/transcribe
 * Accepts multipart/form-data with audio file.
 * Supports provider selection (Groq/OpenAI) and large-file splitting via ffmpeg.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
    TranscriptionResult,
    TranscriptionError,
    SUPPORTED_EXTENSIONS,
    RateLimitInfo,
    PartialTranscriptionResult,
    ChunkResult,
    TranscriptionProviderName,
    TranscriptSegment,
} from '@/lib/types';
import { isValidFileType } from '@/utils/file-validation';
import {
    reassembleTranscriptSegments,
    reassembleFullText,
} from '@/lib/chunker';
import {
    calculateContiguousCompletedDurationMs,
    createPartialTranscriptionResult,
    getChunkConcurrency,
    preparePreviousChunkResults,
} from '@/lib/chunk-resume';
import {
    needsAudioSplitting,
    getAudioDuration,
    optimizeAudioForTranscription,
    saveUploadedFile,
    splitAudioFile,
    readSegmentAsFile,
    cleanupTempFiles,
} from '@/lib/audio-splitter';
import {
    getProviderSegmentDurationLimit,
    needsProviderDurationSplit,
} from '@/lib/transcription-limits';
import {
    createTranscriptionProvider,
    getAllTranscriptionProviders,
    getProviderApiKeyFromEnv,
    isValidTranscriptionProvider,
} from '@/lib/transcription-providers';

/**
 * Create an error response
 */
function errorResponse(
    message: string,
    status: number,
    options?: {
        supportedTypes?: string[];
        rateLimit?: RateLimitInfo;
        partialResult?: PartialTranscriptionResult;
        code?: string;
        retryable?: boolean;
    }
): NextResponse<TranscriptionError> {
    return NextResponse.json(
        {
            error: true,
            message,
            ...(options?.supportedTypes && { supportedTypes: options.supportedTypes }),
            ...(options?.rateLimit && { rateLimit: options.rateLimit }),
            ...(options?.partialResult && { partialResult: options.partialResult }),
            ...(options?.code && { code: options.code }),
            ...(typeof options?.retryable === 'boolean' && { retryable: options.retryable }),
        },
        { status }
    );
}

/**
 * Parse rate limit info from provider error message
 */
function parseRateLimitError(errorMessage: string): RateLimitInfo | null {
    try {
        const limitMatch = errorMessage.match(/Limit (\d+)/i);
        const usedMatch = errorMessage.match(/Used (\d+)/i);
        const requestedMatch = errorMessage.match(/Requested (\d+)/i);
        const retryMatch = errorMessage.match(/(?:try again in|retry after)\s*(\d+)m?(\d+)?s?/i);

        if (!limitMatch || !usedMatch) return null;

        const limit = parseInt(limitMatch[1], 10);
        const used = parseInt(usedMatch[1], 10);
        const requested = requestedMatch ? parseInt(requestedMatch[1], 10) : 0;

        let retryAfterSeconds = 60;
        if (retryMatch) {
            const minutes = parseInt(retryMatch[1], 10) || 0;
            const seconds = parseInt(retryMatch[2], 10) || 0;
            retryAfterSeconds = minutes * 60 + seconds;
        }

        const retryAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
        const percentUsed = Math.round((used / limit) * 100);

        return { limit, used, requested, retryAfterSeconds, retryAt, percentUsed };
    } catch {
        return null;
    }
}

function buildDiarizedText(segments: TranscriptSegment[], createdAt: string, provider: string, model: string): string | undefined {
    const labeled = segments.filter((segment) => typeof segment.speaker === 'string' && segment.speaker.trim().length > 0);
    if (labeled.length === 0) {
        return undefined;
    }

    const lines: string[] = [];
    let currentSpeaker: string | null = null;
    let buffer: string[] = [];

    for (const segment of labeled) {
        const speaker = segment.speaker!.trim();
        const text = segment.text.trim();
        if (!text) {
            continue;
        }

        if (speaker !== currentSpeaker) {
            if (buffer.length > 0 && currentSpeaker) {
                lines.push(`${currentSpeaker}: ${buffer.join(' ')}`);
            }
            currentSpeaker = speaker;
            buffer = [text];
            continue;
        }

        buffer.push(text);
    }

    if (buffer.length > 0 && currentSpeaker) {
        lines.push(`${currentSpeaker}: ${buffer.join(' ')}`);
    }

    if (lines.length === 0) {
        return undefined;
    }

    return `**Transcription** | ${createdAt} | ${provider} | ${model}\n\n${lines.join('\n')}`;
}

async function saveResultToDisk(fileName: string, result: TranscriptionResult): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const saveDir = path.join(process.cwd(), 'transcriptions');
    await fs.mkdir(saveDir, { recursive: true });

    const safeName = (fileName || 'audio_file').replace(/[^a-zA-Z0-9.-]/g, '_');
    const dateString = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFileName = `${dateString}_${safeName}.json`;
    const filePath = path.join(saveDir, outputFileName);

    await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`Saved transcription to ${filePath}`);
}

function formatMiB(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MAX_PARALLEL_CHUNK_TRANSCRIPTIONS = 4;

function isRateLimitMessage(message: string): boolean {
    return message.includes('rate limit') || message.includes('Rate limit') || message.includes('429');
}

function isNetworkFailureMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('network request failed') ||
        normalized.includes('fetch failed') ||
        normalized.includes('und_err_');
}

function sortChunkResults(results: ChunkResult[]): ChunkResult[] {
    return [...results].sort((a, b) => a.index - b.index);
}

interface ChunkFailure {
    message: string;
    chunkIndex: number;
}

/**
 * POST /api/transcribe
 */

// Allow long-running sequential diarization requests (up to 60 minutes).
export const maxDuration = 3600;
export async function POST(request: NextRequest): Promise<NextResponse<TranscriptionResult | TranscriptionError>> {
    const requestId = randomUUID().slice(0, 8);
    let tempDir: string | null = null;
    let splitTempDir: string | null = null;
    const startedAt = Date.now();
    const log = (message: string) => console.log(`[transcribe:${requestId}] ${message}`);
    const warn = (message: string) => console.warn(`[transcribe:${requestId}] ${message}`);

    try {
        const formData = await request.formData();

        const file = formData.get('file') as File | null;
        const language = formData.get('language') as string | null;
        const providerRaw = (formData.get('provider') as string | null) ?? 'groq';
        const providerName = providerRaw.toLowerCase().trim();
        const apiKeyOverride = (formData.get('apiKey') as string | null)?.trim() || undefined;
        log(`request received provider=${providerName} language=${language || 'auto'} file="${file?.name || 'missing'}" size=${file ? formatMiB(file.size) : 'n/a'}`);

        // Local provider: proxy straight to Python backend and return its response
        if (providerName === 'local') {
            if (!file) {
                return errorResponse('No file provided', 400);
            }
            const backendUrl = process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:8001';
            // UI field takes precedence; fall back to .env.local HF_TOKEN
            const hfToken =
                (formData.get('hfToken') as string | null)?.trim() ||
                (process.env.HF_TOKEN ?? '');
            const minSpeakers = (formData.get('minSpeakers') as string | null) || '1';
            const maxSpeakers = (formData.get('maxSpeakers') as string | null) || '10';

            const proxyForm = new FormData();
            proxyForm.append('file', file);
            if (language) proxyForm.append('language', language);
            if (hfToken) proxyForm.append('hf_token', hfToken);
            proxyForm.append('min_speakers', minSpeakers);
            proxyForm.append('max_speakers', maxSpeakers);

            let backendRes: Response;
            try {
                log(`forwarding to local backend url=${backendUrl} hf_token=${hfToken ? 'provided' : 'env/none'} speakers=${minSpeakers}-${maxSpeakers}`);
                // 30-minute timeout — local transcription of long audio files
                // can take 10-15+ minutes on a MacBook Air.
                backendRes = await fetch(`${backendUrl}/transcribe`, {
                    method: 'POST',
                    body: proxyForm,
                    signal: AbortSignal.timeout(30 * 60 * 1000),
                });
            } catch (fetchErr) {
                const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                if (msg.includes('TimeoutError') || msg.includes('timed out') || msg.includes('abort')) {
                    warn(`local backend timeout after ${(Date.now() - startedAt) / 1000}s`);
                    return errorResponse(
                        'Local backend timed out. The audio file may be too long for available memory.',
                        504
                    );
                }
                warn(`local backend unreachable message="${msg}"`);
                return errorResponse(
                    'Could not reach local backend. Make sure the server is running: cd local_backend && bash start.sh',
                    503
                );
            }

            // Automatically save the result to the filesystem
            try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const saveDir = path.join(process.cwd(), 'transcriptions');
                await fs.mkdir(saveDir, { recursive: true });

                // Parse the JSON body to save it properly
                const bodyText = await backendRes.text();
                const jsonResult = JSON.parse(bodyText);
                log(`local backend responded status=${backendRes.status} duration_ms=${Date.now() - startedAt}`);

                const safeName = (file.name || 'audio_file').replace(/[^a-zA-Z0-9.-]/g, '_');
                const dateString = new Date().toISOString().replace(/[:.]/g, '-');
                const fileName = `${dateString}_${safeName}.json`;
                const filePath = path.join(saveDir, fileName);

                await fs.writeFile(filePath, JSON.stringify(jsonResult, null, 2), 'utf-8');
                log(`saved local result file="${filePath}"`);

                // Return the response as normal
                return NextResponse.json(jsonResult, { status: backendRes.status });
            } catch (err) {
                console.error("Failed to automatically save transcription:", err);
                // Return originally intended response if save fails
                return new NextResponse(backendRes.body, {
                    status: backendRes.status,
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });
            }
        }

        if (!file) {
            return errorResponse('No file provided', 400);
        }

        if (!isValidFileType(file)) {
            return errorResponse(
                `Unsupported file type: ${file.type || 'unknown'}. Please use a supported audio format.`,
                400,
                { supportedTypes: [...SUPPORTED_EXTENSIONS] }
            );
        }

        if (file.size === 0) {
            return errorResponse('File is empty. Please select a valid audio file.', 400);
        }

        if (!isValidTranscriptionProvider(providerName)) {
            return errorResponse(`Invalid provider: ${providerRaw}. Supported providers: groq, openai, openai_diarize, local`, 400);
        }

        const envKey = getProviderApiKeyFromEnv(providerName);
        if (providerName !== 'local' && !apiKeyOverride && !envKey) {
            return errorResponse(
                `No API key configured for ${providerName}. Provide an API key in the UI or set ${providerName === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'} on the server.`,
                400
            );
        }

        const provider = createTranscriptionProvider(providerName, apiKeyOverride);
        const startTime = new Date();
        log(`provider ready name=${provider.name} model=${provider.model}`);

        const sizeRequiresPreparation = needsAudioSplitting(file.size);
        const providerDurationLimit = getProviderSegmentDurationLimit(provider.name);

        if (sizeRequiresPreparation || providerDurationLimit !== null) {
            log(
                `audio preparation path triggered original_size=${formatMiB(file.size)} ` +
                `check_size=${sizeRequiresPreparation} duration_limit_seconds=${providerDurationLimit ?? 'none'}`
            );

            const savedFile = await saveUploadedFile(file);
            tempDir = savedFile.tempDir;

            try {
                const optimized = await optimizeAudioForTranscription(savedFile.path, file.name);
                const preparedPath = optimized.outputPath;
                const preparedName = optimized.outputFileName;
                const preparedMimeType = optimized.outputMimeType || file.type || 'audio/mpeg';
                const preparedDurationSec = providerDurationLimit !== null
                    ? await getAudioDuration(preparedPath)
                    : null;

                const pipelineSummary = optimized.applied
                    ? `Server compressed the upload to ${preparedName} (${(optimized.finalSizeBytes / 1024 / 1024).toFixed(1)} MB) before transcription.`
                    : optimized.attempted
                        ? 'Server checked whether compression would help, then kept the original audio because savings were too small.'
                        : 'Uploaded the original audio directly.';
                log(`optimization result applied=${optimized.applied} reason=${optimized.reason} prepared_name="${preparedName}" prepared_size=${formatMiB(optimized.finalSizeBytes)} savings=${optimized.reductionPercent.toFixed(1)}%`);

                const splitForSize = needsAudioSplitting(optimized.finalSizeBytes);
                const splitForDuration = preparedDurationSec !== null &&
                    needsProviderDurationSplit(provider.name, preparedDurationSec);

                log(
                    `split decision size=${splitForSize} duration=${splitForDuration} ` +
                    `duration_seconds=${preparedDurationSec?.toFixed(1) ?? 'not_checked'}`
                );

                if (!splitForSize && !splitForDuration) {
                    log(`prepared file fits direct upload; sending single request`);
                    const preparedFile = await readSegmentAsFile(preparedPath, preparedMimeType);
                    const result = await provider.transcribe(
                        preparedFile,
                        language || undefined,
                        request.signal
                    );
                    const createdAt = startTime.toISOString();
                    const diarizedText = buildDiarizedText(result.segments, createdAt, provider.name, provider.model);

                    const transcriptionResult: TranscriptionResult = {
                        source_file: {
                            name: file.name,
                            type: file.type,
                            size_bytes: file.size,
                        },
                        provider: provider.name,
                        model: provider.model,
                        language: result.language || null,
                        segments: result.segments,
                        full_text: result.text,
                        ...(diarizedText ? { diarized_text: diarizedText } : {}),
                        preparation: {
                            compressed: optimized.applied,
                            split: false,
                            upload_size_bytes: optimized.finalSizeBytes,
                            upload_file_name: preparedName,
                            upload_mime_type: preparedMimeType,
                            optimization_reason: optimized.reason,
                            reduction_percent: Math.round(optimized.reductionPercent * 100) / 100,
                            ...(preparedDurationSec !== null
                                ? { source_duration_seconds: Math.round(preparedDurationSec * 1000) / 1000 }
                                : {}),
                        },
                        pipelineSummary,
                        created_at: createdAt,
                    };

                    try {
                        await saveResultToDisk(file.name, transcriptionResult);
                        log(`result persisted for single prepared upload`);
                    } catch (err) {
                        warn(`failed to save result automatically: ${err instanceof Error ? err.message : String(err)}`);
                    }

                    await cleanupTempFiles(tempDir);
                    tempDir = null;
                    log(`request complete duration_ms=${Date.now() - startedAt} segments=${transcriptionResult.segments.length}`);
                    return NextResponse.json(transcriptionResult);
                }

                const splitReason = splitForSize && splitForDuration
                    ? 'size_and_duration'
                    : splitForDuration
                        ? 'duration'
                        : 'size';
                log(
                    `prepared file requires splitting reason=${splitReason} ` +
                    `size=${formatMiB(optimized.finalSizeBytes)} duration_seconds=${preparedDurationSec?.toFixed(1) ?? 'not_checked'}`
                );
                const splitResult = await splitAudioFile(
                    preparedPath,
                    preparedName,
                    providerDurationLimit ?? undefined
                );
                splitTempDir = splitResult.tempDir;

                log(`split ready chunks=${splitResult.segments.length}`);

                let detectedLanguage: string | null = null;
                let cumulativeDurationMs = 0;

                const skipIndicesStr = formData.get('skipChunks') as string | null;
                const requestedSkipIndices: number[] = skipIndicesStr ? JSON.parse(skipIndicesStr) : [];

                const previousResultsStr = formData.get('previousResults') as string | null;
                const previousResults: ChunkResult[] = previousResultsStr ? JSON.parse(previousResultsStr) : [];

                // Only skip chunks backed by a valid saved result. Never trust a
                // standalone client-supplied skip index, which could omit audio.
                const resultsByIndex = preparePreviousChunkResults(
                    previousResults,
                    splitResult.segments.length
                );
                const skipIndexSet = new Set(resultsByIndex.keys());
                const ignoredSkipCount = requestedSkipIndices.filter(index => !skipIndexSet.has(index)).length;
                if (ignoredSkipCount > 0) {
                    warn(`ignored ${ignoredSkipCount} resume skip indices without valid previous results`);
                }

                const pendingSegments = splitResult.segments.filter((segment) => {
                    if (skipIndexSet.has(segment.index)) {
                        log(`skipping chunk index=${segment.index} offset_ms=${segment.startOffsetMs} reason=resumed_progress`);
                        return false;
                    }
                    return true;
                });

                // Diarization requests can take several minutes and are billable.
                // Process them sequentially so a transient failure cannot discard
                // or abort another in-flight paid chunk.
                const chunkConcurrency = getChunkConcurrency(
                    provider.name,
                    pendingSegments.length,
                    MAX_PARALLEL_CHUNK_TRANSCRIPTIONS
                );
                let nextSegmentCursor = 0;
                let firstChunkError: ChunkFailure | null = null;

                log(
                    `chunk execution mode=${chunkConcurrency === 1 ? 'sequential' : 'parallel'} concurrency=${chunkConcurrency} ` +
                    `pending=${pendingSegments.length} skipped=${skipIndexSet.size}`
                );

                const workers = Array.from({ length: chunkConcurrency }, (_, workerOffset) => {
                    const workerId = workerOffset + 1;
                    return (async () => {
                        while (true) {
                            if (firstChunkError) {
                                return;
                            }

                            const segment = pendingSegments[nextSegmentCursor++];
                            if (!segment) {
                                return;
                            }

                            const segmentStartOffsetMs = segment.startOffsetMs;
                            const segmentEndOffsetMs = segmentStartOffsetMs + (segment.durationMs || 0);

                            try {
                                log(
                                    `transcribing chunk index=${segment.index + 1}/${splitResult.segments.length} ` +
                                    `worker=${workerId} offset_ms=${segmentStartOffsetMs} duration_ms=${segment.durationMs || 0}`
                                );
                                const segmentFile = await readSegmentAsFile(segment.filePath, preparedMimeType);
                                const result = await provider.transcribe(
                                    segmentFile,
                                    language || undefined,
                                    request.signal
                                );

                                const adjustedSegments = result.segments.map(seg => ({
                                    ...seg,
                                    start_ms: seg.start_ms !== null ? seg.start_ms + segmentStartOffsetMs : null,
                                    end_ms: seg.end_ms !== null ? seg.end_ms + segmentStartOffsetMs : null,
                                }));

                                cumulativeDurationMs = Math.max(cumulativeDurationMs, segmentEndOffsetMs);

                                resultsByIndex.set(segment.index, {
                                    index: segment.index,
                                    text: result.text,
                                    segments: adjustedSegments,
                                    language: result.language,
                                });

                                log(
                                    `chunk complete index=${segment.index + 1}/${splitResult.segments.length} ` +
                                    `worker=${workerId} segments=${adjustedSegments.length} language=${result.language || 'unknown'}`
                                );
                            } catch (chunkError) {
                                const errorMsg = chunkError instanceof Error ? chunkError.message : 'Chunk processing failed';

                                if (!firstChunkError) {
                                    firstChunkError = {
                                        message: errorMsg,
                                        chunkIndex: segment.index,
                                    };
                                    warn(
                                        `chunk failed index=${segment.index + 1}/${splitResult.segments.length} ` +
                                        `worker=${workerId} message="${errorMsg}"`
                                    );
                                }

                                return;
                            }
                        }
                    })();
                });

                await Promise.all(workers);

                const results = sortChunkResults(Array.from(resultsByIndex.values()));
                detectedLanguage = results.find((result) => typeof result.language === 'string' && result.language.length > 0)?.language || null;
                cumulativeDurationMs = calculateContiguousCompletedDurationMs(
                    splitResult.segments,
                    resultsByIndex
                );

                const chunkErrorState = firstChunkError as ChunkFailure | null;
                if (chunkErrorState) {
                    const partialResult = createPartialTranscriptionResult(
                        resultsByIndex,
                        splitResult.segments.length,
                        chunkErrorState.chunkIndex,
                        cumulativeDurationMs,
                        detectedLanguage
                    );
                    const completedChunks = partialResult.completedChunks;

                    if (isRateLimitMessage(chunkErrorState.message)) {
                        const rateLimit = parseRateLimitError(chunkErrorState.message);
                        const retryMsg = rateLimit
                            ? `Rate limit exceeded at chunk ${chunkErrorState.chunkIndex + 1}/${splitResult.segments.length}. Completed ${completedChunks.length} chunks. Try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minute(s).`
                            : `Rate limit exceeded at chunk ${chunkErrorState.chunkIndex + 1}. Completed ${completedChunks.length} chunks.`;

                        await cleanupTempFiles(splitResult.tempDir);
                        splitTempDir = null;
                        if (tempDir) {
                            await cleanupTempFiles(tempDir);
                            tempDir = null;
                        }

                        return errorResponse(retryMsg, 429, {
                            rateLimit: rateLimit || undefined,
                            partialResult,
                            code: 'provider_rate_limit',
                            retryable: true,
                        });
                    }

                    const isNetworkFailure = isNetworkFailureMessage(chunkErrorState.message);
                    const completedMessage = completedChunks.length > 0
                        ? ` Completed ${completedChunks.length}/${splitResult.segments.length} chunks were preserved; use Resume to process only the remaining chunks.`
                        : '';
                    const failureMessage = isNetworkFailure
                        ? `The provider connection failed at chunk ${chunkErrorState.chunkIndex + 1}/${splitResult.segments.length}.${completedMessage} ` +
                            'Resuming may submit the failed chunk again and could incur a duplicate charge if OpenAI completed it before the connection was lost. ' +
                            chunkErrorState.message
                        : `Chunk ${chunkErrorState.chunkIndex + 1}/${splitResult.segments.length} failed.${completedMessage} ${chunkErrorState.message}`;

                    await cleanupTempFiles(splitResult.tempDir);
                    splitTempDir = null;
                    if (tempDir) {
                        await cleanupTempFiles(tempDir);
                        tempDir = null;
                    }

                    return errorResponse(failureMessage, isNetworkFailure ? 502 : 500, {
                        ...(completedChunks.length > 0 ? { partialResult } : {}),
                        code: isNetworkFailure ? 'provider_network_error' : 'chunk_failed',
                        retryable: true,
                    });
                }

                await cleanupTempFiles(splitResult.tempDir);
                splitTempDir = null;
                await cleanupTempFiles(tempDir);
                tempDir = null;

                const fullText = reassembleFullText(results);
                const segments = reassembleTranscriptSegments(results) as TranscriptSegment[];
                const createdAt = startTime.toISOString();
                const diarizedText = buildDiarizedText(segments, createdAt, provider.name, provider.model);

                const transcriptionResult: TranscriptionResult = {
                    source_file: {
                        name: file.name,
                        type: file.type,
                        size_bytes: file.size,
                    },
                    provider: provider.name,
                    model: provider.model,
                    language: detectedLanguage,
                    segments,
                    full_text: fullText,
                    ...(diarizedText ? { diarized_text: diarizedText } : {}),
                    preparation: {
                        compressed: optimized.applied,
                        split: true,
                        upload_size_bytes: optimized.finalSizeBytes,
                        upload_file_name: preparedName,
                        upload_mime_type: preparedMimeType,
                        optimization_reason: optimized.reason,
                        reduction_percent: Math.round(optimized.reductionPercent * 100) / 100,
                        ...(preparedDurationSec !== null
                            ? { source_duration_seconds: Math.round(preparedDurationSec * 1000) / 1000 }
                            : {}),
                        split_reason: splitReason,
                    },
                    pipelineSummary: splitForDuration
                        ? `${pipelineSummary.replace(/\.$/, '')} The server split it into ${splitResult.segments.length} chunks to stay within the diarization model's per-request duration limit.`
                        : `${pipelineSummary.replace(/\.$/, '')} It was still too large, so the server split it into ${splitResult.segments.length} chunks.`,
                    created_at: createdAt,
                };

                // Save the result for non-local split providers too
                try {
                    await saveResultToDisk(file.name, transcriptionResult);
                    log(`result persisted for chunked upload`);
                } catch (err) {
                    warn(`failed to save result automatically: ${err instanceof Error ? err.message : String(err)}`);
                }

                log(`request complete duration_ms=${Date.now() - startedAt} chunks=${splitResult.segments.length} segments=${transcriptionResult.segments.length}`);
                return NextResponse.json(transcriptionResult);
            } catch (ffmpegError) {
                if (splitTempDir) {
                    await cleanupTempFiles(splitTempDir);
                    splitTempDir = null;
                }
                if (tempDir) {
                    await cleanupTempFiles(tempDir);
                    tempDir = null;
                }

                const message = ffmpegError instanceof Error ? ffmpegError.message : 'Failed to process audio file';
                warn(`audio preparation path failed message="${message}"`);

                if (message.includes('ffmpeg not found') || message.includes('ENOENT')) {
                    return errorResponse(
                        'ffmpeg is required for optimizing/splitting large files. Please install ffmpeg on the server.',
                        500
                    );
                }

                throw ffmpegError;
            }
        }

        const result = await provider.transcribe(file, language || undefined, request.signal);
        const createdAt = startTime.toISOString();
        const diarizedText = buildDiarizedText(result.segments, createdAt, provider.name, provider.model);
        log(`direct upload complete segments=${result.segments.length} language=${result.language || 'unknown'}`);

        const transcriptionResult: TranscriptionResult = {
            source_file: {
                name: file.name,
                type: file.type,
                size_bytes: file.size,
            },
            provider: provider.name,
            model: provider.model,
            language: result.language || null,
            segments: result.segments,
            full_text: result.text,
            ...(diarizedText ? { diarized_text: diarizedText } : {}),
            pipelineSummary: 'Uploaded the original audio directly.',
            created_at: createdAt,
        };

        // Save the result for non-local providers too
        try {
            await saveResultToDisk(file.name, transcriptionResult);
            log(`result persisted for direct upload`);
        } catch (err) {
            warn(`failed to save result automatically: ${err instanceof Error ? err.message : String(err)}`);
        }

        log(`request complete duration_ms=${Date.now() - startedAt} segments=${transcriptionResult.segments.length}`);
        return NextResponse.json(transcriptionResult);
    } catch (error) {
        if (splitTempDir) {
            await cleanupTempFiles(splitTempDir);
        }
        if (tempDir) {
            await cleanupTempFiles(tempDir);
        }

        console.error(`[transcribe:${requestId}] unhandled error:`, error);

        const message = error instanceof Error ? error.message : 'Transcription failed';

        if (message.includes('cancelled')) {
            return errorResponse('Transcription was cancelled', 499);
        }

        if (message.includes('rate limit') || message.includes('Rate limit') || message.includes('429')) {
            const rateLimit = parseRateLimitError(message);
            const retryMsg = rateLimit
                ? `Rate limit exceeded. Used ${rateLimit.used}/${rateLimit.limit} seconds (${rateLimit.percentUsed}%). Try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minute(s).`
                : 'Rate limit exceeded. Please try again in a few moments.';
            return errorResponse(retryMsg, 429, { rateLimit: rateLimit || undefined });
        }

        return errorResponse(message, 500);
    }
}

/**
 * GET /api/transcribe
 */
export async function GET(): Promise<NextResponse> {
    const providers = getAllTranscriptionProviders();
    const configuredProviders = providers.filter(p => p.configured);
    // Prefer cloud providers as default; only fall back to local if nothing else is configured
    const defaultProvider: TranscriptionProviderName =
        configuredProviders.find(p => p.name !== 'local')?.name || 'groq';

    return NextResponse.json({
        name: 'Whisper Transcription API',
        version: '3.0.0',
        providers,
        defaultProvider,
        hfTokenConfigured: Boolean(process.env.HF_TOKEN),
        supportedFormats: [...SUPPORTED_EXTENSIONS],
        maxFileSize: 'Unlimited (auto-split with ffmpeg)',
        note: 'Oversized cloud uploads are compressed to smaller AAC audio first. OpenAI diarization uploads are also split when their duration exceeds the model-safe request limit.',
    });
}
