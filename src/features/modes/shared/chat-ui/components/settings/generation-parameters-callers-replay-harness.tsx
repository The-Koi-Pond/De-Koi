// Replays the caller recordings (test-fixtures/README.md, "Caller recordings"): the real chat settings section and
// the setup hook and panel, rendered with this module, driven and read as the recorder did.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Chat } from "../../../../../../engine/contracts/types/chat";
import type { ConnectionSummary } from "../../../../../catalog/connections/index";
import { SetupParametersPanel, useSetupParameters, type SetupParameters } from "../chat-setup/SetupParametersPanel";
import { AdvancedParametersSection } from "./AdvancedParametersSection";
import {
  FieldsView,
  runFieldAction,
  setNativeValue,
  textsOf,
  trimmedText,
  type Group,
} from "../../../../../../shared/components/ui/generation-parameters/fields-replay-harness";
import { decode, encode } from "../../../../../../shared/components/ui/generation-parameters/recorded-encoding";

type CallerAction =
  | { do: "button"; pressed: number }
  | { do: "button"; text: string; last?: boolean }
  | { do: "edit"; field: string; text: string }
  | { do: "touch"; field: string }
  | { do: "group"; group: Group; option: string }
  | { do: "switch" }
  | { do: "enable" }
  | { do: "connection"; to: string };

interface CallerFields {
  values: Record<string, string>;
  tags: Array<[string, string]>;
  selected: Record<Group, string[] | null>;
  tierOptions: string[] | null;
}

export interface CallerRecording<S> {
  connections: unknown;
  metadata: Record<string, unknown>;
  presets: Record<string, unknown>;
  scenarios: S[];
}

export interface AdvancedScenario {
  id: string;
  metadata: string;
  connectionId: string | null;
  preset: string;
  mode: Chat["mode"];
  steps: string;
  start: { texts: string[]; pressed: Array<[string, string]>; fields: CallerFields | null };
  rec: Array<Record<string, unknown> & { action: CallerAction }>;
}

export interface SetupScenario {
  id: string;
  metadata: string;
  connectionId: string | null;
  isConversation: boolean;
  steps: string;
  start: Record<string, unknown> & { texts: string[] };
  rec: Array<Record<string, unknown> & { action: CallerAction }>;
}

function callerFields(view: FieldsView): CallerFields | null {
  if (!view.present()) return null;
  const { values, tags, selected, tierOptions } = view.snapshot();
  return { values, tags, selected, tierOptions };
}

/** Focus, set the whole text with one input event, blur; or just focus and blur. */
function editField(view: FieldsView, action: Extract<CallerAction, { do: "edit" | "touch" }>) {
  runFieldAction(view, { do: "focus", field: action.field });
  if (action.do === "edit") {
    const field = view.field(action.field);
    act(() => setNativeValue(field, action.text));
  }
  runFieldAction(view, { do: "blur", field: action.field });
}

function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

abstract class CallerHarness {
  protected readonly host = document.createElement("div");
  protected readonly root: Root = createRoot(this.host);
  protected readonly view = new FieldsView(this.host);

  constructor() {
    document.body.appendChild(this.host);
  }

  unmount() {
    act(() => this.root.unmount());
    this.host.remove();
  }

  protected buttons(): HTMLButtonElement[] {
    return [...this.host.querySelectorAll("button")];
  }

  /** Runs the shared step kinds; returns false when the step's button isn't there. */
  protected runShared(action: CallerAction): boolean {
    switch (action.do) {
      case "edit":
      case "touch":
        editField(this.view, action);
        return true;
      case "group":
        runFieldAction(this.view, { do: "click", group: action.group, option: action.option });
        return true;
      default:
        throw new Error(`Unknown action ${JSON.stringify(action)}`);
    }
  }
}

export class AdvancedHarness extends CallerHarness {
  chatPatches: unknown[] = [];
  readonly connectionDefaults: unknown[];

