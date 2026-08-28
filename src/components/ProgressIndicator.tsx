'use client';

/**
 * A transcription job is a long-running process, not a loading spinner. This
 * panel exposes the real boundary between browser upload and server work, then
 * switches to completed-chunk progress when the server can measure it.
 */

import React from 'react';
import { formatFileSize } from '@/utils/file-validation';
import type { TranscriptionCostEstimate } from '@/lib/transcription-cost';
import type { TranscriptionProgressStage } from '@/lib/transcription-progress';

type PipelineStepId = 'upload' | 'compress' | 'split' | 'transcribe';

interface ProgressIndicatorProps {
    fileName: string;
    fileSize: number;
    stage: 'uploading' | 'processing' | 'complete' | 'error';
    uploadProgress?: number;
    serverStage?: TranscriptionProgressStage;
    completedChunks?: number;
    totalChunks?: number;
    activeWorkers?: number;
    workerLimit?: number;
    message?: string;
    providerName: string;
    providerModel: string;
    elapsedSeconds: number;
    costEstimate: TranscriptionCostEstimate;
    pipelineSummary?: string;
    pipelineSteps?: Array<{
        id: PipelineStepId;
        label: string;
        optional?: boolean;
    }>;
    currentPipelineStep?: PipelineStepId;
    onCancel?: () => void;
}

