// Size limits for user CSS, kept apart from the zod schemas so the home screen can check CSS without loading zod.
export const MAX_THEME_CSS_BYTES = 256 * 1024;
export const MAX_EXTENSION_CSS_BYTES = 256 * 1024; // 256 KiB
