import { spawn } from "node:child_process";

const FONT_QUERY =
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
  "Add-Type -AssemblyName System.Drawing; " +
  "(New-Object System.Drawing.Text.InstalledFontCollection).Families | " +
  "ForEach-Object Name | Sort-Object -Unique | ConvertTo-Json -Compress";

let cachedFonts: string[] | null = null;

/** `listSystemFonts`で利用可能な候補をplatformまたは状態から列挙して返す。 */
export async function listSystemFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts;
  const output = await runPowerShell(FONT_QUERY);
  const parsed: unknown = JSON.parse(output.trim() || "[]");
  const values = Array.isArray(parsed) ? parsed : [parsed];
  cachedFonts = [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))]
    .sort((left, right) => left.localeCompare(right));
  return cachedFonts;
}

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Font enumeration exited with ${code ?? "unknown"}.`));
    });
  });
}
