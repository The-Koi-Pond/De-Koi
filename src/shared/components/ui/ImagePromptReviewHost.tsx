import { create } from "zustand";
import {
  ImagePromptReviewModal,
  type ImagePromptOverride,
  type ImagePromptReviewItem,
} from "./ImagePromptReviewModal";

type PromptReviewRequest = {
  id: string;
  items: ImagePromptReviewItem[];
  resolve: (overrides: ImagePromptOverride[] | null) => void;
};

type PromptReviewState = {
  request: PromptReviewRequest | null;
  setRequest: (request: PromptReviewRequest | null) => void;
};

const useImagePromptReviewStore = create<PromptReviewState>((set) => ({
  request: null,
  setRequest: (request) => set({ request }),
}));

export function requestImagePromptReview(items: ImagePromptReviewItem[]): Promise<ImagePromptOverride[] | null> {
  return new Promise((resolve) => {
    const store = useImagePromptReviewStore.getState();
    store.request?.resolve(null);
    store.setRequest({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      items,
      resolve,
    });
  });
}

export function ImagePromptReviewHost() {
  const request = useImagePromptReviewStore((state) => state.request);
  const setRequest = useImagePromptReviewStore((state) => state.setRequest);

  const close = (overrides: ImagePromptOverride[] | null) => {
    const current = useImagePromptReviewStore.getState().request;
    if (!current) return;
    setRequest(null);
    current.resolve(overrides);
  };

  return (
    <ImagePromptReviewModal
      open={request !== null}
      items={request?.items ?? []}
      onCancel={() => close(null)}
      onConfirm={(overrides) => close(overrides)}
    />
  );
}
