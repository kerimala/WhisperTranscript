"""Run Pyannote in an isolated venv so its CUDA stack cannot clash with Whisper."""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Optional


BACKEND_DIR = Path(__file__).resolve().parent
DEFAULT_PYANNOTE_PYTHON = BACKEND_DIR / ".venv-diarization" / "bin" / "python"
WORKER_PATH = BACKEND_DIR / "diarizer_worker.py"
DiarizationProgress = Callable[[float, str], None]


def get_diarization_status() -> dict:
    python_path = Path(os.environ.get("PYANNOTE_PYTHON", DEFAULT_PYANNOTE_PYTHON))
    available = python_path.is_file()
    return {
        "available": available,
        "configured": bool(os.environ.get("HF_TOKEN", "").strip()),
        "runtime": "isolated" if available else None,
        "python": str(python_path) if available else None,
    }


def diarize_isolated(
    audio_path: str,
    hf_token: str,
    min_speakers: Optional[int] = None,
    max_speakers: Optional[int] = None,
    progress_callback: Optional[DiarizationProgress] = None,
) -> list[tuple[float, float, str]]:
    python_path = Path(os.environ.get("PYANNOTE_PYTHON", DEFAULT_PYANNOTE_PYTHON))
    if not python_path.is_file():
        raise RuntimeError(
            "Isolated Pyannote runtime is missing. Run: "
            "python3 -m venv local_backend/.venv-diarization && "
            "local_backend/.venv-diarization/bin/pip install "
            "-r local_backend/requirements/diarization.txt"
        )

    env = os.environ.copy()
    env["HF_TOKEN"] = hf_token
    # dev.sh exposes the CUDA 12 libraries needed by CTranslate2. PyTorch ships
    # its own CUDA runtime, so the worker must not inherit that loader path.
    env.pop("LD_LIBRARY_PATH", None)
    env.pop("PYTHONPATH", None)

    command = [str(python_path), str(WORKER_PATH), audio_path]
    if min_speakers is not None:
        command.extend(["--min-speakers", str(min_speakers)])
    if max_speakers is not None:
        command.extend(["--max-speakers", str(max_speakers)])

    process = subprocess.Popen(
        command,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    result_payload: Optional[dict] = None
    diagnostics: list[str] = []
    try:
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                diagnostics.append(line)
                continue

            kind = payload.get("kind")
            if kind == "progress":
                if progress_callback is not None:
                    progress_callback(
                        float(payload.get("progress", 0.0)),
                        str(payload.get("message", "Identifying speakers...")),
                    )
            elif kind == "result":
                result_payload = payload

        return_code = process.wait()
    except BaseException:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        raise

    if return_code != 0:
        detail = "\n".join(diagnostics[-20:]).strip()
        raise RuntimeError(f"Pyannote worker failed: {detail or return_code}")

    if result_payload is None:
        raise RuntimeError("Pyannote worker returned no result")

    return [
        (float(turn[0]), float(turn[1]), str(turn[2]))
        for turn in result_payload.get("turns", [])
    ]
