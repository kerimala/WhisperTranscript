"""Add speaker labels to an existing Whisper result without retranscribing audio."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from diarization_runtime import diarize_isolated
from formatter import format_diarized
from merger import merge


def _load_token(project_dir: Path) -> str:
    token = os.environ.get("HF_TOKEN", "").strip()
    if token:
        return token
    env_path = project_dir / ".env.local"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("HF_TOKEN="):
                token = line.split("=", 1)[1].strip()
                if token:
                    return token
    raise RuntimeError("HF_TOKEN is not configured")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("transcript", type=Path)
    parser.add_argument("audio", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    args = parser.parse_args()

    transcript_path = args.transcript.resolve()
    audio_path = args.audio.resolve()
    output_path = (
        args.output.resolve()
        if args.output
        else transcript_path.with_name(f"{transcript_path.stem}_diarized.json")
    )
    if output_path.exists():
        raise RuntimeError(f"Refusing to overwrite existing result: {output_path}")

    result = json.loads(transcript_path.read_text(encoding="utf-8"))
    source_segments = result.get("segments") or []
    merge_segments = [
        {
            "start": float(segment["start_ms"]) / 1000,
            "end": float(segment["end_ms"]) / 1000,
            "text": segment.get("text", ""),
        }
        for segment in source_segments
        if segment.get("start_ms") is not None and segment.get("end_ms") is not None
    ]
    if len(merge_segments) != len(source_segments):
        raise RuntimeError("Every transcript segment needs start_ms and end_ms for diarization")

    project_dir = Path(__file__).resolve().parent.parent
    print(f"Preparing {audio_path.name} as 16 kHz mono WAV...", flush=True)
    with tempfile.TemporaryDirectory(prefix="whisper_rediarize_") as tmp_dir:
        prepared_audio = Path(tmp_dir) / "input_16k.wav"
        completed = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(audio_path),
                "-ar",
                "16000",
                "-ac",
                "1",
                str(prepared_audio),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(f"ffmpeg preparation failed: {completed.stderr.strip()}")

        print("Running speaker diarization...", flush=True)
        turns = diarize_isolated(
            str(prepared_audio),
            hf_token=_load_token(project_dir),
            min_speakers=args.min_speakers,
            max_speakers=args.max_speakers,
        )
    print(f"Detected {len(turns)} speaker turns. Merging labels...", flush=True)
    labeled_segments = merge(merge_segments, turns)
    for source, labeled in zip(source_segments, labeled_segments):
        source["speaker"] = labeled["speaker"]

    updated_at = datetime.now(timezone.utc).isoformat()
    result["diarized_text"] = format_diarized(
        labeled_segments,
        result.get("source_file", {}).get("name", audio_path.name),
        result.get("created_at", updated_at),
    )
    result["diarization"] = {
        "engine": "pyannote/speaker-diarization-3.1",
        "updated_at": updated_at,
        "speaker_turns": len(turns),
    }
    if str(result.get("warning", "")).startswith("Diarization failed:"):
        result.pop("warning", None)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(f"{output_path.suffix}.tmp")
    temporary_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    os.replace(temporary_path, output_path)
    print(f"Saved diarized transcript to {output_path}", flush=True)


if __name__ == "__main__":
    main()
