import './style.css';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import JSZip from 'jszip';
import type { SavedDeck } from './types';
import { loadDecks, upsertDeck, deleteDeck as deleteDeckFromStorage } from './storage';
import { runSimulation, resolveHands } from './runner';
import type { Possibilities } from './types';
import SAMPLE_YAML from '../sample.yaml?raw';
import NEW_TEMPLATE_YAML from '../new.yaml?raw';
import ICON_DARK_SVG from './icons/dark.svg?raw';
import ICON_LIGHT_SVG from './icons/light.svg?raw';

// ── DOM refs ──────────────────────────────────────────────────
const deckListEl    = document.getElementById('deck-list')!;
const deckNameInput = document.getElementById('deck-name') as HTMLInputElement;
const btnSave       = document.getElementById('btn-save')!;
const btnNew        = document.getElementById('btn-new')!;
const btnSample     = document.getElementById('btn-sample')!;
const btnExport     = document.getElementById('btn-export')!;
const btnImport     = document.getElementById('btn-import')!;
const btnDelete     = document.getElementById('btn-delete')!;
const btnExpand     = document.getElementById('btn-expand')!;
const btnRun        = document.getElementById('btn-run')!;
const btnTheme      = document.getElementById('btn-theme')!;
const trialsInput   = document.getElementById('trials-input') as HTMLInputElement;
const resultsEl     = document.getElementById('results')!;
const statusMsg     = document.getElementById('status-msg')!;

// ── State ─────────────────────────────────────────────────────
let currentId: string | null = null;

// ── Dark Magician CodeMirror theme ────────────────────────────
const darkMagicianTheme = EditorView.theme({
  '&': { backgroundColor: '#0d0221', color: '#e9d5ff', height: '100%', width: '100%' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': { caretColor: '#e9d5ff' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#a855f7' },
  '.cm-gutters': { backgroundColor: '#130828', color: '#5b3a8a', border: 'none', borderRight: '1px solid #3b1f6b' },
  '.cm-activeLineGutter': { backgroundColor: '#2d125066' },
  '.cm-activeLine': { backgroundColor: '#2d125044' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#3d187066' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#a855f7' },
  '.cm-matchingBracket': { backgroundColor: '#3d187066', color: '#e9d5ff !important' },
  '.cm-tooltip': { backgroundColor: '#1a0a2e', border: '1px solid #3b1f6b', color: '#e9d5ff' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#3d1870' },
  '.cm-searchMatch': { backgroundColor: '#3d1870', outline: '1px solid #5b3a8a' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#5b3a8a' },
}, { dark: true });

const darkMagicianHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: t.keyword,                                        color: '#e879f9' }, // fuchsia
  { tag: [t.name, t.propertyName, t.definition(t.name)],  color: '#c084fc' }, // violet (YAML keys)
  { tag: [t.function(t.variableName), t.labelName],        color: '#818cf8' }, // indigo
  { tag: [t.typeName, t.className, t.namespace],           color: '#fbbf24' }, // gold (card stars)
  { tag: t.number,                                         color: '#fbbf24' }, // gold
  { tag: [t.bool, t.atom, t.null],                         color: '#f472b6' }, // pink/magenta
  { tag: [t.string, t.inserted, t.special(t.string)],      color: '#a78bfa' }, // lavender
  { tag: [t.operator, t.operatorKeyword],                  color: '#818cf8' }, // indigo
  { tag: [t.escape, t.regexp],                             color: '#f472b6' }, // pink
  { tag: [t.meta, t.comment],                              color: '#9b7ac4' }, // muted purple ~6:1
  { tag: t.link,    color: '#818cf8', textDecoration: 'underline' },
  { tag: t.heading, color: '#fbbf24', fontWeight: 'bold' },
  { tag: t.strong,  fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: '#f472b6' },
]));

