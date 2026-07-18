const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const root = path.join(repo, "dist", "songcut-win-x64");
const input = path.join(repo, "out", "e2e_input.mp4");
const outputDir = path.join(repo, "out", "e2e-export");
const initialScreenshotPath = path.join(repo, "out", "e2e-initial-render.png");
const loadedScreenshotPath = path.join(repo, "out", "e2e-loaded-layout.png");
const reviewScreenshotPath = path.join(repo, "out", "e2e-export-review.png");
const screenshotPath = path.join(repo, "out", "e2e-final.png");
const logPath = path.join(repo, "out", "e2e-dist-smoke.log");
const port = Number(process.env.SONGCUT_E2E_DEBUG_PORT || 9230);

fs.mkdirSync(path.join(repo, "out"), { recursive: true });
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(logPath, "");

function log(message, value) {
  const line = value === undefined ? message : `${message} ${JSON.stringify(value)}`;
  fs.appendFileSync(logPath, `${line}\n`);
  console.log(line);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureTestVideo() {
  if (fs.existsSync(input)) return;
  execFileSync(
    path.join(repo, "third_party", "ffmpeg", "bin", "ffmpeg.exe"),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=640x360:r=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=6",
      "-t",
      "6",
      "-metadata",
      "comment=0:00-0:04 Smoke Song",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      input
    ],
    { cwd: repo, stdio: "inherit" }
  );
}

async function getPage() {
  for (let index = 0; index < 80; index += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page");
      if (page) return page;
    } catch {
      // Retry until Electron enables the remote debugging endpoint.
    }
    await sleep(500);
  }
  throw new Error("CDP page not found.");
}

function connect(webSocketUrl) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(webSocketUrl);
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  return new Promise((resolve, reject) => {
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const messageId = ++id;
          ws.send(JSON.stringify({ id: messageId, method, params }));
          return new Promise((innerResolve) => pending.set(messageId, innerResolve));
        },
        close() {
          ws.close();
        }
      });
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.result.exceptionDetails) {
    throw new Error(JSON.stringify(result.result.exceptionDetails));
  }
  return result.result.result.value;
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, expression);
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`Timeout waiting for ${label}; last=${JSON.stringify(last)}`);
}

function assertPass(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
    throw new Error(`${message}${suffix}`);
  }
}

async function clickButton(cdp, text, occurrence = 0) {
  const ok = await evaluate(
    cdp,
    `(() => {
      const buttons = [...document.querySelectorAll("button")].filter((button) => (button.innerText || button.title).trim() === ${JSON.stringify(text)});
      const button = buttons[${occurrence}];
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!ok) throw new Error(`Button not found: ${text}`);
}

async function clickAt(cdp, selector, xRatio = 0.5, yRatio = 0.5) {
  const point = await evaluate(
    cdp,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width * ${xRatio},
        y: rect.top + rect.height * ${yRatio}
      };
    })()`
  );
  if (!point) throw new Error(`Selector not found: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(300);
}

async function clickSelector(cdp, selector) {
  const ok = await evaluate(
    cdp,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`
  );
  if (!ok) throw new Error(`Selector not found: ${selector}`);
}

async function tableRows(cdp) {
  return evaluate(
    cdp,
    `[...document.querySelectorAll(".segment-list tbody tr")].map((row) => [...row.children].map((cell) => cell.innerText || cell.querySelector("input")?.checked || ""))`
  );
}

async function setGuideText(cdp, text) {
  const ok = await evaluate(
    cdp,
    `(() => {
      const textarea = document.querySelector("textarea");
      if (!textarea) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  if (!ok) throw new Error("Guide textarea not found.");
}

async function editFirstSegmentTitle(cdp, text) {
  await clickSelector(cdp, ".segment-list .title-edit-button");
  await waitFor(cdp, `!!document.querySelector(".segment-list .title-edit-input")`, 10_000, "title editor");
  const ok = await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector(".segment-list .title-edit-input");
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter"
      }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      input.blur();
      return true;
    })()`
  );
  if (!ok) throw new Error("Editable segment title not found.");
  await waitFor(cdp, `!document.querySelector(".segment-list .title-edit-input")`, 10_000, "title editor commit");
}

async function dropVideo(cdp) {
  const ok = await evaluate(
    cdp,
    `(() => {
      const main = document.querySelector("main");
      if (!main || !window.songcut?.pathForFile) return false;
      const data = new DataTransfer();
      data.items.add(new File(["songcut-e2e"], "e2e_input.mp4", { type: "video/mp4" }));
      main.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
      main.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
      return true;
    })()`
  );
  if (!ok) throw new Error("Drop target or preload bridge not found.");
}

