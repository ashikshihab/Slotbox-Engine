# Audit & Test Report: Slotbox Scheduling Engine Limitations

This report presents a detailed analysis of where the **Slotbox scheduling engine** fails its core promises. Using simulated runs of an 8-hour day ($X=8$) with a 10% slot share ($SLOT\_SHARE=0.10$), we trace the root causes of under-delivery and drift.

---

## Executive Summary

The scheduling engine's core promises break down under load. Our tests reveal that:
1. **Under-delivery is inevitable**, even in a single-buyer scenario, due to mathematical boundary conditions.
2. **Drift exceeds venue ad durations** as soon as multiple buyers are active, caused by contention cascades.
3. **Drift Optimization is a double-edged sword**: while it trims maximum drift for some buyers, it actually increases total contentions and worsens under-delivery for others.

> [!CAUTION]
> The engine promises buyers that their slots buy a fixed share of the day, implying they will receive exactly $P$ plays. In practice, under full slot saturation, buyers can experience **up to 18.7% under-delivery** of their plays.

---

## Comparison Table of Test Scenarios

The following table summarizes the engine's performance across four test configurations ($X=8$, $SLOT\_SHARE=0.10$, Venue Ads: `30s`, `60s`):

| Metric | Scenario A: 1 Buyer (Low) | Scenario B: 3 Buyers (Med) | Scenario C: 5 Buyers (High) | Scenario D: 5 Buyers (High + Opt) |
| :--- | :---: | :---: | :---: | :---: |
| **Total Buyers** | 1 | 3 | 5 | 5 |
| **Simulated Duration** | 28,800s | 28,850s | 28,820s | 28,800s |
| **Contention Events** | 0 | 46 | 169 | 201 |
| **Back-to-Back Paid Runs** | 0 | 46 | 268 | 255 |
| **Max Gap Without Paid Ad** | 300s | 210s | 180s | 180s |
| **Max Single-Buyer Drift** | 0s | 70s | 150s | 135s |
| **Total Under-Delivered Plays**| 1 | 16 | 110 | 114 |
| **Max Play Under-Delivery %** | 1.0% | 5.5% | 18.7% (B5) | 18.7% (B5) |

---

## Breakdown of Key Failure Modes

### 1. The Boundary Condition Error (Why 1 Buyer Misses a Play)

Even in **Scenario A** (a single buyer, 30s ad, no other paid ads, zero contention, zero drift), the buyer receives **95 plays** instead of the promised **96 plays**.

- **Reason:** The ideal play interval is $F = 28800 / 96 = 300$ seconds. Since `lastPlay` starts at 0, the 96th play is due at exactly $t = 28,800$ seconds.
- **The Bug:** The simulation loop terminates at `while t < secondsPerDay`. Since $t$ reaches exactly 28,800s, the loop finishes *before* the 96th play is processed.
- **Mitigation:** The loop condition should be `while t <= secondsPerDay` to allow boundary plays to initiate, or the day length must be treated with a tiny boundary tolerance.

---

### 2. The Contention Cascade (Why Max Drift > Longest Venue Ad)

The build spec assumes that since paid ads fire at the first break after they are due, they will drift by at most one venue ad length (e.g., $\le 60\text{s}$). However, in **Scenario C**, B3 experiences a max drift of **150 seconds** (2.5 times the longest venue ad).

- **Reason:** When multiple buyers become due at or near the same time (contention), only one can play. The others are pushed back. Because paid ads can only play back-to-back at clean breaks, the runners-up are delayed by the sum of the durations of the paid ads ahead of them.
- **Result:** This accumulates drift rapidly. The delay is no longer bounded by a single venue ad, but by the combined duration of all competing paid slots.

---

### 3. Drift Optimization's Side-Effects

Drift Optimization peeks ahead to select shorter venue ads that fit the window before a buyer becomes due. The data reveals a surprising paradox:

> [!WARNING]
> Enabling Drift Optimization in Scenario D **increased total contentions from 169 to 201** and did not improve overall play delivery (114 missed plays vs 110).

- **Why Contentions Increased:** By picking shorter venue ads to align breaks with due times, the scheduler successfully forces breaks to occur exactly when buyers become due. However, because multiple buyers have similar due frequencies, this alignment forces them to become due at the **exact same break**, triggering a massive contention surge.
- **Why Drift Decreased but Delivery Worsened:** While it trimmed the absolute worst-case drift (B3 drift went from 150s to 135s), the packing of breaks increased back-to-back paid queues, making it harder for other buyers (like B1) to get their turns, worsening their under-delivery (B1 missed 12 plays instead of 9).

