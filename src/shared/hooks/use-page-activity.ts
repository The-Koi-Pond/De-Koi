import { useEffect, useState } from "react";

function getIsPageActive() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

export function usePageActivity() {
  const [isPageActive, setIsPageActive] = useState(getIsPageActive);

  useEffect(() => {
    const updatePageActivity = () => setIsPageActive(getIsPageActive());

    updatePageActivity();
    document.addEventListener("visibilitychange", updatePageActivity);
    window.addEventListener("pageshow", updatePageActivity);

    return () => {
      document.removeEventListener("visibilitychange", updatePageActivity);
      window.removeEventListener("pageshow", updatePageActivity);
    };
  }, []);

  return isPageActive;
}
