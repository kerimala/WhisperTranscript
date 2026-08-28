/**
 * Streaming multipart helpers for large media uploads.
 *
 * Route handlers' `request.formData()` creates an in-memory `File`. That is
 * fine for a small attachment but unsafe for multi-gigabyte video: the whole
 * original file is buffered before ffmpeg gets a chance to extract audio.
 * These helpers parse the request incrementally and write the source to a
 * private temporary directory instead.
 */

import Busboy from 'busboy';
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import os from 'os';
import path from 'path';

const DEFAULT_MAX_SOURCE_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB
const MAX_MULTIPART_FIELDS = 24;
const MAX_MULTIPART_FIELD_BYTES = 2 * 1024 * 1024; // resume state can be sizeable
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const VERCEL_FUNCTION_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

export type MultipartUploadErrorCode =
    | 'invalid_multipart_request'
    | 'source_upload_too_large'
    | 'missing_upload_file'
    | 'unexpected_upload_file'
    | 'upload_cancelled'
    | 'upload_stream_failed';

export class MultipartUploadError extends Error {
    readonly code: MultipartUploadErrorCode;
    readonly status: number;

    constructor(code: MultipartUploadErrorCode, message: string, status: number) {
        super(message);
        this.name = 'MultipartUploadError';
        this.code = code;
        this.status = status;
    }
}

export interface StreamedUploadFile {
    name: string;
    type: string;
    size: number;
    path: string;
}

export interface StreamedMultipartUpload {
    file: StreamedUploadFile;
    fields: Map<string, string>;
    tempDir: string;
}

export interface ReceiveMultipartUploadOptions {
    maxSourceUploadBytes?: number;
    tempRoot?: string;
}

/**
 * Get the self-hosted input cap. The default is deliberately finite so an
 * accidental upload cannot exhaust a machine's disk. Use an integer byte
 * value in MAX_SOURCE_UPLOAD_BYTES to tune it for a known deployment.
 */
export function getMaxSourceUploadBytes(): number {
    const configured = process.env.MAX_SOURCE_UPLOAD_BYTES?.trim();
    if (!configured) {
        return DEFAULT_MAX_SOURCE_UPLOAD_BYTES;
    }

    const parsed = Number(configured);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
        return parsed;
    }

    console.warn(
        `[upload] ignoring invalid MAX_SOURCE_UPLOAD_BYTES=${JSON.stringify(configured)}; ` +
        `using ${DEFAULT_MAX_SOURCE_UPLOAD_BYTES}`
    );
    return DEFAULT_MAX_SOURCE_UPLOAD_BYTES;
}

/**
 * Return the browser-to-app limit when the host is known to reject a request
 * before this route executes. A self-hosted reverse proxy can expose its
 * matching limit with MAX_BROWSER_UPLOAD_BYTES. Vercel Functions have an
 * unconfigurable 4.5 MB request-body limit, so the UI can stop a doomed upload
 * before the browser sends a multi-gigabyte file.
 */
export function getBrowserUploadLimitBytes(): number | null {
    const configured = process.env.MAX_BROWSER_UPLOAD_BYTES?.trim();
    if (configured) {
        const parsed = Number(configured);
        if (Number.isSafeInteger(parsed) && parsed > 0) {
            return parsed;
        }
        console.warn(`[upload] ignoring invalid MAX_BROWSER_UPLOAD_BYTES=${JSON.stringify(configured)}`);
    }

    return process.env.VERCEL === '1' ? VERCEL_FUNCTION_BODY_LIMIT_BYTES : null;
}

/**
 * Stream the browser's one audio/video field to disk while retaining ordinary
 * small form fields. The caller owns cleanup after a successful return.
 */
