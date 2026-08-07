songcut portable package

Run:
  songcut.exe

Keep all extracted folders together when moving songcut.

The Full archive may include ffmpeg, ffprobe, and AI models under third_party\
and models\. The standard archive leaves those folders empty.

If songcut reports that ffmpeg is missing, install FFmpeg or place ffmpeg.exe
and ffprobe.exe under third_party\ffmpeg\. Files available on PATH are also
detected.

Whisper, Demucs, and MMS models can be prepared explicitly from Settings.
Downloaded models and caches are stored under %LOCALAPPDATA%\songcut, so the
extracted package can remain read-only.

Open Help > Japanese Guide or Help > English Guide for instructions. Cut mode
creates clips and timestamp comments. Sub mode creates lyric-subtitled videos.
