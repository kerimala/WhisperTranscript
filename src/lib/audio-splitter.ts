/**
 * Audio splitting utilities using ffmpeg
 * 
 * Splits large audio files into smaller segments for processing.
 * Uses proper audio boundaries to avoid cutting mid-word.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

// Default segment duration in seconds (5 minutes)
const DEFAULT_SEGMENT_DURATION = 300;
const MIN_SEGMENT_DURATION = 120; // 2 minutes
const MAX_SEGMENT_DURATION = 3600; // 60 minutes

// Max file size before requiring splitting (24 MB to be safe)
const MAX_FILE_SIZE = 24 * 1024 * 1024;
const TARGET_SEGMENT_SIZE_RATIO = 0.9;

export interface AudioSegment {
    index: number;
    filePath: string;
    durationMs?: number;
    startOffsetMs: number;
}

export interface SplitResult {
    segments: AudioSegment[];
    tempDir: string;
    needsSplitting: boolean;
}

export interface AudioOptimizationResult {
    attempted: boolean;
    applied: boolean;
    originalSizeBytes: number;
    optimizedSizeBytes: number;
    finalSizeBytes: number;
    reductionBytes: number;
    reductionPercent: number;
    targetBitrateKbps: number;
    targetSampleRateHz: number;
    targetChannels: number;
    reason: string;
    outputPath: string;
    outputFileName: string;
    outputMimeType: string;
}

const OPTIMIZED_EXT = '.m4a';
const OPTIMIZED_MIME = 'audio/mp4';
const OPTIMIZED_BITRATE_KBPS = 48;
const OPTIMIZED_SAMPLE_RATE_HZ = 16000;
const OPTIMIZED_CHANNELS = 1;
const MIN_OPTIMIZATION_SAVINGS_BYTES = 512 * 1024; // 0.5 MB
const MIN_OPTIMIZATION_SAVINGS_RATIO = 0.08; // 8%

function formatMiB(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Check if a file needs to be split based on size
 */
export function needsAudioSplitting(fileSize: number): boolean {
    return fileSize > MAX_FILE_SIZE;
}

/**
 * Get the duration of an audio file using ffprobe
 */
export async function getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath
        ]);

        let output = '';
        let errorOutput = '';

        ffprobe.stdout.on('data', (data) => {
            output += data.toString();
        });

        ffprobe.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        ffprobe.on('close', (code) => {
            if (code === 0) {
                const duration = parseFloat(output.trim());
                if (!isNaN(duration)) {
                    resolve(duration);
                } else {
                    reject(new Error('Could not parse audio duration'));
                }
            } else {
                reject(new Error(`ffprobe failed: ${errorOutput}`));
            }
        });

        ffprobe.on('error', (err) => {
            reject(new Error(`ffprobe not found. Please install ffmpeg: ${err.message}`));
        });
    });
}

/**
 * Split an audio file into segments using ffmpeg
 * 
 * Uses segment muxer for efficient splitting at keyframes.
 * Output format is the same as input to avoid transcoding when possible.
 */
