/**
 * Ephemeral progress snapshots for a single transcription request.
 *
 * The browser owns the opaque progress ID. The snapshot deliberately contains
 * no source path, file name, API key, transcript, or provider error details;
 * it only gives that browser enough information to render an honest status.
 * This is an in-process registry, which matches the self-hosted Node runtime
 * used for large streamed uploads. A multi-instance deployment should replace
 * this with a shared store or a streaming job system.
 */

export type TranscriptionProgressStage =
    | 'received'
    | 'optimizing'
    | 'splitting'
    | 'transcribing'
    | 'diarizing'
    | 'complete'
    | 'error';

export interface TranscriptionProgressSnapshot {
    id: string;
    stage: TranscriptionProgressStage;
    message: string;
    provider?: string;
    model?: string;
    totalChunks?: number;
    completedChunks?: number;
    activeWorkers?: number;
    workerLimit?: number;
    sourceDurationSeconds?: number;
    startedAt: string;
    updatedAt: string;
}

export type TranscriptionProgressUpdate = Omit<
    Partial<TranscriptionProgressSnapshot>,
    'id' | 'startedAt' | 'updatedAt'
> & {
    stage: TranscriptionProgressStage;
    message: string;
};

const ACTIVE_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const TERMINAL_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_SNAPSHOTS = 200;
const PROGRESS_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

const registry = new Map<string, TranscriptionProgressSnapshot>();

function isTerminal(stage: TranscriptionProgressStage): boolean {
    return stage === 'complete' || stage === 'error';
}

function pruneSnapshots(now = Date.now()): void {
    for (const [id, snapshot] of registry) {
        const maxAge = isTerminal(snapshot.stage)
            ? TERMINAL_SNAPSHOT_MAX_AGE_MS
            : ACTIVE_SNAPSHOT_MAX_AGE_MS;
        if (now - Date.parse(snapshot.updatedAt) > maxAge) {
            registry.delete(id);
        }
    }

    if (registry.size <= MAX_SNAPSHOTS) {
        return;
    }

    const oldest = [...registry.values()]
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
        .slice(0, registry.size - MAX_SNAPSHOTS);
    for (const snapshot of oldest) {
        registry.delete(snapshot.id);
    }
}

export function isValidTranscriptionProgressId(value: string | null | undefined): value is string {
    return typeof value === 'string' && PROGRESS_ID_PATTERN.test(value);
}

export function startTranscriptionProgress(
    id: string,
    update: TranscriptionProgressUpdate
): TranscriptionProgressSnapshot | null {
    if (!isValidTranscriptionProgressId(id)) {
        return null;
    }

    const now = new Date().toISOString();
    pruneSnapshots();
    const snapshot: TranscriptionProgressSnapshot = {
        id,
        ...update,
        startedAt: now,
        updatedAt: now,
    };
    registry.set(id, snapshot);
    return { ...snapshot };
}

export function updateTranscriptionProgress(
    id: string | null | undefined,
    update: TranscriptionProgressUpdate
): TranscriptionProgressSnapshot | null {
    if (!isValidTranscriptionProgressId(id)) {
        return null;
    }

    const existing = registry.get(id);
    if (!existing) {
        return startTranscriptionProgress(id, update);
    }

    const snapshot: TranscriptionProgressSnapshot = {
        ...existing,
        ...update,
        updatedAt: new Date().toISOString(),
    };
    registry.set(id, snapshot);
    return { ...snapshot };
}

export function getTranscriptionProgress(
    id: string | null | undefined
): TranscriptionProgressSnapshot | null {
    if (!isValidTranscriptionProgressId(id)) {
        return null;
    }

    pruneSnapshots();
    const snapshot = registry.get(id);
    return snapshot ? { ...snapshot } : null;
}

/** Test-only utility. It is intentionally not imported by application code. */
export function clearTranscriptionProgressForTests(): void {
    registry.clear();
}
