const DRAFT_PERSISTENCE_FAILURE_EVENT = "de-koi:draft-persistence-failure";

export type DraftPersistenceFailureDetail = {
  domain: string;
  operation: "load" | "save" | "clear";
  message: string;
};

const LAST_NOTIFY_BY_KEY = new Map<string, number>();
const NOTIFY_COOLDOWN_MS = 10_000;

function toFailureMessage(domain: string, operation: DraftPersistenceFailureDetail["operation"]) {
  const verb = operation === "load" ? "restore" : operation === "clear" ? "clear" : "save";
  return `Couldn't ${verb} ${domain}. Drafts may only be kept until De-Koi closes.`;
}

export function notifyDraftPersistenceFailure(
  domain: string,
  operation: DraftPersistenceFailureDetail["operation"],
  error?: unknown,
) {
  if (typeof window === "undefined") return;
  const key = `${domain}:${operation}`;
  const now = Date.now();
  if (now - (LAST_NOTIFY_BY_KEY.get(key) ?? 0) < NOTIFY_COOLDOWN_MS) return;
  LAST_NOTIFY_BY_KEY.set(key, now);
  if (error) console.warn(toFailureMessage(domain, operation), error);
  window.dispatchEvent(
    new CustomEvent<DraftPersistenceFailureDetail>(DRAFT_PERSISTENCE_FAILURE_EVENT, {
      detail: { domain, operation, message: toFailureMessage(domain, operation) },
    }),
  );
}

export function listenDraftPersistenceFailures(handler: (detail: DraftPersistenceFailureDetail) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<DraftPersistenceFailureDetail>).detail);
  window.addEventListener(DRAFT_PERSISTENCE_FAILURE_EVENT, listener);
  return () => window.removeEventListener(DRAFT_PERSISTENCE_FAILURE_EVENT, listener);
}