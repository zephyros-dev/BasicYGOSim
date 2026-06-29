import type { Possibilities, CardHash, ChunkResult } from './types';

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getHand(deck: string[], k: number, numExtras: number): [string[], string[]] {
  for (let i = 0; i < k + numExtras; i++) {
    const r = randInt(i, deck.length - 1);
    [deck[i], deck[r]] = [deck[r], deck[i]];
  }
  return [deck.slice(0, k), deck.slice(k, k + numExtras)];
}

function* handCombinations(hand: string[], cardHash: CardHash): Generator<string[]> {
  const labels = hand.filter(c => c !== 'blank').map(c => cardHash[c] ?? [c]);
  yield* cartesianGen(labels);
}

function* cartesianGen(arrays: string[][]): Generator<string[]> {
  if (arrays.length === 0) { yield []; return; }
  for (const item of arrays[0]) {
    for (const rest of cartesianGen(arrays.slice(1))) {
      yield [item, ...rest];
    }
  }
}

function countGroup(tag: string, hand: string[], cardHash: CardHash): number {
  let num = 0;
  const seen = new Set<string>();
  for (const c of hand) {
    if (c === 'blank') continue;
    const labels = cardHash[c] ?? [];
    if (!labels.includes(tag)) continue;
    if (labels.includes('NOPT')) {
      num++;
    } else if (!seen.has(c)) {
      num++;
      seen.add(c);
    }
  }
  return num;
}

function countTagInHand(tag: string, hand: string[], cardHash: CardHash): number {
  let n = 0;
  for (const c of hand) {
    if (c !== 'blank' && (cardHash[c] ?? []).includes(tag)) n++;
  }
  return n;
}

function isValid(
  combo: string[],
  hand: string[],
  condition: [string, number, string][],
  cardHash: CardHash,
  deckCardCounts: Record<string, number>,
  deckTagCounts: Record<string, number>,
): boolean {
  for (const [card, minimum, sign] of condition) {
    let num: number;
    if (sign.length === 2 && sign[0] === 'd') {
      // DECK() condition: count copies remaining in deck (total - in hand)
      const baseSign = sign[1];
      num = card in cardHash
        ? (deckCardCounts[card] ?? 0) - hand.filter(c => c === card).length
        : (deckTagCounts[card] ?? 0) - countTagInHand(card, hand, cardHash);
      if (num < minimum && baseSign !== '-') return false;
      if (num > minimum && baseSign !== '+') return false;
    } else {
      num = card in cardHash
        ? combo.reduce((n, c) => n + (c === card ? 1 : 0), 0)
        : countGroup(card, hand, cardHash);
      if (num < minimum && sign !== '-') return false;
      if (num > minimum && sign !== '+') return false;
    }
  }
  return true;
}

function isOneValid(
  hand: string[],
  possibilities: Possibilities,
  cardHash: CardHash,
  deckCardCounts: Record<string, number>,
  deckTagCounts: Record<string, number>,
): boolean {
  for (const combo of handCombinations(hand, cardHash)) {
    for (const p of possibilities) {
      if (isValid(combo, hand, p, cardHash, deckCardCounts, deckTagCounts)) return true;
    }
  }
  return false;
}

function isOneValidDraw(
  hand: string[],
  extras: string[],
  possibilities: Possibilities,
  canExtrav: boolean,
  canDesires: boolean,
  canUpstart: boolean,
  canProsperity: boolean,
  canDuality: boolean,
  cardHash: CardHash,
  deckCardCounts: Record<string, number>,
  deckTagCounts: Record<string, number>,
): boolean {
  if (isOneValid(hand, possibilities, cardHash, deckCardCounts, deckTagCounts)) return true;

  // Order: Extravagance > Desires > Upstart > Duality > Prosperity
  if (canExtrav && hand.includes('Extravagance') && extras.length >= 2) {
    const th = [...hand]; const te = [...extras];
    th.push(te.pop()!); th.push(te.pop()!);
    if (isOneValidDraw(th, te, possibilities, false, false, false, false, canDuality, cardHash, deckCardCounts, deckTagCounts)) return true;
  }
  // Pot of Desires: banish 10 face-down from deck, then draw 2
  if (canDesires && hand.includes('Desires') && extras.length >= 12) {
    const th = [...hand]; const te = [...extras];
    for (let i = 0; i < 10; i++) te.pop(); // banish top 10
    th.push(te.pop()!); th.push(te.pop()!); // draw 2
    if (isOneValidDraw(th, te, possibilities, false, false, canUpstart, false, canDuality, cardHash, deckCardCounts, deckTagCounts)) return true;
  }
  if (canUpstart && hand.includes('Upstart') && extras.length >= 1) {
    const th = [...hand]; const te = [...extras];
    th.push(te.pop()!);
    const idx = th.indexOf('Upstart');
    if (idx >= 0) th.splice(idx, 1);
    if (isOneValidDraw(th, te, possibilities, false, canDesires, canUpstart, false, canDuality, cardHash, deckCardCounts, deckTagCounts)) return true;
  }
  if (canDuality && hand.includes('Duality') && extras.length >= 3) {
    for (let i = 0; i < 3; i++) {
      const th = [...hand]; const te = [...extras];
      th.push(te[i]); te.splice(0, 3);
      if (isOneValidDraw(th, te, possibilities, false, canDesires, canUpstart, canProsperity, false, cardHash, deckCardCounts, deckTagCounts)) return true;
    }
  }
  if (canProsperity && hand.includes('Prosperity') && extras.length >= 6) {
    for (let i = 0; i < 6; i++) {
      const th = [...hand]; const te = [...extras];
      th.push(te[i]); te.splice(0, 6);
      if (isOneValidDraw(th, te, possibilities, false, false, false, false, canDuality, cardHash, deckCardCounts, deckTagCounts)) return true;
    }
  }
  return false;
}

