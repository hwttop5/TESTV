import datetime as dt
import json
import re
import sys
from typing import Any

import requests


USER_AGENT = "Mozilla/5.0"
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def extract_json_object(source: str, marker: str) -> dict[str, Any]:
    match = re.search(re.escape(marker), source)
    if not match:
        raise RuntimeError(f"Missing marker: {marker}")

    start = match.end()
    brace_count = 0
    in_string = False
    escaped = False

    for index, char in enumerate(source[start:], start):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            brace_count += 1
        elif char == "}":
            brace_count -= 1
            if brace_count == 0:
                return json.loads(source[start : index + 1])

    raise RuntimeError("Could not parse JSON object")


def walk(value: Any, lockups: list[dict[str, Any]], continuations: list[str]) -> None:
    if isinstance(value, dict):
        if "lockupViewModel" in value:
            lockups.append(value["lockupViewModel"])

        continuation = value.get("continuationCommand", {}).get("token")
        if continuation:
            continuations.append(continuation)

        for child in value.values():
            walk(child, lockups, continuations)
    elif isinstance(value, list):
        for child in value:
            walk(child, lockups, continuations)


def text_values(value: Any) -> list[str]:
    values: list[str] = []

    def collect(item: Any) -> None:
        if isinstance(item, dict):
            content = item.get("content")
            if isinstance(content, str) and content.strip():
                values.append(content.strip())
            for child in item.values():
                collect(child)
        elif isinstance(item, list):
            for child in item:
                collect(child)

    collect(value)
    return values


def find_watch(lockup: dict[str, Any]) -> tuple[str | None, int | None]:
    command = (
        lockup.get("rendererContext", {})
        .get("commandContext", {})
        .get("onTap", {})
        .get("innertubeCommand", {})
    )
    endpoint = command.get("watchEndpoint", {})
    return endpoint.get("videoId") or lockup.get("contentId"), endpoint.get("index")


def title(lockup: dict[str, Any]) -> str:
    return (
        lockup.get("metadata", {})
        .get("lockupMetadataViewModel", {})
        .get("title", {})
        .get("content", "")
        .strip()
    )


def best_thumbnail(lockup: dict[str, Any], video_id: str) -> str:
    sources = (
        lockup.get("contentImage", {})
        .get("thumbnailViewModel", {})
        .get("image", {})
        .get("sources", [])
    )
    valid_sources = [source for source in sources if source.get("url")]
    valid_sources.sort(key=lambda source: (source.get("width", 0) * source.get("height", 0)), reverse=True)
    return valid_sources[0]["url"] if valid_sources else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def parse_relative_date(text: str) -> str | None:
    now = dt.datetime.now(dt.UTC)
    normalized = text.replace(" ", "")
    patterns = [
        (r"(\d+)(?:日|天)前", "days"),
        (r"(\d+)日前", "days"),
        (r"(\d+)週間前", "weeks"),
        (r"(\d+)周前", "weeks"),
        (r"(\d+)(?:か月|ヶ月|个月|月)前", "months"),
        (r"(\d+)年前", "years"),
        (r"(\d+)days?ago", "days"),
        (r"(\d+)weeks?ago", "weeks"),
        (r"(\d+)months?ago", "months"),
        (r"(\d+)years?ago", "years"),
    ]

    for pattern, unit in patterns:
        match = re.search(pattern, normalized, re.IGNORECASE)
        if not match:
            continue

        amount = int(match.group(1))
        if unit == "days":
            date = now - dt.timedelta(days=amount)
        elif unit == "weeks":
            date = now - dt.timedelta(weeks=amount)
        elif unit == "months":
            date = now - dt.timedelta(days=amount * 30)
        else:
            date = now - dt.timedelta(days=amount * 365)

        return date.replace(hour=0, minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")

    return None


def published_at(lockup: dict[str, Any]) -> str:
    metadata = lockup.get("metadata", {})
    for value in text_values(metadata):
        parsed = parse_relative_date(value)
        if parsed:
            return parsed

    return "1970-01-01T00:00:00Z"


def playlist_count(page: str) -> int | None:
    match = re.search(r'"playlist_count"\s*:\s*(\d+)', page)
    if match:
        return int(match.group(1))
    match = re.search(r'"numVideosText".*?"content":"([\d,]+)', page)
    if match:
        return int(match.group(1).replace(",", ""))
    return None


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: fetch-playlist-youtubei.py <playlist-url>")

    playlist_url = sys.argv[1]
    session = requests.Session()
    response = session.get(playlist_url, headers={"user-agent": USER_AGENT}, timeout=30)
    response.raise_for_status()
    page = response.text

    api_key = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', page).group(1)
    client_version = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', page).group(1)
    visitor_match = re.search(r'"VISITOR_DATA":"([^"]+)"', page) or re.search(r'"visitorData":"([^"]+)"', page)
    visitor_data = visitor_match.group(1) if visitor_match else ""

    current = extract_json_object(page, "var ytInitialData = ")
    seen: dict[str, dict[str, Any]] = {}
    used_continuations: set[str] = set()
    pages = 0

    while True:
        lockups: list[dict[str, Any]] = []
        continuations: list[str] = []
        walk(current, lockups, continuations)

        for lockup in lockups:
            video_id, index = find_watch(lockup)
            if not video_id or video_id in seen:
                continue

            seen[video_id] = {
                "id": video_id,
                "title": title(lockup) or "Untitled YouTube video",
                "publishedAt": published_at(lockup),
                "thumbnailUrl": best_thumbnail(lockup, video_id),
                "videoUrl": f"https://www.youtube.com/watch?v={video_id}",
                "isAvailable": True,
                "playlistIndex": index,
            }

        next_token = next((token for token in continuations if token not in used_continuations), None)
        if not next_token:
            break

        used_continuations.add(next_token)
        pages += 1
        body = {
            "context": {
                "client": {
                    "clientName": "WEB",
                    "clientVersion": client_version,
                    "visitorData": visitor_data,
                }
            },
            "continuation": next_token,
        }
        api_response = session.post(
            f"https://www.youtube.com/youtubei/v1/browse?key={api_key}",
            headers={
                "user-agent": USER_AGENT,
                "content-type": "application/json",
                "x-youtube-client-name": "1",
                "x-youtube-client-version": client_version,
            },
            json=body,
            timeout=30,
        )
        api_response.raise_for_status()
        current = api_response.json()

    entries = sorted(
        seen.values(),
        key=lambda item: item["playlistIndex"] if isinstance(item.get("playlistIndex"), int) else 10**9,
    )
    print(json.dumps({"playlistCount": playlist_count(page), "entries": entries}, ensure_ascii=False))


if __name__ == "__main__":
    main()
