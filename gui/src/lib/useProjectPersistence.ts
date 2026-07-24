import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDocumentV1, ProjectSaveStatus, RecoverySnapshot } from "@/lib/project";

export function projectAutoSaveKey(
  projectPath: string,
  document: Pick<ProjectDocumentV1, "project_id" | "revision"> | null
) {
  return document ? `${projectPath}\0${document.project_id}\0${document.revision}` : "";
}

export function useProjectPersistence(
  projectPath: string,
  document: ProjectDocumentV1 | null,
  autoSaveSuspended = false
) {
  const documentRef = useRef(document);
  const projectPathRef = useRef(projectPath);
  const sessionIdRef = useRef(crypto.randomUUID());
  const sidecarErrorRef = useRef<unknown>(null);
  const recoveryErrorRef = useRef<unknown>(null);
  const lastSavedRevisionRef = useRef(-1);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [status, setStatus] = useState<ProjectSaveStatus>(document ? "saving" : "idle");
  const autoSaveKey = projectAutoSaveKey(projectPath, document);

  documentRef.current = document;
  projectPathRef.current = projectPath;

  const refreshStatus = useCallback(() => {
    if (!documentRef.current) return setStatus("idle");
    if (pendingSaveCountRef.current > 0) return setStatus("saving");
    if (sidecarErrorRef.current && recoveryErrorRef.current) return setStatus("save-failed");
    if (sidecarErrorRef.current) return setStatus("recovery-only");
    setStatus("saved");
  }, []);

  const enqueueSave = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    pendingSaveCountRef.current += 1;
    setPendingSaveCount(pendingSaveCountRef.current);
    setStatus("saving");
    const result = saveQueueRef.current.then(operation, operation);
    saveQueueRef.current = result.then(
      () => undefined,
      () => undefined
    );
    return result.finally(() => {
      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
      setPendingSaveCount(pendingSaveCountRef.current);
      refreshStatus();
    });
  }, [refreshStatus]);

  const writeRecovery = useCallback(async (snapshot: RecoverySnapshot) => {
    try {
      await window.songcut.saveRecovery(snapshot);
      recoveryErrorRef.current = null;
    } catch (error) {
      recoveryErrorRef.current = error;
      throw error;
    }
  }, []);

  const writeSidecar = useCallback(async (target: string, current: ProjectDocumentV1) => {
    try {
      await window.songcut.saveProject(target, current);
      sidecarErrorRef.current = null;
      lastSavedRevisionRef.current = current.revision;
    } catch (error) {
      sidecarErrorRef.current = error;
      throw error;
    }
  }, []);

  const createRecoverySnapshot = useCallback(
    (current: ProjectDocumentV1, target: string): RecoverySnapshot => ({
      format: "songcut-recovery",
      schema_version: 1,
      session_id: sessionIdRef.current,
      project_path: target,
      saved_at: new Date().toISOString(),
      document: current,
    }),
    []
  );

  const saveRecoveryNow = useCallback(
    async (documentOverride?: ProjectDocumentV1) => {
      const current = documentOverride ?? documentRef.current;
      if (!current) return;
      const snapshot = createRecoverySnapshot(current, projectPathRef.current);
      return enqueueSave(() => writeRecovery(snapshot));
    },
    [createRecoverySnapshot, enqueueSave, writeRecovery]
  );

  const saveProjectNow = useCallback(async (target: string, current: ProjectDocumentV1) => {
    return enqueueSave(() => writeSidecar(target, current));
  }, [enqueueSave, writeSidecar]);

  const saveSidecarNow = useCallback(async () => {
    const current = documentRef.current;
    const target = projectPathRef.current;
    if (!current || !target) return;
    return saveProjectNow(target, current);
  }, [saveProjectNow]);

  const flush = useCallback(async () => {
    const current = documentRef.current;
    const target = projectPathRef.current;
    if (!current) return { recoverySaved: true, sidecarSaved: true };
    const snapshot = createRecoverySnapshot(current, target);
    return enqueueSave(async () => {
      let recoverySaved = false;
      let sidecarSaved = false;
      try {
        await writeRecovery(snapshot);
        recoverySaved = true;
      } catch {
        // The sidecar may still succeed, so continue the serialized flush.
      }
      if (target) {
        try {
          await writeSidecar(target, current);
          sidecarSaved = true;
        } catch {
          // Report the combined result below.
        }
      } else {
        sidecarSaved = true;
      }
      if (!recoverySaved && !sidecarSaved) {
        throw new Error("The project and recovery snapshot could not be saved.");
      }
      return { recoverySaved, sidecarSaved };
    });
  }, [createRecoverySnapshot, enqueueSave, writeRecovery, writeSidecar]);

  useEffect(() => {
    if (!document) {
      setStatus("idle");
      return;
    }
    if (autoSaveSuspended) return;
    const timer = window.setTimeout(() => void saveRecoveryNow().catch(() => undefined), 250);
    return () => window.clearTimeout(timer);
    // Cursor playback updates replace `document`, but do not change its revision.
    // Recovery autosave follows explicit project revisions in both Cut and Sub.
  }, [autoSaveSuspended, autoSaveKey, saveRecoveryNow]);

  useEffect(() => {
    if (autoSaveSuspended || !document || !projectPath || document.revision === lastSavedRevisionRef.current) return;
    setStatus("saving");
    const timer = window.setTimeout(() => void saveSidecarNow().catch(() => undefined), 750);
    return () => window.clearTimeout(timer);
  }, [autoSaveSuspended, document?.revision, projectPath, saveSidecarNow]);

  const clearRecovery = useCallback(async () => {
    await enqueueSave(async () => {
      await window.songcut.clearRecovery();
      recoveryErrorRef.current = null;
    });
  }, [enqueueSave]);

  return {
    status,
    saving: pendingSaveCount > 0 || status === "saving",
    flush,
    saveProjectNow,
    saveSidecarNow,
    saveRecoveryNow,
    clearRecovery,
  };
}
