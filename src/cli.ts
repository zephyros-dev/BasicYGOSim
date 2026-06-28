#!/usr/bin/env node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import * as YAML from 'js-yaml';
import type { DeckFile, Possibilities, CardHash } from './types';
import { parsePossibilities } from './parser';
import { expand, hasHandCatRef } from './expander';
import { runChunk } from './simulation';
import { resolveHands } from './runner';

// ── Arg parsing ───────────────────────────────────────────────
const argv = process.argv.slice(2);
let command = '';
let deckPath = '';
let numTrials = 100_000;

const HELP = `\
ygoprob — YGO deck probability simulator

Usage:
  ygoprob <command> -d <deck.yaml> [options]

Commands:
  probability   Run Monte Carlo simulation and print hit rates
  expand        Print expanded hand conditions without simulating

Options:
  -d, --deck <file>      Path to deck YAML file (required)
  -n, --trials <number>  Number of simulation trials (default: 100000)
  -h, --help             Show this help message
`;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
  if (!a.startsWith('-')) { if (!command) command = a; continue; }
  if (a === '-d' || a === '--deck') { deckPath = argv[++i] ?? ''; continue; }
  if (a === '-n' || a === '--trials') { numTrials = parseInt(argv[++i] ?? '100000'); continue; }
}

if (!command || !deckPath) {
  console.error(HELP);
  process.exit(1);
}

const yamlText = readFileSync(deckPath, 'utf8');

// ── Shared helpers ────────────────────────────────────────────
function pct(n: number, d: number): string {
  return d === 0 ? 'N/A' : (n / d * 100).toFixed(2) + '%';
}

function formatPossibilities(poss: Possibilities): string[] {
  return poss.map((hand, i) => {
    const parts = hand.map(([card, min, sign]) =>
      min === 1 && sign === '+' ? card : `${min}${sign} ${card}`);
    return `  ${i + 1}: ${parts.join(' AND ')}`;
  });
}

// ── expand ────────────────────────────────────────────────────
if (command === 'expand') {
  const { categories, scenarios } = resolveHands(yamlText);
  const lines: string[] = [];

  const catEntries = Object.entries(categories);
  if (catEntries.length) {
    lines.push('=== Categories ===');
    for (const [name, poss] of catEntries) {
      lines.push('');
      lines.push(`[${name}] — ${poss.length} hand${poss.length !== 1 ? 's' : ''}`);
      lines.push(...formatPossibilities(poss));
    }
  }

  const scenEntries = Object.entries(scenarios);
  if (scenEntries.length) {
    lines.push('');
    lines.push('=== Scenarios ===');
    for (const [name, { going2nd, turn1, turn2 }] of scenEntries) {
      lines.push('');
      lines.push(`[${name}], going ${going2nd ? '2nd' : '1st'}`);
      for (const [turnLabel, cats] of [['Turn 1', turn1], ['Turn 2', turn2]] as const) {
        const entries = Object.entries(cats);
        if (!entries.length) continue;
        lines.push(`  ${turnLabel}:`);
        for (const [label, poss] of entries) {
          lines.push(`    [${label}] — ${poss.length} hand${poss.length !== 1 ? 's' : ''}`);
          lines.push(...formatPossibilities(poss).map(l => '    ' + l));
        }
      }
    }
  }

  console.log(lines.join('\n'));
  process.exit(0);
}

// ── probability ───────────────────────────────────────────────
if (command === 'probability') {
  function parseDeckLine(line: string) {
    const parts = String(line).trim().split(/\s+/);
    if (parts.length < 2 || !/^\d+$/.test(parts[1]))
      throw new Error(`Deck entry must be 'NAME QUANTITY [TAGS...]': ${line}`);
    return { name: parts[0], quantity: parseInt(parts[1]), tags: parts.slice(2) };
  }

  const deckFile = YAML.load(yamlText) as DeckFile;
  if (!deckFile?.deck?.main) { console.error('Missing deck.main section'); process.exit(1); }

  const cardHash: CardHash = {};
  const deckMain: string[] = [];
  const allCats = new Set<string>();
  const noptCards = new Set<string>();
  let numExtras = 0;

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
    if (e.tags.includes('NOPT')) noptCards.add(e.name);
    if (e.name === 'Upstart') numExtras += e.quantity;
    registerCard(e.name, e.tags);
  }
  for (const line of deckFile.deck.side ?? []) {
    const e = parseDeckLine(String(line));
    registerCard(e.name, e.tags);
  }

  if (deckMain.includes('Prosperity') || deckMain.includes('Extravagance')) numExtras += 6;
  if (deckMain.includes('Duality')) numExtras += 3;
  if (deckMain.includes('Desires')) numExtras += 2;

  const refSection = deckFile.category ?? {};
  const categoryNames = new Set(Object.keys(refSection));
  const baseCatFlat = new Map<string, Possibilities>();
  const expandedCats = new Map<string, Possibilities>();

  function getCatFlat(name: string): Possibilities {
    return baseCatFlat.get(name) ?? expandedCats.get(name)
      ?? (() => { throw new Error(`Unknown category '${name}'`); })();
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

  const lines: string[] = [];

  for (const [scenarioName, scenario] of Object.entries(deckFile.hand ?? {})) {
    process.stderr.write(`Running ${scenarioName}…\n`);
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
          if (idx < 0) { lines.push(`⚠ [${scenarioName}] side out: '${e.name}' not in deck`); break; }
          scenarioDeck.splice(idx, 1);
        }
      }
      for (const entryStr of sideSpec.in ?? []) {
        if (!entryStr) continue;
        const e = parseDeckLine(String(entryStr));
        for (let i = 0; i < e.quantity; i++) scenarioDeck.push(e.name);
      }
    }

    const result = runChunk(
      scenarioDeck, turn1Cats, turn2Cats,
      numExtras, numTrials, noptCards, going2nd, cardHash,
    );

    const s = { scenarioName, going2nd, hasSide: !!sideSpec, ...result, numTrials };

    lines.push('');
    const side = s.hasSide ? ', after side' : '';
    const turn = s.going2nd ? 'going 2nd' : 'going 1st';
    lines.push(`${s.scenarioName}${side}, ${turn}:`);

    lines.push('  Turn 1 (5 cards):');
    for (const [cat, cnt] of Object.entries(s.turn1Counters))
      lines.push(`    [${cat}]: ${pct(cnt, numTrials)}`);

    if (Object.keys(s.turn2Counters).length) {
      lines.push('  Turn 2 (+1 draw):');
      for (const [cat, cnt] of Object.entries(s.turn2Counters)) {
        const cond = s.reachedTurn2 ? ` (${pct(cnt, s.reachedTurn2)} given T1 miss)` : '';
        lines.push(`    [${cat}]: ${pct(cnt, numTrials)}${cond}`);
      }
    }

    lines.push('  ' + '─'.repeat(20));
    if (Object.keys(s.turn1Counters).length + Object.keys(s.turn2Counters).length > 1)
      lines.push(`  [total]: ${pct(s.aggregate, numTrials)}`);
    lines.push('  ' + '─'.repeat(20));
    const noDupHits = s.aggregate - s.dupCounter;
    lines.push(`  [no-dup]: ${s.aggregate > 0 ? pct(noDupHits, s.aggregate) : 'N/A'} of success`);
  }

  console.log(lines.join('\n'));
  process.exit(0);
}

console.error(`Unknown command: ${command}. Use 'probability' or 'expand'.`);
process.exit(1);
