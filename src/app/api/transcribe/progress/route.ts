import { NextRequest, NextResponse } from 'next/server';
import {
    getTranscriptionProgress,
    isValidTranscriptionProgressId,
} from '@/lib/transcription-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Return the latest server-side phase for a browser-owned opaque progress ID.
 * Polling is deliberately short-lived and uncacheable: this route is only
 * active while the upload request itself remains in flight.
 */
export function GET(request: NextRequest): NextResponse {
    const id = request.nextUrl.searchParams.get('id');
    if (!isValidTranscriptionProgressId(id)) {
        return NextResponse.json(
            { error: 'A valid progress id is required.' },
            { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
    }

    const snapshot = getTranscriptionProgress(id);
    if (!snapshot) {
        return NextResponse.json(
            { error: 'Progress is not available yet.' },
            { status: 404, headers: { 'Cache-Control': 'no-store' } }
        );
    }

    return NextResponse.json(snapshot, {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
}
