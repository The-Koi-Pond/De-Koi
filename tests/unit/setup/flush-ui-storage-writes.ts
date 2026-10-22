import { afterAll } from "vitest";
import { flushPendingUiStorageWrites } from "../../../src/shared/stores/ui/pending-ui-storage-writes";

// A UI store change saves to localStorage one second later. When a test file ended inside that second, the timer
// fired after jsdom was torn down and Vitest failed the run with "localStorage is not defined". Save it now instead.
afterAll(() => {
  if (typeof localStorage !== "undefined") flushPendingUiStorageWrites();
});
