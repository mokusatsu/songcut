const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const root = process.env.SONGCUT_E2E_PACKAGE_ROOT
  ? path.resolve(process.env.SONGCUT_E2E_PACKAGE_ROOT)
  : path.join(repo, "dist", "songcut-win-x64");
const input = path.join(repo, "out", "e2e_input.mp4");
const outputDir = path.join(repo, "out", "e2e-export");
const e2eUserDataDir = path.join(repo, "out", "e2e-user-data");
const initialScreenshotPath = path.join(repo, "out", "e2e-initial-render.png");
const loadedScreenshotPath = path.join(repo, "out", "e2e-loaded-layout.png");
const reviewScreenshotPath = path.join(repo, "out", "e2e-export-review.png");
const screenshotPath = path.join(repo, "out", "e2e-final.png");
const logPath = path.join(repo, "out", "e2e-dist-smoke.log");
const port = Number(process.env.SONGCUT_E2E_DEBUG_PORT || 9230);
const editorSettingStorageKeys = {
  boundaryPreview: "songcut:boundary-preview-seconds",
  boundaryNudge: "songcut:boundary-nudge-seconds",
  videoSplit: "songcut:video-split-percent",
  waveformDisplay: "songcut:waveform-display-mode",
  createSourceFolder: "songcut:create-source-folder"
};

fs.mkdirSync(path.join(repo, "out"), { recursive: true });
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(e2eUserDataDir, { recursive: true, force: true });
fs.mkdirSync(e2eUserDataDir, { recursive: true });
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
  if (!fs.existsSync(input)) {
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
  for (const suffix of [".songcut", ".songcut.tmp", ".songcut.bak"]) {
    fs.rmSync(`${input}${suffix}`, { force: true });
  }
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

async function waitForJsonFile(filePath, predicate, timeoutMs, label) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      last = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (predicate(last)) return last;
    } catch (error) {
      last = String(error);
    }
    await sleep(250);
  }
  throw new Error(`Timeout waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function reloadRenderer(cdp) {
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(750);
  await waitFor(
    cdp,
    `!!window.songcut && document.querySelectorAll(".timeline-scroll-area .scroll-area-viewport").length === 1 && document.body.innerText.includes("Load")`,
    30_000,
    "renderer reload"
  );
}

async function resetEditorSettings(cdp) {
  await evaluate(
    cdp,
    `(() => {
      for (const key of ${JSON.stringify(Object.values(editorSettingStorageKeys))}) localStorage.removeItem(key);
      return true;
    })()`
  );
  await reloadRenderer(cdp);
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
      const buttons = [...document.querySelectorAll("button")].filter((button) => {
        const label = (button.innerText || button.title).trim();
        return label === ${JSON.stringify(text)} || label.startsWith(${JSON.stringify(`${text} (`)});
      });
      const button = buttons[${occurrence}];
      if (!button) return false;
      if (button.disabled) return { disabled: true, label: (button.innerText || button.title).trim() };
      button.click();
      return { disabled: false, label: (button.innerText || button.title).trim() };
    })()`
  );
  if (!ok) throw new Error(`Button not found: ${text}`);
  if (ok.disabled) throw new Error(`Button is disabled: ${ok.label}`);
}

async function prepareWhisperModel(cdp) {
  return evaluate(
    cdp,
    `(async () => {
      const baseUrl = await window.songcut.apiBaseUrl();
      const startResponse = await fetch(baseUrl + "/models/whisper/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      if (!startResponse.ok) {
        return { ok: false, error: await startResponse.text() };
      }
      let job = await startResponse.json();
      for (let index = 0; index < 225; index += 1) {
        const jobResponse = await fetch(baseUrl + "/jobs/" + job.id);
        if (!jobResponse.ok) {
          return { ok: false, error: await jobResponse.text(), job };
        }
        job = await jobResponse.json();
        if (job.status === "completed") return { ok: true, job };
        if (job.status === "failed") return { ok: false, error: job.error || "job failed", job };
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      return { ok: false, error: "Timed out preparing Whisper model.", job };
    })()`
  );
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

async function clickSelector(cdp, selector, occurrence = 0) {
  const ok = await evaluate(
    cdp,
    `(() => {
      const element = document.querySelectorAll(${JSON.stringify(selector)})[${occurrence}];
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

const shortcutKeys = {
  KeyA: "a",
  KeyC: "c",
  KeyD: "d",
  KeyE: "e",
  KeyQ: "q",
  KeyS: "s",
  KeyW: "w",
  KeyX: "x",
  KeyZ: "z",
  Space: " "
};

async function dispatchShortcut(cdp, code, options = {}) {
  const key = shortcutKeys[code];
  if (!key) throw new Error(`Unknown shortcut code: ${code}`);
  const targetSelector = options.targetSelector || "body";
  const dispatched = await evaluate(
    cdp,
    `(() => {
      const target = document.querySelector(${JSON.stringify(targetSelector)});
      if (!target) return null;
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: ${JSON.stringify(code)},
        key: ${JSON.stringify(key)},
        ctrlKey: ${Boolean(options.ctrlKey)},
        shiftKey: ${Boolean(options.shiftKey)},
        altKey: ${Boolean(options.altKey)},
        metaKey: ${Boolean(options.metaKey)},
        repeat: ${Boolean(options.repeat)},
        isComposing: ${Boolean(options.isComposing)}
      });
      ${options.keyCode === undefined ? "" : `Object.defineProperty(event, "keyCode", { value: ${Number(options.keyCode)} });`}
      ${options.defaultPrevented ? "event.preventDefault();" : ""}
      const accepted = target.dispatchEvent(event);
      return { accepted, defaultPrevented: event.defaultPrevented };
    })()`
  );
  if (!dispatched) throw new Error(`Shortcut target not found: ${targetSelector}`);
  await sleep(options.waitMs ?? 180);
  return dispatched;
}

async function dispatchInputKey(cdp, key, code, windowsVirtualKeyCode, options = {}) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers: options.modifiers || 0
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers: options.modifiers || 0
  });
  await sleep(120);
}

async function dispatchMenuCommandForTest(cdp, type) {
  const sent = await evaluate(
    cdp,
    `(() => {
      if (typeof window.songcut?.sendMenuCommandForTest !== "function") return false;
      window.songcut.sendMenuCommandForTest({ type: ${JSON.stringify(type)} });
      return true;
    })()`
  );
  if (!sent) throw new Error(`E2E menu command bridge unavailable for ${type}.`);
  await sleep(120);
}

async function getSegmentMenuStructureForTest(cdp) {
  return evaluate(
    cdp,
    `typeof window.songcut?.getSegmentMenuStructureForTest === "function"
      ? window.songcut.getSegmentMenuStructureForTest()
      : null`
  );
}

async function shortcutState(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const video = document.querySelector("video");
      const selected = document.querySelector(".segment-list tbody tr.selected");
      const handles = [...document.querySelectorAll(".drag-handle")].map((handle) => handle.style.left);
      const zoom = [...document.querySelectorAll("button")]
        .map((button) => button.innerText.trim())
        .find((text) => /^\\d+%$/.test(text)) || "";
      return {
        selectedId: selected?.children[2]?.innerText || "",
        currentTime: video?.currentTime ?? null,
        paused: video?.paused ?? null,
        handles,
        zoom
      };
    })()`
  );
}

function assertShortcutStateEqual(before, after, message) {
  const same =
    before.selectedId === after.selectedId &&
    before.paused === after.paused &&
    before.zoom === after.zoom &&
    JSON.stringify(before.handles) === JSON.stringify(after.handles) &&
    Math.abs((before.currentTime ?? 0) - (after.currentTime ?? 0)) <= 0.04;
  assertPass(same, message, { before, after });
}

async function assertSuppressedShortcut(cdp, label, options = {}) {
  await dispatchShortcut(cdp, "KeyX");
  const before = await shortcutState(cdp);
  assertPass(before.zoom === "100%", `${label}: could not reset zoom before suppression check.`, before);
  await dispatchShortcut(cdp, "KeyC", options);
  const after = await shortcutState(cdp);
  assertShortcutStateEqual(before, after, `${label}: suppressed shortcut changed editor state.`);
}

