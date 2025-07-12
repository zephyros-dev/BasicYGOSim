import argparse
import random
import sys
from itertools import combinations, product
from pathlib import Path

import tomllib


def probability_calculator(args):
    num_trials = 60000

    with open(args.deck, "rb") as f:
        deck_file = tomllib.load(f)

    def add_card(deck, name, quantity):
        for i in range(0, quantity):
            deck.append(name)
        return deck

    def remove_card(deck, name, quantity):
        for i in range(0, quantity):
            deck.remove(name)
            deck.append("blank")
        return deck

    def get_hand(deck, k, num_extras):
        for i in range(0, k + num_extras):
            rand = random.randint(i, len(deck) - 1)
            temp = deck[rand]
            deck[rand] = deck[i]
            deck[i] = temp
        hand = []
        extras = []
        for i in range(0, k):
            hand.append(deck[i])
        for i in range(k, k + num_extras):
            extras.append(deck[i])
        return [hand, extras]

    def hand_comb(hand):
        cats = []
        for c in hand:
            if c != "blank":
                cats.append(card_hash[c])
        return product(*cats)

    def is_valid(hand, condition):
        for cond in condition:
            card = cond[0]
            sign = cond[2]
            num = 0
            for c in hand:
                if c == card:
                    num += 1
            if num < cond[1] and sign != "-":
                return False
            if num > cond[1] and sign != "+":
                return False
        return True

    def is_one_valid(hand, possibilities):
        combs = hand_comb(hand)
        for comb in combs:
            for p in possibilities:
                if is_valid(comb, p):
                    return True
        return False

    def is_one_valid_draw(
        hand,
        extras,
        possibilities,
        can_extrav,
        can_desires,
        can_upstart,
        can_prosperity,
        can_duality,
    ):
        if is_one_valid(hand, possibilities):
            return True
        if (
            can_desires and "Desires" in hand
        ):  # TODO: Fix logic, got to banish 10 cards first
            temp_hand = hand.copy()
            temp_extras = extras.copy()
            temp_hand.append(temp_extras.pop())
            temp_hand.append(temp_extras.pop())
            if is_one_valid_draw(
                temp_hand,
                temp_extras,
                possibilities,
                False,
                False,
                can_upstart,
                False,
                can_duality,
            ):
                return True
        if can_extrav and "Extravagance" in hand:
            temp_hand = hand.copy()
            temp_extras = extras.copy()
            temp_hand.append(temp_extras.pop())
            temp_hand.append(temp_extras.pop())
            if is_one_valid_draw(
                temp_hand,
                temp_extras,
                possibilities,
                False,
                False,
                False,
                False,
                can_duality,
            ):
                return True
        if can_prosperity and "Prosperity" in hand:
            for i in range(0, 6):
                temp_hand = hand.copy()
                temp_extras = extras.copy()
                temp_hand.append(temp_extras[i])
                del temp_extras[0:6]
                if is_one_valid_draw(
                    temp_hand,
                    temp_extras,
                    possibilities,
                    False,
                    False,
                    False,
                    False,
                    can_duality,
                ):
                    return True
        if can_upstart and "Upstart" in hand:
            temp_hand = hand.copy()
            temp_extras = extras.copy()
            temp_hand.append(temp_extras.pop())
            temp_hand.remove("Upstart")
            if is_one_valid_draw(
                temp_hand,
                temp_extras,
                possibilities,
                False,
                can_desires,
                can_upstart,
                False,
                can_duality,
            ):
                return True
        if can_duality and "Duality" in hand:
            for i in range(0, 3):
                temp_hand = hand.copy()
                temp_extras = extras.copy()
                temp_hand.append(temp_extras[i])
                del temp_extras[0:3]
                if is_one_valid_draw(
                    temp_hand,
                    temp_extras,
                    possibilities,
                    False,
                    can_desires,
                    can_upstart,
                    can_prosperity,
                    False,
                ):
                    return True
        return False

    card_hash = dict()
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
        card_cats = []
        card_cats.append(s[0])
        for i in range(2, len(s)):
            card_cats.append(s[i])
            if s[i] not in all_cats:
                all_cats.append(s[i])
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

    possibilities = []
    text_possibilities = deck_file["hand"]["all"]
    for possibility in text_possibilities:
        if len(possibility) == 0:
            continue
        conditions = []
        text_conditions = possibility.split("AND")
        for condition in text_conditions:
            parts = condition.split()
            if len(parts) == 3:
                if parts[2] not in all_cats:
                    print(
                        f"Possibility: {possibility} contains unlisted card or category {parts[2]}"
                    )
                    sys.exit(0)
                if parts[1] not in ["-", "+", "="] or not parts[0].isdigit():
                    print(f"Check formatting of line: {possibility}")
                    sys.exit(0)
                conditions.append([parts[2], int(parts[0]), parts[1]])
            elif len(parts) == 1:
                if parts[0] not in all_cats:
                    print(
                        f"Possibility: {possibility} contains unlisted card or category {parts[0]}"
                    )
                    sys.exit(0)
                conditions.append([parts[0], 1, "+"])
            else:
                print(
                    f"Check formatting of input_possibilities_here, line: {possibility}"
                )
        possibilities.append(conditions)

    if "main_side_number" not in deck_file["deck"]:
        main_side_hand_amount = [5, 6]
    else:
        main_side_hand_amount = deck_file["deck"]["main_side_number"]

    for hand_size, turn, deck_list in [
        [main_side_hand_amount[0], "main deck", deck_main],
        [main_side_hand_amount[1], "side deck", deck_side],
    ]:
        counter = 0
        for i in range(0, num_trials):
            hand = get_hand(deck_list, hand_size, num_extras)
            if is_one_valid_draw(
                hand[0], hand[1], possibilities, True, True, True, True, True
            ):
                counter += 1
        print(
            f"Probability of success {turn} with hand of {hand_size}: {counter / num_trials * 100:.2f}%"
        )


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

args = parser.parse_args()
args.func(args)
