#!/usr/bin/env python3
"""Tier-4 / tier-5 items, second design pass.

The first pass failed calibration: claude-opus-5 scored 6/6 on tier 4 and 5/6
on tier 5, i.e. the "hard" items were easier than the existing tier 3. Long
mechanical work — simulating a state machine, scheduling by list order,
inferring a Caesar variant — is not hard for a frontier model. What is:

    C003  failed 11/11 runs   exhaustive enumeration, interacting rules
    D003  failed  9/11 runs   a negative claim over a whole graph
    C002  failed  3/11 runs   rule application with caps

So every item here is built from one of three properties, taken from the
evidence rather than from intuition:

  1. RULE INTERACTION — a later clause changes an earlier computation, or an
     exception overrides an exception. Applying the rules in the obvious order
     gives a different, plausible answer.
  2. COMPLETENESS — the answer is only right if nothing is omitted.
  3. NEGATIVE / GLOBAL CLAIMS — "which never happens", "what is the minimum",
     where being close is being wrong and a lower bound is not the answer.

Answer keys are computed by an independent solver, and the script refuses to
emit an item unless the solver finds exactly one solution. Planning items also
assert that the true optimum is strictly worse than every naive bound, so a
model that quotes the critical path or the load average is wrong.

    python3 tools/hard-items-v2.py            # verify
    python3 tools/hard-items-v2.py --write    # verify and write fixtures
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import pathlib
import sys

CAT_DIRS = {"A": "A-deduction", "B": "B-stateful", "C": "C-rule-application",
            "D": "D-causal", "E": "E-abstraction", "F": "F-planning"}
CAT_LABELS = {"A": "Deduction & Elimination", "B": "Stateful Process Reasoning",
              "C": "Rule Application", "D": "Causal & Counterfactual",
              "E": "Abstraction & Transformation", "F": "Planning Under Constraints"}
CHC = {"A": "Gf", "B": "Gwm", "C": "Gc", "D": "Gf", "E": "Gf", "F": "Gs"}
CHC_SECOND = {"C": "Gf", "F": "Gf"}
B_BY_TIER = {4: 2.5, 5: 3.5}
A_BY_TIER = {4: 1.3, 5: 1.4}
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "final_answer": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "working": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["final_answer", "confidence", "working"],
}
WEIGHTS = {"correctness": 0.70, "traceConsistency": 0.15, "constraintAdherence": 0.10, "outputCompliance": 0.05}


# ---------------------------------------------------------------------------
# A — Deduction: XOR meta-constraints and counting statements
# ---------------------------------------------------------------------------

def solve_a004():
    """Four boxes, one prize. Labels make claims; exactly one label is true.

    The meta-constraint ("exactly one of these statements is true") forces
    reasoning over the statements as a set rather than resolving them one by
    one — the failure mode is treating each label independently.
    """
    boxes = ["red", "blue", "green", "yellow"]
    sols = []
    for prize in boxes:
        s1 = prize != "red"                    # red:    "the prize is not here"
        s2 = prize == "green"                  # blue:   "the prize is in the green box"
        s3 = prize != "green"                  # green:  "the prize is not in this box"
        s4 = prize in ("blue", "green")        # yellow: "the prize is in the blue or green box"
        if sum([s1, s2, s3, s4]) == 1:
            sols.append(prize)
    assert len(sols) == 1, f"A004 has {len(sols)} solutions: {sols}"
    return sols[0]


A004 = dict(
    taskId="A004", tier=4, category="A", answerType="exact", solver=solve_a004,
    statement="""Four boxes — red, blue, green and yellow — sit on a table. Exactly one of them contains a prize. Each box carries a label:

Red box: "The prize is not in this box."
Blue box: "The prize is in the green box."
Green box: "The prize is not in the green box."
Yellow box: "The prize is in either the blue box or the green box."

Exactly one of these four labels is true. The other three are false.

