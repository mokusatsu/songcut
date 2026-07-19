const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const root = process.env.SONGCUT_E2E_PACKAGE_ROOT
  ? path.resolve(process.env.SONGCUT_E2E_PACKAGE_ROOT)
  : path.join(repo, "dist", "songcut-win-x64");
const out = path.join(repo, "out", "e2e-scratch-proxy");
const ffmpeg = path.join(repo, "third_party", "ffmpeg", "bin", "ffmpeg.exe");
const inputs = {
  aac: path.join(out, "scratch-aac.mp4"),
  opus: path.join(out, "scratch-opus.webm")
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function log(message, details) {
  console.log(details === undefined ? message : `${message} ${JSON.stringify(details)}`);
}

function assertPass(condition, message, details) {
  if (!condition) throw new Error(`${message}${details === undefined ? "" : ` ${JSON.stringify(details)}`}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createInputs() {
  for (const [codec, target] of Object.entries(inputs)) {
    const audioArgs = codec === "aac" ? ["-c:a", "aac", "-b:a", "128k"] : ["-c:a", "libopus", "-b:a", "96k"];
    execFileSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=320x180:r=24:duration=12",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=12",
        "-shortest",
        "-c:v",
        codec === "aac" ? "libx264" : "libvpx-vp9",
        "-pix_fmt",
        "yuv420p",
        ...audioArgs,
        target
      ],
      { cwd: repo, stdio: "inherit" }
    );
  }
}

async function getPage(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page");
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error(`CDP page not found on port ${port}.`);
}

function connect(webSocketUrl) {
  let nextId = 0;
  const pending = new Map();
  const socket = new WebSocket(webSocketUrl);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  };
  return new Promise((resolve, reject) => {
    socket.onerror = reject;
    socket.onopen = () =>
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((innerResolve) => pending.set(id, innerResolve));
        },
        close() {
          socket.close();
        }
      });
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result.result.value;
}

async function waitFor(cdp, expression, timeoutMilliseconds, label) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMilliseconds) {
    last = await evaluate(cdp, expression);
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function prepareRenderer(cdp, enabled, holdCompletedProxyJobs) {
  await evaluate(
    cdp,
    `(() => {
      localStorage.setItem("songcut:scratch-preview-milliseconds", "1000");
      localStorage.setItem("songcut:scratch-audio-proxy-enabled", ${JSON.stringify(String(enabled))});
      location.reload();
      return true;
    })()`
  );
  await waitFor(cdp, `!!window.songcut && !!document.body?.innerText?.includes("Load")`, 20_000, "renderer reload");
  await evaluate(
    cdp,
    `(() => {
      window.__holdScratchProxyJobs = ${Boolean(holdCompletedProxyJobs)};
      window.__scratchProxyRequests = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const request = args[0];
        const init = args[1] || {};
        const url = typeof request === "string" ? request : request.url;
        const method = String(init.method || (typeof request === "string" ? "GET" : request.method) || "GET").toUpperCase();
        if (url.includes("/scratch-proxy") || url.includes("/scratch-proxies")) {
          window.__scratchProxyRequests.push({ method, url });
        }
        const response = await originalFetch(...args);
        if (window.__holdScratchProxyJobs && method === "GET" && url.includes("/jobs/") && response.ok) {
          const job = await response.clone().json();
          if (job.kind === "scratch-proxy" && job.status === "completed") {
            return new Response(JSON.stringify({ ...job, status: "running", progress: 0.98 }), {
              status: response.status,
              headers: { "content-type": "application/json" }
            });
          }
        }
        return response;
      };
      return true;
    })()`
  );
}

async function clickLoad(cdp) {
  const clicked = await evaluate(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.innerText.trim() === "Load");
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  assertPass(clicked, "Load button was not found.");
  await waitFor(
    cdp,
    `(() => { const video = document.querySelector("video"); return video && Number.isFinite(video.duration) && video.duration > 0; })()`,
    30_000,
    "video metadata"
  );
}

async function proxyState(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const video = document.querySelector("video");
      const audio = document.querySelector("audio[data-scratch-proxy-state]");
      return {
        state: audio?.dataset.scratchProxyState || null,
        videoActive: video?.dataset.scratchPreviewActive || "false",
        audioActive: audio?.dataset.scratchPreviewActive || "false",
        videoPaused: video?.paused ?? null,
        audioPaused: audio?.paused ?? null,
        videoTime: video?.currentTime ?? null,
        audioTime: audio?.currentTime ?? null,
        videoDuration: video?.duration ?? null,
        audioDuration: audio?.duration ?? null,
        proxyRequests: window.__scratchProxyRequests || []
      };
    })()`
  );
}

async function beginScratch(cdp, ratio) {
  const point = await evaluate(
    cdp,
    `(() => {
      const timeline = document.querySelector(".waveform-timeline");
      if (!timeline) return null;
      const rect = timeline.getBoundingClientRect();
      return { x: rect.left + rect.width * ${ratio}, y: rect.top + rect.height / 2 };
    })()`
  );
  assertPass(point, "Waveform timeline was not found.");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await sleep(150);
  return point;
}

async function moveScratch(cdp, ratio) {
  const point = await evaluate(
    cdp,
    `(() => {
      const rect = document.querySelector(".waveform-timeline")?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width * ${ratio}, y: rect.top + rect.height / 2 } : null;
    })()`
  );
  assertPass(point, "Waveform timeline disappeared during scratch.");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "left", buttons: 1 });
  await sleep(150);
}

