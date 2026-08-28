# WhisperForFiles

Self-hosted audio and video transcription with Groq, OpenAI, or an optional Apple Silicon local backend. Large uploads are streamed to temporary disk, converted to speech-oriented audio, and split into provider-safe chunks.

## What it supports

- Audio and video files: FLAC, MP3, MP4, MPEG, M4A, OGG, WAV, WebM, MOV, AAC, and related browser MIME variants
- Fast Groq transcription with timestamps
- OpenAI Whisper and OpenAI speaker diarization
- Local MLX Whisper with optional pyannote diarization on Apple Silicon
- Resumable chunk processing after rate-limit or network failures
- JSON, text, diarized text, and AI-assisted summaries

## Windows installation

Windows uses the cloud providers. The local Metal/MLX backend is Apple Silicon-only.

1. Download or extract the complete project folder.
2. Double-click `Install-WhisperForFiles-Windows.cmd`.
3. Allow the installer to add Node.js LTS and FFmpeg through WinGet if they are missing.
4. Add a free Groq API key to `.env.local`, or paste it into the app when prompted.
5. Double-click `Start-WhisperForFiles-Windows.cmd` or use the Desktop shortcut.

The installer runs `npm ci`, creates a blank `.env.local` without overwriting an existing one, builds the production app, and creates a Desktop shortcut. It requires Windows 10/11 with PowerShell and WinGet. The app listens only on `127.0.0.1:3000`.

Groq keys are available at [console.groq.com/keys](https://console.groq.com/keys). Groq currently provides transcription and timestamps, but not hosted speaker diarization.

## macOS installation

### Apple Silicon local transcription

Install FFmpeg, then start the combined Python and Next.js services:

```bash
brew install ffmpeg
bash dev.sh
```

The first run creates the Python environment and downloads the local model dependencies. Add `HF_TOKEN` to `.env.local` to enable pyannote speaker diarization.

### Cloud-only on macOS or Linux

Node.js 20.9 or newer and FFmpeg are required.

```bash
npm ci
cp .env.example .env.local
npm run build
npm run start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Configuration

All keys are optional at install time. Configure at least one transcription provider in `.env.local`, or paste its key into the UI for the current browser session.

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Groq cloud transcription |
| `OPENAI_API_KEY` | OpenAI Whisper and OpenAI diarization |
| `HF_TOKEN` | Local pyannote diarization on Apple Silicon |
| `KIMI_API_KEY` | Optional AI analysis with Kimi |
| `DEEPSEEK_API_KEY` | Optional AI analysis with DeepSeek |
| `AI_ANALYSIS_PROVIDER` | `kimi` or `deepseek` |
| `MAX_SOURCE_UPLOAD_BYTES` | Self-hosted staged-upload cap; defaults to 10 GiB |
| `MAX_BROWSER_UPLOAD_BYTES` | Optional lower reverse-proxy ingress limit shown by the UI |

Do not commit `.env.local`; it is ignored by Git.

## Providers

| Provider | Model | Speaker diarization |
| --- | --- | --- |
| Groq | `whisper-large-v3-turbo` | No |
| OpenAI | `whisper-1` | No |
| OpenAI + Diarization | `gpt-4o-transcribe-diarize` | Yes |
| Local Metal | MLX `whisper-large-v3-turbo` + pyannote | Yes, Apple Silicon only |

## Large files and hosting

On a local or self-hosted Node.js server, the original upload is streamed to a private temporary directory rather than held in memory. Ensure the machine has enough temporary disk space for the source file and converted audio. The default source-upload cap is 10 GiB.

Vercel Functions reject request bodies above 4.5 MB before this route executes. A Vercel deployment therefore needs direct object-storage uploads and a separate media-processing worker for large recordings; changing a Next.js body-size setting does not bypass that platform limit.

## Development and verification

```bash
npm run dev
npm test -- --runInBand
npm run lint
npm run build
```

Completed transcripts are stored under `transcriptions/`, which is excluded from Git.
