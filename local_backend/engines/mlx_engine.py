from __future__ import annotations

import gc
import os

from .base import EngineMetadata, TranscriptionEngine


class MlxWhisperEngine(TranscriptionEngine):
    def __init__(self) -> None:
        self.model = os.environ.get(
            "WHISPER_MODEL",
            "mlx-community/whisper-large-v3-turbo",
        )

    @property
    def metadata(self) -> EngineMetadata:
        return EngineMetadata(
            id="mlx",
            display_name="MLX Whisper (Metal)",
            backend="mlx-whisper",
            device="Apple Silicon GPU",
            accelerator="metal",
            model=self.model,
            compute_type="float16",
        )

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        import mlx_whisper

        kwargs: dict = {
            "path_or_hf_repo": self.model,
            "verbose": False,
        }
        if language:
            kwargs["language"] = language
        return mlx_whisper.transcribe(audio_path, **kwargs)

    def unload(self) -> None:
        try:
            from mlx_whisper.transcribe import ModelHolder

            ModelHolder.model = None
        except (ImportError, AttributeError):
            pass
        try:
            import mlx.core as mx

            mx.clear_cache()
        except (ImportError, AttributeError):
            pass
        gc.collect()
