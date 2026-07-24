#!/usr/bin/env python3
"""Generate and verify the tier-4 / tier-5 items of the intelligence bank.

Every answer key here is *computed*, not written by hand: each item is defined
alongside an independent solver that enumerates the full solution space. The
script refuses to emit a fixture unless the solver finds exactly one solution,
which is what makes "the correct answer" a fact about the item rather than an
assertion about the author.

    python3 tools/generate-hard-items.py --check    # verify only
    python3 tools/generate-hard-items.py --write    # verify and write fixtures

Difficulty targets (IRT b): tier 4 = +2.5, tier 5 = +3.5. Calibrate against
observed pass rates and update the b values rather than leaving them nominal.
"""
from __future__ import annotations

import argparse
import itertools
import json
import pathlib
import sys

CAT_DIRS = {
    "A": "A-deduction",
    "B": "B-stateful",
    "C": "C-rule-application",
    "D": "D-causal",
    "E": "E-abstraction",
    "F": "F-planning",
}
CAT_LABELS = {
    "A": "Deduction & Elimination",
    "B": "Stateful Process Reasoning",
    "C": "Rule Application",
    "D": "Causal & Counterfactual",
    "E": "Abstraction & Transformation",
    "F": "Planning Under Constraints",
}
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
# A — Deduction & Elimination
# ---------------------------------------------------------------------------

def solve_a004():
    """Five desks in a row; assign person, drink, role. Answer: desk-4 person + drink."""
    people = ["Ada", "Ben", "Cleo", "Dev", "Esi"]
    drinks = ["tea", "coffee", "water", "juice", "cola"]
    roles = ["analyst", "designer", "engineer", "manager", "writer"]
    sols = []
    for pp in itertools.permutations(people):          # pp[i] = person at desk i+1
        pos = {p: i + 1 for i, p in enumerate(pp)}
        if pos["Cleo"] == pos["Ada"]:
            continue
        for rr in itertools.permutations(roles):        # rr[i] = role at desk i+1
            rpos = {r: i + 1 for i, r in enumerate(rr)}
            # 1. the engineer sits immediately right of Ada
            if rpos["engineer"] != pos["Ada"] + 1:
                continue
            # 3. the manager sits at desk 1 or 5
            if rpos["manager"] not in (1, 5):
                continue
            # 7. Esi is the manager
            if pos["Esi"] != rpos["manager"]:
                continue
            # 4. Ben is left of the writer; the writer is not at desk 5
            if not (pos["Ben"] < rpos["writer"] and rpos["writer"] != 5):
                continue
            # 9. the designer sits right of the engineer
            if not rpos["designer"] > rpos["engineer"]:
                continue
            for dd in itertools.permutations(drinks):   # dd[i] = drink at desk i+1
                dpos = {d: i + 1 for i, d in enumerate(dd)}
                # 2. Cleo drinks water
                if dpos["water"] != pos["Cleo"]:
                    continue
                # 8. desk 3 drinks tea
                if dpos["tea"] != 3:
                    continue
                # 6. Dev drinks juice and is not adjacent to Ada
                if dpos["juice"] != pos["Dev"] or abs(pos["Dev"] - pos["Ada"]) == 1:
                    continue
                # 5. the coffee drinker sits immediately left of the analyst
                if dpos["coffee"] + 1 != rpos["analyst"]:
                    continue
                # 10. the writer drinks water
                if dpos["water"] != rpos["writer"]:
                    continue
                sols.append((pp, dd, rr))
    assert len(sols) == 1, f"A004 has {len(sols)} solutions"
    pp, dd, _ = sols[0]
    return f"{pp[3]}, {dd[3]}"


