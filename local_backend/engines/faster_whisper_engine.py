from __future__ import annotations

import gc
import os
from typing import Any

from .base import EngineMetadata, TranscriptionEngine


class FasterWhisperEngine(TranscriptionEngine):
    def __init__(self, device: str, device_name: str) -> None:
        self.device = device
        self.device_name = device_name
        self.model_name = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
        default_compute = "float16" if device == "cuda" else "int8"
        self.compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", default_compute)
        self._model: Any | None = None

    @property
    def metadata(self) -> EngineMetadata:
        return EngineMetadata(
            id="cuda" if self.device == "cuda" else "cpu",
            display_name=(
                "Faster Whisper (NVIDIA CUDA)"
                if self.device == "cuda"
                else "Faster Whisper (CPU)"
            ),
            backend="faster-whisper",
            device=self.device_name,
            accelerator=self.device,
            model=self.model_name,
            compute_type=self.compute_type,
        )

    def _get_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
            )
        return self._model

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        model = self._get_model()
        segments_iter, info = model.transcribe(
            audio_path,
            language=language,
            vad_filter=True,
        )
        segments = [
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text,
            }
            for segment in segments_iter
        ]
        return {
            "text": " ".join(segment["text"].strip() for segment in segments).strip(),
            "segments": segments,
            "language": getattr(info, "language", language or ""),
        }

    def unload(self) -> None:
        self._model = None
        gc.collect()
