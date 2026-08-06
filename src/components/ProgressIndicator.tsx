'use client';

/**
 * ProgressIndicator Component
 * 
 * Shows upload/processing progress with cancel option.
 */

import React from 'react';
import { formatFileSize } from '@/utils/file-validation';

type PipelineStepId = 'upload' | 'compress' | 'split' | 'transcribe';

interface ProgressIndicatorProps {
    fileName: string;
    fileSize: number;
    stage: 'uploading' | 'processing' | 'complete' | 'error';
    progress: number; // 0-100
    currentChunk?: number;
    totalChunks?: number;
    message?: string;
    pipelineSummary?: string;
    pipelineSteps?: Array<{
        id: PipelineStepId;
        label: string;
        optional?: boolean;
    }>;
    currentPipelineStep?: PipelineStepId;
    onCancel?: () => void;
}

export default function ProgressIndicator({
    fileName,
    fileSize,
    stage,
    progress,
    currentChunk,
    totalChunks,
    message,
    pipelineSummary,
    pipelineSteps,
    currentPipelineStep,
    onCancel,
}: ProgressIndicatorProps) {
    const getStageColor = () => {
        switch (stage) {
            case 'complete': return 'bg-emerald-500';
            case 'error': return 'bg-red-500';
            default: return 'bg-indigo-500';
        }
    };

    const getStageIcon = () => {
        switch (stage) {
            case 'uploading':
                return (
                    <svg className="w-5 h-5 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                );
            case 'processing':
                return (
                    <svg className="w-5 h-5 animate-pulse text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                );
            case 'complete':
                return (
                    <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
            case 'error':
                return (
                    <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
        }
    };

    const getStatusText = () => {
        if (message) return message;

        switch (stage) {
            case 'uploading':
                return 'Uploading...';
            case 'processing':
                if (totalChunks && totalChunks > 1) {
                    return `Processing chunk ${currentChunk || 1} of ${totalChunks}...`;
                }
                return 'Transcribing audio...';
            case 'complete':
                return 'Transcription complete!';
            case 'error':
                return 'An error occurred';
        }
    };

    const activeStepIndex = pipelineSteps?.findIndex((step) => step.id === currentPipelineStep) ?? -1;
    const hasPipeline = Boolean(pipelineSteps && pipelineSteps.length > 0);
    const isStepDone = (index: number): boolean => {
        if (stage === 'complete') return true;
        if (activeStepIndex === -1) return false;
        return index < activeStepIndex;
    };
    const isStepActive = (index: number): boolean => {
        if (stage === 'complete') return false;
        if (activeStepIndex === -1) return index === 0 && stage !== 'error';
        return index === activeStepIndex;
    };

    return (
        <div className="w-full p-6 bg-white rounded-2xl shadow-sm border border-slate-200">
            {/* File info */}
            <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                    </div>
                    <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{fileName}</p>
                        <p className="text-sm text-slate-500">{formatFileSize(fileSize)}</p>
                    </div>
                </div>

                {/* Cancel button */}
                {(stage === 'uploading' || stage === 'processing') && onCancel && (
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label="Cancel transcription"
                    >
                        Cancel
                    </button>
                )}
            </div>

            {/* Progress bar */}
            <div className="mb-3">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full ${getStageColor()} transition-all duration-300 ease-out`}
                        style={{ width: `${progress}%` }}
                        role="progressbar"
                        aria-valuenow={progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    />
                </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
                {getStageIcon()}
                <span className={`text-sm ${stage === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
                    {getStatusText()}
                </span>
                <span className="ml-auto text-sm font-medium text-slate-700">
                    {progress}%
                </span>
            </div>

            {hasPipeline && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    {pipelineSummary && (
                        <p className="text-xs text-slate-600 mb-2">{pipelineSummary}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                        {pipelineSteps!.map((step, index) => (
                            <React.Fragment key={step.id}>
                                <span
                                    className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium ${
                                        isStepDone(index)
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : isStepActive(index)
                                                ? 'bg-indigo-100 text-indigo-800'
                                                : 'bg-white text-slate-600'
                                    }`}
                                >
                                    {step.label}
                                    {step.optional ? ' (if needed)' : ''}
                                </span>
                                {index < pipelineSteps!.length - 1 && (
                                    <span className="text-slate-400 text-xs">→</span>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
