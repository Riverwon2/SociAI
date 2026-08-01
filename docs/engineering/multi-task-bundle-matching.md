# Multi-task bundle matching

## Intentional boundary

The Agent decomposes a natural-language request into tasks and records each task's time and duration source. Deterministic code, not the Agent, groups tasks, selects candidates, and validates schedule conflicts.

## Bundle rules

- A task with no task-specific time inherits the initial request window and is flexible.
- An LLM-estimated duration is valid only when it is 20 minutes or less.
- A helper bundle may contain at most 30 active minutes and 20 waiting minutes between fixed tasks.
- Route, map, and real-distance data are out of scope. The deterministic planner uses task windows, experience, availability, and reliability only.
- If a bundle cannot be assigned to one eligible candidate, it is split into individual task bundles. An insufficient overall request window holds only the affected task.

## Ownership

- A (`apps/server`) validates the OpenAI task plan and emits bundle and assignment events.
- B (`packages/decisions`, `packages/simulator`) owns bundle feasibility and deterministic assignment.
- C (`packages/contracts`, `packages/event-stream`, `apps/web`, `tests/e2e`) owns shared schemas, fixtures, event transport, and presentation.

Any change to `TaskBundle`, `Assignment`, or related event/tool contracts requires A, B, and C compatibility review, contract tests, and fixture updates.