  constructor(recording: CallerRecording<AdvancedScenario>, scenario: AdvancedScenario, savedDefaults: unknown[]) {
    super();
    this.connectionDefaults = savedDefaults;
    const connections = decode(recording.connections) as ConnectionSummary[];
    const initial = decode(recording.metadata[scenario.metadata]) as Record<string, unknown>;
    const presetParameters = decode(recording.presets[scenario.preset]);
    const queryClient = new QueryClient();
    const onPatch = (patch: Record<string, unknown>) => this.chatPatches.push(encode(patch));

    function Caller() {
      const [metadata, setMetadata] = useState(initial);
      const mutate = ({ id: _id, ...patch }: { id: string } & Record<string, unknown>) => {
        onPatch(patch);
        setMetadata((state) => ({ ...state, ...patch }));
      };
      return (
        <QueryClientProvider client={queryClient}>
          <AdvancedParametersSection
            chat={{ id: "chat-1" } as Chat}
            metadata={metadata}
            updateMeta={{ mutate } as never}
            mode={scenario.mode}
            connectionId={scenario.connectionId}
            connections={connections}
            promptPresetParameters={presetParameters}
          />
        </QueryClientProvider>
      );
    }

    act(() => this.root.render(<Caller />));
    const header = this.buttons().find((button) => trimmedText(button).includes("Advanced Parameters"));
    if (!header) throw new Error("No Advanced Parameters header");
    click(header);
  }

  private profileButtons(): HTMLButtonElement[] {
    const group = this.host.querySelector('[role="group"][aria-label="Generation profile"]');
    return group ? [...group.querySelectorAll("button")] : [];
  }

  /** Runs one step; returns false when its button isn't there. */
  run(action: CallerAction): boolean {
    this.chatPatches = [];
    this.connectionDefaults.length = 0;
    if (action.do !== "button") return this.runShared(action);
    let target: HTMLButtonElement | undefined;
    if ("pressed" in action) {
      target = this.profileButtons()[action.pressed];
    } else {
      const matches = this.buttons().filter((button) => trimmedText(button) === action.text);
      target = action.last ? matches.at(-1) : matches[0];
    }
    if (!target) return false;
    click(target);
    return true;
  }

  pressed(): Array<[string, string | null]> {
    return this.profileButtons().map((button) => [trimmedText(button), button.getAttribute("aria-pressed")]);
  }

  /** Buttons without `aria-label` whose text mentions Recommended, Custom, Clear, Save or Saving. */
  labelledButtons(): string[] {
    return this.buttons()
      .filter((button) => !button.hasAttribute("aria-label"))
      .map(trimmedText)
      .filter((text) => /Recommended|Custom|Clear|Save|Saving/.test(text));
  }

  start() {
    return { texts: textsOf(this.host), pressed: this.pressed(), fields: callerFields(this.view) };
  }

  shown(withFields: boolean) {
    return {
      chatPatches: this.chatPatches,
      connectionDefaults: [...this.connectionDefaults],
      pressed: this.pressed(),
      buttons: this.labelledButtons(),
      ...(withFields ? { fields: callerFields(this.view) } : {}),
    };
  }
}

export class SetupHarness extends CallerHarness {
  private parameters!: SetupParameters;
  private setConnectionId: (id: string | null) => void = () => {};

  constructor(recording: CallerRecording<SetupScenario>, scenario: SetupScenario) {
    super();
    const connections = decode(recording.connections) as ConnectionSummary[];
    const metadata = decode(recording.metadata[scenario.metadata]) as Record<string, unknown>;
    const expose = (parameters: SetupParameters, setId: (id: string | null) => void) => {
      this.parameters = parameters;
      this.setConnectionId = setId;
    };

    function Caller() {
      const [connectionId, setConnectionId] = useState(scenario.connectionId);
      const parameters = useSetupParameters({
        metadata,
        isConversation: scenario.isConversation,
        connection: connections.find((connection) => connection.id === connectionId) ?? null,
      });
      expose(parameters, setConnectionId);
      return <SetupParametersPanel parameters={parameters} />;
    }

    act(() => this.root.render(<Caller />));
  }

  run(action: CallerAction) {
    const toggle = () => this.host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    switch (action.do) {
      case "switch":
        click(toggle());
        return;
      case "enable":
        if (toggle().getAttribute("aria-checked") !== "true") click(toggle());
        return;
      case "connection":
        act(() => this.setConnectionId(action.to));
        return;
      default:
        this.runShared(action);
    }
  }

  shown() {
    return {
      enabled: this.parameters.enabled,
      chatParameters: encode(this.parameters.chatParameters),
      value: encode(this.parameters.value),
      serviceTierOptions: encode(this.parameters.serviceTierOptions),
      fields: callerFields(this.view),
    };
  }

  start() {
    return { texts: textsOf(this.host), ...this.shown() };
  }
}