async function timelineMetrics(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const viewport = document.querySelector(".timeline-scroll-area .scroll-area-viewport");
      const content = document.querySelector(".timeline-content");
      const waveform = document.querySelector(".waveform-timeline");
      const segment = document.querySelector(".segment-timeline");
      const playhead = document.querySelector(".timeline-playhead");
      const horizontalBars = [...document.querySelectorAll(".scroll-area-scrollbar-horizontal")]
        .filter((node) => node.closest(".timeline-scroll-area"));
      const rect = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      return {
        viewportCount: document.querySelectorAll(".timeline-scroll-area .scroll-area-viewport").length,
        horizontalBarCount: horizontalBars.length,
        sharedViewport: !!viewport && waveform?.closest(".scroll-area-viewport") === viewport && segment?.closest(".scroll-area-viewport") === viewport,
        clientWidth: viewport?.clientWidth ?? 0,
        scrollWidth: viewport?.scrollWidth ?? 0,
        scrollLeft: viewport?.scrollLeft ?? 0,
        contentWidth: content?.getBoundingClientRect().width ?? 0,
        waveformWidth: waveform?.getBoundingClientRect().width ?? 0,
        segmentWidth: segment?.getBoundingClientRect().width ?? 0,
        playheadCount: document.querySelectorAll(".timeline-playhead").length,
        viewportRect: rect(viewport),
        waveformRect: rect(waveform),
        segmentRect: rect(segment),
        playheadRect: rect(playhead),
        playheadViewportRatio: viewport && playhead
          ? (playhead.getBoundingClientRect().left - viewport.getBoundingClientRect().left) / Math.max(1, viewport.getBoundingClientRect().width)
          : null
      };
    })()`
  );
}

async function layoutMetrics(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const box = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      const control = document.querySelector(".control-pane");
      const app = document.querySelector(".app");
      return {
        appRows: app ? getComputedStyle(app).gridTemplateRows : "",
        videoPane: box(".video-pane"),
        splitter: box(".splitter"),
        controlPane: box(".control-pane"),
        video: box("video"),
        controlBackground: control ? getComputedStyle(control).backgroundColor : ""
      };
    })()`
  );
}

async function videoState(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const video = document.querySelector("video");
      if (!video) return null;
      return { currentTime: video.currentTime, duration: video.duration, paused: video.paused, src: video.currentSrc };
    })()`
  );
}

async function dragSplitter(cdp, deltaY) {
  const point = await evaluate(
    cdp,
    `(() => {
      const splitter = document.querySelector(".splitter");
      if (!splitter) return null;
      const rect = splitter.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`
  );
  if (!point) throw new Error("Splitter not found.");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(120);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y + deltaY, button: "left" });
  await sleep(250);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y + deltaY, button: "left", clickCount: 1 });
  await sleep(700);
}

async function seekWaveform(cdp, ratio) {
  await clickAt(cdp, ".waveform-timeline", ratio, 0.5);
  await sleep(700);
  let state = await videoState(cdp);
  if (state && state.currentTime > 2) return { ...state, method: "cdp-mouse" };

  const dispatched = await evaluate(
    cdp,
    `(() => {
      const shell = document.querySelector(".waveform-timeline");
      if (!shell) return false;
      const rect = shell.getBoundingClientRect();
      shell.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * ${ratio},
        clientY: rect.top + rect.height * 0.5
      }));
      return true;
    })()`
  );
  if (!dispatched) throw new Error("Waveform timeline not found.");
  await sleep(700);
  state = await videoState(cdp);
  return { ...state, method: "dom-mouseevent-fallback" };
}

async function dragWaveformPixels(cdp, deltaX) {
  const data = await evaluate(
    cdp,
    `(() => {
      const waveform = document.querySelector(".waveform-timeline");
      const viewport = document.querySelector(".timeline-scroll-area .scroll-area-viewport");
      const video = document.querySelector("video");
      if (!waveform || !viewport || !video) return null;
      const rect = waveform.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const sx = Math.max(viewportRect.left + 24, Math.min(rect.left + rect.width * 0.22, viewportRect.right - ${deltaX} - 24));
      const sy = rect.top + rect.height / 2;
      const startTime = ((sx - viewportRect.left + viewport.scrollLeft) / viewport.scrollWidth) * video.duration;
      return { sx, sy, tx: sx + ${deltaX}, ty: sy, startTime };
    })()`
  );
  if (!data) throw new Error("Waveform timeline not found for drag seek.");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: data.sx, y: data.sy });
  await sleep(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: data.sx, y: data.sy, button: "left", clickCount: 1 });
  await sleep(100);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: data.tx, y: data.ty, button: "left" });
  await sleep(250);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: data.tx, y: data.ty, button: "left", clickCount: 1 });
  await sleep(700);
  const state = await videoState(cdp);
  const metrics = await timelineMetrics(cdp);
  return { ...state, startTime: data.startTime, seekDelta: state ? state.currentTime - data.startTime : null, metrics };
}

async function dragWaveformAtRightEdge(cdp) {
  const data = await evaluate(
    cdp,
    `(() => {
      const waveform = document.querySelector(".waveform-timeline");
      const viewport = document.querySelector(".timeline-scroll-area .scroll-area-viewport");
      const video = document.querySelector("video");
      if (!waveform || !viewport || !video) return null;
      const rect = waveform.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const sx = viewportRect.right - 18;
      const sy = rect.top + rect.height / 2;
      return { sx, sy, startScrollLeft: viewport.scrollLeft, startTime: video.currentTime };
    })()`
  );
  if (!data) throw new Error("Waveform timeline not found for edge drag.");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: data.sx, y: data.sy });
  await sleep(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: data.sx, y: data.sy, button: "left", clickCount: 1 });
  await sleep(950);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: data.sx, y: data.sy, button: "left" });
  await sleep(150);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: data.sx, y: data.sy, button: "left", clickCount: 1 });
  await sleep(500);
  const state = await videoState(cdp);
  const metrics = await timelineMetrics(cdp);
  return { ...state, startScrollLeft: data.startScrollLeft, startTime: data.startTime, metrics };
}

async function dragHandle(cdp, selector, ratio) {
  const data = await evaluate(
    cdp,
    `(() => {
      const handle = document.querySelector(${JSON.stringify(selector)});
      const viewport = document.querySelector(".timeline-scroll-area .scroll-area-viewport");
      if (!handle || !viewport) return null;
      const handleRect = handle.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      return {
        sx: Math.max(viewportRect.left + 3, Math.min(handleRect.left + handleRect.width / 2, viewportRect.right - 3)),
        sy: handleRect.top + handleRect.height / 2,
        tx: viewportRect.left + viewportRect.width * ${ratio},
        ty: handleRect.top + handleRect.height / 2
      };
    })()`
  );
  if (!data) throw new Error(`Drag handle not found: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: data.sx, y: data.sy });
  await sleep(50);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: data.sx,
    y: data.sy,
    button: "left",
    clickCount: 1
  });
  await sleep(100);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: data.tx,
    y: data.ty,
    button: "left"
  });
  await sleep(250);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: data.tx,
    y: data.ty,
    button: "left",
    clickCount: 1
  });
  await evaluate(
    cdp,
    `(() => {
      const handle = document.querySelector(${JSON.stringify(selector)});
      if (!handle) return false;
      handle.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: ${data.sx},
        clientY: ${data.sy},
        buttons: 1
      }));
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        clientX: ${data.tx},
        clientY: ${data.ty},
        buttons: 1
      }));
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        clientX: ${data.tx},
        clientY: ${data.ty}
      }));
      return true;
    })()`
  );
  await sleep(800);
}

