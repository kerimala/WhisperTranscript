import { NextResponse, NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileName: string }> }
) {
    try {
        const p = await params;
        const fileName = p.fileName;

        // Basic security check to prevent directory traversal
        if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
            return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
        }

        const filePath = path.join(process.cwd(), 'transcriptions', fileName);

        try {
            await fs.access(filePath);
        } catch {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        const fileContent = await fs.readFile(filePath, 'utf-8');
        const jsonResult = JSON.parse(fileContent);

        return NextResponse.json(jsonResult);
    } catch (error) {
        console.error("Failed to read transcription file:", error);
        return NextResponse.json({ error: "Failed to load transcription" }, { status: 500 });
    }
}
