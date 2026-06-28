import type { AstNode, Possibilities, Possibility, CondTuple } from './types';

function cartesian<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap(a => arr.map(b => [...a, b])),
    [[]],
  );
}

function condKey(c: CondTuple): string {
  return `${c[0]}|${c[1]}|${c[2]}`;
}

function possKey(poss: Possibility): string {
  return [...poss].map(condKey).sort().join(',');
}

export function hasHandCatRef(node: AstNode, categoryNames: Set<string>): boolean {
  switch (node.kind) {
    case 'catref':  return categoryNames.has(node.name);
    case 'and':     return node.parts.some(p => hasHandCatRef(p, categoryNames));
    case 'or':      return node.alts.some(a => hasHandCatRef(a, categoryNames));
    case 'comb':    return true;
    default:        return false;
  }
}

export function expand(
  node: AstNode,
  catName: string,
  getCatFlat: (name: string) => Possibilities,
): Possibilities {
  switch (node.kind) {
    case 'cond':
      return [[[node.card, node.minimum, node.sign]]];

    case 'catref':
      return getCatFlat(node.name);

    case 'comb': {
      const sources = node.cats.map(cn => getCatFlat(cn));
      const seen = new Set<string>();
      const result: Possibilities = [];
      for (const combo of cartesian(sources)) {
        const keys = combo.map(possKey);
        // skip if any two picked possibilities are identical
        if (keys.some((k, i) => keys.slice(i + 1).includes(k))) continue;
        const seenConds = new Set<string>();
        const merged: Possibility = [];
        for (const poss of combo) {
          for (const c of poss) {
            const ck = condKey(c);
            if (!seenConds.has(ck)) { seenConds.add(ck); merged.push(c); }
          }
        }
        const key = [...seenConds].sort().join(',');
        if (!seen.has(key)) { seen.add(key); result.push(merged); }
      }
      return result;
    }

    case 'or':
      return node.alts.flatMap(alt => expand(alt, catName, getCatFlat));

    case 'and': {
      const parts = node.parts.map(p => expand(p, catName, getCatFlat));
      const seen = new Set<string>();
      const result: Possibilities = [];
      for (const combo of cartesian(parts)) {
        const merged = combo.flat() as Possibility;
        const condKeys = merged.map(condKey);
        // skip if duplicate conditions within merged
        if (new Set(condKeys).size < merged.length) continue;
        const key = [...condKeys].sort().join(',');
        if (!seen.has(key)) { seen.add(key); result.push(merged); }
      }
      return result;
    }
  }
}
