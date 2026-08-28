import { NextRequest, NextResponse } from 'next/server';

const backendUrl = () => process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:8001';
const validJobId = (jobId: string) => /^[0-9a-f-]{36}$/i.test(jobId);

async function proxyJob(jobId: string, method: 'GET' | 'DELETE'): Promise<NextResponse> {
    if (!validJobId(jobId)) {
        return NextResponse.json({ error: true, message: 'Invalid job ID' }, { status: 400 });
    }
    try {
        const response = await fetch(`${backendUrl()}/jobs/${encodeURIComponent(jobId)}`, {
            method,
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
        });
        const payload = await response.json().catch(() => ({
            error: true,
            message: `Local backend returned HTTP ${response.status}`,
        }));
        return NextResponse.json(payload, { status: response.status });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Local backend is unavailable';
        return NextResponse.json({ error: true, message }, { status: 502 });
    }
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
    return proxyJob((await params).jobId, 'GET');
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
    return proxyJob((await params).jobId, 'DELETE');
}