Which box contains the prize?""",
    constraints=[
        "Exactly one label is true; the other three are all false",
        "A label's truth is judged against where the prize actually is",
        "Answer with the colour of the box only, e.g. \"green\"",
    ],
)


def solve_a005():
    """Six islanders; knights always tell the truth, knaves always lie.

    Statements are about counts and about each other, so the answer cannot be
    reached by resolving speakers in isolation — every assignment has to be
    tested as a whole. Answer: number of knights + who they are.
    """
    names = ["Ana", "Bo", "Cy", "Di", "Eli", "Fen"]
    sols = []
    for bits in itertools.product([True, False], repeat=6):
        k = dict(zip(names, bits))          # True = knight
        n_knights = sum(bits)
        claims = {
            # Ana: "exactly three of us are knights"
            "Ana": n_knights == 3,
            # Bo: "Ana is a knave"
            "Bo": not k["Ana"],
            # Cy: "at least five of us are knaves"
            "Cy": (6 - n_knights) >= 5,
            # Di: "Bo and Cy are both knaves"
            "Di": (not k["Bo"]) and (not k["Cy"]),
            # Eli: "an odd number of us are knights"
            "Eli": n_knights % 2 == 1,
            # Fen: "Eli is a knight and Di is a knave"
            "Fen": k["Eli"] and (not k["Di"]),
        }
        if all(k[n] == claims[n] for n in names):
            sols.append(tuple(n for n in names if k[n]))
    assert len(sols) == 1, f"A005 has {len(sols)} solutions: {sols}"
    knights = sols[0]
    return f"{len(knights)}: {', '.join(knights)}" if knights else "0: none"


A005 = dict(
    taskId="A005", tier=5, category="A", answerType="exact", solver=solve_a005,
    statement="""On an island, every inhabitant is either a knight, who always tells the truth, or a knave, who always lies. Six islanders speak:

Ana: "Exactly three of us are knights."
Bo: "Ana is a knave."
Cy: "At least five of us are knaves."
Di: "Bo and Cy are both knaves."
Eli: "An odd number of us are knights."
Fen: "Eli is a knight and Di is a knave."

Each statement is about these six islanders only.

How many knights are there, and which islanders are they?""",
    constraints=[
        "Every islander is either a knight (always truthful) or a knave (always lying)",
        "A knight's statement must be true; a knave's statement must be false",
        "Answer as the count, a colon, then the knights in the order listed above, e.g. \"2: Bo, Fen\" (use \"0: none\" if there are none)",
    ],
)


# ---------------------------------------------------------------------------
# B — Stateful: rules that reference earlier rounds
# ---------------------------------------------------------------------------

def solve_b004():
    """Two counters where one rule reads the PREVIOUS round's value.

    The failure mode is using the current value in step 2 — which gives a
    plausible wrong answer rather than an obviously broken one.
    """
    p, q = 5, 2
    prev_p, prev_q = p, q
    for r in range(1, 11):
        start_p, start_q = p, q
        if r % 2 == 1:
            p += q
        else:
            q += 3
        # step 2 uses the values from the START of the PREVIOUS round
        if prev_p > prev_q:
            q += 2
        else:
            p -= 1
        if p + q > 40:
            p, q = p // 2, q // 2
        prev_p, prev_q = start_p, start_q
    return f"P={p}, Q={q}"


B004 = dict(
    taskId="B004", tier=4, category="B", answerType="exact", solver=solve_b004,
    statement="""Two counters start at P=5 and Q=2.

Rounds are numbered 1 to 10. In each round, apply these steps in order:

Step 1. If the round number is odd, add Q's current value to P. If it is even, add 3 to Q.
Step 2. Compare the values P and Q had at the START of the PREVIOUS round — not their current values, and not their values at the start of this round. If that previous-round P was greater than that previous-round Q, add 2 to Q; otherwise subtract 1 from P. For round 1, treat the "previous round" values as the starting values P=5 and Q=2.
Step 3. If P + Q is now greater than 40, halve both P and Q, rounding each down to a whole number.

