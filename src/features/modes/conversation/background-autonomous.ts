import { useBackgroundAutonomousPolling } from "./hooks/autonomous/use-background-autonomous";

export { useBackgroundAutonomousPolling };

export function BackgroundAutonomousPollingHost() {
  useBackgroundAutonomousPolling();
  return null;
}