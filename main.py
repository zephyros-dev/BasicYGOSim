import argparse
import multiprocessing
import random
import sys
from dataclasses import dataclass
from enum import Enum, auto
from itertools import product

import tomllib

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
    deck_list, hand_size, categories, num_extras, chunk_size, nopt_cards = args
    deck = deck_list.copy()
    cat_counters = {cat: 0 for cat in categories}
    aggregate = 0
    dup_counter = 0
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
        if any(hand.count(c) >= 2 for c in set(hand) if c != "blank" and c not in nopt_cards):
            dup_counter += 1
    return cat_counters, aggregate, dup_counter


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
        all_cats.append(e.name)
        for tag in e.tags:
            if tag not in all_cats:
                all_cats.append(tag)
        card_hash[e.name] = [e.name] + e.tags

    side_replace_list = deck_file["deck"].get("side_replace", [])
    deck_side = deck_main.copy()
    for e in [_parse_deck_line(line) for line in side_replace_list]:
        try:
            deck_side = remove_card(deck_side, e.name, e.quantity)
        except ValueError:
            print(f"Side deck error: '{e.name}' not found in main deck")
            sys.exit(0)

    if "Prosperity" in deck_main or "Extravagance" in deck_main:
        num_extras += 6
    if "Duality" in deck_main:
        num_extras += 3
    if "Desires" in deck_main:
        num_extras += 2

    ref_section = deck_file.get("category", {})
    category_names = set(deck_file["hand"].keys()) | set(ref_section.keys())

    def parse_possibilities(text_possibilities, cat_name):
        return [
            _parse(_tokenize(p), cat_name, p, category_names, all_cats)
            for p in text_possibilities
            if p
        ]

    # ref_section entries come first so they are expanded before hand entries reference them
    raw_asts = {
        cat_name: parse_possibilities(text_possibilities, cat_name)
        for cat_name, text_possibilities in {**ref_section, **deck_file["hand"]}.items()
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
            # Skip entirely identical picks (e.g. same entry picked from both sources)
            if any(
                poss_keys[i] == poss_keys[j]
                for i in range(len(poss_keys))
                for j in range(i + 1, len(poss_keys))
            ):
                continue
            # Deduplicate conditions across picks (partial overlaps are allowed;
            # shared conditions appear once in the merged result)
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
        # _And: cartesian product. Skip when merged result contains any duplicate
        # condition (e.g. same card constraint required by two parts), and
        # deduplicate symmetric results via seen set.
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

    hand_names = set(deck_file["hand"].keys())
    categories = {k: v for k, v in expanded.items() if k in hand_names}

    if args.verbose:
        def fmt_cond(c):
            card, minimum, sign = c
            return card if (minimum == 1 and sign == "+") else f"{minimum} {sign} {card}"

        print("\nResolved hand possibilities:")
        for cat_name, possibilities in categories.items():
            print(f"\n  [{cat_name}]:")
            for poss in possibilities:
                print("    " + " AND ".join(fmt_cond(c) for c in poss))

    print(f"\nNone-engine card ratio is: {ne_count}/{deck_count}")
    if nopt_count:
        print(f"No-opt card ratio is: {nopt_count}/{deck_count}")

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
                [(deck_list, hand_size, categories, num_extras, c, nopt_cards) for c in chunks],
            )

        cat_counters = {cat: sum(r[0][cat] for r in results) for cat in categories}
        counter_aggregate = sum(r[1] for r in results)
        counter_dup = sum(r[2] for r in results)

        print(f"\nHand of {hand_size} ({turn}):")
        for cat_name, count in cat_counters.items():
            print(f"  [{cat_name}]: {count / num_trials * 100:.2f}%")
        if len(categories) > 1:
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