async function waitForExportedFile() {
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const files = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter((name) => name.toLowerCase().endsWith(".mp4"))
      : [];
    if (files.length) {
      const stats = files.map((name) => ({
        name,
        bytes: fs.statSync(path.join(outputDir, name)).size
      }));
      if (stats.every((item) => item.bytes > 0)) return stats;
    }
    await sleep(500);
  }
  throw new Error("No exported mp4 appeared.");
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs))
  ]);
}

function probeDuration(filePath) {
  const output = execFileSync(
    path.join(repo, "third_party", "ffmpeg", "bin", "ffprobe.exe"),
    ["-hide_banner", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath],
    { cwd: repo, encoding: "utf-8" }
  );
  return Number(output.trim());
}

function captureWindowScreenshot(destination, processId) {
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class SongcutWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$handle = [IntPtr]::Zero
if ($env:SONGCUT_WINDOW_PID) {
  $process = Get-Process -Id ([int]$env:SONGCUT_WINDOW_PID) -ErrorAction SilentlyContinue
  if ($process -and $process.MainWindowHandle -ne [IntPtr]::Zero) {
    $handle = $process.MainWindowHandle
  }
}
if ($handle -eq [IntPtr]::Zero) {
  $process = Get-Process -Name "songcut-electron","songcut" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if ($process) {
    $handle = $process.MainWindowHandle
  }
}
if ($handle -eq [IntPtr]::Zero) {
  $handle = [SongcutWin32]::FindWindow($null, "songcut")
}
if ($handle -eq [IntPtr]::Zero) { throw "songcut window not found" }
[SongcutWin32]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 250
$rect = New-Object SongcutWin32+RECT
[SongcutWin32]::GetWindowRect($handle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "invalid songcut window rectangle" }
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$bitmap.Save($env:SONGCUT_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: repo,
    env: { ...process.env, SONGCUT_SCREENSHOT_PATH: destination, SONGCUT_WINDOW_PID: String(processId || "") },
    stdio: "pipe"
  });
}

async function capturePng(cdp, destination, label, processHandle) {
  try {
    const screenshot = await withTimeout(
      cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }),
      8000,
      `${label} CDP screenshot`
    );
    fs.writeFileSync(destination, Buffer.from(screenshot.result.data, "base64"));
    log(`${label}_SCREENSHOT_OK`, destination);
    return true;
  } catch (error) {
    log(`${label}_CDP_SCREENSHOT_SKIPPED`, { message: error.message });
  }

  try {
    captureWindowScreenshot(destination, processHandle?.pid);
    log(`${label}_SCREENSHOT_OK`, destination);
    return true;
  } catch (error) {
    log(`${label}_SCREENSHOT_FAIL`, { message: error.message });
    return false;
  }
}

function cleanup(processHandle, cdp) {
  try {
    if (cdp) cdp.close();
  } catch {}
  try {
    processHandle.kill();
  } catch {}
  for (const imageName of ["songcut.exe", "songcut-electron.exe"]) {
    try {
      execFileSync("taskkill", ["/IM", imageName, "/F"], { stdio: "ignore" });
    } catch {}
  }
}

