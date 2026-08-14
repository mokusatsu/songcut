const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const packageRoot = process.env.SONGCUT_E2E_PACKAGE_ROOT
  ? path.resolve(process.env.SONGCUT_E2E_PACKAGE_ROOT)
  : path.join(repo, "dist", "songcut-win-x64");
const boundaryDragOnly = process.env.SONGCUT_E2E_SUB_BOUNDARY_ONLY === "1";
const defaultFixtureStem = "02_「星の消えた夜に」 - Aimer";
const defaultFixtureVideo = path.join(repo, "testdata", `${defaultFixtureStem}.webm`);
const fixtureVideo = boundaryDragOnly && process.env.SONGCUT_E2E_SUB_BOUNDARY_VIDEO
  ? path.resolve(process.env.SONGCUT_E2E_SUB_BOUNDARY_VIDEO)
  : defaultFixtureVideo;
const fixtureStem = path.basename(fixtureVideo, path.extname(fixtureVideo));
const fixtureLyrics = path.join(repo, "testdata", `${defaultFixtureStem}.lyrics.txt`);
const runRoot = process.env.SONGCUT_E2E_SUB_RUN_DIR
  ? path.resolve(process.env.SONGCUT_E2E_SUB_RUN_DIR)
  : path.join(repo, "out", "e2e-sub-mode");
const input = path.join(runRoot, `${fixtureStem}.webm`);
const outputDir = path.join(runRoot, "export");
const userDataDir = path.join(runRoot, "user-data");
const logPath = path.join(runRoot, "e2e-sub-mode.log");
const screenshotPath = path.join(runRoot, "e2e-sub-mode.png");
const lyricsDialogScreenshotPath = path.join(runRoot, "e2e-sub-mode-lyrics-dialog.png");
const analysisProgressScreenshotPath = path.join(runRoot, "e2e-sub-mode-analysis-progress.png");
const styleDialogScreenshotPath = path.join(runRoot, "e2e-sub-mode-style-dialog.png");
const exportProgressScreenshotPath = path.join(runRoot, "e2e-sub-mode-export-progress.png");
const displayPreviewScreenshotPath = path.join(runRoot, "e2e-sub-mode-display-preview.png");
const port = Number(process.env.SONGCUT_E2E_SUB_PORT || 9240);
const captureScreenshots = process.env.SONGCUT_E2E_SCREENSHOTS === "1";
const viewportWidth = Number(process.env.SONGCUT_E2E_SUB_VIEWPORT_WIDTH || 0);
const viewportHeight = Number(process.env.SONGCUT_E2E_SUB_VIEWPORT_HEIGHT || 0);
const viewportRequested = viewportWidth > 0 || viewportHeight > 0;
const fixtureSubProject = `${fixtureVideo}.sub.songcut`;
let boundarySeed = null;

function log(message, value) {
  const line = value === undefined ? message : `${message} ${JSON.stringify(value)}`;
  fs.appendFileSync(logPath, `${line}\n`);
  console.log(line);
}

function assertPass(condition, message, details) {
  if (!condition) throw new Error(`${message}${details === undefined ? "" : ` ${JSON.stringify(details)}`}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout waiting for ${label}.`)), timeoutMs)
    ),
  ]);
}

async function captureOptionalScreenshot(cdp, filePath, label) {
  if (!captureScreenshots) return null;
  let lastError = null;
  for (const fromSurface of [true, false]) {
    try {
      const screenshot = await withTimeout(
        cdp.send("Page.captureScreenshot", { format: "png", fromSurface }),
        15_000,
        `${label} screenshot`
      );
      fs.writeFileSync(filePath, Buffer.from(screenshot.result.data, "base64"));
      assertPass(fs.statSync(filePath).size > 0, `${label} screenshot is empty.`);
      return filePath;
    } catch (error) {
      lastError = error;
    }
  }
  log("SUB_SCREENSHOT_SKIPPED", { label, message: lastError?.message ?? String(lastError) });
  return null;
}

async function getPage() {
  for (let index = 0; index < 120; index += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page");
      if (page) return page;
    } catch {}
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
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      request.resolve(message);
    }
  };
  return new Promise((resolve, reject) => {
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const messageId = ++id;
          ws.send(JSON.stringify({ id: messageId, method, params }));
          return new Promise((innerResolve, innerReject) => {
            const timer = setTimeout(() => {
              pending.delete(messageId);
              innerReject(new Error(`CDP ${method} timed out after 30 seconds.`));
            }, 30_000);
            pending.set(messageId, { resolve: innerResolve, timer });
          });
        },
        close() {
          ws.close();
        },
      });
  });
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (!response?.result) {
    throw new Error(`CDP Runtime.evaluate failed: ${JSON.stringify(response?.error ?? response)}`);
  }
  if (response.result.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result.result.value;
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await evaluate(cdp, expression);
    if (last) return last;
    await sleep(750);
  }
  throw new Error(`Timeout waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function waitForJson(filePath, predicate, timeoutMs, label) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (predicate(last)) return last;
    } catch (error) {
      last = String(error);
    }
    await sleep(500);
  }
  const compactLast = last && typeof last === "object"
    ? {
        updated_at: last.updated_at,
        revision: last.revision,
        mode: last.mode,
        selected_segment_id: last.subtitle?.selected_segment_id,
      }
    : last;
  throw new Error(`Timeout waiting for ${label}; last=${JSON.stringify(compactLast)}`);
}

async function clickButton(cdp, label) {
  return evaluate(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.innerText.trim() === ${JSON.stringify(label)});
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`
  );
}

async function pressSpace(cdp) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  });
}

function cleanup(processHandle, cdp) {
  try {
    cdp?.close();
  } catch {}
  try {
    execFileSync("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    try {
      processHandle.kill();
    } catch {}
  }
}

function prepareBoundaryDragProject() {
  assertPass(fs.existsSync(fixtureSubProject), "Sub boundary E2E seed project is missing.", fixtureSubProject);
  const project = JSON.parse(fs.readFileSync(fixtureSubProject, "utf8"));
  const selectedId = project.subtitle?.selected_segment_id;
  const selectedLane = project.subtitle?.lanes?.find((candidate) =>
    candidate.segments?.some((segment) => segment.id === selectedId)
  );
  const selectedSegment = selectedLane?.segments?.find((candidate) => candidate.id === selectedId);
  const selectedIsEditable = selectedSegment?.source === "lyrics"
    && selectedSegment.end - selectedSegment.start >= 2
    && selectedSegment.start >= 1;
  const lane = selectedIsEditable ? selectedLane : project.subtitle?.lanes?.find((candidate) =>
    candidate.segments?.some((segment) =>
      segment.source === "lyrics" && segment.end - segment.start >= 2 && segment.start >= 1
    )
  );
  const segment = selectedIsEditable ? selectedSegment : lane?.segments?.find((candidate) =>
    candidate.source === "lyrics" && candidate.end - candidate.start >= 2 && candidate.start >= 1
  );
  assertPass(lane && segment, "Sub boundary E2E seed has no editable lyrics segment.");
  const orderedSegments = [...lane.segments]
    .sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
  const segmentIndex = orderedSegments.findIndex((candidate) => candidate.id === segment.id);
  const previousEnd = segmentIndex > 0 ? orderedSegments[segmentIndex - 1].end : 0;
  const nextStart = segmentIndex + 1 < orderedSegments.length
    ? orderedSegments[segmentIndex + 1].start
    : project.source.duration_seconds;
  const rhythmTimes = project.subtitle.rhythm_grid.map((point) => point.time);
  const inputStat = fs.statSync(input);
  project.source.absolute_path = input;
  project.source.relative_path = path.basename(input);
  project.source.filename = path.basename(input);
  project.source.mtime_ms = inputStat.mtimeMs;
  project.subtitle.active_lane_id = lane.id;
  project.subtitle.selected_segment_id = segment.id;
  project.updated_at = new Date().toISOString();
  fs.writeFileSync(`${input}.sub.songcut`, `${JSON.stringify(project, null, 2)}\n`);
  boundarySeed = {
    laneId: lane.id,
    segmentId: segment.id,
    start: segment.start,
    end: segment.end,
    lineRevision: segment.line_revision ?? 0,
    sourceDuration: project.source.duration_seconds,
    startTarget: [...rhythmTimes]
      .reverse()
      .find((time) => time <= segment.start - 0.35 && time > previousEnd),
    endTarget: rhythmTimes
      .find((time) => time >= segment.end + 0.35 && time < nextStart),
  };
}

