# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pyyaml",
# ]
# ///

import argparse
import multiprocessing
import random
import sys
from dataclasses import dataclass
from enum import Enum, auto
from itertools import product

import yaml

# ── Hand DSL: tokens ─────────────────────────────────────────────────────────


class _TK(Enum):
    WORD = auto()
    AND = auto()
    OR = auto()
    COMB = auto()
    LPAREN = auto()
    RPAREN = auto()
    COMMA = auto()
    EOF = auto()


@dataclass
class _Tok:
    kind: _TK
    val: str = ""


# ── Hand DSL: AST nodes ───────────────────────────────────────────────────────


@dataclass
class _Cond:
    card: str
    minimum: int
    sign: str


@dataclass
class _CatRef:
    name: str  # "ALL" or a hand-category name


@dataclass
class _Comb:
    cats: list


@dataclass
class _Or:
    alts: list


@dataclass
class _And:
    parts: list


# ── Hand DSL: tokenizer ───────────────────────────────────────────────────────

_KW = {
    "AND": _TK.AND,
    "OR": _TK.OR,
    "COMB": _TK.COMB,
    "(": _TK.LPAREN,
    ")": _TK.RPAREN,
    ",": _TK.COMMA,
}


def _tokenize(s):
    s = s.replace("(", " ( ").replace(")", " ) ").replace(",", " , ")
    return [_Tok(_KW.get(w, _TK.WORD), w) for w in s.split()] + [_Tok(_TK.EOF)]


# ── Hand DSL: recursive-descent parser ───────────────────────────────────────
#
# Grammar:
#   possibility := or_expr EOF
#   or_expr     := and_expr (OR and_expr)*
#   and_expr    := primary (AND primary)*
#   primary     := '(' or_expr ')' | COMB '(' name (',' name)* ')' | atom
#   atom        := cat_name | card | count sign card
#
def _parse(tokens, cat_name, line, category_names, all_cats):
    pos = 0

    def peek():
        return tokens[pos]

    def consume(kind=None):
        nonlocal pos
        tok = tokens[pos]
        if kind is not None and tok.kind != kind:
            print(f"[{cat_name}] Parse error near '{tok.val}' in: {line}")
            sys.exit(0)
        pos += 1
        return tok

    def parse_or():
        left = parse_and()
        if peek().kind != _TK.OR:
            return left
        alts = [left]
        while peek().kind == _TK.OR:
            consume()
            alts.append(parse_and())
        return _Or(alts)

    def parse_and():
        parts = [parse_primary()]
        while peek().kind == _TK.AND:
            consume()
            parts.append(parse_primary())
        return parts[0] if len(parts) == 1 else _And(parts)

    def parse_primary():
        k = peek().kind
        if k == _TK.LPAREN:
            consume()
            node = parse_or()
            consume(_TK.RPAREN)
            return node
        if k == _TK.COMB:
            consume()
            consume(_TK.LPAREN)
            cats = [consume(_TK.WORD).val]
            while peek().kind == _TK.COMMA:
                consume()
                cats.append(consume(_TK.WORD).val)
            consume(_TK.RPAREN)
            for cn in cats:
                if cn not in category_names:
                    print(f"[{cat_name}] COMB references unknown category '{cn}'")
                    sys.exit(0)
            return _Comb(cats)
        w = consume(_TK.WORD).val
        if w.isdigit():
            sign = consume(_TK.WORD).val
            if sign not in ("=", "+", "-"):
                print(f"[{cat_name}] Expected sign after count in: {line}")
                sys.exit(0)
            card = consume(_TK.WORD).val
            if card not in all_cats:
                print(f"[{cat_name}] Unknown card/category '{card}' in: {line}")
                sys.exit(0)
            return _Cond(card, int(w), sign)
        if w in category_names:
            return _CatRef(w)
        if w not in all_cats:
            print(f"[{cat_name}] Unknown card/category '{w}' in: {line}")
            sys.exit(0)
        return _Cond(w, 1, "+")

    node = parse_or()
    consume(_TK.EOF)
    return node


# ── Deck: card line parser ────────────────────────────────────────────────────


@dataclass
class _DeckEntry:
    name: str
    quantity: int
    tags: list  # additional aliases / category labels (e.g. "NE", "Name", "Exo")


