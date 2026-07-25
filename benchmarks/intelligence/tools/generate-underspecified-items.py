#!/usr/bin/env python3
"""Category G — silent defaults: does the model invent a fact it was not given?

Measured 2026-07-24: claude-opus-5 solves every well-posed deterministic item
this bank can hold (two design passes and six probe designs, 0 failures). The
one thing that beat it was a rulebook containing a conditional clause whose
trigger is never stated. Given a remote-postcode surcharge and no statement of
whether the postcode is remote, it silently assumed "not remote" and returned a
confident 15.30; likewise an unstated tax-zone allowance (6,800). Where the
missing thing was an *input* rather than a branch condition it correctly
refused, and a fully-specified control was answered correctly.

Gaming this is easy if every item is underspecified — a model that always
answers UNDETERMINED would score 100%. So the family has three kinds, and a
model has to tell them apart:

  MISSING      a condition gates a rule, the branches differ  -> UNDETERMINED
  CONVERGENT   a condition is missing, but a cap or floor makes both branches
               give the same total                            -> the number
  SPECIFIED    everything needed is stated                    -> the number

The generator asserts those properties rather than trusting the author: for
MISSING items the two branches must differ, and for CONVERGENT items they must
agree. An item that fails its own property is not written.

    python3 tools/generate-underspecified-items.py            # verify
    python3 tools/generate-underspecified-items.py --write    # verify and write
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

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
# The instructions must NOT hint that anything might be missing. Measured
# 2026-07-25: with a constraint saying "some of these problems are not fully
# determined", claude-opus-5 answered both probe items correctly; the original
# probe, which said nothing of the kind, produced the silent-default failure.
# Priming the model to look for a missing fact removes the very thing being
# measured, so the wording below is deliberately neutral and identical across
# all three kinds of item.
ANSWER_RULE = "Answer with the total to two decimal places"


# --- G001 MISSING: an unstated surcharge condition -------------------------
def g001(remote: bool) -> float:
    total = 9.00 + 1.50 * max(0, 11 - 5)      # base + per-kg above 5kg
    if remote:
        total += 12.00
    return round(total * 0.85, 2)              # member discount


G001 = dict(
    taskId="G001", tier=4, kind="missing", branches=lambda: (g001(False), g001(True)),
    statement="""A courier prices a delivery as follows.

R1. Base rate: 9.00.
R2. Add 1.50 for every whole kilogram above 5 kg.
R3. Deliveries to a remote postcode incur a 12.00 surcharge.
R4. Members receive 15% off the total after all surcharges.

A member sends an 11 kg parcel.

What is the total charge?""",
)


# --- G002 CONVERGENT: the missing condition cannot change the answer -------
def g002(priority: bool) -> float:
    total = 24.00 + 4.00 * 3                   # base + 3 extra items
    if priority:
        total += 15.00
    return round(min(total, 36.00), 2)         # cap swallows the surcharge


G002 = dict(
    taskId="G002", tier=4, kind="convergent", branches=lambda: (g002(False), g002(True)),
    statement="""A print shop prices an order as follows.

P1. Base rate: 24.00 for the first item.
P2. Add 4.00 for each additional item.
P3. Priority orders incur a 15.00 surcharge.
P4. Whatever the above produces, no order is ever charged more than 36.00.

A customer orders 4 items.

What is the total charge?""",
)


# --- G003 SPECIFIED: nothing is missing ------------------------------------
def g003() -> float:
    total = 30.00 + 2.50 * 4                   # base + 4 nights extra
    total += 8.00                               # pet fee, stated as applying
    return round(total * 0.90, 2)               # off-season discount


G003 = dict(
    taskId="G003", tier=4, kind="specified", value=g003,
    statement="""A kennel prices a stay as follows.

K1. Base rate: 30.00 for the first night.
K2. Add 2.50 for each additional night.
K3. A pet weighing over 20 kg incurs an 8.00 handling fee.
K4. Stays beginning in the off season receive 10% off the total after all fees.

A 24 kg dog stays for 5 nights, beginning on 12 November, which is in the off season.

What is the total charge?""",
)


# --- G004 MISSING: an unstated band condition, deeper rulebook -------------
def g004(northern: bool) -> float:
    income = 46_000
    band0 = 12_000 + (1_500 if northern else 0)
    taxable = max(0, income - band0)
    tax = 0.20 * min(taxable, 50_000 - band0) + 0.40 * max(0, income - 50_000)
    return round(tax, 2)


G004 = dict(
    taskId="G004", tier=5, kind="missing", branches=lambda: (g004(False), g004(True)),
    statement="""A tax authority assesses income as follows.

B1. Income up to 12,000 is taxed at 0%.
B2. Income above 12,000 and up to 50,000 is taxed at 20%.
B3. Income above 50,000 is taxed at 40%.
B4. Residents of the northern zone have 1,500 added to the top of their 0% band, which correspondingly narrows the 20% band.
B5. The bands apply to the whole of an individual's income for the year.

An individual earns 46,000 in the year.

