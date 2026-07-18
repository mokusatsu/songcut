from __future__ import annotations

import html
import json
from pathlib import Path


def format_hms(seconds: float | int | str) -> str:
    whole_seconds = int(round(float(seconds)))
    hours, remainder = divmod(max(0, whole_seconds), 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}"


def write_review_html(segments_json: Path, video: Path, target: Path) -> None:
    payload = json.loads(segments_json.read_text(encoding="utf-8"))
    segments = payload.get("segments", [])
    video_src = video.resolve().as_uri()
    rows = []
    for segment in segments:
        start = float(segment.get("start", 0))
        end = float(segment.get("end", 0))
        name = segment.get("title") or segment.get("name") or segment.get("filename_stem") or segment.get("id", "")
        rows.append(
            "<tr>"
            f"<td>{html.escape(segment.get('id', ''))}</td>"
            f"<td><input class=\"name\" data-field=\"title\" value=\"{html.escape(str(name))}\"></td>"
            f"<td><input data-field=\"start\" value=\"{format_hms(start)}\"></td>"
            f"<td><input data-field=\"end\" value=\"{format_hms(end)}\"></td>"
            f"<td>{html.escape(str(segment.get('confidence', '')))}</td>"
            f"<td>{html.escape(str(segment.get('source', '')))}</td>"
            f"<td><button data-seek=\"{start}\">Seek</button></td>"
            "</tr>"
        )

    document = f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>songcut review</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 24px; color: #1f2937; }}
video {{ width: min(100%, 960px); background: #111827; display: block; margin-bottom: 16px; }}
table {{ border-collapse: collapse; width: min(100%, 960px); }}
th, td {{ border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }}
input {{ width: 7rem; }}
input.name {{ width: 18rem; }}
button {{ cursor: pointer; }}
textarea {{ width: min(100%, 960px); height: 220px; margin-top: 16px; font-family: ui-monospace, monospace; }}
</style>
<video id="video" controls src="{video_src}"></video>
<table id="segments">
<thead><tr><th>ID</th><th>Name</th><th>Start</th><th>End</th><th>Confidence</th><th>Source</th><th></th></tr></thead>
<tbody>
{''.join(rows)}
</tbody>
</table>
<textarea id="json" spellcheck="false">{html.escape(json.dumps(segments, ensure_ascii=False, indent=2))}</textarea>
<script>
const video = document.getElementById('video');
const textarea = document.getElementById('json');
const originalSegments = {json.dumps(segments, ensure_ascii=False)};
function parseTimecode(value) {{
  const text = String(value || '').trim();
  if (/^\\d+(\\.\\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':').map(part => Number(part));
  if (parts.some(part => Number.isNaN(part))) return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}}
function formatTimecode(seconds) {{
  const whole = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return `${{hours}}:${{String(minutes).padStart(2, '0')}}:${{String(secs).padStart(2, '0')}}`;
}}
document.querySelectorAll('button[data-seek]').forEach(button => {{
  button.addEventListener('click', () => {{
    video.currentTime = Number(button.dataset.seek || 0);
    video.play();
  }});
}});
document.querySelectorAll('input[data-field]').forEach(input => {{
  input.addEventListener('change', () => {{
    const rows = [...document.querySelectorAll('#segments tbody tr')];
    const updated = rows.map((row, index) => {{
      const cells = row.querySelectorAll('td');
      const title = row.querySelector('input[data-field="title"]').value.trim();
      const start = parseTimecode(row.querySelector('input[data-field="start"]').value);
      const end = parseTimecode(row.querySelector('input[data-field="end"]').value);
      row.querySelector('input[data-field="start"]').value = formatTimecode(start);
      row.querySelector('input[data-field="end"]').value = formatTimecode(end);
      const original = originalSegments[index] || {{}};
      return {{
        ...original,
        id: cells[0].textContent,
        title,
        start,
        end,
        start_timecode: formatTimecode(start),
        end_timecode: formatTimecode(end),
        duration: Math.max(0, end - start),
        confidence: Number(cells[4].textContent),
        source: cells[5].textContent,
        user_edited: true
      }};
    }});
    textarea.value = JSON.stringify(updated, null, 2);
  }});
}});
</script>
</html>
"""
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(document, encoding="utf-8")
