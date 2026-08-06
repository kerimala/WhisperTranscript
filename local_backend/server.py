"""
Local Metal Whisper + Speaker Diarization Server

POST /transcribe
  - file: audio file (multipart)
  - language: ISO-639-1 code, e.g. "de", "en" (optional – auto-detect if absent)
  - hf_token: HuggingFace token for pyannote (optional – skips diarization if absent)
  - min_speakers: int (optional, default 1)
  - max_speakers: int (optional, default 10)

Returns JSON:
  {
    "segments": [...],        # whisper segments with optional speaker field
    "full_text": "...",       # plain concatenated text
    "diarized_text": "...",   # speaker-labeled LLM-friendly string (only when diarized)
    "language": "en",
    "model": "whisper-large-v3-turbo",
    "created_at": "..."
  }
"""

import os
import shutil
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

# Authenticate with HuggingFace Hub if a token is available.
# huggingface_hub also reads HF_TOKEN automatically, but an explicit login
# suppresses the "unauthenticated requests" warning and enables private models.
_hf_startup_token = os.environ.get("HF_TOKEN", "").strip()
if _hf_startup_token:
    try:
        from huggingface_hub import login as _hf_login
        _hf_login(token=_hf_startup_token, add_to_git_credential=False)
    except Exception:
        pass  # non-fatal – mlx_whisper will still work anonymously

from transcriber import transcribe, unload_model
from diarizer import diarize, unload_diarizer
from merger import merge
from formatter import format_diarized

app = FastAPI(title="Local Whisper + Diarization", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    language: str = Form(default=""),
    hf_token: str = Form(default=""),
    min_speakers: Optional[int] = Form(default=None),
    max_speakers: Optional[int] = Form(default=None),
):
    import asyncio
    import json
    from fastapi.responses import StreamingResponse

    tmp_dir = tempfile.mkdtemp(prefix="whisper_local_")
    
    # Save uploaded file to disk immediately
    suffix = os.path.splitext(file.filename or "audio")[1] or ".audio"
    audio_path = os.path.join(tmp_dir, f"input{suffix}")
    with open(audio_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    file_name = file.filename or ""
    file_size_bytes = os.path.getsize(audio_path)
    file_type = file.content_type or "audio/mpeg"

    def run_transcription():
        try:
            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ========================================================")
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Processing file: {file_name} ({file_size_bytes} bytes)")
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Starting transcription using MLX Whisper...")
            
            lang_arg = language.strip() or None
            whisper_result = transcribe(audio_path, language=lang_arg)
            segments: list[dict] = whisper_result.get("segments", [])
            detected_language: str = whisper_result.get("language", "")
            full_text: str = whisper_result.get("text", "")

            segments = _sanitize_segments(segments)
            
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Transcription complete. Total segments: {len(segments)}")
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Detected language: {detected_language}")
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Unloading Whisper model from Metal memory...")
            unload_model()

            created_at = datetime.now(timezone.utc).isoformat()
            diarized_text = None
            diarization_warning = None

            if hf_token.strip():
                wav_path = os.path.join(tmp_dir, "input_16k.wav")
                try:
                    import subprocess
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", wav_path],
                        capture_output=True, check=True,
                    )
                    diarize_path = wav_path
                except Exception:
                    diarize_path = audio_path

                try:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Starting Pyannote Speaker Diarization...")
                    diarization_turns = diarize(
                        diarize_path, hf_token=hf_token.strip(),
                        min_speakers=min_speakers, max_speakers=max_speakers,
                    )
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Diarization complete. Unloading pyannote model from memory...")
                    unload_diarizer()
                    
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Merging transcription segments with speakers...")
                    segments = merge(segments, diarization_turns)
                    diarized_text = format_diarized(segments, file_name, created_at)
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Merging complete. Sending data to UI...")
                except Exception as diar_exc:
                    diarization_warning = f"Diarization failed: {diar_exc}"
                    print(f"[WARN] {diarization_warning}", file=sys.stderr)
                    traceback.print_exc()

            mapped_segments = []
            for i, seg in enumerate(segments):
                try:
                    start_ms = int(round(seg["start"] * 1000)) if seg.get("start") is not None else None
                except:
                    start_ms = None
                try:
                    end_ms = int(round(seg["end"] * 1000)) if seg.get("end") is not None else None
                except:
                    end_ms = None

                mseg = {
                    "index": i,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "text": (seg.get("text") or "").strip()
                }
                if seg.get("speaker"):
                    mseg["speaker"] = seg["speaker"]
                mapped_segments.append(mseg)

            result = {
                "source_file": {
                    "name": file_name,
                    "type": file_type,
                    "size_bytes": file_size_bytes,
                },
                "provider": "local",
                "model": "whisper-large-v3-turbo",
                "language": detected_language,
                "segments": mapped_segments,
                "full_text": full_text,
                "created_at": created_at,
            }
            if diarized_text:
                result["diarized_text"] = diarized_text
            if diarization_warning:
                result["warning"] = diarization_warning

            return json.dumps(result)
        except Exception as exc:
            traceback.print_exc()
            return json.dumps({"error": True, "message": str(exc)})
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def stream_generator():
        # First chunk establishes headers and connection immediately
        yield " " * 1024 + "\n"
        
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(None, run_transcription)
        
        # While the blocking transcription runs, yield a space every 10 seconds
        # This completely prevents Next.js Undici timeout (5 mins) AND Browser timeout
        while not future.done():
            yield " \n"
            await asyncio.sleep(10.0)
            
        # The blocking call has finished, yield the final JSON payload
        final_json = future.result()
        yield final_json

    return StreamingResponse(stream_generator(), media_type="application/json")


def _sanitize_segments(segments: list[dict]) -> list[dict]:
    """Replace NaN / Inf float values with None so JSON serialization works."""
    import math
    clean = []
    for seg in segments:
        new_seg = {}
        for k, v in seg.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                new_seg[k] = None
            else:
                new_seg[k] = v
        clean.append(new_seg)
    return clean
