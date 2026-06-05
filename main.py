import argparse
import multiprocessing
import random
import sys
from itertools import combinations, product
from pathlib import Path

import tomllib

_card_hash = {}


def _pool_init(card_hash):
    global _card_hash
    _card_hash = card_hash
    random.seed()  # reseed from OS entropy so workers don't share the same RNG state


def _get_hand(deck, k, num_extras):
    for i in range(k + num_extras):
        rand = random.randint(i, len(deck) - 1)
        deck[rand], deck[i] = deck[i], deck[rand]
    return deck[:k], deck[k : k + num_extras]


def _hand_comb(hand):
    return product(*[_card_hash[c] for c in hand if c != "blank"])


def _is_valid(hand, condition):
    for card, minimum, sign in condition:
        num = hand.count(card)
        if num < minimum and sign != "-":
            return False
        if num > minimum and sign != "+":
            return False
    return True


def _is_one_valid(hand, possibilities):
    for comb in _hand_comb(hand):
        for p in possibilities:
            if _is_valid(comb, p):
                return True
    return False


def _is_one_valid_draw(
    hand,
    extras,
    possibilities,
    can_extrav,
    can_desires,
    can_upstart,
    can_prosperity,
    can_duality,
):
    if _is_one_valid(hand, possibilities):
        return True
    if (
        can_desires and "Desires" in hand
    ):  # TODO: Fix logic, got to banish 10 cards first
        th, te = hand.copy(), extras.copy()
        th.append(te.pop())
        th.append(te.pop())
        if _is_one_valid_draw(
            th, te, possibilities, False, False, can_upstart, False, can_duality
        ):
            return True
    if can_extrav and "Extravagance" in hand:
        th, te = hand.copy(), extras.copy()
        th.append(te.pop())
        th.append(te.pop())
        if _is_one_valid_draw(
            th, te, possibilities, False, False, False, False, can_duality
        ):
            return True
    if can_prosperity and "Prosperity" in hand:
        for i in range(6):
            th, te = hand.copy(), extras.copy()
            th.append(te[i])
            del te[0:6]
            if _is_one_valid_draw(
                th, te, possibilities, False, False, False, False, can_duality
            ):
                return True
    if can_upstart and "Upstart" in hand:
        th, te = hand.copy(), extras.copy()
        th.append(te.pop())
        th.remove("Upstart")
        if _is_one_valid_draw(
            th, te, possibilities, False, can_desires, can_upstart, False, can_duality
        ):
            return True
    if can_duality and "Duality" in hand:
        for i in range(3):
            th, te = hand.copy(), extras.copy()
            th.append(te[i])
            del te[0:3]
            if _is_one_valid_draw(
                th,
                te,
                possibilities,
                False,
                can_desires,
                can_upstart,
                can_prosperity,
                False,
            ):
                return True
    return False


def _run_chunk(args):
    deck_list, hand_size, categories, num_extras, chunk_size = args
    deck = deck_list.copy()
    cat_counters = {cat: 0 for cat in categories}
    aggregate = 0
    for _ in range(chunk_size):
        hand, extras = _get_hand(deck, hand_size, num_extras)
        any_valid = False
        for cat_name, possibilities in categories.items():
            if _is_one_valid_draw(
                hand, extras, possibilities, True, True, True, True, True
            ):
                cat_counters[cat_name] += 1
                any_valid = True
        if any_valid:
            aggregate += 1
    return cat_counters, aggregate


