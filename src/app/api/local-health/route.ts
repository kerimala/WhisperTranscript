import { NextResponse } from 'next/server';

/**
 * GET /api/local-health
 * Server-side proxy for the Python backend health check.
 * Avoids CORS issues when the browser tries to reach 127.0.0.1:8001 directly.
 */
export async function GET(): Promise<NextResponse> {
    const backendUrl = process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:8001';
    try {
        const res = await fetch(`${backendUrl}/health`, {
            signal: AbortSignal.timeout(2000),
        });
        return NextResponse.json({ running: res.ok });
    } catch {
        return NextResponse.json({ running: false });
    }
}