export function runChunk(
  deckList: string[],
  turn1Cats: Record<string, Possibilities>,
  turn2Cats: Record<string, Possibilities>,
  numExtras: number,
  chunkSize: number,
  noptCards: Set<string>,
  going2nd: boolean,
  cardHash: CardHash,
): ChunkResult {
  const deck = [...deckList];
  const t1Keys = Object.keys(turn1Cats);
  const t2Keys = Object.keys(turn2Cats);

  // Precompute deck composition for DECK() conditions
  const deckCardCounts: Record<string, number> = {};
  const deckTagCounts: Record<string, number> = {};
  for (const c of deckList) {
    deckCardCounts[c] = (deckCardCounts[c] ?? 0) + 1;
    const labels = cardHash[c] ?? [c];
    for (let i = 1; i < labels.length; i++) {
      deckTagCounts[labels[i]] = (deckTagCounts[labels[i]] ?? 0) + 1;
    }
  }
  const turn1Counters: Record<string, number> = Object.fromEntries(t1Keys.map(k => [k, 0]));
  const turn2Counters: Record<string, number> = Object.fromEntries(t2Keys.map(k => [k, 0]));
  let aggregate = 0;
  let dupCounter = 0;
  let reachedTurn2 = 0;
  const HAND_SIZE = 5;

  function hasDup(h: string[]): boolean {
    const seen = new Set<string>();
    for (const c of h) {
      if (c === 'blank' || noptCards.has(c)) continue;
      if (seen.has(c)) return true;
      seen.add(c);
    }
    return false;
  }

  for (let iter = 0; iter < chunkSize; iter++) {
    const [hand, extras] = getHand(deck, HAND_SIZE, numExtras);
    let anyTurn1 = false;
    let anyTurn2 = false;
    let hand6: string[] | null = null;
    const t1Draw = !going2nd;

    for (const cat of t1Keys) {
      if (isOneValidDraw(hand, extras, turn1Cats[cat], t1Draw, t1Draw, t1Draw, t1Draw, t1Draw, cardHash, deckCardCounts, deckTagCounts)) {
        turn1Counters[cat]++;
        anyTurn1 = true;
      }
    }

    if (going2nd && !anyTurn1 && t2Keys.length > 0) {
      reachedTurn2++;
      const remainingStart = HAND_SIZE + numExtras;
      if (remainingStart < deck.length) {
        const randIdx = randInt(remainingStart, deck.length - 1);
        [deck[randIdx], deck[remainingStart]] = [deck[remainingStart], deck[randIdx]];
        hand6 = [...hand, deck[remainingStart]];
      } else {
        hand6 = [...hand];
      }
      for (const cat of t2Keys) {
        if (isOneValidDraw(hand6, extras, turn2Cats[cat], true, true, true, true, true, cardHash, deckCardCounts, deckTagCounts)) {
          turn2Counters[cat]++;
          anyTurn2 = true;
        }
      }
    }

    const anyValid = anyTurn1 || anyTurn2;
    if (anyValid) aggregate++;

    // Dup check only on successful hands.
    // Going 1st: check turn_1 hand (5 cards).
    // Going 2nd: check turn_1 hand (5 cards) on T1 success; on T2 success check
    //   turn_1 first, then if no dup there also check turn_2 hand (6 cards).
    if (!going2nd) {
      if (anyTurn1 && hasDup(hand)) dupCounter++;
    } else {
      if (anyTurn1) {
        if (hasDup(hand)) dupCounter++;
      } else if (anyTurn2 && hand6) {
        if (hasDup(hand) || hasDup(hand6)) dupCounter++;
      }
    }
  }

  return { turn1Counters, turn2Counters, aggregate, dupCounter, reachedTurn2 };
}
