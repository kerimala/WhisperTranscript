/**
 * Analysis API Route
 * 
 * POST /api/analyze
 * Accepts text and analysis mode, returns AI-generated analysis.
 * Supports Kimi K2.5 and DeepSeek providers.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    AnalysisResult,
    AnalysisError,
    AnalysisMode,
    AIProviderName,
} from '@/lib/types';
import {
    getAIProvider,
    getAvailableProviders,
    getDefaultProvider,
    getProviderInfo,
} from '@/lib/ai-providers';

/**
 * Create an error response
 */
function errorResponse(message: string, status: number): NextResponse<AnalysisError> {
    return NextResponse.json(
        {
            error: true,
            message,
        },
        { status }
    );
}

/**
 * Validate analysis mode
 */
function isValidMode(mode: string): mode is AnalysisMode {
    return ['summarize', 'tasks', 'key_points'].includes(mode);
}

/**
 * Validate provider name
 */
function isValidProvider(provider: string): provider is AIProviderName {
    return ['kimi', 'deepseek'].includes(provider);
}

/**
 * POST /api/analyze
 */
export async function POST(request: NextRequest): Promise<NextResponse<AnalysisResult | AnalysisError>> {
    try {
        // Parse request body
        const body = await request.json();
        const { text, mode, provider: requestedProvider } = body;

        // Validate text
        if (!text || typeof text !== 'string') {
            return errorResponse('Text is required', 400);
        }

        if (text.trim().length === 0) {
            return errorResponse('Text cannot be empty', 400);
        }

        // Validate mode
        if (!mode || !isValidMode(mode)) {
            return errorResponse(
                `Invalid mode. Must be one of: summarize, tasks, key_points`,
                400
            );
        }

        // Check available providers
        const availableProviders = getAvailableProviders();
        if (availableProviders.length === 0) {
            return errorResponse(
                'No AI providers configured. Please set KIMI_API_KEY or DEEPSEEK_API_KEY.',
                500
            );
        }

        // Determine which provider to use
        let providerName: AIProviderName;
        if (requestedProvider) {
            if (!isValidProvider(requestedProvider)) {
                return errorResponse(
                    `Invalid provider. Must be one of: ${availableProviders.join(', ')}`,
                    400
                );
            }
            if (!availableProviders.includes(requestedProvider)) {
                return errorResponse(
                    `Provider '${requestedProvider}' is not configured. Available: ${availableProviders.join(', ')}`,
                    400
                );
            }
            providerName = requestedProvider;
        } else {
            const defaultProvider = getDefaultProvider();
            if (!defaultProvider) {
                return errorResponse('No default provider available', 500);
            }
            providerName = defaultProvider;
        }

        // Get provider and run analysis
        const provider = getAIProvider(providerName);
        const startTime = new Date();

        console.log(`Running ${mode} analysis with ${providerName}...`);
        const content = await provider.analyze(text, mode);

        const result: AnalysisResult = {
            provider: providerName,
            model: provider.model,
            mode,
            content,
            created_at: startTime.toISOString(),
        };

        return NextResponse.json(result);
    } catch (error) {
        console.error('Analysis error:', error);

        const message = error instanceof Error ? error.message : 'Analysis failed';

        // Check for rate limiting
        if (message.includes('rate limit') || message.includes('429')) {
            return errorResponse('Rate limit exceeded. Please try again in a few moments.', 429);
        }

        // Check for auth errors
        if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid')) {
            return errorResponse('API key is invalid or expired', 401);
        }

        return errorResponse(message, 500);
    }
}

/**
 * GET /api/analyze - Return API info and available providers
 */
export async function GET(): Promise<NextResponse> {
    const availableProviders = getAvailableProviders();
    const defaultProvider = getDefaultProvider();

    return NextResponse.json({
        name: 'Transcript Analysis API',
        version: '1.0.0',
        availableProviders: availableProviders.map(name => ({
            name,
            ...getProviderInfo(name),
        })),
        defaultProvider,
        modes: ['summarize', 'tasks', 'key_points'],
    });
}
