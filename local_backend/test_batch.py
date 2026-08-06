import os
from pyannote.audio import Pipeline
p = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=os.environ.get("HF_TOKEN"))
print([x for x in dir(p) if 'batch' in x])
print([x for x in dir(p._segmentation) if 'batch' in x])
print([x for x in dir(p._embedding) if 'batch' in x])
