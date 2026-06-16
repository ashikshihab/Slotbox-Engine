# Slotbox Engine — Prototype Build Spec (v2)

This is a build brief for an AI coding agent.

**Build the scheduling engine only.** Not the app. No login, no real video, no payments, no mobile UI, no advertiser dashboard. Just the engine that decides what plays on a screen across a day, plus a thin control panel and a timeline so a human can see it working and check that the promises hold.

Think of it as a flight simulator for one screen's day.

> **What changed from v1:** the per-buyer independent timers are gone. They caused collisions and drift that piled up across the day. They're replaced by **one shared rotation** — at each break the engine makes a single decision. This is simpler code and removes three separate problems at once. There's also a small fix so the last play of the day never airs past closing time.

---

## What this engine does, in plain words

A screen in a shop plays content all day while the shop is open. There are two kinds of content:

- **Venue ads** (the shop's own promos). Free. They fill the gaps. Each one runs 10–300 seconds.
- **Paid ads** (bought by a local business). Each one runs 10–60 seconds.

The shop owner decides how many paid slots to open. A slot is a fixed share of the day's airtime. When a business submits an ad, the engine works out roughly how many times it will play that day and shows them the number. They accept or walk away. No haggling.

The engine's whole job: take the inputs, hand each buyer a fair share of plays spread evenly across the day, and produce a minute-by-minute schedule where venue ads fill the gaps and paid ads drop in at clean breaks.

---

## The inputs

The control panel must let a user set all of these and re-run instantly.

| Input | Set by | Range | Notes |
|---|---|---|---|
| `X` | shop | 1–24 | open hours per day |
| `Y` | shop | 1–10 | number of paid slots offered |
| `SLOT_SHARE` | config | default `0.10` | fraction of airtime one slot buys. Expose it as an editable constant — it's the dial that controls everything |
| venue ads | shop | each 10–300s | a list. Add / remove. Each has an id and a duration |
| paid buyers | buyer | each ad 10–60s | a list. Add / remove. Each has a name and an ad duration. Adding one runs the capacity check |

Because each slot is `SLOT_SHARE` of the day, the most slots that can ever fit is `1 / SLOT_SHARE` (10 at the default). `Y` can't exceed that.

---

## The math (this is exact — get it right)

Let `secondsPerDay = X * 3600`.

A slot buys a fixed chunk of airtime: `slotAirtime = secondsPerDay * SLOT_SHARE`.

When a buyer submits an ad of length `b` seconds, the engine computes:

```
P = floor(slotAirtime / b)          // plays per day for this buyer (a target, shown as "~P")
```

The buyer sees `~P`. They accept or decline. They never set it; the shop never sees it.

**Worked example — X = 8 hours, SLOT_SHARE = 0.10, so slotAirtime = 2880s:**

| Buyer | ad length `b` | `~P` |
|---|---|---|
| b1 | 30s | floor(2880/30) = ~96 |
| b2 | 60s | floor(2880/60) = ~48 |
| b3 | 20s | floor(2880/20) = ~144 |

Every slot eats the same airtime — about 2880 seconds — whatever the ad length. A shorter ad just uses that same airtime more times. **The engine sells airtime; plays fall out of it.** The UI should make this visible: show airtime sold, not just play counts.

**Why the number wears a `~`:** plays are paced evenly across the day, but the screen runs one thing at a time and venue ads are never cut, so exact spacing isn't guaranteed. A buyer may land one or two short of `P` near closing time. That's expected and honest — the proof-of-play log is the source of truth, not the promise.

### Capacity check (runs every time a buyer is added)

A buyer is accepted only if both are true:

```
(number of buyers so far) < Y
AND
(seconds already booked) + (P * b) <= secondsPerDay
```

If it fails, block the sale and say why ("all slots taken" vs "screen is full"). Don't silently drop it.

---

## The simulation (the heart of it)

Walk through one day in seconds, from `t = 0` (open) to `t = secondsPerDay` (close), and produce an ordered list of play events: `{ start, end, adId, type }` where type is `paid` or `venue`.

There is **one shared paid rotation**, not a timer per buyer. At every clean break the engine asks two questions:

1. **Paid or venue?** Paid plays should land evenly, so an ideal paid play happens about every `secondsPerDay / totalP` of airtime (where `totalP` is the sum of all buyers' `P`). If the clock has reached the next ideal paid time and plays remain, it's a paid break. Otherwise a venue ad fills the gap.
2. **Whose turn?** The buyer **most behind their fair pace** goes next. By time `t`, buyer `j` should have had about `P[j] * (t / secondsPerDay)` plays; pick whoever is furthest below that. This self-corrects and spreads each buyer evenly.

Rules the schedule obeys:

- **Venue ads never get cut.** Once one starts it finishes. They run as a round-robin loop in the gaps.
- **A paid ad only drops in at a clean break** — the moment a venue ad finishes. Never mid-ad, never on a blank screen.
- **No paid ad airs past closing.** A paid ad fires only if `t + b <= secondsPerDay`. This is the fix for the day-end boundary case — better to air one fewer play than to run an ad after the shop closes.
- **No two paid ads overlap.** There is one queue and one decision per break, so this is true by construction. (At high fill, paid ads can still run back-to-back across consecutive breaks — that's the accepted "tight gap" behavior, not a collision.)

### Suggested loop

```
totalP        = sum of P over all accepted buyers
playsSoFar[j] = 0 for every buyer
loopIndex     = 0                      // pointer into venue-ad list
paidDone      = 0
nextPaidIdeal = secondsPerDay / totalP // clock-anchored, so drift never compounds
t             = 0
events        = []

while t < secondsPerDay:
    paidDue = (totalP > 0) and (paidDone < totalP) and (t >= nextPaidIdeal)

    if paidDue:
        // whose turn: most behind their fair pace
        eligible = [ j for j in buyers if playsSoFar[j] < P[j] ]
        pick = the j in eligible with the largest
               ( P[j] * (t / secondsPerDay) - playsSoFar[j] )

        // boundary guard: only play if it finishes before close
        if t + b[pick] <= secondsPerDay:
            push event { start: t, end: t + b[pick], adId: pick, type: paid }
            playsSoFar[pick] += 1
            paidDone += 1
            t += b[pick]

        nextPaidIdeal += secondsPerDay / totalP   // advance regardless, so cadence stays on the clock

    else:
        ad = venueAds[loopIndex]
        loopIndex = (loopIndex + 1) mod (number of venue ads)
        if t + ad.duration > secondsPerDay:       // last gap won't fit a full venue ad
            break                                 // end the day cleanly
        push event { start: t, end: t + ad.duration, adId: ad.id, type: venue }
        t += ad.duration
```

Build that, make it run clean, stop there. No look-ahead venue-ad picking, no per-buyer timers, no contention-resolution logic — the single rotation makes all of that unnecessary.

---

## What the screen should show

Keep it functional, not pretty. Three regions:

**1. Inputs** — the table above. Editable. A "Run day" button (or auto-run on change).

**2. The timeline** — a horizontal bar for the day, left = open, right = close. Venue ads in a neutral grey, each paid buyer in their own colour. Make it scrollable or zoomable since a real day has hundreds of blocks; showing the first 30–60 minutes in detail plus a full-day overview bar is enough. Hovering a block shows `{ adId, type, start, length }`.

**3. The scoreboard** — the part that proves the model works. Show:

- Per buyer: target `~P` vs actual plays, and how evenly they were spread (e.g. average gap, and the longest gap between their plays).
- Per venue ad: how many times it played. (None should ever be cut.)
- For the day: % of airtime that went to paid vs venue vs idle, and the longest stretch with no paid ad.

### The "promises kept?" panel

A short checklist the simulation fills in with a tick or cross, straight from the run:

- Venue ads never cut mid-play
- No two paid ads ever overlap
- No paid ad aired past closing time
- Every buyer's actual plays are at or just below their target `~P` (never wildly under)
- Each buyer's plays are spread across the whole day, not clustered

This panel is the point of the prototype. It's how a hiring manager (and you) can see at a glance that the engine does what it claims — and where the honest `~` lives.

---

## Out of scope (do not build)

No login or accounts. No real video upload or playback. No payments or commission math. No mobile app shell, no advertiser web dashboard, no maps, no proof-of-play storage. No backend or database — everything runs in memory in the browser. No styling effort beyond what's needed to read the timeline and scoreboard clearly.

If a choice would add a feature instead of clarifying the engine, skip it.

## Deliberately not optimized (and that's fine)

This is a concept prototype to prove the model is sound, not a production scheduler. We are **not** chasing exact play counts, perfect spacing, or sub-second precision. The `~` on the number and the proof-of-play log are how fairness is kept honest. Anything beyond "evenly spread, close to target, never past close, never overlapping" is out of scope.

---

## Tech notes

Self-contained and runnable with one command. A single-page app is ideal — plain HTML/CSS/JS is completely fine, or a small React + Vite setup if that's cleaner. No external services. Keep the scheduling logic in its own module (a pure function: inputs in, event list + metrics out) so it's testable on its own and easy to lift into the real app later.

## Definition of done

- I can set X, Y, SLOT_SHARE, a list of venue ads, and a list of buyers, and re-run instantly.
- Adding a buyer shows their `~P`, and the capacity check blocks them (with a reason) when the screen is full or slots are gone.
- "Run day" produces a visible timeline and a filled-in scoreboard.
- The "promises kept?" panel ticks through honestly from the actual run.
- No paid ad ever airs past closing time, and no two paid ads overlap.