---

## Verdict & Architectural Recommendations

To make the engine's promises hold in production, the following adjustments are recommended:

* **Adjust Loop Boundary:** Change the loop boundary to `t < secondsPerDay + tolerance` so that final boundary plays aren't lost at the closing second.
* **Slot Share Buffering:** The engine sells airtime but promises play counts. To guarantee $P$, the shop owner should limit $Y$ to $80\%$ of the theoretical capacity to provide a "safety buffer" of empty gaps that absorb drift.
* **Dynamic Timer Correction:** Instead of resetting `lastPlay[j] = t` (actual start time), reset it to `idealDueTime`. This prevents drift from compounding across the day, though it may result in clusters of back-to-back plays.

---

## Scenario A Raw Event Log (All 672 events)

```text
0, 30, v1, venue
30, 90, v2, venue
90, 120, v1, venue
120, 180, v2, venue
180, 210, v1, venue
210, 270, v2, venue
270, 300, v1, venue
300, 330, b1, paid
330, 390, v2, venue
390, 420, v1, venue
420, 480, v2, venue
480, 510, v1, venue
510, 570, v2, venue
570, 600, v1, venue
600, 630, b1, paid
630, 690, v2, venue
690, 720, v1, venue
720, 780, v2, venue
780, 810, v1, venue
810, 870, v2, venue
870, 900, v1, venue
900, 930, b1, paid
930, 990, v2, venue
990, 1020, v1, venue
1020, 1080, v2, venue
1080, 1110, v1, venue
1110, 1170, v2, venue
1170, 1200, v1, venue
1200, 1230, b1, paid
1230, 1290, v2, venue
1290, 1320, v1, venue
1320, 1380, v2, venue
1380, 1410, v1, venue
1410, 1470, v2, venue
1470, 1500, v1, venue
1500, 1530, b1, paid
1530, 1590, v2, venue
1590, 1620, v1, venue
1620, 1680, v2, venue
1680, 1710, v1, venue
1710, 1770, v2, venue
1770, 1800, v1, venue
1800, 1830, b1, paid
1830, 1890, v2, venue
1890, 1920, v1, venue
1920, 1980, v2, venue
1980, 2010, v1, venue
2010, 2070, v2, venue
2070, 2100, v1, venue
2100, 2130, b1, paid
2130, 2190, v2, venue
2190, 2220, v1, venue
2220, 2280, v2, venue
2280, 2310, v1, venue
2310, 2370, v2, venue
2370, 2400, v1, venue
2400, 2430, b1, paid
2430, 2490, v2, venue
2490, 2520, v1, venue
2520, 2580, v2, venue
2580, 2610, v1, venue
2610, 2670, v2, venue
2670, 2700, v1, venue
2700, 2730, b1, paid
2730, 2790, v2, venue
2790, 2820, v1, venue
2820, 2880, v2, venue
2880, 2910, v1, venue
2910, 2970, v2, venue
2970, 3000, v1, venue
3000, 3030, b1, paid
3030, 3090, v2, venue
3090, 3120, v1, venue
3120, 3180, v2, venue
3180, 3210, v1, venue
3210, 3270, v2, venue
3270, 3300, v1, venue
3300, 3330, b1, paid
3330, 3390, v2, venue
3390, 3420, v1, venue
3420, 3480, v2, venue
3480, 3510, v1, venue
3510, 3570, v2, venue
3570, 3600, v1, venue
3600, 3630, b1, paid
3630, 3690, v2, venue
3690, 3720, v1, venue
3720, 3780, v2, venue
3780, 3810, v1, venue
3810, 3870, v2, venue
3870, 3900, v1, venue
3900, 3930, b1, paid
3930, 3990, v2, venue
3990, 4020, v1, venue
4020, 4080, v2, venue
4080, 4110, v1, venue
4110, 4170, v2, venue
4170, 4200, v1, venue
4200, 4230, b1, paid
4230, 4290, v2, venue
4290, 4320, v1, venue
4320, 4380, v2, venue
4380, 4410, v1, venue
4410, 4470, v2, venue
4470, 4500, v1, venue
4500, 4530, b1, paid
4530, 4590, v2, venue
4590, 4620, v1, venue
4620, 4680, v2, venue
4680, 4710, v1, venue
4710, 4770, v2, venue
4770, 4800, v1, venue
4800, 4830, b1, paid
4830, 4890, v2, venue
4890, 4920, v1, venue
4920, 4980, v2, venue
4980, 5010, v1, venue
5010, 5070, v2, venue
5070, 5100, v1, venue
5100, 5130, b1, paid
5130, 5190, v2, venue
5190, 5220, v1, venue
5220, 5280, v2, venue
5280, 5310, v1, venue
5310, 5370, v2, venue
5370, 5400, v1, venue
5400, 5430, b1, paid
5430, 5490, v2, venue
5490, 5520, v1, venue
5520, 5580, v2, venue
5580, 5610, v1, venue
5610, 5670, v2, venue
5670, 5700, v1, venue
5700, 5730, b1, paid
5730, 5790, v2, venue
5790, 5820, v1, venue
5820, 5880, v2, venue
5880, 5910, v1, venue
5910, 5970, v2, venue
5970, 6000, v1, venue
6000, 6030, b1, paid
6030, 6090, v2, venue
6090, 6120, v1, venue
6120, 6180, v2, venue
6180, 6210, v1, venue
6210, 6270, v2, venue
6270, 6300, v1, venue
6300, 6330, b1, paid
6330, 6390, v2, venue
6390, 6420, v1, venue
6420, 6480, v2, venue
6480, 6510, v1, venue
6510, 6570, v2, venue
6570, 6600, v1, venue
6600, 6630, b1, paid
6630, 6690, v2, venue
6690, 6720, v1, venue
6720, 6780, v2, venue
6780, 6810, v1, venue
6810, 6870, v2, venue
6870, 6900, v1, venue
6900, 6930, b1, paid
6930, 6990, v2, venue
6990, 7020, v1, venue
7020, 7080, v2, venue
7080, 7110, v1, venue
7110, 7170, v2, venue
7170, 7200, v1, venue
7200, 7230, b1, paid
7230, 7290, v2, venue
7290, 7320, v1, venue
7320, 7380, v2, venue
7380, 7410, v1, venue
7410, 7470, v2, venue
7470, 7500, v1, venue
7500, 7530, b1, paid
7530, 7590, v2, venue
7590, 7620, v1, venue
7620, 7680, v2, venue
7680, 7710, v1, venue
7710, 7770, v2, venue
7770, 7800, v1, venue
7800, 7830, b1, paid
7830, 7890, v2, venue
7890, 7920, v1, venue
7920, 7980, v2, venue
7980, 8010, v1, venue
8010, 8070, v2, venue
8070, 8100, v1, venue
8100, 8130, b1, paid
8130, 8190, v2, venue
8190, 8220, v1, venue
8220, 8280, v2, venue
8280, 8310, v1, venue
8310, 8370, v2, venue
8370, 8400, v1, venue
8400, 8430, b1, paid
8430, 8490, v2, venue
8490, 8520, v1, venue
8520, 8580, v2, venue
8580, 8610, v1, venue
8610, 8670, v2, venue
8670, 8700, v1, venue
8700, 8730, b1, paid
8730, 8790, v2, venue
8790, 8820, v1, venue
8820, 8880, v2, venue
8880, 8910, v1, venue
8910, 8970, v2, venue
8970, 9000, v1, venue
9000, 9030, b1, paid
9030, 9090, v2, venue
9090, 9120, v1, venue
9120, 9180, v2, venue
9180, 9210, v1, venue
9210, 9270, v2, venue
9270, 9300, v1, venue
9300, 9330, b1, paid
9330, 9390, v2, venue
9390, 9420, v1, venue
9420, 9480, v2, venue
9480, 9510, v1, venue
9510, 9570, v2, venue
9570, 9600, v1, venue
9600, 9630, b1, paid
9630, 9690, v2, venue
9690, 9720, v1, venue
9720, 9780, v2, venue
9780, 9810, v1, venue
9810, 9870, v2, venue
9870, 9900, v1, venue
9900, 9930, b1, paid
9930, 9990, v2, venue
9990, 10020, v1, venue
10020, 10080, v2, venue
10080, 10110, v1, venue
10110, 10170, v2, venue
10170, 10200, v1, venue
10200, 10230, b1, paid
10230, 10290, v2, venue
10290, 10320, v1, venue
10320, 10380, v2, venue
10380, 10410, v1, venue
10410, 10470, v2, venue
10470, 10500, v1, venue
10500, 10530, b1, paid
10530, 10590, v2, venue
10590, 10620, v1, venue
10620, 10680, v2, venue
10680, 10710, v1, venue
10710, 10770, v2, venue
10770, 10800, v1, venue
10800, 10830, b1, paid
10830, 10890, v2, venue
10890, 10920, v1, venue
10920, 10980, v2, venue
10980, 11010, v1, venue
11010, 11070, v2, venue
11070, 11100, v1, venue
11100, 11130, b1, paid
11130, 11190, v2, venue
11190, 11220, v1, venue
11220, 11280, v2, venue
11280, 11310, v1, venue
11310, 11370, v2, venue
11370, 11400, v1, venue
11400, 11430, b1, paid
11430, 11490, v2, venue
11490, 11520, v1, venue
11520, 11580, v2, venue
11580, 11610, v1, venue
11610, 11670, v2, venue
11670, 11700, v1, venue
11700, 11730, b1, paid
11730, 11790, v2, venue
11790, 11820, v1, venue
11820, 11880, v2, venue
11880, 11910, v1, venue
11910, 11970, v2, venue
11970, 12000, v1, venue
12000, 12030, b1, paid
12030, 12090, v2, venue
12090, 12120, v1, venue
12120, 12180, v2, venue
12180, 12210, v1, venue
12210, 12270, v2, venue
12270, 12300, v1, venue
12300, 12330, b1, paid
12330, 12390, v2, venue
12390, 12420, v1, venue
12420, 12480, v2, venue
12480, 12510, v1, venue
12510, 12570, v2, venue
12570, 12600, v1, venue
12600, 12630, b1, paid
12630, 12690, v2, venue
12690, 12720, v1, venue
12720, 12780, v2, venue
12780, 12810, v1, venue
12810, 12870, v2, venue
12870, 12900, v1, venue
12900, 12930, b1, paid
12930, 12990, v2, venue
12990, 13020, v1, venue
13020, 13080, v2, venue
13080, 13110, v1, venue
13110, 13170, v2, venue
13170, 13200, v1, venue
13200, 13230, b1, paid
13230, 13290, v2, venue
13290, 13320, v1, venue
13320, 13380, v2, venue
13380, 13410, v1, venue
13410, 13470, v2, venue
13470, 13500, v1, venue
13500, 13530, b1, paid
13530, 13590, v2, venue
13590, 13620, v1, venue
13620, 13680, v2, venue
13680, 13710, v1, venue
13710, 13770, v2, venue
13770, 13800, v1, venue
13800, 13830, b1, paid
13830, 13890, v2, venue
13890, 13920, v1, venue
13920, 13980, v2, venue
13980, 14010, v1, venue
14010, 14070, v2, venue
14070, 14100, v1, venue
14100, 14130, b1, paid
14130, 14190, v2, venue
14190, 14220, v1, venue
14220, 14280, v2, venue
14280, 14310, v1, venue
14310, 14370, v2, venue
14370, 14400, v1, venue
14400, 14430, b1, paid
14430, 14490, v2, venue
14490, 14520, v1, venue
14520, 14580, v2, venue
14580, 14610, v1, venue
14610, 14670, v2, venue
14670, 14700, v1, venue
14700, 14730, b1, paid
14730, 14790, v2, venue
14790, 14820, v1, venue
14820, 14880, v2, venue
14880, 14910, v1, venue
14910, 14970, v2, venue
14970, 15000, v1, venue
15000, 15030, b1, paid
15030, 15090, v2, venue
15090, 15120, v1, venue
15120, 15180, v2, venue
15180, 15210, v1, venue
15210, 15270, v2, venue
15270, 15300, v1, venue
15300, 15330, b1, paid
15330, 15390, v2, venue
15390, 15420, v1, venue
15420, 15480, v2, venue
15480, 15510, v1, venue
15510, 15570, v2, venue
15570, 15600, v1, venue
15600, 15630, b1, paid
15630, 15690, v2, venue
15690, 15720, v1, venue
15720, 15780, v2, venue
15780, 15810, v1, venue
15810, 15870, v2, venue
15870, 15900, v1, venue
15900, 15930, b1, paid
15930, 15990, v2, venue
15990, 16020, v1, venue
16020, 16080, v2, venue
16080, 16110, v1, venue
16110, 16170, v2, venue
16170, 16200, v1, venue
16200, 16230, b1, paid
16230, 16290, v2, venue
16290, 16320, v1, venue
16320, 16380, v2, venue
16380, 16410, v1, venue
16410, 16470, v2, venue
16470, 16500, v1, venue
16500, 16530, b1, paid
16530, 16590, v2, venue
16590, 16620, v1, venue
16620, 16680, v2, venue
16680, 16710, v1, venue
16710, 16770, v2, venue
16770, 16800, v1, venue
16800, 16830, b1, paid
16830, 16890, v2, venue
16890, 16920, v1, venue
16920, 16980, v2, venue
16980, 17010, v1, venue
17010, 17070, v2, venue
17070, 17100, v1, venue
17100, 17130, b1, paid
17130, 17190, v2, venue
17190, 17220, v1, venue
17220, 17280, v2, venue
17280, 17310, v1, venue
17310, 17370, v2, venue
17370, 17400, v1, venue
17400, 17430, b1, paid
17430, 17490, v2, venue
17490, 17520, v1, venue
17520, 17580, v2, venue
17580, 17610, v1, venue
17610, 17670, v2, venue
17670, 17700, v1, venue
17700, 17730, b1, paid
17730, 17790, v2, venue
17790, 17820, v1, venue
17820, 17880, v2, venue
17880, 17910, v1, venue
17910, 17970, v2, venue
17970, 18000, v1, venue
18000, 18030, b1, paid
18030, 18090, v2, venue
18090, 18120, v1, venue
18120, 18180, v2, venue
18180, 18210, v1, venue
18210, 18270, v2, venue
18270, 18300, v1, venue
18300, 18330, b1, paid
18330, 18390, v2, venue
18390, 18420, v1, venue
18420, 18480, v2, venue
18480, 18510, v1, venue
18510, 18570, v2, venue
18570, 18600, v1, venue
18600, 18630, b1, paid
18630, 18690, v2, venue
18690, 18720, v1, venue
18720, 18780, v2, venue
18780, 18810, v1, venue
18810, 18870, v2, venue
18870, 18900, v1, venue
18900, 18930, b1, paid
18930, 18990, v2, venue
18990, 19020, v1, venue
19020, 19080, v2, venue
19080, 19110, v1, venue
19110, 19170, v2, venue
19170, 19200, v1, venue
19200, 19230, b1, paid
19230, 19290, v2, venue
19290, 19320, v1, venue
19320, 19380, v2, venue
19380, 19410, v1, venue
19410, 19470, v2, venue
19470, 19500, v1, venue
19500, 19530, b1, paid
19530, 19590, v2, venue
19590, 19620, v1, venue
19620, 19680, v2, venue
19680, 19710, v1, venue
19710, 19770, v2, venue
19770, 19800, v1, venue
19800, 19830, b1, paid
19830, 19890, v2, venue
19890, 19920, v1, venue
19920, 19980, v2, venue
19980, 20010, v1, venue
20010, 20070, v2, venue
20070, 20100, v1, venue
20100, 20130, b1, paid
20130, 20190, v2, venue
20190, 20220, v1, venue
20220, 20280, v2, venue
20280, 20310, v1, venue
20310, 20370, v2, venue
20370, 20400, v1, venue
20400, 20430, b1, paid
20430, 20490, v2, venue
20490, 20520, v1, venue
20520, 20580, v2, venue
20580, 20610, v1, venue
20610, 20670, v2, venue
20670, 20700, v1, venue
20700, 20730, b1, paid
20730, 20790, v2, venue
20790, 20820, v1, venue
20820, 20880, v2, venue
20880, 20910, v1, venue
20910, 20970, v2, venue
20970, 21000, v1, venue
21000, 21030, b1, paid
21030, 21090, v2, venue
21090, 21120, v1, venue
21120, 21180, v2, venue
21180, 21210, v1, venue
21210, 21270, v2, venue
21270, 21300, v1, venue
21300, 21330, b1, paid
21330, 21390, v2, venue
21390, 21420, v1, venue
21420, 21480, v2, venue
21480, 21510, v1, venue
21510, 21570, v2, venue
21570, 21600, v1, venue
21600, 21630, b1, paid
21630, 21690, v2, venue
21690, 21720, v1, venue
21720, 21780, v2, venue
21780, 21810, v1, venue
21810, 21870, v2, venue
21870, 21900, v1, venue
21900, 21930, b1, paid
21930, 21990, v2, venue
21990, 22020, v1, venue
22020, 22080, v2, venue
22080, 22110, v1, venue
22110, 22170, v2, venue
22170, 22200, v1, venue
22200, 22230, b1, paid
22230, 22290, v2, venue
22290, 22320, v1, venue
22320, 22380, v2, venue
22380, 22410, v1, venue
22410, 22470, v2, venue
22470, 22500, v1, venue
22500, 22530, b1, paid
22530, 22590, v2, venue
22590, 22620, v1, venue
22620, 22680, v2, venue
22680, 22710, v1, venue
22710, 22770, v2, venue
22770, 22800, v1, venue
22800, 22830, b1, paid
22830, 22890, v2, venue
22890, 22920, v1, venue
22920, 22980, v2, venue
22980, 23010, v1, venue
23010, 23070, v2, venue
23070, 23100, v1, venue
23100, 23130, b1, paid
23130, 23190, v2, venue
23190, 23220, v1, venue
23220, 23280, v2, venue
23280, 23310, v1, venue
23310, 23370, v2, venue
23370, 23400, v1, venue
23400, 23430, b1, paid
23430, 23490, v2, venue
23490, 23520, v1, venue
23520, 23580, v2, venue
23580, 23610, v1, venue
23610, 23670, v2, venue
23670, 23700, v1, venue
23700, 23730, b1, paid
23730, 23790, v2, venue
23790, 23820, v1, venue
23820, 23880, v2, venue
23880, 23910, v1, venue
23910, 23970, v2, venue
23970, 24000, v1, venue
24000, 24030, b1, paid
24030, 24090, v2, venue
24090, 24120, v1, venue
24120, 24180, v2, venue
24180, 24210, v1, venue
24210, 24270, v2, venue
24270, 24300, v1, venue
24300, 24330, b1, paid
24330, 24390, v2, venue
24390, 24420, v1, venue
24420, 24480, v2, venue
24480, 24510, v1, venue
24510, 24570, v2, venue
24570, 24600, v1, venue
24600, 24630, b1, paid
24630, 24690, v2, venue
24690, 24720, v1, venue
24720, 24780, v2, venue
24780, 24810, v1, venue
24810, 24870, v2, venue
24870, 24900, v1, venue
24900, 24930, b1, paid
24930, 24990, v2, venue
24990, 25020, v1, venue
25020, 25080, v2, venue
25080, 25110, v1, venue
25110, 25170, v2, venue
25170, 25200, v1, venue
25200, 25230, b1, paid
25230, 25290, v2, venue
25290, 25320, v1, venue
25320, 25380, v2, venue
25380, 25410, v1, venue
25410, 25470, v2, venue
25470, 25500, v1, venue
25500, 25530, b1, paid
25530, 25590, v2, venue
25590, 25620, v1, venue
25620, 25680, v2, venue
25680, 25710, v1, venue
25710, 25770, v2, venue
25770, 25800, v1, venue
25800, 25830, b1, paid
25830, 25890, v2, venue
25890, 25920, v1, venue
25920, 25980, v2, venue
25980, 26010, v1, venue
26010, 26070, v2, venue
26070, 26100, v1, venue
26100, 26130, b1, paid
26130, 26190, v2, venue
26190, 26220, v1, venue
26220, 26280, v2, venue
26280, 26310, v1, venue
26310, 26370, v2, venue
26370, 26400, v1, venue
26400, 26430, b1, paid
26430, 26490, v2, venue
26490, 26520, v1, venue
26520, 26580, v2, venue
26580, 26610, v1, venue
26610, 26670, v2, venue
26670, 26700, v1, venue
26700, 26730, b1, paid
26730, 26790, v2, venue
26790, 26820, v1, venue
26820, 26880, v2, venue
26880, 26910, v1, venue
26910, 26970, v2, venue
26970, 27000, v1, venue
27000, 27030, b1, paid
27030, 27090, v2, venue
27090, 27120, v1, venue
27120, 27180, v2, venue
27180, 27210, v1, venue
27210, 27270, v2, venue
27270, 27300, v1, venue
27300, 27330, b1, paid
27330, 27390, v2, venue
27390, 27420, v1, venue
27420, 27480, v2, venue
27480, 27510, v1, venue
27510, 27570, v2, venue
27570, 27600, v1, venue
27600, 27630, b1, paid
27630, 27690, v2, venue
27690, 27720, v1, venue
27720, 27780, v2, venue
27780, 27810, v1, venue
27810, 27870, v2, venue
27870, 27900, v1, venue
27900, 27930, b1, paid
27930, 27990, v2, venue
27990, 28020, v1, venue
28020, 28080, v2, venue
28080, 28110, v1, venue
28110, 28170, v2, venue
28170, 28200, v1, venue
28200, 28230, b1, paid
28230, 28290, v2, venue
28290, 28320, v1, venue
28320, 28380, v2, venue
28380, 28410, v1, venue
28410, 28470, v2, venue
28470, 28500, v1, venue
28500, 28530, b1, paid
28530, 28590, v2, venue
28590, 28620, v1, venue
28620, 28680, v2, venue
28680, 28710, v1, venue
28710, 28770, v2, venue
28770, 28800, v1, venue
```

