# Slotbox Engine — Prototype Build Spec

This is a build brief for an AI coding agent.

**Build the scheduling engine only.** Not the app. No login, no real video, no payments, no mobile UI, no advertiser dashboard. Just the engine that decides what plays on a screen across a day, plus a thin control panel and a timeline so a human can see it working and check that the promises hold.

Think of it as a flight simulator for one screen's day.

---

## What this engine does, in plain words

A screen in a shop plays content all day while the shop is open. There are two kinds of content:

- **Venue ads** (the shop's own promos). Free. They fill the gaps. Each one runs 10–300 seconds.
- **Paid ads** (bought by a local business). Each one runs 10–60 seconds.

The shop owner decides how many paid slots to open. A slot is a fixed share of the day's airtime. When a business submits an ad, the engine works out how many times it will play that day and shows them the number. They accept or walk away. No haggling.

The engine's whole job: take the inputs, hand each buyer a fair play count, and produce a minute-by-minute schedule where venue ads fill the gaps and paid ads drop in at clean breaks.

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
P = floor(slotAirtime / b)          // plays per day for this buyer
F = secondsPerDay / P               // ideal seconds between their plays
```

The buyer sees `P`. They accept or decline. They never set it; the shop never sees it.

**Worked example — X = 8 hours, SLOT_SHARE = 0.10, so slotAirtime = 2880s:**

| Buyer | ad length `b` | `P` | `F` |
|---|---|---|---|
| b1 | 30s | floor(2880/30) = 96 | 28800/96 = 300s (~5 min) |
| b2 | 60s | floor(2880/60) = 48 | 28800/48 = 600s (~10 min) |
| b3 | 20s | floor(2880/20) = 144 | 28800/144 = 200s (~3.3 min) |

Notice every slot eats the same airtime — about 2880 seconds — whatever the ad length. A shorter ad just uses that same airtime more times. **The engine sells airtime; plays fall out of it.** This is the core idea, so the UI should make it visible: show airtime sold, not just play counts.

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

Rules the schedule must obey:

1. **Venue ads never get cut.** Once one starts, it finishes. They run as a round-robin loop in the gaps.
2. **A paid ad only drops in at a clean break** — the moment a venue ad finishes. Never mid-ad, never on a blank screen.
3. **Each buyer plays on their own timer.** Buyer `j` becomes "due" when `t - lastPlay[j] >= F[j]` and they still have plays left (`playsSoFar[j] < P[j]`).
4. **Plays are approximate, on purpose.** A paid ad fires at the first break *after* it's due, so it can drift later by up to one venue-ad length. Both sides accept this; the proof-of-play log is the source of truth, not the promise. Don't try to make it exact.

### Suggested loop

```
t = 0
events = []
lastPlay[j]   = 0 for every buyer
playsSoFar[j] = 0 for every buyer
loopIndex     = 0   // pointer into venue-ad list

while t < secondsPerDay:
    due = [ j for j in buyers
            if (t - lastPlay[j]) >= F[j] and playsSoFar[j] < P[j] ]

    if due is not empty:
        if length(due) > 1:
            record a CONTENTION event   // see open question below
        // resolve by playing the most-overdue buyer first
        j = the buyer in `due` with the largest (t - lastPlay[j] - F[j])
        push event { start: t, end: t + b[j], adId: j, type: paid }
        lastPlay[j]   = t
        playsSoFar[j] += 1
        t += b[j]
        // loop re-checks immediately — a still-due buyer will play
        // back-to-back. That's allowed; just let it happen and measure it.
    else:
        ad = venueAds[loopIndex]
        loopIndex = (loopIndex + 1) mod (number of venue ads)
        push event { start: t, end: t + ad.duration, adId: ad.id, type: venue }
        t += ad.duration
```

That's the faithful core. Build that first and make sure it runs clean before anything fancy.

**Optional enhancement (off by default, behind a toggle):** before playing a venue ad, peek at how soon a buyer goes due; if a long venue ad would overshoot, pick a shorter one that fits. This trims drift. Leave it off so the raw behavior is visible first.

---

## What the screen should show

Keep it functional, not pretty. Three regions:

**1. Inputs** — the table above. Editable. A "Run day" button (or auto-run on change).

**2. The timeline** — a horizontal bar for the day, left = open, right = close. Venue ads in a neutral grey, each paid buyer in their own colour. Make it scrollable or zoomable since a real day has hundreds of blocks; showing the first 30–60 minutes in detail plus the full-day overview bar is enough. Hovering a block shows `{ adId, type, start, length }`.

**3. The scoreboard** — the part that proves the model works. Show:

- Per buyer: promised `P` vs actual plays, ideal `F` vs actual average gap, and **max drift** (the biggest gap between when a play was due and when it actually aired).
- Per venue ad: how many times it played. (Confirm none were ever cut — should always pass by construction.)
- For the day: % of airtime that went to paid vs venue vs idle, the longest stretch with no paid ad, and the **contention count**.

### The "promises kept?" panel

A short checklist the simulation fills in with a tick or cross, straight from the run:

- Venue ads never cut mid-play
- Every buyer's actual plays are within drift of their promised `P`
- Max drift is no bigger than the longest venue ad in rotation
- No two paid ads ever overlap
- Total paid airtime ≈ sum of (`P × b`) across buyers

This panel is the point of the whole prototype. It's how a hiring manager (and you) can see at a glance that the engine does what it claims.

---

## Known open question — surface it, do NOT solve it

When two buyers come due at the same break, they can't both play in that instant. The engine here resolves it by playing the most-overdue one first and letting the other fall to the next break (so they end up back-to-back, and the second one drifts a little more).

This is a deliberate **open question**, not a bug. Don't add scheduling cleverness to prevent it. Instead, **measure it**: count contention events and show how often back-to-back paid runs happen. Then the prototype becomes the tool that tells us *how bad* the problem actually is at 2 slots vs 8 slots — which is exactly why it's worth leaving open for now.

Put a one-line note in the UI near the contention count: "Two buyers can want the same break. Open question — measured here, not solved."

---

## Out of scope (do not build)

No login or accounts. No real video upload or playback. No payments or commission math. No mobile app shell, no advertiser web dashboard, no maps, no proof-of-play storage. No backend or database — everything runs in memory in the browser. No styling effort beyond what's needed to read the timeline and scoreboard clearly.

If a choice would add a feature instead of clarifying the engine, skip it.

---

## Tech notes

Self-contained and runnable with one command. A single-page app is ideal — plain HTML/CSS/JS is completely fine, or a small React + Vite setup if that's cleaner for you. No external services. Keep the scheduling logic in its own module (a pure function: inputs in, event list + metrics out) so it's testable on its own and easy to lift into the real app later.

## Definition of done

- I can set X, Y, SLOT_SHARE, a list of venue ads, and a list of buyers, and re-run instantly.
- Adding a buyer shows their `P` and `F`, and the capacity check blocks them (with a reason) when the screen is full or slots are gone.
- "Run day" produces a visible timeline and a filled-in scoreboard.
- The "promises kept?" panel ticks through honestly from the actual run.
- Contention is counted and shown, not hidden and not solved.
