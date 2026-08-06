import sys
import torch
from pyannote.core import Annotation
from pyannote.audio.pipelines.speaker_diarization import DiarizeOutput

# Create dummy annotation
annotation = Annotation()
annotation[torch.tensor([0.0, 1.0]), 1] = "SPEAKER_00"

# Create dummy output
output = DiarizeOutput(speaker_diarization=annotation, exclusive_speaker_diarization=annotation, speaker_embeddings=None)

# Try my code
if hasattr(output, "speaker_diarization"):
    dia = output.speaker_diarization
else:
    dia = output

try:
    results = [
        (turn.start, turn.end, speaker)
        for turn, _, speaker in dia.itertracks(yield_label=True)
    ]
    print(results)
    print("SUCCESS")
except Exception as e:
    print(f"FAILED: {e}")