def probability_calculator(args):
    num_trials = 100000

    with open(args.deck, "rb") as f:
        deck_file = tomllib.load(f)

    def add_card(deck, name, quantity):
        for _ in range(quantity):
            deck.append(name)
        return deck

    def remove_card(deck, name, quantity):
        for _ in range(quantity):
            deck.remove(name)
            deck.append("blank")
        return deck

    card_hash = {}
    deck_main = []
    all_cats = []
    deck_count = 0
    num_extras = 0
    ne_count = 0

    cardlines = deck_file["deck"]["main"]
    for cardline in cardlines:
        s = cardline.split(" ")
        try:
            deck_main = add_card(deck_main, s[0], int(s[1]))
            if "NE" in s:
                ne_count += int(s[1])
        except Exception as err:
            print(f"Error in deck input: {err}, check entry: " + cardline)
            sys.exit(0)
        deck_count += int(s[1])
        all_cats.append(s[0])
        if s[0] == "Upstart":
            num_extras += int(s[1])
        card_cats = [s[0]] + list(s[2:])
        for cat in card_cats[1:]:
            if cat not in all_cats:
                all_cats.append(cat)
        card_hash[s[0]] = card_cats

    if "side_replace" not in deck_file["deck"]:
        side_replace_list = []
    else:
        side_replace_list = deck_file["deck"]["side_replace"]

    deck_side = deck_main.copy()
    for cardline in side_replace_list:
        s = cardline.split(" ")
        try:
            deck_side = remove_card(deck_side, s[0], int(s[1]))
        except Exception as err:
            print(f"Error in deck input: {err}, check entry: " + cardline)
            sys.exit(0)

    if "Prosperity" in deck_main or "Extravagance" in deck_main:
        num_extras += 6
    if "Duality" in deck_main:
        num_extras += 3
    if "Desires" in deck_main:
        num_extras += 2
    print(f"None-engine card ratio is: {ne_count}/{deck_count}")

    def parse_possibilities(text_possibilities, cat_name):
        result = []
        for possibility in text_possibilities:
            if len(possibility) == 0:
                continue
            conditions = []
            has_all = False
            for condition in possibility.split("AND"):
                parts = condition.split()
                if len(parts) == 1 and parts[0] == "ALL":
                    has_all = True
                elif len(parts) == 3:
                    if parts[2] not in all_cats:
                        print(
                            f"[{cat_name}] Possibility: {possibility} contains unlisted card or category {parts[2]}"
                        )
                        sys.exit(0)
                    if parts[1] not in ["-", "+", "="] or not parts[0].isdigit():
                        print(f"[{cat_name}] Check formatting of line: {possibility}")
                        sys.exit(0)
                    conditions.append([parts[2], int(parts[0]), parts[1]])
                elif len(parts) == 1:
                    if parts[0] not in all_cats:
                        print(
                            f"[{cat_name}] Possibility: {possibility} contains unlisted card or category {parts[0]}"
                        )
                        sys.exit(0)
                    conditions.append([parts[0], 1, "+"])
                else:
                    print(
                        f"[{cat_name}] Check formatting of input_possibilities_here, line: {possibility}"
                    )
            # ("ALL", extra) is a deferred marker — expanded after base categories are known
            result.append(("ALL", conditions) if has_all else conditions)
        return result

    raw_categories = {
        cat_name: parse_possibilities(text_possibilities, cat_name)
        for cat_name, text_possibilities in deck_file["hand"].items()
    }

    # Collect every possibility from categories that contain no ALL markers
    base_possibilities = [
        poss
        for parsed in raw_categories.values()
        if not any(isinstance(p, tuple) for p in parsed)
        for poss in parsed
    ]

    # Expand ALL markers: each ("ALL", extras) becomes one entry per base possibility
    categories = {}
    for cat_name, parsed in raw_categories.items():
        expanded = []
        for p in parsed:
            if isinstance(p, tuple):  # ("ALL", extra_conditions)
                for base in base_possibilities:
                    expanded.append(base + p[1])
            else:
                expanded.append(p)
        categories[cat_name] = expanded

    if "main_side_number" not in deck_file["deck"]:
        main_side_hand_amount = [5, 6]
    else:
        main_side_hand_amount = deck_file["deck"]["main_side_number"]

    num_workers = multiprocessing.cpu_count()
    base_chunk = num_trials // num_workers
    chunks = [base_chunk] * num_workers
    chunks[-1] += num_trials - base_chunk * num_workers

    for hand_size, turn, deck_list in [
        [main_side_hand_amount[0], "main deck", deck_main],
        [main_side_hand_amount[1], "side deck", deck_side],
    ]:
        with multiprocessing.Pool(
            num_workers, initializer=_pool_init, initargs=(card_hash,)
        ) as pool:
            results = pool.map(
                _run_chunk,
                [(deck_list, hand_size, categories, num_extras, c) for c in chunks],
            )

        cat_counters = {cat: sum(r[0][cat] for r in results) for cat in categories}
        counter_aggregate = sum(r[1] for r in results)

        print(f"\nHand of {hand_size} ({turn}):")
        for cat_name, count in cat_counters.items():
            print(f"  [{cat_name}]: {count / num_trials * 100:.2f}%")
        if len(categories) > 1:
            print(f"  [aggregate]: {counter_aggregate / num_trials * 100:.2f}%")


def combination_generator(args):
    file = tomllib.loads(Path(args.file).read_text())
    for combination in list(combinations(file["combination"]["combination"], 2)):
        print(combination[0], "AND", combination[1])


parser = argparse.ArgumentParser()
subparsers = parser.add_subparsers(required=True)
parser_prob = subparsers.add_parser(
    "probability",
    aliases=["prob"],
    help="Calculate deck probability",
)
parser_prob.add_argument(
    "-d",
    "--deck",
    type=str,
    help="the deck file to use",
)
parser_prob.set_defaults(func=probability_calculator)

parser_comb = subparsers.add_parser(
    "combination", aliases=["comb"], help="Generate 2 cards combinations"
)
parser_comb.add_argument(
    "-f",
    "--file",
    type=str,
    help="choose which file to use for finding combination, default: sample.toml",
    default="sample.toml",
)
parser_comb.set_defaults(func=combination_generator)

if __name__ == "__main__":
    args = parser.parse_args()
    args.func(args)