export async function splitAudioFile(
    inputPath: string,
    originalName: string,
    maxSegmentDurationSec: number = MAX_SEGMENT_DURATION
): Promise<SplitResult> {
    // Create temp directory for segments
    const tempDir = path.join(os.tmpdir(), `whisper-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const inputStats = await fs.stat(inputPath);
    const sourceDurationSec = await getAudioDuration(inputPath).catch(() => DEFAULT_SEGMENT_DURATION);
    const segmentDurationSec = getAdaptiveSegmentDuration(
        inputStats.size,
        sourceDurationSec,
        maxSegmentDurationSec
    );
    console.log(
        `[audio] split start file="${originalName}" size=${formatMiB(inputStats.size)} ` +
        `duration=${sourceDurationSec.toFixed(1)}s segment_target=${segmentDurationSec}s`
    );

    // Determine output extension (keep original or default to mp3)
    const ext = path.extname(originalName).toLowerCase() || '.mp3';
    const outputPattern = path.join(tempDir, `segment_%03d${ext}`);

    return new Promise((resolve, reject) => {
        // Use ffmpeg segment muxer for efficient splitting
        const ffmpeg = spawn('ffmpeg', [
            '-i', inputPath,
            '-f', 'segment',
            '-segment_time', segmentDurationSec.toString(),
            '-c', 'copy', // Copy codec, no re-encoding for speed
            '-reset_timestamps', '1',
            '-map', '0:a', // Only audio stream
            '-y', // Overwrite output files
            outputPattern
        ]);

        let errorOutput = '';

        ffmpeg.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        ffmpeg.on('close', async (code) => {
            if (code === 0) {
                try {
                    // Find all created segment files
                    const files = await fs.readdir(tempDir);
                    const segmentFiles = files
                        .filter(f => f.startsWith('segment_'))
                        .sort();

                    if (segmentFiles.length === 0) {
                        throw new Error('ffmpeg completed without producing audio segments');
                    }

                    const segments: AudioSegment[] = [];
                    let cumulativeOffsetMs = 0;

                    for (const [index, file] of segmentFiles.entries()) {
                        const filePath = path.join(tempDir, file);
                        const durationSec = await getAudioDuration(filePath).catch(() => segmentDurationSec);
                        const durationMs = Math.max(0, Math.round(durationSec * 1000));

                        segments.push({
                            index,
                            filePath,
                            durationMs,
                            startOffsetMs: cumulativeOffsetMs,
                        });

                        cumulativeOffsetMs += durationMs;
                    }

                    resolve({
                        segments,
                        tempDir,
                        needsSplitting: true,
                    });
                    console.log(
                        `[audio] split done file="${originalName}" segments=${segments.length} temp_dir="${tempDir}"`
                    );
                } catch (err) {
                    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
                    reject(new Error(`Failed to read segments: ${err}`));
                }
            } else {
                await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
                reject(new Error(`ffmpeg splitting failed: ${errorOutput}`));
            }
        });

        ffmpeg.on('error', async (err) => {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
            reject(new Error(`ffmpeg not found. Please install ffmpeg: ${err.message}`));
        });
    });
}

/**
 * Transcode oversized audio into a smaller speech-oriented format.
 *
 * Target:
 * - AAC LC in M4A container
 * - mono
 * - 16 kHz sample rate
 * - 48 kbps bitrate
 *
 * The optimized output is only used when savings are meaningful; otherwise
 * the original file is kept to avoid unnecessary quality loss.
 */
export async function optimizeAudioForTranscription(
    inputPath: string,
    originalName: string
): Promise<AudioOptimizationResult> {
    const inputStats = await fs.stat(inputPath);
    const originalSizeBytes = inputStats.size;
    console.log(`[audio] optimize check file="${originalName}" size=${formatMiB(originalSizeBytes)}`);

    const defaultResult: AudioOptimizationResult = {
        attempted: false,
        applied: false,
        originalSizeBytes,
        optimizedSizeBytes: originalSizeBytes,
        finalSizeBytes: originalSizeBytes,
        reductionBytes: 0,
        reductionPercent: 0,
        targetBitrateKbps: OPTIMIZED_BITRATE_KBPS,
        targetSampleRateHz: OPTIMIZED_SAMPLE_RATE_HZ,
        targetChannels: OPTIMIZED_CHANNELS,
        reason: 'not_needed',
        outputPath: inputPath,
        outputFileName: originalName,
        outputMimeType: inferMimeFromExtension(path.extname(originalName).toLowerCase()) || 'audio/mpeg',
    };

    if (!needsAudioSplitting(originalSizeBytes)) {
        console.log(`[audio] optimize skip file="${originalName}" reason=not_needed`);
        return defaultResult;
    }

    const sourceDir = path.dirname(inputPath);
    const sourceBase = path.basename(originalName, path.extname(originalName)) || 'audio';
    const optimizedFileName = `${sourceBase}_optimized${OPTIMIZED_EXT}`;
    const optimizedPath = path.join(sourceDir, optimizedFileName);

    try {
        console.log(
            `[audio] optimize start file="${originalName}" codec=aac container=m4a ` +
            `bitrate=${OPTIMIZED_BITRATE_KBPS}k sample_rate=${OPTIMIZED_SAMPLE_RATE_HZ} channels=${OPTIMIZED_CHANNELS}`
        );
        await transcodeSpeechOptimized(inputPath, optimizedPath);
        const optimizedStats = await fs.stat(optimizedPath);
        const optimizedSizeBytes = optimizedStats.size;
        const reductionBytes = Math.max(0, originalSizeBytes - optimizedSizeBytes);
        const reductionPercent = originalSizeBytes > 0 ? (reductionBytes / originalSizeBytes) * 100 : 0;
        const isMeaningfulReduction =
            reductionBytes >= MIN_OPTIMIZATION_SAVINGS_BYTES ||
            reductionPercent >= MIN_OPTIMIZATION_SAVINGS_RATIO * 100;

        if (!isMeaningfulReduction) {
            await fs.rm(optimizedPath, { force: true });
            console.log(
                `[audio] optimize discard file="${originalName}" optimized_size=${formatMiB(optimizedSizeBytes)} ` +
                `reason=insufficient_savings savings=${reductionPercent.toFixed(1)}%`
            );
            return {
                ...defaultResult,
                attempted: true,
                reason: 'insufficient_savings',
            };
        }

        console.log(
            `[audio] optimize done file="${originalName}" output="${optimizedFileName}" ` +
            `original=${formatMiB(originalSizeBytes)} optimized=${formatMiB(optimizedSizeBytes)} savings=${reductionPercent.toFixed(1)}%`
        );
        return {
            attempted: true,
            applied: true,
            originalSizeBytes,
            optimizedSizeBytes,
            finalSizeBytes: optimizedSizeBytes,
            reductionBytes,
            reductionPercent,
            targetBitrateKbps: OPTIMIZED_BITRATE_KBPS,
            targetSampleRateHz: OPTIMIZED_SAMPLE_RATE_HZ,
            targetChannels: OPTIMIZED_CHANNELS,
            reason: 'optimized',
            outputPath: optimizedPath,
            outputFileName: optimizedFileName,
            outputMimeType: OPTIMIZED_MIME,
        };
    } catch (error) {
        await fs.rm(optimizedPath, { force: true }).catch(() => undefined);
        console.warn(
            `[audio] optimize failed file="${originalName}" reason="${error instanceof Error ? error.message : String(error)}"`
        );
        return {
            ...defaultResult,
            attempted: true,
            reason: `optimization_failed:${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Estimate segment duration from bitrate so each segment stays well under API limits.
 * This reduces request count for long, low-bitrate files.
 */
export function getAdaptiveSegmentDuration(
    fileSizeBytes: number,
    durationSec: number,
    maxSegmentDurationSec: number = MAX_SEGMENT_DURATION
): number {
    const effectiveMaxDuration = Math.max(
        MIN_SEGMENT_DURATION,
        Math.min(MAX_SEGMENT_DURATION, maxSegmentDurationSec)
    );

    if (!durationSec || durationSec <= 0) {
        return Math.min(DEFAULT_SEGMENT_DURATION, effectiveMaxDuration);
    }

    const bytesPerSecond = fileSizeBytes / durationSec;
    if (!isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
        return Math.min(DEFAULT_SEGMENT_DURATION, effectiveMaxDuration);
    }

    // Keep chunks close to the direct upload cap while leaving room for container overhead.
    const targetChunkSizeBytes = MAX_FILE_SIZE * TARGET_SEGMENT_SIZE_RATIO;
    const estimated = Math.floor(targetChunkSizeBytes / bytesPerSecond);

    if (!isFinite(estimated) || estimated <= 0) {
        return Math.min(DEFAULT_SEGMENT_DURATION, effectiveMaxDuration);
    }

    return Math.max(MIN_SEGMENT_DURATION, Math.min(effectiveMaxDuration, estimated));
}

/**
 * Save uploaded file to temp directory
 */
export async function saveUploadedFile(file: File): Promise<{ path: string; tempDir: string }> {
    const tempDir = path.join(os.tmpdir(), `whisper-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const filePath = path.join(tempDir, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);
    console.log(`[audio] saved upload file="${file.name}" size=${formatMiB(file.size)} temp_dir="${tempDir}"`);

    return { path: filePath, tempDir };
}

/**
 * Clean up temporary files and directories
 */
export async function cleanupTempFiles(tempDir: string): Promise<void> {
    try {
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log(`[audio] cleanup temp_dir="${tempDir}"`);
    } catch (err) {
        console.warn(`Failed to cleanup temp dir ${tempDir}:`, err);
    }
}

/**
 * Read a segment file as a File object for API upload
 */
export async function readSegmentAsFile(
    segmentPath: string,
    originalMimeType: string
): Promise<File> {
    const buffer = await fs.readFile(segmentPath);
    const fileName = path.basename(segmentPath);
    return new File([buffer], fileName, { type: originalMimeType });
}

function inferMimeFromExtension(ext: string): string | null {
    switch (ext) {
        case '.mp3':
            return 'audio/mpeg';
        case '.m4a':
        case '.mp4':
            return 'audio/mp4';
        case '.wav':
            return 'audio/wav';
        case '.ogg':
            return 'audio/ogg';
        case '.flac':
            return 'audio/flac';
        case '.webm':
            return 'audio/webm';
        default:
            return null;
    }
}

function transcodeSpeechOptimized(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', inputPath,
            '-map', '0:a:0',
            '-vn',
            '-sn',
            '-dn',
            '-ac', String(OPTIMIZED_CHANNELS),
            '-ar', String(OPTIMIZED_SAMPLE_RATE_HZ),
            '-c:a', 'aac',
            '-b:a', `${OPTIMIZED_BITRATE_KBPS}k`,
            '-movflags', '+faststart',
            '-y',
            outputPath,
        ]);

        let errorOutput = '';
        ffmpeg.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`ffmpeg optimize failed: ${errorOutput}`));
        });

        ffmpeg.on('error', (err) => {
            reject(new Error(`ffmpeg not found. Please install ffmpeg: ${err.message}`));
        });
    });
}