How much tax do they pay?""",
)


# --- G005 CONVERGENT: floor makes both branches equal ----------------------
def g005(accredited: bool) -> float:
    fee = 120.00
    reduction = 0.30 if accredited else 0.10
    fee = fee * (1 - reduction)
    return round(max(fee, 110.00), 2)          # floor binds in both branches


G005 = dict(
    taskId="G005", tier=5, kind="convergent", branches=lambda: (g005(False), g005(True)),
    statement="""A professional body charges an annual fee as follows.

F1. Standard fee: 120.00.
F2. Members of an accredited partner institution receive a 30% reduction.
F3. All other members receive a 10% reduction.
F4. No member ever pays less than 110.00, whatever reductions apply.

A member renews for the year.

What do they pay?""",
)


# --- G006 SPECIFIED: every condition stated, several interacting -----------
def g006() -> float:
    total = 45.00                               # base
    total += 6.00 * 2                           # two extra zones
    total += 20.00                              # weekend loading, stated
    total = total * 0.75                        # concession, stated
    return round(min(total, 70.00), 2)          # cap does not bind


G006 = dict(
    taskId="G006", tier=5, kind="specified", value=g006,
    statement="""A transport operator prices a journey as follows.

T1. Base fare: 45.00 for travel within one zone.
T2. Add 6.00 for each additional zone crossed.
T3. Journeys departing on a Saturday or Sunday carry a 20.00 weekend loading.
T4. Concession holders pay 75% of the total after all loadings.
T5. No single journey is charged more than 70.00.

A concession holder travels on Saturday across three zones in total (the base zone plus two more).

What is the fare?""",
)


# ---------------------------------------------------------------------------
# G007-G016 — bulk of the family. Ten more items, nine MISSING and one
# CONVERGENT, taking G to 16 with roughly two thirds MISSING. That ratio is
# what puts a frontier model near 60% on a default run; the anti-gaming
# property still holds, because a model that always answers UNDETERMINED also
# fails every convergent, specified and puzzle item in the bank.
# ---------------------------------------------------------------------------

def _g007(peak):        # gym: unstated whether the session is peak
    t = 8.00 + (3.50 if peak else 0)
    return round(t * 0.90, 2)

def _g008(resident):    # parking: unstated whether the driver is a resident
    t = 2.20 * 4
    return round(t * (0.5 if resident else 1.0) + 1.10, 2)

def _g009(fragile):     # freight: unstated whether the consignment is fragile
    t = 41.00 + 0.60 * 12
    return round(t + (14.00 if fragile else 0), 2)

def _g010(late):        # hotel: unstated whether checkout was late
    t = 96.00 + 18.00
    return round(t + (25.00 if late else 0), 2)

def _g011(direct_debit):  # utility: unstated payment method
    t = 61.00 + 0.14 * 220
    return round(t - (7.00 if direct_debit else 0), 2)

def _g012(prereq):      # course: unstated whether the prerequisite is held
    t = 340.00
    return round(t - (60.00 if prereq else 0) + 25.00, 2)

def _g013(student):     # ticket: unstated whether the buyer is a student
    t = 32.00 + 2.75
    return round(t * (0.7 if student else 1.0), 2)

def _g014(weekend):     # workshop hire: unstated whether the booking is weekend
    t = 55.00 + 12.00 * 3
    return round(t * (1.25 if weekend else 1.0), 2)

def _g015(certified):   # inspection: unstated whether the installer is certified
    t = 210.00 + 45.00
    return round(t - (35.00 if certified else 0), 2)

def _g016(oversize):    # storage: cap makes both branches agree — CONVERGENT
    t = 74.00 + (30.00 if oversize else 0)
    return round(min(t, 74.00), 2)


G007 = dict(taskId="G007", tier=4, kind="missing", branches=lambda: (_g007(False), _g007(True)),
    statement="""A gym charges for a single session as follows.

S1. Standard session: 8.00.
S2. Sessions during peak hours carry a 3.50 supplement.
S3. All sessions receive a 10% online-booking discount applied to the total after any supplement.

A member books one session online.

What do they pay?""")

G008 = dict(taskId="G008", tier=4, kind="missing", branches=lambda: (_g008(False), _g008(True)),
    statement="""A car park charges as follows.

C1. 2.20 per hour started.
C2. Residents of the borough pay half the hourly total.
C3. A fixed 1.10 card-handling fee is added after any reduction.

A driver parks for 4 hours and pays by card.

What do they pay?""")

G009 = dict(taskId="G009", tier=4, kind="missing", branches=lambda: (_g009(False), _g009(True)),
    statement="""A freight company prices a consignment as follows.

H1. Base rate: 41.00.
H2. Add 0.60 for each kilogram.
H3. Consignments marked fragile carry a 14.00 handling charge.

A consignment weighs 12 kg.

What is the total?""")

G010 = dict(taskId="G010", tier=4, kind="missing", branches=lambda: (_g010(False), _g010(True)),
    statement="""A hotel bills a stay as follows.

N1. Room rate: 96.00 per night.
N2. A one-off 18.00 cleaning charge applies to every stay.
N3. Departures after 11:00 incur a 25.00 late-checkout fee.

A guest stays one night.

