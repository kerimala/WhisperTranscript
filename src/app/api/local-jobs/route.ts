import { NextRequest, NextResponse } from 'next/server';

const backendUrl = () => process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:8001';

export async function POST(request: NextRequest): Promise<NextResponse> {
    try {
        const incoming = await request.formData();
        const file = incoming.get('file');
        if (!(file instanceof File)) {
            return NextResponse.json({ error: true, message: 'No file provided' }, { status: 400 });
        }

        const outgoing = new FormData();
        outgoing.append('file', file, file.name);

        const language = incoming.get('language');
        if (typeof language === 'string' && language.trim()) {
            outgoing.append('language', language.trim());
        }

        const diarizationEnabled = incoming.get('diarize') === 'true';
        outgoing.append('diarize', String(diarizationEnabled));

        // Never persist or return the token. It only crosses this local proxy for
        // the lifetime of the backend request.
        const requestToken = incoming.get('hfToken');
        const hfToken = typeof requestToken === 'string' && requestToken.trim()
            ? requestToken.trim()
            : process.env.HF_TOKEN?.trim();
        if (diarizationEnabled && hfToken) {
            outgoing.append('hf_token', hfToken);
        }

        const response = await fetch(`${backendUrl()}/jobs`, {
            method: 'POST',
            body: outgoing,
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
