"""Cross-platform local Whisper server with reload-safe background jobs."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import threading
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

# Authenticate once when the local runtime starts. A per-request token can still
# be passed for diarization without being stored in the job registry.
_hf_startup_token = os.environ.get("HF_TOKEN", "").strip()
if _hf_startup_token:
    try:
        from huggingface_hub import login as _hf_login

        _hf_login(token=_hf_startup_token, add_to_git_credential=False)
    except Exception:
        pass

from engines.runtime import get_engine, get_runtime_status
from diarization_runtime import diarize_isolated, get_diarization_status
from formatter import format_diarized
from merger import merge, merge_timed_items

app = FastAPI(title="Whisper For Files Local Runtime", version="2.1.0")

JobProgress = Callable[[float, str], None]
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_transcription_lock = threading.Lock()
_output_dir = Path(__file__).resolve().parent.parent / "transcriptions"


class JobCancelled(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_snapshot(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return {key: value for key, value in job.items() if not key.startswith("_")}


def _update_job(job_id: str, **updates) -> None:
    with _jobs_lock:
        job = _jobs[job_id]
        job.update(updates)
        job["updated_at"] = _now()


def _job_progress(job_id: str, progress: float, message: str) -> None:
    with _jobs_lock:
        job = _jobs[job_id]
        if job.get("_cancel_requested"):
            raise JobCancelled("Transcription cancelled")
        job["progress"] = max(job.get("progress", 0), min(99, round(progress)))
        job["message"] = message
        job["updated_at"] = _now()


@app.get("/health")
def health():
    status = dict(get_runtime_status())
    status["diarization"] = get_diarization_status()
    return status


@app.post("/diarize")
async def diarize_existing_transcript(
    file: UploadFile = File(...),
    transcript_json: str = Form(...),
    hf_token: str = Form(default=""),
    min_speakers: Optional[int] = Form(default=None),
    max_speakers: Optional[int] = Form(default=None),
):
    """Diarize audio locally and attach speakers to an existing cloud transcript."""
    import asyncio
    from fastapi.responses import JSONResponse, StreamingResponse

    token = hf_token.strip() or os.environ.get("HF_TOKEN", "").strip()
    if not token:
        return JSONResponse(
            {"error": True, "message": "HF_TOKEN is required for local speaker detection."},
            status_code=400,
        )

    try:
        transcript = json.loads(transcript_json)
    except json.JSONDecodeError:
        return JSONResponse(
            {"error": True, "message": "transcript_json is not valid JSON."},
            status_code=400,
        )

    words = transcript.get("words") if isinstance(transcript, dict) else None
    segments = transcript.get("segments") if isinstance(transcript, dict) else None
    timed_items = words if isinstance(words, list) and words else segments
    if not isinstance(timed_items, list) or not timed_items:
        return JSONResponse(
            {"error": True, "message": "The transcript has no usable timed words or segments."},
            status_code=400,
        )

    tmp_dir = tempfile.mkdtemp(prefix="whisper_diarize_")
    suffix = os.path.splitext(file.filename or "audio")[1] or ".audio"
    audio_path = os.path.join(tmp_dir, f"input{suffix}")
    with open(audio_path, "wb") as output:
        shutil.copyfileobj(file.file, output)

    def run_diarization() -> str:
        try:
            wav_path = os.path.join(tmp_dir, "input_16k.wav")
            try:
                import subprocess

                subprocess.run(
                    ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", wav_path],
                    capture_output=True,
                    check=True,
                )
                diarize_path = wav_path
            except Exception:
                diarize_path = audio_path

            turns = diarize_isolated(
                diarize_path,
                hf_token=token,
                min_speakers=min_speakers,
                max_speakers=max_speakers,
            )
            merged_segments = merge_timed_items(timed_items, turns)
            return json.dumps({
                "segments": merged_segments,
                "speaker_count": len({turn[2] for turn in turns}),
            })
        except Exception as exc:
            traceback.print_exc()
            return json.dumps({"error": True, "message": str(exc)})
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def stream_generator():
        yield " " * 1024 + "\n"
        future = asyncio.get_running_loop().run_in_executor(None, run_diarization)
        while not future.done():
            yield " \n"
            await asyncio.sleep(10)
        yield future.result()

    return StreamingResponse(stream_generator(), media_type="application/json")


@app.post("/jobs", status_code=202)
async def create_job(
    file: UploadFile = File(...),
    language: str = Form(default=""),
    hf_token: str = Form(default=""),
    diarize: bool = Form(default=True),
    min_speakers: Optional[int] = Form(default=None),
    max_speakers: Optional[int] = Form(default=None),
):
    job_id = str(uuid.uuid4())
    tmp_dir = tempfile.mkdtemp(prefix=f"whisper_job_{job_id[:8]}_")
    suffix = os.path.splitext(file.filename or "audio")[1] or ".audio"
    audio_path = os.path.join(tmp_dir, f"input{suffix}")
    try:
        with open(audio_path, "wb") as target:
            shutil.copyfileobj(file.file, target)
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    file_name = file.filename or "audio"
    created_at = _now()
    with _jobs_lock:
        _jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "progress": 2,
            "message": "Upload complete. Waiting for local transcription engine...",
            "file_name": file_name,
            "file_size": os.path.getsize(audio_path),
            "created_at": created_at,
            "updated_at": created_at,
            "result": None,
            "error": None,
            "output_file": None,
            "diarization_enabled": diarize,
            "_cancel_requested": False,
        }

    worker = threading.Thread(
        target=_run_job,
        name=f"whisper-job-{job_id[:8]}",
        daemon=True,
        kwargs={
            "job_id": job_id,
            "tmp_dir": tmp_dir,
            "audio_path": audio_path,
            "file_name": file_name,
            "file_type": file.content_type or "audio/mpeg",
            "language": language,
            "hf_token": hf_token,
            "diarize": diarize,
            "min_speakers": min_speakers,
            "max_speakers": max_speakers,
        },
    )
    worker.start()
    return _job_snapshot(job_id)


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    try:
        return _job_snapshot(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Transcription job not found")


@app.delete("/jobs/{job_id}", status_code=202)
def cancel_job(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Transcription job not found")
        if job["status"] in {"completed", "failed", "cancelled"}:
            return {key: value for key, value in job.items() if not key.startswith("_")}
        job["_cancel_requested"] = True
        job["status"] = "cancelling"
        job["message"] = "Cancellation requested..."
        job["updated_at"] = _now()
        return {key: value for key, value in job.items() if not key.startswith("_")}


def _run_job(
    *,
    job_id: str,
    tmp_dir: str,
    audio_path: str,
    file_name: str,
    file_type: str,
    language: str,
    hf_token: str,
    diarize: bool,
    min_speakers: Optional[int],
    max_speakers: Optional[int],
) -> None:
    try:
        with _transcription_lock:
            _job_progress(job_id, 4, "Starting local transcription...")
            _update_job(job_id, status="processing")

            def progress(engine_progress: float, message: str) -> None:
                # Reserve the final part for optional diarization and saving.
                _job_progress(job_id, 5 + (engine_progress * 0.77), message)

            result = _perform_transcription(
                audio_path=audio_path,
                tmp_dir=tmp_dir,
                file_name=file_name,
                file_type=file_type,
                language=language,
                hf_token=hf_token,
                diarize=diarize,
                min_speakers=min_speakers,
                max_speakers=max_speakers,
                progress_callback=progress,
            )
            _job_progress(job_id, 96, "Saving transcription result...")
            output_file = _save_result(result, file_name, job_id)
            _update_job(
                job_id,
                status="completed",
                progress=100,
                message="Transcription complete and saved.",
                result=result,
                output_file=output_file,
            )
    except JobCancelled:
        _update_job(
            job_id,
            status="cancelled",
            message="Transcription cancelled.",
            error=None,
        )
    except Exception as exc:
        traceback.print_exc()
        _update_job(
            job_id,
            status="failed",
            message="Transcription failed.",
            error=str(exc),
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _save_result(result: dict, file_name: str, job_id: str) -> str:
    _output_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(file_name).stem).strip("._") or "audio"
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    output_name = f"{timestamp}_{safe_name}_{job_id[:8]}.json"
    output_path = _output_dir / output_name
    temporary_path = output_path.with_suffix(".json.tmp")
    with temporary_path.open("w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, allow_nan=False)
    os.replace(temporary_path, output_path)
    return output_name


def _perform_transcription(
    *,
    audio_path: str,
    tmp_dir: str,
    file_name: str,
    file_type: str,
    language: str,
    hf_token: str,
    diarize: bool,
    min_speakers: Optional[int],
    max_speakers: Optional[int],
    progress_callback: JobProgress | None = None,
) -> dict:
    engine = None
    try:
        file_size_bytes = os.path.getsize(audio_path)
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ========================================================")
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Processing file: {file_name} ({file_size_bytes} bytes)")
        engine = get_engine()
        engine_info = engine.metadata
        print(
            f"[{datetime.now().strftime('%H:%M:%S')}] Starting transcription "
            f"using {engine_info.display_name} on {engine_info.device}..."
        )
        whisper_result = engine.transcribe(
            audio_path,
            language=language.strip() or None,
            progress_callback=progress_callback,
        )
        segments = _sanitize_segments(whisper_result.get("segments", []))
        detected_language = whisper_result.get("language", "")
        full_text = whisper_result.get("text", "")
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Transcription complete. Total segments: {len(segments)}")
        engine.unload()

        created_at = _now()
        diarized_text = None
        diarization_warning = None
        if diarize and hf_token.strip():
            if progress_callback:
                progress_callback(101, "Preparing speaker diarization...")
            wav_path = os.path.join(tmp_dir, "input_16k.wav")
            try:
                import subprocess

                subprocess.run(
                    ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", wav_path],
                    capture_output=True,
                    check=True,
                )
                diarize_path = wav_path
            except Exception:
                diarize_path = audio_path
            try:
                def diarization_progress(progress: float, message: str) -> None:
                    if progress_callback:
                        # _run_job maps this extended engine scale into the
                        # diarization-reserved 83-95% range.
                        progress_callback(102 + (15 * progress), message)

                diarization_progress(0.0, "Identifying speakers...")
                diarization_turns = diarize_isolated(
                    diarize_path,
                    hf_token=hf_token.strip(),
                    min_speakers=min_speakers,
                    max_speakers=max_speakers,
                    progress_callback=diarization_progress,
                )
                segments = merge(segments, diarization_turns)
                diarized_text = format_diarized(segments, file_name, created_at)
            except JobCancelled:
                raise
            except Exception as diar_exc:
                diarization_warning = f"Diarization failed: {diar_exc}"
                print(f"[WARN] {diarization_warning}", file=sys.stderr)
                traceback.print_exc()

        mapped_segments = []
        for index, segment in enumerate(segments):
            mapped = {
                "index": index,
                "start_ms": _seconds_to_ms(segment.get("start")),
                "end_ms": _seconds_to_ms(segment.get("end")),
                "text": (segment.get("text") or "").strip(),
            }
            if segment.get("speaker"):
                mapped["speaker"] = segment["speaker"]
            mapped_segments.append(mapped)

        result = {
            "source_file": {
                "name": file_name,
                "type": file_type,
                "size_bytes": file_size_bytes,
            },
            "provider": "local",
            "model": engine_info.model,
            "engine": engine_info.id,
            "accelerator": engine_info.accelerator,
            "device": engine_info.device,
            "language": detected_language,
            "segments": mapped_segments,
            "full_text": full_text,
            "created_at": created_at,
        }
        if diarized_text:
            result["diarized_text"] = diarized_text
        if diarization_warning:
            result["warning"] = diarization_warning
        return result
    finally:
        if engine is not None:
                try:
                    engine.unload()
                except Exception:
                    pass


@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    language: str = Form(default=""),
    hf_token: str = Form(default=""),
    diarize: bool = Form(default=True),
    min_speakers: Optional[int] = Form(default=None),
    max_speakers: Optional[int] = Form(default=None),
):
    """Compatibility endpoint for older frontends. New clients use /jobs."""
    import asyncio
    from fastapi.responses import StreamingResponse

    tmp_dir = tempfile.mkdtemp(prefix="whisper_local_")
    suffix = os.path.splitext(file.filename or "audio")[1] or ".audio"
    audio_path = os.path.join(tmp_dir, f"input{suffix}")
    with open(audio_path, "wb") as target:
        shutil.copyfileobj(file.file, target)

    def run_transcription() -> str:
        try:
            with _transcription_lock:
                result = _perform_transcription(
                    audio_path=audio_path,
                    tmp_dir=tmp_dir,
                    file_name=file.filename or "audio",
                    file_type=file.content_type or "audio/mpeg",
                    language=language,
                    hf_token=hf_token,
                    diarize=diarize,
                    min_speakers=min_speakers,
                    max_speakers=max_speakers,
                )
            return json.dumps(result)
        except Exception as exc:
            traceback.print_exc()
            return json.dumps({"error": True, "message": str(exc)})
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def stream_generator():
        yield " " * 1024 + "\n"
        future = asyncio.get_running_loop().run_in_executor(None, run_transcription)
        while not future.done():
            yield " \n"
            await asyncio.sleep(10)
        yield future.result()

    return StreamingResponse(stream_generator(), media_type="application/json")


def _seconds_to_ms(value: object) -> int | None:
    try:
        return int(round(float(value) * 1000)) if value is not None else None
    except (TypeError, ValueError):
        return None


def _sanitize_segments(segments: list[dict]) -> list[dict]:
    import math

    clean = []
    for segment in segments:
        clean.append(
            {
                key: None if isinstance(value, float) and (math.isnan(value) or math.isinf(value)) else value
                for key, value in segment.items()
            }
        )
    return clean
