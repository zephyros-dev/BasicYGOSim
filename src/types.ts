export type Sign = '+' | '-' | '=';
export type CondTuple = [string, number, string]; // [card, minimum, sign]
export type Possibility = CondTuple[];
export type Possibilities = Possibility[];

export interface AstCond {
  kind: 'cond';
  card: string;
  minimum: number;
  sign: Sign;
}

export interface AstCatRef {
  kind: 'catref';
  name: string;
}

export interface AstComb {
  kind: 'comb';
  cats: string[];
}

export interface AstOr {
  kind: 'or';
  alts: AstNode[];
}

export interface AstAnd {
  kind: 'and';
  parts: AstNode[];
}

export interface AstDeckCond {
  card: string;
  minimum: number;
  sign: Sign;
}

export interface AstDeck {
  kind: 'deck';
  conds: AstDeckCond[];
}

export type AstNode = AstCond | AstCatRef | AstComb | AstOr | AstAnd | AstDeck;

export type CardHash = Record<string, string[]>; // card name → [name, ...tags]

export interface ChunkResult {
  turn1Counters: Record<string, number>;
  turn2Counters: Record<string, number>;
  aggregate: number;
  dupCounter: number;
  reachedTurn2: number;
}

export interface ScenarioResult {
  scenarioName: string;
  going2nd: boolean;
  hasSide: boolean;
  turn1Counters: Record<string, number>;
  turn2Counters: Record<string, number>;
  aggregate: number;
  dupCounter: number;
  reachedTurn2: number;
  numTrials: number;
}

export interface DeckFile {
  deck: {
    main: (string | number)[];
    side?: (string | number)[];
  };
  category?: Record<string, (string | null)[]>;
  hand?: Record<string, HandScenario>;
}

export interface HandScenario {
  going_2nd?: boolean;
  hand?: {
    turn_1?: Record<string, (string | null)[]>;
    turn_2?: Record<string, (string | null)[]>;
  };
  side?: {
    in?: (string | null)[];
    out?: (string | null)[];
  };
}

export interface SavedDeck {
  id: string;
  name: string;
  yaml: string;
  updatedAt: number;
}

export interface WorkerInput {
  deckList: string[];
  turn1Cats: Record<string, Possibilities>;
  turn2Cats: Record<string, Possibilities>;
  numExtras: number;
  chunkSize: number;
  noptCards: string[];
  going2nd: boolean;
  cardHash: CardHash;
}
