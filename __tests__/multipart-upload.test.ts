/** @jest-environment node */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
    MultipartUploadError,
    receiveMultipartUpload,
} from '../src/lib/multipart-upload';

describe('streaming multipart uploads', () => {
    let tempRoot: string;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-upload-test-'));
    });

    afterEach(async () => {
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('streams a media file to disk and retains ordinary form fields', async () => {
        const form = new FormData();
        form.append('file', new File(['small audio payload'], 'meeting.mp4', { type: 'video/mp4' }));
        form.append('provider', 'groq');
        form.append('language', 'de');

        const request = new Request('http://localhost/api/transcribe', {
            method: 'POST',
            body: form,
        });
        const upload = await receiveMultipartUpload(request, {
            tempRoot,
            maxSourceUploadBytes: 1024,
        });

        expect(upload.file.name).toBe('meeting.mp4');
        expect(upload.file.type).toBe('video/mp4');
        expect(upload.file.size).toBe(Buffer.byteLength('small audio payload'));
        expect(upload.fields.get('provider')).toBe('groq');
        expect(upload.fields.get('language')).toBe('de');
        await expect(fs.readFile(upload.file.path, 'utf8')).resolves.toBe('small audio payload');

        await fs.rm(upload.tempDir, { recursive: true, force: true });
    });

    it('rejects and cleans up a file that exceeds the staged-upload cap', async () => {
        const form = new FormData();
        form.append('file', new File(['this payload is intentionally too large'], 'large.mp4', { type: 'video/mp4' }));

        const request = new Request('http://localhost/api/transcribe', {
            method: 'POST',
            body: form,
        });

        await expect(receiveMultipartUpload(request, {
            tempRoot,
            maxSourceUploadBytes: 8,
        })).rejects.toMatchObject<Partial<MultipartUploadError>>({
            code: 'source_upload_too_large',
            status: 413,
        });

        await expect(fs.readdir(tempRoot)).resolves.toEqual([]);
    });
});
