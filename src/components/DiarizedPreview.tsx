'use client';

import React, { useMemo } from 'react';
import { TranscriptSegment } from '@/lib/types';
import {
    buildSpeakerTurns,
    formatTranscriptTime,
    summarizeSpeakers,
} from '@/lib/diarized-preview';

interface DiarizedPreviewProps {
    segments: TranscriptSegment[];
}

const SPEAKER_STYLES = [
    {
        avatar: 'bg-indigo-600 text-white',
        bubble: 'border-indigo-100 bg-indigo-50/80',
        label: 'text-indigo-700',
        bar: 'bg-indigo-500',
    },
    {
        avatar: 'bg-cyan-600 text-white',
        bubble: 'border-cyan-100 bg-cyan-50/80',
        label: 'text-cyan-700',
        bar: 'bg-cyan-500',
    },
    {
        avatar: 'bg-amber-500 text-white',
        bubble: 'border-amber-100 bg-amber-50/80',
        label: 'text-amber-700',
        bar: 'bg-amber-500',
    },
    {
        avatar: 'bg-rose-500 text-white',
        bubble: 'border-rose-100 bg-rose-50/80',
        label: 'text-rose-700',
        bar: 'bg-rose-500',
    },
    {
        avatar: 'bg-emerald-600 text-white',
        bubble: 'border-emerald-100 bg-emerald-50/80',
        label: 'text-emerald-700',
        bar: 'bg-emerald-500',
    },
    {
        avatar: 'bg-violet-600 text-white',
        bubble: 'border-violet-100 bg-violet-50/80',
        label: 'text-violet-700',
        bar: 'bg-violet-500',
    },
] as const;

function initialsForSpeaker(speaker: string): string {
    const cleaned = speaker.replace(/^speaker[\s_-]*/i, '').trim();
    return (cleaned || speaker).slice(0, 2).toUpperCase();
}

export default function DiarizedPreview({ segments }: DiarizedPreviewProps) {
    const turns = useMemo(() => buildSpeakerTurns(segments), [segments]);
    const summaries = useMemo(() => summarizeSpeakers(segments), [segments]);
    const speakerOrder = useMemo(
        () => Array.from(new Set(turns.map((turn) => turn.speaker))),
        [turns]
    );
    const speakerIndex = useMemo(
        () => new Map(speakerOrder.map((speaker, index) => [speaker, index])),
        [speakerOrder]
    );
    const durationMs = segments.reduce(
        (maximum, segment) => Math.max(maximum, segment.end_ms || 0),
        0
    );

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
            <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.36-1.86M17 20H7m10 0v-2c0-.66-.13-1.28-.36-1.86M7 20H2v-2a3 3 0 015.36-1.86M7 20v-2c0-.66.13-1.28.36-1.86m0 0a5 5 0 019.28 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </span>
                            Conversation preview
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                            {speakerOrder.length} speaker{speakerOrder.length === 1 ? '' : 's'} · {turns.length} turns · {formatTranscriptTime(durationMs)}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {speakerOrder.map((speaker, index) => {
                            const style = SPEAKER_STYLES[index % SPEAKER_STYLES.length];
                            return (
                                <span key={speaker} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm">
                                    <span className={`h-2 w-2 rounded-full ${style.bar}`} />
                                    Speaker {speaker}
                                </span>
                            );
                        })}
                    </div>
                </div>

                {summaries.length > 0 && (
                    <div className="mt-5">
                        <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-400">
                            <span>Speaking time</span>
                            <span>{formatTranscriptTime(summaries.reduce((sum, item) => sum + item.durationMs, 0))} detected speech</span>
                        </div>
                        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-label="Speaking time distribution">
                            {summaries.map((summary) => {
                                const index = speakerIndex.get(summary.speaker) || 0;
                                const style = SPEAKER_STYLES[index % SPEAKER_STYLES.length];
                                return (
                                    <div
                                        key={summary.speaker}
                                        className={`${style.bar} first:rounded-l-full last:rounded-r-full`}
                                        style={{ width: `${summary.percentage}%` }}
                                        title={`Speaker ${summary.speaker}: ${Math.round(summary.percentage)}%`}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <div className="max-h-[38rem] space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
                {turns.map((turn, index) => {
                    const colorIndex = speakerIndex.get(turn.speaker) || 0;
                    const style = SPEAKER_STYLES[colorIndex % SPEAKER_STYLES.length];
                    const alignRight = colorIndex % 2 === 1;

                    return (
                        <article
                            key={`${turn.startMs ?? index}-${turn.speaker}-${index}`}
                            className={`flex items-start gap-3 ${alignRight ? 'flex-row-reverse' : ''}`}
                        >
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold shadow-sm ${style.avatar}`}>
                                {initialsForSpeaker(turn.speaker)}
                            </div>
                            <div className={`max-w-[88%] sm:max-w-[78%] ${alignRight ? 'text-right' : ''}`}>
                                <div className={`mb-1.5 flex items-center gap-2 text-xs ${alignRight ? 'justify-end' : ''}`}>
                                    <span className={`font-semibold ${style.label}`}>Speaker {turn.speaker}</span>
                                    <span className="font-mono text-[11px] text-slate-400">
                                        {formatTranscriptTime(turn.startMs)}
                                    </span>
                                </div>
                                <div className={`rounded-2xl border px-4 py-3 text-left text-sm leading-6 text-slate-700 shadow-sm ${style.bubble} ${alignRight ? 'rounded-tr-md' : 'rounded-tl-md'}`}>
                                    {turn.text}
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
}
