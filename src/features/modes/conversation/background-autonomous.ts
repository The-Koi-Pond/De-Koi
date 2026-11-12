import { useBackgroundAutonomousPolling } from "./hooks/autonomous/use-background-autonomous";

export function BackgroundAutonomousPollingHost() {
  useBackgroundAutonomousPolling();
  return null;
}