def _parse_deck_line(line):
    parts = line.split()
    if len(parts) < 2 or not parts[1].isdigit():
        print(f"Deck entry must be 'NAME QUANTITY [TAGS...]': {line!r}")
        sys.exit(0)
    return _DeckEntry(parts[0], int(parts[1]), parts[2:])


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


def _count_group(tag, hand):
    """Count cards in hand belonging to a group tag.
    Non-NOPT cards are counted once per unique name; NOPT cards count per occurrence.
    """
    num = 0
    seen = set()
    for c in hand:
        if c == "blank":
            continue
        labels = _card_hash.get(c, [])
        if tag in labels:
            if "NOPT" in labels:
                num += 1
            elif c not in seen:
                num += 1
                seen.add(c)
    return num


def _is_valid(combo, hand, condition):
    for card, minimum, sign in condition:
        # Card names are keyed in _card_hash; group tags are not.
        num = combo.count(card) if card in _card_hash else _count_group(card, hand)
        if num < minimum and sign != "-":
            return False
        if num > minimum and sign != "+":
            return False
    return True


def _is_one_valid(hand, possibilities):
    for comb in _hand_comb(hand):
        for p in possibilities:
            if _is_valid(comb, hand, p):
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
    deck_list, turn1_cats, turn2_cats, num_extras, chunk_size, nopt_cards, going_2nd = (
        args
    )
    deck = deck_list.copy()
    turn1_counters = {cat: 0 for cat in turn1_cats}
    turn2_counters = {cat: 0 for cat in turn2_cats}
    aggregate = 0
    dup_counter = 0
    reached_turn2 = 0
    HAND_SIZE = 5
    for _ in range(chunk_size):
        hand, extras = _get_hand(deck, HAND_SIZE, num_extras)
        any_turn1 = False
        # Going 2nd: draw cards are not used on turn 1 (opponent's turn)
        t1_draw = not going_2nd
        for cat_name, possibilities in turn1_cats.items():
            if _is_one_valid_draw(
                hand, extras, possibilities, t1_draw, t1_draw, t1_draw, t1_draw, t1_draw
            ):
                turn1_counters[cat_name] += 1
                any_turn1 = True
        any_valid = any_turn1
        if going_2nd and not any_turn1 and turn2_cats:
            reached_turn2 += 1
            remaining_start = HAND_SIZE + num_extras
            if remaining_start < len(deck):
                rand_idx = random.randint(remaining_start, len(deck) - 1)
                deck[rand_idx], deck[remaining_start] = (
                    deck[remaining_start],
                    deck[rand_idx],
                )
                hand6 = hand + [deck[remaining_start]]
            else:
                hand6 = hand
            for cat_name, possibilities in turn2_cats.items():
                if _is_one_valid_draw(
                    hand6, extras, possibilities, True, True, True, True, True
                ):
                    turn2_counters[cat_name] += 1
                    any_valid = True
        if any_valid:
            aggregate += 1
        if any(
            hand.count(c) >= 2
            for c in set(hand)
            if c != "blank" and c not in nopt_cards
        ):
            dup_counter += 1
    return turn1_counters, turn2_counters, aggregate, dup_counter, reached_turn2


