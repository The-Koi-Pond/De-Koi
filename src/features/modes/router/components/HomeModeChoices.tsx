import { useId } from "react";
import { getDekiModeLine, type HomeMode } from "../lib/deki-home-lines";

/*
 * The Pond theme's mode picker, styled like a visual-novel choice menu: the
 * three modes are your replies to Deki, stacked under their dialogue box.
 * Pointing at a choice (hover or keyboard focus) shows the ▶ cursor and lets
 * Deki explain that mode. Styles: src/styles/themes/pond.css ("Home: the
 * choice menu").
 *
 * Each button's name is its visible text (so voice control can say it), and
 * Deki's explanation of the mode is its description for screen readers.
 */
const CHOICES: ReadonlyArray<{ mode: HomeMode; line: string; label: string }> = [
  { mode: "conversation", line: "Let's just talk.", label: "Conversation" },
  { mode: "roleplay", line: "Let's play out a story!", label: "Roleplay" },
  { mode: "fanfic", line: "Write me something to read.", label: "Fanfic" },
];

export function HomeModeChoices({
  onPick,
  onPrewarm,
  onHint,
}: {
  onPick: (mode: HomeMode) => void;
  onPrewarm: (mode: HomeMode) => void;
  /** true while a choice is pointed at (hover or keyboard focus), false when left. */
  onHint: (mode: HomeMode, active: boolean) => void;
}) {
  const idPrefix = useId();
  return (
    <div className="vn-choices stagger-children">
      {CHOICES.map(({ mode, line, label }) => {
        const descriptionId = `${idPrefix}-${mode}`;
        const point = () => {
          onPrewarm(mode);
          onHint(mode, true);
        };
        return (
          <button
            key={mode}
            type="button"
            data-mode={mode}
            aria-describedby={descriptionId}
            className="vn-choice"
            onClick={() => {
              onPrewarm(mode);
              onPick(mode);
            }}
            onPointerEnter={point}
            onPointerLeave={() => onHint(mode, false)}
            onFocus={point}
            onBlur={() => onHint(mode, false)}
          >
            {/* Drawn, not the ▶ character, which Windows shows as a blue emoji. */}
            <svg className="vn-choice-cursor" viewBox="0 0 8 10" aria-hidden="true">
              <path d="M0 0 8 5 0 10Z" fill="currentColor" />
            </svg>
            <span className="vn-choice-line">{line}</span>
            <span className="vn-choice-mode">{label}</span>
          </button>
        );
      })}
      {/* The descriptions sit outside the buttons, or they'd become part of the
          names, and are hidden so they're only read as descriptions, not twice. */}
      <div hidden>
        {CHOICES.map(({ mode }) => (
          <span key={mode} id={`${idPrefix}-${mode}`}>
            {getDekiModeLine(mode)}
          </span>
        ))}
      </div>
    </div>
  );
}
