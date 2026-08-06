from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from .base import EngineMetadata, TranscriptionEngine


class WhisperCppEngine(TranscriptionEngine):
    def __init__(self, accelerator: str, device_name: str) -> None:
        self.accelerator = accelerator
        self.device_name = device_name
        self.binary = resolve_binary()
        self.model_path = resolve_model_path()

    @property
    def metadata(self) -> EngineMetadata:
        return EngineMetadata(
            id=self.accelerator,
            display_name=f"whisper.cpp ({self.accelerator.upper()})",
            backend="whisper.cpp",
            device=self.device_name,
            accelerator=self.accelerator,
            model=os.path.basename(self.model_path),
            compute_type="quantized",
        )

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        with tempfile.TemporaryDirectory(prefix="whisper_cpp_") as tmp_dir:
            output_prefix = os.path.join(tmp_dir, "transcript")
            command = [
                self.binary,
                "-m",
                self.model_path,
                "-f",
                audio_path,
                "-oj",
                "-of",
                output_prefix,
            ]
            if language:
                command.extend(["-l", language])
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            if completed.returncode != 0:
                message = (completed.stderr or completed.stdout).strip()
                raise RuntimeError(f"whisper.cpp failed: {message or completed.returncode}")
            json_path = Path(f"{output_prefix}.json")
            if not json_path.exists():
                raise RuntimeError("whisper.cpp did not create the expected JSON output")
            with json_path.open("r", encoding="utf-8") as handle:
                return normalize_whisper_cpp_result(json.load(handle), language)

    def unload(self) -> None:
        # The CLI exits after every request, so it holds no persistent model memory.
        return None


def resolve_binary() -> str:
    configured = os.environ.get("WHISPER_CPP_BIN", "").strip()
    if configured and os.path.isfile(configured):
        return configured
    for candidate in ("whisper-cli", "whisper-cli.exe", "main", "main.exe"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError("whisper.cpp binary not found; set WHISPER_CPP_BIN")


def resolve_model_path() -> str:
    configured = os.environ.get("WHISPER_CPP_MODEL", "").strip()
    if configured and os.path.isfile(configured):
        return configured
    raise RuntimeError("whisper.cpp model not found; set WHISPER_CPP_MODEL")


def _timestamp_to_seconds(value: object) -> float | None:
    if isinstance(value, (int, float)):
        # whisper.cpp offset values are expressed in 10 ms ticks.
        return float(value) / 100.0
    if not isinstance(value, str):
        return None
    parts = value.strip().replace(",", ".").split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        return float(value)
    except ValueError:
        return None


def normalize_whisper_cpp_result(payload: dict, requested_language: str | None) -> dict:
    raw_segments = payload.get("transcription") or payload.get("segments") or []
    segments: list[dict] = []
    for raw in raw_segments:
        timestamps = raw.get("timestamps") or raw.get("offsets") or {}
        start = raw.get("start", timestamps.get("from"))
        end = raw.get("end", timestamps.get("to"))
        text = str(raw.get("text", "")).strip()
        segments.append(
            {
                "start": _timestamp_to_seconds(start),
                "end": _timestamp_to_seconds(end),
                "text": text,
            }
        )
    language = payload.get("result", {}).get("language") or payload.get("language")
    return {
        "text": " ".join(segment["text"] for segment in segments if segment["text"]).strip(),
        "segments": segments,
        "language": language or requested_language or "",
    }
