/**
 * Transcription Cache Utility
 * 
 * Manages localStorage caching for resumable transcription.
 * Allows saving progress when rate limits are hit and resuming later.
 */

import { SavedTranscriptionState, ChunkResult } from './types';

const STORAGE_PREFIX = 'whisper_progress_';
const EXPIRY_HOURS = 24;

/**
 * Generate a unique hash for a file based on its content and metadata
 * Uses first 1MB of file + size + name for quick identification
 */
export async function generateFileHash(file: File): Promise<string> {
    try {
        // Use first 1MB chunk for hashing (faster than full file)
        const chunk = file.slice(0, 1024 * 1024);
        const buffer = await chunk.arrayBuffer();

        // Use SubtleCrypto for SHA-256 hash
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Combine with file metadata for uniqueness
        return `${hashHex.slice(0, 16)}-${file.size}-${encodeURIComponent(file.name)}`;
    } catch {
        // Fallback if crypto not available
        return `${file.size}-${file.lastModified}-${encodeURIComponent(file.name)}`;
    }
}

/**
 * Get storage key for a file hash
 */
function getStorageKey(fileHash: string): string {
    return `${STORAGE_PREFIX}${fileHash}`;
}

/**
 * Save transcription progress to localStorage
 */
export function saveProgress(
    fileHash: string,
    fileName: string,
    fileSize: number,
    fileType: string,
    totalChunks: number,
    completedChunks: number[],
    results: ChunkResult[],
    cumulativeDurationMs: number,
    detectedLanguage: string | null
): void {
    try {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + EXPIRY_HOURS * 60 * 60 * 1000);

        const state: SavedTranscriptionState = {
            fileHash,
            fileName,
            fileSize,
            fileType,
            totalChunks,
            completedChunks,
            results,
            cumulativeDurationMs,
            detectedLanguage,
            createdAt: now.toISOString(),
            lastUpdatedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
        };

        localStorage.setItem(getStorageKey(fileHash), JSON.stringify(state));
        console.log(`Saved progress: ${completedChunks.length}/${totalChunks} chunks`);
    } catch (err) {
        console.warn('Failed to save transcription progress:', err);
    }
}

/**
 * Load saved transcription progress from localStorage
 * Returns null if not found or expired
 */
export function loadProgress(fileHash: string): SavedTranscriptionState | null {
    try {
        const key = getStorageKey(fileHash);
        const stored = localStorage.getItem(key);

        if (!stored) {
            return null;
        }

        const state: SavedTranscriptionState = JSON.parse(stored);

        // Check if expired
        if (new Date(state.expiresAt) < new Date()) {
            console.log('Saved progress expired, clearing...');
            clearProgress(fileHash);
            return null;
        }

        return state;
    } catch (err) {
        console.warn('Failed to load transcription progress:', err);
        return null;
    }
}

/**
 * Clear saved progress for a file
 */
export function clearProgress(fileHash: string): void {
    try {
        localStorage.removeItem(getStorageKey(fileHash));
        console.log('Cleared saved progress');
    } catch (err) {
        console.warn('Failed to clear transcription progress:', err);
    }
}

/**
 * Update existing progress with new completed chunk
 */
export function updateProgress(
    fileHash: string,
    chunkIndex: number,
    chunkResult: ChunkResult,
    cumulativeDurationMs: number
): void {
    const existing = loadProgress(fileHash);
    if (!existing) {
        console.warn('No existing progress to update');
        return;
    }

    // Add new chunk result
    if (!existing.completedChunks.includes(chunkIndex)) {
        existing.completedChunks.push(chunkIndex);
        existing.results.push(chunkResult);
    }

    existing.cumulativeDurationMs = cumulativeDurationMs;
    existing.lastUpdatedAt = new Date().toISOString();

    try {
        localStorage.setItem(getStorageKey(fileHash), JSON.stringify(existing));
    } catch (err) {
        console.warn('Failed to update transcription progress:', err);
    }
}

/**
 * Get all saved transcription states (for debugging/cleanup)
 */
export function getAllSavedProgress(): SavedTranscriptionState[] {
    const states: SavedTranscriptionState[] = [];

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(STORAGE_PREFIX)) {
                const stored = localStorage.getItem(key);
                if (stored) {
                    states.push(JSON.parse(stored));
                }
            }
        }
    } catch (err) {
        console.warn('Failed to get all saved progress:', err);
    }

    return states;
}

/**
 * Clean up expired entries
 */
export function cleanupExpiredProgress(): number {
    let cleaned = 0;

    try {
        const now = new Date();
        const keysToRemove: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(STORAGE_PREFIX)) {
                const stored = localStorage.getItem(key);
                if (stored) {
                    const state: SavedTranscriptionState = JSON.parse(stored);
                    if (new Date(state.expiresAt) < now) {
                        keysToRemove.push(key);
                    }
                }
            }
        }

        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            cleaned++;
        });
    } catch (err) {
        console.warn('Failed to cleanup expired progress:', err);
    }

    return cleaned;
}

/**
 * Check if there's saved progress for a file
 */
export function hasSavedProgress(fileHash: string): boolean {
    return loadProgress(fileHash) !== null;
}

/**
 * Get summary of saved progress for display
 */
export function getProgressSummary(fileHash: string): {
    hasProgress: boolean;
    completedChunks: number;
    totalChunks: number;
    lastUpdated: string | null;
} {
    const state = loadProgress(fileHash);

    if (!state) {
        return {
            hasProgress: false,
            completedChunks: 0,
            totalChunks: 0,
            lastUpdated: null,
        };
    }

    return {
        hasProgress: true,
        completedChunks: state.completedChunks.length,
        totalChunks: state.totalChunks,
        lastUpdated: state.lastUpdatedAt,
    };
}
