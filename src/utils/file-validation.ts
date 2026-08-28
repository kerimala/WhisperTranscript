/**
 * File validation utilities
 * 
 * Validates file type and size according to Groq API constraints.
 */

import {
    SUPPORTED_AUDIO_TYPES,
    SUPPORTED_EXTENSIONS,
    MAX_FILE_SIZE_FREE,
} from '@/lib/types';

export interface ValidationResult {
    valid: boolean;
    error?: string;
    supportedTypes?: string[];
}

/**
 * Check if a file type is supported for transcription
 */
export function isValidFileType(file: Pick<File, 'name' | 'type'>): boolean {
    // Check MIME type
    const mimeType = file.type.toLowerCase();
    if (SUPPORTED_AUDIO_TYPES.some(t => mimeType.includes(t.split('/')[1]))) {
        return true;
    }

    // Fallback to extension check (some browsers don't set MIME type correctly)
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    return SUPPORTED_EXTENSIONS.some(e => e === ext);
}

/**
 * Check if file size is within limits
 */
export function isValidFileSize(file: File, maxSize: number = MAX_FILE_SIZE_FREE): boolean {
    return file.size <= maxSize;
}

/**
 * Get human-readable file size
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Validate a file for transcription
 */
export function validateFile(file: File, maxSize: number = MAX_FILE_SIZE_FREE): ValidationResult {
    // Check file type
    if (!isValidFileType(file)) {
        return {
            valid: false,
            error: `Unsupported file type: ${file.type || 'unknown'}. Please use one of the supported audio formats.`,
            supportedTypes: [...SUPPORTED_EXTENSIONS],
        };
    }

    // Check file size
    if (!isValidFileSize(file, maxSize)) {
        return {
            valid: false,
            error: `File too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(maxSize)}.`,
        };
    }

    // Check for empty file
    if (file.size === 0) {
        return {
            valid: false,
            error: 'File is empty. Please select a valid audio file.',
        };
    }

    return { valid: true };
}

/**
 * Get accepted file types string for input element
 */
export function getAcceptedFileTypes(): string {
    return [
        ...SUPPORTED_AUDIO_TYPES,
        ...SUPPORTED_EXTENSIONS,
    ].join(',');
}
