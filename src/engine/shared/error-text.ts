/** The message of a thrown value, for logs and stored error fields. Not for showing to users as is. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