// ── Blue-Eyes White Dragon CodeMirror theme ───────────────────
const blueEyesTheme = EditorView.theme({
  '&': { backgroundColor: '#f0f4ff', color: '#0f2447', height: '100%', width: '100%' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': { caretColor: '#1d6ed8' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#1d6ed8' },
  '.cm-gutters': { backgroundColor: '#e4ecff', color: '#6b8cbe', border: 'none', borderRight: '1px solid #b8ceff' },
  '.cm-activeLineGutter': { backgroundColor: '#d5e3ff' },
  '.cm-activeLine': { backgroundColor: '#e0e9ff' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#c5d3f5' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#1d6ed8' },
  '.cm-matchingBracket': { backgroundColor: '#c5d3f5', color: '#0f2447 !important' },
  '.cm-tooltip': { backgroundColor: '#eef2ff', border: '1px solid #b8ceff', color: '#0f2447' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#c5d3f5' },
  '.cm-searchMatch': { backgroundColor: '#c5d3f5', outline: '1px solid #9ab4f0' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#9ab4f0' },
}, { dark: false });

const blueEyesHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: t.keyword,                                        color: '#1d4ed8' }, // electric blue
  { tag: [t.name, t.propertyName, t.definition(t.name)],  color: '#1e3a8a' }, // deep navy (YAML keys)
  { tag: [t.function(t.variableName), t.labelName],        color: '#0369a1' }, // ocean blue
  { tag: [t.typeName, t.className, t.namespace],           color: '#b45309' }, // gold frame
  { tag: t.number,                                         color: '#7c3aed' }, // violet
  { tag: [t.bool, t.atom, t.null],                         color: '#0891b2' }, // cyan — like the eyes
  { tag: [t.string, t.inserted, t.special(t.string)],      color: '#0c6e8a' }, // teal
  { tag: [t.operator, t.operatorKeyword],                  color: '#1d6ed8' }, // blue
  { tag: [t.escape, t.regexp],                             color: '#7c3aed' }, // violet
  { tag: [t.meta, t.comment],                              color: '#3a5fa0' }, // muted navy ~5.7:1
  { tag: t.link,    color: '#1d6ed8', textDecoration: 'underline' },
  { tag: t.heading, color: '#b45309', fontWeight: 'bold' },
  { tag: t.strong,  fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: '#c8190e' },
]));

// ── Editor ────────────────────────────────────────────────────
const themeCompartment = new Compartment();
const darkExts  = [darkMagicianTheme, darkMagicianHighlight];
const lightExts = [blueEyesTheme, blueEyesHighlight];

const storedTheme = localStorage.getItem('ygoprob_theme');
let isDark = storedTheme ? storedTheme === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;

const editorContainer = document.getElementById('editor-container')!;
let editorView: EditorView;
try {
  editorView = new EditorView({
    state: EditorState.create({
      doc: SAMPLE_YAML,
      extensions: [
        basicSetup,
        yaml(),
        themeCompartment.of(isDark ? darkExts : lightExts),
        EditorView.lineWrapping,
        keymap.of([{
          key: 'Ctrl-Enter',
          mac: 'Cmd-Enter',
          run: () => { runSim(); return true; },
        }]),
      ],
    }),
    parent: editorContainer,
  });
} catch (err) {
  editorContainer.textContent = 'Editor failed to load: ' + String(err);
  throw err;
}

function editorDoc(): string { return editorView.state.doc.toString(); }

function setEditorDoc(text: string) {
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: text },
  });
}

// ── Deck list ─────────────────────────────────────────────────
function renderList() {
  deckListEl.innerHTML = '';
  for (const deck of loadDecks()) {
    const el = document.createElement('div');
    el.className = 'deck-item' + (deck.id === currentId ? ' active' : '');
    el.textContent = deck.name;
    el.onclick = () => loadDeck(deck.id);
    deckListEl.appendChild(el);
  }
}

function loadDeck(id: string) {
  const deck = loadDecks().find(d => d.id === id);
  if (!deck) return;
  currentId = id;
  deckNameInput.value = deck.name;
  setEditorDoc(deck.yaml);
  renderList();
  clearResults();
}

function saveDeck() {
  const name = deckNameInput.value.trim() || 'Untitled';
  const deck: SavedDeck = {
    id: currentId ?? crypto.randomUUID(),
    name,
    yaml: editorDoc(),
    updatedAt: Date.now(),
  };
  currentId = deck.id;
  upsertDeck(deck);
  renderList();
}

function newDeck() {
  currentId = null;
  deckNameInput.value = 'New Deck';
  setEditorDoc(NEW_TEMPLATE_YAML);
  renderList();
  clearResults();
}

function loadSample() {
  currentId = null;
  deckNameInput.value = 'sample';
  setEditorDoc(SAMPLE_YAML);
  renderList();
  clearResults();
}

function deleteCurrent() {
  if (!currentId) return;
  deleteDeckFromStorage(currentId);
  currentId = null;
  deckNameInput.value = '';
  renderList();
  clearResults();
}

function clearResults() { resultsEl.textContent = ''; }

function importDecks() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      let count = 0;
      for (const [filename, entry] of Object.entries(zip.files)) {
        if (entry.dir || !/\.(yaml|yml)$/i.test(filename)) continue;
        const text = await entry.async('string');
        const name = filename.replace(/\.(yaml|yml)$/i, '');
        const existing = loadDecks().find(d => d.name === name);
        upsertDeck({ id: existing?.id ?? crypto.randomUUID(), name, yaml: text, updatedAt: Date.now() });
        count++;
      }
      renderList();
      statusMsg.textContent = `Imported ${count} deck(s).`;
      setTimeout(() => { statusMsg.textContent = ''; }, 3000);
    } catch (e) {
      resultsEl.textContent = 'Import failed: ' + String(e);
    }
  };
  input.click();
}