async function assertTemporaryInteractiveTargetSuppressed(cdp, targetMarkup, label) {
  const selector = `[data-shortcut-suppression=${JSON.stringify(label)}]`;
  const added = await evaluate(
    cdp,
    `(() => {
      const host = document.createElement("div");
      host.innerHTML = ${JSON.stringify(targetMarkup)};
      const target = host.firstElementChild;
      if (!target) return false;
      target.setAttribute("data-shortcut-suppression", ${JSON.stringify(label)});
      document.body.appendChild(target);
      target.focus();
      return true;
    })()`
  );
  assertPass(added, `${label}: could not add suppression test target.`);
  try {
    await assertSuppressedShortcut(cdp, label, { targetSelector: selector });
  } finally {
    await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.remove(); true`);
  }
}

async function setBoundarySecondsInput(cdp, value) {
  const changed = await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector(".boundary-seconds-input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      input.focus();
      setter.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
      return true;
    })()`
  );
  assertPass(changed, "Boundary seconds input was not editable for shortcut checks.");
  await waitFor(
    cdp,
    `document.querySelector(".boundary-seconds-input")?.value === ${JSON.stringify(String(value))}`,
    5000,
    `boundary seconds set to ${value}`
  );
}

async function setBoundaryNudgeSecondsInput(cdp, value) {
  const changed = await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector(".boundary-nudge-seconds-input");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      input.focus();
      setter.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
      return true;
    })()`
  );
  assertPass(changed, "Boundary nudge seconds input was not editable for persistence checks.");
  await waitFor(
    cdp,
    `document.querySelector(".boundary-nudge-seconds-input")?.value === ${JSON.stringify(Number(value).toFixed(1))}`,
    5000,
    `boundary nudge seconds set to ${value}`
  );
}

async function editorSettingState(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const splitText = getComputedStyle(document.querySelector(".app")).getPropertyValue("--video-split");
      return {
        boundaryPreviewInput: document.querySelector(".boundary-seconds-input")?.value || "",
        boundaryNudgeInput: document.querySelector(".boundary-nudge-seconds-input")?.value || "",
        splitPercent: Number.parseFloat(splitText),
        boundaryPreviewStored: localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.boundaryPreview)}),
        boundaryNudgeStored: localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.boundaryNudge)}),
        videoSplitStored: localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.videoSplit)}),
        waveformDisplayStored: localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.waveformDisplay)})
      };
    })()`
  );
}

async function runEditorSettingPersistenceChecks(cdp) {
  const defaults = await waitFor(
    cdp,
    `(() => {
      const preview = document.querySelector(".boundary-seconds-input")?.value;
      const nudge = document.querySelector(".boundary-nudge-seconds-input")?.value;
      const split = Number.parseFloat(getComputedStyle(document.querySelector(".app")).getPropertyValue("--video-split"));
      const waveformDisplay = localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.waveformDisplay)});
      return preview === "5" && nudge === "0.5" && Math.abs(split - 35) < 0.01 && waveformDisplay === "rms";
    })()`,
    5000,
    "default editor settings"
  );
  assertPass(defaults, "Editor settings did not start with the expected defaults.");

  await setBoundarySecondsInput(cdp, 7);
  await setBoundaryNudgeSecondsInput(cdp, 1.2);
  await dragSplitter(cdp, 70);
  await evaluate(
    cdp,
    `localStorage.setItem(${JSON.stringify(editorSettingStorageKeys.waveformDisplay)}, "peak-rms"); true`
  );
  log("EDITOR_SETTINGS_CHANGED_STATE", await editorSettingState(cdp));
  const changed = await waitFor(
    cdp,
    `(() => {
      const preview = localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.boundaryPreview)});
      const nudge = localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.boundaryNudge)});
      const split = Number(localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.videoSplit)}));
      const waveformDisplay = localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.waveformDisplay)});
      return preview === "7" && nudge === "1.2" && Number.isFinite(split) && Math.abs(split - 35) > 0.1 && waveformDisplay === "peak-rms"
        ? { preview, nudge, split, waveformDisplay }
        : false;
    })()`,
    5000,
    "changed editor settings storage"
  );

  await reloadRenderer(cdp);
  const restored = await editorSettingState(cdp);
  assertPass(
    restored.boundaryPreviewInput === "7" &&
      restored.boundaryNudgeInput === "1.2" &&
      Math.abs(restored.splitPercent - changed.split) < 0.01 &&
      restored.boundaryPreviewStored === "7" &&
      restored.boundaryNudgeStored === "1.2" &&
      restored.waveformDisplayStored === "peak-rms" &&
      Math.abs(Number(restored.videoSplitStored) - changed.split) < 0.01,
    "Editor settings were not restored after a renderer reload.",
    { changed, restored }
  );
  log("EDITOR_SETTINGS_PERSISTENCE_OK", { changed, restored });

  await resetEditorSettings(cdp);
}

