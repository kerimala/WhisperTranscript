'use client';

/**
 * Main Transcription Page
 * 
 * Single-page app: Upload → Transcribe → Download/Copy
 * Supports resumable transcription when rate limited.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import FileUploader from '@/components/FileUploader';
import ProgressIndicator from '@/components/ProgressIndicator';
import TranscriptOutput from '@/components/TranscriptOutput';
import {
    TranscriptionResult,
    TranscriptionProviderName,
    TranscriptionProviderInfo,
    isTranscriptionError,
    RateLimitInfo,
    ChunkResult,
    TranscriptionResponse,
    LocalRuntimeStatus,
} from '@/lib/types';
import {
    generateFileHash,
    saveProgress,
    loadProgress,
    clearProgress,
} from '@/lib/transcription-cache';
import { formatFileSize } from '@/utils/file-validation';
import { estimateTranscriptionCost } from '@/lib/transcription-cost';
import type {
    TranscriptionProgressSnapshot,
    TranscriptionProgressStage,
} from '@/lib/transcription-progress';

type AppState = 'idle' | 'processing' | 'complete' | 'error';
type UIProviderName = TranscriptionProviderName | 'groq_local_diarize';
type UIProviderInfo = Omit<TranscriptionProviderInfo, 'name'> & { name: UIProviderName };
type PipelineStepId = 'upload' | 'compress' | 'split' | 'transcribe' | 'diarize';

interface PipelineStep {
    id: PipelineStepId;
    label: string;
    optional?: boolean;
}

interface PipelinePlan {
    summary: string;
    steps: PipelineStep[];
}

function isUIProviderName(value: string): value is UIProviderName {
    return value === 'groq' || value === 'groq_local_diarize' || value === 'openai' || value === 'local' || value === 'openai_diarize';
}

interface ProcessingState {
    jobId: string;
    fileName: string;
    fileSize: number;
    stage: 'uploading' | 'processing' | 'complete' | 'error';
    uploadProgress?: number;
    message?: string;
    serverStage?: TranscriptionProgressStage;
    completedChunks?: number;
    totalChunks?: number;
    activeWorkers?: number;
    workerLimit?: number;
    sourceDurationSeconds?: number;
    providerName: UIProviderName;
    providerModel: string;
    startedAtMs: number;
    pipelinePlan?: PipelinePlan;
    currentPipelineStep?: PipelineStepId;
}

interface ResumeState {
    file: File;
    fileHash: string;
    completedChunks: number[];
    results: ChunkResult[];
    totalChunks: number;
    cumulativeDurationMs: number;
    detectedLanguage: string | null;
}

const FALLBACK_PROVIDERS: UIProviderInfo[] = [
    {
        name: 'groq',
        displayName: 'Groq',
        model: 'whisper-large-v3-turbo',
        supportsSpeakerDiarization: false,
        configured: false,
    },
    {
        name: 'groq_local_diarize',
        displayName: 'Groq + Local Speakers',
        model: 'whisper-large-v3-turbo + pyannote',
        supportsSpeakerDiarization: true,
        configured: false,
    },
    {
        name: 'openai',
        displayName: 'OpenAI',
        model: 'whisper-1',
        supportsSpeakerDiarization: false,
        configured: false,
    },
    {
        name: 'openai_diarize',
        displayName: 'OpenAI + Diarization',
        model: 'gpt-4o-transcribe-diarize',
        supportsSpeakerDiarization: true,
        configured: false,
    },
    {
        name: 'local',
        displayName: 'Local (Auto)',
        model: 'whisper-large-v3-turbo',
        supportsSpeakerDiarization: true,
        configured: true,
    },
];

const PROVIDER_LINKS: Record<UIProviderName, string> = {
    groq: 'https://console.groq.com/keys',
    groq_local_diarize: 'https://console.groq.com/keys',
    openai: 'https://platform.openai.com/api-keys',
    openai_diarize: 'https://platform.openai.com/api-keys',
    local: 'https://huggingface.co/pyannote/speaker-diarization-3.1',
};

const DIRECT_UPLOAD_LIMIT_BYTES = 24 * 1024 * 1024;

function buildPipelinePlan(fileSize: number, provider: UIProviderName): PipelinePlan {
    const isHybrid = provider === 'groq_local_diarize';
    const cloudSteps: PipelineStep[] = [
        { id: 'upload', label: 'Upload file' },
        { id: 'transcribe', label: provider === 'openai_diarize' ? 'Transcribe + diarize' : 'Transcribe' },
        ...(isHybrid ? [{ id: 'diarize' as const, label: 'Detect speakers locally' }] : []),
    ];

    if (provider === 'local') {
        return {
            summary: 'Local mode: file is sent to your local backend, then transcribed (and optionally diarized) on your machine.',
            steps: [
                { id: 'upload', label: 'Upload to local backend' },
                { id: 'transcribe', label: 'Transcribe locally' },
            ],
        };
    }

    if (fileSize <= DIRECT_UPLOAD_LIMIT_BYTES) {
        return {
            summary: isHybrid
                ? 'Groq transcribes first; then only speaker detection runs on this computer.'
                : 'Expected path: direct cloud upload and transcription.',
            steps: cloudSteps,
        };
    }

    return {
        summary: 'Expected path: server compresses to a smaller speech format; if still too large, it splits automatically before transcription.',
        steps: [
            { id: 'upload', label: 'Upload file' },
            { id: 'compress', label: 'Compress on server' },
            { id: 'split', label: 'Split into chunks', optional: true },
            { id: 'transcribe', label: provider === 'openai_diarize' ? 'Transcribe + diarize' : 'Transcribe' },
            ...(isHybrid ? [{ id: 'diarize' as const, label: 'Detect speakers locally' }] : []),
        ],
    };
}

function getProcessingMessage(step: PipelineStepId, provider: UIProviderName): string {
    if (step === 'upload') return 'Uploading audio file...';
    if (step === 'compress') return 'Optimizing audio size on server...';
    if (step === 'split') return 'Splitting audio into provider-safe chunks...';
    if (provider === 'openai_diarize') return 'Transcribing and diarizing speakers...';
    if (provider === 'groq_local_diarize') return 'Transcribing with Groq, then detecting speakers locally...';
    return 'Transcribing audio...';
}

function getPipelineStepForServerStage(
    stage: TranscriptionProgressStage,
    pipelinePlan: PipelinePlan
): PipelineStepId {
    if (stage === 'optimizing') return 'compress';
    if (stage === 'splitting') return 'split';
    if (stage === 'diarizing') return 'diarize';
    if (stage === 'transcribing' || stage === 'complete' || stage === 'error') return 'transcribe';

    return pipelinePlan.steps.some((step) => step.id === 'compress')
        ? 'compress'
        : 'transcribe';
}

function createProgressId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
}

function readBrowserMediaDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
        const media = document.createElement('video');
        const objectUrl = URL.createObjectURL(file);
        let settled = false;

        const finish = (duration: number | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            media.removeAttribute('src');
            media.load();
            URL.revokeObjectURL(objectUrl);
            resolve(duration);
        };

        const timeout = window.setTimeout(() => finish(null), 12_000);
        media.preload = 'metadata';
        media.onloadedmetadata = () => {
            finish(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null);
        };
        media.onerror = () => finish(null);
        media.src = objectUrl;
    });
}

interface TranscriptionHttpResponse {
    status: number;
    ok: boolean;
    data: TranscriptionResponse;
}

function postTranscriptionWithUploadProgress(
    formData: FormData,
    onUploadProgress: (loaded: number, total: number) => void,
    onUploadComplete: () => void,
    requestRef: React.MutableRefObject<XMLHttpRequest | null>
): Promise<TranscriptionHttpResponse> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        requestRef.current = xhr;

        xhr.open('POST', '/api/transcribe');
        xhr.responseType = 'text';
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
                onUploadProgress(event.loaded, event.total);
            }
        };
        xhr.upload.onload = () => onUploadComplete();
        xhr.onerror = () => reject(new Error('The upload connection failed before transcription could start.'));
        xhr.onabort = () => reject(new DOMException('Transcription cancelled.', 'AbortError'));
        xhr.onload = () => {
            const fallback: TranscriptionResponse = {
                error: true,
                message: xhr.status === 413
                    ? 'This host rejected the original upload before it reached the transcription server. Use a local/self-hosted server for large media, or configure a direct object-storage upload for this hosted deployment.'
                    : `The transcription server returned ${xhr.status} without a readable error message.`,
            };

            let data: TranscriptionResponse = fallback;
            try {
                data = JSON.parse(xhr.responseText) as TranscriptionResponse;
            } catch {
                // Keep the clear fallback message above.
            }

            resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, data });
        };
        xhr.send(formData);
    });
}

export default function Home() {
    const [state, setState] = useState<AppState>('idle');
    const [processing, setProcessing] = useState<ProcessingState | null>(null);
    const [result, setResult] = useState<TranscriptionResult | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);
    const [retryCountdown, setRetryCountdown] = useState<number>(0);
    const [resumeState, setResumeState] = useState<ResumeState | null>(null);
    const [resumeMayDuplicateCharge, setResumeMayDuplicateCharge] = useState(false);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [providers, setProviders] = useState<UIProviderInfo[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<UIProviderName>('groq');
    const [providerApiKeys, setProviderApiKeys] = useState<Record<UIProviderName, string>>({
        groq: '',
        groq_local_diarize: '',
        openai: '',
        openai_diarize: '',
        local: '',
    });
    const [localHfToken, setLocalHfToken] = useState('');
    const [hfTokenConfigured, setHfTokenConfigured] = useState(false);
    const [backendRunning, setBackendRunning] = useState<boolean | null>(null);
    const [localRuntime, setLocalRuntime] = useState<LocalRuntimeStatus | null>(null);
    const [selectedLanguage, setSelectedLanguage] = useState('auto');
    const [history, setHistory] = useState<any[]>([]);
    const [browserUploadLimitBytes, setBrowserUploadLimitBytes] = useState<number | null>(null);
    const [clockNowMs, setClockNowMs] = useState(() => Date.now());
    const uploadRequestRef = useRef<XMLHttpRequest | null>(null);
    const progressPollRef = useRef<number | null>(null);

    const providerOptions = providers.length > 0 ? providers : FALLBACK_PROVIDERS;
    const activeProvider = providerOptions.find(p => p.name === selectedProvider) || providerOptions[0];
    const processingCost = processing
        ? estimateTranscriptionCost({
            provider: processing.providerName === 'groq_local_diarize' ? 'groq' : processing.providerName,
            audioDurationSeconds: processing.sourceDurationSeconds,
        })
        : null;
    const elapsedSeconds = state === 'processing' && processing
        ? Math.max(0, Math.floor((clockNowMs - processing.startedAtMs) / 1000))
        : 0;

    const stopProgressPolling = useCallback(() => {
        if (progressPollRef.current !== null) {
            window.clearInterval(progressPollRef.current);
            progressPollRef.current = null;
        }
    }, []);

    useEffect(() => {
        return () => {
            uploadRequestRef.current?.abort();
            stopProgressPolling();
        };
    }, [stopProgressPolling]);

    useEffect(() => {
        if (state !== 'processing' || !processing?.startedAtMs) return;

        const interval = window.setInterval(() => setClockNowMs(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, [state, processing?.startedAtMs]);

    useEffect(() => {
        let active = true;

        async function loadHistory() {
            try {
                const res = await fetch('/api/transcriptions');
                if (!res.ok) return;
                const data = await res.json();
                if (active) {
                    setHistory(data.transcriptions || []);
                }
            } catch (err) {
                console.error("Failed to load history", err);
            }
        }

        void loadHistory();
        return () => { active = false; };
    }, [state]); // Reload when state changes (completed transcription)

    // Load provider metadata
    useEffect(() => {
        let active = true;

        async function fetchProviders() {
            try {
                const response = await fetch('/api/transcribe');
                if (!response.ok) return;

                const data = await response.json();
                if (!active) return;

                if (Array.isArray(data.providers)) {
                    setProviders(data.providers as UIProviderInfo[]);
                }
                if (typeof data.defaultProvider === 'string' && isUIProviderName(data.defaultProvider)) {
                    setSelectedProvider(data.defaultProvider);
                }
                if (typeof data.hfTokenConfigured === 'boolean') {
                    setHfTokenConfigured(data.hfTokenConfigured);
                }
                const upload = data.upload;
                if (
                    upload &&
                    typeof upload.browserUploadLimitBytes === 'number' &&
                    Number.isFinite(upload.browserUploadLimitBytes) &&
                    upload.browserUploadLimitBytes > 0
                ) {
                    setBrowserUploadLimitBytes(upload.browserUploadLimitBytes);
                }
            } catch {
                // Keep fallback providers
            }
        }

        fetchProviders();
        return () => {
            active = false;
        };
    }, []);

    // Check local backend health whenever local provider is selected
    useEffect(() => {
        if (selectedProvider !== 'local' && selectedProvider !== 'groq_local_diarize') return;
        let active = true;

        async function checkHealth() {
            try {
                const res = await fetch('/api/local-health');
                const data = await res.json() as LocalRuntimeStatus;
                if (active) {
                    setBackendRunning(Boolean(data.running));
                    setLocalRuntime(data);
                }
            } catch {
                if (active) {
                    setBackendRunning(false);
                    setLocalRuntime(null);
                }
            }
        }

        checkHealth();
        return () => { active = false; };
    }, [selectedProvider]);

    const handleProviderSelection = useCallback((providerName: UIProviderName) => {
        if (providerName === 'local' || providerName === 'groq_local_diarize') {
            setBackendRunning(null); // reset to "checking" before the health request
        }
        setSelectedProvider(providerName);
    }, []);

    // Countdown timer for rate limit retry
    useEffect(() => {
        if (retryCountdown <= 0) return;
        const timer = setInterval(() => {
            setRetryCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [retryCountdown]);

    // Core transcription function that handles both fresh and resume requests
    const processTranscription = useCallback(async (
        file: File,
        resumeData?: {
            skipChunks: number[];
            previousResults: ChunkResult[];
            durationOffset: number;
        }
    ) => {
        const providerApiKey = providerApiKeys[selectedProvider] || '';
        const fileHash = await generateFileHash(file);
        const progressKey = `${selectedProvider}:${fileHash}`;
        const pipelinePlan = buildPipelinePlan(file.size, selectedProvider);
        const jobId = createProgressId();
        const startedAtMs = Date.now();
        const providerModel = activeProvider?.model || 'whisper';

        stopProgressPolling();

        // Reset state
        setState('processing');
        setResult(null);
        setErrorMessage(null);
        setRateLimitInfo(null);
        setResumeMayDuplicateCharge(false);
        setPendingFile(file);

        // Upload percentages come from XMLHttpRequest.upload. Server work is
        // reported independently, so we never manufacture a halfway value.
        setProcessing({
            jobId,
            fileName: file.name,
            fileSize: file.size,
            stage: 'uploading',
            uploadProgress: 0,
            message: getProcessingMessage('upload', selectedProvider),
            completedChunks: resumeData ? resumeData.skipChunks.length : 0,
            totalChunks: resumeData ? resumeData.skipChunks.length + 1 : undefined, // Will be updated
            activeWorkers: 0,
            providerName: selectedProvider,
            providerModel,
            startedAtMs,
            pipelinePlan,
            currentPipelineStep: 'upload',
        });

        // Metadata reads do not delay the upload. When a browser can determine
        // duration locally, the cost card becomes useful immediately; the
        // server may later replace it with its ffprobe measurement.
        void readBrowserMediaDuration(file).then((sourceDurationSeconds) => {
            if (sourceDurationSeconds === null) return;
            setProcessing((previous) => previous?.jobId === jobId
                ? { ...previous, sourceDurationSeconds }
                : previous);
        });

        try {
            // Create form data
            const formData = new FormData();
            // Send this first so the server can associate its eventual phase
            // updates with the browser before the media stream is complete.
            formData.append('progressId', jobId);
            formData.append('provider', selectedProvider);
            if (providerApiKey.trim()) {
                formData.append('apiKey', providerApiKey.trim());
            }

            if (selectedLanguage !== 'auto') {
                formData.append('language', selectedLanguage);
            }

            // Local runtime and local-speaker extras
            if (selectedProvider === 'local' || selectedProvider === 'groq_local_diarize') {
                if (localHfToken.trim()) {
                    formData.append('hfToken', localHfToken.trim());
                }
            }

            // Add resume data if resuming
            if (resumeData) {
                formData.append('skipChunks', JSON.stringify(resumeData.skipChunks));
                formData.append('previousResults', JSON.stringify(resumeData.previousResults));
                formData.append('durationOffset', resumeData.durationOffset.toString());
            }
            // Keep the large streaming field last. Busboy receives the
            // progress ID before it starts writing the media to disk.
            formData.append('file', file);

            const firstServerStep: PipelineStepId =
                pipelinePlan.steps.some((step) => step.id === 'compress') ? 'compress' : 'transcribe';

            const applyServerProgress = (snapshot: TranscriptionProgressSnapshot) => {
                setProcessing((previous) => {
                    if (!previous || previous.jobId !== jobId) return previous;
                    const stage = snapshot.stage === 'complete'
                        ? 'complete'
                        : snapshot.stage === 'error'
                            ? 'error'
                            : 'processing';
                    return {
                        ...previous,
                        stage,
                        serverStage: snapshot.stage,
                        message: snapshot.message,
                        providerName: isUIProviderName(snapshot.provider || '')
                            ? snapshot.provider as UIProviderName
                            : previous.providerName,
                        providerModel: snapshot.model || previous.providerModel,
                        completedChunks: snapshot.completedChunks,
                        totalChunks: snapshot.totalChunks,
                        activeWorkers: snapshot.activeWorkers,
                        workerLimit: snapshot.workerLimit,
                        sourceDurationSeconds: snapshot.sourceDurationSeconds ?? previous.sourceDurationSeconds,
                        currentPipelineStep: getPipelineStepForServerStage(snapshot.stage, pipelinePlan),
                    };
                });
            };

            const pollProgress = async () => {
                try {
                    const progressResponse = await fetch(`/api/transcribe/progress?id=${encodeURIComponent(jobId)}`, {
                        cache: 'no-store',
                    });
                    if (!progressResponse.ok) return;
                    const snapshot = await progressResponse.json() as TranscriptionProgressSnapshot;
                    if (snapshot.id === jobId) applyServerProgress(snapshot);
                } catch {
                    // The upload request is the source of truth. A brief polling
                    // miss must not turn a viable transcription into an error.
                }
            };
            void pollProgress();
            progressPollRef.current = window.setInterval(() => {
                void pollProgress();
            }, 700);

            const response = await postTranscriptionWithUploadProgress(
                formData,
                (loaded, total) => {
                    const uploadProgress = Math.min(100, Math.round((loaded / total) * 100));
                    setProcessing((previous) => previous?.jobId === jobId
                        ? {
                            ...previous,
                            stage: 'uploading',
                            uploadProgress,
                            message: `Uploading ${formatFileSize(loaded)} of ${formatFileSize(total)}…`,
                            currentPipelineStep: 'upload',
                        }
                        : previous);
                },
                () => {
                    setProcessing((previous) => previous?.jobId === jobId
                        ? {
                            ...previous,
                            stage: 'processing',
                            uploadProgress: 100,
                            message: 'Upload complete. Waiting for the server…',
                            currentPipelineStep: firstServerStep,
                        }
                        : previous);
                },
                uploadRequestRef
            );
            uploadRequestRef.current = null;
            stopProgressPolling();
            const data = response.data;

            if (isTranscriptionError(data)) {
                // Check for rate limit with partial results
                if (data.rateLimit) {
                    setRateLimitInfo(data.rateLimit);
                    setRetryCountdown(data.rateLimit.retryAfterSeconds);
                }

                // Save partial results for resume
                if (data.partialResult) {
                    const partial = data.partialResult;

                    // Save to localStorage
                    saveProgress(
                        progressKey,
                        file.name,
                        file.size,
                        file.type,
                        partial.totalChunks,
                        partial.completedChunks,
                        partial.results,
                        partial.cumulativeDurationMs,
                        partial.detectedLanguage
                    );

                    // Store resume state
                    setResumeState({
                        file,
                        fileHash: progressKey,
                        completedChunks: partial.completedChunks,
                        results: partial.results,
                        totalChunks: partial.totalChunks,
                        cumulativeDurationMs: partial.cumulativeDurationMs,
                        detectedLanguage: partial.detectedLanguage,
                    });
                    setResumeMayDuplicateCharge(data.code === 'provider_network_error');

                    setProcessing(prev => prev ? {
                        ...prev,
                        completedChunks: partial.completedChunks.length,
                        totalChunks: partial.totalChunks,
                        activeWorkers: 0,
                        currentPipelineStep: 'transcribe',
                        message: `Saved ${partial.completedChunks.length} of ${partial.totalChunks} chunks for resume.`,
                    } : null);
                }

                throw new Error(data.message);
            }

            // Success! Clear any saved progress
            clearProgress(progressKey);
            setResumeState(null);
            setResumeMayDuplicateCharge(false);
            setPendingFile(null);

            // Success!
            const backendSummary =
                typeof (data as { pipelineSummary?: unknown }).pipelineSummary === 'string'
                    ? (data as { pipelineSummary: string }).pipelineSummary
                    : undefined;
            setProcessing(prev => prev ? {
                ...prev,
                stage: 'complete',
                message: backendSummary || 'Transcription complete!',
                serverStage: 'complete',
                completedChunks: prev.totalChunks || 1,
                activeWorkers: 0,
                currentPipelineStep: 'transcribe',
                sourceDurationSeconds: data.preparation?.source_duration_seconds ?? prev.sourceDurationSeconds,
            } : null);

            // Small delay to show completion
            await new Promise(resolve => setTimeout(resolve, 500));

            setResult(data);
            setState('complete');
            setProcessing(null);
        } catch (error) {
            stopProgressPolling();
            uploadRequestRef.current = null;
            if (error instanceof Error && error.name === 'AbortError') {
                // User cancelled - reset to idle
                setState('idle');
                setProcessing(null);
                return;
            }

            const message = error instanceof Error ? error.message : 'An unexpected error occurred';
            setErrorMessage(message);
            setState('error');
            setProcessing(prev => prev ? { ...prev, stage: 'error', message, activeWorkers: 0 } : null);
        }
    }, [
        activeProvider?.model,
        localHfToken,
        providerApiKeys,
        selectedLanguage,
        selectedProvider,
        stopProgressPolling,
    ]);

    // Handle fresh file selection
    const handleFileSelect = useCallback(async (file: File) => {
        if (browserUploadLimitBytes !== null && file.size > browserUploadLimitBytes) {
            setErrorMessage(
                `This hosted deployment can only receive uploads up to ${formatFileSize(browserUploadLimitBytes)} ` +
                `before its serverless gateway rejects them. ${formatFileSize(file.size)} was not sent. ` +
                'For a large MP4, run the app locally/self-hosted (bash dev.sh) so it can stream, compress, and split the media, or add direct object storage uploads to this hosted deployment.'
            );
            setRateLimitInfo(null);
            setResumeState(null);
            setResumeMayDuplicateCharge(false);
            setPendingFile(null);
            setProcessing(null);
            setState('error');
            return;
        }

        // Check for saved progress
        const fileHash = await generateFileHash(file);
        const progressKey = `${selectedProvider}:${fileHash}`;
        const savedProgress = loadProgress(progressKey);

        if (savedProgress && savedProgress.completedChunks.length > 0) {
            // Found saved progress - ask to resume
            setResumeState({
                file,
                fileHash: progressKey,
                completedChunks: savedProgress.completedChunks,
                results: savedProgress.results,
                totalChunks: savedProgress.totalChunks,
                cumulativeDurationMs: savedProgress.cumulativeDurationMs,
                detectedLanguage: savedProgress.detectedLanguage,
            });
            setPendingFile(file);

            // Show prompt to resume
            setErrorMessage(`Found saved progress: ${savedProgress.completedChunks.length}/${savedProgress.totalChunks} chunks completed.`);
            setRateLimitInfo(null);
            setState('error'); // Use error state to show the prompt
            return;
        }

        // No saved progress - start fresh
        await processTranscription(file);
    }, [browserUploadLimitBytes, processTranscription, selectedProvider]);

    // Handle resume button click
    const handleResume = useCallback(async () => {
        if (!resumeState) return;

        await processTranscription(resumeState.file, {
            skipChunks: resumeState.completedChunks,
            previousResults: resumeState.results,
            durationOffset: resumeState.cumulativeDurationMs,
        });
    }, [resumeState, processTranscription]);

    // Handle starting fresh (discard saved progress)
    const handleStartFresh = useCallback(async () => {
        if (!pendingFile) return;

        // Clear saved progress
        if (resumeState?.fileHash) {
            clearProgress(resumeState.fileHash);
        }
        setResumeState(null);
        setResumeMayDuplicateCharge(false);

        await processTranscription(pendingFile);
    }, [pendingFile, resumeState, processTranscription]);

    const handleCancel = useCallback(() => {
        uploadRequestRef.current?.abort();
        uploadRequestRef.current = null;
        stopProgressPolling();
        setState('idle');
        setProcessing(null);
    }, [stopProgressPolling]);

    const handleReset = useCallback(() => {
        stopProgressPolling();
        setState('idle');
        setResult(null);
        setProcessing(null);
        setErrorMessage(null);
        setRateLimitInfo(null);
        setRetryCountdown(0);
        setResumeState(null);
        setResumeMayDuplicateCharge(false);
        setPendingFile(null);
    }, [stopProgressPolling]);

    return (
        <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
            {/* Header */}
            <header className="pt-12 pb-8 px-4">
                <div className="max-w-2xl mx-auto text-center">
                    <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
                        <span className="gradient-text">Whisper</span>
                        <span className="text-slate-800"> Transcription</span>
                    </h1>
                    <p className="mt-4 text-lg text-slate-600">
                        Convert audio to text with selectable Whisper providers
                    </p>
                </div>
            </header>

            {/* Main content */}
            <div className="max-w-7xl mx-auto px-4 pb-20 flex flex-col lg:flex-row gap-6">
                {/* Left Column Container */}
                <div className="flex-1 max-w-2xl flex flex-col">
                    {/* Main app block */}
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-6 sm:p-8 w-full">
                        {state !== 'complete' && (
                            <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                <p className="text-sm font-semibold text-slate-700">Transcription Provider</p>
                                <p className="mt-1 text-xs text-slate-500">
                                    Choose a provider and optionally enter a per-request API key.
                                </p>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    {providerOptions.map((provider) => (
                                        <button
                                            key={provider.name}
                                            onClick={() => handleProviderSelection(provider.name)}
                                            disabled={state === 'processing'}
                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${selectedProvider === provider.name
                                                ? 'bg-indigo-600 text-white border-indigo-600'
                                                : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                                        >
                                            {provider.displayName}
                                        </button>
                                    ))}
                                </div>

                                {selectedProvider !== 'local' && (
                                    <div className="mt-4">
                                        <label htmlFor="providerApiKey" className="block text-xs font-medium text-slate-600 mb-1.5">
                                            API key for {activeProvider?.displayName || selectedProvider} (optional)
                                        </label>
                                        <input
                                            id="providerApiKey"
                                            type="password"
                                            value={providerApiKeys[selectedProvider] || ''}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                setProviderApiKeys(prev => ({
                                                    ...prev,
                                                    [selectedProvider]: value,
                                                }));
                                            }}
                                            disabled={state === 'processing'}
                                            placeholder={selectedProvider === 'groq' || selectedProvider === 'groq_local_diarize' ? 'gsk_...' : 'sk-...'}
                                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                        <p className="mt-2 text-xs text-slate-500">
                                            Leave blank to use the server environment key (if configured). Get a key:{' '}
                                            <a
                                                href={PROVIDER_LINKS[selectedProvider]}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-indigo-600 hover:text-indigo-700 font-medium"
                                            >
                                                {activeProvider?.displayName || selectedProvider}
                                            </a>
                                        </p>
                                    </div>
                                )}

                                {selectedProvider === 'openai_diarize' && (
                                    <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex items-start gap-2">
                                        <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>
                                            OpenAI handles transcription and speaker diarization in the cloud, so your local machine does not run hot.
                                            For very large files that are split on the server, speaker labels can restart between chunks.
                                        </span>
                                    </div>
                                )}

                                {selectedProvider === 'groq' && !activeProvider?.supportsSpeakerDiarization && (
                                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                                        <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>
                                            Groq provides fast transcription and timestamps, but its current hosted speech models do not return speaker labels.
                                            Choose OpenAI + Diarization or Local (Metal) when you need speaker separation.
                                        </span>
                                    </div>
                                )}

                                {selectedProvider === 'groq_local_diarize' && (
                                    <div className="mt-4 space-y-3">
                                        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                                            <span className="font-semibold">Recommended speaker workflow:</span>{' '}
                                            Groq creates the transcript and word timestamps first. This computer then runs only pyannote speaker detection—local Whisper is skipped.
                                        </div>

                                        {backendRunning === null && (
                                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                                                Checking local speaker service…
                                            </div>
                                        )}
                                        {backendRunning === true && (
                                            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                                                ✓ Local speaker service is ready
                                            </div>
                                        )}
                                        {backendRunning === false && (
                                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                                Local speaker service is not running. Start WhisperForFiles with <code className="font-mono font-semibold">bash dev.sh</code> on Mac or the normal Desktop shortcut on Windows.
                                            </div>
                                        )}

                                        {!hfTokenConfigured && (
                                            <div>
                                                <label htmlFor="hybridHfToken" className="mb-1.5 block text-xs font-medium text-slate-600">
                                                    Hugging Face token for speaker detection
                                                </label>
                                                <input
                                                    id="hybridHfToken"
                                                    type="password"
                                                    value={localHfToken}
                                                    onChange={(event) => setLocalHfToken(event.target.value)}
                                                    disabled={state === 'processing'}
                                                    placeholder="hf_…"
                                                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
                                                />
                                                <p className="mt-1.5 text-xs text-slate-500">
                                                    Saved only when you add <code className="font-mono">HF_TOKEN</code> to <code className="font-mono">.env.local</code>; otherwise this is used for the current request.
                                                </p>
                                            </div>
                                        )}
                                        {hfTokenConfigured && (
                                            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                                                ✓ Speaker detection token configured
                                            </div>
                                        )}
                                    </div>
                                )}

                                {selectedProvider === 'local' && (
                                    <div className="mt-4 space-y-3">
                                        {/* Backend status */}
                                        {backendRunning === null && (
                                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 flex items-center gap-2">
                                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                                </svg>
                                                Checking backend…
                                            </div>
                                        )}
                                        {backendRunning === true && localRuntime?.available !== false && (
                                            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 flex items-center gap-2">
                                                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                                <span>
                                                    Backend server is running
                                                    {localRuntime?.engine && (
                                                        <span className="block text-green-700 mt-0.5">
                                                            {localRuntime.engine.display_name} · {localRuntime.engine.device} · {localRuntime.engine.compute_type}
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        {backendRunning === true && localRuntime?.available === false && (
                                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                                                <div className="font-medium">Backend running, but no local engine is ready</div>
                                                <p>
                                                    Detected profile: <code className="font-mono font-semibold">{localRuntime.recommendedProfile}</code>
                                                </p>
                                                {localRuntime.candidates?.map(candidate => candidate.reason && (
                                                    <p key={candidate.id} className="text-amber-800">
                                                        <code className="font-mono">{candidate.id}</code>: {candidate.reason}
                                                    </p>
                                                ))}
                                            </div>
                                        )}
                                        {backendRunning === false && (
                                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                                                <div className="flex items-center gap-2 font-medium">
                                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    Backend not running
                                                </div>
                                                <p>Start it with: <code className="font-mono font-semibold">whisper</code> or <code className="font-mono font-semibold">bash dev.sh</code></p>
                                                <button
                                                    onClick={() => {
                                                        setBackendRunning(null);
                                                        fetch('/api/local-health')
                                                            .then(r => r.json())
                                                            .then((d: LocalRuntimeStatus) => {
                                                                setBackendRunning(Boolean(d.running));
                                                                setLocalRuntime(d);
                                                            })
                                                            .catch(() => setBackendRunning(false));
                                                    }}
                                                    className="text-amber-700 underline hover:text-amber-900"
                                                >
                                                    Check again
                                                </button>
                                            </div>
                                        )}

                                        {/* HuggingFace token */}
                                        {hfTokenConfigured ? (
                                            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 flex items-center gap-2">
                                                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                                Speaker diarization active
                                                <span className="text-green-600">(HF_TOKEN set in .env.local)</span>
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5">
                                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
                                                    <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <span>
                                                        No HuggingFace token — speaker diarization will be skipped.
                                                        Enter a token below or add <code className="font-mono font-semibold">HF_TOKEN=hf_…</code> to <code className="font-mono">.env.local</code>.
                                                    </span>
                                                </div>
                                                <input
                                                    id="hfToken"
                                                    type="password"
                                                    value={localHfToken}
                                                    onChange={(e) => setLocalHfToken(e.target.value)}
                                                    disabled={state === 'processing'}
                                                    placeholder="hf_… (paste token for this session)"
                                                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                />
                                            </div>
                                        )}

                                        {/* Language selection */}
                                        <div>
                                            <label htmlFor="languageSelect" className="block text-xs font-medium text-slate-600 mb-1.5">
                                                Audio language
                                            </label>
                                            <select
                                                id="languageSelect"
                                                value={selectedLanguage}
                                                onChange={(e) => setSelectedLanguage(e.target.value)}
                                                disabled={state === 'processing'}
                                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <option value="auto">Auto-detect</option>
                                                <option value="de">🇩🇪 German (Deutsch)</option>
                                                <option value="en">🇬🇧 English</option>
                                                <option value="fr">🇫🇷 French (Français)</option>
                                                <option value="es">🇪🇸 Spanish (Español)</option>
                                                <option value="it">🇮🇹 Italian (Italiano)</option>
                                                <option value="pt">🇵🇹 Portuguese (Português)</option>
                                                <option value="nl">🇳🇱 Dutch (Nederlands)</option>
                                                <option value="pl">🇵🇱 Polish (Polski)</option>
                                                <option value="tr">🇹🇷 Turkish (Türkçe)</option>
                                                <option value="ru">🇷🇺 Russian (Русский)</option>
                                                <option value="ja">🇯🇵 Japanese (日本語)</option>
                                                <option value="zh">🇨🇳 Chinese (中文)</option>
                                                <option value="ko">🇰🇷 Korean (한국어)</option>
                                                <option value="ar">🇸🇦 Arabic (العربية)</option>
                                            </select>
                                            <p className="mt-2 text-xs text-slate-500">
                                                Setting the language explicitly to the <span className="font-semibold">language spoken in the audio</span> improves accuracy and speed.
                                                <br className="my-1" />
                                                <span className="text-amber-600/90 font-medium">Note: Selecting a different language than the audio (e.g., setting English for a German audio file) forces Whisper to translate it into the selected language.</span>
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Idle state - show uploader */}
                        {state === 'idle' && (
                            <FileUploader onFileSelect={handleFileSelect} />
                        )}

                        {/* Processing state - show progress */}
                        {state === 'processing' && processing && (
                            <ProgressIndicator
                                fileName={processing.fileName}
                                fileSize={processing.fileSize}
                                stage={processing.stage}
                                uploadProgress={processing.uploadProgress}
                                serverStage={processing.serverStage}
                                message={processing.message}
                                completedChunks={processing.completedChunks}
                                totalChunks={processing.totalChunks}
                                activeWorkers={processing.activeWorkers}
                                workerLimit={processing.workerLimit}
                                providerName={processing.providerName}
                                providerModel={processing.providerModel}
                                elapsedSeconds={elapsedSeconds}
                                costEstimate={processingCost!}
                                pipelineSummary={processing.pipelinePlan?.summary}
                                pipelineSteps={processing.pipelinePlan?.steps}
                                currentPipelineStep={processing.currentPipelineStep}
                                onCancel={handleCancel}
                            />
                        )}

                        {/* Error state */}
                        {state === 'error' && (
                            <div className="text-center py-8">
                                <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
                                    {rateLimitInfo || resumeState ? (
                                        <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    ) : (
                                        <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    )}
                                </div>
                                <h2 className="text-xl font-semibold text-slate-800 mb-2">
                                    {resumeState ? 'Resume Available' : rateLimitInfo ? 'Rate Limit Reached' : 'Transcription Failed'}
                                </h2>
                                <p className="text-slate-600 mb-4">{errorMessage}</p>

                                {/* Progress saved indicator */}
                                {resumeState && (
                                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 text-left max-w-md mx-auto">
                                        <div className="flex items-center gap-2 mb-2">
                                            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <span className="text-sm font-medium text-green-800">Progress Saved</span>
                                        </div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm text-green-700">Chunks completed</span>
                                            <span className="text-sm font-medium text-green-800">
                                                {resumeState.completedChunks.length} / {resumeState.totalChunks}
                                            </span>
                                        </div>
                                        <div className="w-full bg-green-200 rounded-full h-2.5">
                                            <div
                                                className="bg-green-500 h-2.5 rounded-full transition-all"
                                                style={{ width: `${(resumeState.completedChunks.length / resumeState.totalChunks) * 100}%` }}
                                            />
                                        </div>
                                        {resumeMayDuplicateCharge && (
                                            <p className="mt-3 text-xs text-amber-800">
                                                Billing note: the failed chunk has an unknown provider outcome. Resuming may submit that chunk again; starting fresh resubmits every chunk. Either choice can add charges.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Rate limit details */}
                                {rateLimitInfo && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-left max-w-md mx-auto">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-amber-800">API Usage</span>
                                            <span className="text-sm text-amber-700">
                                                {rateLimitInfo.used} / {rateLimitInfo.limit} seconds
                                            </span>
                                        </div>
                                        <div className="w-full bg-amber-200 rounded-full h-2.5 mb-3">
                                            <div
                                                className="bg-amber-500 h-2.5 rounded-full transition-all"
                                                style={{ width: `${Math.min(rateLimitInfo.percentUsed, 100)}%` }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-amber-700">
                                                {rateLimitInfo.percentUsed}% used this hour
                                            </span>
                                            {retryCountdown > 0 && (
                                                <span className="font-medium text-amber-800">
                                                    Ready in {Math.floor(retryCountdown / 60)}:{(retryCountdown % 60).toString().padStart(2, '0')}
                                                </span>
                                            )}
                                        </div>
                                        {retryCountdown === 0 && rateLimitInfo && (
                                            <p className="mt-2 text-sm text-green-700 font-medium">
                                                ✓ You can try again now!
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                    {resumeState && (
                                        <button
                                            onClick={handleResume}
                                            disabled={retryCountdown > 0}
                                            className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            {resumeMayDuplicateCharge ? 'Resume unconfirmed chunk' : `Resume (${resumeState.totalChunks - resumeState.completedChunks.length} chunks left)`}
                                        </button>
                                    )}
                                    {resumeState && (
                                        <button
                                            onClick={handleStartFresh}
                                            className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors"
                                        >
                                            {resumeMayDuplicateCharge ? 'Start fresh (all chunks)' : 'Start Fresh'}
                                        </button>
                                    )}
                                    {!resumeState && (
                                        <button
                                            onClick={handleReset}
                                            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
                                        >
                                            Try Again
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Complete state - show results */}
                        {state === 'complete' && result && (
                            <TranscriptOutput result={result} onReset={handleReset} />
                        )}
                    </div>

                    {/* Footer info */}
                    <div className="mt-8 text-center text-sm text-slate-500">
                        <p>
                            Selected provider:{' '}
                            {selectedProvider === 'local' ? (
                                <span className="text-indigo-600 font-medium">
                                    {localRuntime?.engine?.display_name || activeProvider?.displayName || selectedProvider}
                                </span>
                            ) : (
                                <a
                                    href={PROVIDER_LINKS[selectedProvider]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 hover:text-indigo-700 font-medium"
                                >
                                    {activeProvider?.displayName || selectedProvider}
                                </a>
                            )}
                            {' '}• Model:{' '}
                            <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs font-mono">
                                {selectedProvider === 'local'
                                    ? localRuntime?.engine?.model || activeProvider?.model || 'whisper'
                                    : activeProvider?.model || 'whisper'}
                            </code>
                        </p>
                    </div>
                </div>

                {/* History Sidebar */}
                {state === 'idle' && (
                    <div className="w-full lg:w-80 shrink-0">
                        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-6 sm:p-8 sticky top-6 max-h-[calc(100vh-48px)] flex flex-col">
                            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Recent Transcriptions
                            </h2>

                            <div className="overflow-y-auto pr-2 flex-1 flex flex-col gap-3">
                                {history.length === 0 ? (
                                    <p className="text-sm text-slate-500 italic text-center py-4">No saved transcriptions yet.</p>
                                ) : (
                                    history.map((item) => (
                                        <button
                                            key={item.fileName}
                                            onClick={async () => {
                                                try {
                                                    const res = await fetch(`/api/transcriptions/${item.fileName}`);
                                                    if (res.ok) {
                                                        const data = await res.json();
                                                        setResult(data);
                                                        setState('complete');
                                                    }
                                                } catch (err) {
                                                    console.error("Failed to load past transcription:", err);
                                                }
                                            }}
                                            className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group flex flex-col gap-1"
                                        >
                                            <div className="font-medium text-slate-700 text-sm truncate group-hover:text-indigo-700">
                                                {item.originalName}
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-slate-500">
                                                <span>{new Date(item.created_at).toLocaleDateString()}</span>
                                                <span>{(item.sizeBytes / 1024).toFixed(1)} KB</span>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main >
    );
}