function formatElapsed(seconds: number): string {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getStageLabel(stage: ProgressIndicatorProps['stage'], serverStage?: TranscriptionProgressStage): string {
    if (stage === 'uploading') return 'Uploading from this browser';
    if (stage === 'complete') return 'Complete';
    if (stage === 'error') return 'Needs attention';

    switch (serverStage) {
        case 'received': return 'Received by server';
        case 'optimizing': return 'Optimizing audio';
        case 'splitting': return 'Preparing chunks';
        case 'transcribing': return 'Transcribing';
        default: return 'Working on server';
    }
}

function getStatusIcon(stage: ProgressIndicatorProps['stage']) {
    if (stage === 'complete') {
        return (
            <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 12 2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        );
    }
    if (stage === 'error') {
        return (
            <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        );
    }

    return (
        <svg className="h-5 w-5 animate-pulse motion-reduce:animate-none text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h2l2-5 4 10 2-5h6" />
        </svg>
    );
}

export default function ProgressIndicator({
    fileName,
    fileSize,
    stage,
    uploadProgress,
    serverStage,
    completedChunks = 0,
    totalChunks,
    activeWorkers,
    workerLimit,
    message,
    providerName,
    providerModel,
    elapsedSeconds,
    costEstimate,
    pipelineSummary,
    pipelineSteps,
    currentPipelineStep,
    onCancel,
}: ProgressIndicatorProps) {
    const isUploading = stage === 'uploading';
    const hasMeasuredChunkProgress = stage === 'processing' && Boolean(totalChunks && totalChunks > 1);
    const isComplete = stage === 'complete';
    const progressValue = isComplete
        ? 100
        : isUploading
            ? Math.min(100, Math.max(0, uploadProgress || 0))
            : hasMeasuredChunkProgress && totalChunks
                ? Math.round((Math.min(completedChunks, totalChunks) / totalChunks) * 100)
                : undefined;
    const isIndeterminate = progressValue === undefined && stage === 'processing';
    const statusLabel = getStageLabel(stage, serverStage);
    const activeStepIndex = pipelineSteps?.findIndex((step) => step.id === currentPipelineStep) ?? -1;
    const workerLabel = activeWorkers === undefined
        ? 'Waiting for server'
        : workerLimit && workerLimit > 1
            ? `${activeWorkers} of ${workerLimit} active`
            : activeWorkers > 0
                ? '1 active'
                : 'Waiting';

    const isStepDone = (index: number): boolean => {
        if (isComplete) return true;
        return activeStepIndex > index;
    };
    const isStepActive = (index: number): boolean => {
        if (isComplete || stage === 'error') return false;
        if (activeStepIndex === -1) return index === 0;
        return activeStepIndex === index;
    };

    return (
        <section className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="job-status-heading">
            <div className="border-b border-slate-100 bg-[linear-gradient(110deg,rgba(238,242,255,0.95),rgba(255,255,255,0.98),rgba(236,254,255,0.8))] px-5 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-200">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2Zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2ZM9 10l12-3" />
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-indigo-700">Live transcription</p>
                            <h2 id="job-status-heading" className="truncate font-semibold text-slate-900">{fileName}</h2>
                            <p className="mt-0.5 text-sm text-slate-500">{formatFileSize(fileSize)}</p>
                        </div>
                    </div>
                    {(stage === 'uploading' || stage === 'processing') && onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </div>

            <div className="p-5 sm:p-6">
                <div className="flex items-start gap-3" role="status" aria-live="polite" aria-atomic="true">
                    <div className="mt-0.5 shrink-0">{getStatusIcon(stage)}</div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{statusLabel}</p>
                        <p className={`mt-0.5 text-sm leading-5 ${stage === 'error' ? 'text-red-700' : 'text-slate-600'}`}>
                            {message || 'Preparing transcription…'}
                        </p>
                    </div>
                </div>

                <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold tracking-wide text-slate-600">
                        <span>
                            {isUploading
                                ? 'Browser upload'
                                : hasMeasuredChunkProgress && totalChunks
                                    ? `Completed chunks ${completedChunks} / ${totalChunks}`
                                    : isComplete
                                        ? 'Transcription finished'
                                        : 'Server processing'}
                        </span>
                        <span className="tabular-nums text-slate-800">
                            {progressValue === undefined ? 'Live status' : `${progressValue}%`}
                        </span>
                    </div>
                    <div
                        className="h-2.5 overflow-hidden rounded-full bg-slate-100"
                        role="progressbar"
                        aria-label={isUploading ? 'Upload progress' : 'Transcription progress'}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        {...(progressValue === undefined ? {} : { 'aria-valuenow': progressValue })}
                        aria-valuetext={progressValue === undefined
                            ? 'Progress is being measured while the server works.'
                            : `${progressValue}% complete`}
                    >
                        {isIndeterminate ? (
                            <div className="progress-indeterminate h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500" />
                        ) : (
                            <div
                                className={`h-full rounded-full transition-[width] duration-300 ease-out ${stage === 'error'
                                    ? 'bg-red-500'
                                    : isComplete
                                        ? 'bg-emerald-500'
                                        : 'bg-gradient-to-r from-indigo-600 to-cyan-500'}`}
                                style={{ width: `${progressValue || 0}%` }}
                            />
                        )}
                    </div>
                    {isIndeterminate && (
                        <p className="mt-2 text-xs text-slate-500">
                            This phase has no truthful percentage yet. The status will update when the server has measurable work.
                        </p>
                    )}
                </div>

                <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 sm:grid-cols-4">
                    <div className="border-b border-r border-slate-200 px-3 py-3 sm:border-b-0">
                        <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Elapsed</dt>
                        <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-800">{formatElapsed(elapsedSeconds)}</dd>
                    </div>
                    <div className="border-b border-slate-200 px-3 py-3 sm:border-b-0 sm:border-r">
                        <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Provider</dt>
                        <dd className="mt-1 truncate text-sm font-semibold text-slate-800" title={providerModel}>{providerName}</dd>
                        <dd className="truncate text-[11px] text-slate-500" title={providerModel}>{providerModel}</dd>
                    </div>
                    <div className="border-r border-slate-200 px-3 py-3">
                        <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Workers</dt>
                        <dd className="mt-1 text-sm font-semibold text-slate-800">{workerLabel}</dd>
                        {totalChunks && totalChunks > 1 && (
                            <dd className="text-[11px] text-slate-500">{completedChunks} / {totalChunks} chunks done</dd>
                        )}
                    </div>
                    <div className="px-3 py-3">
                        <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">API cost</dt>
                        <dd className="mt-1 text-sm font-semibold text-slate-800">{costEstimate.label.replace(/^Estimated API (?:list )?price:\s*/i, '').replace(/^Estimated API cost:\s*/i, '')}</dd>
                        <dd className="line-clamp-2 text-[11px] leading-4 text-slate-500" title={costEstimate.detail}>
                            {costEstimate.status === 'unavailable'
                                ? costEstimate.pricingUnit === 'tokens'
                                    ? 'Token-priced; usage pending'
                                    : 'Waiting for duration'
                                : costEstimate.status === 'free'
                                    ? 'No cloud API call'
                                    : costEstimate.status === 'usage_based'
                                        ? 'Calculated from usage'
                                        : 'List-price estimate'}
                        </dd>
                    </div>
                </dl>

                {costEstimate.sourceUrl && (
                    <p className="mt-2 text-xs text-slate-500">
                        <a className="underline decoration-slate-300 underline-offset-2 hover:text-indigo-700" href={costEstimate.sourceUrl} target="_blank" rel="noreferrer">
                            Pricing basis
                        </a>{' '}
                        · {costEstimate.detail}
                    </p>
                )}

                {pipelineSteps && pipelineSteps.length > 0 && (
                    <div className="mt-5 border-t border-slate-100 pt-4">
                        {pipelineSummary && <p className="mb-3 text-xs leading-5 text-slate-500">{pipelineSummary}</p>}
                        <ol className="grid gap-2 sm:grid-cols-2">
                            {pipelineSteps.map((step, index) => {
                                const done = isStepDone(index);
                                const active = isStepActive(index);
                                return (
                                    <li key={step.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${done
                                        ? 'bg-emerald-50 text-emerald-800'
                                        : active
                                            ? 'bg-indigo-50 text-indigo-800'
                                            : 'text-slate-500'}`}>
                                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done
                                            ? 'bg-emerald-600 text-white'
                                            : active
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-slate-100 text-slate-500'}`}>
                                            {done ? '✓' : index + 1}
                                        </span>
                                        <span className="font-medium">{step.label}{step.optional ? ' when needed' : ''}</span>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                )}
            </div>
        </section>
    );
}
