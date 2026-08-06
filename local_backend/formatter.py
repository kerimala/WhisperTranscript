def format_diarized(segments: list[dict], source_file: str, created_at: str) -> str:
    lines = [
        f"**Transcription** | {created_at} | local | whisper-large-v3-turbo\n"
    ]
    current_speaker = None
    buffer: list[str] = []

    for seg in segments:
        spk = seg.get("speaker", "Unknown")
        if spk != current_speaker:
            if buffer and current_speaker is not None:
                lines.append(f"{current_speaker}: {' '.join(buffer)}")
            current_speaker = spk
            buffer = [seg["text"].strip()]
        else:
            buffer.append(seg["text"].strip())

    if buffer and current_speaker is not None:
        lines.append(f"{current_speaker}: {' '.join(buffer)}")

    return "\n".join(lines)
