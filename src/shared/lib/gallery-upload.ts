// ──────────────────────────────────────────────
// Shared gallery batch-upload runner
// Every gallery (chat, character, persona, global) uploads a batch of files the
// same way, so they share this runner to stay consistent. Each file uploads
// independently and successful rows are already persisted. The runner throws
// ONLY when every file failed; on partial success it returns the files that
// failed (with their reasons) so the UI can name the casualties instead of just
// counting them — which preempts "image failed to upload for no reason" reports.
// (Failures here are deterministic — too large / wrong type / corrupt bytes — so
// the value is explaining which file and why, not retrying.)
// ──────────────────────────────────────────────

interface GalleryUploadFailure {
  file: File;
  reason: string;
}

function failureReason(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message.trim();
  return "upload failed";
}

/** "cat.png — too large; dog.gif — unsupported type" (capped, with overflow). */
export function describeGalleryUploadFailures(failures: GalleryUploadFailure[]): string {
  const MAX_LISTED = 3;
  const shown = failures.slice(0, MAX_LISTED).map((failure) => `${failure.file.name} — ${failure.reason}`);
  const extra = failures.length - shown.length;
  return extra > 0 ? `${shown.join("; ")}; and ${extra} more` : shown.join("; ");
}

export async function runGalleryUploadBatch<T>(
  files: File[],
  uploadOne: (file: File) => Promise<T>,
): Promise<{ uploaded: T[]; failures: GalleryUploadFailure[] }> {
  const results = await Promise.allSettled(files.map((file) => uploadOne(file)));
  const uploaded: T[] = [];
  const failures: GalleryUploadFailure[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") uploaded.push(result.value);
    else failures.push({ file: files[index]!, reason: failureReason(result.reason) });
  });
  // Total failure → throw so the caller's onError surfaces it, with the files and
  // reasons named. Partial success returns so the saved rows stay and the caller
  // can warn about exactly which files were lost.
  if (uploaded.length === 0 && failures.length > 0) {
    throw new Error(describeGalleryUploadFailures(failures));
  }
  return { uploaded, failures };
}
