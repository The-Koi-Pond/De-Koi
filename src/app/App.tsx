import { lazy, Suspense } from "react";

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
  return (
    <Suspense fallback={<BootShellFallback />}>
      <AppExperience />
    </Suspense>
  );
}
