# Four-level packaging (Pallet / Case / Box / Unit) - design for review

**Status: needs one decision from you before I build it.** Task 1 (benchmark) and task 3 (licence request flow) are done and pushed. This is the design for task 2. Read the "Decision" section at the end; approve an option and I implement it.

Written for: Mitul (and the professor, if useful) - a design to approve, not final code.

## What task 2 has to do
From the notes and Papers 4/6:
- A Manufacturer makes a **Pallet** that contains **Cases**, each containing **Boxes**, each containing **Units**. Every level has its own **unique QR ID** (Paper 6, Algorithm 1: `id = hash(parentId, serial)`).
- **Splitting:** the Manufacturer ships a whole pallet to a Distributor; the Distributor breaks it up and ships **boxes/units to different Retailers**; the Retailer sells **single units** to consumers.
- **Cattle angle:** a consumer buys a portion, not the whole animal/pallet, so each unit needs its own ID and its own trace (100 boxes = 100 unique IDs).
- The consumer scans **one unit's** QR and sees the whole chain MF -> DT -> RT, plus which pallet/case/box it came from.

## The hard constraint (why this needs a decision)
Today one product = one ERC-721 token, and a token moves **atomically** MF -> DT -> RT. Two problems:
1. **You can't mint 100 unit-tokens per pallet.** Each `createProduct` costs ~570k gas (measured in the benchmark). 100 units = ~57M gas - **12x over Besu's 4.7M block limit.** It physically won't fit in a block.
2. **Splitting needs a divisible token.** A whole-token model can't send 40 units to one retailer and 60 to another.

So we need a model where the unit IDs are cheap and the token can be split.

## The three options

### Option A - One ERC-721 token per unit
Mint every unit as its own token. Clean conceptually; each unit is individually tradeable.
- Pro: closest to "every unit is a real on-chain token."
- Con: **gas-prohibitive** (must mint in tiny batches of ~5-6 per tx; a 100-unit pallet = ~18 transactions just to create). Bloats state. Impractical at real scale. **Not recommended.**

### Option B - Quantity + split-on-demand (RECOMMENDED)
A pallet is **one token with a quantity** (e.g., 100 units). You only create a new child token when you actually **split** it.
- Unit/box/case IDs are **deterministic hashes** (Paper 6 Algorithm 1), computed without minting anything - so "100 unique IDs" exist as derived IDs, cheaply.
- `splitProduct(id, qty)` mints a child token for `qty` units, links child -> parent, and decrements the parent. A Distributor splits a 100-unit pallet into, say, 60 + 40 for two Retailers; each piece moves independently through the existing ship/confirm flow.
- A consumer scans a unit QR -> it resolves to the token that currently holds that unit -> shows the full MF->DT->RT trace + the pallet/case/box lineage.
- Pro: **gas scales with the number of splits, not the number of units** (a pallet never split = 1 token; split into 3 shipments = 3 tokens). Fits the block limit. Matches the paper's hash-ID hierarchy.
- Con: a "unit" isn't its own token unless it's split down to qty 1; it's a quantity inside a token. For a demo and the paper this is fine and is how real systems (and Paper 6's registries) actually work.

### Option C - Separate packaging registry, products unchanged
Keep `ProductTransfer`/`Custody` exactly as-is; add a `Packaging` contract that only records the 4-level ID hierarchy for look-up.
- Pro: no change to the core model, smaller redeploy risk.
- Con: **does not solve splitting** - you still can't ship different boxes to different retailers, which is the main requirement. Only useful as an add-on to A or B. **Not sufficient alone.**

## Recommendation: Option B
It is the only one that (a) fits Besu's gas limit, (b) supports real splitting, and (c) matches Paper 6's deterministic ID hierarchy. It is an **additive** change: the existing single-product flow keeps working; splitting is new behavior on top.

### What Option B changes
Contracts (one redeploy):
- `Custody.Product`: add `uint256 parent` (0 for an original pallet) and treat `quantity` as the unit count.
- `ProductTransfer`: add `splitProduct(uint256 id, uint256 qty)` -> mints a child token, links it, decrements the parent; add views to walk parent/child and resolve a unit ID to its token.
- A small pure helper for the Paper-6 hash IDs (`palletId/caseId/boxId/unitId`), with tests.

Frontend:
- Distributor (and Manufacturer) get a "Split" action on a product to carve off a quantity for a specific partner before shipping.
- The public verify page resolves a scanned unit ID and shows its pallet/case/box lineage plus the normal custody chain.
- `normProduct` in `src/lib/chain.js` gains `parent` + unit-range fields.

Tests: split flow, gas stays under the block limit, unit-ID resolution, trace through a split.

### Phases (so it is reviewable, not one giant diff)
1. **IDs + data model**: `parent` field, the hash-ID helper, `splitProduct` + views, tests. (contract, redeploy)
2. **UI - split + inventory**: split action, child/parent display in dashboards.
3. **UI - public trace**: unit-ID resolution on the verify page, pallet/case/box lineage.

## Decision I need from you
1. **Approve Option B?** (my recommendation). If you'd rather have a true token-per-unit model despite the gas cost (Option A), say so and I'll scope the batched-minting version instead.
2. **How deep should "unit" go for the demo?** Two sub-choices:
   - (a) Pallet/Case/Box/Unit as a **quantity hierarchy** with derived IDs (lighter, recommended), or
   - (b) allow splitting all the way down to **individual unit tokens** when a Retailer sells one (a split to qty 1). Both are supported by Option B; (b) just means more splits near the consumer end.
3. **Bundle with the task-3 redeploy?** Task 3 (licence requests) already needs a redeploy. If you approve Option B, I'll bundle both into one redeploy so you only wipe/repopulate the chain once.

Reply with "Option B, (a), bundle" (or your variant) and I'll build Phase 1 with tests, then the UI.
