const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const packageRoot = process.env.SONGCUT_E2E_PACKAGE_ROOT
  ? path.resolve(process.env.SONGCUT_E2E_PACKAGE_ROOT)
  : path.join(repo, "dist", "songcut-win-x64");
const fixtureStem = "02_「星の消えた夜に」 - Aimer";
const fixtureVideo = path.join(repo, "testdata", `${fixtureStem}.webm`);
const fixtureLyrics = path.join(repo, "testdata", `${fixtureStem}.lyrics.txt`);
const runRoot = path.join(repo, "out", "e2e-sub-mode");
const input = path.join(runRoot, `${fixtureStem}.webm`);
const outputDir = path.join(runRoot, "export");
const userDataDir = path.join(runRoot, "user-data");
const logPath = path.join(runRoot, "e2e-sub-mode.log");
const screenshotPath = path.join(runRoot, "e2e-sub-mode.png");
const lyricsDialogScreenshotPath = path.join(runRoot, "e2e-sub-mode-lyrics-dialog.png");
const analysisProgressScreenshotPath = path.join(runRoot, "e2e-sub-mode-analysis-progress.png");
const styleDialogScreenshotPath = path.join(runRoot, "e2e-sub-mode-style-dialog.png");
const exportProgressScreenshotPath = path.join(runRoot, "e2e-sub-mode-export-progress.png");
const port = Number(process.env.SONGCUT_E2E_SUB_PORT || 9240);
const captureScreenshots = process.env.SONGCUT_E2E_SCREENSHOTS === "1";

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
  try {
    const screenshot = await withTimeout(
      cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }),
      15_000,
      `${label} screenshot`
    );
    fs.writeFileSync(filePath, Buffer.from(screenshot.result.data, "base64"));
    assertPass(fs.statSync(filePath).size > 0, `${label} screenshot is empty.`);
    return filePath;
  } catch (error) {
    log("SUB_SCREENSHOT_SKIPPED", { label, message: error.message });
    return null;
  }
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
  throw new Error(`Timeout waiting for ${label}; last=${JSON.stringify(last)}`);
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