async function sampleVideoFrame(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const video = document.querySelector("video");
      if (!video) return null;
      const state = {
        currentTime: video.currentTime,
        duration: video.duration,
        paused: video.paused,
        readyState: video.readyState,
        networkState: video.networkState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        src: video.currentSrc || video.src,
        error: video.error ? { code: video.error.code, message: video.error.message } : null,
        frame: null,
      };
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 36;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let luminance = 0;
        let opaque = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          luminance += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
          if (pixels[index + 3] > 0) opaque += 1;
        }
        state.frame = { meanLuminance: luminance / (pixels.length / 4), opaque };
      } catch (error) {
        state.frame = { error: String(error) };
      }
      return state;
    })()`
  );
}

async function dragSubBoundary(cdp, edge, targetTime) {
  const geometry = await evaluate(
    cdp,
    `(() => {
      const viewport = document.querySelector(".sub-timeline-scroll .scroll-area-viewport");
      const content = document.querySelector(".sub-timeline-content");
      const handle = document.querySelector(${JSON.stringify(`.lyrics-handle.${edge}.selected`)});
      if (!viewport || !content || !handle) return null;
      const requestedLeft = Number.parseFloat(handle.style.left || "0");
      viewport.scrollLeft = Math.max(0, requestedLeft - viewport.clientWidth * 0.45);
      const rect = handle.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const targetX = contentRect.left + (${Number(targetTime)} / ${Number(boundarySeed?.sourceDuration ?? 1)}) * contentRect.width;
      const hit = document.elementFromPoint(x, y);
      window.__subBoundaryInputEvents = [];
      window.__subBoundaryErrors = [];
      window.addEventListener("error", (event) => {
        window.__subBoundaryErrors.push({
          type: "error",
          message: event.message,
          stack: event.error?.stack || null,
          filename: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null,
        });
      }, { once: true });
      window.addEventListener("unhandledrejection", (event) => {
        window.__subBoundaryErrors.push({
          type: "unhandledrejection",
          message: String(event.reason),
          stack: event.reason?.stack || null,
        });
      }, { once: true });
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mousemove", "mouseup"]) {
        window.addEventListener(type, (event) => {
          window.__subBoundaryInputEvents.push({
            type,
            pointerId: event.pointerId ?? null,
            clientX: event.clientX,
            targetClass: event.target?.className || null,
          });
        }, { capture: true, once: type === "pointerdown" || type === "mousedown" });
      }
      return {
        sx: x,
        sy: y,
        tx: targetX,
        ty: y,
        delta: targetX - x,
        targetTime: ${Number(targetTime)},
        hitClass: hit?.className || null,
        hitTag: hit?.tagName || null,
        handleClass: handle.className,
      };
    })()`
  );
  assertPass(geometry, `Sub ${edge} boundary handle is unavailable.`);
  assertPass(
    String(geometry.hitClass).includes("lyrics-handle"),
    `Sub ${edge} boundary handle does not own its visible hit area.`,
    geometry
  );
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: geometry.sx, y: geometry.sy, button: "none", buttons: 0,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: geometry.sx, y: geometry.sy, button: "left", buttons: 1, clickCount: 1,
  });
  await sleep(80);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: geometry.tx, y: geometry.ty, button: "left", buttons: 1,
  });
  await sleep(250);
  const during = await sampleVideoFrame(cdp);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: geometry.tx, y: geometry.ty, button: "left", buttons: 0, clickCount: 1,
  });
  await sleep(500);
  const after = await sampleVideoFrame(cdp);
  const runtime = await evaluate(
    cdp,
    `(() => {
      const handle = document.querySelector(${JSON.stringify(`.lyrics-handle.${edge}.selected`)});
      const segment = document.querySelector(".lyrics-segment.selected");
      return {
        events: window.__subBoundaryInputEvents || [],
        errors: window.__subBoundaryErrors || [],
        handleLeft: handle?.style.left || null,
        segmentLeft: segment?.style.left || null,
        segmentWidth: segment?.style.width || null,
        bodyTextLength: document.body?.innerText?.length || 0,
        visibilityState: document.visibilityState,
      };
    })()`
  );
  log("SUB_BOUNDARY_DRAG_RUNTIME", { edge, geometry, runtime, during, after });
  return { geometry, during, after, runtime };
}

async function runSubBoundaryDragE2E(cdp, subProjectPath) {
  assertPass(boundarySeed, "Sub boundary E2E seed metadata is unavailable.");
  await waitFor(
    cdp,
    `!!document.querySelector(".lyrics-handle.start.selected") && !!document.querySelector(".lyrics-handle.end.selected")`,
    30_000,
    "selected Sub boundary handles"
  );
  await evaluate(
    cdp,
    `(() => {
      const groups = document.querySelectorAll(".sub-toolbar .mode-transport-toolbar > .icon-group");
      const buttons = groups[groups.length - 1]?.querySelectorAll("button");
      const zoomIn = buttons?.[buttons.length - 1];
      zoomIn?.click();
      zoomIn?.click();
      return true;
    })()`
  );
  await sleep(300);
  const targetTime = boundarySeed.start + Math.min(1, (boundarySeed.end - boundarySeed.start) / 2);
  await evaluate(
    cdp,
    `(async () => {
      const video = document.querySelector("video");
      if (!video) return false;
      video.pause();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        video.addEventListener("seeked", () => { clearTimeout(timer); resolve(); }, { once: true });
        video.currentTime = ${targetTime};
      });
      window.__subBoundaryVideoEvents = { seeking: 0, seeked: 0, emptied: 0, loadstart: 0, error: 0 };
      for (const type of Object.keys(window.__subBoundaryVideoEvents)) {
        video.addEventListener(type, () => { window.__subBoundaryVideoEvents[type] += 1; });
      }
      return true;
    })()`
  );
  const before = await sampleVideoFrame(cdp);
  assertPass(
    before?.readyState >= 2 && before.videoWidth > 0 && before.videoHeight > 0 && !before.error &&
      before.frame && !before.frame.error && before.frame.opaque > 0 && before.frame.meanLuminance > 1,
    "Sub boundary E2E could not establish a drawable video frame.",
    before
  );

  assertPass(
    Number.isFinite(boundarySeed.startTarget) && Number.isFinite(boundarySeed.endTarget),
    "Sub boundary E2E could not resolve valid rhythm-grid targets.",
    boundarySeed
  );
  const startDrag = await dragSubBoundary(cdp, "start", boundarySeed.startTarget);
  const afterStartDocument = await waitForJson(
    subProjectPath,
    (value) => {
      const segment = value.subtitle?.lanes?.flatMap((lane) => lane.segments || [])
        .find((candidate) => candidate.id === boundarySeed.segmentId);
      return segment && segment.start < boundarySeed.start && (segment.line_revision ?? 0) === boundarySeed.lineRevision + 1
        ? segment
        : false;
    },
    10_000,
    "persisted Sub start boundary drag"
  );
  const afterStartSegment = afterStartDocument.subtitle.lanes
    .flatMap((lane) => lane.segments || [])
    .find((segment) => segment.id === boundarySeed.segmentId);
  assertPass(
    Math.abs(startDrag.during.currentTime - targetTime) <= 0.15 &&
      Math.abs(startDrag.after.currentTime - targetTime) <= 0.15,
    "Sub start boundary drag unexpectedly sought the video.",
    { targetTime, startDrag }
  );

  const endDrag = await dragSubBoundary(cdp, "end", boundarySeed.endTarget);
  const afterEndDocument = await waitForJson(
    subProjectPath,
    (value) => {
      const segment = value.subtitle?.lanes?.flatMap((lane) => lane.segments || [])
        .find((candidate) => candidate.id === boundarySeed.segmentId);
      return segment && segment.end > boundarySeed.end && (segment.line_revision ?? 0) === boundarySeed.lineRevision + 2
        ? segment
        : false;
    },
    10_000,
    "persisted Sub end boundary drag"
  );
  const afterEndSegment = afterEndDocument.subtitle.lanes
    .flatMap((lane) => lane.segments || [])
    .find((segment) => segment.id === boundarySeed.segmentId);
  const events = await evaluate(cdp, `window.__subBoundaryVideoEvents`);
  for (const state of [startDrag.during, startDrag.after, endDrag.during, endDrag.after]) {
    assertPass(
      state?.readyState >= 2 && state.videoWidth > 0 && state.videoHeight > 0 && !state.error &&
        state.frame && !state.frame.error && state.frame.opaque > 0 && state.frame.meanLuminance > 1,
      "Sub boundary drag blacked out the video frame.",
      state
    );
    assertPass(
      Math.abs(state.currentTime - targetTime) <= 0.15,
      "Sub boundary drag changed the playback cursor.",
      { targetTime, state }
    );
  }
  assertPass(
    events && events.seeking === 0 && events.seeked === 0 && events.emptied === 0 && events.loadstart === 0 && events.error === 0,
    "Sub boundary drag caused an unexpected media lifecycle event.",
    events
  );
  log("SUB_BOUNDARY_DRAG_E2E_PASS", {
    segmentId: boundarySeed.segmentId,
    before,
    start: { from: boundarySeed.start, to: afterStartSegment?.start },
    end: { from: boundarySeed.end, to: afterEndSegment?.end },
    events,
  });
}

(async () => {
  assertPass(fs.existsSync(fixtureVideo), "Fixture video is missing.", fixtureVideo);
  if (!boundaryDragOnly) assertPass(fs.existsSync(fixtureLyrics), "Fixture lyrics are missing.", fixtureLyrics);
  assertPass(fs.existsSync(path.join(packageRoot, "songcut.exe")), "Packaged songcut.exe is missing.", packageRoot);
  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.copyFileSync(fixtureVideo, input);
  if (boundaryDragOnly) prepareBoundaryDragProject();
  fs.writeFileSync(path.join(userDataDir, "app-preferences.json"), `${JSON.stringify({ uiLanguage: "ja" }, null, 2)}\n`);
  fs.writeFileSync(logPath, "");
  const lyrics = boundaryDragOnly ? "" : fs.readFileSync(fixtureLyrics, "utf8");
  const env = {
    ...process.env,
    SONGCUT_E2E_VIDEO: input,
    SONGCUT_E2E_OUTPUT_DIR: outputDir,
    SONGCUT_E2E_USER_DATA_DIR: userDataDir,
  };
  const processHandle = spawn(
    path.join(packageRoot, "songcut.exe"),
    [`--remote-debugging-port=${port}`],
    { cwd: packageRoot, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  processHandle.stdout.on("data", (data) => log(`[app-out] ${data.toString().trim()}`));
  processHandle.stderr.on("data", (data) => log(`[app-err] ${data.toString().trim()}`));

  let cdp;
  try {
    const page = await getPage();
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await waitFor(cdp, `!!window.songcut && !!document.querySelector('[role="tab"]')`, 60_000, "initial render");
    if (viewportRequested) {
      assertPass(
        Number.isInteger(viewportWidth) && viewportWidth >= 1060 &&
          Number.isInteger(viewportHeight) && viewportHeight >= 720,
        "Sub E2E viewport must satisfy the application minimum size.",
        { viewportWidth, viewportHeight }
      );
      assertPass(
        await evaluate(cdp, `(() => { window.resizeTo(${viewportWidth}, ${viewportHeight}); return true; })()`),
        "Electron window.resizeTo was unavailable for the Sub E2E viewport."
      );
      await waitFor(
        cdp,
        `window.innerWidth <= ${viewportWidth} && window.innerHeight <= ${viewportHeight}`,
        10_000,
        `${viewportWidth}x${viewportHeight} Sub E2E window bounds`
      );
      const actualViewport = await evaluate(cdp, `({ width: window.innerWidth, height: window.innerHeight })`);
      log("SUB_VIEWPORT_OK", { requested: { width: viewportWidth, height: viewportHeight }, actual: actualViewport });
    }
    assertPass(await clickButton(cdp, "読み込む"), "Load button could not be clicked.");
    await waitFor(cdp, `document.querySelector("video")?.src.includes(${JSON.stringify(encodeURIComponent(fixtureStem))})`, 60_000, "fixture video load");
    log("SUB_FIXTURE_LOAD_OK", { input });

    const subTabPoint = await waitFor(
      cdp,
      `(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.trim() === "Sub");
        if (!tab || tab.disabled) return null;
        const rect = tab.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return {
          x,
          y,
          hit: document.elementFromPoint(x, y)?.outerHTML?.slice(0, 300) || null
        };
      })()`,
      60_000,
      "enabled Sub tab"
    );
    assertPass(subTabPoint, "Sub tab could not be selected.");
    log("SUB_TAB_TARGET", subTabPoint);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: subTabPoint.x,
      y: subTabPoint.y,
      button: "none",
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: subTabPoint.x,
      y: subTabPoint.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(60);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: subTabPoint.x,
      y: subTabPoint.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(300);
    if ((await evaluate(cdp, `document.querySelector('[role="tab"][data-state="active"]')?.textContent`)) !== "Sub") {
      await evaluate(
        cdp,
        `(() => {
          const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.trim() === "Sub");
          tab?.focus();
          return document.activeElement === tab;
        })()`
      );
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
    }
    await sleep(3000);
    log(
      "SUB_SWITCH_STATE",
      await evaluate(
        cdp,
        `(() => ({
          selectedTab: document.querySelector('[role="tab"][data-state="active"]')?.textContent,
          hasSubToolbar: !!document.querySelector(".sub-toolbar"),
          message: document.querySelector(".status-panel")?.textContent || document.querySelector(".sub-status-row")?.textContent || "",
          tabs: [...document.querySelectorAll('[role="tab"]')].map((item) => ({ text: item.textContent, disabled: item.disabled }))
        }))()`
      )
    );
    await waitFor(cdp, `!!document.querySelector(".sub-toolbar")`, 120_000, "Sub mode");
    const subTabFocusState = await evaluate(
      cdp,
      `(() => {
        const active = document.activeElement;
        const root = document.querySelector("[data-editor-focus-root]");
        const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.trim() === "Sub");
        return {
          activeTag: active?.tagName || null,
          activeClass: active?.className || null,
          activeText: active?.textContent?.trim().slice(0, 80) || null,
          activeIsRoot: active === root,
          rootTag: root?.tagName || null,
          rootTabIndex: root?.tabIndex ?? null,
          tabIndex: tab?.tabIndex ?? null,
        };
      })()`
    );
    log("SUB_MODE_TAB_FOCUS_STATE", subTabFocusState);
    const subTabFocus = await waitFor(
      cdp,
      `(() => {
        const active = document.activeElement;
        const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.trim() === "Sub");
        return active?.matches("[data-editor-focus-root]") && tab
          ? { activeTag: active.tagName, activeIsRoot: true, tabIndex: tab.tabIndex }
          : false;
      })()`,
      5000,
      "Sub mode tab focus restore"
    );
    assertPass(subTabFocus.tabIndex === -1, "Sub mode tab remained in the editor tab order.", subTabFocus);
    log("SUB_MODE_TAB_FOCUS_OK", subTabFocus);
    const subWaveformDefault = await waitFor(
      cdp,
      `(() => {
        const waveform = document.querySelector(".sub-waveform");
        const stored = localStorage.getItem("songcut:waveform-display-mode:sub");
        return waveform?.dataset.waveformMode === "symmetric-peak" &&
          waveform?.dataset.waveformAmplitudeProfile === "adaptive" &&
          stored === "symmetric-peak"
          ? { mode: waveform.dataset.waveformMode, amplitudeProfile: waveform.dataset.waveformAmplitudeProfile, phase: waveform.dataset.waveformPhase, stored }
          : false;
      })()`,
      10_000,
      "Sub symmetric-peak waveform default"
    );
    log("SUB_WAVEFORM_DEFAULT_OK", subWaveformDefault);
    if (boundaryDragOnly) {
      const subProjectPath = `${input}.sub.songcut`;
      await waitForJson(
        subProjectPath,
        (value) => value.mode === "sub" && value.subtitle?.selected_segment_id === boundarySeed.segmentId,
        30_000,
        "seeded Sub boundary project"
      );
      await runSubBoundaryDragE2E(cdp, subProjectPath);
      return;
    }
    const proxyAfterModeSwitch = await waitFor(
      cdp,
      `(() => {
        const audio = document.querySelector("audio[data-scratch-proxy-state]");
        return audio?.dataset.scratchProxyState === "ready"
          ? { state: audio.dataset.scratchProxyState, duration: audio.duration }
          : false;
      })()`,
      180_000,
      "global scratch proxy after Cut to Sub switch"
    );
    assertPass(proxyAfterModeSwitch.duration > 0, "Scratch proxy was stopped by the mode switch.", proxyAfterModeSwitch);
    log("SUB_GLOBAL_PROXY_OK", proxyAfterModeSwitch);
    const subProjectPath = `${input}.sub.songcut`;
    await waitForJson(subProjectPath, (value) => value.mode === "sub" && value.subtitle?.lanes?.length === 1, 30_000, "initial Sub project");
    log("SUB_PROJECT_CREATED_OK", subProjectPath);

    await evaluate(
      cdp,
      `(() => {
        const originalFetch = window.fetch.bind(window);
        window.__subtitleRenderRequests = 0;
        window.fetch = (...args) => {
          if (String(args[0]).includes("/subtitle-render/jobs")) {
            window.__subtitleRenderRequests += 1;
          }
          return originalFetch(...args);
        };
        return true;
      })()`
    );

    assertPass(await clickButton(cdp, "解析"), "Analyze button could not be clicked.");
    await waitFor(cdp, `!!document.querySelector(".lyrics-input")`, 10_000, "lyrics dialog");
    const textSet = await evaluate(
      cdp,
      `(() => {
        const textarea = document.querySelector(".lyrics-input");
        if (!textarea) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(textarea, ${JSON.stringify(lyrics)});
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return textarea.value.length;
      })()`
    );
    const normalizedLyricsLength = lyrics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").length;
    assertPass(textSet === normalizedLyricsLength, "Lyrics text was not entered.", {
      textSet,
      expected: normalizedLyricsLength,
    });
    const lyricsDialogMetrics = await evaluate(
      cdp,
      `(() => {
        const textarea = document.querySelector(".lyrics-input");
        const dialog = textarea?.closest('[role="dialog"]');
        if (!textarea || !dialog) return null;
        const textareaRect = textarea.getBoundingClientRect();
        const dialogRect = dialog.getBoundingClientRect();
        const splitter = document.querySelector(".splitter");
        const splitterRect = splitter?.getBoundingClientRect();
        const splitterProbe = splitterRect
          ? document.elementFromPoint(dialogRect.left + 24, splitterRect.top + splitterRect.height / 2)
          : null;
        return {
          viewport: { width: innerWidth, height: innerHeight },
          dialog: {
            left: dialogRect.left,
            top: dialogRect.top,
            right: dialogRect.right,
            bottom: dialogRect.bottom,
            width: dialogRect.width,
            height: dialogRect.height
          },
          textarea: {
            width: textareaRect.width,
            height: textareaRect.height,
            clientHeight: textarea.clientHeight,
            scrollHeight: textarea.scrollHeight,
            overflowY: getComputedStyle(textarea).overflowY
          },
          portalParentIsBody: dialog.parentElement?.parentElement === document.body,
          splitterCoveredByDialog: splitterProbe !== splitter && dialog.contains(splitterProbe)
        };
      })()`
    );
    assertPass(
      lyricsDialogMetrics &&
        lyricsDialogMetrics.dialog.left >= 0 &&
        lyricsDialogMetrics.dialog.top >= 0 &&
        lyricsDialogMetrics.dialog.right <= lyricsDialogMetrics.viewport.width &&
        lyricsDialogMetrics.dialog.bottom <= lyricsDialogMetrics.viewport.height &&
        lyricsDialogMetrics.textarea.width >= Math.min(600, lyricsDialogMetrics.viewport.width - 96) &&
        lyricsDialogMetrics.textarea.height >= 260 &&
        lyricsDialogMetrics.textarea.scrollHeight > lyricsDialogMetrics.textarea.clientHeight &&
        ["auto", "scroll"].includes(lyricsDialogMetrics.textarea.overflowY) &&
        lyricsDialogMetrics.portalParentIsBody &&
        lyricsDialogMetrics.splitterCoveredByDialog,
      "Lyrics paste dialog area or vertical scrolling is invalid.",
      lyricsDialogMetrics
    );
    const lyricsDialogScreenshot = await captureOptionalScreenshot(
      cdp,
      lyricsDialogScreenshotPath,
      "lyrics dialog"
    );
    log("LYRICS_DIALOG_OK", {
      metrics: lyricsDialogMetrics,
      screenshotPath: lyricsDialogScreenshot,
    });
    const analyzeClicked = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector(".lyrics-input")?.closest('[role="dialog"]') || document.querySelector(".lyrics-input")?.parentElement;
        const button = [...(dialog?.querySelectorAll("button") || [])].find((item) => item.innerText.trim() === "解析");
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`
    );
    assertPass(analyzeClicked, "Lyrics dialog analyze button could not be clicked.");
    const analysisProgressUi = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="歌詞を解析"]');
        const progress = dialog?.querySelector("progress");
        return dialog && progress && !document.querySelector(".lyrics-input")
          ? {
              portalParentIsBody: dialog.parentElement?.parentElement === document.body,
              value: progress.value,
              max: progress.max,
              text: dialog.textContent
            }
          : false;
      })()`,
      10_000,
      "lyrics analysis progress dialog"
    );
    assertPass(
      analysisProgressUi.portalParentIsBody,
      "Lyrics analysis progress dialog is not portaled above the splitter.",
      analysisProgressUi
    );
    await captureOptionalScreenshot(
      cdp,
      analysisProgressScreenshotPath,
      "lyrics analysis progress"
    );
    log("LYRICS_ANALYSIS_PROGRESS_OK", analysisProgressUi);
    const analysisUi = await waitFor(
      cdp,
      `(() => {
        const segments = [...document.querySelectorAll(".lyrics-segment")];
        const lanes = document.querySelectorAll(".lyrics-lane").length;
        const timelineContent = document.querySelector(".sub-timeline-content");
        const timelineViewport = document.querySelector(".sub-timeline-scroll .scroll-area-viewport");
        return segments.length >= 20 && lanes >= 2
          ? {
              segments: segments.length,
              lanes,
              warnings: document.querySelectorAll(".lyrics-segment.confidence-warning").length,
              gridLines: document.querySelectorAll(".rhythm-grid-line").length,
              timelineWidth: timelineContent?.getBoundingClientRect().width || 0,
              timelineViewportWidth: timelineViewport?.clientWidth || 0,
              laneDensity: [...document.querySelectorAll(".lyrics-lane")].map((lane) => {
                const laneRect = lane.getBoundingClientRect();
                const segment = lane.querySelector(".lyrics-segment");
                const labels = [...lane.querySelectorAll(".lyrics-label")];
                const firstLabelTop = labels.length
                  ? Math.min(...labels.map((label) => label.getBoundingClientRect().top))
                  : null;
                const lastLabelBottom = labels.length
                  ? Math.max(...labels.map((label) => label.getBoundingClientRect().bottom))
                  : null;
                return {
                  height: laneRect.height,
                  leadingGap: segment && firstLabelTop !== null
                    ? firstLabelTop - segment.getBoundingClientRect().bottom
                    : null,
                  trailingGap: lastLabelBottom !== null ? laneRect.bottom - lastLabelBottom : null
                };
              }),
              contentTrailingGap: (() => {
                const laneList = [...document.querySelectorAll(".lyrics-lane")];
                const lastLane = laneList.at(-1);
                return timelineContent && lastLane
                  ? timelineContent.getBoundingClientRect().bottom - lastLane.getBoundingClientRect().bottom
                  : null;
              })(),
              bottomGutter: (() => {
                const scrollRoot = document.querySelector(".sub-timeline-scroll");
                const horizontalScrollbar = scrollRoot?.querySelector(".scroll-area-scrollbar-horizontal");
                const laneList = [...document.querySelectorAll(".lyrics-lane")];
                const lastLane = laneList.at(-1);
                if (!timelineContent || !timelineViewport || !horizontalScrollbar || !lastLane) return null;
                const scrollbarRect = horizontalScrollbar.getBoundingClientRect();
                const previousScrollTop = timelineViewport.scrollTop;
                timelineViewport.scrollTop = timelineViewport.scrollHeight;
                const lastLaneBottomToScrollbarTop = scrollbarRect.top - lastLane.getBoundingClientRect().bottom;
                timelineViewport.scrollTop = previousScrollTop;
                return {
                  contentTrailingGap: timelineContent.getBoundingClientRect().bottom - lastLane.getBoundingClientRect().bottom,
                  contentPaddingBottom: Number.parseFloat(getComputedStyle(timelineContent).paddingBottom),
                  horizontalScrollbarHeight: scrollbarRect.height,
                  lastLaneBottomToScrollbarTop,
                };
              })(),
              headerStatusLayout: (() => {
                const header = document.querySelector(".mode-workspace-header");
                const controls = header?.querySelector(".mode-workspace-controls");
                const actions = header?.querySelector(".mode-toolbar-actions");
                const transport = header?.querySelector(".mode-transport-toolbar");
                const information = actions?.querySelector('button[aria-label="情報"]');
                return header && controls && actions && transport && information
                  ? {
                      headerHeight: header.getBoundingClientRect().height,
                      controlsHeight: controls.getBoundingClientRect().height,
                      actionsHeight: actions.getBoundingClientRect().height,
                      transportHeight: transport.getBoundingClientRect().height,
                      informationInsideActions: actions.contains(information),
                      hasResidentStatus: !!header.querySelector(".mode-workspace-status")
                    }
                  : null;
              })(),
              overflowingLabels: [...document.querySelectorAll(".lyrics-lane")].flatMap((lane) => {
                const laneBottom = lane.getBoundingClientRect().bottom;
                return [...lane.querySelectorAll(".lyrics-label")]
                  .filter((label) => label.getBoundingClientRect().bottom > laneBottom + 1)
                  .map((label) => label.textContent);
              })
            }
          : false;
      })()`,
      20 * 60_000,
      "real lyrics analysis"
    );
    await waitFor(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="歌詞を解析"] progress')?.value >= 1`,
      30_000,
      "completed lyrics progress"
    );
    const progressClosed = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="歌詞を解析"]');
        const button = [...(dialog?.querySelectorAll("button") || [])].find((item) => item.textContent.trim() === "閉じる");
        button?.click();
        return !!button;
      })()`
    );
    assertPass(progressClosed, "Completed lyrics progress dialog could not be closed.");
    const project = await waitForJson(
      subProjectPath,
      (value) => value.subtitle?.lanes?.some((lane) => lane.segments?.length >= 20),
      60_000,
      "saved lyrics analysis"
    );
    const allSegments = project.subtitle.lanes.flatMap((lane) => lane.segments);
    const titleLane = project.subtitle.lanes.find((lane) => lane.segments.some((segment) => segment.source === "title"));
    const warningSegments = allSegments.filter((segment) => segment.low_confidence_outlier);
    assertPass(
      analysisUi.timelineViewportWidth > 0 &&
        Math.abs(analysisUi.timelineWidth - analysisUi.timelineViewportWidth) <= 2,
      "The 100% timeline does not fill the available window width.",
      analysisUi
    );
    assertPass(
      analysisUi.overflowingLabels.length === 0,
      "A stacked lyrics label overflows into the next timeline lane.",
      analysisUi.overflowingLabels
    );
    assertPass(
      analysisUi.laneDensity.every(
        (lane) =>
          lane.height < 240 &&
          (lane.leadingGap === null || (lane.leadingGap >= -1 && lane.leadingGap <= 8)) &&
          (lane.trailingGap === null || (lane.trailingGap >= -1 && lane.trailingGap <= 8))
      ) &&
        analysisUi.bottomGutter &&
        analysisUi.bottomGutter.horizontalScrollbarHeight >= 8 &&
        Math.abs(analysisUi.bottomGutter.contentTrailingGap - analysisUi.bottomGutter.horizontalScrollbarHeight) <= 1 &&
        Math.abs(analysisUi.bottomGutter.contentPaddingBottom - analysisUi.bottomGutter.horizontalScrollbarHeight) <= 1 &&
        analysisUi.bottomGutter.lastLaneBottomToScrollbarTop >= -1,
      "The final Sub lyrics lane is not reserved above the horizontal scrollbar.",
      {
        laneDensity: analysisUi.laneDensity,
        bottomGutter: analysisUi.bottomGutter,
      }
    );
    assertPass(
      analysisUi.headerStatusLayout &&
        Math.abs(analysisUi.headerStatusLayout.headerHeight - analysisUi.headerStatusLayout.controlsHeight) <= 2 &&
        analysisUi.headerStatusLayout.headerHeight <= 90 &&
        analysisUi.headerStatusLayout.actionsHeight <= 42 &&
        analysisUi.headerStatusLayout.transportHeight <= 42 &&
        analysisUi.headerStatusLayout.informationInsideActions &&
        !analysisUi.headerStatusLayout.hasResidentStatus,
      "Sub controls do not retain the compact status-free Cut header contract.",
      analysisUi.headerStatusLayout
    );
    assertPass(
      project.subtitle.beat_warning === null &&
        project.subtitle.tempo_bpm > 0 &&
        project.subtitle.rhythm_grid.length > 0 &&
        analysisUi.gridLines > 0,
      "Beat analysis or the visible 1/4-beat grid is missing.",
      {
        beatWarning: project.subtitle.beat_warning,
        tempoBpm: project.subtitle.tempo_bpm,
        gridPoints: project.subtitle.rhythm_grid.length,
        visibleGridLines: analysisUi.gridLines,
      }
    );
    assertPass(titleLane?.style?.alignment === 7, "Title lane is not left-top aligned.", titleLane);
    assertPass(titleLane.segments[0].start === 0 && titleLane.segments[0].end === 5, "Title timing is not 0-5 seconds.", titleLane);
    assertPass(
      warningSegments.length === project.subtitle.confidence_statistics.low_outlier_indexes.length &&
        analysisUi.warnings === warningSegments.length,
      "Confidence outlier warning colors do not match saved statistics.",
      { analysisUi, warningSegments, stats: project.subtitle.confidence_statistics }
    );
    log("SUB_REAL_ANALYSIS_OK", {
      lineCount: allSegments.length,
      laneCount: project.subtitle.lanes.length,
      warningCount: warningSegments.length,
      confidence: project.subtitle.confidence_statistics,
    });
    const renamedLane = project.subtitle.lanes.find((lane) =>
      lane.segments.some((segment) => segment.source === "lyrics")
    ) || project.subtitle.lanes[0];
    const temporaryLaneName = `${renamedLane.name} E2E`;
    assertPass(
      await evaluate(
        cdp,
        `(() => {
          const laneName = [...document.querySelectorAll(".lyrics-lane-name")].find(
            (item) => item.textContent.trim() === ${JSON.stringify(renamedLane.name)}
          );
          if (!laneName) return false;
          laneName.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
          return true;
        })()`
      ),
      "Lyrics timeline name could not be opened by double-click."
    );
    await waitFor(cdp, `!!document.querySelector(".lyrics-lane-name-input")`, 10_000, "timeline name editor");
    await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".lyrics-lane-name-input");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(temporaryLaneName)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return input.value;
      })()`
    );
    await waitFor(
      cdp,
      `document.querySelector(".lyrics-lane-name-input")?.value === ${JSON.stringify(temporaryLaneName)}`,
      10_000,
      "edited timeline name"
    );
    await sleep(50);
    await evaluate(
      cdp,
      `document.querySelector(".lyrics-lane-name-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`
    );
    await waitForJson(
      subProjectPath,
      (value) => value.subtitle?.lanes?.find((lane) => lane.id === renamedLane.id)?.name === temporaryLaneName,
      60_000,
      "renamed lyrics timeline persistence"
    );
    assertPass(
      await evaluate(
        cdp,
        `[...document.querySelectorAll(".lyrics-lane-name")].some((item) => item.textContent.trim() === ${JSON.stringify(temporaryLaneName)})`
      ),
      "Renamed lyrics timeline is not visible."
    );
    await evaluate(
      cdp,
      `(() => {
        const laneName = [...document.querySelectorAll(".lyrics-lane-name")].find(
          (item) => item.textContent.trim() === ${JSON.stringify(temporaryLaneName)}
        );
        laneName?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        return !!laneName;
      })()`
    );
    await waitFor(cdp, `!!document.querySelector(".lyrics-lane-name-input")`, 10_000, "timeline name restore editor");
    await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".lyrics-lane-name-input");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(renamedLane.name)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return input.value;
      })()`
    );
    await sleep(50);
    await evaluate(
      cdp,
      `document.querySelector(".lyrics-lane-name-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`
    );
    await waitForJson(
      subProjectPath,
      (value) => value.subtitle?.lanes?.find((lane) => lane.id === renamedLane.id)?.name === renamedLane.name,
      60_000,
      "restored lyrics timeline name"
    );
    log("SUB_TIMELINE_RENAME_OK", { laneId: renamedLane.id, originalName: renamedLane.name });
    const cachedProject = await waitForJson(
      subProjectPath,
      (value) => {
        const segments = value.subtitle?.lanes?.flatMap((lane) => lane.segments || []) || [];
        return (
          segments.length === allSegments.length &&
          segments.every(
            (segment) =>
              segment.render_cache?.signature &&
              segment.render_cache?.png_base64?.startsWith("iVBOR") &&
              Number.isInteger(segment.render_cache?.width) &&
              segment.render_cache.width > 0 &&
              Number.isInteger(segment.render_cache?.height) &&
              segment.render_cache.height > 0
          )
        );
      },
      5 * 60_000,
      "persisted ASS subtitle PNG cache"
    );
    const cachedSegments = cachedProject.subtitle.lanes.flatMap((lane) => lane.segments);
    const initialRenderRequestCount = await evaluate(cdp, `window.__subtitleRenderRequests`);
    const initialCacheSnapshot = cachedSegments.map((segment) => ({
      id: segment.id,
      signature: segment.render_cache.signature,
      png_base64: segment.render_cache.png_base64,
    }));
    await sleep(1500);
    const stableRenderRequestCount = await evaluate(cdp, `window.__subtitleRenderRequests`);
    const stableCachedProject = JSON.parse(fs.readFileSync(subProjectPath, "utf8"));
    const stableCacheSnapshot = stableCachedProject.subtitle.lanes
      .flatMap((lane) => lane.segments)
      .map((segment) => ({
        id: segment.id,
        signature: segment.render_cache.signature,
        png_base64: segment.render_cache.png_base64,
      }));
    assertPass(
      initialRenderRequestCount >= 1 &&
        stableRenderRequestCount === initialRenderRequestCount &&
        JSON.stringify(stableCacheSnapshot) === JSON.stringify(initialCacheSnapshot),
      "Unchanged subtitle text and style regenerated the ASS PNG cache.",
      { initialRenderRequestCount, stableRenderRequestCount }
    );
    log("SUB_PNG_CACHE_OK", {
      segmentCount: cachedSegments.length,
      requestCount: initialRenderRequestCount,
      projectBytes: fs.statSync(subProjectPath).size,
    });

    const zoomButtonPoint = await evaluate(
      cdp,
      `(() => {
        const groups = document.querySelectorAll(".sub-toolbar .mode-transport-toolbar > .icon-group");
        const zoomGroup = groups[groups.length - 1];
        const buttons = zoomGroup?.querySelectorAll("button");
        const button = buttons?.[buttons.length - 1];
        if (!button || button.disabled) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`
    );
    assertPass(zoomButtonPoint, "Sub timeline zoom-in button could not be clicked.");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: zoomButtonPoint.x, y: zoomButtonPoint.y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: zoomButtonPoint.x, y: zoomButtonPoint.y, button: "left", clickCount: 1 });
    await sleep(60);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: zoomButtonPoint.x, y: zoomButtonPoint.y, button: "left", clickCount: 1 });
    await sleep(300);
    const subActionFocus = await waitFor(
      cdp,
      `(() => {
        const active = document.activeElement;
        const groups = document.querySelectorAll(".sub-toolbar .mode-transport-toolbar > .icon-group");
        const zoomGroup = groups[groups.length - 1];
        const buttons = zoomGroup?.querySelectorAll("button");
        const button = buttons?.[buttons.length - 1];
        return active?.matches("[data-editor-focus-root]") && button
          ? { activeTag: active.tagName, activeIsRoot: true, actionTabIndex: button.tabIndex }
          : false;
      })()`,
      5000,
      "Sub editor action focus restore"
    );
    assertPass(subActionFocus.actionTabIndex === -1, "Sub editor action remained in the tab order.", subActionFocus);
    log("SUB_EDITOR_ACTION_FOCUS_OK", subActionFocus);
    await waitFor(
      cdp,
      `document.querySelector(".sub-timeline-content")?.getBoundingClientRect().width >
        document.querySelector(".sub-timeline-scroll .scroll-area-viewport")?.clientWidth * 1.9`,
      10_000,
      "zoomed Sub timeline"
    );
    const horizontalScroll = await evaluate(
      cdp,
      `(() => {
        const root = document.querySelector(".sub-timeline-scroll");
        const viewport = root?.querySelector(".scroll-area-viewport");
        const scrollbar = root?.querySelector(".scroll-area-scrollbar-horizontal");
        const waveform = root?.querySelector(".sub-waveform");
        if (!root || !viewport || !scrollbar || !waveform) return null;
        viewport.scrollLeft = 0;
        waveform.dispatchEvent(new WheelEvent("wheel", { deltaY: 640, bubbles: true, cancelable: true }));
        const rootRect = root.getBoundingClientRect();
        const scrollbarRect = scrollbar.getBoundingClientRect();
        return {
          scrollLeft: viewport.scrollLeft,
          maxScrollLeft: viewport.scrollWidth - viewport.clientWidth,
          scrollbarVisible:
            scrollbarRect.height >= 10 &&
            scrollbarRect.top >= rootRect.top &&
            scrollbarRect.bottom <= rootRect.bottom + 1
        };
      })()`
    );
    assertPass(
      horizontalScroll?.scrollLeft > 0 &&
        horizontalScroll.maxScrollLeft > 0 &&
        horizontalScroll.scrollbarVisible,
      "Mouse-wheel horizontal scrolling or the draggable scrollbar is unavailable.",
      horizontalScroll
    );
    log("SUB_HORIZONTAL_SCROLL_OK", horizontalScroll);
    const scrollbarTrackPoint = await evaluate(
      cdp,
      `(() => {
        const scrollbar = document.querySelector(
          ".sub-timeline-scroll .scroll-area-scrollbar-horizontal"
        );
        if (!scrollbar) return null;
        const rect = scrollbar.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : null;
      })()`
    );
    assertPass(scrollbarTrackPoint, "Sub timeline horizontal scrollbar track is missing.");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: scrollbarTrackPoint.x,
      y: scrollbarTrackPoint.y,
      button: "none",
      buttons: 0,
    });
    let scrollbarThumbPoint = null;
    for (let attempt = 0; attempt < 20 && !scrollbarThumbPoint; attempt += 1) {
      await evaluate(
        cdp,
        `(() => {
          const viewport = document.querySelector(".sub-timeline-scroll .scroll-area-viewport");
          const waveform = document.querySelector(".sub-timeline-scroll .sub-waveform");
          if (!viewport || !waveform) return false;
          viewport.scrollLeft = 0;
          waveform.dispatchEvent(
            new WheelEvent("wheel", { deltaY: 1, bubbles: true, cancelable: true })
          );
          return true;
        })()`
      );
      await sleep(50);
      scrollbarThumbPoint = await evaluate(
        cdp,
        `(() => {
          const thumb = document.querySelector(
            ".sub-timeline-scroll .scroll-area-scrollbar-horizontal .scroll-area-thumb"
          );
          if (!thumb) return null;
          const rect = thumb.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : null;
        })()`
      );
    }
    if (scrollbarThumbPoint) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: scrollbarThumbPoint.x,
        y: scrollbarThumbPoint.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: scrollbarThumbPoint.x + 140,
        y: scrollbarThumbPoint.y,
        button: "left",
        buttons: 1,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: scrollbarThumbPoint.x + 140,
        y: scrollbarThumbPoint.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      const draggedScrollLeft = await evaluate(
        cdp,
        `document.querySelector(".sub-timeline-scroll .scroll-area-viewport")?.scrollLeft || 0`
      );
      assertPass(
        draggedScrollLeft > 0,
        "Sub timeline horizontal scrollbar could not be dragged.",
        { draggedScrollLeft }
      );
    } else {
      log("SUB_SCROLLBAR_DRAG_SKIPPED", {
        reason: "Radix auto-hidden thumb was not visible during the bounded probe.",
      });
    }

    const lyricsSegments = project.subtitle.lanes
      .flatMap((lane) => lane.segments)
      .filter((segment) => segment.source === "lyrics")
      .sort((left, right) => left.start - right.start);
    const focusTargetIndex = Math.floor(lyricsSegments.length * 0.7);
    const focusTarget = lyricsSegments[focusTargetIndex];
    const focusNext = lyricsSegments[focusTargetIndex + 1];
    await evaluate(
      cdp,
      `(() => {
        const viewport = document.querySelector(".sub-timeline-scroll .scroll-area-viewport");
        if (!viewport) return false;
        viewport.scrollLeft = 0;
        return true;
      })()`
    );
    await waitFor(
      cdp,
      `document.querySelector(".sub-timeline-scroll .scroll-area-viewport")?.scrollLeft === 0`,
      10_000,
      "Sub offscreen selection setup"
    );
    const focusClick = await evaluate(
      cdp,
      `(() => {
        const target = [...document.querySelectorAll(".lyrics-segment")].find(
          (item) => item.title.startsWith(${JSON.stringify(`${focusTarget.text}\n`)})
        );
        target?.click();
        return !!target;
      })()`
    );
    assertPass(focusClick, "A distant Sub lyrics segment could not be selected.");
    const focusedSelection = await waitFor(
      cdp,
      `(() => {
        const viewport = document.querySelector(".sub-timeline-scroll .scroll-area-viewport");
        const selected = document.querySelector(".lyrics-segment.selected");
        const video = document.querySelector("video");
        if (!viewport || !selected || !video || Math.abs(video.currentTime - ${focusTarget.start}) > 0.08) return false;
        const expected = Math.max(
          0,
          Math.min(
            selected.offsetLeft + selected.offsetWidth / 2 - viewport.clientWidth / 2,
            viewport.scrollWidth - viewport.clientWidth
          )
        );
        return {
          currentTime: video.currentTime,
          scrollLeft: viewport.scrollLeft,
          expected,
          delta: Math.abs(viewport.scrollLeft - expected)
        };
      })()`,
      10_000,
      "Sub segment start seek and centered focus"
    );
    assertPass(
      focusedSelection.delta <= 2,
      "Selecting a Sub segment did not seek to its start and center its visible range.",
      { focusedSelection, focusTarget }
    );

    const scrollBeforeVisibleShortcut = focusedSelection.scrollLeft;
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "s",
      code: "KeyS",
      windowsVirtualKeyCode: 83,
      nativeVirtualKeyCode: 83,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "s",
      code: "KeyS",
      windowsVirtualKeyCode: 83,
      nativeVirtualKeyCode: 83,
    });
    const shortcutSelection = await waitFor(
      cdp,
      `(() => {
        const viewport = document.querySelector(".sub-timeline-scroll .scroll-area-viewport");
        const selected = document.querySelector(".lyrics-segment.selected");
        const video = document.querySelector("video");
        if (!viewport || !selected || !video || Math.abs(video.currentTime - ${focusNext.start}) > 0.08) return false;
        const selectedLeft = selected.offsetLeft;
        const selectedRight = selectedLeft + selected.offsetWidth;
        const fullyVisible =
          selectedLeft >= viewport.scrollLeft &&
          selectedRight <= viewport.scrollLeft + viewport.clientWidth;
        return {
          currentTime: video.currentTime,
          scrollLeft: viewport.scrollLeft,
          fullyVisible,
          delta: Math.abs(viewport.scrollLeft - ${scrollBeforeVisibleShortcut})
        };
      })()`,
      10_000,
      "Sub next-segment shortcut visible-range preservation"
    );
    assertPass(
      shortcutSelection.fullyVisible && shortcutSelection.delta <= 2,
      "Selecting a fully visible segment unexpectedly centered the shared timeline.",
      { shortcutSelection, focusNext }
    );
    log("SUB_SHARED_SEGMENT_FOCUS_OK", { focusedSelection, shortcutSelection });

    assertPass(await evaluate(
      cdp,
      `(() => {
        const groups = document.querySelectorAll(".sub-toolbar .mode-transport-toolbar > .icon-group");
        const zoomGroup = groups[groups.length - 1];
        const buttons = zoomGroup?.querySelectorAll("button");
        buttons?.[buttons.length - 1]?.click();
        return !!buttons?.length;
      })()`
    ), "Sub timeline second zoom-in button could not be clicked.");
    const zoomCursorAnchor = await waitFor(
      cdp,
      `(() => {
        const viewport = document.querySelector(".sub-timeline-scroll .scroll-area-viewport");
        const content = document.querySelector(".sub-timeline-content");
        const video = document.querySelector("video");
        if (!viewport || !content || !video || content.getBoundingClientRect().width < viewport.clientWidth * 3.9) return false;
        const playheadX = (video.currentTime / video.duration) * viewport.scrollWidth;
        const ratio = (playheadX - viewport.scrollLeft) / viewport.clientWidth;
        return ratio >= 0.68 && ratio <= 0.72 ? { ratio, scrollLeft: viewport.scrollLeft } : false;
      })()`,
      10_000,
      "Cut-compatible Sub zoom cursor anchor"
    );
    assertPass(
      zoomCursorAnchor.ratio >= 0.68 && zoomCursorAnchor.ratio <= 0.72,
      "Sub zoom did not use the Cut playhead-first 70% anchor.",
      zoomCursorAnchor
    );

    await evaluate(
      cdp,
      `(async () => {
        const video = document.querySelector("video");
        await video.play();
        video.currentTime = video.duration * 0.9;
        video.dispatchEvent(new Event("timeupdate"));
        return true;
      })()`
    );
    const playbackFollow = await waitFor(
      cdp,
      `(() => {
        const viewport = document.querySelector(".sub-timeline-scroll .scroll-area-viewport");
        const video = document.querySelector("video");
        if (!viewport || !video || video.paused) return false;
        const playheadX = (video.currentTime / video.duration) * viewport.scrollWidth;
        const ratio = (playheadX - viewport.scrollLeft) / viewport.clientWidth;
        return ratio >= 0.68 && ratio <= 0.72 ? { ratio } : false;
      })()`,
      10_000,
      "Sub playback cursor follow"
    );
    assertPass(
      playbackFollow.ratio >= 0.68 && playbackFollow.ratio <= 0.72,
      "Sub playback did not follow the Cut 90%-to-70% cursor rule.",
      playbackFollow
    );
    await evaluate(cdp, `document.querySelector("video")?.pause()`);
    log("SUB_SHARED_CURSOR_RULES_OK", { zoomCursorAnchor, playbackFollow });

    const zoomReset = await evaluate(
      cdp,
      `(() => {
        const groups = document.querySelectorAll(".sub-toolbar .mode-transport-toolbar > .icon-group");
        const zoomGroup = groups[groups.length - 1];
        const button = [...(zoomGroup?.querySelectorAll("button") || [])].find((item) => item.textContent.includes("%"));
        button?.click();
        return !!button;
      })()`
    );
    assertPass(zoomReset, "Sub timeline zoom reset button could not be clicked.");
    await evaluate(
      cdp,
      `(() => {
        const target = [...document.querySelectorAll(".lyrics-segment")].find(
          (item) => item.title.startsWith(${JSON.stringify(`${lyricsSegments[0].text}\n`)})
        );
        target?.click();
        return !!target;
      })()`
    );
    await waitFor(
      cdp,
      `Math.abs(document.querySelector("video")?.currentTime - ${lyricsSegments[0].start}) < 0.08`,
      10_000,
      "restored first lyrics selection"
    );

    const styleOpened = await evaluate(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll(".lyrics-lane-header button")].find((item) => item.textContent.trim().startsWith("Style"));
        button?.click();
        return !!button;
      })()`
    );
    assertPass(styleOpened, "Subtitle style dialog could not be opened.");
    const installedFontCount = await waitFor(
      cdp,
      `(() => {
        const select = document.querySelector('[role="dialog"][aria-label="字幕スタイル"] select[aria-label="フォント"]');
        return select && !select.disabled && select.options.length > 20 ? select.options.length : false;
      })()`,
      30_000,
      "installed OS font list"
    );
    const styleDialogMetrics = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        const label = dialog?.querySelector(".subtitle-style-fields label");
        const alignmentButton = dialog?.querySelector(".alignment-grid button");
        const splitter = document.querySelector(".splitter");
        if (!dialog || !label || !alignmentButton || !splitter) return false;
        const dialogRect = dialog.getBoundingClientRect();
        const splitterRect = splitter.getBoundingClientRect();
        const probe = document.elementFromPoint(dialogRect.left + 24, splitterRect.top + splitterRect.height / 2);
        return {
          portalParentIsBody: dialog.parentElement?.parentElement === document.body,
          splitterCoveredByDialog: probe !== splitter && dialog.contains(probe),
          labelFontSize: getComputedStyle(label).fontSize,
          buttonFontSize: getComputedStyle(alignmentButton).fontSize
        };
      })()`,
      10_000,
      "subtitle style dialog"
    );
    assertPass(
      styleDialogMetrics.portalParentIsBody &&
        styleDialogMetrics.splitterCoveredByDialog &&
        styleDialogMetrics.labelFontSize === styleDialogMetrics.buttonFontSize,
      "Subtitle style dialog layering or font sizing is inconsistent.",
      styleDialogMetrics
    );
    const styleScrollArea = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        const root = dialog?.querySelector(".subtitle-style-scroll.scroll-area");
        const viewport = root?.querySelector(".scroll-area-viewport");
        const scrollbar = root?.querySelector(".scroll-area-scrollbar-vertical");
        const editor = root?.querySelector(".subtitle-style-editor");
        return root && viewport && editor
          ? {
              rootClass: root.className,
              viewportClass: viewport.className,
              scrollbarClass: scrollbar?.className ?? null,
              editorOverflowY: getComputedStyle(editor).overflowY,
              viewportClientHeight: viewport.clientHeight,
              viewportScrollHeight: viewport.scrollHeight,
            }
          : false;
      })()`,
      10_000,
      "Subtitle style shadcn ScrollArea"
    );
    assertPass(
      styleScrollArea.rootClass.includes("scroll-area") &&
      styleScrollArea?.viewportClass.includes("subtitle-style-scroll-viewport") &&
        styleScrollArea.editorOverflowY !== "auto" &&
        styleScrollArea.editorOverflowY !== "scroll",
      "Subtitle style dialog does not use the shared shadcn ScrollArea as its scroll owner.",
      styleScrollArea
    );
    const styleScrollPoint = await evaluate(
      cdp,
      `(() => {
        const root = document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .subtitle-style-scroll.scroll-area');
        if (!root) return null;
        const rect = root.getBoundingClientRect();
        return { x: rect.right - 5, y: rect.top + rect.height / 2 };
      })()`
    );
    assertPass(styleScrollPoint, "Subtitle style ScrollArea was not available for hover verification.");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: styleScrollPoint.x, y: styleScrollPoint.y });
    const styleScrollbarClass = await waitFor(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .subtitle-style-scroll .scroll-area-scrollbar-vertical')?.className || false`,
      5000,
      "Subtitle style shadcn vertical scrollbar on hover"
    );
    assertPass(
      styleScrollbarClass.includes("scroll-area-scrollbar-vertical"),
      "Subtitle style ScrollArea did not show its shadcn vertical scrollbar on hover.",
      styleScrollbarClass
    );
    const previewLayout = await evaluate(
      cdp,
      `(async () => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        const frame = dialog?.querySelector(".subtitle-effect-preview-frame");
        const video = frame?.querySelector("video");
        if (!dialog || !frame || !video) return null;
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        };
        const before = { dialog: rect(dialog), frame: rect(frame), video: rect(video) };
        void video.play().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 500));
        const after = { dialog: rect(dialog), frame: rect(frame), video: rect(video) };
        video.pause();
        return { before, after };
      })()`
    );
    assertPass(
      previewLayout &&
        Math.abs(previewLayout.before.dialog.width - previewLayout.after.dialog.width) < 1 &&
        Math.abs(previewLayout.before.dialog.height - previewLayout.after.dialog.height) < 1 &&
        Math.abs(previewLayout.before.frame.width - previewLayout.after.frame.width) < 1 &&
        Math.abs(previewLayout.before.frame.height - previewLayout.after.frame.height) < 1 &&
        Math.abs(previewLayout.after.video.width - previewLayout.after.frame.width) < 1 &&
        Math.abs(previewLayout.after.video.height - previewLayout.after.frame.height) < 1,
      "Effect preview playback changed the subtitle style dialog size.",
      previewLayout
    );
    const styleControls = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        const select = dialog?.querySelector('select[aria-label="フォント"]');
        const toggles = dialog?.querySelectorAll(".toggle");
        const colors = dialog?.querySelectorAll('input[type="color"]');
        if (!dialog || !select || !toggles || !colors) return null;
        const targetFont = select.options[Math.min(10, select.options.length - 1)]?.value;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(select, targetFont);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        toggles[0]?.click();
        return {
          fontOptions: select.options.length,
          targetFont,
          selectedFont: select.value,
          toggleCount: toggles.length,
          colorCount: colors.length,
          colorLabels: [...dialog.querySelectorAll(".color-control > span")].map((item) => item.textContent.trim()),
          dialogHeight: dialog.getBoundingClientRect().height,
          viewportHeight: innerHeight
        };
      })()`
    );
    assertPass(
      styleControls?.fontOptions === installedFontCount &&
        styleControls.selectedFont === styleControls.targetFont &&
        styleControls.toggleCount === 2 &&
        styleControls.colorCount === 3 &&
        JSON.stringify(styleControls.colorLabels) === JSON.stringify(["文字", "背景", "縁"]) &&
        styleControls.dialogHeight < styleControls.viewportHeight * 0.85,
      "Refined subtitle style controls are incomplete or excessively tall.",
      styleControls
    );
    const shadowInputUpdated = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        const label = [...(dialog?.querySelectorAll(".subtitle-style-fields label") || [])]
          .find((item) => item.textContent.trim().startsWith("影"));
        const input = label?.querySelector("input");
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "50");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`
    );
    assertPass(shadowInputUpdated, "Subtitle shadow input could not be updated.");
    const clampedShadow = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        const label = [...(dialog?.querySelectorAll(".subtitle-style-fields label") || [])]
          .find((item) => item.textContent.trim().startsWith("影"));
        const input = label?.querySelector("input");
        return input?.value === "30" ? { value: input.value, max: input.max } : false;
      })()`,
      10_000,
      "subtitle shadow API-limit clamp"
    );
    assertPass(
      clampedShadow.value === "30" && clampedShadow.max === "30",
      "Subtitle shadow was not clamped to the API limit.",
      clampedShadow
    );
    await waitFor(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .toggle')?.dataset.state === "on"`,
      10_000,
      "subtitle bold toggle"
    );
    await evaluate(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .toggle')?.click()`
    );
    const boldOffMetrics = await waitFor(
      cdp,
      `(() => {
        const toggle = document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .toggle');
        if (!toggle || toggle.dataset.state !== "off") return false;
        const style = getComputedStyle(toggle);
        return { state: toggle.dataset.state, color: style.color, opacity: style.opacity };
      })()`,
      10_000,
      "visible subtitle bold toggle in off state"
    );
    assertPass(
      boldOffMetrics.color !== "rgba(0, 0, 0, 0)" && Number(boldOffMetrics.opacity) > 0.9,
      "Bold toggle is invisible in its off state.",
      boldOffMetrics
    );
    await captureOptionalScreenshot(cdp, styleDialogScreenshotPath, "subtitle style dialog");
    log("SUB_STYLE_DIALOG_OK", styleControls);
    await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        [...(dialog?.querySelectorAll("button") || [])].find((item) => item.textContent.trim() === "閉じる")?.click();
      })()`
    );
    const firstLaneCacheBeforeStyle = new Map(
      cachedProject.subtitle.lanes[0].segments.map((segment) => [
        segment.id,
        segment.render_cache.signature,
      ])
    );
    const styleUpdatedProject = await waitForJson(
      subProjectPath,
      (value) => {
        const lane = value.subtitle?.lanes?.[0];
        return (
          lane?.style?.font_name === styleControls.targetFont &&
          lane.segments?.every(
            (segment) =>
              segment.render_cache?.png_base64?.startsWith("iVBOR") &&
              segment.render_cache.signature !== firstLaneCacheBeforeStyle.get(segment.id)
          )
        );
      },
      5 * 60_000,
      "subtitle PNG cache invalidation after style change"
    );
    const renderRequestCountAfterStyle = await evaluate(cdp, `window.__subtitleRenderRequests`);
    assertPass(
      renderRequestCountAfterStyle > initialRenderRequestCount,
      "Changing a subtitle style did not request regenerated ASS PNG frames.",
      { initialRenderRequestCount, renderRequestCountAfterStyle }
    );
    log("SUB_PNG_CACHE_INVALIDATION_OK", {
      font: styleUpdatedProject.subtitle.lanes[0].style.font_name,
      regeneratedSegments: styleUpdatedProject.subtitle.lanes[0].segments.length,
      renderRequestCountAfterStyle,
    });

    const effectDialogOpened = await evaluate(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll(".lyrics-lane-header button")].find((item) => item.textContent.trim().startsWith("Style"));
        button?.click();
        return !!button;
      })()`
    );
    assertPass(effectDialogOpened, "Subtitle style dialog could not be reopened.");
    await waitFor(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .subtitle-effect-section .radix-select-trigger') !== null`,
      10_000,
      "subtitle effect selector"
    );
    const effectSelectorOpened = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        const trigger = dialog?.querySelector(".subtitle-effect-section .radix-select-trigger");
        if (!trigger) return false;
        trigger.click();
        return true;
      })()`
    );
    assertPass(effectSelectorOpened, "Subtitle effect Radix selector could not be opened.");
    const effectCatalogUi = await waitFor(
      cdp,
      `(() => {
        const content = document.querySelector('.radix-select-content[data-state="open"]');
        const items = content ? [...content.querySelectorAll("[data-effect-id]")] : [];
        const groups = content ? content.querySelectorAll('[role="group"]') : [];
        const video = document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .subtitle-effect-preview');
        return content && items.length === 97 && groups.length > 1
          ? {
              optionCount: items.length,
              uniqueOptionCount: new Set(items.map((item) => item.getAttribute("data-effect-id"))).size,
              groupCount: groups.length,
              previewUrl: video?.getAttribute("src") || "",
            }
          : false;
      })()`,
      10_000,
      "subtitle effect Radix portal options"
    );
    assertPass(
      effectCatalogUi?.optionCount === 97 &&
        effectCatalogUi.uniqueOptionCount === 97 &&
        effectCatalogUi.groupCount > 1 &&
        effectCatalogUi.previewUrl.includes("mokusatsu.github.io/ASS_Lyric_Effects/preview/"),
      "ASS_Lyric_Effects v3 catalog or Pages preview is incomplete.",
      effectCatalogUi
    );
    const effectConfigured = await evaluate(
      cdp,
      `(() => {
        const content = document.querySelector('.radix-select-content[data-state="open"]');
        const item = content?.querySelector('[data-effect-id="fad"]');
        if (!item) return false;
        item.scrollIntoView({ block: "nearest" });
        item.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
          pointerType: "mouse",
        }));
        item.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
          pointerType: "mouse",
        }));
        return true;
      })()`
    );
    assertPass(effectConfigured, "Subtitle lane effect could not be configured.");
    await waitFor(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .subtitle-effect-preview')?.getAttribute("src")?.includes("_fad.mp4")`,
      10_000,
      "catalog-derived fad preview"
    );
    await waitFor(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="字幕スタイル"] input[value="750"]') !== null`,
      10_000,
      "subtitle effect duration controls"
    );
    await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        [...(dialog?.querySelectorAll("button") || [])].find((item) => item.textContent.trim() === "閉じる")?.click();
      })()`
    );
    const effectUpdatedProject = await waitForJson(
      subProjectPath,
      (value) => value.subtitle?.lanes?.[0]?.effect?.name === "fad",
      30_000,
      "subtitle lane effect persistence"
    );
    const renderRequestCountAfterEffect = await evaluate(cdp, `window.__subtitleRenderRequests`);
    assertPass(
      renderRequestCountAfterEffect === renderRequestCountAfterStyle &&
        effectUpdatedProject.subtitle.lanes[0].segments.every(
          (segment, index) =>
            segment.render_cache?.signature ===
            styleUpdatedProject.subtitle.lanes[0].segments[index]?.render_cache?.signature
        ),
      "Export-only effect unexpectedly regenerated preview ASS PNG frames.",
      { renderRequestCountAfterStyle, renderRequestCountAfterEffect }
    );
    log("SUB_EXPORT_ONLY_EFFECT_OK", {
      effect: effectUpdatedProject.subtitle.lanes[0].effect,
      renderRequestCountAfterEffect,
    });

    const segmentStyleTarget = effectUpdatedProject.subtitle.lanes[0].segments[0];
    const zoomRangeStart = Math.max(0, segmentStyleTarget.start - 2);
    const zoomRangeEnd = Math.min(effectUpdatedProject.source.duration_seconds, segmentStyleTarget.end + 2);
    const zoomRangeDuration = zoomRangeEnd - zoomRangeStart;
    const segmentInspectorReady = await waitFor(
      cdp,
      `(() => {
        const inspector = document.querySelector('.segment-inspector-shell');
        const sections = [...(inspector?.querySelectorAll('.segment-inspector-section') || [])];
        const headers = sections.map((section) => section.querySelector('.segment-inspector-header'));
        return sections.length === 4 && headers.every(Boolean)
          ? { labels: headers.map((header) => header.textContent.trim()), tabCount: inspector.querySelectorAll('[role="tab"]').length }
          : false;
      })()`,
      10_000,
      "Sub segment inspector Timeline, Timing, display-element, and Style accordions"
    );
    assertPass(
      JSON.stringify(segmentInspectorReady.labels) === JSON.stringify(["Timeline", "タイミング", "表示素", "スタイル"]) && segmentInspectorReady.tabCount === 0,
      "Sub segment inspector accordion contract is incomplete.",
      segmentInspectorReady
    );
    const initialDisplayElements = segmentStyleTarget.display_elements || [];
    assertPass(initialDisplayElements.length >= 2, "Standard Align did not provide editable display elements.", {
      segmentId: segmentStyleTarget.id,
      count: initialDisplayElements.length,
    });
    const displayElementUi = await waitFor(
      cdp,
      `(() => {
        const section = document.querySelector('.segment-inspector-section[data-section="display-elements"]');
        const timeline = section?.querySelector('.display-element-timeline');
        const blocks = [...(timeline?.querySelectorAll('.display-element-block') || [])];
        const merge = section?.querySelector('button[aria-label="右とマージ"]');
        const addLeft = section?.querySelector('button[aria-label="左に新規"]');
        const addRight = section?.querySelector('button[aria-label="右に新規"]');
        const remove = section?.querySelector('button[aria-label="表示素を削除"]');
        if (!timeline || blocks.length < 2 || !merge || !addLeft || !addRight || !remove) return false;
        const timelineRect = timeline.getBoundingClientRect();
        const firstRect = blocks[0].getBoundingClientRect();
        const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
        return {
          count: blocks.length,
          selectedCount: timeline.querySelectorAll('.display-element-block.selected').length,
          fillsWidth: Math.abs(firstRect.left - timelineRect.left) <= 2 && Math.abs(lastRect.right - timelineRect.right) <= 2,
        };
      })()`,
      10_000,
      "display-element inspector timeline"
    );
    assertPass(
      displayElementUi.count === initialDisplayElements.length &&
        displayElementUi.selectedCount === 1 &&
        displayElementUi.fillsWidth,
      "Display-element timeline is not a selected-line 100% partition.",
      displayElementUi
    );
    const displayElementZoomOpened = await evaluate(
      cdp,
      `(() => {
        const button = document.querySelector('.segment-inspector-section[data-section="display-elements"] button[aria-label="表示素をズーム編集"]');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`
    );
    assertPass(displayElementZoomOpened, "Display-element zoom editor could not be opened.");
    const displayElementZoomUi = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="表示素ズーム編集"]');
        const sideTimeline = document.querySelector('.segment-inspector-section[data-section="display-elements"] .display-element-timeline');
        const zoomTimeline = dialog?.querySelector('.display-element-timeline');
        const waveform = dialog?.querySelector('.display-element-zoom-waveform[role="slider"]');
        const loop = dialog?.querySelector('input[type="checkbox"]');
        const play = dialog?.querySelector('button[aria-label="範囲を再生"]');
        const scrollRoot = dialog?.querySelector('.display-element-zoom-scroll');
        const scrollViewport = scrollRoot?.querySelector('.display-element-zoom-scroll-viewport');
        const verticalScrollbar = [...(scrollRoot?.children || [])]
          .find((child) => child.classList.contains('scroll-area-scrollbar-vertical'));
        if (!dialog || !sideTimeline || !zoomTimeline || !waveform || !loop || !play || !scrollRoot || !scrollViewport) return false;
        const dialogRect = dialog.getBoundingClientRect();
        const scrollRootRect = scrollRoot.getBoundingClientRect();
        const scrollViewportRect = scrollViewport.getBoundingClientRect();
        const scrollbarRect = verticalScrollbar?.getBoundingClientRect();
        const zoomTimelineRect = zoomTimeline.getBoundingClientRect();
        const zoomBlocks = [...zoomTimeline.querySelectorAll('.display-element-block')];
        const firstZoomBlockRect = zoomBlocks[0]?.getBoundingClientRect();
        const lastZoomBlockRect = zoomBlocks.at(-1)?.getBoundingClientRect();
        return {
          viewportWidth: innerWidth,
          dialogWidth: dialogRect.width,
          sideTimelineWidth: sideTimeline.getBoundingClientRect().width,
          zoomTimelineWidth: zoomTimeline.getBoundingClientRect().width,
          waveformWidth: waveform.getBoundingClientRect().width,
          loopLabel: loop.closest("label")?.textContent?.trim(),
          rangeDuration: Number(waveform.getAttribute("aria-valuemax")),
          firstElementOffset: firstZoomBlockRect ? firstZoomBlockRect.left - zoomTimelineRect.left : null,
          lastElementOffset: lastZoomBlockRect ? zoomTimelineRect.right - lastZoomBlockRect.right : null,
          initialFocusIsContent: document.activeElement === dialog.querySelector('.display-element-zoom-content'),
          hasLeftAdd: !!dialog.querySelector('button[aria-label="左に新規"]'),
          hasDelete: !!dialog.querySelector('button[aria-label="表示素を削除"]'),
          noLeftScrollbarGutter: Math.abs(scrollViewportRect.left - scrollRootRect.left) <= 1,
          scrollbarOnRight: !scrollbarRect || scrollbarRect.width === 0 || Math.abs(scrollbarRect.right - scrollRootRect.right) <= 1,
        };
      })()`,
      10_000,
      "display-element zoom editor"
    );
    assertPass(
      displayElementZoomUi.zoomTimelineWidth > displayElementZoomUi.sideTimelineWidth * 1.5 &&
        displayElementZoomUi.waveformWidth > displayElementZoomUi.sideTimelineWidth * 1.5 &&
        displayElementZoomUi.dialogWidth >= displayElementZoomUi.viewportWidth * 0.78 &&
        displayElementZoomUi.dialogWidth <= displayElementZoomUi.viewportWidth * 0.82 &&
        Math.abs(displayElementZoomUi.rangeDuration - zoomRangeDuration) <= 0.001 &&
        Math.abs(displayElementZoomUi.firstElementOffset - (displayElementZoomUi.zoomTimelineWidth * ((segmentStyleTarget.start - zoomRangeStart) / zoomRangeDuration))) <= 3 &&
        Math.abs(displayElementZoomUi.lastElementOffset - (displayElementZoomUi.zoomTimelineWidth * ((zoomRangeEnd - segmentStyleTarget.end) / zoomRangeDuration))) <= 3 &&
        displayElementZoomUi.initialFocusIsContent &&
        displayElementZoomUi.hasLeftAdd &&
        displayElementZoomUi.hasDelete &&
        displayElementZoomUi.noLeftScrollbarGutter &&
        displayElementZoomUi.scrollbarOnRight &&
        displayElementZoomUi.loopLabel === "ループ再生",
      "Display-element zoom editor did not expose the wide shared editor contract.",
      displayElementZoomUi
    );
    await pressSpace(cdp);
    await waitFor(
      cdp,
      `!!document.querySelector('[role="dialog"][aria-label="表示素ズーム編集"] button[aria-label="範囲を一時停止"]')`,
      10_000,
      "zoom editor Space playback"
    );
    await pressSpace(cdp);
    await waitFor(
      cdp,
      `!!document.querySelector('[role="dialog"][aria-label="表示素ズーム編集"] button[aria-label="範囲を再生"]')`,
      10_000,
      "zoom editor Space pause"
    );
    assertPass(
      await evaluate(
        cdp,
        `(() => {
          const dialog = document.querySelector('[role="dialog"][aria-label="表示素ズーム編集"]');
          const close = dialog?.querySelector('.dialog-header button');
          close?.focus();
          return document.activeElement === close;
        })()`
      ),
      "Zoom editor Close button could not receive explicit focus."
    );
    await pressSpace(cdp);
    await waitFor(
      cdp,
      `!document.querySelector('[role="dialog"][aria-label="表示素ズーム編集"]')`,
      10_000,
      "display-element zoom editor close"
    );
    log("SUB_DISPLAY_ELEMENT_ZOOM_OK", displayElementZoomUi);
    const editableDisplayElementIndex = initialDisplayElements.findIndex((element) => element.text.length > 0);
    assertPass(editableDisplayElementIndex >= 0, "No text display element was available for inline editing.");
    const editableDisplayElement = initialDisplayElements[editableDisplayElementIndex];
    const editedDisplayElementText = `${editableDisplayElement.text} E2E`;
    assertPass(
      await evaluate(
        cdp,
        `(() => {
          const items = [...document.querySelectorAll('.segment-inspector-section[data-section="display-elements"] .display-element-list-item')];
          const item = items[${editableDisplayElementIndex}];
          if (!item) return false;
          item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
          return true;
        })()`
      ),
      "Display-element text editor could not be opened."
    );
    await waitFor(
      cdp,
      `!!document.querySelector('.segment-inspector-section[data-section="display-elements"] .display-element-list-text-input')`,
      10_000,
      "display-element inline text input"
    );
    assertPass(
      await evaluate(
        cdp,
        `(() => {
          const input = document.querySelector('.segment-inspector-section[data-section="display-elements"] .display-element-list-text-input');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(input, ${JSON.stringify(editedDisplayElementText)});
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.blur();
          return true;
        })()`
      ),
      "Display-element text could not be edited."
    );
    const textEditedDisplayProject = await waitForJson(
      subProjectPath,
      (value) => {
        const target = value.subtitle?.lanes?.[0]?.segments?.find((segment) => segment.id === segmentStyleTarget.id);
        return target?.display_elements?.find((element) => element.stable_id === editableDisplayElement.stable_id)?.text
          === editedDisplayElementText;
      },
      30_000,
      "display-element inline text persistence"
    );
    await evaluate(
      cdp,
      `(() => {
        window.__displayElementOriginalConfirm = window.confirm;
        window.__displayElementDeleteConfirmCalls = 0;
        window.confirm = () => {
          window.__displayElementDeleteConfirmCalls += 1;
          return false;
        };
      })()`
    );
    assertPass(
      await evaluate(
        cdp,
        `(() => {
          const button = document.querySelector('.segment-inspector-section[data-section="display-elements"] button[aria-label="表示素を削除"]');
          if (!button || button.disabled) return false;
          button.click();
          return true;
        })()`
      ),
      "Text display-element delete could not be invoked."
    );
    await sleep(500);
    const cancelledTextDelete = await evaluate(
      cdp,
      `({
        confirmCalls: window.__displayElementDeleteConfirmCalls,
        count: document.querySelectorAll('.segment-inspector-section[data-section="display-elements"] .display-element-list-item').length
      })`
    );
    assertPass(
      cancelledTextDelete.confirmCalls === 1 && cancelledTextDelete.count === initialDisplayElements.length,
      "Text display-element deletion did not honor the confirmation cancellation.",
      cancelledTextDelete
    );
    assertPass(
      await evaluate(
        cdp,
        `(() => {
          const first = document.querySelector('.segment-inspector-section[data-section="display-elements"] .display-element-list-item');
          first?.click();
          return !!first;
        })()`
      ),
      "First display element could not be reselected for merge."
    );
    const mergeClicked = await evaluate(
      cdp,
      `(() => {
        const button = document.querySelector('.segment-inspector-section[data-section="display-elements"] button[aria-label="右とマージ"]');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`
    );
    assertPass(mergeClicked, "Display-element merge-right could not be invoked.");
    const mergedDisplayProject = await waitForJson(
      subProjectPath,
      (value) => {
        const target = value.subtitle?.lanes?.[0]?.segments?.find((segment) => segment.id === segmentStyleTarget.id);
        return target?.display_elements?.length === initialDisplayElements.length - 1 &&
          target.display_elements[0]?.stable_id === initialDisplayElements[0].stable_id &&
          target.display_elements[0]?.manual_structure === true;
      },
      30_000,
      "display-element merge-right persistence"
    );
    const blankClicked = await evaluate(
      cdp,
      `(() => {
        const button = document.querySelector('.segment-inspector-section[data-section="display-elements"] button[aria-label="右に新規"]');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`
    );
    assertPass(blankClicked, "Display-element blank-right could not be invoked after merge.");
    const blankDisplayProject = await waitForJson(
      subProjectPath,
      (value) => {
        const target = value.subtitle?.lanes?.[0]?.segments?.find((segment) => segment.id === segmentStyleTarget.id);
        return target?.display_elements?.length === initialDisplayElements.length &&
          target.display_elements.some((element) =>
            element.text === "" && element.source === "manual" && element.manual_structure === true &&
            Math.abs((element.end - element.start) - 0.1) <= 0.000001
          );
      },
      30_000,
      "display-element blank-right persistence"
    );
    const addedRightBlank = blankDisplayProject.subtitle.lanes[0].segments[0].display_elements.find((element) =>
      element.text === "" && element.source === "manual" && element.manual_structure === true &&
      Math.abs((element.end - element.start) - 0.1) <= 0.000001
    );
    assertPass(addedRightBlank, "The newly-added right blank could not be identified.");
    assertPass(
      await evaluate(
        cdp,
        `(() => {
          const button = document.querySelector('.segment-inspector-section[data-section="display-elements"] button[aria-label="表示素を削除"]');
          if (!button || button.disabled) return false;
          button.click();
          return true;
        })()`
      ),
      "Blank display-element delete could not be invoked."
    );
    const blankDeletedProject = await waitForJson(
      subProjectPath,
      (value) => {
        const target = value.subtitle?.lanes?.[0]?.segments?.find((segment) => segment.id === segmentStyleTarget.id);
        return target?.display_elements?.length === initialDisplayElements.length - 1 &&
          !target.display_elements.some((element) => element.stable_id === addedRightBlank.stable_id);
      },
      30_000,
      "blank display-element deletion"
    );
    assertPass(
      (await evaluate(cdp, `window.__displayElementDeleteConfirmCalls`)) === 1,
      "Blank display-element deletion unexpectedly opened a confirmation."
    );
    const leftBlankClicked = await evaluate(
      cdp,
      `(() => {
        const button = document.querySelector('.segment-inspector-section[data-section="display-elements"] button[aria-label="左に新規"]');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`
    );
    assertPass(leftBlankClicked, "Display-element blank-left could not be invoked after deletion.");
    const leftBlankProject = await waitForJson(
      subProjectPath,
      (value) => {
        const target = value.subtitle?.lanes?.[0]?.segments?.find((segment) => segment.id === segmentStyleTarget.id);
        return target?.display_elements?.length === initialDisplayElements.length &&
          target.display_elements.some((element) =>
            element.text === "" && element.source === "manual" && element.manual_structure === true &&
            Math.abs((element.end - element.start) - 0.1) <= 0.000001
          );
      },
      30_000,
      "display-element blank-left persistence"
    );
    await evaluate(
      cdp,
      `(() => {
        if (window.__displayElementOriginalConfirm) window.confirm = window.__displayElementOriginalConfirm;
        delete window.__displayElementOriginalConfirm;
      })()`
    );
    log("SUB_DISPLAY_ELEMENTS_OK", {
      segmentId: segmentStyleTarget.id,
      before: initialDisplayElements.length,
      editedText: textEditedDisplayProject.subtitle.lanes[0].segments[0].display_elements[editableDisplayElementIndex].text,
      afterMerge: mergedDisplayProject.subtitle.lanes[0].segments[0].display_elements.length,
      afterBlank: blankDisplayProject.subtitle.lanes[0].segments[0].display_elements.length,
      afterBlankDelete: blankDeletedProject.subtitle.lanes[0].segments[0].display_elements.length,
      afterLeftBlank: leftBlankProject.subtitle.lanes[0].segments[0].display_elements.length,
    });
    const segmentStyleOpened = await evaluate(
      cdp,
      `(() => {
        const section = document.querySelector('.segment-inspector-section[data-section="style"]');
        const header = section?.querySelector('.segment-inspector-header');
        if (!header) return false;
        if (header.getAttribute('aria-expanded') !== 'true') header.click();
        return true;
      })()`
    );
    assertPass(segmentStyleOpened, "Custom Sub segment Style accordion could not be opened.");
    await waitFor(
      cdp,
      `document.querySelector('.segment-inspector-section[data-section="style"] input[name^="segment-style-mode-"]') !== null`,
      10_000,
      "Sub segment Style controls"
    );
    const segmentStyleScroll = await evaluate(
      cdp,
      `(() => {
        const root = document.querySelector(".segment-inspector-scroll.scroll-area");
        const viewport = root?.querySelector(".scroll-area-viewport");
        const scrollbar = root?.querySelector(".scroll-area-scrollbar-vertical");
        return root && viewport && scrollbar
          ? { viewportClass: viewport.className, scrollbarClass: scrollbar.className }
          : null;
      })()`
    );
    assertPass(
      segmentStyleScroll?.viewportClass.includes("segment-inspector-scroll-viewport") &&
        segmentStyleScroll?.scrollbarClass.includes("scroll-area-scrollbar-vertical"),
      "Sub segment inspector does not use the shared shadcn ScrollArea.",
      segmentStyleScroll
    );
    assertPass(
      await evaluate(
        cdp,
        `document.querySelector('.segment-inspector-section[data-section="style"] .segment-style-editor-frame') === null`
      ),
      "Inherited Sub segment Style exposed custom font and effect controls."
    );
    const customModeSelected = await evaluate(
      cdp,
      `(() => {
        const section = document.querySelector('.segment-inspector-section[data-section="style"]');
        const radios = section?.querySelectorAll('input[name^="segment-style-mode-"]');
        radios?.[1]?.click();
        return !!radios?.[1];
      })()`
    );
    assertPass(customModeSelected, "Custom Sub segment mode could not be selected.");
    await waitFor(
      cdp,
      `document.querySelector('.segment-inspector-section[data-section="style"] .segment-style-editor-frame') !== null`,
      10_000,
      "enabled custom Sub segment Style editor"
    );
    const segmentStyleConfigured = await evaluate(
      cdp,
      `(() => {
        const section = document.querySelector('.segment-inspector-section[data-section="style"]');
        const sizeLabel = [...(section?.querySelectorAll(".subtitle-style-fields label") || [])]
          .find((item) => item.textContent.trim().startsWith("サイズ"));
        const sizeInput = sizeLabel?.querySelector("input");
        const effectTrigger = section?.querySelector(".subtitle-effect-section .radix-select-trigger");
        if (!sizeInput || !effectTrigger) return false;
        const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        inputSetter.call(sizeInput, "52");
        sizeInput.dispatchEvent(new Event("input", { bubbles: true }));
        sizeInput.dispatchEvent(new Event("change", { bubbles: true }));
        effectTrigger.click();
        return true;
      })()`
    );
    assertPass(segmentStyleConfigured, "Custom Sub segment Style controls could not be configured.");
    const segmentEffectCatalogUi = await waitFor(
      cdp,
      `(() => {
        const content = document.querySelector('.radix-select-content[data-state="open"]');
        const items = content ? [...content.querySelectorAll("[data-effect-id]")] : [];
        const groups = content ? content.querySelectorAll('[role="group"]') : [];
        return content && items.length === 97 && groups.length > 1
          ? { optionCount: items.length, groupCount: groups.length }
          : false;
      })()`,
      10_000,
      "segment effect Radix portal options"
    );
    assertPass(
      segmentEffectCatalogUi.optionCount === 97 && segmentEffectCatalogUi.groupCount > 1,
      "Custom Sub segment effect catalog options are incomplete.",
      segmentEffectCatalogUi
    );
    const segmentEffectConfigured = await evaluate(
      cdp,
      `(() => {
        const content = document.querySelector('.radix-select-content[data-state="open"]');
        const item = content?.querySelector('[data-effect-id="glow"]');
        if (!item) return false;
        item.scrollIntoView({ block: "nearest" });
        item.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
          pointerType: "mouse",
        }));
        item.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
          pointerType: "mouse",
        }));
        return true;
      })()`
    );
    assertPass(segmentEffectConfigured, "Custom Sub segment glow effect could not be selected.");
    const segmentStyleUpdatedProject = await waitForJson(
      subProjectPath,
      (value) => {
        const lane = value.subtitle?.lanes?.[0];
        const target = lane?.segments?.find((segment) => segment.id === segmentStyleTarget.id);
        const inherited = lane?.segments?.filter((segment) => segment.id !== segmentStyleTarget.id) || [];
        return target?.style_override?.font_size === 52 &&
          target?.effect_override?.name === "glow" &&
          target.render_cache?.signature !== segmentStyleTarget.render_cache?.signature &&
          inherited.every((segment, index) =>
            segment.render_cache?.signature === effectUpdatedProject.subtitle.lanes[0].segments[index + 1]?.render_cache?.signature
          );
      },
      5 * 60_000,
      "custom Sub segment Style persistence and targeted cache invalidation"
    );
    const renderRequestCountAfterSegmentStyle = await evaluate(cdp, `window.__subtitleRenderRequests`);
    assertPass(
      renderRequestCountAfterSegmentStyle > renderRequestCountAfterEffect,
      "Custom segment Style did not request a refreshed preview frame.",
      { renderRequestCountAfterEffect, renderRequestCountAfterSegmentStyle }
    );
    const customStyleMarker = await waitFor(
      cdp,
      `(() => {
        const label = [...document.querySelectorAll(".lyrics-label")].find(
          (item) => item.textContent.trim() === ${JSON.stringify(segmentStyleTarget.text)}
        );
        const connector = label?.querySelector(".lyrics-connector");
        return label?.classList.contains("custom-style") && connector
          ? { customStyle: true, connectorWidth: getComputedStyle(connector).width }
          : false;
      })()`,
      10_000,
      "custom segment zigzag marker"
    );
    assertPass(customStyleMarker.connectorWidth === "6px", "Custom segment marker is not the zigzag variant.", customStyleMarker);
    log("SUB_SEGMENT_STYLE_OK", {
      segmentId: segmentStyleTarget.id,
      style: segmentStyleUpdatedProject.subtitle.lanes[0].segments[0].style_override,
      effect: segmentStyleUpdatedProject.subtitle.lanes[0].segments[0].effect_override,
    });

    const editorMetrics = await evaluate(
      cdp,
      `(() => {
        const label = document.querySelector(".lyrics-label");
        if (!label) return null;
        label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        return true;
      })()`
    );
    assertPass(editorMetrics, "Lyrics in-place editor could not be opened.");
    const inPlaceEditor = await waitFor(
      cdp,
      `(() => {
        const wrapper = document.querySelector(".lyrics-label.editing");
        const input = wrapper?.querySelector("input");
        if (!wrapper || !input) return false;
        const rect = input.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const background = getComputedStyle(input).backgroundColor;
        return {
          topIsInput: top === input || input.contains(top),
          zIndex: Number(getComputedStyle(wrapper).zIndex),
          background
        };
      })()`,
      10_000,
      "lyrics in-place editor"
    );
    assertPass(
      inPlaceEditor.topIsInput &&
        inPlaceEditor.zIndex >= 30 &&
        !inPlaceEditor.background.endsWith(", 0)"),
      "Lyrics in-place editor is transparent or behind another label.",
      inPlaceEditor
    );
    await evaluate(
      cdp,
      `document.querySelector(".lyrics-label.editing input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`
    );

    const firstLyrics = project.subtitle.lanes
      .flatMap((lane) => lane.segments)
      .find((segment) => segment.source === "lyrics");
    assertPass(firstLyrics, "No lyrics segment was saved.");
    await evaluate(
      cdp,
      `(() => {
        const video = document.querySelector("video");
        video.currentTime = ${firstLyrics.start + 0.05};
        video.dispatchEvent(new Event("seeked"));
        video.dispatchEvent(new Event("timeupdate"));
        return true;
      })()`
    );
    const expectedOverlaySegment = segmentStyleUpdatedProject.subtitle.lanes
      .flatMap((lane) => lane.segments)
      .find((segment) => segment.id === firstLyrics.id);
    assertPass(
      expectedOverlaySegment?.render_cache?.png_base64,
      "The active lyrics segment has no persisted PNG cache.",
      expectedOverlaySegment
    );
    const overlayImage = await waitFor(
      cdp,
      `(() => {
        const image = document.querySelector(".subtitle-overlay-image");
        return image?.complete && image.naturalWidth > 0
          ? {
              srcPrefix: image.src.slice(0, 30),
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight
            }
          : false;
      })()`,
      10_000,
      "ASS subtitle PNG overlay"
    );
    const overlayMatchesCache = await evaluate(
      cdp,
      `document.querySelector(".subtitle-overlay-image")?.src === ${JSON.stringify(
        `data:image/png;base64,${expectedOverlaySegment.render_cache.png_base64}`
      )}`
    );
    const overlayMetrics = await evaluate(
      cdp,
      `(() => {
        const overlay = document.querySelector(".subtitle-overlay");
        const image = document.querySelector(".subtitle-overlay-image");
        const video = document.querySelector("video");
        const pane = document.querySelector(".video-pane");
        if (!overlay || !image || !video || !pane) return null;
        const overlayRect = overlay.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        const paneRect = pane.getBoundingClientRect();
        return {
          overlay: { left: overlayRect.left, top: overlayRect.top, right: overlayRect.right, bottom: overlayRect.bottom, width: overlayRect.width, height: overlayRect.height },
          image: { left: imageRect.left, top: imageRect.top, right: imageRect.right, bottom: imageRect.bottom, width: imageRect.width, height: imageRect.height },
          pane: { left: paneRect.left, top: paneRect.top, right: paneRect.right, bottom: paneRect.bottom },
          source: { width: video.videoWidth, height: video.videoHeight },
          natural: { width: image.naturalWidth, height: image.naturalHeight },
          imageMatchesOverlay:
            Math.abs(imageRect.left - overlayRect.left) <= 1 &&
            Math.abs(imageRect.right - overlayRect.right) <= 1 &&
            Math.abs(imageRect.top - overlayRect.top) <= 1 &&
            Math.abs(imageRect.bottom - overlayRect.bottom) <= 1
        };
      })()`
    );
    assertPass(
      overlayMatchesCache &&
        overlayImage.srcPrefix.startsWith("data:image/png;base64,") &&
        overlayMetrics.imageMatchesOverlay &&
        overlayMetrics.natural.width === overlayMetrics.source.width &&
        overlayMetrics.natural.height === overlayMetrics.source.height &&
        overlayMetrics.overlay.left >= overlayMetrics.pane.left &&
        overlayMetrics.overlay.right <= overlayMetrics.pane.right + 1 &&
        overlayMetrics.overlay.top >= overlayMetrics.pane.top &&
        overlayMetrics.overlay.bottom <= overlayMetrics.pane.bottom + 1,
      "The cached ASS PNG does not match, scale with, or remain inside the displayed video.",
      { overlayImage, overlayMatchesCache, overlayMetrics }
    );
    log("SUB_OVERLAY_PNG_OK", overlayMetrics);

    const videoPreview = await waitFor(
      cdp,
      `(() => {
        const layer = document.querySelector(".sub-video-preview-layer");
        const controls = layer?.querySelector(".sub-video-preview-controls");
        const inputs = [...(controls?.querySelectorAll('input[type="checkbox"]') || [])];
        const cursor = layer?.querySelector(".display-element-preview-cursor");
        const track = layer?.querySelector(".display-element-preview-track");
        const overlay = layer?.querySelector(".sub-video-preview-overlay-region");
        const controlsRegion = layer?.querySelector(".sub-video-preview-controls-region");
        const cards = [...(layer?.querySelectorAll(".display-element-preview-card") || [])];
        const pane = document.querySelector(".video-pane");
        const video = pane?.querySelector("video");
        if (!layer || !controls || inputs.length !== 2 || !cursor || !track || !overlay || !controlsRegion || !cards.length || !pane || !video || !video.videoWidth || !video.videoHeight) return false;
        const layerRect = layer.getBoundingClientRect();
        const cursorRect = cursor.getBoundingClientRect();
        const paneRect = pane.getBoundingClientRect();
        const videoRect = video.getBoundingClientRect();
        const controlsRect = controls.getBoundingClientRect();
        const controlsRegionRect = controlsRegion.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        const scale = Math.min(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
        const renderedVideoLeft = videoRect.left + (videoRect.width - video.videoWidth * scale) / 2;
        const trackStyle = getComputedStyle(track);
        return {
          labels: [...controls.querySelectorAll("label")].map((label) => label.textContent.trim()),
          checked: inputs.map((input) => input.checked),
          tabIndexes: inputs.map((input) => input.tabIndex),
          cardCount: cards.length,
          hasActive: cards.some((card) => card.classList.contains("active") && card.classList.contains("selected")),
          hasSelectedSegment: cards.some((card) => card.classList.contains("selected-segment")),
          layerInsidePane:
            layerRect.left >= paneRect.left && layerRect.right <= paneRect.right + 1 &&
            layerRect.top >= paneRect.top && layerRect.bottom <= paneRect.bottom + 1,
          controlsOutsideRenderedVideo:
            controlsRect.right <= renderedVideoLeft + 1 && controlsRegionRect.right <= renderedVideoLeft + 1,
          controlsLeftAligned:
            Math.abs(controlsRegionRect.left - paneRect.left) <= 1 &&
            Math.abs(controlsRect.left - paneRect.left - 12) <= 2,
          overlayUsesFullPane:
            Math.abs(overlayRect.left - paneRect.left) <= 1 && Math.abs(overlayRect.right - paneRect.right) <= 1,
          cursorCentered: Math.abs((cursorRect.left + cursorRect.width / 2) - (layerRect.left + layerRect.width / 2)) <= 1,
          compositorTrack: trackStyle.willChange.includes("transform") && trackStyle.transform !== "none"
        };
      })()`,
      10_000,
      "Sub video display-element preview"
    );
    assertPass(
      JSON.stringify(videoPreview.labels) === JSON.stringify(["字幕", "表示素"]) &&
        videoPreview.checked.every(Boolean) &&
        videoPreview.tabIndexes.every((value) => value === -1) &&
        videoPreview.cardCount > 0 &&
        videoPreview.hasActive &&
        videoPreview.hasSelectedSegment &&
        videoPreview.layerInsidePane &&
        videoPreview.controlsOutsideRenderedVideo &&
        videoPreview.controlsLeftAligned &&
        videoPreview.overlayUsesFullPane &&
        videoPreview.cursorCentered &&
        videoPreview.compositorTrack,
      "Sub video preview controls or display-element geometry are invalid.",
      videoPreview
    );

    await evaluate(
      cdp,
      `document.querySelectorAll('.sub-video-preview-controls input[type="checkbox"]')[0]?.click()`
    );
    const subtitlePreviewOff = await waitFor(
      cdp,
      `(() => {
        const result = {
          subtitleHidden: !document.querySelector(".subtitle-overlay"),
          elementsRemain: !!document.querySelector(".display-element-preview-overlay"),
          stored: localStorage.getItem("songcut:sub:subtitle-preview-visible")
        };
        return result.subtitleHidden && result.elementsRemain && result.stored === "false" ? result : false;
      })()`,
      10_000,
      "independent subtitle preview disable"
    );
    assertPass(
      subtitlePreviewOff.subtitleHidden && subtitlePreviewOff.elementsRemain && subtitlePreviewOff.stored === "false",
      "Subtitle preview toggle also hid display elements or was not persisted.",
      subtitlePreviewOff
    );
    await evaluate(
      cdp,
      `document.querySelectorAll('.sub-video-preview-controls input[type="checkbox"]')[0]?.click()`
    );
    await waitFor(
      cdp,
      `document.querySelector(".subtitle-overlay") && localStorage.getItem("songcut:sub:subtitle-preview-visible") === "true"`,
      10_000,
      "subtitle preview restore"
    );

    await evaluate(
      cdp,
      `document.querySelectorAll('.sub-video-preview-controls input[type="checkbox"]')[1]?.click()`
    );
    const displayElementPreviewOff = await waitFor(
      cdp,
      `(() => {
        const result = {
          elementsHidden: !document.querySelector(".display-element-preview-overlay"),
          subtitleRemains: !!document.querySelector(".subtitle-overlay"),
          stored: localStorage.getItem("songcut:sub:display-element-preview-visible")
        };
        return result.elementsHidden && result.subtitleRemains && result.stored === "false" ? result : false;
      })()`,
      10_000,
      "independent display-element preview disable"
    );
    assertPass(
      displayElementPreviewOff.elementsHidden && displayElementPreviewOff.subtitleRemains && displayElementPreviewOff.stored === "false",
      "Display-element preview toggle also hid subtitles or was not persisted.",
      displayElementPreviewOff
    );
    await evaluate(
      cdp,
      `document.querySelectorAll('.sub-video-preview-controls input[type="checkbox"]')[1]?.click()`
    );
    await waitFor(
      cdp,
      `document.querySelector(".display-element-preview-overlay") && localStorage.getItem("songcut:sub:display-element-preview-visible") === "true"`,
      10_000,
      "display-element preview restore"
    );
    log("SUB_VIDEO_DISPLAY_ELEMENTS_OK", videoPreview);
    await captureOptionalScreenshot(cdp, displayPreviewScreenshotPath, "Sub video display-element preview");

    const waveformPoint = await evaluate(
      cdp,
      `(() => {
        const waveform = document.querySelector(".sub-waveform");
        if (!waveform) return null;
        const rect = waveform.getBoundingClientRect();
        return { x: rect.left + rect.width * 0.42, y: rect.top + rect.height / 2 };
      })()`
    );
    assertPass(waveformPoint, "Sub waveform was not available for scratch playback.");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: waveformPoint.x,
      y: waveformPoint.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await sleep(30);
    const scratchState = await evaluate(
      cdp,
      `(() => ({
        active: !!document.querySelector('[data-scratch-preview-active="true"]'),
        currentTime: document.querySelector("video")?.currentTime
      }))()`
    );
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: waveformPoint.x,
      y: waveformPoint.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    assertPass(
      scratchState.active && Number.isFinite(scratchState.currentTime),
      "Sub waveform scratch playback did not start.",
      scratchState
    );
    log("SUB_SCRATCH_PLAYBACK_OK", scratchState);

    const boundarySeconds = await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".sub-toolbar .boundary-seconds-input");
        if (!input) return null;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "3");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
        return input.value;
      })()`
    );
    assertPass(boundarySeconds === "3", "Sub boundary playback seconds input is missing or unusable.", boundarySeconds);
    const endPlayback = await evaluate(
      cdp,
      `(() => {
        const label = [...document.querySelectorAll(".lyrics-label")].find((item) => item.textContent.trim() === ${JSON.stringify(firstLyrics.text)});
        label?.click();
        const button = document.querySelector('.sub-toolbar .boundary-controls button[aria-keyshortcuts="D"]');
        button?.click();
        return {
          clicked: !!label && !!button,
          currentTime: document.querySelector("video")?.currentTime
        };
      })()`
    );
    const expectedEndPlaybackStart = Math.max(firstLyrics.start, firstLyrics.end - 3);
    assertPass(
      endPlayback.clicked &&
        Math.abs(endPlayback.currentTime - expectedEndPlaybackStart) <= 0.25 &&
        endPlayback.currentTime > firstLyrics.start + 0.05,
      "End-boundary playback started from the segment beginning.",
      { endPlayback, expectedEndPlaybackStart, firstLyrics }
    );
    await evaluate(
      cdp,
      `document.querySelector("video")?.pause()`
    );
    log("SUB_END_BOUNDARY_PLAYBACK_OK", endPlayback);

    assertPass(await clickButton(cdp, "タイムライン"), "Add timeline button could not be clicked.");
    await waitFor(
      cdp,
      `!!document.querySelector('[role="dialog"][aria-label="字幕位置を選択"]')`,
      10_000,
      "subtitle position dialog"
    );
    const alignmentNine = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕位置を選択"]');
        const button = [...(dialog?.querySelectorAll(".alignment-grid button") || [])]
          .find((item) => item.innerText.trim() === "9");
        if (!button) return false;
        button.click();
        return true;
      })()`
    );
    assertPass(alignmentNine, "Alignment 9 button could not be clicked.");
    await waitFor(cdp, `document.querySelectorAll(".lyrics-lane").length === 3`, 10_000, "third lyrics lane");
    log("SUB_ALIGNMENT_GRID_OK");

    const exportClicked = await clickButton(cdp, "書き出し");
    assertPass(exportClicked, "Subtitle export button could not be clicked.");
    const exportProgress = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕を書き出し"]');
        const progress = dialog?.querySelector("progress");
        return dialog && progress && progress.value > 0.15 && progress.value < 1
          ? { value: progress.value, message: dialog.textContent, portalParentIsBody: dialog.parentElement?.parentElement === document.body }
          : false;
      })()`,
      120_000,
      "live ffmpeg subtitle export progress"
    );
    assertPass(exportProgress.portalParentIsBody, "Subtitle export progress dialog is not portaled.", exportProgress);
    await captureOptionalScreenshot(cdp, exportProgressScreenshotPath, "subtitle export progress");
    log("SUB_EXPORT_PROGRESS_OK", exportProgress);
    const outputVideo = path.join(outputDir, `${fixtureStem}-subtitled.mp4`);
    await waitFor(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll("button")].find((item) => item.innerText.trim() === "書き出し");
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕を書き出し"]');
        const progress = dialog?.querySelector("progress");
        return button && !button.disabled && progress?.value === 1;
      })()`,
      30 * 60_000,
      "full subtitle video export"
    );
    assertPass(fs.existsSync(outputVideo) && fs.statSync(outputVideo).size > 0, "Burned subtitle video is missing.", outputVideo);
    const srtFiles = fs.readdirSync(outputDir).filter((name) => name.endsWith(".srt"));
    const styleFiles = fs.readdirSync(outputDir).filter((name) => name.endsWith(".srt.style"));
    assertPass(srtFiles.length === 2 && styleFiles.length === 2, "Lane SRT/style files are incomplete.", { srtFiles, styleFiles });
    const assFile = path.join(outputDir, `${fixtureStem}-subtitles.ass`);
    const assText = fs.existsSync(assFile) ? fs.readFileSync(assFile, "utf8") : "";
    assertPass(
      assText.includes("Style: Lane1Override") && assText.includes(",52,") && assText.includes("\\fad(750,750)"),
      "Full-fidelity ASS sidecar is missing the custom segment style or v3 effect.",
      { assFile, exists: fs.existsSync(assFile) }
    );
    const sourceDuration = Number(execFileSync(path.join(repo, "third_party", "ffmpeg", "bin", "ffprobe.exe"), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input], { encoding: "utf8" }).trim());
    const outputDuration = Number(execFileSync(path.join(repo, "third_party", "ffmpeg", "bin", "ffprobe.exe"), ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", outputVideo], { encoding: "utf8" }).trim());
    const sourceAudioCodec = execFileSync(path.join(repo, "third_party", "ffmpeg", "bin", "ffprobe.exe"), ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", input], { encoding: "utf8" }).trim();
    const outputAudioCodec = execFileSync(path.join(repo, "third_party", "ffmpeg", "bin", "ffprobe.exe"), ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", outputVideo], { encoding: "utf8" }).trim();
    assertPass(Math.abs(sourceDuration - outputDuration) < 0.5, "Burned video duration differs from source.", { sourceDuration, outputDuration });
    assertPass(sourceAudioCodec === outputAudioCodec, "Subtitle export re-encoded the audio stream.", { sourceAudioCodec, outputAudioCodec });
    const exportDialogClosed = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕を書き出し"]');
        if (!dialog) return true;
        const button = dialog.querySelector('.dialog-actions button') || dialog.querySelector('.dialog-header button');
        button?.click();
        return !!button;
      })()`
    );
    assertPass(exportDialogClosed, "Completed subtitle export progress dialog could not be closed.");
    await waitFor(
      cdp,
      `!document.querySelector('[role="dialog"][aria-label="字幕を書き出し"]')`,
      10_000,
      "completed subtitle export dialog close"
    );
    log("SUB_EXPORT_OK", { outputVideo, assFile, srtFiles, styleFiles, outputDuration, sourceAudioCodec, outputAudioCodec });

    const finalScreenshotPath = await captureOptionalScreenshot(cdp, screenshotPath, "final Sub mode");
    log("SUB_E2E_OK", { screenshotPath: finalScreenshotPath, logPath });
  } finally {
    cleanup(processHandle, cdp);
  }
})().catch((error) => {
  log("SUB_E2E_FAIL", { message: error.message, stack: error.stack });
  process.exitCode = 1;
});
