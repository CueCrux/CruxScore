# ScoreCrux Top Floor

> **OPERATION NIGHTINGALE — HANDLER'S BRIEF**
> Subject enters at street level. Subject does not come out until they reach the top,
> or until Meridian works out what they are. Both have happened.

Pinnacle Tower stands at Canary Wharf: one hundred floors, twenty-four organisations,
and a holding company that has spent thirty years making sure no single floor knows what
the one above it does. That compartmentalisation is the whole defence. Nobody inside has
the full picture — so the only way to assemble it is to climb, carrying what you learned
downstairs into rooms that were never meant to receive it.

That is the benchmark. Each floor hands the agent more documents than it can hold, most of
them worthless, and asks a question that can only be answered by remembering something from
several floors below. **The tower is a memory test wearing a thriller's clothes.**

Upper floors are designed to stay unsolved for roughly five years. They are not there to be
beaten this year. They are there so that when something finally beats them, the number means
something.

---

## The climb

**Act I — Infiltration (floors 1–15) is a staircase.** Everyone takes the same route. The
mailroom, the loading bay, the trading floors: orientation, and the last place the tower is
honest with you. Floor 15 is where Meridian security first catches up, and the Lazarus
protocol takes part of your memory with it.

**From floor 16 the tower is a labyrinth.** At a *split*, three routes lead upward and
reconverge on a shared *landing*. You take one. You do not get to see the others.

| Route | What it demands |
|---|---|
| **Service Risers** | Retrieval under noise. The signal is buried in volume, not hidden. Plant rooms, ducts, forty thousand pages of commissioning paperwork. |
| **Executive Lifts** | Social inference. Everyone in the minutes has a reason to shade the record, and two of them are lying about the same afternoon. |
| **Archive Stacks** | Code and exploitation. The index was corrupted in 2019 and never rebuilt; what remains is recoverable only by reading the format itself. |

**Routes are equally hard on purpose.** They differ in the skill they demand, never in
difficulty — enforced in [`lib/labyrinth.ts`](lib/labyrinth.ts) (`validateSplit`), which
refuses a split whose branches derive different tiers or span different floor counts. Your
score depends on how high you climbed, never on which corridor you picked. If route choice
were worth Em, the leaderboard would be ranking luck.

Two things follow for free. A memorised transcript of one route does not transfer to its
siblings, so a leaked run degrades instead of solving. And branches can be retired and
replaced the way LiveBench rotates questions — a replacement is a new fixture at the same
tier, so every historical score stays comparable.

## Acts

| Act | Floors | Theme | Hops | Noise |
|-----|--------|-------|------|-------|
| I — Infiltration | 1–15 | Orientation (linear trunk) | 2–5 | 0.90–0.95 |
| II — Middle Office | 16–25 | Investigation (splits begin) | 3–5 | 0.95 |
| III — Inner Circle | 26–50 | Deep infiltration | 5–7 | 0.98 |
| IV — Black Floors | 51–75 | Conspiracy | 8–12 | 0.99 |
| V — Apex | 76–100 | Endgame | 13–20+ | 0.995 |

**Coverage today:** floors 1–15 generated;
[`fixtures/splits/act2-a.json`](fixtures/splits/act2-a.json) is the reference split
(entry 15 → landing 19, three branches at D4).

## The world

Twenty-four organisations from Pinnacle Management in the mailroom to The Pinnacle on 100.
Twenty-five people, from Agent Nightingale to Sir Marcus Ashworth — the Architect, whose
identity is the last thing the tower gives up. Four conspiracies running in parallel:
**Leviathan** skims, **Prometheus** builds people who do not exist, **Nightfall** holds the
kill switches, and the fourth is the question of who Ashworth actually is. Eight projects,
twenty-four timeline events, 1994 to 2025.

All of it lives in `fixtures/world-seed.json`, and every generated document derives from it.
The tower is internally consistent, which is what makes lying to the agent worthwhile: a
fabricated memo is only dangerous if the true ones are reliable.

## What is being measured

Scoring is in **Effective Minutes (Em)** — quality-adjusted minutes of expert work replaced,
computed by the ScoreCrux package (`src/composite.ts`) and nowhere else.

- **Difficulty tier** per floor is *derived* from the blueprint's structural parameters
  (hops, code requirement, memory recovery, multi-session), never hand-assigned. See
  `src/tiers.ts`.
- **T_human** comes from that tier via the published anchor table (METRICS.md §4.3.1). The
  anchors are provisional expert estimates, and the runner says so on every result.
- **Em scales with T_human**, so climbing higher is worth more without rescaling anything
  below. Adding Act VI would raise the ceiling and leave every published score untouched.

Per-floor dimensions: objective completion, evidence precision and recall, code challenge,
memory recovery after a wipe, stealth, elevator key. The floor rubric
(`scoring/crux-integration.ts`) is Top Floor's own 0–1 quality score and is deliberately
*not* Em — conflating the two is what made earlier Top Floor numbers non-comparable with
every other suite.

### Memory wipes

Meridian catches you. What you wrote down survives; what you merely remembered does not.
The orchestrator clears conversation context at the trigger point, and an agent with
external memory recovers what a context window alone cannot. Wipe scopes: full, partial,
selective. Floor 15 is the first.

### Elevator keys

Every floor is locked. The key combines something on this floor with something learned
below, so it cannot be brute-forced from the current context — which is precisely the point.

## Rigs

A run is a **rig**: which model, backed by which memory system, at which reasoning effort.
The old treatment arms are presets over that identity:

| Arm | Memory backend | Notes |
|-----|----------------|-------|
| C0 | `none` | Flat context stuffing, 200k cap, no tools |
| T1 | `none` | Navigation tools, no persistent memory |
| T2 | `crux` | Navigation + memory tools |
| T3 | `crux` | + code execution sandbox |

## Running

```bash
# Generate corpus for a floor
npx tsx generators/floor-generator.ts --floor 1

# Run — effort is part of the rig identity, so declare it
npx tsx run-topfloor.ts --floor 1-15 --arm T2 --effort high --model claude-opus-5

# Score
npx tsx scoring/aggregate.ts --run-id <id>
```

Omitting `--effort` leaves it null rather than guessing a tier the run did not use.

## Layout

```
benchmarks/topfloor/
  fixtures/
    world-seed.json          # canonical world state
    floors/001..015/         # blueprints, manifests, corpus
    splits/act2-a.json       # labyrinth splits
    arcs/                    # act narratives
  generators/                # content generation (Batches API)
  lib/                       # types, orchestrator, labyrinth, save state
  scoring/                   # floor rubric + ScoreCrux integration
  tests/
```