(async () => {
  ensureTestVideo();
  const env = {
    ...process.env,
    SONGCUT_E2E_VIDEO: input,
    SONGCUT_E2E_OUTPUT_DIR: outputDir
  };
  const processHandle = spawn(
    path.join(root, "songcut.exe"),
    [`--remote-debugging-port=${port}`],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  processHandle.stdout.on("data", (data) => log(`[app-out] ${data.toString().trim()}`));
  processHandle.stderr.on("data", (data) => log(`[app-err] ${data.toString().trim()}`));

  let cdp;
  try {
    const page = await getPage();
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    await waitFor(
      cdp,
      `!!window.songcut && document.querySelectorAll(".timeline-scroll-area .scroll-area-viewport").length === 1 && document.body.innerText.includes("Load")`,
      30_000,
      "initial render"
    );
    const initial = await evaluate(
      cdp,
      `(() => ({
        buttons: [...document.querySelectorAll("button")].map((button) => button.innerText || button.title),
        hasBoundarySecondsInput: !!document.querySelector(".boundary-seconds-input[aria-label='Boundary seconds']"),
        hasBoundaryNudgeSecondsInput: !!document.querySelector(".boundary-nudge-seconds-input[aria-label='Boundary nudge seconds']"),
        timelineViewportCount: document.querySelectorAll(".timeline-scroll-area .scroll-area-viewport").length,
        hasSegmentList: !!document.querySelector(".segment-list .segment-list-body.scroll-area .scroll-area-viewport"),
        segmentHeaderOutsideScrollArea: !!document.querySelector(".segment-list > .segment-list-header") &&
          !document.querySelector(".segment-list > .segment-list-header")?.closest(".scroll-area"),
        text: document.body.innerText
      }))()`
    );
    log("RENDER_OK", initial);
    assertPass(
      initial.buttons.includes("Play start boundary") &&
        initial.buttons.includes("Play end boundary") &&
        initial.buttons.includes("Nudge nearest boundary left") &&
        initial.buttons.includes("Nudge nearest boundary right") &&
        initial.buttons.includes("Export TS") &&
        initial.hasSegmentList &&
        initial.segmentHeaderOutsideScrollArea &&
        initial.hasBoundarySecondsInput &&
        initial.hasBoundaryNudgeSecondsInput,
      "Boundary playback, nudge, or TS export controls are missing from the toolbar.",
      initial
    );
    assertPass(await capturePng(cdp, initialScreenshotPath, "INITIAL_RENDER", processHandle), "Initial render screenshot could not be captured.");

    const bridge = await evaluate(
      cdp,
      `(() => ({
        hasApiBaseUrl: typeof window.songcut?.apiBaseUrl === "function",
        hasSelectVideo: typeof window.songcut?.selectVideo === "function",
        hasSelectOutputDirectory: typeof window.songcut?.selectOutputDirectory === "function",
        hasFileUrl: typeof window.songcut?.fileUrl === "function",
        hasPathForFile: typeof window.songcut?.pathForFile === "function",
        hasWriteClipboard: typeof window.songcut?.writeClipboard === "function",
        hasReadClipboard: typeof window.songcut?.readClipboard === "function"
      }))()`
    );
    assertPass(Object.values(bridge).every(Boolean), "Preload bridge is incomplete.", bridge);
    log("PRELOAD_BRIDGE_OK", bridge);
    const e2eOutputDir = await evaluate(cdp, `window.songcut.selectOutputDirectory()`);
    assertPass(e2eOutputDir === outputDir, "Preload output directory bridge did not return the E2E output directory.", e2eOutputDir);
    log("OUTPUT_DIRECTORY_BRIDGE_OK", e2eOutputDir);

    await dropVideo(cdp);
    await waitFor(cdp, `document.querySelector("video") && document.body.innerText.includes("Video loaded.")`, 30_000, "video load");
    log("DND_LOAD_OK", await videoState(cdp));

    await clickButton(cdp, "Load");
    await waitFor(cdp, `document.querySelector("video") && document.body.innerText.includes("Video loaded.")`, 30_000, "video load button");
    log("LOAD_BUTTON_OK", await videoState(cdp));

    const layout = await layoutMetrics(cdp);
    assertPass(
      layout.videoPane &&
        layout.splitter &&
        layout.controlPane &&
        layout.video &&
        layout.videoPane.bottom <= layout.splitter.top + 1 &&
        layout.splitter.bottom <= layout.controlPane.top + 1 &&
        layout.video.bottom <= layout.videoPane.bottom + 1 &&
        layout.controlBackground !== "rgba(0, 0, 0, 0)",
      "Loaded video layout is not separated from the control pane.",
      layout
    );
    log("LOAD_LAYOUT_OK", layout);
    assertPass(await capturePng(cdp, loadedScreenshotPath, "LOADED_LAYOUT", processHandle), "Loaded layout screenshot could not be captured.");

    const splitBefore = await layoutMetrics(cdp);
    await dragSplitter(cdp, 90);
    const splitAfter = await layoutMetrics(cdp);
    assertPass(
      Math.abs(splitAfter.videoPane.height - splitBefore.videoPane.height) >= 40 &&
        splitAfter.videoPane.bottom <= splitAfter.splitter.top + 1 &&
        splitAfter.splitter.bottom <= splitAfter.controlPane.top + 1,
      "Splitter drag did not resize the video/control panes.",
      { before: splitBefore, after: splitAfter }
    );
    log("SPLIT_DRAG_OK", { before: splitBefore, after: splitAfter });
    await dragSplitter(cdp, -90);

    await clickButton(cdp, "Prepare Whisper");
    const whisperReady = await waitFor(
      cdp,
      `(() => {
        const text = document.body.innerText;
        return text.includes("Whisper small model is ready.") || text.includes("Whisper model ready.") ? text : false;
      })()`,
      180_000,
      "Whisper preparation"
    );
    log("WHISPER_READY_OK", whisperReady);

    await setGuideText(cdp, "1. 0:00-0:04\n├ Smoke Song\n└ (Smoke)\n");
    log("GUIDE_TEXT_OK", await evaluate(cdp, `document.querySelector("textarea")?.value || ""`));

    await clickButton(cdp, "Analyze");
    await waitFor(
      cdp,
      `(() => {
        const row = document.querySelector(".segment-list tbody tr");
        return row && row.innerText.includes("Smoke Song") && row.innerText.includes("guide-001");
      })()`,
      180_000,
      "analysis segment list"
    );
    let beforeRows = await tableRows(cdp);
    log("ANALYZE_OK", beforeRows);
    assertPass(beforeRows[0][1] === "Smoke Song", "Guide title was not reflected in the analysis segment list.", beforeRows);
    assertPass(beforeRows[0][2] === "guide-001", "Guide text was not reflected in the analysis segment list.", beforeRows);
    assertPass(beforeRows[0][3] === "0:00" && beforeRows[0][4] === "0:04", "Guided segment range was not reflected in the analysis segment list.", beforeRows);

    await editFirstSegmentTitle(cdp, "Smoke Song Edited");
    beforeRows = await tableRows(cdp);
    assertPass(beforeRows[0][1] === "Smoke Song Edited", "Editable segment title did not update the segment list.", beforeRows);
    log("TITLE_EDIT_OK", beforeRows);

    await clickButton(cdp, "Export TS");
    const copiedTsComment = await waitFor(
      cdp,
      `(() => {
        const text = window.songcut?.readClipboard?.() || "";
        return text.includes("0:00 - 0:04 Smoke Song Edited") ? text : false;
      })()`,
      5000,
      "TS comment clipboard copy"
    );
    log("EXPORT_TS_CLIPBOARD_OK", copiedTsComment);
    const copyDialog = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector(".dialog");
        const text = dialog?.innerText || "";
        return text.includes("Export TS") && text.includes("クリップボードにコピーしました") ? text : false;
      })()`,
      5000,
      "TS comment copy dialog"
    );
    log("EXPORT_TS_COPY_DIALOG_OK", copyDialog);
    await clickButton(cdp, "OK");
    await waitFor(cdp, `!document.querySelector(".dialog")`, 5000, "TS comment copy dialog close");

    const backgroundTranscription = await waitFor(
      cdp,
      `(() => {
        const ids = [...new Set(
          performance.getEntriesByType("resource")
            .map((entry) => entry.name.match(/\\/jobs\\/([^/?#]+)/)?.[1])
            .filter(Boolean)
        )];
        return ids.length >= 2 ? ids : false;
      })()`,
      15_000,
      "background transcription start"
    );
    assertPass(backgroundTranscription, "Background transcription did not start after analysis.");
    log("BACKGROUND_TRANSCRIPTION_STARTED_OK", backgroundTranscription);

    const seekState = await seekWaveform(cdp, 0.5);
    assertPass(seekState && seekState.currentTime > 2, "Waveform click did not seek the video.", seekState);
    log("WAVEFORM_SEEK_OK", seekState);

    const zoomBefore = await timelineMetrics(cdp);
    assertPass(
      zoomBefore.viewportCount === 1 && zoomBefore.horizontalBarCount <= 1 && zoomBefore.sharedViewport,
      "Timeline is not using a single shared horizontal ScrollArea.",
      zoomBefore
    );
    await clickButton(cdp, "Zoom in");
    await waitFor(cdp, `document.body.innerText.includes("200%")`, 10_000, "zoom in");
    const zoomAfter = await timelineMetrics(cdp);
    assertPass(
      zoomAfter.viewportCount === 1 &&
        zoomAfter.horizontalBarCount <= 1 &&
        zoomAfter.sharedViewport &&
        zoomAfter.scrollWidth > zoomBefore.scrollWidth &&
        zoomAfter.waveformWidth > zoomBefore.waveformWidth &&
        zoomAfter.segmentWidth > zoomBefore.segmentWidth,
      "Timeline zoom did not update the shared timeline content.",
      { before: zoomBefore, after: zoomAfter }
    );
    log("ZOOM_SYNC_OK", { before: zoomBefore, after: zoomAfter });

    const sharedScroll = await evaluate(
      cdp,
      `(() => {
        const viewport = document.querySelector(".timeline-scroll-area .scroll-area-viewport");
        const waveform = document.querySelector(".waveform-timeline");
        const segment = document.querySelector(".segment-timeline");
        if (!viewport || !waveform || !segment) return null;
        viewport.scrollLeft = Math.min(137, Math.max(0, viewport.scrollWidth - viewport.clientWidth));
        return {
          viewport: viewport.scrollLeft,
          waveform: waveform.closest(".scroll-area-viewport")?.scrollLeft ?? null,
          segment: segment.closest(".scroll-area-viewport")?.scrollLeft ?? null
        };
      })()`
    );
    assertPass(
      sharedScroll && sharedScroll.viewport === sharedScroll.waveform && sharedScroll.viewport === sharedScroll.segment,
      "Waveform and segment timelines do not share the same scrollLeft.",
      sharedScroll
    );
    log("TIMELINE_SHARED_SCROLL_OK", sharedScroll);

    const dragSeek200 = await dragWaveformPixels(cdp, 120);
    assertPass(
      dragSeek200.metrics.playheadViewportRatio !== null &&
        dragSeek200.metrics.playheadViewportRatio > 0.2 &&
        dragSeek200.metrics.playheadViewportRatio < 0.45,
      "Waveform drag snapped the playhead back toward the center instead of keeping the drag end visible.",
      dragSeek200
    );
    log("WAVEFORM_DRAG_KEEP_VISIBLE_OK", dragSeek200.metrics);

    const edgeDrag = await dragWaveformAtRightEdge(cdp);
    assertPass(
      edgeDrag.metrics.scrollLeft > edgeDrag.startScrollLeft + 20 && edgeDrag.currentTime > edgeDrag.startTime + 0.05,
      "Waveform edge drag did not auto-scroll and advance the seek time.",
      edgeDrag
    );
    log("WAVEFORM_EDGE_AUTOSCROLL_OK", edgeDrag);

    await evaluate(
      cdp,
      `(() => {
        const viewport = document.querySelector(".timeline-scroll-area .scroll-area-viewport");
        const video = document.querySelector("video");
        if (viewport) viewport.scrollLeft = 0;
        if (video) video.currentTime = 2.45;
        return true;
      })()`
    );
    await sleep(400);
    await clickButton(cdp, "Play");
    const playbackKeepVisible = await waitFor(
      cdp,
      `(() => {
        const viewport = document.querySelector(".timeline-scroll-area .scroll-area-viewport");
        const playhead = document.querySelector(".timeline-playhead");
        const video = document.querySelector("video");
        if (!viewport || !playhead || !video) return false;
        const viewportRect = viewport.getBoundingClientRect();
        const playheadRect = playhead.getBoundingClientRect();
        const ratio = (playheadRect.left - viewportRect.left) / Math.max(1, viewportRect.width);
        return viewport.scrollLeft > 20 && ratio > 0.62 && ratio < 0.78
          ? { scrollLeft: viewport.scrollLeft, ratio, currentTime: video.currentTime }
          : false;
      })()`,
      8000,
      "playback keep-visible scroll"
    );
    await clickButton(cdp, "Pause");
    log("PLAYBACK_KEEP_VISIBLE_OK", playbackKeepVisible);

    await clickButton(cdp, "200%");
    await waitFor(cdp, `document.body.innerText.includes("100%")`, 10_000, "zoom reset");
    const resetMetrics = await timelineMetrics(cdp);
    const dragSeek100 = await dragWaveformPixels(cdp, 120);
    assertPass(
      dragSeek100.seekDelta > 0.4 && dragSeek200.seekDelta > 0.1 && dragSeek200.seekDelta < dragSeek100.seekDelta,
      "Waveform drag seek did not scale with zoom.",
      { dragSeek100, dragSeek200 }
    );
    log("WAVEFORM_DRAG_SEEK_ZOOM_OK", { dragSeek100, dragSeek200 });
    log("ZOOM_RESET_OK", resetMetrics);

    await clickButton(cdp, "Start");
    const startState = await waitFor(cdp, `(() => { const video = document.querySelector("video"); return video && video.currentTime < 0.15 ? { currentTime: video.currentTime } : false; })()`, 10_000, "start seek");
    const cursorAtStart = await timelineMetrics(cdp);
    assertPass(
      cursorAtStart.playheadCount === 1 &&
        cursorAtStart.playheadRect &&
        cursorAtStart.waveformRect &&
        cursorAtStart.segmentRect &&
        Math.abs(cursorAtStart.playheadRect.left - cursorAtStart.waveformRect.left) <= 2 &&
        Math.abs(cursorAtStart.playheadRect.left - cursorAtStart.segmentRect.left) <= 2,
      "Timeline playhead is not aligned between waveform and segment rows at the start.",
      cursorAtStart
    );
    log("TIMELINE_CURSOR_ALIGNMENT_OK", cursorAtStart);
    await clickButton(cdp, "Next boundary");
    const nextBoundary = await waitFor(cdp, `(() => { const video = document.querySelector("video"); return video && video.currentTime > 0.5 ? { currentTime: video.currentTime } : false; })()`, 10_000, "next boundary");
    await clickButton(cdp, "Previous boundary");
    const prevBoundary = await waitFor(cdp, `(() => { const video = document.querySelector("video"); return video && video.currentTime < 0.2 ? { currentTime: video.currentTime } : false; })()`, 10_000, "previous boundary");
    await clickButton(cdp, "Play");
    await sleep(600);
    const playingState = await videoState(cdp);
    assertPass(playingState && playingState.paused === false, "Play button did not start playback.", playingState);
    await clickButton(cdp, "Pause");
    await sleep(300);
    const pausedState = await videoState(cdp);
    assertPass(pausedState && pausedState.paused === true, "Pause button did not pause playback.", pausedState);
    log("PLAYBACK_CONTROLS_OK", { startState, nextBoundary, prevBoundary, playingState, pausedState });

    const boundaryDecimalSet = await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".boundary-seconds-input");
        if (!input) return false;
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "10.1");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.blur();
        return true;
      })()`
    );
    assertPass(boundaryDecimalSet, "Boundary seconds input was not editable.");
    const boundaryInteger = await waitFor(
      cdp,
      `(() => {
        const input = document.querySelector(".boundary-seconds-input");
        return input && input.value === "10" && input.step === "1" ? { value: input.value, step: input.step } : false;
      })()`,
      5000,
      "boundary integer normalization"
    );
    log("BOUNDARY_SECONDS_INTEGER_OK", boundaryInteger);
    const boundaryNudgeDefaults = await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".boundary-nudge-seconds-input");
        return input ? { value: input.value, step: input.step, min: input.min } : null;
      })()`
    );
    assertPass(
      boundaryNudgeDefaults &&
        boundaryNudgeDefaults.value === "0.1" &&
        boundaryNudgeDefaults.step === "0.1" &&
        boundaryNudgeDefaults.min === "0.1",
      "Boundary nudge seconds input does not default to 0.1 second steps.",
      boundaryNudgeDefaults
    );
    log("BOUNDARY_NUDGE_SECONDS_DEFAULT_OK", boundaryNudgeDefaults);
    const boundaryInputSet = await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".boundary-seconds-input");
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        input.focus();
        setter.call(input, "1");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.blur();
        return true;
      })()`
    );
    assertPass(boundaryInputSet, "Boundary seconds input was not editable.");
    await waitFor(cdp, `document.querySelector(".boundary-seconds-input")?.value === "1"`, 5000, "boundary seconds set to one");
    await clickButton(cdp, "Play start boundary");
    const startBoundaryPlaying = await waitFor(
      cdp,
      `(() => {
        const video = document.querySelector("video");
        return video && !video.paused && video.currentTime < 0.8
          ? { currentTime: video.currentTime, paused: video.paused }
          : false;
      })()`,
      3000,
      "start boundary playback start"
    );
    const startBoundaryStopped = await waitFor(
      cdp,
      `(() => {
        const video = document.querySelector("video");
        return video && video.paused && video.currentTime >= 0.9 && video.currentTime <= 1.15
          ? { currentTime: video.currentTime, paused: video.paused }
          : false;
      })()`,
      6000,
      "start boundary playback stop"
    );
    log("START_BOUNDARY_PLAY_OK", { startBoundaryPlaying, startBoundaryStopped });

    await clickButton(cdp, "Play end boundary");
    const endBoundaryPlaying = await waitFor(
      cdp,
      `(() => {
        const video = document.querySelector("video");
        return video && !video.paused && video.currentTime >= 3 && video.currentTime < 3.8
          ? { currentTime: video.currentTime, paused: video.paused }
          : false;
      })()`,
      3000,
      "end boundary playback start"
    );
    const endBoundaryStopped = await waitFor(
      cdp,
      `(() => {
        const video = document.querySelector("video");
        return video && video.paused && video.currentTime >= 3.95 && video.currentTime <= 4.08
          ? { currentTime: video.currentTime, paused: video.paused }
          : false;
      })()`,
      6000,
      "end boundary playback stop"
    );
    log("END_BOUNDARY_PLAY_OK", { endBoundaryPlaying, endBoundaryStopped });

    await clickSelector(cdp, ".segment-list tbody tr");
    const selectedRow = await waitFor(
      cdp,
      `(() => {
        const row = document.querySelector(".segment-list tbody tr.selected");
        const video = document.querySelector("video");
        return row && video && video.currentTime < 0.2 ? { row: row.innerText, currentTime: video.currentTime } : false;
      })()`,
      10_000,
      "segment row selection"
    );
    log("SEGMENT_SELECT_OK", selectedRow);

    const checkedDefault = await evaluate(cdp, `document.querySelector(".segment-list input[type=checkbox]")?.checked === true`);
    assertPass(checkedDefault, "Segment checkbox is not checked by default.");
    await clickSelector(cdp, ".segment-list input[type=checkbox]");
    const uncheckedState = await waitFor(
      cdp,
      `(() => {
        const checkbox = document.querySelector(".segment-list input[type=checkbox]");
        const exportButton = [...document.querySelectorAll("button")].find((button) => (button.innerText || button.title).trim() === "Export");
        const exportTsButton = [...document.querySelectorAll("button")].find((button) => (button.innerText || button.title).trim() === "Export TS");
        return checkbox && checkbox.checked === false
          ? { checked: checkbox.checked, exportDisabled: exportButton?.disabled ?? null, exportTsDisabled: exportTsButton?.disabled ?? null }
          : false;
      })()`,
      10_000,
      "checkbox exclusion"
    );
    assertPass(uncheckedState.exportDisabled === true, "Unchecked segment did not disable export when no rows remain checked.", uncheckedState);
    assertPass(uncheckedState.exportTsDisabled === true, "Unchecked segment did not disable TS export when no rows remain checked.", uncheckedState);
    log("CHECKBOX_EXCLUDE_OK", uncheckedState);
    await clickSelector(cdp, ".segment-list input[type=checkbox]");
    await waitFor(cdp, `document.querySelector(".segment-list input[type=checkbox]")?.checked === true`, 10_000, "checkbox re-enable");

    await clickButton(cdp, "View");
    const transcriptBefore = await waitFor(
      cdp,
      `(() => {
        const text = document.querySelector(".dialog .transcript-text")?.innerText;
        return text ? { text, title: document.querySelector(".dialog h2")?.innerText || "" } : false;
      })()`,
      10_000,
      "transcript dialog"
    );
    assertPass(
      transcriptBefore.title.includes("Smoke Song Edited") && transcriptBefore.title.includes("guide-001"),
      "Transcript dialog did not show title and ID.",
      transcriptBefore
    );
    log("TRANSCRIPT_DIALOG_OK", transcriptBefore);
    await clickButton(cdp, "Close");
    await waitFor(cdp, `!document.querySelector(".dialog")`, 10_000, "transcript close");

    const handleScrollBefore = await timelineMetrics(cdp);
    await dragHandle(cdp, `.drag-handle[aria-label="end"]`, 0.83);
    await dragHandle(cdp, `.drag-handle[aria-label="start"]`, 0.33);
    await dragHandle(cdp, `.drag-handle[aria-label="end"]`, 0.5);
    const handleScrollAfter = await timelineMetrics(cdp);
    assertPass(
      Math.abs(handleScrollAfter.scrollLeft - handleScrollBefore.scrollLeft) <= 4,
      "Segment handle editing caused an unexpected center-fixed timeline scroll.",
      { before: handleScrollBefore, after: handleScrollAfter }
    );
    log("HANDLE_EDIT_KEEP_VISIBLE_OK", { before: handleScrollBefore, after: handleScrollAfter });
    const afterRows = await tableRows(cdp);
    if (beforeRows[0][3] === afterRows[0][3] || beforeRows[0][4] === afterRows[0][4]) {
      throw new Error(`Segment boundaries did not change: before=${JSON.stringify(beforeRows)} after=${JSON.stringify(afterRows)}`);
    }
    log("DRAG_OK", afterRows);

    await clickButton(cdp, "View");
    const transcriptAfter = await waitFor(cdp, `document.querySelector(".dialog .transcript-text")?.innerText || false`, 10_000, "transcript after drag");
    if (transcriptBefore.text !== "Transcript has not been generated yet.") {
      assertPass(transcriptAfter === transcriptBefore.text, "Transcript changed after GUI-only segment boundary edit.", { before: transcriptBefore.text, after: transcriptAfter });
      log("TRANSCRIPT_STATIC_AFTER_DRAG_OK");
    } else {
      log("TRANSCRIPT_PENDING_AFTER_DRAG_OK", transcriptAfter);
    }
    await clickButton(cdp, "Close");
    await waitFor(cdp, `!document.querySelector(".dialog")`, 10_000, "transcript close after drag");


    await clickButton(cdp, "Export");
    await waitFor(cdp, `document.querySelector(".dialog") && document.body.innerText.includes("Export Review")`, 15_000, "export dialog");
    const reviewScrollArea = await evaluate(
      cdp,
      `(() => ({
        hasOutputScrollArea: !!document.querySelector(".output-list.scroll-area .scroll-area-viewport"),
        hasNativeOverflow: getComputedStyle(document.querySelector(".output-list") || document.body).overflowY
      }))()`
    );
    assertPass(reviewScrollArea.hasOutputScrollArea, "Export Review does not use the shadcn/Radix ScrollArea.", reviewScrollArea);
    log("EXPORT_REVIEW_SCROLLAREA_OK", reviewScrollArea);
    const reviewItems = await evaluate(
      cdp,
      `[...document.querySelectorAll(".output-row")].map((row) => row.innerText)`
    );
    assertPass(
      reviewItems.length === 1 &&
        reviewItems[0].includes("Smoke Song Edited") &&
        reviewItems[0].includes("ID: guide-001") &&
        reviewItems[0].includes("01_Smoke Song Edited.mp4"),
      "Export review did not list the checked guided segment title, ID, and filename.",
      reviewItems
    );
    log("EXPORT_REVIEW_OK", reviewItems);
    assertPass(await capturePng(cdp, reviewScreenshotPath, "EXPORT_REVIEW", processHandle), "Export review screenshot could not be captured.");

    await clickSelector(cdp, ".output-row");
    const previewDuring = await waitFor(
      cdp,
      `(() => {
        const video = document.querySelector("video");
        return video && video.currentTime >= 1.5 && video.currentTime <= 3.5
          ? { currentTime: video.currentTime, paused: video.paused }
          : false;
      })()`,
      5000,
      "export preview range"
    );
    await sleep(1500);
    const previewAfter = await videoState(cdp);
    assertPass(previewAfter && previewAfter.paused === true, "Short export preview did not stop after one pass.", { during: previewDuring, after: previewAfter });
    log("EXPORT_PREVIEW_OK", { during: previewDuring, after: previewAfter });

    const exportClicked = await evaluate(
      cdp,
      `(() => {
        const dialog = [...document.querySelectorAll(".dialog")].find((node) => node.innerText.includes("Export Review"));
        const button = dialog
          ? [...dialog.querySelectorAll(".dialog-actions button")].find((node) => node.innerText.trim() === "Export")
          : null;
        if (!button) return false;
        button.click();
        return { disabled: button.disabled, text: button.innerText };
      })()`
    );
    assertPass(exportClicked, "Export Review export button was not clickable.");
    log("EXPORT_BUTTON_CLICKED", exportClicked);
    const progressOpen = await waitFor(
      cdp,
      `(() => {
        const text = document.querySelector(".dialog")?.innerText || "";
        return text.includes("Export Progress") && text.includes("Smart rendering") ? text : false;
      })()`,
      15_000,
      "export progress dialog"
    );
    log("EXPORT_PROGRESS_DIALOG_OK", progressOpen);
    await evaluate(cdp, `window.close(); true`);
    const quitConfirm = await waitFor(
      cdp,
      `(() => {
        const dialogs = [...document.querySelectorAll(".dialog")].map((node) => node.innerText);
        return dialogs.some((text) => text.includes("Quit songcut?") && text.includes("Quit anyway") && text.includes("Cancel"))
          ? dialogs
          : false;
      })()`,
      10_000,
      "running task quit confirmation"
    );
    log("RUNNING_TASK_QUIT_CONFIRM_OK", quitConfirm);
    await clickButton(cdp, "Cancel");
    await waitFor(
      cdp,
      `(() => {
        const text = document.body.innerText;
        return !text.includes("Quit songcut?") && text.includes("Export Progress");
      })()`,
      10_000,
      "quit confirmation cancel"
    );
    log("RUNNING_TASK_QUIT_CANCEL_OK");
    const exported = await waitForExportedFile();
    assertPass(
      exported.some((file) => file.name === "01_Smoke Song Edited.mp4"),
      "Exported video filename did not reflect the current GUI title.",
      exported
    );
    const exportedPath = path.join(outputDir, exported[0].name);
    const duration = probeDuration(exportedPath);
    if (!(duration > 0.2 && duration < 2.5)) {
      throw new Error(`Unexpected exported duration: ${duration}`);
    }
    log("EXPORT_OK", { exported, duration });
    const tsCommentPath = path.join(outputDir, "ts_comments.txt");
    assertPass(fs.existsSync(tsCommentPath), "TS comment file was not written to the export folder.");
    const exportedTsComment = fs.readFileSync(tsCommentPath, "utf-8");
    assertPass(
      exportedTsComment.includes("0:02 - 0:03 Smoke Song Edited"),
      "TS comment file did not reflect the current edited segment list.",
      exportedTsComment
    );
    log("EXPORT_TS_FILE_OK", exportedTsComment);
    const exportUiComplete = await waitFor(
      cdp,
      `(() => {
        const dialogText = document.querySelector(".dialog")?.innerText || "";
        return dialogText.includes("Export Progress") && dialogText.includes("Export complete.") ? dialogText : false;
      })()`,
      60_000,
      "export UI completion"
    );
    log("EXPORT_UI_COMPLETE_OK", exportUiComplete);
    await clickButton(cdp, "Close");
    await waitFor(cdp, `!document.querySelector(".dialog")`, 10_000, "export progress close");

    assertPass(await capturePng(cdp, screenshotPath, "FINAL", processHandle), "Final screenshot could not be captured.");
    log("E2E_OK");
  } finally {
    cleanup(processHandle, cdp);
  }
})().catch((error) => {
  log("E2E_FAIL", { message: error.message, stack: error.stack });
  for (const imageName of ["songcut.exe", "songcut-electron.exe"]) {
    try {
      execFileSync("taskkill", ["/IM", imageName, "/F"], { stdio: "ignore" });
    } catch {}
  }
  process.exitCode = 1;
});
