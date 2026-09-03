import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ChatSetupWizard } from "./ChatSetupWizard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatSetupWizard Roleplay exits", () => {
  it("uses cancel rather than finish when the backdrop dismisses setup", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const finish = vi.fn();
    const cancel = vi.fn();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatSetupWizard
            chat={{ id: "chat-1", mode: "roleplay", metadata: "{}" } as never}
            onFinish={finish}
            onCancel={cancel}
          />
        </QueryClientProvider>,
      );
    });

    act(() => {
      container.querySelector<HTMLDivElement>(".absolute.inset-0.z-40")?.click();
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });
});
