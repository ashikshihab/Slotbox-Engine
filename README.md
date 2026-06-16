# Slotbox Scheduling Engine Prototype

This repository contains the prototype and scheduling engine flight simulator for **Slotbox**. It simulates one day of content playback on a digital screen, checking and validating promises and capacity constraints dynamically.

## Quick Start

You can run the interactive dashboard locally in your browser.

### 1. Install dependencies
```bash
npm install
```

### 2. Run the development server
```bash
npm run dev
```

This will launch a local development server (typically at `http://localhost:5173`). Open the link in your browser to play with the dashboard!

---

## File Structure

- **`index.html`**: Entry point. Structured layout containing configuration settings, scoreboard, promises checklist, zoomable timeline, and metric tables.
- **`styles.css`**: Vanilla CSS file with custom tokens. Features a high-fidelity Obsidian dark theme with glassmorphism, responsive grid design, and dynamic hover glows.
- **`engine.js`**: Core Scheduling Engine. A pure functional JavaScript module responsible for:
  - Performing slot calculations ($P$ and $F$)
  - Validating slot capacity and time capacity ($Y$ slots, screen time limits)
  - Simulating the minute-by-minute day scheduler loop
  - Minifying drift via look-ahead optimization
- **`app.js`**: UI controller. Handles state, listens to input actions, opens dialog forms, handles live validation inside dialogs, and renders the interactive SVG timeline and scoreboard.
- **`package.json`**: NPM project setup, including Vite configuration for local development.

---

## The Core Math

Let:
- $X$ = shop open hours per day
- $SLOT\_SHARE$ = percentage share of airtime one slot buys (default `0.10`)
- $b$ = buyer's ad duration (seconds)

Formulas:
$$\text{secondsPerDay} = X \times 3600$$
$$\text{slotAirtime} = \text{secondsPerDay} \times SLOT\_SHARE$$
$$P = \lfloor \text{slotAirtime} / b \rfloor$$
$$F = \frac{\text{secondsPerDay}}{P}$$

Where:
- $P$ is the number of plays promised per day to the buyer.
- $F$ is the ideal interval (in seconds) between their plays.

---

## The Simulation Rules

The scheduling timeline is simulated from $t = 0 \to \text{secondsPerDay}$ under the following rules:

1. **Venue Ads Never Cut**: Once a venue ad starts playing, it is never cut short. Venue ads loop in rotation during empty gaps.
2. **Paid Ads drop in at Clean Breaks**: A paid ad only starts at the moment a venue ad finishes.
3. **Timer-based Play**: Buyer $j$ is eligible to play when $t - \text{lastPlay}[j] \ge F[j]$ and they have plays remaining ($\text{playsSoFar}[j] < P[j]$).
4. **Contention Handling (Open Question)**: When two or more buyers are due at the same break, the scheduler resolving order picks the one with the largest drift (most overdue). The others wait for the next break, resulting in back-to-back paid plays and drift. This is measured and reported on the scoreboard.
5. **Drift Optimization (Toggleable)**: When turned on, the scheduler peeks at the next buyer's due time and picks the next venue ad in rotation that fits in the remaining window, preventing unnecessary drift from playing long venue ads right before paid slots become due.
