import type { AstNode, AstCond, AstCatRef, AstComb, AstOr, AstAnd, AstDeck, AstDeckCond, Sign } from './types';

type TK = 'WORD' | 'AND' | 'OR' | 'COMB' | 'DECK' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'EOF';

interface Tok {
  kind: TK;
  val: string;
}

const KW: Record<string, TK> = {
  AND: 'AND',
  OR: 'OR',
  COMB: 'COMB',
  DECK: 'DECK',
  '(': 'LPAREN',
  ')': 'RPAREN',
  ',': 'COMMA',
};

function tokenize(s: string): Tok[] {
  const spaced = s.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').replace(/,/g, ' , ');
  const words = spaced.trim().split(/\s+/).filter(w => w.length > 0);
  const tokens: Tok[] = words.map(w => ({ kind: (KW[w] ?? 'WORD') as TK, val: w }));
  tokens.push({ kind: 'EOF', val: '' });
  return tokens;
}

function parseTokens(
  tokens: Tok[],
  catName: string,
  line: string,
  categoryNames: Set<string>,
  allCats: Set<string>,
): AstNode {
  let pos = 0;

  function peek(): Tok { return tokens[pos]; }

  function consume(kind?: TK): Tok {
    const tok = tokens[pos];
    if (kind !== undefined && tok.kind !== kind) {
      throw new Error(`[${catName}] Parse error near '${tok.val}' in: ${line}`);
    }
    pos++;
    return tok;
  }

  function parseOr(): AstNode {
    const left = parseAnd();
    if (peek().kind !== 'OR') return left;
    const alts: AstNode[] = [left];
    while (peek().kind === 'OR') {
      consume();
      alts.push(parseAnd());
    }
    const node: AstOr = { kind: 'or', alts };
    return node;
  }

  function parseAnd(): AstNode {
    const parts: AstNode[] = [parsePrimary()];
    while (peek().kind === 'AND') {
      consume();
      parts.push(parsePrimary());
    }
    if (parts.length === 1) return parts[0];
    const node: AstAnd = { kind: 'and', parts };
    return node;
  }

  function parseDeckCond(): AstDeckCond {
    const w = peek().val;
    if (/^\d+$/.test(w)) {
      consume();
      const signVal = consume('WORD').val;
      if (!['=', '+', '-'].includes(signVal)) {
        throw new Error(`[${catName}] Expected sign after count in DECK(): ${line}`);
      }
      const card = consume('WORD').val;
      if (!allCats.has(card)) {
        throw new Error(`[${catName}] Unknown card/group '${card}' in DECK(): ${line}`);
      }
      return { card, minimum: parseInt(w), sign: signVal as Sign };
    }
    const card = consume('WORD').val;
    if (!allCats.has(card)) {
      throw new Error(`[${catName}] Unknown card/group '${card}' in DECK(): ${line}`);
    }
    return { card, minimum: 1, sign: '+' };
  }

  function parsePrimary(): AstNode {
    const k = peek().kind;
    if (k === 'LPAREN') {
      consume();
      const node = parseOr();
      consume('RPAREN');
      return node;
    }
    if (k === 'COMB') {
      consume();
      consume('LPAREN');
      const cats: string[] = [consume('WORD').val];
      while (peek().kind === 'COMMA') {
        consume();
        cats.push(consume('WORD').val);
      }
      consume('RPAREN');
      for (const cn of cats) {
        if (!categoryNames.has(cn)) {
          throw new Error(`[${catName}] COMB references unknown category '${cn}'`);
        }
      }
      const node: AstComb = { kind: 'comb', cats };
      return node;
    }
    if (k === 'DECK') {
      consume();
      consume('LPAREN');
      const conds: AstDeckCond[] = [parseDeckCond()];
      while (peek().kind === 'COMMA') {
        consume();
        conds.push(parseDeckCond());
      }
      consume('RPAREN');
      const node: AstDeck = { kind: 'deck', conds };
      return node;
    }
    const w = consume('WORD').val;
    if (/^\d+$/.test(w)) {
      const signVal = consume('WORD').val;
      if (!['=', '+', '-'].includes(signVal)) {
        throw new Error(`[${catName}] Expected sign after count in: ${line}`);
      }
      const card = consume('WORD').val;
      if (!allCats.has(card)) {
        throw new Error(`[${catName}] Unknown card/category '${card}' in: ${line}`);
      }
      const node: AstCond = { kind: 'cond', card, minimum: parseInt(w), sign: signVal as Sign };
      return node;
    }
    if (categoryNames.has(w)) {
      const node: AstCatRef = { kind: 'catref', name: w };
      return node;
    }
    if (!allCats.has(w)) {
      throw new Error(`[${catName}] Unknown card/category '${w}' in: ${line}`);
    }
    const node: AstCond = { kind: 'cond', card: w, minimum: 1, sign: '+' };
    return node;
  }

  const node = parseOr();
  consume('EOF');
  return node;
}

export function parsePossibilities(
  texts: string[],
  catName: string,
  categoryNames: Set<string>,
  allCats: Set<string>,
): AstNode[] {
  return texts
    .filter(p => p)
    .map(p => parseTokens(tokenize(p), catName, p, categoryNames, allCats));
}
