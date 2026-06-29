import * as YAML from 'js-yaml';
import type {
  DeckFile, CardHash, Possibilities, ChunkResult, ScenarioResult, WorkerInput,
} from './types';

export interface ResolvedHands {
  categories: Record<string, Possibilities>;
  scenarios: Record<string, {
    going2nd: boolean;
    turn1: Record<string, Possibilities>;
    turn2: Record<string, Possibilities>;
  }>;
}
import { parsePossibilities } from './parser';
import { expand, hasHandCatRef } from './expander';

function parseDeckLine(line: string): { name: string; quantity: number; tags: string[] } {
  const parts = String(line).trim().split(/\s+/);
  if (parts.length < 2 || !/^\d+$/.test(parts[1])) {
    throw new Error(`Deck entry must be 'NAME QUANTITY [TAGS...]': ${line}`);
  }
  return { name: parts[0], quantity: parseInt(parts[1]), tags: parts.slice(2) };
}

export interface RunResult {
  results: ScenarioResult[];
  errors: string[];
  neCount: number;
  deckCount: number;
  noptCount: number;
}

export async function runSimulation(
  yamlText: string,
  numTrials: number,
  onProgress?: (msg: string) => void,
): Promise<RunResult> {
  const errors: string[] = [];

  const deckFile = YAML.load(yamlText) as DeckFile;
  if (!deckFile?.deck?.main) throw new Error('Missing deck.main section');

  const cardHash: CardHash = {};
  const deckMain: string[] = [];
  const allCats = new Set<string>();
  let deckCount = 0;
  let numExtras = 0;
  let neCount = 0;
  let noptCount = 0;
  const noptCards = new Set<string>();

  function registerCard(name: string, tags: string[]) {
    if (!(name in cardHash)) {
      tags.forEach(t => allCats.add(t));
      allCats.add(name);
      cardHash[name] = [name, ...tags];
    }
  }

  for (const line of deckFile.deck.main) {
    const e = parseDeckLine(String(line));
    for (let i = 0; i < e.quantity; i++) deckMain.push(e.name);
    deckCount += e.quantity;
    if (e.tags.includes('NE')) neCount += e.quantity;
    if (e.tags.includes('NOPT')) { noptCount += e.quantity; noptCards.add(e.name); }
    if (e.name === 'Upstart') numExtras += e.quantity;
    registerCard(e.name, e.tags);
  }

  let sideCount = 0;
  for (const line of deckFile.deck.side ?? []) {
    const e = parseDeckLine(String(line));
    registerCard(e.name, e.tags);
    sideCount += e.quantity;
  }

  if (deckCount < 40 || deckCount > 60) throw new Error(`Main deck must be 40-60 cards (got ${deckCount})`);
  if (sideCount > 15) throw new Error(`Side deck must be at most 15 cards (got ${sideCount})`);

  if (deckMain.includes('Prosperity') || deckMain.includes('Extravagance')) numExtras += 6;
  if (deckMain.includes('Duality')) numExtras += 3;
  if (deckMain.includes('Desires')) numExtras += 12; // banish 10, draw 2

  const refSection = deckFile.category ?? {};
  const categoryNames = new Set(Object.keys(refSection));

  const baseCatFlat = new Map<string, Possibilities>();
  const expandedCats = new Map<string, Possibilities>();

  function getCatFlat(name: string): Possibilities {
    const b = baseCatFlat.get(name);
    if (b) return b;
    const e = expandedCats.get(name);
    if (e) return e;
    throw new Error(`Unknown or not-yet-defined category '${name}'`);
  }

  const rawAsts = Object.fromEntries(
    Object.entries(refSection).map(([catName, texts]) => [
      catName,
      parsePossibilities((texts ?? []).map(String).filter(Boolean), catName, categoryNames, allCats),
    ])
  );

  // Base categories (no category refs / COMB) expanded first
  for (const [catName, asts] of Object.entries(rawAsts)) {
    if (!asts.some(ast => hasHandCatRef(ast, categoryNames))) {
      baseCatFlat.set(catName, asts.flatMap(ast => expand(ast, catName, getCatFlat)));
    }
  }
  // All categories in definition order (so later ones can reference earlier)
  for (const [catName, asts] of Object.entries(rawAsts)) {
    expandedCats.set(catName, asts.flatMap(ast => expand(ast, catName, getCatFlat)));
  }

  function expandTurnCats(
    turnDict: Record<string, (string | null)[]> | undefined,
    scenarioName: string,
  ): Record<string, Possibilities> {
    const result: Record<string, Possibilities> = {};
    for (const [label, texts] of Object.entries(turnDict ?? {})) {
      const filtered = (texts ?? []).map(String).filter(Boolean);
      if (!filtered.length) continue;
      const asts = parsePossibilities(filtered, `${scenarioName}/${label}`, categoryNames, allCats);
      result[label] = asts.flatMap(ast => expand(ast, `${scenarioName}/${label}`, getCatFlat));
    }
    return result;
  }

  const numWorkers = Math.max(1, (navigator.hardwareConcurrency ?? 4));
  const baseChunk = Math.floor(numTrials / numWorkers);
  const chunks = Array.from({ length: numWorkers }, (_, i) =>
    i < numWorkers - 1 ? baseChunk : numTrials - baseChunk * (numWorkers - 1)
  );

  const scenarioEntries = Object.entries(deckFile.hand ?? {});
  const results: ScenarioResult[] = [];

  for (const [scenarioName, scenario] of scenarioEntries) {
    onProgress?.(`Running ${scenarioName}…`);
    const going2nd = scenario.going_2nd ?? false;
    const handSpec = scenario.hand ?? {};
    const turn1Cats = expandTurnCats(handSpec.turn_1, scenarioName);
    const turn2Cats = going2nd ? expandTurnCats(handSpec.turn_2, scenarioName) : {};

    if (!Object.keys(turn1Cats).length && !Object.keys(turn2Cats).length) continue;

    const scenarioDeck = [...deckMain];
    const sideSpec = scenario.side;
    if (sideSpec) {
      for (const entryStr of sideSpec.out ?? []) {
        if (!entryStr) continue;
        const e = parseDeckLine(String(entryStr));
        for (let i = 0; i < e.quantity; i++) {
          const idx = scenarioDeck.indexOf(e.name);
          if (idx < 0) { errors.push(`[${scenarioName}] side out: '${e.name}' not in deck`); break; }
          scenarioDeck.splice(idx, 1);
        }
      }
      for (const entryStr of sideSpec.in ?? []) {
        if (!entryStr) continue;
        const e = parseDeckLine(String(entryStr));
        for (let i = 0; i < e.quantity; i++) scenarioDeck.push(e.name);
      }
    }

    const chunkResults = await Promise.all(
      chunks.map(chunkSize => new Promise<ChunkResult>((resolve, reject) => {
        const worker = new Worker(
          new URL('./worker.ts', import.meta.url),
          { type: 'module' },
        );
        const msg: WorkerInput = {
          deckList: scenarioDeck, turn1Cats, turn2Cats,
          numExtras, chunkSize, noptCards: [...noptCards], going2nd, cardHash,
        };
        worker.onmessage = (ev: MessageEvent<ChunkResult>) => { worker.terminate(); resolve(ev.data); };
        worker.onerror = (ev) => { worker.terminate(); reject(new Error(ev.message)); };
        worker.postMessage(msg);
      }))
    );

    const agg = chunkResults.reduce<ChunkResult>(
      (acc, r) => ({
        turn1Counters: Object.fromEntries(
          Object.keys(turn1Cats).map(k => [k, (acc.turn1Counters[k] ?? 0) + (r.turn1Counters[k] ?? 0)])
        ),
        turn2Counters: Object.fromEntries(
          Object.keys(turn2Cats).map(k => [k, (acc.turn2Counters[k] ?? 0) + (r.turn2Counters[k] ?? 0)])
        ),
        aggregate: acc.aggregate + r.aggregate,
        dupCounter: acc.dupCounter + r.dupCounter,
        reachedTurn2: acc.reachedTurn2 + r.reachedTurn2,
      }),
      {
        turn1Counters: Object.fromEntries(Object.keys(turn1Cats).map(k => [k, 0])),
        turn2Counters: Object.fromEntries(Object.keys(turn2Cats).map(k => [k, 0])),
        aggregate: 0, dupCounter: 0, reachedTurn2: 0,
      }
    );

    results.push({ scenarioName, going2nd, hasSide: !!sideSpec, ...agg, numTrials });
  }

  onProgress?.('');
  return { results, errors, neCount, deckCount, noptCount };
}

