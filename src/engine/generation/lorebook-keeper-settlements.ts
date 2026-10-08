export interface LorebookKeeperSettlement {
  chatId: string;
  applied: number;
  pending: number;
  lorebookIds: string[];
}

type LorebookKeeperSettlementListener = (settlement: LorebookKeeperSettlement) => void;

const settlementListeners = new Set<LorebookKeeperSettlementListener>();

/** Told whenever a Keeper run's proposals were applied or left for review, in this tab. */
export function subscribeLorebookKeeperSettlements(listener: LorebookKeeperSettlementListener): () => void {
  settlementListeners.add(listener);
  return () => settlementListeners.delete(listener);
}

/** Call once the settled run is stored, so observers reading storage find it. */
export function publishLorebookKeeperSettlement(settlement: LorebookKeeperSettlement): void {
  for (const listener of settlementListeners) {
    try {
      listener(settlement);
    } catch {
      // UI observers cannot affect proposals that are already stored.
    }
  }
}
