import { Skull } from "lucide-react";
import { encounterEnemyGlyph } from "../../../../../engine/modes/roleplay/encounter/encounter-rules";
import type {
  EncounterEnemy,
  EncounterPartyMember,
  EncounterStatus,
} from "../../../../../engine/modes/roleplay/encounter/encounter-types";
import { cn } from "../../../../../shared/lib/utils";

function hpBarColor(side: "enemy" | "party", hp: number, maxHp: number): string {
  if (hp <= 0) return "bg-zinc-500";
  const share = maxHp > 0 ? hp / maxHp : 0;
  if (side === "party") return share > 0.5 ? "bg-emerald-500" : share > 0.25 ? "bg-yellow-400" : "bg-red-500";
  return share > 0.5 ? "bg-red-600" : share > 0.25 ? "bg-orange-500" : "bg-red-400";
}

function HpBar(props: { side: "enemy" | "party"; name: string; hp: number; maxHp: number }) {
  const percent = props.maxHp > 0 ? Math.round((Math.max(props.hp, 0) / props.maxHp) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div
        role="meter"
        aria-label={`${props.name} HP`}
        aria-valuemin={0}
        aria-valuemax={props.maxHp}
        aria-valuenow={props.hp}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", hpBarColor(props.side, props.hp, props.maxHp))}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-right text-[0.625rem] tabular-nums text-[var(--muted-foreground)]">
        {props.hp}/{props.maxHp}
      </p>
    </div>
  );
}

function StatusBadges({ statuses }: { statuses: EncounterStatus[] }) {
  if (!statuses.length) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Statuses">
      {statuses.map((status, index) => {
        const label = `${status.name} (${status.duration} turns)`;
        return (
          <li
            key={`${status.name}-${index}`}
            title={label}
            aria-label={label}
            className="rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[0.625rem] tabular-nums"
          >
            {status.emoji || status.name.slice(0, 1)} {status.duration}
          </li>
        );
      })}
    </ul>
  );
}

const CARD_CLASS = "relative rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 p-2 transition-opacity";

function DefeatedMark() {
  return (
    <Skull
      size="1rem"
      className="absolute right-1.5 top-1.5 text-[var(--muted-foreground)]"
      aria-label="Defeated"
      role="img"
    />
  );
}

export function EnemyCard({ enemy }: { enemy: EncounterEnemy }) {
  const defeated = enemy.hp <= 0;
  return (
    <li className={cn(CARD_CLASS, "space-y-1", defeated && "opacity-50 grayscale")}>
      {defeated && <DefeatedMark />}
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none" aria-hidden="true">
          {encounterEnemyGlyph(enemy.sprite)}
        </span>
        <p className="min-w-0 truncate text-xs font-semibold">{enemy.name}</p>
      </div>
      <HpBar side="enemy" name={enemy.name} hp={enemy.hp} maxHp={enemy.maxHp} />
      <StatusBadges statuses={enemy.statuses} />
      {enemy.description && (
        <p className="line-clamp-2 text-[0.625rem] text-[var(--muted-foreground)]">{enemy.description}</p>
      )}
    </li>
  );
}

export function PartyCard({ member }: { member: EncounterPartyMember }) {
  const defeated = member.hp <= 0;
  return (
    <li className={cn(CARD_CLASS, "space-y-1", defeated && "opacity-50 grayscale")}>
      {defeated && <DefeatedMark />}
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/25 text-xs font-semibold"
          aria-hidden="true"
        >
          {member.name.slice(0, 1).toUpperCase()}
        </span>
        <p className="min-w-0 truncate text-xs font-semibold">
          {member.name}
          {member.isPlayer && <span className="ml-1 font-normal text-[var(--muted-foreground)]">(You)</span>}
        </p>
      </div>
      <HpBar side="party" name={member.name} hp={member.hp} maxHp={member.maxHp} />
      <StatusBadges statuses={member.statuses} />
    </li>
  );
}