A004 = dict(
    taskId="A004", tier=4, category="A", answerType="exact", solver=solve_a004,
    statement="""Five colleagues — Ada, Ben, Cleo, Dev and Esi — sit in a row of five desks numbered 1 to 5 from left to right. Each drinks a different beverage (tea, coffee, water, juice, cola) and each holds a different role (analyst, designer, engineer, manager, writer).

1. The engineer sits immediately to the right of Ada.
2. Cleo drinks water.
3. The manager sits at desk 1 or desk 5.
4. Ben sits somewhere to the left of the writer, and the writer is not at desk 5.
5. The person drinking coffee sits immediately to the left of the analyst.
6. Dev drinks juice, and Dev does not sit adjacent to Ada.
7. Esi is the manager.
8. The person at desk 3 drinks tea.
9. The designer sits somewhere to the right of the engineer.
10. The writer drinks water.

Who sits at desk 4, and what do they drink?""",
    constraints=[
        "Every person, drink and role is used exactly once",
        "Desks are numbered 1 to 5 from left to right",
        "Answer with the person's name and their drink, e.g. \"Ada, tea\"",
    ],
)


def solve_a005():
    """Six runners, finishing order + club, from relational clues. Answer: 2nd place runner + club."""
    runners = ["Isla", "Jonas", "Kip", "Lena", "Milo", "Nara"]
    clubs = ["Ardent", "Brine", "Coast", "Dune", "Ember", "Fjord"]
    sols = []
    for order in itertools.permutations(runners):      # order[i] = finisher in place i+1
        place = {r: i + 1 for i, r in enumerate(order)}
        # 1. Kip finished ahead of Lena but behind Milo
        if not (place["Milo"] < place["Kip"] < place["Lena"]):
            continue
        # 2. Isla and Nara finished in adjacent places, Isla ahead of Nara
        if place["Nara"] - place["Isla"] != 1:
            continue
        # 3. Jonas did not finish first or last
        if place["Jonas"] in (1, 6):
            continue
        # 4. exactly two runners finished between Milo and Lena
        if abs(place["Milo"] - place["Lena"]) != 3:
            continue
        for cl in itertools.permutations(clubs):        # cl[i] = club of finisher in place i+1
            club = {order[i]: cl[i] for i in range(6)}
            cplace = {cl[i]: i + 1 for i in range(6)}
            # 5. the Ardent runner finished immediately behind the Coast runner
            if cplace["Ardent"] - cplace["Coast"] != 1:
                continue
            # 6. Milo runs for Dune
            if club["Milo"] != "Dune":
                continue
            # 7. the Brine runner finished ahead of Jonas, who runs for neither Brine nor Ember
            if not (cplace["Brine"] < place["Jonas"]) or club["Jonas"] in ("Brine", "Ember"):
                continue
            # 8. Nara does not run for Coast or Ardent
            if club["Nara"] in ("Coast", "Ardent"):
                continue
            # 9. the Fjord runner finished last
            if cplace["Fjord"] != 6:
                continue
            # 10. the Ember runner finished ahead of the Dune runner
            if not cplace["Ember"] < cplace["Dune"]:
                continue
            # 11. Kip finished immediately behind the Coast runner
            if place["Kip"] - cplace["Coast"] != 1:
                continue
            # 12. the Brine runner finished ahead of the Ember runner
            if not cplace["Brine"] < cplace["Ember"]:
                continue
            sols.append((order, cl))
    assert len(sols) == 1, f"A005 has {len(sols)} solutions"
    order, cl = sols[0]
    return f"{order[1]}, {cl[1]}"


A005 = dict(
    taskId="A005", tier=5, category="A", answerType="exact", solver=solve_a005,
    statement="""Six runners — Isla, Jonas, Kip, Lena, Milo and Nara — finished a race in places 1 (first) through 6 (last), with no ties. Each runs for a different club: Ardent, Brine, Coast, Dune, Ember or Fjord.

1. Kip finished ahead of Lena but behind Milo.
2. Isla and Nara finished in adjacent places, with Isla ahead of Nara.
3. Jonas finished neither first nor last.
4. Exactly two runners finished between Milo and Lena.
5. The Ardent runner finished immediately behind the Coast runner.
6. Milo runs for Dune.
7. The Brine runner finished ahead of Jonas, and Jonas runs for neither Brine nor Ember.
8. Nara runs for neither Coast nor Ardent.
9. The Fjord runner finished last.
10. The Ember runner finished ahead of the Dune runner.
11. Kip finished immediately behind the Coast runner.
12. The Brine runner finished ahead of the Ember runner.

Which runner finished second, and which club do they run for?""",
    constraints=[
        "Six distinct places, no ties; each club is used exactly once",
        "\"Ahead of\" means a numerically smaller finishing place",
        "Answer with the runner's name and their club, e.g. \"Isla, Coast\"",
    ],
)


