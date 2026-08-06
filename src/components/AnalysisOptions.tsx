'use client';

/**
 * AnalysisOptions Component
 * 
 * UI for selecting AI analysis options:
 * - Provider selection (Kimi/DeepSeek)
 * - Analysis mode (Summarize/Tasks/Key Points)
 * - Analyze button with loading state
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AnalysisMode, AIProviderName, AnalysisResult, isAnalysisError } from '@/lib/types';

interface ProviderInfo {
    name: AIProviderName;
    displayName: string;
    model: string;
}

interface AnalysisOptionsProps {
    text: string;
    onAnalysisComplete: (result: AnalysisResult) => void;
    onError: (message: string) => void;
}

const MODE_OPTIONS: { value: AnalysisMode; label: string; description: string }[] = [
    { value: 'summarize', label: 'Summarize', description: 'Get a concise summary' },
    { value: 'tasks', label: 'Extract Tasks', description: 'Find action items' },
    { value: 'key_points', label: 'Key Points', description: 'Highlight important info' },
];

export default function AnalysisOptions({ text, onAnalysisComplete, onError }: AnalysisOptionsProps) {
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [defaultProvider, setDefaultProvider] = useState<AIProviderName | null>(null);
    const [selectedProvider, setSelectedProvider] = useState<AIProviderName | null>(null);
    const [selectedMode, setSelectedMode] = useState<AnalysisMode>('summarize');
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingProviders, setIsLoadingProviders] = useState(true);

    // Fetch available providers on mount
    useEffect(() => {
        async function fetchProviders() {
            try {
                const response = await fetch('/api/analyze');
                const data = await response.json();
                setProviders(data.availableProviders || []);
                setDefaultProvider(data.defaultProvider);
                setSelectedProvider(data.defaultProvider);
            } catch (err) {
                console.error('Failed to fetch providers:', err);
            } finally {
                setIsLoadingProviders(false);
            }
        }
        fetchProviders();
    }, []);

    const handleAnalyze = useCallback(async () => {
        if (!selectedProvider || !text) return;

        setIsLoading(true);
        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    mode: selectedMode,
                    provider: selectedProvider,
                }),
            });

            const data = await response.json();

            if (isAnalysisError(data)) {
                onError(data.message);
            } else {
                onAnalysisComplete(data);
            }
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Analysis failed');
        } finally {
            setIsLoading(false);
        }
    }, [text, selectedMode, selectedProvider, onAnalysisComplete, onError]);

    if (isLoadingProviders) {
        return (
            <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent"></div>
                <span className="ml-2 text-sm text-slate-500">Loading providers...</span>
            </div>
        );
    }

    if (providers.length === 0) {
        return (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                <p className="font-medium">AI Analysis Unavailable</p>
                <p className="mt-1 text-amber-700">
                    No AI providers configured. Add KIMI_API_KEY or DEEPSEEK_API_KEY to enable analysis.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-5 mt-6 border border-indigo-100">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">AI Analysis</h3>

            {/* Provider Selection */}
            {providers.length > 1 && (
                <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Provider
                    </label>
                    <div className="flex gap-2">
                        {providers.map((provider) => (
                            <button
                                key={provider.name}
                                onClick={() => setSelectedProvider(provider.name)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedProvider === provider.name
                                        ? 'bg-indigo-600 text-white shadow-md'
                                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                                    }`}
                            >
                                {provider.displayName}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Mode Selection */}
            <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                    Analysis Type
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {MODE_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => setSelectedMode(option.value)}
                            className={`p-3 rounded-lg text-left transition-all ${selectedMode === option.value
                                    ? 'bg-white shadow-md ring-2 ring-indigo-500'
                                    : 'bg-white/50 hover:bg-white border border-slate-200'
                                }`}
                        >
                            <div className="font-medium text-slate-800">{option.label}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{option.description}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Analyze Button */}
            <button
                onClick={handleAnalyze}
                disabled={isLoading || !selectedProvider}
                className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 
                           text-white font-medium rounded-lg transition-all shadow-md hover:shadow-lg
                           disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md
                           flex items-center justify-center gap-2"
            >
                {isLoading ? (
                    <>
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                        <span>Analyzing...</span>
                    </>
                ) : (
                    <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <span>Analyze with {providers.find(p => p.name === selectedProvider)?.displayName}</span>
                    </>
                )}
            </button>
        </div>
    );
}
