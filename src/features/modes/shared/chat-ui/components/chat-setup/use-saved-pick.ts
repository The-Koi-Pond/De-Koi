import { useEffect, useState } from "react";

/**
 * A pick setup saves at once. It shows the new value straight away and follows the saved value whenever that
 * changes (the save landing, a rollback, or another surface editing the chat). `savedKey` identifies the saved
 * value, so arrays are compared by content.
 */
export function useSavedPick<T>(saved: T, savedKey: string = String(saved)): [T, (value: T) => void] {
  const [value, setValue] = useState(saved);
  useEffect(() => {
    setValue(saved);
    // Follows the saved value by its key: an equal array from a new render isn't a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  return [value, setValue];
}