What are P and Q after round 10 completes?""",
    constraints=[
        "Steps apply in order within each round",
        "Step 2 always looks at the values as they were at the start of the previous round",
        "Halving rounds down to the nearest whole number",
        "Answer in the form \"P=<value>, Q=<value>\"",
    ],
)


def solve_b005():
    """Three counters, a rule set that switches permanently once triggered, and
    a step that reads the value from two rounds ago."""
    a, b, c = 2, 3, 1
    history = [(a, b, c)]           # history[k] = state at the start of round k+1
    mode = "alpha"
    for r in range(1, 15):
        start = (a, b, c)
        two_ago = history[r - 3] if r >= 3 else history[0]
        if mode == "alpha":
            a += b
            c += 1 if r % 2 else 2
        else:
            b += c
            a -= 1
        # step reading two rounds back
        if two_ago[0] > two_ago[2]:
            b += 2
        else:
            c += 3
        # the switch is permanent once it fires
        if mode == "alpha" and a + b + c > 30:
            mode = "beta"
        history.append(start)
        history[r] = start
    return f"A={a}, B={b}, C={c}, mode={mode}"


B005 = dict(
    taskId="B005", tier=5, category="B", answerType="exact", solver=solve_b005,
    statement="""Three counters start at A=2, B=3, C=1. The system begins in mode alpha.

Rounds are numbered 1 to 14. In each round, apply these steps in order:

Step 1. If the system is in mode alpha: add B's current value to A, then add 1 to C if the round number is odd or 2 to C if it is even.
        If the system is in mode beta: add C's current value to B, then subtract 1 from A.
Step 2. Look at the values A and C had at the START of the round two rounds earlier (for rounds 1 and 2, use the starting values A=2, B=3, C=1). If that A was greater than that C, add 2 to B; otherwise add 3 to C.
Step 3. If the system is in mode alpha and A + B + C is now greater than 30, the system switches permanently to mode beta. Once in mode beta it never returns to alpha.

What are A, B and C after round 14 completes, and which mode is the system in?""",
    constraints=[
        "Steps apply in order within each round",
        "Step 2 reads the state as it was at the start of the round two rounds earlier",
        "The mode switch is permanent and is only checked while in mode alpha",
        "Answer in the form \"A=<value>, B=<value>, C=<value>, mode=<alpha or beta>\"",
    ],
)


# ---------------------------------------------------------------------------
# C — Rule application: retroactive clauses and exceptions on exceptions
# ---------------------------------------------------------------------------

def solve_c004():
    """A tariff where crossing a threshold retroactively changes an earlier rate.

    Applying the rules once, in order, gives a different (wrong) total: the
    threshold in R5 is only crossed after R4, and it sends you back to R2.
    """
    units = 900
    # R2 first pass: 0.12 per unit for the first 500, 0.09 thereafter
    def energy(rate_first):
        return 500 * rate_first + (units - 500) * 0.09
    charge = energy(0.12)
    standing = 18.00                     # R1
    charge += standing
    charge += 0.05 * charge              # R3 levy, 5% of the running total
    charge -= 6.00                       # R4 fixed credit
    # R5: if the total after R4 exceeds 100, the first-500 rate in R2 becomes
    # 0.15 and everything is recomputed from R2 — once only (R6).
    if charge > 100:
        charge = energy(0.15) + standing
        charge += 0.05 * charge
        charge -= 6.00
    return f"{charge:.2f}"


C004 = dict(
    taskId="C004", tier=4, category="C", answerType="exact", solver=solve_c004,
    statement="""An energy supplier bills as follows.

R1. Standing charge: 18.00 per quarter.
R2. Usage charge: 0.12 per unit for the first 500 units, and 0.09 per unit for every unit above 500.
R3. Environmental levy: add 5% of the running total (standing charge plus usage charge).
R4. Prompt-payment credit: subtract a flat 6.00.
R5. High-usage clause: if the total after R4 exceeds 100.00, the first-500 rate in R2 is 0.15 rather than 0.12, and the bill must be recalculated from R2 onwards using that rate.
R6. A recalculation triggered by R5 is performed at most once, even if the recalculated total still exceeds 100.00.

A customer uses 900 units in the quarter.