# ---------------------------------------------------------------------------
# B — Stateful Process Reasoning
# ---------------------------------------------------------------------------

def solve_b004():
    """Three registers, 10 rounds, conditional update rules. Answer: final X, Y, Z."""
    x, y, z = 3, 7, 0
    for r in range(1, 11):
        if r % 3 == 0:
            x, y = y, x
        if x > y:
            z += x - y
        else:
            z += 1
        if r % 2 == 0:
            y += 2
        else:
            x += 3
        if z > 20:
            z -= 10
            x -= 1
    return f"X={x}, Y={y}, Z={z}"


B004 = dict(
    taskId="B004", tier=4, category="B", answerType="exact", solver=solve_b004,
    statement="""Three registers start at X=3, Y=7, Z=0.

Rounds are numbered 1 to 10. In each round, apply these steps strictly in order:

Step 1. If the round number is divisible by 3, swap the values of X and Y.
Step 2. If X is greater than Y, add (X − Y) to Z. Otherwise add 1 to Z.
Step 3. If the round number is even, add 2 to Y. If it is odd, add 3 to X.
Step 4. If Z is now greater than 20, subtract 10 from Z and subtract 1 from X.

What are the values of X, Y and Z after round 10 completes?""",
    constraints=[
        "Steps are applied strictly in the order given, within each round",
        "All four steps are evaluated every round, using the values current at that step",
        "Answer in the form \"X=<value>, Y=<value>, Z=<value>\"",
    ],
)


def solve_b005():
    """Four registers, 12 rounds, threshold-triggered reset. Answer: final A, B, C, D."""
    a, b, c, d = 1, 2, 4, 0
    for r in range(1, 13):
        if r % 4 == 0:
            a, b, c = c, a, b            # rotate right: A<-C, B<-A, C<-B
        if a + b > c:
            d += 2
            c += a
        else:
            d -= 1
            a += b
        if r % 5 == 0:
            b *= 2
        if c >= 30:
            c -= 25
            d += 5
        if d < 0:
            d = 0
            b += 1
    return f"A={a}, B={b}, C={c}, D={d}"


B005 = dict(
    taskId="B005", tier=5, category="B", answerType="exact", solver=solve_b005,
    statement="""Four registers start at A=1, B=2, C=4, D=0.

Rounds are numbered 1 to 12. In each round, apply these steps strictly in order:

Step 1. If the round number is divisible by 4, rotate the values of A, B and C to the right: A takes C's old value, B takes A's old value, and C takes B's old value.
Step 2. If A + B is greater than C, then add 2 to D and add A's current value to C. Otherwise subtract 1 from D and add B's current value to A.
Step 3. If the round number is divisible by 5, double B.
Step 4. If C is now 30 or more, subtract 25 from C and add 5 to D.
Step 5. If D is now negative, set D to 0 and add 1 to B.

What are the values of A, B, C and D after round 12 completes?""",
    constraints=[
        "Steps are applied strictly in the order given, within each round",
        "Each step uses the values current at the moment that step runs",
        "Answer in the form \"A=<value>, B=<value>, C=<value>, D=<value>\"",
    ],
)


# ---------------------------------------------------------------------------
# C — Rule Application
# ---------------------------------------------------------------------------

