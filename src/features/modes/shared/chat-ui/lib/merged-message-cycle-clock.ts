const CYCLE_INTERVAL_MS = 2_000;

type CycleSubscriber = (tick: number) => void;

const subscribers = new Set<CycleSubscriber>();
let interval: ReturnType<typeof setInterval> | null = null;
let tick = 0;

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    stopClock();
  } else if (subscribers.size > 0) {
    startClock();
  }
}

function startClock() {
  if (interval !== null) return;
  interval = setInterval(() => {
    tick += 1;
    subscribers.forEach((subscriber) => subscriber(tick));
  }, CYCLE_INTERVAL_MS);
}

function stopClock() {
  if (interval === null) return;
  clearInterval(interval);
  interval = null;
}

export function subscribeMergedMessageCycle(subscriber: CycleSubscriber): () => void {
  const isFirstSubscriber = subscribers.size === 0;
  subscribers.add(subscriber);
  if (isFirstSubscriber) document.addEventListener("visibilitychange", handleVisibilityChange);
  if (document.visibilityState !== "hidden") startClock();

  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      stopClock();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      tick = 0;
    }
  };
}
