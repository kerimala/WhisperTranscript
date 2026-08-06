/**
 * AI Provider Abstraction Layer
 * 
 * Supports Kimi K2.5 and DeepSeek for transcript analysis.
 * Both use OpenAI-compatible API format.
 */

import { AnalysisMode, AIProviderName } from './types';

/**
 * AI Provider interface
 */
export interface AIProvider {
    name: AIProviderName;
    model: string;
    analyze(text: string, mode: AnalysisMode): Promise<string>;
}

/**
 * Provider configuration
 */
interface ProviderConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

/**
 * Analysis prompts for each mode
 */
const ANALYSIS_PROMPTS: Record<AnalysisMode, string> = {
    summarize: `Summarize the following transcript concisely. Focus on the main points and key information. Write in clear, complete sentences.

Transcript:
{text}`,

    tasks: `Extract action items and tasks from the following transcript. Format as a numbered list. Include who is responsible if mentioned. If no tasks are found, state that clearly.

Transcript:
{text}`,

    key_points: `Extract the key points and important information from the following transcript. Format as bullet points. Focus on decisions, conclusions, and important facts.

Transcript:
{text}`,
};

/**
 * Make an OpenAI-compatible API request
 */
async function makeOpenAIRequest(
    config: ProviderConfig,
    prompt: string
): Promise<string> {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.3, // Lower temperature for more consistent output
            max_tokens: 2000,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response format from AI provider');
    }

    return data.choices[0].message.content;
}

/**
 * Kimi K2.5 Provider
 */
class KimiProvider implements AIProvider {
    name: AIProviderName = 'kimi';
    model = 'kimi-k2-0711-preview';
    private config: ProviderConfig;

    constructor(apiKey: string) {
        this.config = {
            apiKey,
            baseUrl: 'https://api.moonshot.cn/v1',
            model: this.model,
        };
    }

    async analyze(text: string, mode: AnalysisMode): Promise<string> {
        const prompt = ANALYSIS_PROMPTS[mode].replace('{text}', text);
        return makeOpenAIRequest(this.config, prompt);
    }
}

/**
 * DeepSeek Provider
 */
class DeepSeekProvider implements AIProvider {
    name: AIProviderName = 'deepseek';
    model = 'deepseek-chat';
    private config: ProviderConfig;

    constructor(apiKey: string) {
        this.config = {
            apiKey,
            baseUrl: 'https://api.deepseek.com/v1',
            model: this.model,
        };
    }

    async analyze(text: string, mode: AnalysisMode): Promise<string> {
        const prompt = ANALYSIS_PROMPTS[mode].replace('{text}', text);
        return makeOpenAIRequest(this.config, prompt);
    }
}

/**
 * Get available providers based on configured API keys
 */
export function getAvailableProviders(): AIProviderName[] {
    const providers: AIProviderName[] = [];

    if (process.env.KIMI_API_KEY) {
        providers.push('kimi');
    }
    if (process.env.DEEPSEEK_API_KEY) {
        providers.push('deepseek');
    }

    return providers;
}

/**
 * Get the default provider (from env or first available)
 */
export function getDefaultProvider(): AIProviderName | null {
    const available = getAvailableProviders();

    if (available.length === 0) {
        return null;
    }

    // Check if configured default is available
    const configuredDefault = process.env.AI_ANALYSIS_PROVIDER as AIProviderName;
    if (configuredDefault && available.includes(configuredDefault)) {
        return configuredDefault;
    }

    // Fall back to first available
    return available[0];
}

/**
 * Create an AI provider instance
 * 
 * @param name - Provider name ('kimi' or 'deepseek')
 * @returns AIProvider instance
 * @throws Error if provider is not configured
 */
export function getAIProvider(name: AIProviderName): AIProvider {
    switch (name) {
        case 'kimi': {
            const apiKey = process.env.KIMI_API_KEY;
            if (!apiKey) {
                throw new Error('KIMI_API_KEY environment variable is not set');
            }
            return new KimiProvider(apiKey);
        }
        case 'deepseek': {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            if (!apiKey) {
                throw new Error('DEEPSEEK_API_KEY environment variable is not set');
            }
            return new DeepSeekProvider(apiKey);
        }
        default:
            throw new Error(`Unknown AI provider: ${name}`);
    }
}

/**
 * Get provider info for client-side display
 */
export function getProviderInfo(name: AIProviderName): { displayName: string; model: string } {
    switch (name) {
        case 'kimi':
            return { displayName: 'Kimi K2.5', model: 'kimi-k2-0711-preview' };
        case 'deepseek':
            return { displayName: 'DeepSeek', model: 'deepseek-chat' };
        default:
            return { displayName: name, model: 'unknown' };
    }
}
