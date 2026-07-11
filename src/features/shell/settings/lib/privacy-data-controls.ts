export const FULL_DATA_ERASE_PHRASE = "yes, erase all my de-koi data";

export function canEraseAllDeKoiData(value: string): boolean {
  return value === FULL_DATA_ERASE_PHRASE;
}
