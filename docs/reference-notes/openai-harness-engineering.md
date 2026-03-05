# OpenAI Codex Harness Mapping Notes

Source: [Unlocking the Codex harness: how we built the App Server](https://openai.com/index/unlocking-the-codex-harness/)

The article describes a stable orchestration design with three core parts relevant to this repo:

1. Thread lifecycle and persistence.
2. Conversation turns for richer, multi-step interactions.
3. Item lifecycle (`item/started`, optional `item/*/delta`, `item/completed`) for incremental output.

## Mapping this vault to that pattern

- `thread` maps to one source material chunk per manager (for example one interview, one podcast episode, or one book section).
- `turn` maps to one logical segment inside a source (one question block, chapter, section, or clip).
- `item` maps to one traceable quote.

This map lets an LLM answer in a verifiable way:
1. Resolve manager profile,
2. Load relevant source threads,
3. Retrieve quote-level items,
4. Return quote text plus `source_url_with_anchor`.

## URL anchor convention

For time-coded media, use the platform format in `source_url_with_anchor`, typically `?t=<seconds>s` for YouTube-like players.