def probability_calculator(args):
    num_trials = 100000

    with open(args.deck) as f:
        deck_file = yaml.safe_load(f)

    def add_card(deck, name, quantity):
        for _ in range(quantity):
            deck.append(name)
        return deck

    def register_card(e):
        if e.name not in card_hash:
            for tag in e.tags:
                if tag not in all_cats:
                    all_cats.append(tag)
            all_cats.append(e.name)
            card_hash[e.name] = [e.name] + e.tags

    card_hash = {}
    deck_main = []
    all_cats = []
    deck_count = 0
    num_extras = 0
    ne_count = 0
    nopt_count = 0
    nopt_cards = set()

    for e in [_parse_deck_line(line) for line in deck_file["deck"]["main"]]:
        deck_main = add_card(deck_main, e.name, e.quantity)
        deck_count += e.quantity
        if "NE" in e.tags:
            ne_count += e.quantity
        if "NOPT" in e.tags:
            nopt_count += e.quantity
            nopt_cards.add(e.name)
        if e.name == "Upstart":
            num_extras += e.quantity
        register_card(e)

    side_count = 0
    for e in [_parse_deck_line(line) for line in deck_file["deck"].get("side", [])]:
        register_card(e)
        side_count += e.quantity

    if not (40 <= deck_count <= 60):
        print(f"Main deck must be 40-60 cards (got {deck_count})")
        sys.exit(0)
    if side_count > 15:
        print(f"Side deck must be at most 15 cards (got {side_count})")
        sys.exit(0)

    if "Prosperity" in deck_main or "Extravagance" in deck_main:
        num_extras += 6
    if "Duality" in deck_main:
        num_extras += 3
    if "Desires" in deck_main:
        num_extras += 2

    ref_section = deck_file.get("category", {})
    category_names = set(ref_section.keys())

    def parse_possibilities(text_possibilities, cat_name):
        return [
            _parse(_tokenize(str(p)), cat_name, str(p), category_names, all_cats)
            for p in text_possibilities
            if p
        ]

    raw_asts = {
        cat_name: parse_possibilities(text_possibilities, cat_name)
        for cat_name, text_possibilities in ref_section.items()
    }

    def _has_hand_catref(node):
        if isinstance(node, _CatRef):
            return node.name in category_names
        if isinstance(node, _And):
            return any(_has_hand_catref(p) for p in node.parts)
        if isinstance(node, _Or):
            return any(_has_hand_catref(a) for a in node.alts)
        if isinstance(node, _Comb):
            return True
        return False

    def get_cat_flat(ref_name, cat_name):
        if ref_name in base_cat_flat:
            return base_cat_flat[ref_name]
        if ref_name in expanded:
            return expanded[ref_name]
        print(
            f"[{cat_name}] references unknown or not-yet-defined category '{ref_name}'"
        )
        sys.exit(0)

    def expand_comb(cat_list, cat_name):
        sources = [get_cat_flat(cn, cat_name) for cn in cat_list]
        seen = set()
        result = []
        for combo in product(*sources):
            poss_keys = [frozenset(tuple(c) for c in poss) for poss in combo]
            if any(
                poss_keys[i] == poss_keys[j]
                for i in range(len(poss_keys))
                for j in range(i + 1, len(poss_keys))
            ):
                continue
            seen_conds = set()
            merged = []
            for poss in combo:
                for c in poss:
                    ct = tuple(c)
                    if ct not in seen_conds:
                        seen_conds.add(ct)
                        merged.append(c)
            key = frozenset(seen_conds)
            if key not in seen:
                seen.add(key)
                result.append(merged)
        return result

    def expand(node, cat_name):
        if isinstance(node, _Cond):
            return [[[node.card, node.minimum, node.sign]]]
        if isinstance(node, _CatRef):
            return get_cat_flat(node.name, cat_name)
        if isinstance(node, _Comb):
            return expand_comb(node.cats, cat_name)
        if isinstance(node, _Or):
            result = []
            for alt in node.alts:
                result.extend(expand(alt, cat_name))
            return result
        expanded_parts = [expand(p, cat_name) for p in node.parts]
        seen = set()
        result = []
        for combo in product(*expanded_parts):
            merged = [c for poss in combo for c in poss]
            key = frozenset(tuple(c) for c in merged)
            if len(key) < len(merged):
                continue
            if key not in seen:
                seen.add(key)
                result.append(merged)
        return result

    base_cat_names = {
        name
        for name, asts in raw_asts.items()
        if not any(_has_hand_catref(ast) for ast in asts)
    }
    base_cat_flat = {
        name: [poss for ast in raw_asts[name] for poss in expand(ast, name)]
        for name in base_cat_names
    }
    expanded = {}
    for cat_name, asts in raw_asts.items():
        expanded[cat_name] = [poss for ast in asts for poss in expand(ast, cat_name)]

    def expand_turn_cats(turn_dict, scenario_name):
        result = {}
        for label, strings in (turn_dict or {}).items():
            if not strings:
                continue
            asts = parse_possibilities(strings, f"{scenario_name}/{label}")
            result[label] = [
                poss for ast in asts for poss in expand(ast, f"{scenario_name}/{label}")
            ]
        return result

    def fmt_cond(c):
        card, minimum, sign = c
        return card if (minimum == 1 and sign == "+") else f"{minimum} {sign} {card}"

    if args.verbose:
        print("\nResolved hand possibilities:")
        for cat_name, possibilities in expanded.items():
            print(f"\n  [{cat_name}]:")
            for poss in possibilities:
                print("    " + " AND ".join(fmt_cond(c) for c in poss))

    print(f"\nNone-engine card ratio is: {ne_count}/{deck_count}")
    if nopt_count:
        print(f"Non-opt card ratio is: {nopt_count}/{deck_count}")

    num_workers = multiprocessing.cpu_count()
    base_chunk = num_trials // num_workers
    chunks = [base_chunk] * num_workers
    chunks[-1] += num_trials - base_chunk * num_workers

    for scenario_name, scenario in deck_file.get("hand", {}).items():
        going_2nd = scenario.get("going_2nd", False)
        hand_spec = scenario.get("hand") or {}
        turn1_cats = expand_turn_cats(hand_spec.get("turn_1"), scenario_name)
        turn2_cats = (
            expand_turn_cats(hand_spec.get("turn_2"), scenario_name)
            if going_2nd
            else {}
        )

        if not turn1_cats and not turn2_cats:
            continue

        if args.verbose:
            print(f"\n  [{scenario_name}]:")
            for turn_label_v, cats_v in [
                ("turn_1", turn1_cats),
                ("turn_2", turn2_cats),
            ]:
                if not cats_v:
                    continue
                print(f"    {turn_label_v}:")
                for label, possibilities in cats_v.items():
                    print(f"      [{label}]:")
                    for poss in possibilities:
                        print("        " + " AND ".join(fmt_cond(c) for c in poss))

        scenario_deck = deck_main.copy()
        side_spec = scenario.get("side")
        if side_spec:
            for entry_str in side_spec.get("out") or []:
                if entry_str:
                    e = _parse_deck_line(str(entry_str))
                    for _ in range(e.quantity):
                        try:
                            scenario_deck.remove(e.name)
                        except ValueError:
                            print(
                                f"[{scenario_name}] side out error: '{e.name}' not in deck"
                            )
                            sys.exit(0)
            for entry_str in side_spec.get("in") or []:
                if entry_str:
                    e = _parse_deck_line(str(entry_str))
                    scenario_deck = add_card(scenario_deck, e.name, e.quantity)

        with multiprocessing.Pool(
            num_workers, initializer=_pool_init, initargs=(card_hash,)
        ) as pool:
            results = pool.map(
                _run_chunk,
                [
                    (
                        scenario_deck,
                        turn1_cats,
                        turn2_cats,
                        num_extras,
                        c,
                        nopt_cards,
                        going_2nd,
                    )
                    for c in chunks
                ],
            )

        turn1_counters = {cat: sum(r[0][cat] for r in results) for cat in turn1_cats}
        turn2_counters = {cat: sum(r[1][cat] for r in results) for cat in turn2_cats}
        counter_aggregate = sum(r[2] for r in results)
        counter_dup = sum(r[3] for r in results)
        counter_reached_turn2 = sum(r[4] for r in results)

        turn_label = "going 2nd" if going_2nd else "going 1st"
        side_label = ", after side" if side_spec else ""
        print(f"\n{scenario_name}{side_label}, {turn_label}:")
        if going_2nd:
            print("  Turn 1 (5 cards):")
            for cat_name, count in turn1_counters.items():
                print(f"    [{cat_name}]: {count / num_trials * 100:.2f}%")
            if turn2_cats:
                print("  Turn 2 (+1 draw):")
                for cat_name, count in turn2_counters.items():
                    cond = (
                        f" ({count / counter_reached_turn2 * 100:.2f}% given T1 miss)"
                        if counter_reached_turn2
                        else ""
                    )
                    print(f"    [{cat_name}]: {count / num_trials * 100:.2f}%{cond}")
        else:
            print("  Turn 1 (5 cards):")
            for cat_name, count in turn1_counters.items():
                print(f"    [{cat_name}]: {count / num_trials * 100:.2f}%")
        print("  " + "-" * 20)
        if len(turn1_cats) + len(turn2_cats) > 1:
            print(f"  [total]: {counter_aggregate / num_trials * 100:.2f}%")
        print(f"  [no-dup]: {(num_trials - counter_dup) / num_trials * 100:.2f}%")


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
parser_prob.add_argument(
    "-v",
    "--verbose",
    action="store_true",
    help="print resolved hand possibilities for each category",
)
parser_prob.set_defaults(func=probability_calculator)

if __name__ == "__main__":
    args = parser.parse_args()
    args.func(args)
