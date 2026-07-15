import { lazy, Suspense } from "react";
import { CustomizationSafeMode } from "./CustomizationSafeMode";
import { isCustomizationSafeMode } from "./customization-safe-mode";

const AppExperience = lazy(() =>
  import("./AppExperience").then((module) => ({
    default: module.AppExperience,
  })),
);

function BootShellFallback() {
  return (
    <div className="fixed inset-0 bg-[var(--background)] text-[var(--foreground)]" data-component="BootShellFallback" />
  );
}

export function App() {
  if (isCustomizationSafeMode(window.location)) return <CustomizationSafeMode />;
  return (
    <Suspense fallback={<BootShellFallback />}>
      <AppExperience />
    </Suspense>
  );
}