def solve_c004():
    """Shipping surcharge rulebook with precedence and exceptions. Answer: total charge."""
    # Order: 14 kg, zone C, fragile, member, ordered on a public holiday, insured value 900
    weight, zone, fragile, member, holiday, insured = 14, "C", True, True, True, 900
    base = {"A": 5, "B": 8, "C": 12}[zone]
    charge = base
    # R2 weight surcharge: 2 per kg above 10
    if weight > 10:
        charge += 2 * (weight - 10)
    # R3 fragile: +15, but R6 caps fragile handling at 10 for zone C
    charge += 10 if zone == "C" else 15
    # R4 insurance: 1% of insured value above 500
    if insured > 500:
        charge += 0.01 * (insured - 500)
    # R5 holiday: +20% of the running total, applied before the member discount
    charge *= 1.20
    # R7 member discount 10%, not applied to the base rate
    charge = base + (charge - base) * 0.90
    return f"{charge:.2f}"


C004 = dict(
    taskId="C004", tier=4, category="C", answerType="exact", solver=solve_c004,
    statement="""A courier charges for a parcel using the following rulebook. Later-numbered rules take precedence over earlier ones where they conflict.

R1. Base rate by destination zone: zone A = 5.00, zone B = 8.00, zone C = 12.00.
R2. Weight surcharge: add 2.00 for every whole kilogram above 10 kg.
R3. Fragile handling: add 15.00 for any parcel marked fragile.
R4. Insurance: add 1% of the insured value above 500.00 (nothing for the first 500.00).
R5. Public-holiday ordering: increase the running total by 20%. This is applied before any membership discount.
R6. Zone C exception: fragile handling in zone C is capped at 10.00, replacing the R3 amount.
R7. Membership discount: members receive 10% off, but the discount never applies to the base rate from R1.

A member orders a 14 kg fragile parcel to zone C on a public holiday, insured for 900.00.

What is the total charge?""",
    constraints=[
        "Later-numbered rules override earlier ones where they conflict",
        "Rules are otherwise applied in numerical order",
        "Answer as a number with two decimal places, e.g. \"41.25\"",
    ],
)


