# Songcut User Guide

## Overview

Songcut has two modes: `Cut` and `Sub`.

- `Cut`: Extracts singing sections from videos
- `Sub`: Aligns lyrics with a video to create subtitles

After loading a video, choose `Cut` or `Sub` in the tabs at the top of the window to select the task.

## Choose a path

- To make song clips or timestamp comments, use [Cut](#cut).
- To make a subtitled video, use [`Export`](#export-a-subtitled-video) in [Sub](#sub).
- See [Keyboard shortcuts](KEYBOARD_SHORTCUTS.md) for keyboard controls.

### Cut Mode

In Cut, review detected singing sections as segments and edit their titles, boundaries, and export selection.
Use the waveform and preview to make one clip or timestamp entry per song.

![Cut mode editor](image/screenshot-cut.png)

### Sub Mode

In Sub, align lyrics to the audio and edit text, timing, and position across subtitle timelines.
After setting subtitle styles, export a subtitled video and one subtitle file set per timeline.

![Sub mode editor](image/screenshot-sub.png)

## Common Operations

### Preparation

If Songcut cannot find FFmpeg at startup, install it with the following command and restart Songcut.

```powershell
winget install Gyan.FFmpeg
```

To prepare a YouTube video, install `yt-dlp` and Deno, then run the following command.

```powershell
winget install yt-dlp.yt-dlp
winget install DenoLand.Deno
yt-dlp --write-info-json --write-comments "<YouTube URL>"
```

With `--write-info-json` and `--write-comments`, Cut can use timestamps from the video description or downloaded comments as guide candidates.

### Loading a Video

Click `Load` and choose a video file to show it in the upper preview and lower timeline.

![Loading and analyzing a video](image/load-analyze.png)

Waveform preparation starts after loading, and completed portions can be used for seeking while preparation continues.
Cut and Sub each have an independent **Waveform display** choice under `Settings > Cut` or `Settings > Sub` with `RMS`, `Peak Envelope`, `Peak + RMS`, and `Symmetric Peak`.

For videos with Opus audio, Songcut prepares fast-seeking AAC scratch audio in the background.
Normal playback and export continue to use the source video, and scratch audio can be disabled with **Use scratch audio proxy** in Settings.

### Adjusting Segments

Drag the left or right handle of a timeline section to change its start or end.
Select a section to enter a start time and either a duration or an end time in the **Segment inspector** on the right.

Playback, boundary preview, boundary navigation, and zoom work the same way in Cut and Sub.
See [KEYBOARD_SHORTCUTS.md](KEYBOARD_SHORTCUTS.md) for the complete keyboard reference.

![Shared playback and boundary tools](image/tools.png)

## Cut

Cut is for making one clip per song from a stream or other long video.
Load a video and click `Analyze` to open a dialog where you can optionally paste a timestamp comment; confirm it to show detected singing sections as segments.
If a matching `.info.json` file exists beside the video, timestamp comment candidates from the video description or downloaded comments are offered when the video is loaded.

Select an analyzed segment to edit its title, start and end times, and export checkbox.
The `Segment` menu can add or remove segments, sort them by start time, and change the export selection in one operation.
When using a timestamp guide, remove entries that are not songs, such as the stream start, MC, promotions, chat, or announcements, before applying it.

![Cut segment editing controls](image/edit-segment.png)

In Cut, `Q` and `E` nudge the nearest boundary by the configured number of seconds, while `W` and `S` select the previous and next Cut segment.
Only the Cut settings include **Amplitude range**, which can switch between the standard view and the singing/MC contrast view.

### Transcribe with Whisper

Automatic transcription after Cut analysis is off for new projects.
To use it, enable it under `Settings > Cut`, then choose the Whisper model, language, and device under `Settings > AI Models`.

After segment analysis, press **Transcribe / Re-transcribe** under `Settings > Cut` to run transcription later.
Press it again after changing the model or language to transcribe with the new settings.

### Export from Cut

Click `Export` to write a video clip for each checked segment.
The export review shows the actual filenames and the planned smart-rendering mode for each clip, and unsupported sources or ranges automatically fall back to a full re-encode.
You can group the clips and an optional timestamp file in a child folder named after the source video.

The **Automatically normalize audio volume** option in the export dialog is on by default and adjusts the output audio to the target value (default −1.0 dBTP). The per-clip results are written to a `gain_report.txt` in the output folder.

Click `Export TS` to copy the checked sections as timestamp text.
The `Export` menu can also copy Timestamp Comment, YouTube Chapters, TSV/Excel, CSV, or Audacity Labels directly.

## Sub

Sub is for editing timed lyrics and making a subtitled video.
Start analysis or export from the top toolbar, then refine subtitles on the subtitle timelines and in the style settings.

![Main Sub editing controls](image/sub-overview.png)

### Analyze Lyrics

When you load a video in Sub and click `Analyze`, Songcut prepares any required models and then shows the `Paste lyrics` dialog.
On the first run, downloading the AI models required by the selected alignment algorithm can take some time.

![Paste lyrics](image/sub-lyrics.png)

Paste the lyrics one line at a time and click the dialog's `Analyze` button to start alignment.

![Lyrics analysis progress](image/sub-analysis.png)

When analysis finishes, review the displayed BPM, confidence statistics, and lines highlighted as low-confidence outliers.
Review the beat grid drawn on the timeline, and adjust boundaries manually if a beat-detection warning appears.

### Edit Text, Timing, and Timelines

Double-click a lyric label to edit its text, and drag a section handle to edit its timing.
Selecting a section shows the **Segment inspector** on the right, with `Timing`, `Style`, and `Display elements` sections. Use `Timing` to edit its start time and duration or end time, and `Style` to choose whether the section inherits its timeline style or uses custom settings. Changes apply immediately.
Custom settings provide the same typography, position, saved-style, and output-effect controls as the timeline `Style` dialog.
A zigzag line to the left of the lyric label identifies a section that uses custom settings.

Click `Timeline` and choose one of the nine subtitle positions to add a subtitle timeline.
Click a timeline to make it active; you can create up to three. `W` and `S` move through sections inside the active timeline.

Click `Segment` to open a dialog where you choose the destination timeline and a position (timeline start, before or after the selected segment, or the playback position) to add a four-beat subtitle section. If no grid-aligned space is available, it cannot be added.
The toolbar trash button removes the selected subtitle section, while the trash button beside a timeline name removes that timeline.
In Sub, `Q` and `E` move the selected boundary to the previous or next quarter beat.

### Set a Style

Click a timeline's `Style` button to show `Subtitle style`.

![Subtitle style](image/sub-style.png)

In `Saved styles`, choose a preset and click `Apply`, or enter a style name and click `Save` to apply or save a preset.
`Typeface and colors` sets the font, text color, background color, outline color, bold, and italic options, while `Display position` sets the position, size, outline width, shadow, and horizontal and vertical margins.

`Output effects` provides 97 effects grouped by category. Choose an effect to edit its available values, colors, palette, and timing; the controls and limits come from the installed effect package. The sample player shows the selected effect from the online catalog. Effects are applied only during export and are not shown in the editing preview.

### Export a subtitled video

Click `Export` and choose an output folder to create a subtitled video and one subtitle file set per timeline.
The subtitled video is named `<video>-subtitled.mp4`, and timelines are written as `<video>-sub-1.srt`, `<video>-sub-2.srt`, and so on.
Each SRT has a matching style file such as `<video>-sub-1.srt.style`.
The complete styled subtitles are also written as `<video>-subtitles.ass`; use this file when per-section styles or effects must be preserved.

### Export subtitles into one file

Click `Export Sub` to open a dialog where you can choose the subtitle format (`SRT`, `LRC`, or `ASS`) and one or more timelines that contain subtitles. The selected timelines are combined into one subtitle file.
This is separate from `Export`, which creates the subtitled video and one file set per timeline. Choose `LRC` when word- or character-level timing should be retained.

## Settings

The settings dialog has four tabs: `Common`, `Cut`, `Sub`, and `AI Models`.

### Common

The Common tab sets the scratch preview duration, scratch audio proxy, display language, FFmpeg check, and decoder recovery.
Under `Language`, choose `System default`, `English`, or `Japanese` to apply the new display language the next time Songcut starts.
If video decoding stops, use **Decoder recovery** to reload this app session with the software decoder.

### Cut

The Cut tab sets the waveform display, amplitude range, singing-analysis device, local boundary refinement, automatic Whisper transcription, and export filename template.
The export filename template accepts `{index}`, `{title}`, `{id}`, `{start}`, and `{end}`, and automatic Whisper transcription is off for new projects.

### Sub

The Sub tab sets the waveform display and lets you choose the lyrics alignment algorithm, `Songcut Standard` or `Uta-Align`.

### AI Models

The current default Whisper model in the AI Models tab is **Large v3 Turbo INT8 (OpenVINO)**.
Choose the Whisper language and device, then press `Prepare Whisper Model` when the selected model is not ready.
Sub analysis uses `Demucs` to separate vocals, so press `Prepare Demucs Model` when needed.
`MMS` is used only for lyric-onset refinement in `Songcut Standard` and is not used by `Uta-Align`.

## Information, Saving, and Recovery

### View Information

Click `Information` in the top toolbar to see the current mode, media-preparation status, running tasks, and failed tasks. If waveform preparation failed, use `Retry` in the dialog. Closing a failed-task row only hides it; it does not delete the project or media.

### Saving and Recovery

Songcut autosaves edits beside the video, using a separate sidecar for each mode.
Cut projects use a `video.mp4.songcut` sidecar, while Sub projects use a separate `video.mp4.sub.songcut` sidecar.
Use `Ctrl+S` or `File > Save Project Now` to save immediately.

If recovery data is available after an abnormal exit, choose `Recover` or `Discard` at the next launch.
After moving or renaming the video, use `File > Relink Source` to choose the new file.
