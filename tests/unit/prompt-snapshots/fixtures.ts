// Prompt snapshot fixtures. Public-domain characters and invented test data only: never real cards or chats.
import type { CanonicalMemoryRecord } from "../../../src/engine/contracts/types/memory";
import type { GenerationDryRunInput } from "../../../src/engine/generation/start-generation";
import { fanficGenerationInput } from "../../../src/engine/modes/fanfic/chapters";
import { fanficChapterTextKey } from "../../../src/engine/modes/fanfic/ledger";
import { readFanficState } from "../../../src/engine/modes/fanfic/request";
import {
  buildRoleplayWorkflowProfilePatch,
  resolveRoleplayWorkflowProfile,
} from "../../../src/engine/modes/roleplay/workflow-profiles";
import universalPresetV2 from "../../../src-tauri/resources/default-data/db/default-preset-v2.json";
import { FIXED_NOW, type SnapshotDb } from "./harness";

type Row = Record<string, unknown>;

export interface PromptSnapshotFixture {
  name: string;
  title: string;
  db: SnapshotDb;
  input: GenerationDryRunInput;
}

const CONNECTION: Row = {
  id: "conn-snapshot",
  name: "Snapshot connection",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  enabled: true,
};

const PERSONA_JO: Row = {
  id: "persona-jo",
  name: "Jo",
  description: "A hobby writer in her twenties who collects Victorian novels and second-hand teacups.",
  personality: "Curious, quick to laugh, a little nosy, likes concrete answers.",
  tags: [],
};

/** The two scripts a fresh install seeds (src-tauri/src/seed_defaults.rs, seed_default_regex_scripts). */
const DEFAULT_REGEX_SCRIPTS: Row[] = [
  {
    id: "default-clean-html",
    name: "Clean HTML (Outgoing Prompt)",
    enabled: true,
    findRegex: "[ \\t]?<(?!--)(?!\\/?(?:font|lie|filter)\\b)(?:\"[^\"]*\"|'[^']*'|[^'\">])*>",
    replaceString: "",
    trimStrings: [],
    placement: ["user_input", "ai_output"],
    flags: "g",
    promptOnly: true,
    order: 0,
    sortOrder: 0,
    minDepth: null,
    maxDepth: null,
  },
  {
    id: "default-collapse-newlines",
    name: "Collapse Excess Newlines",
    enabled: true,
    findRegex: "\\n{3,}",
    replaceString: "\n\n",
    trimStrings: [],
    placement: ["user_input", "ai_output"],
    flags: "g",
    promptOnly: false,
    order: 10,
    sortOrder: 10,
    minDepth: null,
    maxDepth: null,
  },
];