---

## Scenario A Paid Events Only (All 95 plays)

```text
300, 330, b1, paid
600, 630, b1, paid
900, 930, b1, paid
1200, 1230, b1, paid
1500, 1530, b1, paid
1800, 1830, b1, paid
2100, 2130, b1, paid
2400, 2430, b1, paid
2700, 2730, b1, paid
3000, 3030, b1, paid
3300, 3330, b1, paid
3600, 3630, b1, paid
3900, 3930, b1, paid
4200, 4230, b1, paid
4500, 4530, b1, paid
4800, 4830, b1, paid
5100, 5130, b1, paid
5400, 5430, b1, paid
5700, 5730, b1, paid
6000, 6030, b1, paid
6300, 6330, b1, paid
6600, 6630, b1, paid
6900, 6930, b1, paid
7200, 7230, b1, paid
7500, 7530, b1, paid
7800, 7830, b1, paid
8100, 8130, b1, paid
8400, 8430, b1, paid
8700, 8730, b1, paid
9000, 9030, b1, paid
9300, 9330, b1, paid
9600, 9630, b1, paid
9900, 9930, b1, paid
10200, 10230, b1, paid
10500, 10530, b1, paid
10800, 10830, b1, paid
11100, 11130, b1, paid
11400, 11430, b1, paid
11700, 11730, b1, paid
12000, 12030, b1, paid
12300, 12330, b1, paid
12600, 12630, b1, paid
12900, 12930, b1, paid
13200, 13230, b1, paid
13500, 13530, b1, paid
13800, 13830, b1, paid
14100, 14130, b1, paid
14400, 14430, b1, paid
14700, 14730, b1, paid
15000, 15030, b1, paid
15300, 15330, b1, paid
15600, 15630, b1, paid
15900, 15930, b1, paid
16200, 16230, b1, paid
16500, 16530, b1, paid
16800, 16830, b1, paid
17100, 17130, b1, paid
17400, 17430, b1, paid
17700, 17730, b1, paid
18000, 18030, b1, paid
18300, 18330, b1, paid
18600, 18630, b1, paid
18900, 18930, b1, paid
19200, 19230, b1, paid
19500, 19530, b1, paid
19800, 19830, b1, paid
20100, 20130, b1, paid
20400, 20430, b1, paid
20700, 20730, b1, paid
21000, 21030, b1, paid
21300, 21330, b1, paid
21600, 21630, b1, paid
21900, 21930, b1, paid
22200, 22230, b1, paid
22500, 22530, b1, paid
22800, 22830, b1, paid
23100, 23130, b1, paid
23400, 23430, b1, paid
23700, 23730, b1, paid
24000, 24030, b1, paid
24300, 24330, b1, paid
24600, 24630, b1, paid
24900, 24930, b1, paid
25200, 25230, b1, paid
25500, 25530, b1, paid
25800, 25830, b1, paid
26100, 26130, b1, paid
26400, 26430, b1, paid
26700, 26730, b1, paid
27000, 27030, b1, paid
27300, 27330, b1, paid
27600, 27630, b1, paid
27900, 27930, b1, paid
28200, 28230, b1, paid
28500, 28530, b1, paid
```
