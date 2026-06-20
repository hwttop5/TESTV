import json
import os
import sys

from faster_whisper import WhisperModel


def transcribe_one(model: WhisperModel, audio_path: str) -> dict:
    segments, info = model.transcribe(audio_path, vad_filter=True, beam_size=1)

    payload = {
        "audio_path": audio_path,
        "ok": True,
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
    return payload


def main() -> int:
    if len(sys.argv) < 4:
        raise SystemExit(
            "usage: faster-whisper-transcribe-batch.py <model> <compute_type> <audio_path> [audio_path...]"
        )

    model_name = sys.argv[1]
    compute_type = sys.argv[2]
    audio_paths = sys.argv[3:]

    device = os.environ.get("FASTER_WHISPER_DEVICE", "cpu")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    results = []

    for audio_path in audio_paths:
        try:
            results.append(transcribe_one(model, audio_path))
        except Exception as exc:
            results.append(
                {
                    "audio_path": audio_path,
                    "ok": False,
                    "error": str(exc),
                }
            )

    print(json.dumps({"results": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
