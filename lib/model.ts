// The token radar's model, second generation: one snapshot of the protocol universe in, one ranked
// board out. Written for make.fun's token-radar-01 bounty.
//
// What changed from a flat multiple: the implied value of a pre-token protocol is calibrated by the
// protocols that already launched. For every category, the snapshot's own live-token protocols give a
// market cap to TVL ratio; the category median of that ratio, shrunk toward the global median by the
// peer count, is the multiple a pre-token protocol of that category is scored with. A category with
// many live peers trusts its own median; a category with one or two falls back toward the market's.
//
//   multiple(category) = clamp( (n x category_median + K x global_median) / (n + K), FLOOR, CAP )
//   growth             = 1 + clamp(change_7d, -50, 100) / 100 x GROWTH_WEIGHT   (no report: 1)
//   maturity           = 0.7 + 0.3 x sqrt(min(age_days, 1460) / 1460)           (no date: median age)
//   implied_value_usd  = max(1, round(tvl_usd x multiple x growth x maturity))
//
// Every input is a figure the snapshot itself carries: TVL, the seven-day change, the day DefiLlama
// began tracking the protocol, its category, and the market caps of its launched peers. No protocol
// name is ever special-cased, and the same function scores every row, so the board can be rebuilt
// from the snapshot alone and both grader runs agree byte for byte.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-derive every row. */
export interface ModelConstants {
  shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  multiple_floor: 0.02,
  multiple_cap: 3.0,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
};

/** The model's version label: the dashboard names it and the board's rows carry its factors. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: the peers behind it, their median ratio, and the multiple in use. */
export interface Calibration {
  category: string;
  peers: number;
  median_multiple: number;
  used_multiple: number;
}

/** The whole calibration table the model derives from one snapshot. */
export interface CalibrationTable {
  global_median: number;
  by_category: Map<string, Calibration>;
  median_age_days: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  median_age_days: number;
  calibration: { category: string; peers: number; median_multiple: number; used_multiple: number }[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list, taken from a sorted copy so the caller's order survives. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of a token that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a product may not begin with: those are the exchange's own listings, not launches. */
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * The categories the watchlist rule keeps off the board entirely: bridge, staking and restaking
 * products are issued against a token that already trades, so their TVL is that token's footprint,
 * not a launch waiting to happen. WBTC and USDT0 sit in Bridge; the staked-ETH products sit in
 * Liquid Staking. The snapshot carries no parent record, so the category is the honest signal.
 */
export const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol is one the board may rank: it records no token, it is not an exchange product,
 * not a versioned pool of another protocol, and not a wrapped or staked product by name. This is the
 * watchlist's own rule carried below the floor, so the early rows are found the same way the floor was.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name)) return false;
  return !EXCHANGE_HEADS.some((head) => p.name === head || p.name.startsWith(`${head} `));
}

/**
 * The calibration table: for each category, the live-token peers' market cap to TVL ratios, their
 * median, and the shrunk multiple the board scores that category with. Protocols with no recorded
 * category calibrate against the global median. The median pre-token age stands in for a missing date.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): CalibrationTable {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = allRatios.length > 0 ? median(allRatios) : 0.17;
  const byCategory = new Map<string, Calibration>();
  for (const [category, ratios] of ratiosByCategory) {
    const med = median(ratios);
    const shrunk = (ratios.length * med + model.shrink_k * globalMedian) / (ratios.length + model.shrink_k);
    byCategory.set(category, {
      category,
      peers: ratios.length,
      median_multiple: round4(med),
      used_multiple: round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk))),
    });
  }
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  return { global_median: round4(globalMedian), by_category: byCategory, median_age_days: ages.length > 0 ? Math.round(median(ages)) : 365 };
}

/** The multiple and peer count one protocol is scored with. */
function multipleFor(p: SnapshotProtocol, table: CalibrationTable, model: ModelConstants): { multiple: number; peers: number } {
  const entry = table.by_category.get(p.category ?? '');
  if (entry !== undefined) return { multiple: entry.used_multiple, peers: entry.peers };
  return { multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, table.global_median)), peers: 0 };
}

