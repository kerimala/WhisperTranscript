# Whisper For Files

A production-ready transcription web app with selectable Whisper providers — cloud (Groq, OpenAI) or fully local on Apple Silicon.

## Features

- 🎙️ **Audio Transcription** — Convert audio files to text using Whisper
- 🔀 **Provider Selection** — Choose Groq, OpenAI, or Local (Metal) in the UI
- 🍎 **Local Mode** — Runs entirely on-device via MLX on Apple Silicon (no API key needed)
- 🗣️ **Speaker Diarization** — Identify who said what (local mode, requires HuggingFace token)
- 📁 **Multiple Formats** — flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
- 📊 **Structured Output** — JSON with segments, timestamps, and metadata
- 🔄 **Unlimited File Size** — Large files automatically split using ffmpeg
- 🤖 **AI Analysis** — Summarize, extract tasks, or key points (Kimi / DeepSeek)
- 🎨 **Modern UI** — Clean, responsive design with progress tracking

## Prerequisites

- **Node.js 18+**
- **ffmpeg** — Required for audio processing
- **Python 3.10+** — Only needed for local transcription mode

### Installing ffmpeg (macOS)

```bash
brew install ffmpeg
```

## Quick Start

### Option 1: Local transcription (recommended for Apple Silicon)

```bash
# One command starts both backend + frontend:
bash dev.sh
```

This will:
1. Set up a Python venv and install dependencies (first run only)
2. Start the Metal-accelerated Whisper backend on port 8001
3. Start the Next.js frontend on port 3000

### Option 2: Cloud-only

```bash
npm install
cp .env.example .env.local
# Add your GROQ_API_KEY and/or OPENAI_API_KEY to .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | For Groq | API key from [console.groq.com/keys](https://console.groq.com/keys) |
| `OPENAI_API_KEY` | For OpenAI | API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `HF_TOKEN` | For diarization | HuggingFace token for speaker diarization ([pyannote access](https://huggingface.co/pyannote/speaker-diarization-3.1)) |
| `KIMI_API_KEY` | For AI analysis | Kimi K2.5 API key |
| `DEEPSEEK_API_KEY` | For AI analysis | DeepSeek API key |
| `AI_ANALYSIS_PROVIDER` | Optional | Default AI provider: `kimi` or `deepseek` |

## Providers

| Provider | Model | Notes |
|----------|-------|-------|
| **Groq** | `whisper-large-v3-turbo` | Fast cloud transcription |
| **OpenAI** | `whisper-1` | OpenAI's hosted Whisper |
| **Local (Metal)** | `whisper-large-v3-turbo` via MLX | Runs on-device, no API key, supports speaker diarization |

## Local Backend

The local backend (`local_backend/`) runs Whisper via [mlx-whisper](https://github.com/ml-explore/mlx-examples) on Apple Silicon Metal GPU. Optimized for MacBook Air M4 (24 GB unified memory).

- **Transcription**: `mlx-community/whisper-large-v3-turbo` (~1.5 GB Metal RAM)
- **Diarization**: `pyannote/speaker-diarization-3.1` (optional, needs `HF_TOKEN`)

## Output Format

```json
{
  "source_file": { "name": "audio.mp3", "type": "audio/mpeg", "size_bytes": 1234567 },
  "provider": "local",
  "model": "whisper-large-v3-turbo",
  "language": "en",
  "segments": [
    { "index": 0, "start_ms": 0, "end_ms": 5000, "text": "Hello world", "speaker": "SPEAKER_00" }
  ],
  "full_text": "Hello world",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

## Testing

```bash
npm test
```

## License

MIT
