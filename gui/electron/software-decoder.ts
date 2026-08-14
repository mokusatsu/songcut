/**
 * One-shot Chromium decoder selection used by the Electron main process.
 *
 * The flag is deliberately kept in the process arguments rather than in
 * persisted settings.  That makes a software-decoder restart apply to the
 * relaunched session only; a later normal launch starts in the default mode.
 */
export const SOFTWARE_DECODER_RELAUNCH_FLAG = "--songcut-software-decoder";
export const SOFTWARE_DECODER_RESUME_ARG_PREFIX = `${SOFTWARE_DECODER_RELAUNCH_FLAG}-resume=`;
export const SOFTWARE_DECODER_RESTART_EXIT_CODE = 75;
export const SOFTWARE_DECODER_RESTART_REQUEST_ENV = "SONGCUT_LAUNCHER_RESTART_REQUEST";

export type DecoderMode = "hardware" | "software";

export type SoftwareDecoderResumeSession = {
  projectPath?: string;
  videoPath?: string;
};

/** `hasSoftwareDecoderFlag`で、このプロセスが一回限りのソフトウェアデコーダ起動かを判定する。 */
export function hasSoftwareDecoderFlag(args: readonly string[]): boolean {
  return args.includes(SOFTWARE_DECODER_RELAUNCH_FLAG);
}

/** `decoderModeForArgs`で、起動引数から診断用デコーダモードを決定する。 */
export function decoderModeForArgs(args: readonly string[]): DecoderMode {
  return hasSoftwareDecoderFlag(args) ? "software" : "hardware";
}

/** `normalizeSoftwareDecoderResumeSession`で、再起動後に復元可能なパスだけを保持する。 */
export function normalizeSoftwareDecoderResumeSession(value: unknown): SoftwareDecoderResumeSession | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { projectPath?: unknown; videoPath?: unknown };
  const session: SoftwareDecoderResumeSession = {};
  if (typeof row.projectPath === "string" && row.projectPath.length > 0) session.projectPath = row.projectPath;
  if (typeof row.videoPath === "string" && row.videoPath.length > 0) session.videoPath = row.videoPath;
  return session.projectPath || session.videoPath ? session : null;
}

/** `encodeSoftwareDecoderResumeSession`で、再開セッションをコマンドライン安全なUTF-8 base64urlに符号化する。 */
export function encodeSoftwareDecoderResumeSession(value: unknown): string | null {
  const session = normalizeSoftwareDecoderResumeSession(value);
  if (!session) return null;
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

/** `decodeSoftwareDecoderResumeSession`で、破損または未指定の値を無視しつつ再開引数を復号する。 */
export function decodeSoftwareDecoderResumeSession(args: readonly string[]): SoftwareDecoderResumeSession | null {
  if (!hasSoftwareDecoderFlag(args)) return null;
  const encoded = args.find((arg) => arg.startsWith(SOFTWARE_DECODER_RESUME_ARG_PREFIX));
  if (!encoded) return null;
  const payload = encoded.slice(SOFTWARE_DECODER_RESUME_ARG_PREFIX.length);
  if (!payload) return null;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    return normalizeSoftwareDecoderResumeSession(JSON.parse(decoded));
  } catch {
    return null;
  }
}

/**
 * `createSoftwareDecoderResumeSessionReader`で、起動後にrendererへ公開する一回限りの読取関数を作る。
 * コマンドラインpayloadは最初の読取で消費し、永続化しない。
 */
export function createSoftwareDecoderResumeSessionReader(args: readonly string[]) {
  let session = decodeSoftwareDecoderResumeSession(args);
  return (): SoftwareDecoderResumeSession | null => {
    const current = session;
    session = null;
    return current;
  };
}

/**
 * `buildSoftwareDecoderRelaunchArgs`で、ソフトウェアデコーダセッション用のapp.relaunch引数を組み立てる。
 *
 * Electronは実行ファイルパスを含まない引数を受け取る。呼び出し元は
 * `process.argv.slice(1)`を渡し、この関数は重複した一回限りの引数以外を保持して
 * フラグをちょうど一つ追加する。
 */
export function buildSoftwareDecoderRelaunchArgs(
  args: readonly string[],
  resumeSession: unknown = null,
): string[] {
  const resumePayload = encodeSoftwareDecoderResumeSession(resumeSession);
  return [
    ...args.filter(
      (arg) => arg !== SOFTWARE_DECODER_RELAUNCH_FLAG && !arg.startsWith(SOFTWARE_DECODER_RESUME_ARG_PREFIX),
    ),
    SOFTWARE_DECODER_RELAUNCH_FLAG,
    ...(resumePayload ? [`${SOFTWARE_DECODER_RESUME_ARG_PREFIX}${resumePayload}`] : []),
  ];
}
