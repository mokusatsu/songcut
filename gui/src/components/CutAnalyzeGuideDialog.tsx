import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { tr } from "@/i18n";

/**
 * The guide editor is a normal-focus modal.  Escape is a cancel action, but
 * only after the browser has finished an IME composition and only when no
 * child handler has already consumed the event.
 */
export type AnalyzeGuideEscapeEvent = {
  key: string;
  defaultPrevented: boolean;
  isComposing: boolean;
  keyCode: number;
};

/** `Escape` がガイド確認Dialogの取消として扱えるイベントか判定する。 */
export function shouldCancelAnalyzeGuideOnEscape(event: AnalyzeGuideEscapeEvent): boolean {
  return event.key === "Escape"
    && !event.defaultPrevented
    && !event.isComposing
    && event.keyCode !== 229;
}

export type CutAnalyzeGuideDialogProps = {
  open: boolean;
  guideText: string;
  onCancel: () => void;
  onConfirm: (guideText: string) => void;
};

/**
 * Confirm the timestamp guide immediately before Cut analysis.
 *
 * `guideText` is intentionally read only when the modal is opened.  The
 * draft can then diverge while the user edits; a cancel leaves the persisted
 * value untouched and a confirm sends the latest draft to the parent.
 */
/** `CutAnalyzeGuideDialog`の画面要素を描画し、ガイドテキストを確定または取消する。 */
export function CutAnalyzeGuideDialog(props: CutAnalyzeGuideDialogProps) {
  const [draft, setDraft] = useState(props.guideText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setDraft(props.guideText);
    // Deliberately reset only on a new opening.  A saved-value update from the
    // parent while the user is typing must not overwrite the current draft.
  }, [props.open]);

  // Dialog's shared initial focus is its close button.  The guide textarea is
  // the primary control here, so move focus to it after the dialog scope has
  // mounted while retaining normal Tab behavior for the remaining controls.
  useEffect(() => {
    if (!props.open) return;
    textareaRef.current?.focus();
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (!shouldCancelAnalyzeGuideOnEscape({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing,
        keyCode: event.keyCode,
      })) return;
      event.preventDefault();
      props.onCancel();
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [props.open, props.onCancel]);

  const handleTextareaKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // The document listener handles Escape from every normal-focus control.
    // Keep this guard explicit so a consumer handler that prevented the event
    // or an IME composition can never turn Escape into a cancel/commit.
    if (event.key === "Escape" && shouldCancelAnalyzeGuideOnEscape({
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    })) {
      event.preventDefault();
      props.onCancel();
    }
  };

  return (
    <Dialog open={props.open} title={tr("common.analyze")} onClose={props.onCancel}>
      <div className="cut-analyze-guide-dialog-content">
        <label htmlFor="cut-analyze-guide-text">{tr("app.guideLabel")}</label>
        <Textarea
          ref={textareaRef}
          id="cut-analyze-guide-text"
          value={draft}
          placeholder={tr("app.guidePlaceholder")}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleTextareaKeyDown}
        />
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={props.onCancel}>{tr("common.cancel")}</Button>
        <Button onClick={() => props.onConfirm(draft)}>{tr("common.analyze")}</Button>
      </div>
    </Dialog>
  );
}