(async () => {
  assertPass(fs.existsSync(fixtureVideo), "Fixture video is missing.", fixtureVideo);
  assertPass(fs.existsSync(fixtureLyrics), "Fixture lyrics are missing.", fixtureLyrics);
  assertPass(fs.existsSync(path.join(packageRoot, "songcut.exe")), "Packaged songcut.exe is missing.", packageRoot);
  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.copyFileSync(fixtureVideo, input);
  fs.writeFileSync(path.join(userDataDir, "app-preferences.json"), `${JSON.stringify({ uiLanguage: "ja" }, null, 2)}\n`);
  fs.writeFileSync(logPath, "");
  const lyrics = fs.readFileSync(fixtureLyrics, "utf8");
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
    assertPass(await clickButton(cdp, "読み込む"), "Load button could not be clicked.");
    await waitFor(cdp, `document.querySelector("video")?.src.includes(${JSON.stringify(encodeURIComponent(fixtureStem))})`, 60_000, "fixture video load");
    log("SUB_FIXTURE_LOAD_OK", { input });

    const subTabPoint = await evaluate(
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
      })()`
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
        const groups = document.querySelectorAll(".sub-toolbar > .icon-group");
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
        const groups = document.querySelectorAll(".sub-toolbar > .icon-group");
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
        const groups = document.querySelectorAll(".sub-toolbar > .icon-group");
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
        const groups = document.querySelectorAll(".sub-toolbar > .icon-group");
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
      `document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .subtitle-effect-section select') !== null`,
      10_000,
      "subtitle effect selector"
    );
    const effectCatalogUi = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="字幕スタイル"]');
        const select = dialog?.querySelector(".subtitle-effect-section select");
        const video = dialog?.querySelector(".subtitle-effect-preview");
        return select ? {
          optionCount: select.options.length,
          groupCount: select.querySelectorAll("optgroup").length,
          previewUrl: video?.getAttribute("src") || ""
        } : null;
      })()`
    );
    assertPass(
      effectCatalogUi?.optionCount === 97 &&
        effectCatalogUi.groupCount > 1 &&
        effectCatalogUi.previewUrl.includes("mokusatsu.github.io/ASS_Lyric_Effects/preview/"),
      "ASS_Lyric_Effects v3 catalog or Pages preview is incomplete.",
      effectCatalogUi
    );
    const effectConfigured = await evaluate(
      cdp,
      `(() => {
        const select = document.querySelector('[role="dialog"][aria-label="字幕スタイル"] .subtitle-effect-section select');
        if (!select) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(select, "fad");
        select.dispatchEvent(new Event("change", { bubbles: true }));
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
      `document.querySelector('[role="dialog"][aria-label="字幕スタイル"] input[value="300"]') !== null`,
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
    const segmentStyleOpened = await evaluate(
      cdp,
      `(() => {
        const target = [...document.querySelectorAll(".lyrics-segment")].find(
          (item) => item.title.startsWith(${JSON.stringify(`${segmentStyleTarget.text}\n`)})
        );
        target?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        return !!target;
      })()`
    );
    assertPass(segmentStyleOpened, "Sub segment settings dialog could not be opened.");
    const segmentTabs = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="セグメント設定"]');
        const tabs = [...(dialog?.querySelectorAll('[role="tab"]') || [])];
        return tabs.length === 2
          ? { labels: tabs.map((tab) => tab.textContent.trim()), portalParentIsBody: dialog.parentElement?.parentElement === document.body }
          : false;
      })()`,
      10_000,
      "Sub segment Timing and Style tabs"
    );
    assertPass(
      JSON.stringify(segmentTabs.labels) === JSON.stringify(["Timing", "Style"]) && segmentTabs.portalParentIsBody,
      "Sub segment settings tabs or modal focus scope are incomplete.",
      segmentTabs
    );
    const segmentStyleTabPoint = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="セグメント設定"]');
        const styleTab = [...(dialog?.querySelectorAll('[role="tab"]') || [])].find((tab) => tab.textContent.trim() === "Style");
        if (!styleTab) return null;
        const rect = styleTab.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`
    );
    assertPass(segmentStyleTabPoint, "Custom Sub segment Style tab could not be opened.");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: segmentStyleTabPoint.x, y: segmentStyleTabPoint.y, button: "none" });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: segmentStyleTabPoint.x, y: segmentStyleTabPoint.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: segmentStyleTabPoint.x, y: segmentStyleTabPoint.y, button: "left", clickCount: 1 });
    await waitFor(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="セグメント設定"] input[name="segment-style-mode"]') !== null`,
      10_000,
      "Sub segment Style controls"
    );
    const segmentStyleScroll = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="セグメント設定"]');
        const root = dialog?.querySelector(".segment-style-scroll.scroll-area");
        const viewport = root?.querySelector(".scroll-area-viewport");
        const scrollbar = root?.querySelector(".scroll-area-scrollbar-vertical");
        return root && viewport && scrollbar
          ? { viewportClass: viewport.className, scrollbarClass: scrollbar.className }
          : null;
      })()`
    );
    assertPass(
      segmentStyleScroll?.viewportClass.includes("segment-style-scroll-viewport") &&
        segmentStyleScroll?.scrollbarClass.includes("scroll-area-scrollbar-vertical"),
      "Sub segment Style tab does not use the shared shadcn ScrollArea.",
      segmentStyleScroll
    );
    const customModeSelected = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="セグメント設定"]');
        const radios = dialog?.querySelectorAll('input[name="segment-style-mode"]');
        radios?.[1]?.click();
        return !!radios?.[1];
      })()`
    );
    assertPass(customModeSelected, "Custom Sub segment mode could not be selected.");
    await waitFor(
      cdp,
      `document.querySelector('[role="dialog"][aria-label="セグメント設定"] .segment-style-editor-frame')?.disabled === false`,
      10_000,
      "enabled custom Sub segment Style editor"
    );
    const segmentStyleConfigured = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="セグメント設定"]');
        const sizeLabel = [...(dialog?.querySelectorAll(".subtitle-style-fields label") || [])]
          .find((item) => item.textContent.trim().startsWith("サイズ"));
        const sizeInput = sizeLabel?.querySelector("input");
        const effectSelect = dialog?.querySelector(".subtitle-effect-section select");
        if (!sizeInput || !effectSelect) return false;
        const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        inputSetter.call(sizeInput, "52");
        sizeInput.dispatchEvent(new Event("input", { bubbles: true }));
        sizeInput.dispatchEvent(new Event("change", { bubbles: true }));
        const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        selectSetter.call(effectSelect, "glow");
        effectSelect.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`
    );
    assertPass(segmentStyleConfigured, "Custom Sub segment Style and Effect could not be configured.");
    const segmentStyleApplied = await evaluate(
      cdp,
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="セグメント設定"]');
        const button = dialog?.querySelector('.dialog-actions button[type="submit"]');
        button?.click();
        return !!button;
      })()`
    );
    assertPass(segmentStyleApplied, "Custom Sub segment settings could not be applied.");
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
    const alignmentNine = await evaluate(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll(".alignment-grid button")].find((item) => item.innerText.trim() === "9");
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
        return button && !button.disabled && document.body.innerText.includes("字幕動画を書き出しました");
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
      assText.includes("Style: Lane1Override") && assText.includes(",52,") && assText.includes("\\fad(300,300)"),
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
        const button = [...(dialog?.querySelectorAll("button") || [])].find((item) => item.textContent.trim() === "閉じる");
        button?.click();
        return !!button;
      })()`
    );
    assertPass(exportDialogClosed, "Completed subtitle export progress dialog could not be closed.");
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