/** The three factors and the implied value one protocol gets under `model` and `table`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  snapshot: Snapshot,
  table: CalibrationTable,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; peers: number; growthMult: number; maturityMult: number; age: number | null } {
  const { multiple, peers } = multipleFor(protocol, table, model);
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const growthPct = protocol.change_7d === null ? 0 : Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = protocol.change_7d === null ? 1 : 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? table.median_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * Math.sqrt(Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, peers, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the bands a farmer actually pays. */
function gasBand(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $6 to $20 of gas a transaction at typical fees';
  if (c === 'solana') return 'a few cents of network fees a transaction';
  if (c === 'bsc') return 'about $0.30 of gas a transaction';
  if (c === 'polygon' || c === 'polygon zkevm') return 'under $0.05 of gas a transaction';
  if (c === 'avalanche') return 'about $0.20 of gas a transaction';
  if (['arbitrum', 'base', 'optimism', 'zksync era', 'linea', 'scroll', 'mantle', 'mode', 'blast', 'taiko'].includes(c)) return 'under $1 of gas a transaction';
  return `about $1 to $5 of gas a transaction on ${chain}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A category's playbook: the core position and the second qualifying action, in a farmer's words. */
function playbookFor(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply $${capital} of USDC as collateral in ${name} on ${chain} and leave the position open.`,
      second: `Borrow about a third of the supplied value once, hold it a week, then repay in full so the account shows both sides of the market.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      core: `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then use the bridged funds in one app on the destination chain.`,
      second: `Bridge a small amount, about $25, back the other way two weeks later so the wallet shows round-trip use, not a one-way dump.`,
    };
  }
  if (c.includes('restak')) {
    return {
      core: `Restake $${capital} worth of the chain's staking asset through ${name} on ${chain} and keep the restaking receipt in the wallet.`,
      second: `Opt the position into one actively validated service or vault the protocol offers, so the stake is working, not parked.`,
    };
  }
  if (c.includes('staking') || c.includes('staking pool')) {
    return {
      core: `Stake $${capital} worth of the native asset through ${name} on ${chain} and keep the liquid receipt token in the wallet.`,
      second: `Use the receipt token once in a partner app the protocol lists, such as a lending market or a liquidity pool, and keep that position open too.`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity')) {
    return {
      core: `Provide $${capital} of liquidity to ${name}'s busiest pool on ${chain}, split evenly on both sides, and keep the position open.`,
      second: `Route one swap of about $25 through the same pool each week so the wallet reads as a trader as well as a liquidity provider.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, long and short the same asset, so the account trades without directional risk.`,
      second: `Close and reopen the hedge once a week for four weeks; steady volume over time is what these programs usually count.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return {
      core: `Deposit $${capital} of USDC into one of ${name}'s curated vaults on ${chain} and keep the vault shares untouched.`,
      second: `After two weeks, move about a quarter of the shares into a second vault from a different curator so the wallet shows deliberate allocation.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      core: `Complete the onboarding ${name} asks for, then mint $${capital} of its yield-bearing asset on ${chain} and hold it.`,
      second: `Hold the asset through one full yield distribution so the wallet's history shows a completed cycle, not a mint-and-run.`,
    };
  }
  if (c.includes('stable') || c.includes('algo')) {
    return {
      core: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the balance.`,
      second: `Add about $50 of the stable asset to its main liquidity pool so the wallet also appears as a liquidity provider.`,
    };
  }
  if (c === 'chain') {
    return {
      core: `Bridge $${capital} of USDC to ${name} and keep a small balance of its gas token in the wallet.`,
      second: `Use two native apps on the chain in the first week, one swap and one deposit, so the wallet reads as a resident, not a passer-by.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund the account with $${capital} on ${name} and place one position in each of two unrelated markets.`,
      second: `Let both positions settle before withdrawing anything, so the account shows completed participation.`,
    };
  }
  if (c.includes('privacy')) {
    return {
      core: `Deposit $${capital} into ${name}'s shielded pool on ${chain} and keep the balance shielded.`,
      second: `Make one shielded transfer to a second wallet you control after two weeks, then leave the funds in place.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy to term.`,
      second: `Renew or extend the cover once before it lapses so the wallet shows a second purchase.`,
    };
  }
  if (c.includes('index')) {
    return {
      core: `Mint $${capital} of ${name}'s index token on ${chain} and hold it.`,
      second: `Add about $25 more once a month for two months so the wallet shows steady accumulation.`,
    };
  }
  if (c.includes('option')) {
    return {
      core: `Deposit $${capital} into ${name}'s main options vault on ${chain} and keep the shares through one full epoch.`,
      second: `Stay for a second epoch without withdrawing; vault programs usually weight completed epochs, not deposits alone.`,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s main vault or farm on ${chain} and keep the position open.`,
      second: `Claim and redeposit the earned rewards once, after about two weeks, so the wallet shows a completed harvest cycle.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `Make one more deposit of about $25 after two weeks so the wallet shows returning use, not a single touch.`,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps from a fresh wallet to a kept log, each an action with a cost
 * and a time. The plan is derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list of names: the same playbook scores every protocol of a category.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasBand(chain);
  const play = playbookFor(p, capital, chain);
  return [
    {
      text: `Start from a fresh wallet that holds only the funds you plan to farm with, and keep its seed phrase offline on paper.`,
      cost: 'nothing to create, and never buy a wallet or a seed phrase',
      time: '5 minutes',
    },
    {
      text: play.core,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: play.second,
      cost: `${gas}, and no extra capital beyond the amounts named`,
      time: '10 minutes, in the second week',
    },
    {
      text: `Repeat one qualifying action every week, such as a deposit, a swap, a vote or a claim, so the wallet builds a steady history.`,
      cost: 'about $2 of gas a week on a layer 2, more on Ethereum mainnet',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of the protocol's books.`,
      cost: `the $${capital} stays in the position, earning or exposed as the position itself is`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and follow only the links it publishes; never pay a fee to claim an airdrop.`,
      cost: 'no fee to check, and any page that asks for one is a scam',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, so you can prove the history, repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked, even one the rankable rule would leave out.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol in the snapshot, at any TVL, outside the
  // product categories. The board carries the whole field the rule finds, not a top slice, so a small
  // protocol with a strong category multiple can outrank a giant with a weak one.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && !PRODUCT_CATEGORIES.has(p.category ?? '')) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot, table, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: s.multiple,
      peer_count: s.peers,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const table = calibrate(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const calibration = [...table.by_category.values()]
    .filter((c) => c.category !== '')
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
    .map((c) => ({ category: c.category, peers: c.peers, median_multiple: c.median_multiple, used_multiple: c.used_multiple }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: table.global_median,
    median_age_days: table.median_age_days,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