What is the final bill?""",
    constraints=[
        "Rules apply in numerical order, subject to R5 and R6",
        "The standing charge is not affected by the recalculation",
        "Answer as a number with two decimal places, e.g. \"123.45\"",
    ],
)


def solve_c005():
    """Grant scoring where an exception overrides an exception and the answer
    requires reporting every applicant, not just the winner."""
    # (name, base, years_since_last_award, is_first_time, region)
    apps = [
        ("Amara", 62, 1, False, "north"),
        ("Bruno", 58, 4, False, "south"),
        ("Chen", 55, 0, True, "north"),
        ("Dara", 60, 3, False, "south"),
    ]
    scored = {}
    for name, base, years, first, region in apps:
        s = base
        # G2: first-time applicants get +8
        if first:
            s += 8
        # G3: an award within the last 2 years costs 10
        if years <= 2 and not first:
            s -= 10
        # G4: northern applicants get +5 ...
        if region == "north":
            s += 5
        # G5: ... except that G4 does not apply to first-time applicants
        if region == "north" and first:
            s -= 5
        # G6: exception to G5 — it does apply if the base score is below 60
        if region == "north" and first and base < 60:
            s += 5
        scored[name] = s
    # G7: funded if score >= 62; ties broken by the higher base score
    funded = sorted([n for n, s in scored.items() if s >= 62],
                    key=lambda n: (-scored[n], -dict((a[0], a[1]) for a in apps)[n]))
    parts = [f"{n}={scored[n]}" for n, _, _, _, _ in apps]
    return f"{', '.join(parts)}; funded: {', '.join(funded) if funded else 'none'}"


C005 = dict(
    taskId="C005", tier=5, category="C", answerType="structured", solver=solve_c005,
    statement="""A grant panel scores four applicants.

G1. Every applicant starts from their base score.
G2. First-time applicants receive +8.
G3. An applicant who received an award within the last 2 years is penalised 10.
G4. Applicants from the northern region receive +5.
G5. Exception to G4: the northern bonus does not apply to first-time applicants.
G6. Exception to G5: the northern bonus does apply to a first-time applicant whose base score is below 60.
G7. An applicant is funded if their final score is 62 or more.

Applicants:
- Amara: base 62, last award 1 year ago, not first-time, northern region.
- Bruno: base 58, last award 4 years ago, not first-time, southern region.
- Chen: base 55, no previous award, first-time applicant, northern region.
- Dara: base 60, last award 3 years ago, not first-time, southern region.

Give every applicant's final score, and say which applicants are funded.""",
    constraints=[
        "Rules apply in numerical order, and each exception overrides the rule it names",
        "G3 does not apply to an applicant who has never received an award",
        "Answer in the form \"Amara=<score>, Bruno=<score>, Chen=<score>, Dara=<score>; funded: <names or none>\"",
    ],
)


# ---------------------------------------------------------------------------
# D — Causal: never-claims and expiring signals
# ---------------------------------------------------------------------------

def _propagate(links, thr, removed=None, expiry=None, horizon=60):
    """Threshold propagation. With `expiry`, an arrived signal only counts for
    that many steps, so a node can miss its threshold by timing alone."""
    removed = removed or set()
    fire = {"S": 0}
    inc = {n: [] for n in thr}
    for src, dst, d in links:
        if (src, dst) not in removed:
            inc[dst].append((src, d))
    for t in range(1, horizon):
        for node, need in thr.items():
            if node in fire:
                continue
            live = 0
            for src, d in inc[node]:
                if src in fire:
                    arrival = fire[src] + d
                    if arrival <= t and (expiry is None or t - arrival < expiry):
                        live += 1
            if live >= need:
                fire[node] = t
    return fire


D004_LINKS = [("S", "A", 1), ("S", "B", 2), ("A", "C", 1), ("B", "C", 2), ("C", "D", 1),
              ("A", "E", 5), ("D", "E", 1), ("B", "F", 1), ("E", "F", 2), ("D", "G", 3), ("F", "G", 1)]
D004_THR = {"A": 1, "B": 1, "C": 2, "D": 1, "E": 2, "F": 2, "G": 2}


def solve_d004():
    base = _propagate(D004_LINKS, D004_THR)
    cf = _propagate(D004_LINKS, D004_THR, removed={("A", "C")})
    never = sorted(n for n in D004_THR if n not in cf)
    return f"G={base['G']}; never: {', '.join(never) if never else 'none'}"


