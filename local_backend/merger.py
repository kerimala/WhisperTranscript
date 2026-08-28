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


def _speaker_for_interval(
    start: float,
    end: float,
    diarization_turns: list[tuple[float, float, str]],
) -> str:
    """Choose the speaker with the greatest overlap with a timed token."""
    best_speaker = "Unknown"
    best_overlap = 0.0

    for turn_start, turn_end, speaker in diarization_turns:
        overlap = max(0.0, min(end, turn_end) - max(start, turn_start))
        if overlap > best_overlap:
            best_overlap = overlap
            best_speaker = speaker

    if best_overlap > 0:
        return best_speaker

    # Zero-duration tokens occasionally occur. A midpoint containment check
    # still gives them a deterministic label without guessing across silences.
    midpoint = (start + end) / 2
    for turn_start, turn_end, speaker in diarization_turns:
        if turn_start <= midpoint <= turn_end:
            return speaker

    return "Unknown"


def _join_tokens(tokens: list[str]) -> str:
    text = ""
    closing_punctuation = set(".,!?;:%)]}»”’")
    opening_punctuation = set("([{«“‘")

    for token in tokens:
        if not token:
            continue
        if not text:
            text = token.lstrip()
        elif token[0].isspace() or token[0] in closing_punctuation or text[-1] in opening_punctuation:
            text += token
        else:
            text += " " + token

    return text.strip()


def merge_timed_items(
    items: list[dict],
    diarization_turns: list[tuple[float, float, str]],
) -> list[dict]:
    """Assign timed Groq words/segments and regroup consecutive speakers."""
    labeled: list[dict] = []
    for item in items:
        start_ms = item.get("start_ms")
        end_ms = item.get("end_ms")
        text = item.get("word", item.get("text", ""))
        if not isinstance(start_ms, (int, float)) or not isinstance(end_ms, (int, float)):
            continue
        if not isinstance(text, str) or not text.strip():
            continue

        start = max(0.0, float(start_ms) / 1000)
        end = max(start, float(end_ms) / 1000)
        labeled.append({
            "start_ms": int(round(start_ms)),
            "end_ms": int(round(end_ms)),
            "text": text,
            "speaker": _speaker_for_interval(start, end, diarization_turns),
        })

    grouped: list[dict] = []
    for item in labeled:
        if grouped and grouped[-1]["speaker"] == item["speaker"]:
            grouped[-1]["end_ms"] = item["end_ms"]
            grouped[-1]["tokens"].append(item["text"])
        else:
            grouped.append({
                "start_ms": item["start_ms"],
                "end_ms": item["end_ms"],
                "speaker": item["speaker"],
                "tokens": [item["text"]],
            })

    return [
        {
            "index": index,
            "start_ms": item["start_ms"],
            "end_ms": item["end_ms"],
            "text": _join_tokens(item["tokens"]),
            "speaker": item["speaker"],
        }
        for index, item in enumerate(grouped)
    ]
