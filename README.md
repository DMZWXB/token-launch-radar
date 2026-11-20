# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/DMZWXB/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/DMZWXB/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: every protocol in a sealed DefiLlama snapshot that records no token yet and is not a wrapped, staked or bridged product of one that trades, ranked by implied value — what a token would be worth if the protocol's record stayed exactly as it is. The value model (radar-2) is calibrated by the snapshot's own launched protocols: each category's multiple is the median market cap / TVL of its already-trading peers, shrunk toward the global median by the peer count, then adjusted for seven-day growth and for how long the protocol has run with no token. Every row carries a farm plan generated from its own record (category playbook, chain gas band, TVL-sized position, age-based holding window), and the static dashboard renders offline with a filterable board, a per-protocol detail view that recomputes its own numbers, the launched-peer calibration table, and a full method page.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22 or later, standard library only. The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
