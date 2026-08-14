export type MediaPlaybackResult =
  | { status: "started" }
  | { status: "cancelled" }
  | { status: "failed"; error: unknown };

type CoordinatedMedia = Pick<HTMLMediaElement, "pause" | "paused" | "play">;

/** 同じ媒体またはスクラッチ用audioに対する非同期再生要求を順番に実行する。 */
export class MediaPlaybackCoordinator {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();

  /** 新しい再生要求を登録し、古い停止済み要求より後に実行する。 */
  request(media: CoordinatedMedia): Promise<MediaPlaybackResult> {
    const generation = ++this.generation;
    const request: Promise<MediaPlaybackResult> = this.tail.then(async (): Promise<MediaPlaybackResult> => {
      if (generation !== this.generation) return { status: "cancelled" } as const;
      try {
        await media.play();
      } catch (error) {
        return generation === this.generation
          ? { status: "failed", error }
          : { status: "cancelled" };
      }
      return generation === this.generation && !media.paused
        ? { status: "started" }
        : { status: "cancelled" };
    });
    this.tail = request.then(() => undefined, () => undefined);
    return request;
  }

  /** 保留中の再生要求を無効化してから、対象媒体を停止する。 */
  pause(media: CoordinatedMedia | null | undefined) {
    this.generation += 1;
    media?.pause();
  }
}
