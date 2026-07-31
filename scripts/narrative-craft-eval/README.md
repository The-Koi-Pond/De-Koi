# Narrative Craft evaluation lane

This directory provides a development-only, paired evaluation of baseline De-Koi fiction and fiction generated with Narrative Craft enabled. It does not run in the product, produce a user-facing “AI score,” or claim that any text is human-authored.

## Pinned StoryScope revision

The adapter was verified against [`jenna-russell/storyscope`](https://github.com/jenna-russell/storyscope) commit `642e746804e1ee4138ffdcf13b7412eb3dc2a70b`.

Keep StoryScope, its Python environment, model credentials, and generated artifacts outside the De-Koi repository:

```sh
git clone https://github.com/jenna-russell/storyscope.git /path/outside/de-koi/storyscope
git -C /path/outside/de-koi/storyscope checkout 642e746804e1ee4138ffdcf13b7412eb3dc2a70b
```

StoryScope’s current feature application command is:

```sh
python -m storyscope.5_feature_application.apply_features \
  --csv /path/to/storyscope-input.csv \
  --taxonomy /path/outside/de-koi/storyscope/data/taxonomy.json \
  --output-dir /path/outside/de-koi/artifacts \
  --parallel 4 \
  --sources human
```

StoryScope calls its input text column `human_story`. De-Koi uses that column and `--sources human` only as a schema adapter so StoryScope will extract features. They are not labels or claims about authorship.

## Corpus

`cases.json` contains 20 synthetic, license-safe prompts. Capture one JSONL row per condition, model, and seed:

```json
{
  "caseId": "quiet-character-conflict",
  "condition": "baseline",
  "model": "provider/model",
  "seed": "1",
  "text": "Generated story text",
  "latencyMs": 1234,
  "inputTokens": 1000,
  "outputTokens": 300
}
```

Each `(caseId, model, seed)` must have exactly one `baseline` row and one `treatment` row. Do not store real user chats in the corpus.

```sh
pnpm eval:narrative-craft:validate -- --input /path/outside/de-koi/corpus.jsonl
pnpm eval:narrative-craft:build -- --input /path/outside/de-koi/corpus.jsonl --output /path/outside/de-koi/storyscope-input.csv
```

The build command also writes `storyscope-input.csv.manifest.json`, which maps numeric StoryScope prompt IDs back to the paired case metadata and performance measurements.

## Feature summary

After feature extraction, flatten the relevant StoryScope features to CSV with one row per generated text and feature:

```csv
caseId,condition,model,seed,latencyMs,inputTokens,outputTokens,featureId,present
quiet-character-conflict,baseline,provider/model,1,1234,1000,300,forced_escalation,true
quiet-character-conflict,treatment,provider/model,1,1350,1080,290,forced_escalation,false
```

Then run:

```sh
pnpm eval:narrative-craft:summarize -- --input /path/outside/de-koi/features.csv --output /path/outside/de-koi/summary.json
```

The summary reports matched pairs, missing pairs, per-feature prevalence deltas, median latency, and total token deltas. It deliberately does not collapse the findings into a detector score.

## Release gates

Use at least 20 cases across two materially different model families, with baseline and treatment output for each. Report both the full matrix and the subset where Narrative Craft produced validated guidance. Ship only when the intervention subset improves targeted StoryScope features without creating a near-universal replacement device, blind review preserves voice/continuity/genre/agency, and foreground p95 overhead remains below 100 ms. Report detached critic duration, activation rate, and token cost separately; they are resource costs, not reply latency. StoryScope diagnostics and human review are equal gates.
