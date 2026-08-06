'use client';

/**
 * TranscriptOutput Component
 * 
 * Displays transcription result with copy and download options.
 * Includes AI analysis functionality.
 */

import React, { useState, useCallback } from 'react';
import { TranscriptionResult, AnalysisResult } from '@/lib/types';
import AnalysisOptions from './AnalysisOptions';

interface TranscriptOutputProps {
    result: TranscriptionResult;
    onReset: () => void;
}

type ViewMode = 'json' | 'text' | 'diarized' | 'analysis';

export default function TranscriptOutput({ result, onReset }: TranscriptOutputProps) {
    const [copied, setCopied] = useState<'json' | 'text' | 'diarized' | 'analysis' | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('text');
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);

    const copyToClipboard = useCallback(async (content: string, type: 'json' | 'text' | 'diarized' | 'analysis') => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(type);
            setTimeout(() => setCopied(null), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, []);

    const downloadJson = useCallback(() => {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${result.source_file.name.replace(/\.[^/.]+$/, '')}_transcript.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [result]);

    const downloadCleanJson = useCallback(() => {
        const cleanSegments = result.segments.map(seg => ({
            speaker: seg.speaker || "Unknown",
            text: seg.text
        }));
        const blob = new Blob([JSON.stringify(cleanSegments, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${result.source_file.name.replace(/\.[^/.]+$/, '')}_clean_transcript.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [result]);

    const downloadTxt = useCallback(() => {
        const content = viewMode === 'diarized' && result.diarized_text ? result.diarized_text : result.full_text;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${result.source_file.name.replace(/\.[^/.]+$/, '')}_transcript.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [result, viewMode]);

    const handleAnalysisComplete = useCallback((analysisData: AnalysisResult) => {
        setAnalysisResult(analysisData);
        setAnalysisError(null);
        setViewMode('analysis');
    }, []);

    const handleAnalysisError = useCallback((message: string) => {
        setAnalysisError(message);
    }, []);

    const formattedJson = JSON.stringify(result, null, 2);

    const getModeLabel = (mode: string): string => {
        switch (mode) {
            case 'summarize': return 'Summary';
            case 'tasks': return 'Tasks';
            case 'key_points': return 'Key Points';
            default: return mode;
        }
    };

    return (
        <div className="w-full space-y-6">
            {/* Header with actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold text-slate-800">Transcription Complete</h2>
                    <p className="text-sm text-slate-500 mt-1">
                        {result.source_file.name} • {result.segments.length} segment{result.segments.length !== 1 ? 's' : ''}
                        {result.language && ` • ${result.language.toUpperCase()}`}
                    </p>
                </div>

                <button
                    onClick={onReset}
                    className="px-4 py-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                    ← Transcribe another file
                </button>
            </div>

            {/* View toggle */}
            <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit">
                <button
                    onClick={() => setViewMode('text')}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewMode === 'text' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                        }`}
                >
                    Text
                </button>
                <button
                    onClick={() => setViewMode('json')}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewMode === 'json' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                        }`}
                >
                    JSON
                </button>
                {result.diarized_text && (
                    <button
                        onClick={() => setViewMode('diarized')}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${viewMode === 'diarized' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Diarized
                    </button>
                )}
                {analysisResult && (
                    <button
                        onClick={() => setViewMode('analysis')}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${viewMode === 'analysis' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Analysis
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="relative bg-slate-900 rounded-xl overflow-hidden">
                {/* Action buttons */}
                <div className="absolute top-3 right-3 flex gap-2">
                    {viewMode === 'json' && (
                        <>
                            <button
                                onClick={() => copyToClipboard(formattedJson, 'json')}
                                className="px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors flex items-center gap-1.5"
                            >
                                {copied === 'json' ? (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                        Copy JSON
                                    </>
                                )}
                            </button>
                            <button
                                onClick={downloadCleanJson}
                                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors flex items-center gap-1.5"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Clean JSON
                            </button>
                            <button
                                onClick={downloadJson}
                                className="px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-white rounded-md transition-colors flex items-center gap-1.5"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Full JSON
                            </button>
                        </>
                    )}
                    {viewMode === 'text' && (
                        <>
                            <button
                                onClick={() => copyToClipboard(result.full_text, 'text')}
                                className="px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors flex items-center gap-1.5"
                            >
                                {copied === 'text' ? (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                        Copy Text
                                    </>
                                )}
                            </button>
                            <button
                                onClick={downloadTxt}
                                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors flex items-center gap-1.5"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Download TXT
                            </button>
                        </>
                    )}
                    {viewMode === 'diarized' && result.diarized_text && (
                        <>
                            <button
                                onClick={() => copyToClipboard(result.diarized_text!, 'diarized')}
                                className="px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors flex items-center gap-1.5"
                            >
                                {copied === 'diarized' ? (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                        Copy Diarized
                                    </>
                                )}
                            </button>
                            <button
                                onClick={downloadTxt}
                                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors flex items-center gap-1.5"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Download TXT
                            </button>
                        </>
                    )}
                    {viewMode === 'analysis' && analysisResult && (
                        <button
                            onClick={() => copyToClipboard(analysisResult.content, 'analysis')}
                            className="px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors flex items-center gap-1.5"
                        >
                            {copied === 'analysis' ? (
                                <>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Copied!
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                    Copy Analysis
                                </>
                            )}
                        </button>
                    )}
                </div>

                {/* Code/text display */}
                <pre className="p-6 pt-14 overflow-x-auto text-sm max-h-96">
                    <code className={
                        viewMode === 'json' ? 'text-emerald-400' :
                            viewMode === 'diarized' ? 'text-cyan-300' :
                                viewMode === 'analysis' ? 'text-purple-300' :
                                    'text-slate-200'
                    }>
                        {viewMode === 'json' && formattedJson}
                        {viewMode === 'text' && result.full_text}
                        {viewMode === 'diarized' && result.diarized_text}
                        {viewMode === 'analysis' && analysisResult?.content}
                    </code>
                </pre>
            </div>

            {/* Analysis metadata when viewing analysis */}
            {viewMode === 'analysis' && analysisResult && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div className="p-4 bg-purple-50 rounded-lg">
                        <p className="text-purple-600 text-xs uppercase tracking-wide">AI Provider</p>
                        <p className="font-medium text-slate-800 mt-1 capitalize">{analysisResult.provider}</p>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                        <p className="text-purple-600 text-xs uppercase tracking-wide">Model</p>
                        <p className="font-medium text-slate-800 mt-1">{analysisResult.model}</p>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                        <p className="text-purple-600 text-xs uppercase tracking-wide">Analysis Type</p>
                        <p className="font-medium text-slate-800 mt-1">{getModeLabel(analysisResult.mode)}</p>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                        <p className="text-purple-600 text-xs uppercase tracking-wide">Created</p>
                        <p className="font-medium text-slate-800 mt-1">
                            {new Date(analysisResult.created_at).toLocaleTimeString()}
                        </p>
                    </div>
                </div>
            )}

            {/* Transcription Metadata (show when not viewing analysis) */}
            {viewMode !== 'analysis' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-slate-500 text-xs uppercase tracking-wide">Provider</p>
                        <p className="font-medium text-slate-800 mt-1">{result.provider}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-slate-500 text-xs uppercase tracking-wide">Model</p>
                        <p className="font-medium text-slate-800 mt-1">{result.model}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-slate-500 text-xs uppercase tracking-wide">Language</p>
                        <p className="font-medium text-slate-800 mt-1">{result.language?.toUpperCase() || 'Auto'}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-slate-500 text-xs uppercase tracking-wide">Created</p>
                        <p className="font-medium text-slate-800 mt-1">
                            {new Date(result.created_at).toLocaleTimeString()}
                        </p>
                    </div>
                </div>
            )}

            {/* AI Analysis Options */}
            <AnalysisOptions
                text={result.full_text}
                onAnalysisComplete={handleAnalysisComplete}
                onError={handleAnalysisError}
            />

            {/* Analysis Error */}
            {analysisError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                    <p className="font-medium">Analysis Failed</p>
                    <p className="mt-1 text-red-700">{analysisError}</p>
                </div>
            )}
        </div>
    );
}
