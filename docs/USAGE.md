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

# Loading and Analyzing a Video

![Load and analyze](image/load-analyze.png)

Click **Load** and select a video file. If you already have a timestamp comment,
paste it into the **Paste timestamp comment here** field.

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

## Fine-Tuning Segment Boundaries

Use the boundary nudge controls to make small adjustments to segment boundaries.
Enter a different number of seconds to change the adjustment amount. The app
automatically chooses which boundary to adjust based on the current playback
position.

## Timeline Zoom

Use the zoom controls to zoom the timeline in or out.

## Playback Controls

Use the standard video playback controls to play, pause, or return to the start.
You can also jump between segment boundaries.

# Exporting

Click **Export** to export a separate video clip for each selected segment.
Click **Export TS** to copy the selected segments to the clipboard as a
timestamp comment.
