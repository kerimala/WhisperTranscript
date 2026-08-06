# WhisperForFiles

Self-hosted audio and video transcription with Groq, OpenAI, or an automatically selected local Whisper runtime. Speaker diarization can run through OpenAI or locally with pyannote.

## What it supports

- Audio and video files including FLAC, MP3, MP4, MPEG, M4A, OGG, WAV, WebM, MOV, and AAC
- Groq transcription with timestamps
- Groq transcription followed by local-only speaker detection
- OpenAI Whisper and OpenAI speaker diarization
- Local Whisper on Apple Silicon, NVIDIA CUDA, Vulkan/ROCm, or CPU
- Optional local pyannote speaker diarization
- Resumable chunk processing after rate-limit or network failures
- JSON, text, diarized text, and AI-assisted summaries

## Quick start

Node.js 20.9 or newer and FFmpeg are required.

### Local runtime on macOS, Linux, or WSL

```bash
# macOS
brew install ffmpeg

# Ubuntu / WSL
sudo apt install ffmpeg

# Start the local backend and frontend
bash dev.sh
```

The first run creates a Python environment, detects the platform and accelerator, installs the matching runtime profile, starts the backend on port 8001, and starts the frontend on port 3000. Model downloads happen lazily on the first transcription.

### Native Windows development runtime

```powershell
.\dev-windows.ps1
```

Native Windows NVIDIA requires CUDA 12 and cuDNN 9 DLLs on `PATH`. NVIDIA CUDA under WSL is the simplest Windows development path.

### Windows end-user installation

The packaged Windows workflow uses Groq or OpenAI for transcription and can run pyannote speaker detection locally.

1. Download or extract the complete project folder.
2. Double-click `Install-WhisperForFiles-Windows.cmd`.
3. Allow the installer to add Node.js LTS, Python 3.11, and FFmpeg through WinGet if needed.
4. Add a Groq API key and Hugging Face token to `.env.local`, or paste them into the app.
5. Accept access to the [pyannote speaker model](https://huggingface.co/pyannote/speaker-diarization-3.1).
6. Double-click `Start-WhisperForFiles-Windows.cmd` or use the Desktop shortcut.

The installer runs `npm ci`, creates the Python speaker environment, preserves an existing `.env.local`, builds the production app, and creates a Desktop shortcut. Both services listen only on localhost.

### Cloud-only

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
| `HF_TOKEN` | Local pyannote speaker detection |
| `KIMI_API_KEY` | Optional AI analysis with Kimi |
| `DEEPSEEK_API_KEY` | Optional AI analysis with DeepSeek |
| `AI_ANALYSIS_PROVIDER` | `kimi` or `deepseek` |
| `WHISPER_ENGINE` | `auto`, `mlx`, `cuda`, `vulkan`, `rocm`, or `cpu` |
| `WHISPER_MODEL` | Override the default `large-v3-turbo` model |
| `WHISPER_COMPUTE_TYPE` | Faster Whisper compute type such as `float16` or `int8_float16` |
| `WHISPER_CPP_BIN` | Path to a `whisper.cpp` CLI binary for Vulkan/ROCm |
| `WHISPER_CPP_MODEL` | Path to a GGML Whisper model for Vulkan/ROCm |
| `MAX_SOURCE_UPLOAD_BYTES` | Self-hosted staged-upload cap; defaults to 10 GiB |
| `MAX_BROWSER_UPLOAD_BYTES` | Optional lower reverse-proxy ingress limit shown by the UI |
| `OPENAI_DIARIZE_CHUNK_CONCURRENCY` | OpenAI diarization worker count from 1 to 4; defaults to 2 |

Do not commit `.env.local`; it is ignored by Git.

## Providers

| Provider | Model | Speaker diarization |
| --- | --- | --- |
| Groq | `whisper-large-v3-turbo` | No |
| Groq + Local Speakers | Groq `whisper-large-v3-turbo` plus local pyannote | Yes |
| OpenAI | `whisper-1` | No |
| OpenAI + Diarization | `gpt-4o-transcribe-diarize` | Yes |
| Local (Auto) | Automatically selected local runtime | Optional local pyannote |

## Local runtime selection

The backend exposes one stable HTTP API and selects an engine at runtime:

| Profile | Engine | Accelerator |
| --- | --- | --- |
| `mac-mlx` | `mlx-whisper` | Apple Metal |
| `nvidia-cuda` | `faster-whisper` / CTranslate2 | NVIDIA CUDA under Linux or WSL |
| `windows-nvidia` | `faster-whisper` / CTranslate2 | Native Windows CUDA |
| `universal-vulkan` | `whisper.cpp`, then CPU fallback | Vulkan/ROCm or CPU |
| `universal-cpu` | `faster-whisper` | CPU INT8 |

`GET /health` reports the detected hardware, selected engine, device, model, compute type, fallback candidates, and diarization capability. Set `WHISPER_ENGINE` to override automatic selection.

Speaker diarization is optional and installed separately because pyannote and Torch are large:

```bash
local_backend/.venv/bin/pip install -r local_backend/requirements/diarization.txt
```

For AMD or Intel Vulkan, build `whisper.cpp` with `GGML_VULKAN=1`, then configure `WHISPER_CPP_BIN` and `WHISPER_CPP_MODEL`. AMD ROCm builds can use `GGML_HIP=1` with `WHISPER_ENGINE=rocm`.

## Large files and hosting

On a local or self-hosted Node.js server, the original upload is streamed to a private temporary directory. Ensure the machine has enough temporary disk space for the source file and converted audio. The default source-upload cap is 10 GiB.

Vercel Functions reject request bodies above 4.5 MB before this route executes. Large recordings on Vercel require direct object-storage uploads and a separate media-processing worker.

Split jobs use up to four concurrent workers for Groq and standard OpenAI transcription. OpenAI diarization uses two workers by default; set `OPENAI_DIARIZE_CHUNK_CONCURRENCY=1` for sequential processing or up to `4` for more throughput.

## Development and verification

```bash
npm run dev
npm test -- --runInBand
python3 -m unittest local_backend/test_merger.py
python3 -m unittest discover -s local_backend/tests
npm run lint
npm run build
```

Completed transcripts are stored under `transcriptions/`, which is excluded from Git.