export function resolveHands(yamlText: string): ResolvedHands {
  const deckFile = YAML.load(yamlText) as DeckFile;
  if (!deckFile?.deck?.main) throw new Error('Missing deck.main section');

  const allCats = new Set<string>();
  for (const line of [...deckFile.deck.main, ...(deckFile.deck.side ?? [])]) {
    const parts = String(line).trim().split(/\s+/);
    if (parts.length >= 1) allCats.add(parts[0]);
    parts.slice(2).forEach(tag => allCats.add(tag));
  }

  const refSection = deckFile.category ?? {};
  const categoryNames = new Set(Object.keys(refSection));
  const baseCatFlat = new Map<string, Possibilities>();
  const expandedCats = new Map<string, Possibilities>();

  function getCatFlat(name: string): Possibilities {
    const b = baseCatFlat.get(name);
    if (b) return b;
    const e = expandedCats.get(name);
    if (e) return e;
    throw new Error(`Unknown category '${name}'`);
  }

  const rawAsts = Object.fromEntries(
    Object.entries(refSection).map(([catName, texts]) => [
      catName,
      parsePossibilities((texts ?? []).map(String).filter(Boolean), catName, categoryNames, allCats),
    ])
  );

  for (const [catName, asts] of Object.entries(rawAsts)) {
    if (!asts.some(ast => hasHandCatRef(ast, categoryNames)))
      baseCatFlat.set(catName, asts.flatMap(ast => expand(ast, catName, getCatFlat)));
  }
  for (const [catName, asts] of Object.entries(rawAsts))
    expandedCats.set(catName, asts.flatMap(ast => expand(ast, catName, getCatFlat)));

  function expandTurnCats(
    turnDict: Record<string, (string | null)[]> | undefined,
    scenarioName: string,
  ): Record<string, Possibilities> {
    const result: Record<string, Possibilities> = {};
    for (const [label, texts] of Object.entries(turnDict ?? {})) {
      const filtered = (texts ?? []).map(String).filter(Boolean);
      if (!filtered.length) continue;
      const asts = parsePossibilities(filtered, `${scenarioName}/${label}`, categoryNames, allCats);
      result[label] = asts.flatMap(ast => expand(ast, `${scenarioName}/${label}`, getCatFlat));
    }
    return result;
  }

  const categories: Record<string, Possibilities> = Object.fromEntries(expandedCats);
  const scenarios: ResolvedHands['scenarios'] = {};
  for (const [scenarioName, scenario] of Object.entries(deckFile.hand ?? {})) {
    scenarios[scenarioName] = {
      going2nd: scenario.going_2nd ?? false,
      turn1: expandTurnCats(scenario.hand?.turn_1, scenarioName),
      turn2: expandTurnCats(scenario.hand?.turn_2, scenarioName),
    };
  }

  return { categories, scenarios };
}
