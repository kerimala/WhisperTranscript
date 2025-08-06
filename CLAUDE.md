# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhisperTranscript is an Electron desktop application built with React for audio transcription using OpenAI Whisper. The application supports both cloud-based (OpenAI API) and local transcription modes with automatic fallback functionality.

## Development Commands

### Core Development
- `npm run dev` - Start development mode with hot reload (React dev server + Electron)
- `npm start` - Start Electron in production mode

### Building & Distribution
- `npm run build` - Build React app for production
- `npm run dist` - Build and package for current platform
- `npm run dist:all` - Build for all platforms (Windows, macOS, Linux)
- `npm run pack` - Package without creating installers

### Testing
- `npm test` - Run React tests with watch mode
- `npm run test:unit` - Run unit tests once
- `npm run test:main` - Run Electron main process tests
- `npm run test:e2e` - Run Playwright end-to-end tests
- `npm run test:all` - Run all test suites

### Utility Commands
- `npm run clean` - Clean build artifacts and caches
- `npm run rebuild` - Clean and reinstall dependencies

## Architecture

### Electron Structure
- **Main Process**: `src/main/main.js` - Handles IPC, window management, and service orchestration
- **Renderer Process**: React app starting from `src/App.js`
- **Preload Script**: `src/main/preload.js` - Secure IPC bridge

### Service Architecture
The application uses a sophisticated service registry pattern for managing transcription services:

- **ServiceRegistry** (`src/main/services/serviceRegistry.js`) - Orchestrates service switching, health monitoring, and fallback logic
- **WhisperApiClient** (`src/main/services/whisperApiClient.js`) - Cloud-based OpenAI API client
- **WhisperLocalClient** (`src/main/services/whisperLocalClient.js`) - Local Python service client with process management
- **ModelManager** (`src/main/services/modelManager.js`) - Handles local model downloads and management

### Key Components
- **FileUpload** - Handles file selection and audio recording
- **Settings** - Configuration interface for API keys, transcription modes, and global hotkeys
- **TranscriptionDisplay** - Shows transcription results with copy/save functionality
- **ModelDownloadManager** - UI for managing local Whisper models

### Configuration
- User settings stored in `~/.whispertranscript/config.json`
- Supports global hotkeys for dictation toggle
- Environment variables: `OPENAI_API_KEY` for cloud mode

### Local Service Dependencies
The local transcription mode requires Python 3.7+ and these packages:
- `openai-whisper` - Core Whisper models
- `flask` - HTTP service framework
- `torch` - PyTorch for model inference

## Development Notes

### Service Switching
The app supports runtime switching between cloud and local transcription modes with automatic fallback. The ServiceRegistry handles health monitoring and graceful degradation.

### Process Management
The WhisperLocalClient manages a Python subprocess for local transcription, including automatic restart, health checks, and graceful shutdown.

### IPC Communication
Main process exposes APIs through `window.electronAPI` for:
- File operations and dialogs
- Transcription service management
- Model downloading and management
- Settings persistence

### Global Hotkeys
Configurable global shortcuts (default: CommandOrControl+Shift+D) for bringing the app to focus and triggering dictation.