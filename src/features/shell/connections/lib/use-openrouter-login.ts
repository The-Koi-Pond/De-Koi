import { useCallback, useEffect, useRef, useState } from "react";
import { connectionCommandApi, type OpenRouterLoginMode } from "../../../../shared/api/connection-command-api";
import { openExternalUrl } from "../../../../shared/api/external-link-api";
import { storageApi } from "../../../../shared/api/storage-api";
import { updateConnectionSchema } from "../../../../engine/contracts/schemas/connection.schema";
import { toUserMessage } from "../../../../shared/lib/error-message";
import { useSetupJourneyStore } from "../../../../shared/stores/setup-journey.store";
import { useUIStore } from "../../../../shared/stores/ui.store";
import {
  OPENROUTER_FREE_ROUTER_MODEL,
  pickOpenRouterStarterModel,
  type StarterModelCandidate,
} from "../../../../engine/onboarding/openrouter-starter-model";
import { useRefreshConnection, type ConnectionTestResult } from "../../../catalog/connections";
import { restoreSetupJourneyFocus } from "../../onboarding/shell";

const STATUS_POLL_MS = 1500;

export type OpenRouterLoginPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "waiting";
      mode: OpenRouterLoginMode;
      authUrl: string;
      loginId: string;
      connectionId: string;
      /** The browser couldn't be opened for the user, so they need the link on screen. */
      browserOpenFailed: boolean;
      codeError: string | null;
      submittingCode: boolean;
    }
  | { kind: "finishing"; connectionId: string }
  | {
      kind: "done";
      connectionId: string;
      /** Set when the login picked a free model for an empty connection. */
      freeModelName: string | null;
      /** Why setup couldn't count the connection as ready yet, in words that say what to do. */
      note: string | null;
    }
  | { kind: "error"; message: string };

type ModelLookup = { models: StarterModelCandidate[]; fromProvider?: boolean };

/**
 * Runs "Log in with OpenRouter" for one connection: start, wait for the browser (or a pasted code),
 * then give an empty connection a free model and, during setup, check it and move setup along.
 */
