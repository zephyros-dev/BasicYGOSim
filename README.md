# YGOProb

Yu-Gi-Oh! deck consistency estimator using Monte Carlo simulation.

## Setup

1. Install [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/installation).
   If you use [mise](https://mise.jdx.dev/), the correct versions are pinned in `mise.toml` and will be picked up automatically.

2. Install dependencies:

   ```bash
   pnpm install
   ```

## Web UI

Start the dev server:

```bash
pnpm dev
```

Then open the URL shown in the terminal (usually `http://localhost:5173`).

### Interface

| Area | Description |
| --- | --- |
| Toolbar | **Expand** resolves hand conditions without simulating. **▶ Run** runs the simulation. **Trials** controls accuracy vs. speed. |
| Sidebar | Create, load, save, delete, export and import decks. |
| Editor (left pane) | Edit your deck YAML. |
| Results (right pane) | Hit rates appear here after Run or Expand. |

## CLI

```bash
# Run simulation
pnpm ygoprob probability -d deck.yaml

# Show expanded hand conditions (no simulation)
pnpm ygoprob expand -d deck.yaml

# Options
pnpm ygoprob --help
```

| Flag | Default | Description |
| --- | --- | --- |
| `-d`, `--deck` | *(required)* | Path to the deck YAML file |
| `-n`, `--trials` | `100000` | Number of simulation trials |

## Deck format

Decks are written in YAML. See `sample.yaml` for a fully annotated example covering the deck list, category definitions, and scenario hand conditions.

## Notes

- Inspired by [flipflipshift/BasicYGOSim](https://github.com/flipflipshift/BasicYGOSim)
