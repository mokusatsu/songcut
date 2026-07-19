# Preparing a Video File

Download the video file in advance using a tool such as `yt-dlp`. On Windows,
you can install the required tools with the following commands:

```powershell
winget install yt-dlp.yt-dlp
winget install DenoLand.Deno
```

After installation, restart your terminal and download the video:

```powershell
yt-dlp "<YouTube URL>"
```

# Installing FFmpeg

If the app reports that it cannot find FFmpeg at startup, install it with the
following command, then restart the app:

```powershell
winget install Gyan.FFmpeg
```

# Loading and Analyzing a Video

![Load and analyze](image/load-analyze.png)

Click **Load** and select a video file. If you already have a timestamp comment,
paste it into the **Paste timestamp comment here** field.

If the video was downloaded with a matching yt-dlp `.info.json`, songcut checks
the video description and downloaded comments for timestamp guides. To include
that metadata when downloading, use:

```powershell
yt-dlp --write-info-json --write-comments "<YouTube URL>"
```

When one guide candidate is found, songcut opens it directly for editing. When
two are found, choose either the video description or a timestamp comment first.
Before applying it, remove entries that are not songs, such as the stream start,
MC, promotions, chat, or announcements. **Apply to guide** replaces the guide
field; closing, cancelling, or skipping leaves its current contents unchanged.

Click **Analyze** to start detecting singing segments. When timestamp guide text
is provided, the start time of each segment is taken from the timestamps and
its end time is detected automatically.

# Editing Video Segments

![Edit a segment](image/edit-segment.png)

The segment list appears at the bottom of the window. Click a row to select that
segment. Click its title to edit it. Titles are filled in automatically when
timestamp guide text is provided.

Click the waveform timeline to seek to a different point in the video. Drag the
left and right handles on the segment timeline to adjust the segment's start and
end times.

Use the checkbox for each segment to choose whether it is included when
exporting video clips or a timestamp comment.

# Useful Editing Tools

![Editing tools](image/tools.png)

## Segment Boundary Preview

Use the boundary preview controls to play the beginning or end of the selected
segment. Enter a different number of seconds to change the preview duration.
The value is restored the next time the application starts.

## Fine-Tuning Segment Boundaries

Use the boundary nudge controls to make small adjustments to segment boundaries.
Enter a different number of seconds to change the adjustment amount. The app
automatically chooses which boundary to adjust based on the current playback
position. The default is 0.5 seconds, and the value is restored the next time
the application starts.

## Timeline Zoom

Use the zoom controls to zoom the timeline in or out.

## Scratch Audio Proxy

For movies with Opus audio, songcut prepares a fast-seeking AAC scratch proxy
in the background after **Load**. Scratch preview continues to use the original
audio until the proxy is ready, then uses the proxy from the next drag position.
Normal playback and exported clips always use the loaded movie.

The proxy is enabled by default. Disable **Settings > Use Scratch Audio Proxy**
when scratch preview must use the source audio without lossy conversion. The
choice is restored the next time the application starts.

## Playback Controls

Use the standard video playback controls to play, pause, or return to the start.
You can also jump between segment boundaries.

## Keyboard Shortcuts
![keyboard shortcut](image/keyboard-shortcuts.en.png)

| Key | Action |
| --- | --- |
| `A` / `D` | Play the start / end boundary of the selected segment |
| `W` / `S` | Select the previous / next segment |
| `Q` / `E` | Nudge the nearest boundary left / right |
| `Space` | Toggle play / pause |
| `Ctrl+A` / `Ctrl+D` | Jump to the previous / next boundary |
| `Z` / `X` / `C` | Zoom out / reset to 100% / zoom in |

Shortcuts do not repeat when a key is held down. They are disabled while a
form control has focus, while an IME is composing text, and while a dialog is
open. Segment selection stops at the first and last rows instead of wrapping.

The vertical pane split position is also restored the next time the application
starts.

# Exporting

Click **Export** to export a separate video clip for each selected segment.
Click **Export TS** to copy the selected segments to the clipboard as a
timestamp comment.
