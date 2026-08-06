import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

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

            // Extract the original safe name from the timestamp prefix structure we used
            // Format: YYYY-MM-DDTHH-MM-SS-mmmZ_filename.json
            const parts = fileName.split('_');
            const created_at = stats.birthtime;
            const originalName = parts.slice(1).join('_').replace('.json', '');

            return {
                fileName,
                originalName: originalName || fileName,
                sizeBytes: stats.size,
                created_at: created_at.toISOString(),
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
