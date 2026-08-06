/**
 * Transcript Cleaner Utility
 * 
 * Strips unnecessary metadata from transcription results
 * to minimize token usage when sending to AI providers.
 */

import { TranscriptionResult, CleanedTranscript } from './types';

/**
 * Clean a transcription result for AI analysis
 * Removes index, start_ms, end_ms from segments to reduce tokens
 * 
 * @param result - Full transcription result
 * @returns Cleaned transcript with only text content
 */
export function cleanForAnalysis(result: TranscriptionResult): CleanedTranscript {
    return {
        full_text: result.full_text,
        segments: result.segments.map(seg => seg.text).filter(text => text.trim().length > 0),
    };
}

/**
 * Convert cleaned transcript to a single string for AI prompt
 * 
 * @param cleaned - Cleaned transcript
 * @returns Single string suitable for AI prompt
 */
export function cleanedToPromptText(cleaned: CleanedTranscript): string {
    // For most cases, full_text is sufficient
    // But if segments provide better structure, we can join them
    return cleaned.full_text;
}

/**
 * Estimate token count for a text string
 * Rough estimation: ~4 characters per token for English
 * 
 * @param text - Text to estimate
 * @returns Approximate token count
 */
export function estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Calculate token savings from cleaning
 * 
 * @param original - Original transcription result
 * @param cleaned - Cleaned transcript
 * @returns Object with original, cleaned, and savings counts
 */
export function calculateTokenSavings(
    original: TranscriptionResult,
    cleaned: CleanedTranscript
): { originalTokens: number; cleanedTokens: number; savedTokens: number; savingsPercent: number } {
    const originalJson = JSON.stringify(original);
    const cleanedJson = JSON.stringify(cleaned);

    const originalTokens = estimateTokenCount(originalJson);
    const cleanedTokens = estimateTokenCount(cleanedJson);
    const savedTokens = originalTokens - cleanedTokens;
    const savingsPercent = Math.round((savedTokens / originalTokens) * 100);

    return { originalTokens, cleanedTokens, savedTokens, savingsPercent };
}