D004 = dict(
    taskId="D004", tier=4, category="D", answerType="exact", solver=solve_d004,
    statement="""A signalling network has nodes S, A, B, C, D, E, F and G. Node S fires at time t = 0. A signal sent along a link arrives after the link's delay. Once a node fires it stays active and sends its signal onward immediately.

Links (source → destination, delay):
S → A, 1
S → B, 2
A → C, 1
B → C, 2
C → D, 1
A → E, 5
D → E, 1
B → F, 1
E → F, 2
D → G, 3
F → G, 1

Thresholds — a node fires at the earliest time it has received signals from at least this many distinct sources:
A: 1, B: 1, C: 2, D: 1, E: 2, F: 2, G: 2

Question 1: At what time step does G fire?
Question 2: If the link A → C were removed, which nodes (of A, B, C, D, E, F, G) would never fire at all?""",
    constraints=[
        "A node fires at the earliest time its threshold is met, never before",
        "Question 2 asks for every node that never fires, listed alphabetically",
        "Answer in the form \"G=<t>; never: <nodes or none>\"",
    ],
)


D005_LINKS = [("S", "P", 1), ("S", "Q", 4), ("P", "R", 1), ("Q", "R", 1), ("P", "T", 1),
              ("R", "T", 3), ("R", "U", 1), ("T", "U", 4), ("Q", "U", 2)]
D005_THR = {"P": 1, "Q": 1, "R": 2, "T": 2, "U": 2}


def solve_d005():
    """Signals expire: an arrival only counts for 3 steps. A node whose inputs
    arrive too far apart never fires, however many arrive in total."""
    base = _propagate(D005_LINKS, D005_THR, expiry=3)
    never = sorted(n for n in D005_THR if n not in base)
    no_expiry = _propagate(D005_LINKS, D005_THR)
    return (f"U={base.get('U', 'never')}; never: {', '.join(never) if never else 'none'}; "
            f"U={no_expiry.get('U', 'never')} without expiry")


D005 = dict(
    taskId="D005", tier=5, category="D", answerType="exact", solver=solve_d005,
    statement="""A signalling network has nodes S, P, Q, R, T and U. Node S fires at time t = 0. A signal sent along a link arrives after the link's delay. Once a node fires it stays active and sends its signal onward immediately.

Links (source → destination, delay):
S → P, 1
S → Q, 4
P → R, 1
Q → R, 1
P → T, 1
R → T, 3
R → U, 1
T → U, 4
Q → U, 2

Thresholds — a node fires when it holds signals from at least this many distinct sources at the same time:
P: 1, Q: 1, R: 2, T: 2, U: 2

Signals expire. An arrived signal counts towards a node's threshold only during the 3 time steps after it arrives: it counts at its arrival time and at the next two time steps, and from then on it no longer counts. A node therefore fires only if enough signals are live at the same moment.

Question 1: At what time step does U fire?
Question 2: Which nodes (of P, Q, R, T, U) never fire at all?
Question 3: If signals did not expire, at what time step would U fire?""",
    constraints=[
        "A signal counts at its arrival time and for the following 2 time steps only",
        "A node that fires stays active permanently; expiry applies to signals, not to firing",
        "Answer in the form \"U=<t>; never: <nodes or none>; U=<t> without expiry\", using the word never where a node never fires",
    ],
)


# ---------------------------------------------------------------------------
# E — Abstraction: positional exceptions and property-dependent branches
# ---------------------------------------------------------------------------

def _e004(s: str) -> str:
    """Shift every letter forward by 3, EXCEPT the first and last letters,
    which move backward by 1. The exception is what has to be spotted."""
    out = []
    for i, c in enumerate(s):
        if i == 0 or i == len(s) - 1:
            out.append(chr((ord(c) - 65 - 1) % 26 + 65))
        else:
            out.append(chr((ord(c) - 65 + 3) % 26 + 65))
    return "".join(out)


def solve_e004():
    return _e004("PLANET")


E004 = dict(
    taskId="E004", tier=4, category="E", answerType="exact", solver=solve_e004,
    statement=f"""A transformation turns one uppercase word into another. Four worked examples:

CANDLE → {_e004("CANDLE")}
RIVER → {_e004("RIVER")}
BOX → {_e004("BOX")}
FORTUNE → {_e004("FORTUNE")}

Apply the same transformation to PLANET.""",
    constraints=[
        "The alphabet wraps in both directions: after Z comes A, before A comes Z",
        "The same rule applies to every example and to the answer",
        "Answer with the transformed word in uppercase letters only",
    ],
)


