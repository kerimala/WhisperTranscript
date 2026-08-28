'use client';

/**
 * FileUploader Component
 * 
 * Drag & drop file upload with validation and accessibility.
 * Large files are streamed, optimized, and split by compatible servers.
 */

import React, { useCallback, useState, useRef } from 'react';
import { getAcceptedFileTypes, formatFileSize, isValidFileType } from '@/utils/file-validation';
import { SUPPORTED_EXTENSIONS } from '@/lib/types';

interface FileUploaderProps {
    onFileSelect: (file: File) => void;
    disabled?: boolean;
}

export default function FileUploader({ onFileSelect, disabled = false }: FileUploaderProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback((file: File) => {
        setError(null);

        // File-size policy belongs to the selected server. Large media is
        // preflighted by the app when the host publishes an ingress limit.
        if (!isValidFileType(file)) {
            setError(`Unsupported file type. Please use: ${SUPPORTED_EXTENSIONS.join(', ')}`);
            return;
        }

        // Check for empty file
        if (file.size === 0) {
            setError('File is empty. Please select a valid audio file.');
            return;
        }

        onFileSelect(file);
    }, [onFileSelect]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) {
            setIsDragging(true);
        }
    }, [disabled]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (disabled) return;

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    }, [disabled, handleFile]);

    const handleClick = useCallback(() => {
        if (!disabled) {
            fileInputRef.current?.click();
        }
    }, [disabled]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            fileInputRef.current?.click();
        }
    }, [disabled]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFile(files[0]);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
    }, [handleFile]);

    return (
        <div className="w-full">
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept={getAcceptedFileTypes()}
                onChange={handleInputChange}
                className="hidden"
                aria-hidden="true"
                disabled={disabled}
            />

            {/* Drop zone */}
            <div
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-label="Upload audio file. Click or drag and drop."
                aria-disabled={disabled}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
          relative w-full min-h-[200px] p-8 rounded-2xl border-2 border-dashed
          flex flex-col items-center justify-center gap-4
          transition-all duration-200 cursor-pointer
          ${disabled
                        ? 'bg-gray-100 border-gray-300 cursor-not-allowed opacity-60'
                        : isDragging
                            ? 'bg-indigo-50 border-indigo-400 scale-[1.02]'
                            : 'bg-gradient-to-br from-slate-50 to-slate-100 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50'
                    }
          focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
        `}
            >
                {/* Upload icon */}
                <div className={`
          w-16 h-16 rounded-full flex items-center justify-center
          ${isDragging ? 'bg-indigo-100' : 'bg-white shadow-sm'}
          transition-all duration-200
        `}>
                    <svg
                        className={`w-8 h-8 ${isDragging ? 'text-indigo-600' : 'text-slate-500'}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                    </svg>
                </div>

                {/* Text */}
                <div className="text-center">
                    <p className="text-lg font-medium text-slate-700">
                        {isDragging ? 'Drop your audio file here' : 'Drag & drop your audio file'}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                        or <span className="text-indigo-600 font-medium">browse</span> to choose a file
                    </p>
                </div>

                {/* Format info */}
                <div className="text-xs text-slate-400 text-center">
                    <p>Supported: {SUPPORTED_EXTENSIONS.map(e => e.replace('.', '')).join(', ')}</p>
                    <p className="flex items-center justify-center gap-1 mt-1">
                        <svg className="w-3 h-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-emerald-600">Large files supported on compatible servers</span>
                        <span className="text-slate-400">— streamed, optimized, then split</span>
                    </p>
                </div>
            </div>

            {/* Error message */}
            {error && (
                <div
                    role="alert"
                    className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
                >
                    <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{error}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