export async function receiveMultipartUpload(
    request: Request,
    options: ReceiveMultipartUploadOptions = {}
): Promise<StreamedMultipartUpload> {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        throw new MultipartUploadError(
            'invalid_multipart_request',
            'Expected a multipart/form-data upload.',
            415
        );
    }

    if (!request.body) {
        throw new MultipartUploadError(
            'missing_upload_file',
            'No file provided.',
            400
        );
    }

    const maxSourceUploadBytes = options.maxSourceUploadBytes ?? getMaxSourceUploadBytes();
    const declaredLength = parseContentLength(request.headers.get('content-length'));
    if (declaredLength !== null && declaredLength > maxSourceUploadBytes + MAX_MULTIPART_OVERHEAD_BYTES) {
        throw sourceTooLargeError(maxSourceUploadBytes);
    }

    const tempRoot = options.tempRoot || os.tmpdir();
    const tempDir = await fs.mkdtemp(path.join(tempRoot, 'whisper-upload-'));
    const fields = new Map<string, string>();
    const fileWrites: Promise<void>[] = [];
    let uploadedFile: StreamedUploadFile | null = null;
    let uploadError: MultipartUploadError | null = null;

    const setUploadError = (error: MultipartUploadError): void => {
        if (!uploadError) {
            uploadError = error;
        }
    };

    const parser = Busboy({
        headers: { 'content-type': contentType },
        preservePath: false,
        limits: {
            files: 1,
            fields: MAX_MULTIPART_FIELDS,
            parts: MAX_MULTIPART_FIELDS + 1,
            fieldSize: MAX_MULTIPART_FIELD_BYTES,
            fileSize: maxSourceUploadBytes,
        },
    });

    parser.on('field', (name, value, info) => {
        if (info.nameTruncated || info.valueTruncated) {
            const error = new MultipartUploadError(
                'invalid_multipart_request',
                'An upload form field exceeded the supported size.',
                413
            );
            setUploadError(error);
            parser.destroy(error);
            return;
        }
        fields.set(name, value);
    });

    parser.on('file', (fieldName, input, info) => {
        if (fieldName !== 'file' || uploadedFile) {
            input.resume();
            const error = new MultipartUploadError(
                'unexpected_upload_file',
                'Upload exactly one media file using the "file" field.',
                400
            );
            setUploadError(error);
            parser.destroy(error);
            return;
        }

        const safeName = sanitizeFileName(info.filename);
        const destinationPath = path.join(/* turbopackIgnore: true */ tempDir, safeName);
        let bytesWritten = 0;

        input.on('limit', () => {
            const error = sourceTooLargeError(maxSourceUploadBytes);
            setUploadError(error);
            parser.destroy(error);
        });

        uploadedFile = {
            name: safeName,
            type: info.mimeType || 'application/octet-stream',
            size: 0,
            path: destinationPath,
        };

        const byteCounter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                bytesWritten += chunk.length;
                callback(null, chunk);
            },
        });
        const output = createWriteStream(destinationPath, { flags: 'wx' });
        fileWrites.push(
            pipeline(input, byteCounter, output).then(() => {
                if (!uploadedFile || uploadedFile.path !== destinationPath) {
                    return;
                }
                uploadedFile.size = bytesWritten;
            })
        );
    });

    parser.on('filesLimit', () => {
        const error = new MultipartUploadError(
            'unexpected_upload_file',
            'Upload exactly one media file.',
            400
        );
        setUploadError(error);
        parser.destroy(error);
    });
    parser.on('fieldsLimit', () => {
        const error = new MultipartUploadError(
            'invalid_multipart_request',
            'The upload contains too many form fields.',
            400
        );
        setUploadError(error);
        parser.destroy(error);
    });
    parser.on('partsLimit', () => {
        const error = new MultipartUploadError(
            'invalid_multipart_request',
            'The upload contains too many parts.',
            400
        );
        setUploadError(error);
        parser.destroy(error);
    });

    const source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
    const abortUpload = (): void => {
        source.destroy(new MultipartUploadError(
            'upload_cancelled',
            'Upload cancelled.',
            499
        ));
    };
    request.signal.addEventListener('abort', abortUpload, { once: true });

    try {
        await pipeline(source, parser);
        await Promise.all(fileWrites);

        if (uploadError) {
            throw uploadError;
        }
        // The assignment happens in Busboy's event callback, which TypeScript's
        // control-flow analysis cannot observe across `await pipeline(...)`.
        const completeFile = uploadedFile as StreamedUploadFile | null;
        if (!completeFile) {
            throw new MultipartUploadError(
                'missing_upload_file',
                'No file provided.',
                400
            );
        }
        if (completeFile.size === 0) {
            throw new MultipartUploadError(
                'missing_upload_file',
                'File is empty. Please select a valid audio file.',
                400
            );
        }

        return { file: completeFile, fields, tempDir };
    } catch (error) {
        await Promise.allSettled(fileWrites);
        await fs.rm(tempDir, { recursive: true, force: true });

        // Like the uploaded file itself, this value is written by a stream
        // callback that TypeScript cannot see across the awaited pipeline.
        const recordedUploadError = uploadError as MultipartUploadError | null;
        if (recordedUploadError) {
            throw recordedUploadError;
        }
        if (error instanceof MultipartUploadError) {
            throw error;
        }
        if (request.signal.aborted) {
            throw new MultipartUploadError('upload_cancelled', 'Upload cancelled.', 499);
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new MultipartUploadError(
            'upload_stream_failed',
            `Could not receive the uploaded file: ${message}`,
            400
        );
    } finally {
        request.signal.removeEventListener('abort', abortUpload);
    }
}

/**
 * Forward a staged file to the local Python backend without recreating a
 * multi-gigabyte browser `File` in Node memory.
 */
export function createStreamingMultipartBody(
    file: StreamedUploadFile,
    fields: Record<string, string>
): { body: ReadableStream<Uint8Array>; contentType: string } {
    const boundary = `----WhisperForFiles${randomUUID().replace(/-/g, '')}`;
    const header = (name: string, value: string): Buffer => Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"\r\n\r\n` +
        `${value}\r\n`,
        'utf-8'
    );
    const fileHeader = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${escapeHeaderValue(file.name)}"\r\n` +
        `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
        'utf-8'
    );

    async function* parts(): AsyncGenerator<Buffer> {
        for (const [name, value] of Object.entries(fields)) {
            yield header(name, value);
        }
        yield fileHeader;
        for await (const chunk of createReadStream(file.path)) {
            yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        }
        yield Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    }

    return {
        body: Readable.toWeb(Readable.from(parts())) as ReadableStream<Uint8Array>,
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

function parseContentLength(value: string | null): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sanitizeFileName(fileName: string): string {
    const baseName = path.basename(fileName || 'audio');
    const cleaned = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, 'audio');
    return cleaned || 'audio';
}

function escapeHeaderValue(value: string): string {
    return value.replace(/[\r\n"]/g, '_');
}

function sourceTooLargeError(maxBytes: number): MultipartUploadError {
    const gib = maxBytes / 1024 / 1024 / 1024;
    const formatted = gib >= 1
        ? `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`
        : `${(maxBytes / 1024 / 1024).toFixed(0)} MB`;
    return new MultipartUploadError(
        'source_upload_too_large',
        `Source upload is too large for this server (maximum ${formatted}). ` +
        'Use a self-hosted server with a larger MAX_SOURCE_UPLOAD_BYTES setting or reduce the media first.',
        413
    );
}
