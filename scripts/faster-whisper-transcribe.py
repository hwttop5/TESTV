import json
import os
import sys

from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("usage: faster-whisper-transcribe.py <audio_path> [model] [compute_type]")

    audio_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "small"
    compute_type = sys.argv[3] if len(sys.argv) > 3 else "int8"

    device = os.environ.get("FASTER_WHISPER_DEVICE", "cpu")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(audio_path, vad_filter=True, beam_size=1)

    payload = {
        "text": "",
        "language": getattr(info, "language", "unknown"),
        "segments": [],
    }

    text_parts = []
    for segment in segments:
        text = (segment.text or "").strip()
        if not text:
            continue

        text_parts.append(text)
        payload["segments"].append(
            {
                "text": text,
                "start": float(segment.start),
                "end": float(segment.end),
            }
        )

    payload["text"] = " ".join(text_parts).strip()
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
