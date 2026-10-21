/**
 * An error whose message is written for the person using De-Koi and says what to do. The UI shows these as they
 * are (src/shared/lib/error-message.ts matches the "user_facing" code); every other error gets the screen's copy,
 * so internal text never reaches the user.
 */
export function userFacingError(message: string): Error & { code: "user_facing" } {
  return Object.assign(new Error(message), { code: "user_facing" as const });
}