async function exportDecks() {
  if (currentId !== null) saveDeck(); // flush unsaved editor changes before zipping
  const decks = loadDecks();
  if (!decks.length) { alert('No saved decks to export.'); return; }
  const zip = new JSZip();
  for (const deck of decks) {
    const safe = deck.name.replace(/[/\\:*?"<>|]/g, '_');
    zip.file(`${safe}.yaml`, deck.yaml);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'decks.zip';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Result rendering ──────────────────────────────────────────
function pct(n: number, d: number) { return (n / d * 100).toFixed(2) + '%'; }

function renderResults(
  r: Awaited<ReturnType<typeof runSimulation>>,
  numTrials: number,
) {
  const lines: string[] = [];
  lines.push(`None-engine: ${r.neCount}/${r.deckCount}`);
  if (r.noptCount) lines.push(`Non-opt: ${r.noptCount}/${r.deckCount}`);
  if (r.errors.length) { lines.push(''); r.errors.forEach(e => lines.push('⚠ ' + e)); }

  for (const s of r.results) {
    lines.push('');
    const side  = s.hasSide ? ', after side' : '';
    const turn  = s.going2nd ? 'going 2nd' : 'going 1st';
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

  resultsEl.textContent = lines.join('\n');
}

// ── Expand hands ─────────────────────────────────────────────
function formatPossibilities(poss: Possibilities): string[] {
  return poss.map((hand, i) => {
    const parts = hand.map(([card, min, sign]) =>
      min === 1 && sign === '+' ? card : `${min}${sign} ${card}`);
    return `  ${i + 1}: ${parts.join(' AND ')}`;
  });
}

function expandHands() {
  try {
    const { categories, scenarios } = resolveHands(editorDoc());
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
        for (const [turn, cats] of [['Turn 1', turn1], ['Turn 2', turn2]] as const) {
          const entries = Object.entries(cats);
          if (!entries.length) continue;
          lines.push(`  ${turn}:`);
          for (const [label, poss] of entries) {
            lines.push(`    [${label}] — ${poss.length} hand${poss.length !== 1 ? 's' : ''}`);
            lines.push(...formatPossibilities(poss).map(l => '    ' + l));
          }
        }
      }
    }

    resultsEl.textContent = lines.join('\n');
  } catch (e) {
    resultsEl.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Run simulation ────────────────────────────────────────────
async function runSim() {
  btnRun.setAttribute('disabled', 'true');
  (btnRun as HTMLButtonElement).textContent = '⏳ Running…';
  resultsEl.textContent = '';

  try {
    const numTrials = Math.max(100, parseInt(trialsInput.value) || 100000);
    const result = await runSimulation(
      editorDoc(),
      numTrials,
      msg => { statusMsg.textContent = msg; },
    );
    renderResults(result, numTrials);
  } catch (e) {
    resultsEl.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    btnRun.removeAttribute('disabled');
    (btnRun as HTMLButtonElement).textContent = '▶ Run';
    statusMsg.textContent = '';
  }
}

// ── Theme toggle ──────────────────────────────────────────────
function applyTheme(dark: boolean) {
  isDark = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  editorView.dispatch({ effects: themeCompartment.reconfigure(dark ? darkExts : lightExts) });
  // Show the icon for the current theme
  btnTheme.innerHTML = dark ? ICON_DARK_SVG : ICON_LIGHT_SVG;
  btnTheme.title = dark ? 'Switch to light' : 'Switch to dark';
  localStorage.setItem('ygoprob_theme', dark ? 'dark' : 'light');
}
applyTheme(isDark); // set button label on init

// ── Resizer ───────────────────────────────────────────────────
const resizer   = document.getElementById('resizer')!;
const splitPane = document.getElementById('split-pane')!;

resizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizer.classList.add('dragging');
  // Disable pointer events on editor iframe/canvas during drag so mousemove stays live
  editorContainer.style.pointerEvents = 'none';

  const onMove = (ev: MouseEvent) => {
    const rect = splitPane.getBoundingClientRect();
    const pct = Math.max(20, Math.min(80, (ev.clientX - rect.left) / rect.width * 100));
    editorContainer.style.flexBasis = pct + '%';
  };
  const onUp = () => {
    resizer.classList.remove('dragging');
    editorContainer.style.pointerEvents = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// ── Event listeners ───────────────────────────────────────────
btnTheme.onclick  = () => applyTheme(!isDark);
btnSave.onclick   = saveDeck;
btnNew.onclick    = newDeck;
btnSample.onclick = loadSample;
btnExport.onclick = exportDecks;
btnImport.onclick = importDecks;
btnDelete.onclick = deleteCurrent;
btnExpand.onclick = expandHands;
btnRun.onclick    = runSim;

// ── Init ──────────────────────────────────────────────────────
const saved = loadDecks();
if (saved.length > 0) {
  loadDeck(saved[0].id);
} else {
  loadSample();
}
renderList();
