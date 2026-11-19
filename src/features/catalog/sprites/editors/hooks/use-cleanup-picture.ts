import { useCallback, useEffect, useRef, useState } from "react";

import { loadUrlBlob } from "../../../../../shared/lib/url-blob";
import { decodePicture } from "../browser/picture-canvas";
import { CLEANUP_TEXT } from "../lib/cleanup-text";
import { EMPTY_HISTORY, recordChange, redoChange, undoChange, type EditHistory } from "../lib/history";
import { samePixels, type RgbaPicture } from "../lib/picture";

/** The picture being cleaned: as opened (`original`), as it is now (`current`), and the steps between. */
export interface EditorPicture {
  original: RgbaPicture;
  current: RgbaPicture;
  history: EditHistory;
  hasChanges: boolean;
}

export type LoadPhase = "loading" | "ready" | "failed";

/**
 * Loads the sprite once per open (and on Try again) and keeps its edit history, the status line and the error line.
 * `pictureRef` always holds the latest picture so pointer handlers can read it between renders.
 */
export function useCleanupPicture(imageUrl: string) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [picture, setPictureState] = useState<EditorPicture | null>(null);
  const pictureRef = useRef<EditorPicture | null>(null);
  const [status, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const setPicture = useCallback((next: EditorPicture | null) => {
    pictureRef.current = next;
    setPictureState(next);
  }, []);

  useEffect(() => {
    let current = true;
    setPhase("loading");
    setError(null);
    setPicture(null);
    loadUrlBlob(imageUrl)
      .then(decodePicture)
      .then(
        (loaded) => {
          if (!current) return;
          setPicture({ original: loaded, current: loaded, history: EMPTY_HISTORY, hasChanges: false });
          setPhase("ready");
        },
        () => {
          if (!current) return;
          setError(CLEANUP_TEXT.loadFailed);
          setPhase("failed");
        },
      );
    return () => {
      current = false;
    };
  }, [imageUrl, loadAttempt, setPicture]);

  /** Shows a status; `clearsError` is false for the texts that leave an error showing. */
  const setStatus = useCallback((text: string, clearsError = true) => {
    setStatusText(text);
    if (clearsError) setError(null);
  }, []);

  /** A wand click or stroke changed the picture: one undo step. */
  const commitChange = useCallback(
    (before: RgbaPicture, next: RgbaPicture, statusText: string) => {
      const editing = pictureRef.current;
      if (!editing) return;
      setPicture({ ...editing, current: next, history: recordChange(editing.history, before), hasChanges: true });
      setStatus(statusText);
    },
    [setPicture, setStatus],
  );

  const stepHistory = useCallback(
    (direction: "undo" | "redo") => {
      const editing = pictureRef.current;
      if (!editing) return;
      const move =
        direction === "undo"
          ? undoChange(editing.history, editing.current)
          : redoChange(editing.history, editing.current);
      if (!move) return;
      setPicture({
        ...editing,
        current: move.picture,
        history: move.history,
        hasChanges: !samePixels(move.picture, editing.original),
      });
      setStatus(direction === "undo" ? CLEANUP_TEXT.undo : CLEANUP_TEXT.redo);
    },
    [setPicture, setStatus],
  );

  const undo = useCallback(() => stepHistory("undo"), [stepHistory]);
  const redo = useCallback(() => stepHistory("redo"), [stepHistory]);

  const reset = useCallback(() => {
    const editing = pictureRef.current;
    if (!editing) return;
    setPicture({ original: editing.original, current: editing.original, history: EMPTY_HISTORY, hasChanges: false });
    setStatus(CLEANUP_TEXT.reset);
  }, [setPicture, setStatus]);

  const reload = useCallback(() => setLoadAttempt((attempt) => attempt + 1), []);

  return {
    phase,
    picture,
    pictureRef,
    status,
    error,
    setStatus,
    setError,
    commitChange,
    undo,
    redo,
    reset,
    reload,
  };
}