async function runShortcutChecks(cdp) {
  await setBoundarySecondsInput(cdp, 1);
  await clickSelector(cdp, ".segment-list tbody tr", 0);
  await dispatchShortcut(cdp, "KeyX");

  const firstBefore = await shortcutState(cdp);
  assertPass(firstBefore.selectedId === "guide-001", "Shortcut checks did not start on the first segment.", firstBefore);
  await dispatchShortcut(cdp, "KeyW");
  const firstEdge = await shortcutState(cdp);
  assertShortcutStateEqual(firstBefore, firstEdge, "W wrapped or changed state at the first segment.");

  await dispatchShortcut(cdp, "KeyS");
  const secondSelected = await shortcutState(cdp);
  assertPass(
    secondSelected.selectedId === "guide-002" && secondSelected.currentTime >= 1.9 && secondSelected.currentTime <= 2.15,
    "S did not select and seek to the next segment.",
    secondSelected
  );
  await dispatchShortcut(cdp, "KeyS");
  const lastEdge = await shortcutState(cdp);
  assertShortcutStateEqual(secondSelected, lastEdge, "S wrapped or changed state at the last segment.");

  await dispatchShortcut(cdp, "KeyW");
  const firstSelected = await shortcutState(cdp);
  assertPass(
    firstSelected.selectedId === "guide-001" && firstSelected.currentTime >= 0 && firstSelected.currentTime <= 0.15,
    "W did not select and seek to the previous segment.",
    firstSelected
  );
  log("SHORTCUT_SEGMENT_SELECTION_OK", { firstEdge, secondSelected, lastEdge, firstSelected });

  const listPrepared = await evaluate(
    cdp,
    `(() => {
      const body = document.querySelector(".segment-list-body");
      const viewport = body?.querySelector(".scroll-area-viewport");
      if (!body || !viewport) return false;
      body.dataset.e2eStyle = body.getAttribute("style") || "";
      body.style.flex = "0 0 46px";
      body.style.height = "46px";
      return true;
    })()`
  );
  assertPass(listPrepared, "Could not prepare the segment list for sticky-header scrolling checks.");
  await sleep(200);
  await dispatchShortcut(cdp, "KeyS");
  await evaluate(
    cdp,
    `(() => {
      const viewport = document.querySelector(".segment-list .scroll-area-viewport");
      if (!viewport) return false;
      viewport.scrollTop = viewport.scrollHeight;
      return true;
    })()`
  );
  await dispatchShortcut(cdp, "KeyW");
  const selectedRowVisibility = await evaluate(
    cdp,
    `(() => {
      const viewport = document.querySelector(".segment-list .scroll-area-viewport");
      const list = document.querySelector(".segment-list");
      const header = list?.querySelector(".segment-list-header-table");
      const body = list?.querySelector(".segment-list-body");
      const scrollbar = list?.querySelector(".segment-list-body .scroll-area-scrollbar-vertical");
      const row = viewport?.querySelector("tbody tr.selected");
      if (!viewport || !list || !header || !body || !row) return null;
      const viewportRect = viewport.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const scrollbarRect = scrollbar?.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        selectedId: row.children[2]?.innerText || "",
        listRight: listRect.right,
        headerRight: headerRect.right,
        bodyTop: bodyRect.top,
        viewportBottom: viewportRect.bottom,
        viewportTop: viewportRect.top,
        headerBottom: headerRect.bottom,
        scrollbarTop: scrollbarRect?.top ?? null,
        rowTop: rowRect.top,
        rowBottom: rowRect.bottom,
        scrollTop: viewport.scrollTop
      };
    })()`
  );
  assertPass(
    selectedRowVisibility &&
      selectedRowVisibility.selectedId === "guide-001" &&
      selectedRowVisibility.bodyTop >= selectedRowVisibility.headerBottom - 1 &&
      selectedRowVisibility.viewportTop >= selectedRowVisibility.headerBottom - 1 &&
      (selectedRowVisibility.scrollbarTop === null ||
        selectedRowVisibility.scrollbarTop >= selectedRowVisibility.headerBottom - 1) &&
      selectedRowVisibility.headerRight >= selectedRowVisibility.listRight - 1.5 &&
      selectedRowVisibility.rowTop >= selectedRowVisibility.viewportTop - 1 &&
      selectedRowVisibility.rowBottom <= selectedRowVisibility.viewportBottom + 1,
    "Segment scrollbar overlapped the header, reserved header width, or hid the keyboard-selected row.",
    selectedRowVisibility
  );
  log("SEGMENT_HEADER_SCROLLBAR_SEPARATION_OK", selectedRowVisibility);

  await evaluate(
    cdp,
    `(() => {
      const body = document.querySelector(".segment-list-body");
      if (!body) return false;
      const style = body.dataset.e2eStyle;
      if (style) body.setAttribute("style", style);
      else body.removeAttribute("style");
      delete body.dataset.e2eStyle;
      const viewport = body.querySelector(".scroll-area-viewport");
      if (viewport) viewport.scrollTop = 0;
      return true;
    })()`
  );
  await sleep(200);

  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const domDocument = await cdp.send("DOM.getDocument");
  const hoverRow = await cdp.send("DOM.querySelector", {
    nodeId: domDocument.result.root.nodeId,
    selector: ".segment-list tbody tr:nth-child(2)"
  });
  const hoverRowNodeId = hoverRow.result.nodeId;
  assertPass(hoverRowNodeId, "Could not locate the non-selected segment row for hover color checks.");
  await cdp.send("CSS.forcePseudoState", { nodeId: hoverRowNodeId, forcedPseudoClasses: ["hover"] });
  await sleep(150);
  const rowColors = await evaluate(
    cdp,
    `(() => {
      const selected = document.querySelector(".segment-list tbody tr.selected");
      const hovered = document.querySelector(".segment-list tbody tr:hover");
      if (!selected || !hovered) return null;
      const selectedStyle = getComputedStyle(selected);
      return {
        hoveredId: hovered.children[2]?.innerText || "",
        selectedBackground: selectedStyle.backgroundColor,
        selectedInset: selectedStyle.boxShadow,
        hoveredBackground: getComputedStyle(hovered).backgroundColor
      };
    })()`
  );
  await cdp.send("CSS.forcePseudoState", { nodeId: hoverRowNodeId, forcedPseudoClasses: [] });
  assertPass(
    rowColors &&
      rowColors.hoveredId === "guide-002" &&
      rowColors.selectedBackground.includes("242, 109, 91") &&
      rowColors.selectedInset.includes("242, 109, 91") &&
      rowColors.hoveredBackground === "rgb(33, 50, 57)" &&
      rowColors.hoveredBackground !== rowColors.selectedBackground,
    "Selected and hovered segment rows do not use distinct red and neutral highlights.",
    rowColors
  );
  log("SEGMENT_SELECTION_COLOR_OK", rowColors);

  await dispatchShortcut(cdp, "KeyD", { ctrlKey: true });
  const nextBoundary = await shortcutState(cdp);
  assertPass(
    nextBoundary.currentTime >= 1.9 && nextBoundary.currentTime <= 2.15,
    "Ctrl+D did not jump to the next boundary.",
    nextBoundary
  );
  await dispatchShortcut(cdp, "KeyA", { ctrlKey: true });
  const previousBoundary = await shortcutState(cdp);
  assertPass(
    previousBoundary.currentTime >= 0 && previousBoundary.currentTime <= 0.15,
    "Ctrl+A did not jump to the previous boundary.",
    previousBoundary
  );
  log("SHORTCUT_BOUNDARY_JUMP_OK", { nextBoundary, previousBoundary });

  await dispatchShortcut(cdp, "KeyE");
  const nudgedRight = await shortcutState(cdp);
  assertPass(
    nudgedRight.currentTime >= 0.48 && nudgedRight.currentTime <= 0.55,
    "E did not nudge the nearest boundary right.",
    nudgedRight
  );
  await dispatchShortcut(cdp, "KeyQ");
  const nudgedLeft = await shortcutState(cdp);
  assertPass(
    nudgedLeft.currentTime >= 0 && nudgedLeft.currentTime <= 0.04,
    "Q did not nudge the nearest boundary left.",
    nudgedLeft
  );
  log("SHORTCUT_BOUNDARY_NUDGE_OK", { nudgedRight, nudgedLeft });

  await dispatchShortcut(cdp, "KeyC");
  const zoom200 = await shortcutState(cdp);
  await dispatchShortcut(cdp, "KeyC");
  const zoom400 = await shortcutState(cdp);
  await dispatchShortcut(cdp, "KeyZ");
  const zoomBack200 = await shortcutState(cdp);
  await dispatchShortcut(cdp, "KeyX");
  const zoom100 = await shortcutState(cdp);
  assertPass(
    zoom200.zoom === "200%" && zoom400.zoom === "400%" && zoomBack200.zoom === "200%" && zoom100.zoom === "100%",
    "Z/X/C did not move through the expected zoom levels.",
    { zoom200, zoom400, zoomBack200, zoom100 }
  );
  log("SHORTCUT_ZOOM_OK", { zoom200, zoom400, zoomBack200, zoom100 });

  await dispatchShortcut(cdp, "KeyA");
  const startPreview = await shortcutState(cdp);
  assertPass(
    startPreview.paused === false && startPreview.currentTime >= 0 && startPreview.currentTime < 0.7,
    "A did not play the start boundary.",
    startPreview
  );
  await dispatchShortcut(cdp, "Space");
  const pausedAfterStart = await shortcutState(cdp);
  assertPass(pausedAfterStart.paused === true, "Space did not pause start-boundary playback.", pausedAfterStart);

  await dispatchShortcut(cdp, "Space");
  const playingFromSpace = await shortcutState(cdp);
  assertPass(playingFromSpace.paused === false, "Space did not start playback.", playingFromSpace);
  await dispatchShortcut(cdp, "Space");
  const pausedFromSpace = await shortcutState(cdp);
  assertPass(pausedFromSpace.paused === true, "Space did not pause playback.", pausedFromSpace);

  await dispatchShortcut(cdp, "KeyD");
  const endPreview = await shortcutState(cdp);
  assertPass(
    endPreview.paused === false && endPreview.currentTime >= 1 && endPreview.currentTime < 1.7,
    "D did not play the end boundary.",
    endPreview
  );
  await dispatchShortcut(cdp, "Space");
  const pausedAfterEnd = await shortcutState(cdp);
  assertPass(pausedAfterEnd.paused === true, "Space did not pause end-boundary playback.", pausedAfterEnd);
  log("SHORTCUT_PLAYBACK_OK", { startPreview, pausedAfterStart, playingFromSpace, pausedFromSpace, endPreview, pausedAfterEnd });

  const repeatedShortcuts = [
    ["KeyA", {}],
    ["KeyD", {}],
    ["KeyW", {}],
    ["KeyS", {}],
    ["KeyQ", {}],
    ["KeyE", {}],
    ["Space", {}],
    ["KeyA", { ctrlKey: true }],
    ["KeyD", { ctrlKey: true }],
    ["KeyZ", {}],
    ["KeyX", {}],
    ["KeyC", {}]
  ];
  for (const [code, modifiers] of repeatedShortcuts) {
    await clickSelector(cdp, ".segment-list tbody tr", code === "KeyW" && !modifiers.ctrlKey ? 1 : 0);
    await dispatchShortcut(cdp, "KeyX");
    if (code === "KeyZ" || code === "KeyX") await dispatchShortcut(cdp, "KeyC");
    await evaluate(
      cdp,
      `(() => {
        const video = document.querySelector("video");
        if (!video) return false;
        video.pause();
        video.currentTime = 0.25;
        video.dispatchEvent(new Event("timeupdate"));
        return true;
      })()`
    );
    await sleep(100);
    const before = await shortcutState(cdp);
    await dispatchShortcut(cdp, code, { ...modifiers, repeat: true });
    const after = await shortcutState(cdp);
    assertShortcutStateEqual(before, after, `${code} repeat event was not ignored.`);
  }
  log("SHORTCUT_ALL_REPEAT_EVENTS_IGNORED_OK", repeatedShortcuts.map(([code, modifiers]) => ({ code, ...modifiers })));

  await assertSuppressedShortcut(cdp, "defaultPrevented event", { defaultPrevented: true });
  await assertSuppressedShortcut(cdp, "IME composing event", { isComposing: true });
  await assertSuppressedShortcut(cdp, "IME keyCode 229 event", { keyCode: 229 });
  log("SHORTCUT_EVENT_GUARDS_SUPPRESSED_OK", ["defaultPrevented", "isComposing", "keyCode-229"]);

  const unexpectedModifiers = [
    ["Ctrl+Z", "KeyZ", { ctrlKey: true }],
    ["Ctrl+X", "KeyX", { ctrlKey: true }],
    ["Ctrl+C", "KeyC", { ctrlKey: true }],
    ["Shift+A", "KeyA", { shiftKey: true }],
    ["Alt+C", "KeyC", { altKey: true }],
    ["Meta+C", "KeyC", { metaKey: true }]
  ];
  for (const [label, code, modifiers] of unexpectedModifiers) {
    await dispatchShortcut(cdp, "KeyX");
    const before = await shortcutState(cdp);
    await dispatchShortcut(cdp, code, modifiers);
    const after = await shortcutState(cdp);
    assertShortcutStateEqual(before, after, `${label} was misidentified as an editor shortcut.`);
  }
  log("SHORTCUT_UNEXPECTED_MODIFIERS_IGNORED_OK", unexpectedModifiers.map(([label]) => label));

  const interactiveTargets = [
    ["input", "<input />"],
    ["textarea", "<textarea></textarea>"],
    ["select", "<select><option>one</option></select>"],
    ["button", "<button type='button'>button</button>"],
    ["link", "<a href='#'>link</a>"],
    ["contenteditable", "<div contenteditable='true' tabindex='0'></div>"],
    ["role-textbox", "<div role='textbox' tabindex='0'></div>"],
    ["role-button", "<div role='button' tabindex='0'></div>"],
    ["role-checkbox", "<div role='checkbox' tabindex='0'></div>"],
    ["role-radio", "<div role='radio' tabindex='0'></div>"],
    ["role-slider", "<div role='slider' tabindex='0'></div>"],
    ["role-menuitem", "<div role='menuitem' tabindex='0'></div>"]
  ];
  for (const [label, markup] of interactiveTargets) {
    await assertTemporaryInteractiveTargetSuppressed(cdp, markup, label);
  }
  log("SHORTCUT_ALL_INTERACTIVE_TARGETS_SUPPRESSED_OK", interactiveTargets.map(([label]) => label));

  await dispatchShortcut(cdp, "KeyX");
  await clickButton(cdp, "View", 0);
  await waitFor(cdp, `!!document.querySelector("[role='dialog'][aria-modal='true']")`, 5000, "shortcut suppression dialog");
  const dialogBefore = await shortcutState(cdp);
  await dispatchShortcut(cdp, "KeyC");
  await dispatchShortcut(cdp, "Space");
  const dialogAfter = await shortcutState(cdp);
  assertShortcutStateEqual(dialogBefore, dialogAfter, "Modal dialog did not suppress editor shortcuts.");
  await clickButton(cdp, "Close");
  await waitFor(cdp, `!document.querySelector("[role='dialog'][aria-modal='true']")`, 5000, "shortcut suppression dialog close");
  log("SHORTCUT_MODAL_DIALOG_SUPPRESSED_OK", { dialogBefore, dialogAfter });

  await clickSelector(cdp, ".segment-list tbody tr", 0);
  await dispatchShortcut(cdp, "KeyX");
  await evaluate(cdp, `document.querySelector("video")?.pause(); true`);
  log("ALL_SHORTCUT_CHECKS_OK");
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
      const hit = document.elementFromPoint(sx, sy);
      return {
        sx,
        sy,
        tx: sx + ${deltaX},
        ty: sy,
        startTime,
        hit: hit ? { tag: hit.tagName, className: String(hit.className?.baseVal ?? hit.className ?? "") } : null,
        waveformRect: { top: rect.top, bottom: rect.bottom },
        segmentListRect: (() => {
          const value = document.querySelector(".segment-list")?.getBoundingClientRect();
          return value ? { top: value.top, bottom: value.bottom } : null;
        })()
      };
    })()`
  );
  if (!data) throw new Error("Waveform timeline not found for drag seek.");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: data.sx, y: data.sy });
  await sleep(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: data.sx, y: data.sy, button: "left", buttons: 1, clickCount: 1 });
  await sleep(100);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: data.tx, y: data.ty, button: "left", buttons: 1 });
  await sleep(250);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: data.tx, y: data.ty, button: "left", buttons: 0, clickCount: 1 });
  await sleep(700);
  const state = await videoState(cdp);
  const metrics = await timelineMetrics(cdp);
  return {
    ...state,
    startTime: data.startTime,
    seekDelta: state ? state.currentTime - data.startTime : null,
    hit: data.hit,
    waveformRect: data.waveformRect,
    segmentListRect: data.segmentListRect,
    metrics
  };
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
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: data.sx, y: data.sy, button: "left", buttons: 1, clickCount: 1 });
  await sleep(950);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: data.sx, y: data.sy, button: "left", buttons: 1 });
  await sleep(150);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: data.sx, y: data.sy, button: "left", buttons: 0, clickCount: 1 });
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

async function waitForExportedFile(directory = outputDir) {
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const files = fs.existsSync(directory)
      ? fs.readdirSync(directory).filter((name) => name.toLowerCase().endsWith(".mp4"))
      : [];
    if (files.length) {
      const stats = files.map((name) => ({
        name,
        bytes: fs.statSync(path.join(directory, name)).size
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
    execFileSync("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    try {
      processHandle.kill();
    } catch {}
  }
}

(async () => {
  ensureTestVideo();
  const env = {
    ...process.env,
    SONGCUT_E2E_VIDEO: input,
    SONGCUT_E2E_OUTPUT_DIR: outputDir,
    SONGCUT_E2E_USER_DATA_DIR: e2eUserDataDir
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
    await resetEditorSettings(cdp);
    const initial = await evaluate(
      cdp,
      `(() => ({
        buttons: [...document.querySelectorAll("button")].map((button) => button.innerText || button.title),
        hasBoundarySecondsInput: !!document.querySelector(".boundary-seconds-input[aria-label='Boundary seconds']"),
        hasBoundaryNudgeSecondsInput: !!document.querySelector(".boundary-nudge-seconds-input[aria-label='Boundary nudge seconds']"),
        timelineViewportCount: document.querySelectorAll(".timeline-scroll-area .scroll-area-viewport").length,
        hasSegmentList: !!document.querySelector(".segment-list .segment-list-body.scroll-area .scroll-area-viewport"),
        hasResidentWhisperSettings: !!document.querySelector(".control-pane .whisper-settings"),
        saveStatus: (() => {
          const element = document.querySelector(".project-save-status");
          return element ? { text: element.innerText, fontSize: getComputedStyle(element).fontSize } : null;
        })(),
        guideStatusWidths: (() => {
          const guide = document.querySelector(".guide-row .textarea")?.getBoundingClientRect();
          const status = document.querySelector(".guide-row .status-panel")?.getBoundingClientRect();
          return guide && status ? { guide: guide.width, status: status.width } : null;
        })(),
        text: document.body.innerText
      }))()`
    );
    log("RENDER_OK", initial);
    assertPass(
      initial.buttons.some((label) => label.startsWith("Play start boundary (A)")) &&
        initial.buttons.some((label) => label.startsWith("Play end boundary (D)")) &&
        initial.buttons.some((label) => label.startsWith("Nudge nearest boundary left (Q)")) &&
        initial.buttons.some((label) => label.startsWith("Nudge nearest boundary right (E)")) &&
        initial.buttons.includes("Export TS") &&
        initial.buttons.includes("Settings") &&
        !initial.hasResidentWhisperSettings &&
        initial.saveStatus?.text === "Saved" &&
        parseFloat(initial.saveStatus?.fontSize || "0") >= 14 &&
        initial.guideStatusWidths &&
        Math.abs(initial.guideStatusWidths.guide - initial.guideStatusWidths.status) <= 2 &&
        initial.hasSegmentList &&
        initial.hasBoundarySecondsInput &&
        initial.hasBoundaryNudgeSecondsInput,
      "Boundary playback, nudge, or TS export controls are missing from the toolbar.",
      initial
    );
    const segmentMenuStructure = await getSegmentMenuStructureForTest(cdp);
    const expectedSegmentMenuLabels = [
      "-- Segment Selection --",
      "Previous Segment",
      "Next Segment",
      "-- Segment Management --",
      "New Segment",
      "Remove Segment...",
      "Remove All Unchecked Segments...",
      "Sort Segments...",
      "-- Export Selection --",
      "Check All",
      "Uncheck All",
      "Invert Selection"
    ];
    assertPass(
      Array.isArray(segmentMenuStructure) &&
        JSON.stringify(segmentMenuStructure.filter((item) => item.type !== "separator").map((item) => item.label)) ===
          JSON.stringify(expectedSegmentMenuLabels) &&
        segmentMenuStructure.filter((item) => item.type === "separator").length === 2 &&
        segmentMenuStructure.every((item) => !item.hasSubmenu) &&
        segmentMenuStructure
          .filter((item) => item.label?.startsWith("-- "))
          .every((item) => item.enabled === false),
      "The Segment menu is not a flat, headed menu like Edit.",
      segmentMenuStructure
    );
    log("SEGMENT_MENU_FLAT_STRUCTURE_OK", segmentMenuStructure);
    assertPass(await capturePng(cdp, initialScreenshotPath, "INITIAL_RENDER", processHandle), "Initial render screenshot could not be captured.");
    await runEditorSettingPersistenceChecks(cdp);

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
    await waitFor(cdp, `document.querySelector("video")?.src.includes("e2e_input.mp4")`, 30_000, "video load");
    log("DND_LOAD_OK", await videoState(cdp));
    const sidecarPath = `${input}.songcut`;
    assertPass(fs.existsSync(sidecarPath), "Loading a video did not create its .songcut sidecar.", sidecarPath);
    const initialProject = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    assertPass(
      initialProject.format === "songcut-project" &&
        initialProject.schema_version === 3 &&
        (initialProject.waveform_snapshot === null || typeof initialProject.waveform_snapshot?.data_base64 === "string") &&
        initialProject.settings?.whisper?.enabled === false &&
        initialProject.settings?.whisper?.model === "small" &&
        initialProject.settings?.whisper?.language === "ja" &&
        initialProject.settings?.whisper?.device === "auto" &&
        initialProject.settings?.export?.filename_template === "{index}_{title}",
      "The initial sidecar did not contain the expected schema and project-setting defaults.",
      initialProject
    );
    log("PROJECT_SIDECAR_CREATED_OK", { sidecarPath, revision: initialProject.revision });

    await clickButton(cdp, "Load");
    await waitFor(cdp, `document.querySelector("video")?.src.includes("e2e_input.mp4")`, 30_000, "video load button");
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

    const loadTimeWaveform = await waitFor(
      cdp,
      `(() => {
        const layer = document.querySelector(".waveform-static-layer");
        const path = document.querySelector(".waveform-static-layer path[data-waveform-path]");
        const pointCount = Number(layer?.dataset.waveformPoints);
        return path?.getAttribute("d") && pointCount > 0 && document.querySelectorAll(".segment-list tbody tr").length === 0
          ? { pointCount, phase: document.querySelector(".waveform-timeline svg")?.dataset.waveformPhase || null }
          : false;
      })()`,
      30_000,
      "load-time waveform before analysis"
    );
    assertPass(loadTimeWaveform.pointCount > 0, "Video load did not produce a waveform before analysis.", loadTimeWaveform);
    log("LOAD_TIME_WAVEFORM_OK", loadTimeWaveform);

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

    const whisperReady = await prepareWhisperModel(cdp);
    assertPass(whisperReady?.ok, "Whisper preparation failed.", whisperReady);
    log("WHISPER_READY_OK", whisperReady);
    await clickButton(cdp, "Settings");
    const settingsDialog = await waitFor(
      cdp,
      `(() => {
        const dialog = [...document.querySelectorAll(".dialog")].find((node) => node.innerText.includes("Whisper transcription"));
        const text = dialog?.innerText || "";
        const filenameTemplate = dialog?.querySelector("#export-filename-template")?.value;
        const hasSettingsScrollArea = !!dialog?.querySelector(".settings-dialog-scroll.scroll-area .scroll-area-viewport");
        return dialog && text.includes("Prepare Whisper Model") && text.includes("Playback and analysis") &&
          text.includes("Export") && text.includes("Filename template") && filenameTemplate === "{index}_{title}" &&
          hasSettingsScrollArea ? text : false;
      })()`,
      10_000,
      "Settings dialog with Whisper controls"
    );
    log("SETTINGS_DIALOG_OK", settingsDialog);
    const settingsScrollArea = await evaluate(
      cdp,
      `(() => {
        const root = document.querySelector(".settings-dialog-scroll.scroll-area");
        const viewport = root?.querySelector(".scroll-area-viewport");
        const content = document.querySelector(".settings-dialog-content");
        return root && viewport && content
          ? { height: root.getBoundingClientRect().height, contentOverflowY: getComputedStyle(content).overflowY }
          : null;
      })()`
    );
    assertPass(
      settingsScrollArea?.height > 0 && settingsScrollArea.contentOverflowY !== "auto" && settingsScrollArea.contentOverflowY !== "scroll",
      "Settings does not use the bounded Shadcn/Radix ScrollArea as its scroll owner.",
      settingsScrollArea
    );
    log("SETTINGS_SCROLL_AREA_OK", settingsScrollArea);
    assertPass(
      await evaluate(cdp, `!document.querySelector('input[list], datalist')`),
      "Settings still uses the native language datalist."
    );
    await clickAt(cdp, '.language-combobox input[role="combobox"]');
    await waitFor(cdp, `document.querySelector('.language-combobox input[role="combobox"]')?.getAttribute('aria-expanded') === 'true'`, 5000, "language combobox open");
    const initialLanguageOptions = await evaluate(
      cdp,
      `(() => ({
        codes: [...document.querySelectorAll('.language-combobox-option .language-combobox-code')].map((node) => node.innerText),
        selected: document.querySelector('.language-combobox-option[aria-selected="true"] .language-combobox-code')?.innerText || null,
        inputValue: document.querySelector('.language-combobox input[role="combobox"]')?.value ?? null
      }))()`
    );
    assertPass(
      JSON.stringify(initialLanguageOptions.codes.slice(0, 5)) === JSON.stringify(["auto", "ja", "en", "zh", "ko"]) &&
        initialLanguageOptions.codes.filter((code) => code === "ja").length === 1 &&
        initialLanguageOptions.selected === "ja" &&
        initialLanguageOptions.inputValue === "",
      "Language combobox did not open with the fixed primary ordering and a separate empty search query.",
      initialLanguageOptions
    );
    log("WHISPER_LANGUAGE_PRIMARY_ORDER_OK", initialLanguageOptions);

    await clickAt(cdp, '.language-combobox-option[data-language-code="en"]');
    assertPass(
      await evaluate(cdp, `document.querySelector('.language-combobox input[role="combobox"]')?.value === 'English'`),
      "Mouse selection did not choose English."
    );
    await dispatchInputKey(cdp, "ArrowDown", "ArrowDown", 40);
    await dispatchInputKey(cdp, "ArrowDown", "ArrowDown", 40);
    await dispatchInputKey(cdp, "Enter", "Enter", 13);
    assertPass(
      await evaluate(cdp, `document.querySelector('.language-combobox input[role="combobox"]')?.value === 'Chinese'`),
      "Keyboard navigation did not choose the next language."
    );
    await dispatchInputKey(cdp, "ArrowDown", "ArrowDown", 40);
    await dispatchInputKey(cdp, "Escape", "Escape", 27);
    assertPass(
      await evaluate(
        cdp,
        `(() => {
          const input = document.querySelector('.language-combobox input[role="combobox"]');
          return input?.getAttribute('aria-expanded') === 'false' && input?.value === 'Chinese';
        })()`
      ),
      "Escape did not cancel the open language list without changing the selection."
    );

    await clickAt(cdp, '.language-combobox input[role="combobox"]');
    await cdp.send("Input.insertText", { text: "ja" });
    const searchedLanguages = await waitFor(
      cdp,
      `(() => {
        const input = document.querySelector('.language-combobox input[role="combobox"]');
        const codes = [...document.querySelectorAll('.language-combobox-option .language-combobox-code')].map((node) => node.innerText);
        return input?.value === 'ja' && codes.length ? { codes, expanded: input.getAttribute('aria-expanded') } : false;
      })()`,
      5000,
      "language code search"
    );
    assertPass(
      searchedLanguages.codes[0] === "ja" && searchedLanguages.expanded === "true",
      "Explicit ja search did not rank Japanese first.",
      searchedLanguages
    );
    await dispatchInputKey(cdp, "Enter", "Enter", 13);
    assertPass(
      await evaluate(cdp, `document.querySelector('.language-combobox input[role="combobox"]')?.value === 'Japanese'`),
      "Enter did not select Japanese from the search results."
    );
    log("WHISPER_LANGUAGE_MOUSE_KEYBOARD_OK", searchedLanguages);
    await waitFor(
      cdp,
      `document.querySelector(".settings-dialog-content .model-state.ready")?.innerText || false`,
      10_000,
      "Settings dialog Whisper ready state"
    );
    const whisperEnabled = await evaluate(
      cdp,
      `(() => {
        const checkbox = document.querySelector('.settings-dialog-content .whisper-settings input[type="checkbox"]');
        if (!checkbox) return false;
        if (!checkbox.checked) checkbox.click();
        return checkbox.checked;
      })()`
    );
    assertPass(whisperEnabled, "Whisper could not be enabled after explicit model preparation.");
    log("WHISPER_ENABLED_OK");
    const settingsFilenameTemplateChanged = await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector("#export-filename-template");
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "{title}_{index}");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`
    );
    assertPass(settingsFilenameTemplateChanged, "Settings filename template was not editable.");
    await waitFor(
      cdp,
      `document.querySelector("#export-filename-template")?.value === "{title}_{index}"`,
      5000,
      "Settings filename template change"
    );
    log("SETTINGS_FILENAME_TEMPLATE_OK");
    await clickButton(cdp, "Done");
    await waitFor(cdp, `!document.querySelector(".dialog")`, 5000, "Settings dialog close");
    assertPass(
      await evaluate(cdp, `!document.querySelector(".control-pane .whisper-settings")`),
      "Whisper settings remained resident after closing Settings."
    );
    log("WHISPER_SETTINGS_NON_RESIDENT_OK");
    await dispatchInputKey(cdp, ",", "Comma", 188, { modifiers: 2 });
    await waitFor(
      cdp,
      `document.querySelector('.dialog[aria-label="Settings"]') ? true : false`,
      5000,
      "Ctrl+, Settings shortcut"
    );
    log("SETTINGS_CTRL_COMMA_SHORTCUT_OK");
    await clickButton(cdp, "Done");
    await waitFor(cdp, `!document.querySelector(".dialog")`, 5000, "Settings shortcut dialog close");

    await setGuideText(
      cdp,
      "1. 0:00-0:02\n├ Smoke Song\n└ (Smoke)\n2. 0:02-0:04\n├ Encore Song\n└ (Encore)\n"
    );
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
    assertPass(beforeRows.length === 2, "The shortcut fixture did not create two guided segments.", beforeRows);
    assertPass(beforeRows[0][1] === "Smoke Song", "First guide title was not reflected in the analysis segment list.", beforeRows);
    assertPass(beforeRows[0][2] === "guide-001", "First guide entry was not reflected in the analysis segment list.", beforeRows);
    assertPass(beforeRows[0][3] === "0:00" && beforeRows[0][4] === "0:02", "First guided segment range was not reflected in the analysis segment list.", beforeRows);
    assertPass(beforeRows[1][1] === "Encore Song", "Second guide title was not reflected in the analysis segment list.", beforeRows);
    assertPass(beforeRows[1][2] === "guide-002", "Second guide entry was not reflected in the analysis segment list.", beforeRows);
    assertPass(beforeRows[1][3] === "0:02" && beforeRows[1][4] === "0:04", "Second guided segment range was not reflected in the analysis segment list.", beforeRows);
    const waveformRender = await evaluate(
      cdp,
      `(() => {
        const layer = document.querySelector(".waveform-static-layer");
        const paths = [...document.querySelectorAll(".waveform-static-layer path[data-waveform-path]")];
        return {
          pathCount: paths.length,
          kinds: paths.map((path) => path.dataset.waveformPath),
          hasPathData: paths.every((path) => path.getAttribute("d")?.length > 0),
          level: Number(layer?.dataset.waveformLevel),
          pointCount: Number(layer?.dataset.waveformPoints),
          lineCount: document.querySelectorAll(".waveform-timeline svg line").length
        };
      })()`
    );
    assertPass(
      waveformRender.pathCount === 1 &&
        waveformRender.kinds[0] === "rms" &&
        waveformRender.hasPathData &&
        waveformRender.pointCount > 0 &&
        waveformRender.lineCount === 0,
      "The completed load-time waveform did not remain as one active RMS path after analysis.",
      waveformRender
    );
    log("WAVEFORM_RENDER_OK", waveformRender);

    const waveformPathBeforeTimeUpdate = await evaluate(
      cdp,
      `(() => {
        const path = document.querySelector(".waveform-static-layer path[data-waveform-path]");
        if (!path) return null;
        path.__songcutE2EIdentity = "waveform-static-path";
        return path.getAttribute("d");
      })()`
    );
    await evaluate(
      cdp,
      `(() => {
        const video = document.querySelector("video");
        if (!video) return false;
        video.currentTime = 1;
        video.dispatchEvent(new Event("timeupdate"));
        return true;
      })()`
    );
    await sleep(100);
    const waveformPathAfterTimeUpdate = await evaluate(
      cdp,
      `(() => {
        const path = document.querySelector(".waveform-static-layer path[data-waveform-path]");
        return path ? { identity: path.__songcutE2EIdentity || null, d: path.getAttribute("d") } : null;
      })()`
    );
    assertPass(
      waveformPathAfterTimeUpdate?.identity === "waveform-static-path" &&
        waveformPathAfterTimeUpdate.d === waveformPathBeforeTimeUpdate,
      "Playback time updates replaced or mutated the static waveform path.",
      { waveformPathBeforeTimeUpdate, waveformPathAfterTimeUpdate }
    );
    log("WAVEFORM_STATIC_PATH_OK", { pathLength: waveformPathBeforeTimeUpdate?.length ?? 0 });

    await editFirstSegmentTitle(cdp, "Smoke Song Edited");
    beforeRows = await tableRows(cdp);
    assertPass(beforeRows[0][1] === "Smoke Song Edited", "Editable segment title did not update the segment list.", beforeRows);
    log("TITLE_EDIT_OK", beforeRows);
    await sleep(2000);
    const savedProject = JSON.parse(fs.readFileSync(`${input}.songcut`, "utf8"));
    assertPass(
      savedProject.revision > initialProject.revision &&
        savedProject.guide_text.includes("Smoke Song") &&
        savedProject.segments?.[0]?.title === "Smoke Song Edited" &&
        savedProject.waveform_snapshot?.encoding === "f32le-4-u32le-1-v1" &&
        savedProject.waveform_snapshot?.point_count > 0 &&
        savedProject.waveform_snapshot?.data_base64?.length > 0 &&
        savedProject.waveform_snapshot.data_base64.length ===
          Math.ceil((savedProject.waveform_snapshot.point_count * 20) / 3) * 4 &&
        !Object.prototype.hasOwnProperty.call(savedProject.waveform_snapshot || {}, "points") &&
        !Object.prototype.hasOwnProperty.call(savedProject.analysis_snapshot || {}, "waveform") &&
        savedProject.settings?.whisper?.enabled === true,
      "Autosave did not persist the guide, analysis, edit, and Whisper setting.",
      savedProject
    );
    log("PROJECT_AUTOSAVE_OK", { revision: savedProject.revision, segmentCount: savedProject.segments.length });

    await clickButton(cdp, "Export");
    await waitFor(cdp, `document.querySelector(".dialog") && document.body.innerText.includes("Export Review")`, 15_000, "early export dialog");
    const settingsTemplateReview = await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".output-template-field input");
        const row = document.querySelector(".output-row");
        return input?.value === "{title}_{index}" && row?.innerText.includes("Smoke Song Edited_01.mp4")
          ? { template: input.value, row: row.innerText }
          : false;
      })()`
    );
    assertPass(settingsTemplateReview, "The filename template changed in Settings was not reflected in Export Review.");
    const earlyExportTemplateChanged = await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".output-template-field input");
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "{index}_{id}");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`
    );
    assertPass(earlyExportTemplateChanged, "Export Review filename template was not editable.");
    await waitFor(
      cdp,
      `document.querySelector(".output-row")?.innerText.includes("01_guide-001.mp4")`,
      5000,
      "early customized export filename"
    );
    const earlyCustomizedProject = await waitForJsonFile(
      sidecarPath,
      (document) => document.settings?.export?.filename_template === "{index}_{id}",
      10_000,
      "early project-specific export filename template"
    );
    assertPass(
      await evaluate(cdp, `localStorage.getItem("songcut:filename-template") === null`),
      "The project-specific filename template was still written to renderer local storage."
    );
    log("EXPORT_NAMING_PROJECT_SETTING_EARLY_OK", {
      fromSettings: settingsTemplateReview.template,
      savedTemplate: earlyCustomizedProject.settings.export.filename_template,
      revision: earlyCustomizedProject.revision
    });
    await clickButton(cdp, "Back");
    await waitFor(cdp, `!document.querySelector(".dialog")`, 5000, "early export dialog close");
    if (process.env.SONGCUT_E2E_SEGMENT_MENU_ONLY === "1") {
      await evaluate(
        cdp,
        `(() => {
          const video = document.querySelector("video");
          if (!video) return false;
          video.currentTime = 4.5;
          video.dispatchEvent(new Event("timeupdate"));
          return true;
        })()`
      );
      await dispatchMenuCommandForTest(cdp, "new-segment");
      const newSegmentState = await waitFor(
        cdp,
        `(() => {
          const rows = [...document.querySelectorAll(".segment-list tbody tr")];
          const selected = document.querySelector(".segment-list tbody tr.selected");
          return rows.length === 3 && selected?.innerText.includes("manual-001")
            ? rows.map((row) => row.innerText)
            : false;
        })()`,
        5000,
        "New Segment menu command"
      );
      log("SEGMENT_MENU_NEW_OK", newSegmentState);

      await dispatchMenuCommandForTest(cdp, "sort-segments");
      const sortReview = await waitFor(
        cdp,
        `(() => {
          const dialog = document.querySelector('.dialog[aria-label="Sort Segments?"]');
          const panes = [...(dialog?.querySelectorAll(".segment-review-pane") || [])].map((pane) => ({
            label: pane.querySelector("h3")?.innerText || "",
            ids: [...pane.querySelectorAll(".output-meta")].map((item) => item.innerText.match(/ID: ([^ /]+)/)?.[1] || "")
          }));
          return panes.length === 2 ? panes : false;
        })()`,
        5000,
        "Sort Segments review"
      );
      assertPass(
        JSON.stringify(sortReview[0]) === JSON.stringify({ label: "Before", ids: ["guide-001", "manual-001", "guide-002"] }) &&
          JSON.stringify(sortReview[1]) === JSON.stringify({ label: "After", ids: ["guide-001", "guide-002", "manual-001"] }),
        "Sort Segments review did not show the expected Before/After order.",
        sortReview
      );
      await clickButton(cdp, "Sort Segments");
      await waitFor(
        cdp,
        `JSON.stringify([...document.querySelectorAll(".segment-list tbody tr")].map((row) => row.cells[2]?.innerText)) === JSON.stringify(["guide-001", "guide-002", "manual-001"])`,
        5000,
        "sorted segment list"
      );
      log("SEGMENT_MENU_SORT_OK", sortReview);

      await dispatchMenuCommandForTest(cdp, "uncheck-all-segments");
      await waitFor(cdp, `[...document.querySelectorAll(".segment-list input[type=checkbox]")].every((item) => !item.checked)`, 5000, "Uncheck All");
      await dispatchMenuCommandForTest(cdp, "check-all-segments");
      await waitFor(cdp, `[...document.querySelectorAll(".segment-list input[type=checkbox]")].every((item) => item.checked)`, 5000, "Check All");
      await dispatchMenuCommandForTest(cdp, "invert-segment-selection");
      await waitFor(cdp, `[...document.querySelectorAll(".segment-list input[type=checkbox]")].every((item) => !item.checked)`, 5000, "Invert Selection off");
      await dispatchMenuCommandForTest(cdp, "invert-segment-selection");
      await waitFor(cdp, `[...document.querySelectorAll(".segment-list input[type=checkbox]")].every((item) => item.checked)`, 5000, "Invert Selection on");
      log("SEGMENT_MENU_EXPORT_SELECTION_OK");

      await dispatchMenuCommandForTest(cdp, "remove-segment");
      const removeReview = await waitFor(
        cdp,
        `(() => {
          const dialog = document.querySelector('.dialog[aria-label="Remove Segment?"]');
          const rows = [...(dialog?.querySelectorAll(".output-row") || [])];
          return rows.length === 1 && rows[0].innerText.includes("manual-001") ? rows[0].innerText : false;
        })()`,
        5000,
        "Remove Segment review"
      );
      await clickButton(cdp, "Remove Segment");
      await waitFor(cdp, `document.querySelectorAll(".segment-list tbody tr").length === 2 && !document.querySelector(".dialog")`, 5000, "Remove Segment confirm");
      log("SEGMENT_MENU_REMOVE_ONE_OK", removeReview);

      await clickSelector(cdp, ".segment-list input[type=checkbox]", 1);
      await waitFor(cdp, `document.querySelectorAll(".segment-list input[type=checkbox]:not(:checked)").length === 1`, 5000, "unchecked segment target");
      await dispatchMenuCommandForTest(cdp, "remove-unchecked-segments");
      const removeUncheckedReview = await waitFor(
        cdp,
        `(() => {
          const dialog = document.querySelector('.dialog[aria-label="Remove All Unchecked Segments?"]');
          const rows = [...(dialog?.querySelectorAll(".output-row") || [])];
          return rows.length === 1 && rows[0].innerText.includes("guide-002") ? rows[0].innerText : false;
        })()`,
        5000,
        "Remove All Unchecked Segments review"
      );
      await clickButton(cdp, "Remove Segment");
      await waitFor(cdp, `document.querySelectorAll(".segment-list tbody tr").length === 1 && !document.querySelector(".dialog")`, 5000, "Remove All Unchecked Segments confirm");
      log("SEGMENT_MENU_REMOVE_UNCHECKED_OK", removeUncheckedReview);
      const segmentMenuProject = await waitForJsonFile(
        sidecarPath,
        (document) =>
          document.segments?.length === 1 &&
          document.segments[0]?.id === "guide-001" &&
          document.export_candidates?.length === 1 &&
          document.export_candidates[0]?.segment_id === "guide-001",
        10_000,
        "segment menu project autosave"
      );
      log("SEGMENT_MENU_PROJECT_AUTOSAVE_OK", {
        segmentIds: segmentMenuProject.segments.map((segment) => segment.id),
        exportCandidateIds: segmentMenuProject.export_candidates.map((candidate) => candidate.segment_id),
        revision: segmentMenuProject.revision
      });
      log("E2E_SEGMENT_MENU_ONLY_PASS");
      return;
    }
    if (process.env.SONGCUT_E2E_EXPORT_NAMING_ONLY === "1") {
      log("E2E_EXPORT_NAMING_ONLY_PASS");
      return;
    }

    await runShortcutChecks(cdp);

    const beforeTsCopy = await evaluate(
      cdp,
      `(() => ({
        checkboxes: [...document.querySelectorAll(".segment-list input[type=checkbox]")].map((checkbox) => checkbox.checked),
        exportTsDisabled: [...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "Export TS")?.disabled ?? null,
        message: document.querySelector(".status-main")?.innerText || "",
        dialogCount: document.querySelectorAll("[role='dialog'][aria-modal='true']").length
      }))()`
    );
    log("BEFORE_TS_COPY", beforeTsCopy);
    const clipboardAvailable = await evaluate(
      cdp,
      `(() => {
        const marker = "songcut-e2e-clipboard-probe";
        window.songcut.writeClipboard(marker);
        return window.songcut.readClipboard() === marker;
      })()`
    );
    await evaluate(cdp, `window.songcut.writeClipboard(""); true`);
    await clickButton(cdp, "Export TS");
    await sleep(300);
    const afterTsCopyClick = await evaluate(
      cdp,
      `(() => ({
        clipboard: window.songcut?.readClipboard?.() || "",
        message: document.querySelector(".status-main")?.innerText || "",
        dialogs: [...document.querySelectorAll("[role='dialog'][aria-modal='true']")].map((dialog) => dialog.innerText)
      }))()`
    );
    log("AFTER_TS_COPY_CLICK", afterTsCopyClick);
    if (clipboardAvailable) {
      const copiedTsComment = await waitFor(
        cdp,
        `(() => {
          const text = window.songcut?.readClipboard?.() || "";
          return text || false;
        })()`,
        5000,
        "TS comment clipboard copy"
      );
      assertPass(
        copiedTsComment.includes("0:00 - 0:02 Smoke Song Edited") && copiedTsComment.includes("0:02 - 0:04 Encore Song"),
        "TS comment clipboard text did not include both guided segments.",
        copiedTsComment
      );
      log("EXPORT_TS_CLIPBOARD_OK", copiedTsComment);
    } else {
      log("EXPORT_TS_CLIPBOARD_SKIPPED", { reason: "Electron clipboard is unavailable in this E2E session." });
    }
    const copyDialog = await waitFor(
      cdp,
      `(() => {
        const dialog = document.querySelector(".dialog");
        const text = dialog?.innerText || "";
        return text.includes("Export TS") && text.includes("Copied 2 timestamp lines to the clipboard.") ? text : false;
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
        boundaryNudgeDefaults.value === "0.5" &&
        boundaryNudgeDefaults.step === "0.1" &&
        boundaryNudgeDefaults.min === "0.1",
      "Boundary nudge seconds input does not default to 0.5 seconds in 0.1 second steps.",
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
        return video && !video.paused && video.currentTime >= 1 && video.currentTime < 1.8
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
        return video && video.paused && video.currentTime >= 1.95 && video.currentTime <= 2.08
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

    const checkedDefault = await evaluate(
      cdp,
      `[...document.querySelectorAll(".segment-list input[type=checkbox]")].every((checkbox) => checkbox.checked === true)`
    );
    assertPass(checkedDefault, "Segment checkboxes are not checked by default.");
    await clickSelector(cdp, ".segment-list input[type=checkbox]", 0);
    const oneCheckedState = await waitFor(
      cdp,
      `(() => {
        const checkboxes = [...document.querySelectorAll(".segment-list input[type=checkbox]")];
        const exportButton = [...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "Export");
        return checkboxes.length === 2 && checkboxes[0].checked === false && checkboxes[1].checked === true
          ? { checked: checkboxes.map((checkbox) => checkbox.checked), exportDisabled: exportButton?.disabled ?? null }
          : false;
      })()`,
      10_000,
      "one remaining checked segment"
    );
    assertPass(oneCheckedState.exportDisabled === false, "Export was disabled while one segment remained checked.", oneCheckedState);
    await clickSelector(cdp, ".segment-list input[type=checkbox]", 1);
    const uncheckedState = await waitFor(
      cdp,
      `(() => {
        const checkboxes = [...document.querySelectorAll(".segment-list input[type=checkbox]")];
        const exportButton = [...document.querySelectorAll("button")].find((button) => (button.innerText || button.title).trim() === "Export");
        const exportTsButton = [...document.querySelectorAll("button")].find((button) => (button.innerText || button.title).trim() === "Export TS");
        return checkboxes.length === 2 && checkboxes.every((checkbox) => checkbox.checked === false)
          ? { checked: checkboxes.map((checkbox) => checkbox.checked), exportDisabled: exportButton?.disabled ?? null, exportTsDisabled: exportTsButton?.disabled ?? null }
          : false;
      })()`,
      10_000,
      "checkbox exclusion"
    );
    assertPass(uncheckedState.exportDisabled === true, "Unchecked segment did not disable export when no rows remain checked.", uncheckedState);
    assertPass(uncheckedState.exportTsDisabled === true, "Unchecked segment did not disable TS export when no rows remain checked.", uncheckedState);
    log("CHECKBOX_EXCLUDE_OK", uncheckedState);
    await clickSelector(cdp, ".segment-list input[type=checkbox]", 0);
    await waitFor(
      cdp,
      `(() => {
        const checkboxes = [...document.querySelectorAll(".segment-list input[type=checkbox]")];
        return checkboxes.length === 2 && checkboxes[0].checked === true && checkboxes[1].checked === false;
      })()`,
      10_000,
      "first checkbox re-enable"
    );

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
        reviewItems[0].includes("01_guide-001.mp4"),
      "Export review did not list the checked guided segment title, ID, and filename.",
      reviewItems
    );
    log("EXPORT_REVIEW_OK", reviewItems);

    const exportOptionsChanged = await evaluate(
      cdp,
      `(() => {
        const input = document.querySelector(".output-template-field input");
        const checkbox = document.querySelector(".output-folder-option input[type=checkbox]");
        if (!input || !checkbox) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "{index}_{id}");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (!checkbox.checked) checkbox.click();
        return true;
      })()`
    );
    assertPass(exportOptionsChanged, "Export filename template or source-folder option was unavailable.");
    const customizedExport = await waitFor(
      cdp,
      `(() => {
        const row = document.querySelector(".output-row");
        const input = document.querySelector(".output-template-field input");
        const checkbox = document.querySelector(".output-folder-option input[type=checkbox]");
        const folder = localStorage.getItem(${JSON.stringify(editorSettingStorageKeys.createSourceFolder)});
        return row?.innerText.includes("01_guide-001.mp4") && checkbox?.checked && input?.value === "{index}_{id}" && folder === "true"
          ? { row: row.innerText, template: input.value, folder }
          : false;
      })()`,
      5000,
      "customized export filename and source folder"
    );
    log("EXPORT_NAMING_OPTIONS_OK", customizedExport);
    const customizedProject = await waitForJsonFile(
      sidecarPath,
      (document) => document.settings?.export?.filename_template === "{index}_{id}",
      10_000,
      "project-specific export filename template"
    );
    assertPass(
      await evaluate(cdp, `localStorage.getItem("songcut:filename-template") === null`),
      "The project-specific filename template was still written to renderer local storage."
    );
    log("EXPORT_NAMING_PROJECT_SETTING_OK", {
      revision: customizedProject.revision,
      template: customizedProject.settings.export.filename_template
    });
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

    const transcriptionTerminal = await waitFor(
      cdp,
      `(async () => {
        const baseUrl = await window.songcut.apiBaseUrl();
        const jobs = await Promise.all(
          ${JSON.stringify(backgroundTranscription)}.map(async (id) => {
            const response = await fetch(baseUrl + "/jobs/" + id);
            return response.ok ? response.json() : null;
          })
        );
        const transcription = jobs.find((job) => job?.kind === "transcription");
        return transcription && ["completed", "failed"].includes(transcription.status) ? transcription : false;
      })()`,
      240_000,
      "background transcription completion"
    );
    assertPass(
      transcriptionTerminal.status === "completed",
      "Background transcription failed before export.",
      transcriptionTerminal
    );
    const transcriptChunks = transcriptionTerminal.result?.transcripts?.flatMap((entry) => entry.chunks || []) || [];
    assertPass(
      transcriptChunks.every(
        (chunk) => Number.isFinite(chunk.start) && Number.isFinite(chunk.end) && chunk.start >= 0 && chunk.end >= chunk.start
      ),
      "Background transcription returned invalid chunk bounds.",
      transcriptChunks
    );
    log("BACKGROUND_TRANSCRIPTION_COMPLETED_OK", transcriptionTerminal);
    log("BACKGROUND_TRANSCRIPTION_CHUNK_BOUNDS_OK", transcriptChunks);

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
    const sourceOutputDir = path.join(outputDir, path.parse(input).name);
    const exported = await waitForExportedFile(sourceOutputDir);
    assertPass(
      exported.some((file) => file.name === "01_guide-001.mp4"),
      "Exported video filename did not reflect the customized template.",
      exported
    );
    const exportedPath = path.join(sourceOutputDir, exported[0].name);
    const duration = probeDuration(exportedPath);
    if (!(duration > 0.2 && duration < 2.5)) {
      throw new Error(`Unexpected exported duration: ${duration}`);
    }
    log("EXPORT_OK", { exported, duration });
    const tsCommentPath = path.join(sourceOutputDir, "ts_comments.txt");
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