async function endScratch(cdp, point) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
}

async function assertOriginalScratch(cdp, label) {
  const point = await beginScratch(cdp, 0.25);
  const first = await proxyState(cdp);
  assertPass(
    first.videoActive === "true" && first.audioActive === "false" && first.videoPaused === false,
    `${label}: original media did not play during scratch.`,
    first
  );
  await moveScratch(cdp, 0.7);
  const moved = await proxyState(cdp);
  assertPass(
    moved.videoActive === "true" && moved.videoTime > first.videoTime + 3,
    `${label}: replacement scratch did not cancel and jump to the new original-media position.`,
    { first, moved }
  );
  await endScratch(cdp, point);
  await sleep(1200);
  const stopped = await proxyState(cdp);
  assertPass(stopped.videoPaused === true && stopped.videoActive === "false", `${label}: scratch did not stop.`, stopped);
  log(`${label}_ORIGINAL_OK`, { first, moved, stopped });
}

async function assertProxyScratch(cdp) {
  const point = await beginScratch(cdp, 0.3);
  const first = await proxyState(cdp);
  assertPass(
    first.audioActive === "true" && first.videoActive === "false" && first.audioPaused === false && first.videoPaused === true,
    "Ready proxy was not selected for scratch.",
    first
  );
  assertPass(Math.abs(first.videoTime - first.audioTime) < 0.4, "Proxy and visible cursor positions diverged.", first);
  await moveScratch(cdp, 0.65);
  const moved = await proxyState(cdp);
  assertPass(
    moved.audioActive === "true" && moved.audioTime > first.audioTime + 3 && Math.abs(moved.videoTime - moved.audioTime) < 0.4,
    "Replacement proxy scratch did not cancel and jump to the new position.",
    { first, moved }
  );
  await endScratch(cdp, point);
  await sleep(1200);
  const stopped = await proxyState(cdp);
  assertPass(stopped.audioPaused === true && stopped.audioActive === "false", "Proxy scratch did not stop.", stopped);
  log("OPUS_PROXY_OK", { first, moved, stopped });
}

async function runCase(codec, port) {
  const userData = path.join(out, `user-data-${codec}`);
  const env = {
    ...process.env,
    SONGCUT_E2E_VIDEO: inputs[codec],
    SONGCUT_E2E_USER_DATA_DIR: userData
  };
  const processHandle = spawn(path.join(root, "songcut.exe"), [`--remote-debugging-port=${port}`], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  processHandle.stdout.on("data", (data) => log(`[${codec}-out] ${data.toString().trim()}`));
  processHandle.stderr.on("data", (data) => log(`[${codec}-err] ${data.toString().trim()}`));

  let cdp;
  try {
    const page = await getPage(port);
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await waitFor(cdp, `!!window.songcut && !!document.body?.innerText?.includes("Load")`, 30_000, `${codec} initial render`);
    await prepareRenderer(cdp, true, codec === "opus");
    await clickLoad(cdp);

    if (codec === "aac") {
      await waitFor(cdp, `document.querySelector("audio")?.dataset.scratchProxyState === "original"`, 10_000, "AAC original state");
      const state = await proxyState(cdp);
      assertPass(state.proxyRequests.length === 0 && !state.audioDuration, "AAC input unexpectedly created a proxy.", state);
      await assertOriginalScratch(cdp, "AAC");
      return;
    }

    await waitFor(cdp, `document.querySelector("audio")?.dataset.scratchProxyState === "preparing"`, 10_000, "held Opus proxy");
    await assertOriginalScratch(cdp, "OPUS_PRE_READY");
    await evaluate(cdp, `window.__holdScratchProxyJobs = false; true`);
    await waitFor(cdp, `document.querySelector("audio")?.dataset.scratchProxyState === "ready"`, 30_000, "Opus proxy ready");
    const ready = await proxyState(cdp);
    assertPass(ready.proxyRequests.some((request) => request.method === "POST"), "Opus proxy API was not requested.", ready);
    assertPass(ready.audioDuration > 11.5, "Loaded proxy duration is invalid.", ready);
    await assertProxyScratch(cdp);

    await prepareRenderer(cdp, false, false);
    await clickLoad(cdp);
    await waitFor(cdp, `document.querySelector("audio")?.dataset.scratchProxyState === "disabled"`, 10_000, "disabled proxy state");
    const disabled = await proxyState(cdp);
    assertPass(disabled.proxyRequests.length === 0 && !disabled.audioDuration, "Disabled setting still prepared a proxy.", disabled);
    await assertOriginalScratch(cdp, "OPUS_DISABLED");
  } finally {
    try {
      cdp?.close();
    } catch {}
    try {
      execFileSync("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  }
}

(async () => {
  createInputs();
  await runCase("aac", Number(process.env.SONGCUT_E2E_AAC_PORT || 9231));
  await runCase("opus", Number(process.env.SONGCUT_E2E_OPUS_PORT || 9232));
  log("SCRATCH_PROXY_E2E_OK");
})().catch((error) => {
  log("SCRATCH_PROXY_E2E_FAIL", { message: error.message, stack: error.stack });
  process.exitCode = 1;
});