function card(id: string, data: Row): Row {
  return {
    id,
    data: JSON.stringify(data),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Builds alternating user/assistant rows from [user, assistant] pairs, one minute apart. */
function transcript(args: {
  chatId: string;
  idPrefix: string;
  characterId: string;
  startAt: string;
  pairs: Array<[string, string]>;
}): Row[] {
  const start = Date.parse(args.startAt);
  const rows: Row[] = [];
  args.pairs.forEach(([user, assistant], index) => {
    for (const [offset, role, content] of [
      [0, "user", user],
      [1, "assistant", assistant],
    ] as const) {
      const position = index * 2 + offset + 1;
      rows.push({
        id: `${args.idPrefix}${String(position).padStart(3, "0")}`,
        chatId: args.chatId,
        role,
        content,
        ...(role === "assistant" ? { characterId: args.characterId } : {}),
        extra: {},
        createdAt: new Date(start + (position - 1) * 60_000).toISOString(),
      });
    }
  });
  return rows;
}

// ── Conversation ───────────────────────────────────────────────

function conversationFixture(): PromptSnapshotFixture {
  const chat: Row = {
    id: "chat-conversation",
    title: "Lizzy",
    mode: "conversation",
    characterIds: ["char-elizabeth"],
    personaId: "persona-jo",
    connectionId: "conn-snapshot",
    promptPresetId: null,
    metadata: { promptTimeZone: "Europe/London" },
    createdAt: "2026-03-13T09:00:00.000Z",
    updatedAt: "2026-03-14T17:05:00.000Z",
  };
  const messages: Row[] = [
    ["2026-03-13T09:02:00.000Z", "user", "Morning, Lizzy! I finally started reading the letters you lent me."],
    [
      "2026-03-13T09:04:00.000Z",
      "assistant",
      "Then you have more patience than my cousin Mr. Collins. Which one made you laugh first?",
    ],
    [
      "2026-03-13T09:10:00.000Z",
      "user",
      "The one where your mother tries to marry Jane off by sending her out in the rain.",
    ],
    [
      "2026-03-13T09:12:00.000Z",
      "assistant",
      "Mama calls it strategy. Jane calls it a cold. I call it the finest comedy in Hertfordshire.",
    ],
    ["2026-03-14T17:01:00.000Z", "user", "Long day. My editor rejected the teacup chapter again."],
    [
      "2026-03-14T17:05:00.000Z",
      "assistant",
      "Rejected? Then your editor has never been handed a chipped cup at a dull assembly. Tell me what she objected to.",
    ],
  ].map(([createdAt, role, content], index) => ({
    id: `conv-${String(index + 1).padStart(3, "0")}`,
    chatId: "chat-conversation",
    role,
    content,
    ...(role === "assistant" ? { characterId: "char-elizabeth" } : {}),
    extra: {},
    createdAt,
  }));
  // Memories the character saved with the [memory] command; they are not tied to transcript messages.
  const chatMemories: Row[] = [
    {
      id: "memory-conv-1",
      chatId: "chat-conversation",
      content:
        "Jo's editor Margaret keeps sending back the teacup chapter of Jo's novel, the one with the ball scene Jo loves.",
      source: "connected_command",
      embeddingSource: "command",
      commandMemoryKey: "chat-conversation::Elizabeth Bennet::teacup chapter",
      messageIds: [],
      status: "active",
      createdAt: "2026-03-10T20:00:00.000Z",
    },
    {
      id: "memory-conv-2",
      chatId: "chat-conversation",
      content: "Jo takes her tea with far too much sugar and pretends she doesn't.",
      source: "connected_command",
      embeddingSource: "command",
      commandMemoryKey: "chat-conversation::Elizabeth Bennet::tea",
      messageIds: [],
      status: "active",
      createdAt: "2026-03-11T20:00:00.000Z",
    },
  ];
  return {
    name: "conversation",
    title: "conversation (Elizabeth Bennet texting Jo)",
    db: {
      rows: {
        chats: [chat],
        connections: [CONNECTION],
        characters: [
          card("char-elizabeth", {
            name: "Elizabeth Bennet",
            description:
              "Elizabeth Bennet, second of the five Bennet sisters of Longbourn in Hertfordshire, from Jane Austen's Pride and Prejudice (1813). Twenty years old, sharp, and fond of a good absurdity.",
            personality:
              "Witty, warm, quick to judge and quicker to admit it when wrong. Teases the people she likes. Walks everywhere.",
            scenario: "Elizabeth texts with her friend Jo between errands at Longbourn.",
            first_mes: "Jo! Mama has invited the entire militia to dinner. Rescue me with news of any kind.",
            mes_example:
              "<START>\n{{user}}: How was the ball?\n{{char}}: Mr. Darcy danced twice and spoke four words. I counted.",
            tags: ["classic literature"],
            extensions: {
              backstory: "Raised at Longbourn with four sisters and a father who hides in his library.",
              appearance: "Dark eyes, a light figure, and usually muddy hems from walking.",
            },
          }),
        ],
        personas: [PERSONA_JO],
        "regex-scripts": DEFAULT_REGEX_SCRIPTS,
      },
      messages,
      chatMemories,
    },
    input: {
      chatId: "chat-conversation",
      connectionId: "conn-snapshot",
      message: "Margaret sent the teacup chapter back again. Should I cut the ball scene?",
      userTimeZone: "Europe/London",
      runId: "snapshot-conversation",
    },
  };
}

// ── Roleplay (minimal-clean, long chat) ────────────────────────

const ROLEPLAY_PAIRS: Array<[string, string]> = [
  // 1-12: the goose, the stone, and Holmes's promise (summarized as the first story episode).
  [
    "*I climb the stairs of 221B with a goose under my arm.* Peterson the commissionaire left this with Mrs. Hudson for you, Mr. Holmes.",
    "*Holmes glances up from his chemicals.* A Christmas goose and a battered billycock hat. Peterson found both in the street at four this morning, I imagine.",
  ],
  [
    "He did. He said a gentleman dropped them while fighting off some roughs on Tottenham Court Road.",
    "*He turns the hat over.* The owner is a man of learning who has fallen on evil days. His wife has ceased to love him. The hat says as much.",
  ],
  [
    "You can't know all that from a hat.",
    "*A thin smile.* I can, and I will explain it over the goose, which ought to be eaten before it spoils.",
  ],
  [
    "Mrs. Hudson is cleaning the goose now. *A shriek drifts up from the kitchen.*",
    "*Holmes is already on his feet.* That is not the sound of a woman who has cut her thumb.",
  ],
  [
    "*Mrs. Hudson bursts in holding something that glitters blue.* She says this was in the goose's crop!",
    "*He takes it to the window.* Brilliant blue, the size of a bean, and it cuts glass. Jo, look at the way it holds the light.",
  ],
  [
    "What is it?",
    "It is the Countess of Morcar's blue carbuncle, stolen five days ago from her room at the Hotel Cosmopolitan. The papers say the reward is a thousand pounds.",
  ],
  [
    "Mrs. Hudson says the stone was in the goose's crop. How does a jewel end up inside a goose?",
    "That is the question that will carry us to the bottom of this. A plumber named John Horner is already in custody for the theft, and I doubt he ever saw this goose.",
  ],
  [
    "So Horner might be innocent?",
    "Quite possibly. The goose came from somewhere, and its owner bought it from someone. We follow the goose.",
  ],
  [
    "How do we find the man who lost the hat?",
    "*He scribbles on a sheet of paper.* An advertisement in every evening paper: Found at the corner of Goodge Street, a goose and a black felt hat. Mr. Henry Baker can have them by applying at 221B Baker Street.",
  ],
  [
    "Henry Baker? You know his name already?",
    "A card tied to the goose's leg said 'For Mrs. Henry Baker'. Even a tired detective reads labels.",
  ],
  [
    "What happens to the stone while we wait?",
    "*He locks it in the small iron strongbox on the mantel.* It stays in my strongbox until the Countess's people can collect it. You have my word on that, Jo.",
  ],
  [
    "I'll hold you to it. Mrs. Hudson won't sleep with that thing in the house.",
    "Mrs. Hudson has slept beside worse. Tell her the strongbox has outlasted two burglars and a Russian anarchist.",
  ],
  // 13-39: the hunt for the goose's seller and the thief.
  [
    "*Evening. A knock at the door.* That must be Mr. Baker.",
    "*Holmes rises.* Show him in. Mind the coal scuttle, Mr. Baker; Mrs. Hudson moves it to catch the unwary.",
  ],
  [
    "*Henry Baker, shabby and polite, takes a chair.* He says he did not advertise because he couldn't afford to.",
    "*Holmes nods.* We ate your goose, Mr. Baker. There is another on the sideboard of the same weight, with your hat beside it.",
  ],
  [
    "Mr. Baker looks relieved, but he asks for the old goose's crop and feathers.",
    "*Holmes's eyes flick to me.* Of no use to you now, I fear. Where did you buy the bird?",
  ],
  [
    "He says it came from a goose club at the Alpha Inn near the Museum.",
    "Then that is where we go. Thank you, Mr. Baker. You have been more useful than you know.",
  ],
  [
    "*Mr. Baker leaves with the goose under his arm.* He didn't know about the stone.",
    "No. A man who did would not have asked for the feathers so lightly. Get your coat, Jo; it is a frosty night.",
  ],
  [
    "*We walk through Wimpole Street and Harley Street toward the Alpha.* It's freezing.",
    "*Holmes keeps a brisk pace.* The cold sharpens the mind. The landlord of the Alpha is called Windigate.",
  ],
  [
    "*Inside the Alpha, Holmes orders two glasses of beer.* Ask him about the geese.",
    "*To the landlord:* Your beer should be excellent if it is as good as your geese. Where did you get them?",
  ],
  [
    "The landlord says he bought two dozen from a salesman in Covent Garden named Breckinridge.",
    "Breckinridge, of Covent Garden. Then we finish our beer and walk on.",
  ],
  [
    "*At Covent Garden a horsy man is putting up his shutters.* That must be Breckinridge.",
    "*Holmes approaches him.* Sold out of geese, I see. Where did the Alpha's birds come from?",
  ],
  [
    "Breckinridge snaps that everyone keeps asking about those geese and he's sick of it.",
    "*Holmes lays down a sovereign as a wager.* I bet you they were country bred. Prove me wrong.",
  ],
  [
    "*Breckinridge pulls out his ledger to win the bet.* He says they came from a Mrs. Oakshott in Brixton Road.",
    "*Holmes reads the entry over his shoulder.* 117 Brixton Road, sold on the twenty-second, twenty-four geese at seven and six. I owe you a sovereign.",
  ],
  [
    "Why did he get angry about the questions?",
    "Because someone has been badgering him about those very geese. Listen.",
  ],
  [
    "*A little rat-faced man is arguing with Breckinridge at the next stall.*",
    "*Holmes touches his sleeve.* Excuse me. I think I could be of assistance in finding the goose you seek.",
  ],
  [
    "The man goes pale and asks who we are.",
    "My name is Sherlock Holmes. It is my business to know what other people don't know. You are trying to trace some geese sold by Mrs. Oakshott.",
  ],
  [
    "He says his name is John Robinson.",
    "*Holmes smiles.* No, no; the real name. It is always awkward doing business with an alias.",
  ],
  [
    "*The man flushes.* He admits his name is James Ryder.",
    "Precisely so. Head attendant at the Hotel Cosmopolitan. Pray step into the cab, Mr. Ryder.",
  ],
  [
    "*Back at Baker Street, Ryder sits shaking by the fire.*",
    "*Holmes opens the strongbox and holds up the stone.* The game is up, Ryder. Is this what you were looking for?",
  ],
  [
    "Ryder stares at the blue carbuncle and grabs the mantel to keep from falling.",
    "Give him a dash of brandy, Jo. He has not the nerve for crime.",
  ],
  [
    "*I hand Ryder the brandy.* He starts confessing about the Countess's maid.",
    "Catherine Cusack, her maid. The two of you planned it and let Horner, the plumber, take the blame.",
  ],
  [
    "He says he hid the stone by feeding it to a goose at his sister's house in Brixton.",
    "Mrs. Oakshott's yard. And then you took the wrong goose, the one with the barred tail.",
  ],
  [
    "He says his sister sold the right goose to Breckinridge before he could get it back.",
    "And Breckinridge sold it to the Alpha, and the Alpha's goose club gave it to Henry Baker. A long road for one stone.",
  ],
  [
    "Ryder falls to his knees and begs Holmes not to send him to prison.",
    "*Holmes is silent a long moment, then opens the door.* Get out.",
  ],
  [
    "You're letting him go?",
    "Horner will go free, because the case against him collapses without Ryder. Send Ryder to jail now and you make him a jailbird for life.",
  ],
  [
    "That's very generous.",
    "It is the season of forgiveness, Jo. Chance has put in our way a most singular problem, and its solution is its own reward.",
  ],
  [
    "*I sit down by the fire.* What happens now?",
    "Now we ring for Mrs. Hudson and begin another investigation, in which a bird will be the chief feature.",
  ],
  [
    "*Mrs. Hudson brings up the woodcock.* She is still muttering about the stone.",
    "Mrs. Hudson distrusts anything that sparkles. It is one of her finest qualities.",
  ],
  [
    "*I watch Holmes fill his pipe.* You never doubted it was Ryder?",
    "I doubted everything until the ledger. After that, the only question was which of the frightened men would reach me first.",
  ],
];

function roleplayFixture(): PromptSnapshotFixture {
  const chatId = "chat-roleplay";
  const messages = transcript({
    chatId,
    idPrefix: "rp-",
    characterId: "char-holmes",
    startAt: "2026-03-01T19:00:00.000Z",
    pairs: ROLEPLAY_PAIRS,
  });
  const baseChat = {
    mode: "roleplay" as const,
    promptPresetId: null,
    connectionId: "conn-snapshot",
    metadata: {},
  };
  // Apply the minimal-clean profile the way the chooser does: every row it selects by default.
  const resolution = resolveRoleplayWorkflowProfile("minimal-clean", {
    chat: baseChat,
    capabilities: {
      hasUniversalPreset: true,
      localSidecarReady: false,
      hasImageConnection: false,
      hasUsableBackgroundAssets: false,
      musicModuleEnabled: false,
      ttsReady: false,
    },
  });
  const patch = buildRoleplayWorkflowProfilePatch(
    resolution,
    resolution.rows
      .filter((row) => row.kind === "change" && row.selectable && row.selectedByDefault)
      .map((row) => row.id),
    "2026-03-01T18:59:00.000Z",
    undefined,
  );
  const chat: Row = {
    id: chatId,
    title: "The Blue Carbuncle",
    mode: "roleplay",
    characterIds: ["char-holmes"],
    personaId: "persona-lodger",
    connectionId: "conn-snapshot",
    promptPresetId: patch.promptPresetId ?? null,
    metadata: { ...patch.metadata, promptTimeZone: "Europe/London" },
    createdAt: "2026-03-01T18:59:00.000Z",
    updatedAt: "2026-03-01T20:17:00.000Z",
  };
  const byId = new Map(messages.map((message) => [String(message.id), message]));
  const sourceMessages = (from: number, to: number) =>
    messages.slice(from - 1, to).map((message) => ({
      id: String(message.id),
      role: String(message.role),
      content: String(message.content),
      createdAt: String(message.createdAt),
    }));
  const ids = (from: number, to: number) => sourceMessages(from, to).map((message) => message.id);
  // An automatic exchange capture row, shaped like chat_memory.rs focused_capture_memory().
  const capturedExchange: Row = {
    id: "memory-rp-exchange",
    chatId,
    content: [`Jo: ${byId.get("rp-021")!.content}`, `Sherlock Holmes: ${byId.get("rp-022")!.content}`].join("\n"),
    messageCount: 2,
    messageIds: ids(21, 22),
    firstMessageId: "rp-021",
    lastMessageId: "rp-022",
    firstMessageAt: byId.get("rp-021")!.createdAt,
    lastMessageAt: byId.get("rp-022")!.createdAt,
    createdAt: "2026-03-01T19:22:00.000Z",
    captureFingerprint: "fixture-capture-fingerprint",
    hasEmbedding: false,
    embeddingStatus: "pending",
    canonicalMemoryVersion: 1,
    status: "active",
    memoryKind: "transcript",
    scopeType: "chat",
    scopeId: chatId,
    legacySourceLane: "chats.memories",
    legacySourceId: "memory-rp-exchange",
    creationReason: "Automatic exchange capture",
  };
  // A model-extracted capture, shaped like automatic-memory-capture.ts accepted entries.
  const capturedPromise: CanonicalMemoryRecord = {
    id: "memory-rp-promise",
    kind: "promise",
    status: "active",
    scope: { kind: "chat", id: chatId },
    content: "Holmes promised Jo the stone stays in his strongbox until the Countess's people collect it.",
    confidence: 0.92,
    provenance: {
      sourceChatId: chatId,
      messageIds: ids(21, 22),
      characterId: "char-holmes",
      timestamp: String(byId.get("rp-022")!.createdAt),
    },
    title: null,
    tags: ["automatic", "consequence", "promise"],
    supersedesMemoryId: null,
    payload: {
      automatic: true,
      captureVersion: 1,
      captureJobId: "capture-job-fixture",
      mode: "roleplay",
      sourceMessageIds: ["rp-022"],
      referenceMessageIds: ["rp-021"],
      semanticIdentity: "fixture-promise-identity",
      sourceChatIds: [chatId],
    },
    createdAt: "2026-03-01T19:22:00.000Z",
    updatedAt: "2026-03-01T19:22:00.000Z",
  };
  // The first story episode (messages 1-24), shaped like story-consolidation-queue.ts projection memories.
  const episodeIds = ids(1, 24);
  const firstEpisode: CanonicalMemoryRecord = {
    id: "memory-rp-episode-1",
    kind: "episode",
    status: "active",
    scope: { kind: "chat", id: chatId },
    title: "The hat and the goose club",
    content:
      "Peterson the commissionaire found a goose and a battered hat after a street scuffle, and Jo carried both up to Holmes. Holmes read the hat's owner as a learned man fallen on hard times and advertised for Henry Baker. A jewel turned up inside the goose, so Holmes and Jo traced the bird through the Alpha Inn's goose club toward the Covent Garden dealer Breckinridge.",
    confidence: 0.9,
    provenance: { sourceChatId: chatId, messageIds: episodeIds, sceneId: null, timestamp: "2026-03-01T19:30:00.000Z" },
    tags: ["story-continuity", "episode"],
    supersedesMemoryId: null,
    payload: {
      storyProjectionVersion: 1,
      level: "episode",
      ownerChatId: chatId,
      coverageId: "coverage-fixture-1",
      sourceFingerprint: "fixture-source-fingerprint",
      messageIds: episodeIds,
      sourceMessages: sourceMessages(1, 24),
      firstMessageId: episodeIds[0],
      lastMessageId: episodeIds.at(-1),
      boundaryReason: "message_threshold",
      sourceEpisodeIds: [],
      sections: {
        events: [{ text: "Mrs. Hudson found the blue carbuncle in the goose's crop.", sourceMessageIds: ["rp-009"] }],
        choices: [{ text: "Holmes chose to follow the goose instead of the hat.", sourceMessageIds: ["rp-016"] }],
        relationshipShifts: [],
        promises: [{ text: "Holmes promised to keep the stone in his strongbox.", sourceMessageIds: ["rp-022"] }],
        reveals: [{ text: "The stone is the Countess of Morcar's blue carbuncle.", sourceMessageIds: ["rp-012"] }],
        unresolvedHooks: [{ text: "Who fed the stone to the goose?", sourceMessageIds: ["rp-014"] }],
        currentState: [{ text: "Holmes and Jo are on their way to Breckinridge.", sourceMessageIds: ["rp-024"] }],
      },
      summarizer: {
        version: "story-projection-v1",
        connectionId: "conn-snapshot",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        completedAt: "2026-03-01T19:30:00.000Z",
      },
    },
    createdAt: "2026-03-01T19:30:00.000Z",
    updatedAt: "2026-03-01T19:30:00.000Z",
  };
  const preset = universalPresetV2.data;
  return {
    name: "roleplay",
    title: "roleplay, minimal-clean profile (Sherlock Holmes, 78 messages)",
    db: {
      rows: {
        chats: [chat],
        connections: [CONNECTION],
        characters: [
          card("char-holmes", {
            name: "Sherlock Holmes",
            description:
              "Sherlock Holmes, consulting detective of 221B Baker Street, London, from Arthur Conan Doyle's stories (1887-1927). Tall, lean, hawk-nosed, and restless when he lacks a problem.",
            personality:
              "Precise, theatrical, impatient with dullness, kind in ways he hides. Reasons aloud from small details and enjoys being right.",
            scenario:
              "London, the winter of 1889. Jo has just taken rooms upstairs at 221B and keeps getting pulled into Holmes's cases.",
            first_mes:
              "*Holmes looks up from a litter of newspapers.* You have been walking in the rain from the direction of the Strand. Sit down; I need a fresh pair of eyes.",
            mes_example:
              "<START>\n{{user}}: How did you know?\n{{char}}: *He taps the mud on your boot.* Clay, of a colour found only near the river.",
            tags: ["detective", "victorian"],
            extensions: {
              backstory:
                "Built a private practice as the world's only consulting detective after university; Scotland Yard brings him what it cannot solve.",
              appearance:
                "Over six feet, thin, sharp grey eyes, a dressing gown when indoors, ink and acid stains on his fingers.",
            },
          }),
        ],
        personas: [
          {
            id: "persona-lodger",
            name: "Jo",
            description:
              "Mrs. Hudson's new lodger on the top floor of 221B, a curious young writer who notices more than she admits.",
            personality: "Brave in a pinch, wry, asks blunt questions.",
            tags: [],
          },
        ],
        prompts: [{ ...preset.preset, isDefault: true, default: true }],
        "prompt-sections": preset.sections,
        "prompt-groups": preset.groups,
        "prompt-variables": preset.choiceBlocks,
        lorebooks: [
          {
            id: "lorebook-baker-street",
            name: "Baker Street",
            enabled: true,
            characterIds: ["char-holmes"],
          },
        ],
        "lorebook-entries": [
          {
            id: "entry-mrs-hudson",
            lorebookId: "lorebook-baker-street",
            name: "Mrs. Hudson",
            content:
              "Mrs. Hudson is the landlady of 221B Baker Street. She is patient with Holmes's chemistry and pistol practice, cooks a generous breakfast, and worries aloud about anything valuable kept in the house.",
            keys: ["Mrs. Hudson", "landlady"],
            enabled: true,
            order: 100,
          },
        ],
        "regex-scripts": DEFAULT_REGEX_SCRIPTS,
      },
      messages,
      chatMemories: [capturedExchange],
      canonicalMemories: [capturedPromise, firstEpisode],
    },
    input: {
      chatId,
      connectionId: "conn-snapshot",
      message:
        "*I set down my teacup.* Mrs. Hudson asked me again. Is the stone still in your strongbox until the Countess's people collect it?",
      userTimeZone: "Europe/London",
      runId: "snapshot-roleplay",
    },
  };
}

// ── Fanfic ─────────────────────────────────────────────────────

const ALICE_CHAPTER_ONE = [
  "Chapter 1: The Grin Before the Cat",
  "",
  "Alice had been sitting under the oak for so long that the oak seemed to be getting bored of her.",
  "",
  '"If I were a sensible girl," she told a beetle, "I would go home for tea." The beetle did not answer, which Alice thought rather rude, and then a grin appeared on the branch above her with nothing at all around it.',
  "",
  '"Sensible girls," said the grin, "never find anything worth finding."',
  "",
  "The rest of the Cat arrived a piece at a time: an ear, a whisker, a long striped tail that curled around the branch like a question mark. Alice had met it before, and she had not forgotten how it liked to vanish in the middle of an argument.",
  "",
  '"I have lost the White Rabbit\'s map," she said, "and the Queen wants it by sunset, or it is off with somebody\'s head. Probably mine."',
  "",
  '"Then you had better follow me," said the Cat, "though I shan\'t promise to stay where you can see me."',
].join("\n");

function fanficFixture(): PromptSnapshotFixture {
  const chatId = "chat-fanfic";
  const chapterOne: Row = {
    id: "fic-001",
    chatId,
    role: "assistant",
    content: ALICE_CHAPTER_ONE,
    characterId: "char-alice",
    extra: {},
    createdAt: "2026-03-12T21:00:00.000Z",
  };
  const fanfic = {
    version: 1,
    request: {
      fandom: "Alice's Adventures in Wonderland (Lewis Carroll)",
      characters: ["Alice", "Cheshire Cat"],
      relationships: ["Alice & Cheshire Cat"],
      rating: "general",
      warnings: [],
      tags: ["Friendship", "Riddles", "Canon-Typical Nonsense"],
      setting: "canon_divergence",
      settingNotes: "Alice returns to Wonderland a year after the trial.",
      pov: "third_limited",
      povCharacter: "Alice",
      tense: "past",
      chapterCount: 3,
      wordsPerChapter: 1500,
      prompt:
        "Alice has to recover the White Rabbit's lost map before sunset, and the only guide willing to help is the Cheshire Cat, who keeps disappearing.",
      styleNotes: "Playful, Carroll-flavoured wordplay; short scenes; let the Cat be genuinely unhelpful sometimes.",
      reviewOutline: true,
      adultsConfirmed: false,
      research: false,
    },
    outline: {
      title: "A Map With No North",
      summary: "Alice and the Cheshire Cat chase a lost map across Wonderland before the Queen's sunset deadline.",
      chapters: [
        {
          number: 1,
          title: "The Grin Before the Cat",
          summary: "Alice, stuck under an oak, meets the Cat again and learns the Rabbit's map is lost.",
        },
        {
          number: 2,
          title: "Tea Without Time",
          summary:
            "The trail leads to the Mad Hatter's table, where the map was used as a tablecloth and then traded for a riddle.",
        },
        {
          number: 3,
          title: "North Is Wherever You Point",
          summary: "Alice outwits the Queen's guards with the riddle's answer and returns the map at sunset.",
        },
      ],
    },
    outlineApproved: true,
    research: null,
  };
  const chat: Row = {
    id: chatId,
    title: "A Map With No North",
    mode: "fanfic",
    characterIds: ["char-alice", "char-cheshire"],
    personaId: null,
    connectionId: "conn-snapshot",
    promptPresetId: null,
    metadata: {
      fanfic,
      fanficLedger: {
        version: 1,
        entries: [
          {
            chapter: 1,
            messageId: "fic-001",
            textKey: fanficChapterTextKey(ALICE_CHAPTER_ONE.replace(/^Chapter 1: [^\n]*\n+/, "")),
            summary: "Alice meets the Cheshire Cat under an oak and learns the White Rabbit's map is lost.",
            timeline: "Late morning of the first day.",
            knowledge: [{ subject: "Alice", detail: "Knows the Queen wants the map by sunset." }],
            conditions: [{ subject: "Alice", detail: "Under the oak at the edge of the wood, no map." }],
            relationships: [
              { subject: "Alice & Cheshire Cat", detail: "Wary old acquaintances; the Cat offers to guide her." },
            ],
            openThreads: ["Where is the White Rabbit's map?"],
          },
        ],
      },
    },
    createdAt: "2026-03-12T20:00:00.000Z",
    updatedAt: "2026-03-12T21:00:00.000Z",
  };
  // A fic stores only its chapters; prompt assembly adds the "Write chapter N" turns.
  const messages: Row[] = [chapterOne];
  const state = readFanficState(chat.metadata);
  if (!state) throw new Error("Fanfic fixture state did not parse.");
  return {
    name: "fanfic",
    title: "fanfic, writing chapter 2 (Alice in Wonderland)",
    db: {
      rows: {
        chats: [chat],
        connections: [CONNECTION],
        characters: [
          card("char-alice", {
            name: "Alice",
            description:
              "Alice, a curious and stubborn seven-year-old from Lewis Carroll's Alice's Adventures in Wonderland (1865).",
            personality: "Polite until provoked, logical in an illogical place, talks to herself when nervous.",
            tags: ["children's literature"],
            extensions: {
              backstory: "Fell down a rabbit hole once and has never quite stopped thinking about it.",
              appearance: "Pinafore, long hair, scuffed shoes.",
            },
          }),
          card("char-cheshire", {
            name: "Cheshire Cat",
            description: "The grinning cat of the Duchess's house who can vanish all but its grin.",
            personality: "Amused, cryptic, helpful only by accident, insists everyone here is mad.",
            tags: ["children's literature"],
            extensions: {
              backstory: "Belongs to the Duchess, or believes the Duchess belongs to it.",
              appearance: "A broad striped cat with a very wide grin.",
            },
          }),
        ],
        "regex-scripts": DEFAULT_REGEX_SCRIPTS,
      },
      messages,
    },
    input: {
      ...fanficGenerationInput(state, messages, { chatId, connectionId: "conn-snapshot", fanficKind: "chapter" }),
      userTimeZone: "Europe/London",
      runId: "snapshot-fanfic",
    },
  };
}

export function promptSnapshotFixtures(): PromptSnapshotFixture[] {
  return [conversationFixture(), roleplayFixture(), fanficFixture()];
}

export { FIXED_NOW };
