import { lazy, Suspense, type ComponentProps } from "react";

// The campaign builder (and its prompts) loads when a campaign card is shown, not with the chat screens.
const CampaignBuildPanelLazy = lazy(() =>
  import("./chat-setup/CampaignBuildPanel").then((module) => ({ default: module.CampaignBuildPanel })),
);

/** Build button and progress for an already-answered campaign request, such as Deki-senpai's card. */
export function CampaignBuildButton(props: ComponentProps<typeof CampaignBuildPanelLazy>) {
  return (
    <Suspense fallback={null}>
      <CampaignBuildPanelLazy {...props} />
    </Suspense>
  );
}
