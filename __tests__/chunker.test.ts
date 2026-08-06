/**
 * Tests for audio chunking utilities
 */

import {
    needsChunking,
    calculateChunkCount,
    splitFileIntoChunks,
    reassembleFullText,
    reassembleTranscriptSegments,
} from '../src/lib/chunker';
import { MAX_CHUNK_SIZE } from '../src/lib/types';

describe('needsChunking', () => {
    it('returns false for files smaller than max size', () => {
        expect(needsChunking(1024 * 1024)).toBe(false); // 1 MB
        expect(needsChunking(20 * 1024 * 1024)).toBe(false); // 20 MB
    });

    it('returns true for files larger than max size', () => {
        expect(needsChunking(30 * 1024 * 1024)).toBe(true); // 30 MB
        expect(needsChunking(100 * 1024 * 1024)).toBe(true); // 100 MB
    });

    it('returns false for files exactly at max size', () => {
        expect(needsChunking(MAX_CHUNK_SIZE)).toBe(false);
    });

    it('respects custom max size', () => {
        expect(needsChunking(5 * 1024 * 1024, 4 * 1024 * 1024)).toBe(true);
        expect(needsChunking(3 * 1024 * 1024, 4 * 1024 * 1024)).toBe(false);
    });
});

describe('calculateChunkCount', () => {
    it('returns 1 for small files', () => {
        expect(calculateChunkCount(1024)).toBe(1);
        expect(calculateChunkCount(20 * 1024 * 1024)).toBe(1);
    });

    it('calculates correct chunk count for large files', () => {
        // 48 MB with 24 MB chunks = 2 chunks
        expect(calculateChunkCount(48 * 1024 * 1024)).toBe(2);

        // 50 MB with 24 MB chunks = 3 chunks (ceiling)
        expect(calculateChunkCount(50 * 1024 * 1024)).toBe(3);

        // 100 MB with 24 MB chunks = 5 chunks
        expect(calculateChunkCount(100 * 1024 * 1024)).toBe(5);
    });

    it('handles custom chunk sizes', () => {
        expect(calculateChunkCount(10 * 1024 * 1024, 5 * 1024 * 1024)).toBe(2);
        expect(calculateChunkCount(11 * 1024 * 1024, 5 * 1024 * 1024)).toBe(3);
    });
});

describe('splitFileIntoChunks', () => {
    it('returns single chunk for small files', () => {
        const blob = new Blob(['test content'], { type: 'audio/mp3' });
        const chunks = splitFileIntoChunks(blob);

        expect(chunks).toHaveLength(1);
        expect(chunks[0].index).toBe(0);
        expect(chunks[0].startByte).toBe(0);
        expect(chunks[0].endByte).toBe(blob.size);
    });

    it('splits large files into correct number of chunks', () => {
        // Create a blob larger than chunk size
        const data = new Uint8Array(5 * 1024 * 1024); // 5 MB
        const blob = new Blob([data]);

        const chunks = splitFileIntoChunks(blob, 2 * 1024 * 1024); // 2 MB chunks

        expect(chunks).toHaveLength(3);
        expect(chunks[0].index).toBe(0);
        expect(chunks[1].index).toBe(1);
        expect(chunks[2].index).toBe(2);
    });

    it('maintains correct byte offsets', () => {
        const data = new Uint8Array(6 * 1024 * 1024); // 6 MB
        const blob = new Blob([data]);
        const chunkSize = 2 * 1024 * 1024; // 2 MB

        const chunks = splitFileIntoChunks(blob, chunkSize);

        expect(chunks[0].startByte).toBe(0);
        expect(chunks[0].endByte).toBe(chunkSize);

        expect(chunks[1].startByte).toBe(chunkSize);
        expect(chunks[1].endByte).toBe(chunkSize * 2);

        expect(chunks[2].startByte).toBe(chunkSize * 2);
        expect(chunks[2].endByte).toBe(blob.size);
    });
});

describe('reassembleFullText', () => {
    it('combines text from chunks in correct order', () => {
        const results = [
            { index: 0, text: 'Hello' },
            { index: 1, text: 'world!' },
            { index: 2, text: 'How are you?' },
        ];

        const fullText = reassembleFullText(results);
        expect(fullText).toBe('Hello world! How are you?');
    });

    it('handles out-of-order chunks', () => {
        const results = [
            { index: 2, text: 'third' },
            { index: 0, text: 'first' },
            { index: 1, text: 'second' },
        ];

        const fullText = reassembleFullText(results);
        expect(fullText).toBe('first second third');
    });

    it('trims whitespace from chunk text', () => {
        const results = [
            { index: 0, text: '  Hello  ' },
            { index: 1, text: '  world!  ' },
        ];

        const fullText = reassembleFullText(results);
        expect(fullText).toBe('Hello world!');
    });

    it('handles empty chunks', () => {
        const results = [
            { index: 0, text: 'Hello' },
            { index: 1, text: '' },
            { index: 2, text: 'world' },
        ];

        const fullText = reassembleFullText(results);
        expect(fullText).toBe('Hello  world');
    });
});

describe('reassembleTranscriptSegments', () => {
    it('reindexes segments across chunks', () => {
        const results = [
            {
                index: 0,
                segments: [
                    { index: 0, start_ms: 0, end_ms: 1000, text: 'First' },
                    { index: 1, start_ms: 1000, end_ms: 2000, text: 'Second' },
                ],
            },
            {
                index: 1,
                segments: [
                    { index: 0, start_ms: 0, end_ms: 1000, text: 'Third' },
                    { index: 1, start_ms: 1000, end_ms: 2000, text: 'Fourth' },
                ],
            },
        ];

        const segments = reassembleTranscriptSegments(results);

        expect(segments).toHaveLength(4);
        expect(segments[0].index).toBe(0);
        expect(segments[1].index).toBe(1);
        expect(segments[2].index).toBe(2);
        expect(segments[3].index).toBe(3);
        expect(segments[0].text).toBe('First');
        expect(segments[3].text).toBe('Fourth');
    });

    it('handles out-of-order chunks', () => {
        const results = [
            {
                index: 1,
                segments: [{ index: 0, start_ms: null, end_ms: null, text: 'B' }],
            },
            {
                index: 0,
                segments: [{ index: 0, start_ms: null, end_ms: null, text: 'A' }],
            },
        ];

        const segments = reassembleTranscriptSegments(results);

        expect(segments[0].text).toBe('A');
        expect(segments[1].text).toBe('B');
    });

    it('handles empty segment arrays', () => {
        const results = [
            { index: 0, segments: [] },
            { index: 1, segments: [{ index: 0, start_ms: null, end_ms: null, text: 'Only' }] },
        ];

        const segments = reassembleTranscriptSegments(results);

        expect(segments).toHaveLength(1);
        expect(segments[0].text).toBe('Only');
        expect(segments[0].index).toBe(0);
    });
});