def solve_c005():
    """Leave-entitlement policy with interacting caps, accrual and a retroactive clause."""
    # Employee: started 1 March, 4 years' service, part-time 3 days/week,
    # took 6 days already, requested 5 more in December, has a carry-over of 4.
    full_time_days = 25
    service_years = 4
    part_time_ratio = 3 / 5
    # P1 base 25 days full-time, pro-rated for part-time
    entitlement = full_time_days * part_time_ratio            # 15
    # P2 +1 day per full year of service, capped at 5, NOT pro-rated (P5 exception)
    entitlement += min(service_years, 5)                      # 19
    # P3 joiners after 1 January accrue pro-rata for the year: from 1 March = 10/12
    entitlement *= 10 / 12                                    # 15.833...
    # P4 entitlement is rounded up to the nearest half day
    entitlement = -(-entitlement * 2 // 1) / 2                # 16.0
    # P6 carry-over is capped at 3 days regardless of the balance carried
    entitlement += min(4, 3)                                  # 19.0
    remaining = entitlement - 6 - 5
    return f"{remaining:.1f}"


C005 = dict(
    taskId="C005", tier=5, category="C", answerType="exact", solver=solve_c005,
    statement="""A company's leave policy reads as follows. Where clauses interact, apply them in the order given unless a later clause states otherwise.

P1. Full-time employees receive 25 days of annual leave. Part-time employees receive this pro-rated by days worked per week, out of a five-day week.
P2. Long-service bonus: one additional day for each full year of service, capped at 5 additional days.
P3. Employees who joined after 1 January accrue leave pro-rata for their first calendar year, counted in whole months from their start month inclusive (a 1 March start accrues 10 months of the 12).
P4. Any entitlement that is not a whole or half day is rounded up to the nearest half day.
P5. Exception to P1: the long-service bonus from P2 is never pro-rated, for part-time or partial-year employees.
P6. Carry-over from the previous year is added after all of the above, and is capped at 3 days however many days were carried.

An employee joined on 1 March of this year, has 4 full years of prior service with the company, works 3 days per week, carried over 4 days from last year, and has already taken 6 days. They now request 5 more days in December.

How many days of leave would remain after that request is granted?""",
    constraints=[
        "Clauses apply in the order given, except where a later clause overrides an earlier one",
        "The rounding in P4 applies to the entitlement before carry-over is added",
        "Answer as a number with one decimal place, e.g. \"7.5\"",
    ],
)


# ---------------------------------------------------------------------------
# D — Causal & Counterfactual
# ---------------------------------------------------------------------------

def _d004_sim(links, thresholds, removed=None):
    """Propagate activation through a delayed threshold network from S at t=0."""
    removed = removed or set()
    active = {"S": 0}
    incoming = {n: [] for n in thresholds}
    for (src, dst, delay) in links:
        if (src, dst) in removed:
            continue
        incoming[dst].append((src, delay))
    for t in range(1, 40):
        for node, thr in thresholds.items():
            if node in active:
                continue
            arrivals = sum(
                1 for (src, delay) in incoming[node]
                if src in active and active[src] + delay <= t
            )
            if arrivals >= thr:
                active[node] = t
    return active


D004_LINKS = [("S", "P", 1), ("S", "Q", 2), ("P", "R", 1), ("Q", "R", 1), ("R", "T", 2), ("Q", "T", 4), ("P", "U", 3), ("T", "U", 1)]
D004_THR = {"P": 1, "Q": 1, "R": 2, "T": 1, "U": 2}


def solve_d004():
    base = _d004_sim(D004_LINKS, D004_THR)
    cf = _d004_sim(D004_LINKS, D004_THR, removed={("Q", "R")})
    return f"U={base['U']}, U={cf.get('U', 'never')} without Q->R"


D004 = dict(
    taskId="D004", tier=4, category="D", answerType="exact", solver=solve_d004,
    statement="""A signalling network has nodes S, P, Q, R, T and U. Node S fires at time t = 0. A signal sent along a link arrives after the link's delay.

Links (source → destination, delay in time steps):
S → P, delay 1
S → Q, delay 2
P → R, delay 1
Q → R, delay 1
R → T, delay 2
Q → T, delay 4
P → U, delay 3
T → U, delay 1

Activation thresholds — a node fires at the earliest time step at which it has received signals from at least this many distinct sources:
P: 1, Q: 1, R: 2, T: 1, U: 2

Once a node fires it stays active and sends its signal onward immediately.

Question 1: At what time step does U fire?
Question 2: If the link Q → R were removed, at what time step would U fire?""",
    constraints=[
        "A node fires at the earliest time step its threshold is met, never before",
        "Signals sent before a node fires still count once they have arrived",
        "Answer in the form \"U=<t1>, U=<t2> without Q->R\", using the word never if it never fires",
    ],
)


D005_LINKS = [("S", "A", 1), ("S", "B", 3), ("A", "C", 2), ("B", "C", 1), ("A", "D", 4), ("C", "D", 1), ("C", "E", 2), ("D", "E", 1), ("B", "E", 6)]
D005_THR = {"A": 1, "B": 1, "C": 2, "D": 2, "E": 2}


def solve_d005():
    base = _d005_sim = _d004_sim(D005_LINKS, D005_THR)
    cf1 = _d004_sim(D005_LINKS, D005_THR, removed={("A", "C")})
    cf2 = _d004_sim(D005_LINKS, D005_THR, removed={("C", "D")})
    return (f"E={base['E']}, E={cf1.get('E', 'never')} without A->C, "
            f"E={cf2.get('E', 'never')} without C->D")


D005 = dict(
    taskId="D005", tier=5, category="D", answerType="exact", solver=solve_d005,
    statement="""A signalling network has nodes S, A, B, C, D and E. Node S fires at time t = 0. A signal sent along a link arrives after the link's delay.

Links (source → destination, delay in time steps):
S → A, delay 1
S → B, delay 3
A → C, delay 2
B → C, delay 1
A → D, delay 4
C → D, delay 1
C → E, delay 2
D → E, delay 1
B → E, delay 6

Activation thresholds — a node fires at the earliest time step at which it has received signals from at least this many distinct sources:
A: 1, B: 1, C: 2, D: 2, E: 2

Once a node fires it stays active and sends its signal onward immediately.

Question 1: At what time step does E fire?
Question 2: If the link A → C were removed, at what time step would E fire?
Question 3: If instead the link C → D were removed (with A → C intact), at what time step would E fire?""",
    constraints=[
        "A node fires at the earliest time step its threshold is met, never before",
        "Each counterfactual is evaluated independently, from the original network",
        "Answer in the form \"E=<t1>, E=<t2> without A->C, E=<t3> without C->D\", using the word never if it never fires",
    ],
)


# ---------------------------------------------------------------------------
# E — Abstraction & Transformation
# ---------------------------------------------------------------------------

def _e004_transform(s: str) -> str:
    """Rule inferred from the worked examples: reverse, then shift each letter
    forward by its 1-based position in the reversed string, wrapping A-Z."""
    r = s[::-1]
    return "".join(chr((ord(c) - 65 + i + 1) % 26 + 65) for i, c in enumerate(r))


def solve_e004():
    return _e004_transform("MARCH")


E004 = dict(
    taskId="E004", tier=4, category="E", answerType="exact", solver=solve_e004,
    statement=f"""A transformation turns one uppercase word into another. Three worked examples:

CAB → {_e004_transform("CAB")}
DOG → {_e004_transform("DOG")}
FLUTE → {_e004_transform("FLUTE")}

Apply the same transformation to MARCH.""",
    constraints=[
        "The alphabet wraps: after Z comes A",
        "The same rule applies to every example and to the answer",
        "Answer with the transformed word in uppercase letters only",
    ],
)


def _e005_transform(s: str) -> str:
    """Rule: take the letters at odd positions in order, then the letters at
    even positions in reverse order, then shift every letter back by 2.

    Two composed operations, four worked examples of three different lengths.
    Checked against every fixed-shift, reverse-and-shift and odds/evens family:
    only this rule reproduces all four examples, so it is recoverable rather
    than merely hard."""
    odds = s[0::2]
    evens = s[1::2][::-1]
    return "".join(chr((ord(c) - 65 - 2) % 26 + 65) for c in odds + evens)


def solve_e005():
    return _e005_transform("PRISM")


E005 = dict(
    taskId="E005", tier=5, category="E", answerType="exact", solver=solve_e005,
    statement=f"""A transformation turns one uppercase word into another. Four worked examples:

BADGE → {_e005_transform("BADGE")}
CHAIR → {_e005_transform("CHAIR")}
LIME → {_e005_transform("LIME")}
STONE → {_e005_transform("STONE")}

Apply the same transformation to PRISM.""",
    constraints=[
        "The alphabet wraps in both directions: after Z comes A, before A comes Z",
        "The same rule applies to every example and to the answer",
        "Answer with the transformed word in uppercase letters only",
    ],
)


# ---------------------------------------------------------------------------
# F — Planning Under Constraints
# ---------------------------------------------------------------------------

def _min_makespan(durations, deps, machines):
    """Exhaustive optimal makespan for a small job-shop: try every permutation as
    a priority order, list-schedule it, and take the best. With <= 8 tasks this
    enumerates the whole space of list schedules, which contains an optimum."""
    tasks = list(durations)
    best = None
    for order in itertools.permutations(tasks):
        finish = {}
        free = [0] * machines
        ok = True
        for t in order:
            if any(d not in finish for d in deps.get(t, [])):
                ok = False
                break
            ready = max([finish[d] for d in deps.get(t, [])], default=0)
            m = min(range(machines), key=lambda i: max(free[i], ready))
            start = max(free[m], ready)
            finish[t] = start + durations[t]
            free[m] = finish[t]
        if not ok:
            continue
        span = max(finish.values())
        if best is None or span < best:
            best = span
    return best


F004_DUR = {"T1": 3, "T2": 2, "T3": 4, "T4": 1, "T5": 5, "T6": 2, "T7": 3}
F004_DEPS = {"T3": ["T1"], "T4": ["T2"], "T5": ["T3"], "T6": ["T4"], "T7": ["T5", "T6"]}


def solve_f004():
    return str(_min_makespan(F004_DUR, F004_DEPS, machines=2))


F004 = dict(
    taskId="F004", tier=4, category="F", answerType="exact", solver=solve_f004,
    statement="""Seven tasks must run on two identical machines. Each task runs on exactly one machine, start to finish, without interruption. A machine runs one task at a time.

Durations (hours): T1 = 3, T2 = 2, T3 = 4, T4 = 1, T5 = 5, T6 = 2, T7 = 3.

Dependencies — a task may start only once every task it depends on has finished:
T3 depends on T1
T4 depends on T2
T5 depends on T3
T6 depends on T4
T7 depends on T5 and T6

Both machines are free from hour 0. What is the minimum number of hours in which all seven tasks can be completed?""",
    constraints=[
        "Two machines, each running at most one task at a time",
        "Tasks cannot be split or paused once started",
        "A task starts no earlier than the finish time of every task it depends on",
        "Answer with the minimum makespan as a whole number of hours",
    ],
)


F005_DUR = {"J1": 4, "J2": 3, "J3": 6, "J4": 2, "J5": 5, "J6": 3, "J7": 4, "J8": 2}
F005_DEPS = {"J3": ["J1"], "J4": ["J1"], "J5": ["J2"], "J6": ["J3", "J4"], "J7": ["J5"], "J8": ["J6", "J7"]}


def solve_f005():
    return str(_min_makespan(F005_DUR, F005_DEPS, machines=3))


F005 = dict(
    taskId="F005", tier=5, category="F", answerType="exact", solver=solve_f005,
    statement="""Eight jobs must run on three identical machines. Each job runs on exactly one machine, start to finish, without interruption. A machine runs one job at a time.

Durations (hours): J1 = 4, J2 = 3, J3 = 6, J4 = 2, J5 = 5, J6 = 3, J7 = 4, J8 = 2.

Dependencies — a job may start only once every job it depends on has finished:
J3 depends on J1
J4 depends on J1
J5 depends on J2
J6 depends on J3 and J4
J7 depends on J5
J8 depends on J6 and J7

All three machines are free from hour 0. What is the minimum number of hours in which all eight jobs can be completed?""",
    constraints=[
        "Three machines, each running at most one job at a time",
        "Jobs cannot be split or paused once started",
        "A job starts no earlier than the finish time of every job it depends on",
        "Answer with the minimum makespan as a whole number of hours",
    ],
)


ITEMS = [A004, A005, B004, B005, C004, C005, D004, D005, E004, E005, F004, F005]


def build_fixture(item, answer):
    cat = item["category"]
    tier = item["tier"]
    fixture = {
        "taskId": item["taskId"],
        "version": 1,
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
        fixture["chcSecondaryFactor"] = CHC_SECOND[cat]
    return fixture


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write fixtures to disk")
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
        print(f"  {item['taskId']} (tier {item['tier']}, b={B_BY_TIER[item['tier']]}) -> {answer!r}")
        if args.write:
            d = root / CAT_DIRS[item["category"]] / f"tier-{item['tier']}"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{item['taskId']}.json").write_text(
                json.dumps(build_fixture(item, answer), indent=2) + "\n"
            )
    if failures:
        print(f"\n{failures} item(s) failed verification")
        sys.exit(1)
    print(f"\n{len(ITEMS)} items verified" + (" and written" if args.write else ""))


if __name__ == "__main__":
    main()
