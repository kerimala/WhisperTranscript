from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any, Callable


ProgressCallback = Callable[[float, str], None]


class EngineUnavailableError(RuntimeError):
    """Raised when no configured local inference engine can run."""


@dataclass(frozen=True)
class EngineMetadata:
    id: str
    display_name: str
    backend: str
    device: str
    accelerator: str
    model: str
    compute_type: str
    available: bool = True
    reason: str | None = None
    capabilities: dict[str, bool] = field(
        default_factory=lambda: {
            "transcription": True,
            "segment_timestamps": True,
            "diarization": False,
        }
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class TranscriptionEngine(ABC):
    @property
    @abstractmethod
    def metadata(self) -> EngineMetadata:
        raise NotImplementedError

    @abstractmethod
    def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
        progress_callback: ProgressCallback | None = None,
    ) -> dict:
        raise NotImplementedError

    @abstractmethod
    def unload(self) -> None:
        raise NotImplementedError