export function useOpenRouterLogin() {
  const refreshConnection = useRefreshConnection();
  const [phase, setPhase] = useState<OpenRouterLoginPhase>({ kind: "idle" });
  // Bumped by cancel and unmount so async work from an old login can't overwrite the screen.
  const runRef = useRef(0);
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );

  const finishLogin = useCallback(
    async (run: number, connectionId: string) => {
      setPhase({ kind: "finishing", connectionId });
      try {
        const connection = await storageApi.get<Record<string, unknown>>("connections", connectionId);
        const currentModel = typeof connection?.model === "string" ? connection.model.trim() : "";
        let freeModelName: string | null = null;
        let hasModel = currentModel.length > 0;
        if (!hasModel) {
          const lookup = await connectionCommandApi.models<ModelLookup>(connectionId);
          // The router is OpenRouter's own free model, so it is still a safe start when the list couldn't load.
          const pick =
            pickOpenRouterStarterModel(lookup.models) ??
            (lookup.fromProvider
              ? null
              : { id: OPENROUTER_FREE_ROUTER_MODEL, name: "Free Models Router", context: null });
          if (pick) {
            await storageApi.update(
              "connections",
              connectionId,
              updateConnectionSchema.parse({ model: pick.id, ...(pick.context ? { maxContext: pick.context } : {}) }),
            );
            freeModelName = pick.name;
            hasModel = true;
          }
        }
        await refreshConnection(connectionId);
        if (run !== runRef.current) return;

        let note: string | null = hasModel
          ? null
          : "OpenRouter has no free models listed right now. Open the connection and pick a model.";
        const setup = useSetupJourneyStore.getState();
        if (hasModel && setup.intent && !setup.intent.completed) {
          const test = await connectionCommandApi.test<ConnectionTestResult>(connectionId);
          if (run !== runRef.current) return;
          if (test.success) {
            setup.markConnectionTested(connectionId);
            const ui = useUIStore.getState();
            ui.closeConnectionDetail();
            ui.closeRightPanel();
            restoreSetupJourneyFocus("connection");
          } else {
            note = `The key is saved, but the check didn't pass: ${test.message} Open the connection and press Test Connection.`;
          }
        }
        setPhase({ kind: "done", connectionId, freeModelName, note });
      } catch (error) {
        if (run !== runRef.current) return;
        setPhase({
          kind: "error",
          message: toUserMessage(error, {
            fallback:
              "The key is saved, but De-Koi couldn't finish setting up the connection. Open it and pick a model.",
          }),
        });
      }
    },
    [refreshConnection],
  );

  /** `prepare` saves or creates the OpenRouter connection first and returns its id (null to stop). */
  const start = useCallback(async (prepare: () => Promise<string | null>) => {
    const run = ++runRef.current;
    setPhase({ kind: "starting" });
    try {
      const connectionId = await prepare();
      if (run !== runRef.current) return;
      if (!connectionId) {
        setPhase({ kind: "idle" });
        return;
      }
      const started = await connectionCommandApi.openRouterLoginStart(connectionId);
      if (run !== runRef.current) return;
      let browserOpenFailed = false;
      if (started.mode === "callback") {
        try {
          await openExternalUrl(started.authUrl);
        } catch {
          // Shown as "your browser didn't open" with the link right there.
          browserOpenFailed = true;
        }
      }
      if (run !== runRef.current) return;
      setPhase({
        kind: "waiting",
        mode: started.mode,
        authUrl: started.authUrl,
        loginId: started.loginId,
        connectionId,
        browserOpenFailed,
        codeError: null,
        submittingCode: false,
      });
    } catch (error) {
      if (run !== runRef.current) return;
      setPhase({
        kind: "error",
        message: toUserMessage(error, { fallback: "Couldn't start the OpenRouter login. Try again." }),
      });
    }
  }, []);

  // A browser login finishes on its own; check on it until it does.
  const waitingLoginId = phase.kind === "waiting" && phase.mode === "callback" ? phase.loginId : null;
  const waitingConnectionId = phase.kind === "waiting" ? phase.connectionId : null;
  useEffect(() => {
    if (!waitingLoginId || !waitingConnectionId) return;
    const run = runRef.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const status = await connectionCommandApi.openRouterLoginStatus(waitingLoginId);
        if (stopped || run !== runRef.current) return;
        if (status.status === "done") {
          stopped = true;
          await finishLogin(run, waitingConnectionId);
          return;
        }
        if (status.status === "failed") {
          stopped = true;
          setPhase({ kind: "error", message: status.message });
          return;
        }
      } catch (error) {
        if (stopped || run !== runRef.current) return;
        stopped = true;
        setPhase({
          kind: "error",
          message: toUserMessage(error, { fallback: "Lost track of the OpenRouter login. Start it again." }),
        });
        return;
      }
      timer = setTimeout(check, STATUS_POLL_MS);
    };
    timer = setTimeout(check, STATUS_POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [waitingLoginId, waitingConnectionId, finishLogin]);

  const submitCode = useCallback(
    async (code: string) => {
      if (phase.kind !== "waiting" || phase.mode !== "code" || phase.submittingCode) return;
      const { loginId, connectionId } = phase;
      const run = runRef.current;
      setPhase({ ...phase, submittingCode: true, codeError: null });
      try {
        await connectionCommandApi.openRouterLoginFinish(loginId, code);
      } catch (error) {
        if (run !== runRef.current) return;
        const message = toUserMessage(error, { fallback: "Couldn't finish the login. Start it again." });
        // A spent or expired login can't take another code, so send the user back to the start.
        const status = await connectionCommandApi.openRouterLoginStatus(loginId).catch(() => null);
        if (run !== runRef.current) return;
        setPhase(
          status?.status === "waiting"
            ? { ...phase, submittingCode: false, codeError: message }
            : { kind: "error", message },
        );
        return;
      }
      if (run !== runRef.current) return;
      await finishLogin(run, connectionId);
    },
    [phase, finishLogin],
  );

  const reset = useCallback(() => {
    runRef.current += 1;
    setPhase({ kind: "idle" });
  }, []);

  return { phase, start, submitCode, reset };
}
