/**
 * Audio file chunking utilities for handling large files
 * 
 * Per Groq docs: Files > 25 MB (free) / 100 MB (dev) need to be chunked.
 * We use 24 MB chunks to stay safely under the 25 MB limit.
 */

import { AudioChunk, MAX_CHUNK_SIZE } from './types';

/**
 * Check if a file needs to be split into chunks
 */
export function needsChunking(fileSize: number, maxSize: number = MAX_CHUNK_SIZE): boolean {
    return fileSize > maxSize;
}

/**
 * Calculate the number of chunks needed for a file
 */
export function calculateChunkCount(fileSize: number, chunkSize: number = MAX_CHUNK_SIZE): number {
    if (fileSize <= chunkSize) return 1;
    return Math.ceil(fileSize / chunkSize);
}

/**
 * Split a file into chunks of specified maximum size.
 * 
 * Note: This performs simple byte-level splitting. For audio files,
 * this may result in chunks that cut mid-audio-frame. However, Groq's
 * whisper model handles this gracefully by processing what it can.
 * 
 * For production use with very long files, consider using ffmpeg to
 * split at silent points or proper audio boundaries.
 */
export function splitFileIntoChunks(
    file: File | Blob,
    chunkSize: number = MAX_CHUNK_SIZE
): AudioChunk[] {
    const chunks: AudioChunk[] = [];
    const totalSize = file.size;

    if (totalSize <= chunkSize) {
        // No splitting needed
        chunks.push({
            index: 0,
            data: file instanceof Blob ? file : new Blob([file]),
            startByte: 0,
            endByte: totalSize,
        });
        return chunks;
    }

    let offset = 0;
    let index = 0;

    while (offset < totalSize) {
        const end = Math.min(offset + chunkSize, totalSize);
        const chunkBlob = file.slice(offset, end);

        chunks.push({
            index,
            data: chunkBlob,
            startByte: offset,
            endByte: end,
        });

        offset = end;
        index++;
    }

    return chunks;
}

/**
 * Create a File object from a chunk with proper naming
 */
export function createChunkFile(
    chunk: AudioChunk,
    originalFileName: string,
    mimeType: string
): File {
    const ext = originalFileName.substring(originalFileName.lastIndexOf('.'));
    const baseName = originalFileName.substring(0, originalFileName.lastIndexOf('.'));
    const chunkFileName = `${baseName}_chunk_${chunk.index}${ext}`;

    return new File([chunk.data], chunkFileName, { type: mimeType });
}

/**
 * Reassemble transcript segments from multiple chunks.
 * Adjusts segment indices to be sequential across all chunks.
 */
export function reassembleTranscriptSegments(
    chunkResults: Array<{ index: number; segments: Array<{ index: number; start_ms: number | null; end_ms: number | null; text: string; speaker?: string }> }>
): Array<{ index: number; start_ms: number | null; end_ms: number | null; text: string; speaker?: string }> {
    // Sort by chunk index to ensure correct order
    const sorted = [...chunkResults].sort((a, b) => a.index - b.index);

    const allSegments: Array<{ index: number; start_ms: number | null; end_ms: number | null; text: string; speaker?: string }> = [];
    let segmentIndex = 0;

    for (const chunk of sorted) {
        for (const segment of chunk.segments) {
            allSegments.push({
                ...segment,
                index: segmentIndex++,
                // Note: Timestamps within chunks are relative to chunk start.
                // For accurate global timestamps, you'd need to track cumulative duration.
                // We keep them as-is since byte-level splitting doesn't preserve audio timing.
            });
        }
    }

    return allSegments;
}

/**
 * Combine full text from multiple chunk results
 */
export function reassembleFullText(
    chunkResults: Array<{ index: number; text: string }>
): string {
    return [...chunkResults]
        .sort((a, b) => a.index - b.index)
        .map(chunk => chunk.text.trim())
        .join(' ');
}
