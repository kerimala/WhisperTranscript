def merge(
    whisper_segments: list[dict],
    diarization_turns: list[tuple[float, float, str]],
) -> list[dict]:
    for segment in whisper_segments:
        seg_mid = (segment["start"] + segment["end"]) / 2
        speaker = "Unknown"
        for (start, end, spk) in diarization_turns:
            if start <= seg_mid <= end:
                speaker = spk
                break
        segment["speaker"] = speaker
    return whisper_segments
