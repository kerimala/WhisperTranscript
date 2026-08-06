# Whisper For Files

A production-ready transcription web app with selectable Whisper providers — cloud (Groq, OpenAI) or local acceleration on Apple Silicon, NVIDIA, AMD, Intel, and CPU-only systems.

## Features

- 🎙️ **Audio Transcription** — Convert audio files to text using Whisper
- 🔀 **Provider Selection** — Choose Groq, OpenAI, or Local (Auto) in the UI
- 🧠 **Automatic Hardware Detection** — Selects MLX, CUDA, Vulkan/ROCm, or CPU at runtime
- 🔒 **Local Mode** — Runs entirely on-device with no transcription API key
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

### Installing ffmpeg

```bash
brew install ffmpeg

# Ubuntu / WSL
sudo apt install ffmpeg
```

## Quick Start

### Option 1: Local transcription (macOS, Linux, or WSL)

```bash
# One command starts both backend + frontend:
bash dev.sh
```

This will:
1. Set up a Python venv and install dependencies (first run only)
2. Detect the platform and GPU, then install the matching runtime profile
3. Start the selected Whisper backend on port 8001
4. Start the Next.js frontend on port 3000

The first local setup and model load can download several gigabytes. Models are downloaded lazily on the first transcription, not during a health check.

### Option 2: Native Windows

```powershell
.\dev-windows.ps1
```

Native Windows NVIDIA requires CUDA 12 and cuDNN 9 DLLs on `PATH`. For this project's primary Windows development path, NVIDIA CUDA under WSL is the easiest supported setup.

### Option 3: Cloud-only

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
| `WHISPER_ENGINE` | Optional | `auto`, `mlx`, `cuda`, `vulkan`, `rocm`, or `cpu` |
| `WHISPER_MODEL` | Optional | Override the default `large-v3-turbo` model |
| `WHISPER_COMPUTE_TYPE` | Optional | Faster Whisper compute type, such as `float16` or `int8_float16` |
| `WHISPER_CPP_BIN` | Vulkan/ROCm | Path to a `whisper.cpp` CLI binary |
| `WHISPER_CPP_MODEL` | Vulkan/ROCm | Path to a GGML Whisper model |

## Providers

| Provider | Model | Notes |
|----------|-------|-------|
| **Groq** | `whisper-large-v3-turbo` | Fast cloud transcription |
| **OpenAI** | `whisper-1` | OpenAI's hosted Whisper |
| **Local (Auto)** | `large-v3-turbo` | Auto-selects the best configured local engine |

## Local Backend

The local backend (`local_backend/`) exposes one stable HTTP API and selects an engine at runtime:

| Profile | Engine | Accelerator |
|---------|--------|-------------|
| `mac-mlx` | `mlx-whisper` | Apple Metal |
| `nvidia-cuda` | `faster-whisper` / CTranslate2 | NVIDIA CUDA under Linux/WSL |
| `windows-nvidia` | `faster-whisper` / CTranslate2 | Native Windows CUDA |
| `universal-vulkan` | `whisper.cpp`, then Faster Whisper CPU fallback | Vulkan/ROCm or CPU |
| `universal-cpu` | `faster-whisper` | CPU INT8 |

`GET /health` reports the detected hardware, selected engine, device, model, compute type, fallback candidates, and diarization capability. Set `WHISPER_ENGINE` to override automatic selection.

Speaker diarization is optional and installed separately because Pyannote and Torch are large:

```bash
local_backend/.venv/bin/pip install -r local_backend/requirements/diarization.txt
```

For AMD/Intel Vulkan, build `whisper.cpp` with `GGML_VULKAN=1`, then configure `WHISPER_CPP_BIN` and `WHISPER_CPP_MODEL`. AMD ROCm builds can use `GGML_HIP=1` and `WHISPER_ENGINE=rocm`.

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
cd local_backend && python3 -m unittest discover -s tests
```

## License

MIT
