import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDocumentV1, ProjectSaveStatus, RecoverySnapshot } from "@/lib/project";

export function useProjectPersistence(projectPath: string, document: ProjectDocumentV1 | null) {
  const documentRef = useRef(document);
  const projectPathRef = useRef(projectPath);
  const sessionIdRef = useRef(crypto.randomUUID());
  const sidecarErrorRef = useRef<unknown>(null);
  const recoveryErrorRef = useRef<unknown>(null);
  const lastSavedRevisionRef = useRef(-1);
  const [status, setStatus] = useState<ProjectSaveStatus>(document ? "saving" : "idle");

  documentRef.current = document;
  projectPathRef.current = projectPath;

  const refreshStatus = useCallback(() => {
    if (!documentRef.current) return setStatus("idle");
    if (sidecarErrorRef.current && recoveryErrorRef.current) return setStatus("save-failed");
    if (sidecarErrorRef.current) return setStatus("recovery-only");
    setStatus("saved");
  }, []);

  const saveRecoveryNow = useCallback(async (documentOverride?: ProjectDocumentV1) => {
    const current = documentOverride ?? documentRef.current;
    if (!current) return;
    const snapshot: RecoverySnapshot = {
      format: "songcut-recovery",
      schema_version: 1,
      session_id: sessionIdRef.current,
      project_path: projectPathRef.current,
      saved_at: new Date().toISOString(),
      document: current,
    };
    try {
      await window.songcut.saveRecovery(snapshot);
      recoveryErrorRef.current = null;
    } catch (error) {
      recoveryErrorRef.current = error;
      throw error;
    } finally {
      refreshStatus();
    }
  }, [refreshStatus]);

  const saveSidecarNow = useCallback(async () => {
    const current = documentRef.current;
    const target = projectPathRef.current;
    if (!current || !target) return;
    setStatus("saving");
    try {
      await window.songcut.saveProject(target, current);
      sidecarErrorRef.current = null;
      lastSavedRevisionRef.current = current.revision;
    } catch (error) {
      sidecarErrorRef.current = error;
      throw error;
    } finally {
      refreshStatus();
    }
  }, [refreshStatus]);

  const flush = useCallback(async () => {
    const results = await Promise.allSettled([saveRecoveryNow(), saveSidecarNow()]);
    refreshStatus();
    if (results.every((result) => result.status === "rejected")) {
      throw new Error("The project and recovery snapshot could not be saved.");
    }
    return {
      recoverySaved: results[0].status === "fulfilled",
      sidecarSaved: results[1].status === "fulfilled",
    };
  }, [refreshStatus, saveRecoveryNow, saveSidecarNow]);

  useEffect(() => {
    if (!document) {
      setStatus("idle");
      return;
    }
    const timer = window.setTimeout(() => void saveRecoveryNow().catch(() => undefined), 250);
    return () => window.clearTimeout(timer);
  }, [document, saveRecoveryNow]);

  useEffect(() => {
    if (!document || !projectPath || document.revision === lastSavedRevisionRef.current) return;
    setStatus("saving");
    const timer = window.setTimeout(() => void saveSidecarNow().catch(() => undefined), 750);
    return () => window.clearTimeout(timer);
  }, [document?.revision, projectPath, saveSidecarNow]);

  const clearRecovery = useCallback(async () => {
    await window.songcut.clearRecovery();
    recoveryErrorRef.current = null;
  }, []);

  return { status, flush, saveSidecarNow, saveRecoveryNow, clearRecovery };
}
