// ──────────────────────────────────────────────
// Theme Types
// ──────────────────────────────────────────────

/** A custom theme stored by the local app. */
export interface Theme {
  id: string;
  name: string;
  /** Raw CSS injected into the document as a <style> tag. */
  css: string;
  /** When this theme was first created or imported by the user. */
  installedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Whether this is the globally active custom theme. */
  isActive: boolean;
  /** Legacy active flag used by older imports/storage rows. */
  active?: boolean;
}