What is the bill?""")

G011 = dict(taskId="G011", tier=5, kind="missing", branches=lambda: (_g011(False), _g011(True)),
    statement="""An energy supplier bills as follows.

E1. Standing charge: 61.00 per quarter.
E2. Usage: 0.14 per unit.
E3. Customers paying by direct debit receive a 7.00 discount on the total.

A customer uses 220 units in the quarter.

What is the bill?""")

G012 = dict(taskId="G012", tier=5, kind="missing", branches=lambda: (_g012(False), _g012(True)),
    statement="""A training provider prices a course as follows.

P1. Course fee: 340.00.
P2. Applicants who already hold the prerequisite qualification receive a 60.00 reduction.
P3. A 25.00 examination fee is added to every enrolment after any reduction.

Someone enrols on the course.

What do they pay?""")

G013 = dict(taskId="G013", tier=5, kind="missing", branches=lambda: (_g013(False), _g013(True)),
    statement="""A theatre prices a ticket as follows.

T1. Standard ticket: 32.00.
T2. A 2.75 booking fee is added to every ticket.
T3. Students pay 70% of the total after the booking fee.

Someone buys one ticket.

What do they pay?""")

G014 = dict(taskId="G014", tier=5, kind="missing", branches=lambda: (_g014(False), _g014(True)),
    statement="""A workshop hires out space as follows.

W1. Base hire: 55.00.
W2. Add 12.00 for each hour beyond the first.
W3. Weekend bookings are charged at 125% of the total.

A booking runs for 4 hours.

What is the charge?""")

G015 = dict(taskId="G015", tier=5, kind="missing", branches=lambda: (_g015(False), _g015(True)),
    statement="""A safety inspectorate charges as follows.

I1. Inspection fee: 210.00.
I2. A 45.00 report fee is added to every inspection.
I3. Where the installation was fitted by a certified installer, 35.00 is deducted from the total.

An installation is inspected and a report issued.

What is the charge?""")

G016 = dict(taskId="G016", tier=5, kind="convergent", branches=lambda: (_g016(False), _g016(True)),
    statement="""A storage firm charges monthly as follows.

M1. Standard unit: 74.00 per month.
M2. Oversize items carry a 30.00 monthly supplement.
M3. No unit is ever charged more than 74.00 per month, whatever supplements apply.

A customer stores items in one unit for a month.

What do they pay?""")


ITEMS = [G001, G002, G003, G004, G005, G006,
         G007, G008, G009, G010, G011, G012, G013, G014, G015, G016]


def resolve(item):
    """Compute the answer and assert the item's defining property holds."""
    if item["kind"] == "missing":
        a, b = item["branches"]()
        assert a != b, (
            f"{item['taskId']} is labelled MISSING but both branches give {a} — "
            "the unstated condition does not change the answer, so it is determinable")
        return "UNDETERMINED", f"branches differ: {a} vs {b}"
    if item["kind"] == "convergent":
        a, b = item["branches"]()
        assert a == b, (
            f"{item['taskId']} is labelled CONVERGENT but the branches give {a} and {b} — "
            "the unstated condition does change the answer, so it is not determinable")
        return f"{a:.2f}", f"both branches give {a}"
    return f"{item['value']():.2f}", "fully specified"


def build_fixture(item, answer):
    return {
        "taskId": item["taskId"],
        "version": 1,
        "category": "G",
        "categoryLabel": "Evidence Sufficiency",
        "tier": item["tier"],
        "chcPrimaryFactor": "Gc",
        "chcSecondaryFactor": "Gf",
        "irt": {"model": "2PL", "a": 1.4, "b": 2.5 if item["tier"] == 4 else 3.5, "c": 0},
        "track": "R1",
        "statement": item["statement"],
        "constraints": [
            "Apply the rules exactly as written",
            ANSWER_RULE,
        ],
        "answerType": "exact",
        "correctAnswer": answer,
        # Category G needs judged scoring: a model that correctly reports the
        # answer is not determined will phrase it in its own words, and the
        # deterministic string scorer cannot recognise those as equivalent.
        "acceptableVariants": [
            "undetermined", "cannot be determined", "insufficient information",
            "not determinable", "cannot be computed",
        ] if answer == "UNDETERMINED" else [],
        "responseSchema": RESPONSE_SCHEMA,
        "isHoldout": False,
        "scoringWeights": WEIGHTS,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent / "fixtures" / "categories" / "G-evidence"
    failures = 0
    for item in ITEMS:
        try:
            answer, why = resolve(item)
        except AssertionError as e:
            print(f"FAIL {item['taskId']}: {e}")
            failures += 1
            continue
        print(f"  {item['taskId']} (tier {item['tier']}, {item['kind']:<10}) -> {answer:<14} [{why}]")
        if args.write:
            d = root / f"tier-{item['tier']}"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{item['taskId']}.json").write_text(json.dumps(build_fixture(item, answer), indent=2) + "\n")
    if failures:
        print(f"\n{failures} item(s) failed verification")
        sys.exit(1)
    print(f"\n{len(ITEMS)} items verified" + (" and written" if args.write else ""))


if __name__ == "__main__":
    main()