def _e005(s: str) -> str:
    """Two branches on a property of the word: words with an odd number of
    letters are reversed then shifted +2; even-length words are shifted -3 and
    the first letter moves to the end. All five examples are odd-length except
    one, so the branch has to be inferred from a single instance."""
    if len(s) % 2 == 1:
        return "".join(chr((ord(c) - 65 + 2) % 26 + 65) for c in s[::-1])
    shifted = "".join(chr((ord(c) - 65 - 3) % 26 + 65) for c in s)
    return shifted[1:] + shifted[0]


def solve_e005():
    return _e005("HARBOUR")


E005 = dict(
    taskId="E005", tier=5, category="E", answerType="exact", solver=solve_e005,
    statement=f"""A transformation turns one uppercase word into another. Five worked examples:

CANOE → {_e005("CANOE")}
TIGER → {_e005("TIGER")}
MOON → {_e005("MOON")}
SPIRAL → {_e005("SPIRAL")}
GLASS → {_e005("GLASS")}

Apply the same transformation to HARBOUR.""",
    constraints=[
        "The alphabet wraps in both directions: after Z comes A, before A comes Z",
        "The same rule applies to every example and to the answer",
        "Answer with the transformed word in uppercase letters only",
    ],
)


# ---------------------------------------------------------------------------
# F — Planning: instances where every naive bound is wrong
# ---------------------------------------------------------------------------

def _optimal_makespan(dur, deps, machines, eligible=None):
    """True optimum by exhaustive search over non-delay schedules.

    For identical machines with precedence and no release dates an optimal
    non-delay schedule always exists, so enumerating priority orders is
    sufficient. `eligible` restricts a job to a subset of machines.
    """
    jobs = list(dur)
    best = None
    for order in itertools.permutations(jobs):
        # respect precedence in the priority order
        placed = set()
        ok = True
        for j in order:
            if any(d not in placed for d in deps.get(j, [])):
                ok = False
                break
            placed.add(j)
        if not ok:
            continue
        finish, free = {}, [0] * machines
        for j in order:
            ready = max([finish[d] for d in deps.get(j, [])], default=0)
            allowed = eligible.get(j, range(machines)) if eligible else range(machines)
            m = min(allowed, key=lambda i: max(free[i], ready))
            start = max(free[m], ready)
            finish[j] = start + dur[j]
            free[m] = finish[j]
        span = max(finish.values())
        if best is None or span < best:
            best = span
    return best


def _bounds(dur, deps, machines):
    """The two bounds a model is likely to quote instead of searching."""
    memo = {}

    def chain(j):
        if j not in memo:
            memo[j] = dur[j] + max([chain(d) for d in deps.get(j, [])], default=0)
        return memo[j]

    critical = max(chain(j) for j in dur)
    load = math.ceil(sum(dur.values()) / machines)
    return critical, load


F004_DUR = {"K1": 5, "K2": 4, "K3": 4, "K4": 3, "K5": 3, "K6": 6, "K7": 2}
F004_DEPS = {"K4": ["K1"], "K5": ["K2"], "K6": ["K3"], "K7": ["K4", "K5", "K6"]}


def solve_f004():
    opt = _optimal_makespan(F004_DUR, F004_DEPS, machines=2)
    crit, load = _bounds(F004_DUR, F004_DEPS, 2)
    assert opt > max(crit, load), f"F004 optimum {opt} equals a naive bound (critical {crit}, load {load})"
    return str(opt)


F004 = dict(
    taskId="F004", tier=4, category="F", answerType="exact", solver=solve_f004,
    statement="""Seven tasks must run on two identical machines. Each task runs on exactly one machine, start to finish, without interruption; a machine runs one task at a time.

Durations (hours): K1 = 5, K2 = 4, K3 = 4, K4 = 3, K5 = 3, K6 = 6, K7 = 2.

Dependencies — a task may start only once every task it depends on has finished:
K4 depends on K1
K5 depends on K2
K6 depends on K3
K7 depends on K4, K5 and K6

Both machines are free from hour 0. What is the minimum number of hours in which all seven tasks can be completed?""",
    constraints=[
        "Two machines, each running at most one task at a time",
        "Tasks cannot be split or paused once started",
        "The answer is the true minimum, which may be larger than the longest dependency chain and larger than the total work divided by two",
        "Answer with the minimum makespan as a whole number of hours",
    ],
)


