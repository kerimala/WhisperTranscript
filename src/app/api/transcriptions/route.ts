import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { TranscriptionResult } from '@/lib/types';

export async function GET() {
    try {
        const saveDir = path.join(process.cwd(), 'transcriptions');

        // Ensure directory exists
        try {
            await fs.access(saveDir);
        } catch {
            return NextResponse.json({ transcriptions: [] });
        }

        const files = await fs.readdir(saveDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const transcriptions = await Promise.all(jsonFiles.map(async (fileName) => {
            const filePath = path.join(saveDir, fileName);
            const stats = await fs.stat(filePath);

            let savedResult: Partial<TranscriptionResult> | null = null;
            try {
                savedResult = JSON.parse(await fs.readFile(filePath, 'utf-8')) as Partial<TranscriptionResult>;
            } catch {
                // Keep malformed or legacy entries visible with filesystem metadata.
            }

            // Extract the original safe name from the timestamp prefix structure we used
            // Format: YYYY-MM-DDTHH-MM-SS-mmmZ_filename.json
            const parts = fileName.split('_');
            const parsedCreatedAt = typeof savedResult?.created_at === 'string'
                ? new Date(savedResult.created_at)
                : null;
            const created_at = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
                ? parsedCreatedAt
                : stats.birthtime;
            const originalName = savedResult?.source_file?.name
                || parts.slice(1).join('_').replace('.json', '');
            const segments = Array.isArray(savedResult?.segments) ? savedResult.segments : [];
            const speakers = new Set(
                segments
                    .map((segment) => segment.speaker)
                    .filter((speaker): speaker is string => typeof speaker === 'string' && speaker.length > 0)
            );
            const durationMs = segments.reduce((maximum, segment) => (
                typeof segment.end_ms === 'number' ? Math.max(maximum, segment.end_ms) : maximum
            ), 0);
            const previewText = typeof savedResult?.full_text === 'string'
                ? savedResult.full_text.trim().replace(/\s+/g, ' ').slice(0, 220)
                : '';

            return {
                fileName,
                originalName: originalName || fileName,
                sizeBytes: stats.size,
                sourceSizeBytes: typeof savedResult?.source_file?.size_bytes === 'number'
                    ? savedResult.source_file.size_bytes
                    : null,
                created_at: created_at.toISOString(),
                provider: typeof savedResult?.provider === 'string' ? savedResult.provider : null,
                model: typeof savedResult?.model === 'string' ? savedResult.model : null,
                language: typeof savedResult?.language === 'string' ? savedResult.language : null,
                segmentCount: segments.length,
                speakerCount: speakers.size,
                durationMs: durationMs || null,
                previewText,
                hasDiarization: Boolean(savedResult?.diarized_text || speakers.size > 0),
            };
        }));

        // Sort newest first
        transcriptions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        return NextResponse.json({ transcriptions });
    } catch (error) {
        console.error("Failed to read transcriptions directory:", error);
        return NextResponse.json({ error: "Failed to load transcriptions" }, { status: 500 });
    }
}