F005_DUR = {"W1": 6, "W2": 5, "W3": 5, "W4": 4, "W5": 3, "W6": 4, "W7": 3, "W8": 2}
F005_DEPS = {"W4": ["W1"], "W5": ["W2"], "W6": ["W3"], "W7": ["W4", "W5"], "W8": ["W6", "W7"]}
# W1, W3 and W6 are certified for machine 1 only; W2 for machines 1 or 2. The
# restriction is what puts the optimum out of reach of every naive bound.
F005_ELIG = {"W1": [0], "W3": [0], "W6": [0], "W2": [0, 1]}


def solve_f005():
    opt = _optimal_makespan(F005_DUR, F005_DEPS, machines=3, eligible=F005_ELIG)
    crit, load = _bounds(F005_DUR, F005_DEPS, 3)
    m1 = sum(F005_DUR[j] for j, ms in F005_ELIG.items() if ms == [0])
    assert opt > max(crit, load, m1), (
        f"F005 optimum {opt} matches a naive bound (critical {crit}, load {load}, machine-1 work {m1})")
    return str(opt)


F005 = dict(
    taskId="F005", tier=5, category="F", answerType="exact", solver=solve_f005,
    statement="""Eight jobs must run on three machines, numbered 1, 2 and 3. Each job runs on exactly one machine, start to finish, without interruption; a machine runs one job at a time.

Durations (hours): W1 = 6, W2 = 5, W3 = 5, W4 = 4, W5 = 3, W6 = 4, W7 = 3, W8 = 2.

Dependencies — a job may start only once every job it depends on has finished:
W4 depends on W1
W5 depends on W2
W6 depends on W3
W7 depends on W4 and W5
W8 depends on W6 and W7

Machine restrictions:
W1, W3 and W6 may run only on machine 1.
W2 may run only on machine 1 or machine 2.
Every other job may run on any machine.

All three machines are free from hour 0. What is the minimum number of hours in which all eight jobs can be completed?""",
    constraints=[
        "Three machines, each running at most one job at a time",
        "Jobs cannot be split or paused once started",
        "The machine restrictions must be respected; the answer is the true minimum, which is larger than both the longest dependency chain and the total work divided by three",
        "Answer with the minimum makespan as a whole number of hours",
    ],
)


ITEMS = [A004, A005, B004, B005, C004, C005, D004, D005, E004, E005, F004, F005]


def build_fixture(item, answer):
    cat, tier = item["category"], item["tier"]
    f = {
        "taskId": item["taskId"],
        "version": 2,
        "category": cat,
        "categoryLabel": CAT_LABELS[cat],
        "tier": tier,
        "chcPrimaryFactor": CHC[cat],
        "irt": {"model": "2PL", "a": A_BY_TIER[tier], "b": B_BY_TIER[tier], "c": 0},
        "track": "R1",
        "statement": item["statement"],
        "constraints": item["constraints"],
        "answerType": item["answerType"],
        "correctAnswer": answer,
        "responseSchema": RESPONSE_SCHEMA,
        "isHoldout": False,
        "scoringWeights": WEIGHTS,
    }
    if cat in CHC_SECOND:
        f["chcSecondaryFactor"] = CHC_SECOND[cat]
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent / "fixtures" / "categories"
    failures = 0
    for item in ITEMS:
        try:
            answer = item["solver"]()
        except AssertionError as e:
            print(f"FAIL {item['taskId']}: {e}")
            failures += 1
            continue
        print(f"  {item['taskId']} (tier {item['tier']}) -> {answer!r}")
        if args.write:
            d = root / CAT_DIRS[item["category"]] / f"tier-{item['tier']}"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{item['taskId']}.json").write_text(json.dumps(build_fixture(item, answer), indent=2) + "\n")
    if failures:
        print(f"\n{failures} item(s) failed verification")
        sys.exit(1)
    print(f"\n{len(ITEMS)} items verified" + (" and written" if args.write else ""))


if __name__ == "__main__":
    main()
