/**
 * Slotbox Scheduling Engine (v2)
 * Pure functional engine for calculating slots, capacity checks, and daily schedules
 * using a single shared paid rotation pacing model.
 */

/**
 * Calculates slot metrics (P and F) for a single buyer based on open hours and slot share.
 * @param {number} duration - Ad duration in seconds
 * @param {number} X - Open hours per day
 * @param {number} SLOT_SHARE - Fraction of airtime one slot buys (e.g. 0.10)
 * @returns {{P: number, F: number}}
 */
export function calculateSlotMetrics(duration, X, SLOT_SHARE) {
  const secondsPerDay = X * 3600;
  const slotAirtime = secondsPerDay * SLOT_SHARE;
  const P = Math.floor(slotAirtime / duration);
  const F = P > 0 ? secondsPerDay / P : Infinity;
  return { P, F };
}

/**
 * Validates whether a new buyer can be added.
 * @param {{duration: number}} newBuyer - The buyer being checked
 * @param {Array<{duration: number}>} currentBuyers - List of already accepted buyers
 * @param {number} X - Open hours per day
 * @param {number} Y - Number of paid slots offered
 * @param {number} SLOT_SHARE - Fraction of airtime one slot buys
 * @returns {{allowed: boolean, reason: string | null, P?: number, F?: number}}
 */
export function checkBuyerCapacity(newBuyer, currentBuyers, X, Y, SLOT_SHARE) {
  const secondsPerDay = X * 3600;

  // 1. Check if slots are available
  if (currentBuyers.length >= Y) {
    return {
      allowed: false,
      reason: `All slots taken (Maximum allowed: ${Y})`
    };
  }

  const { P, F } = calculateSlotMetrics(newBuyer.duration, X, SLOT_SHARE);

  // 2. Check if ad is too long for the slot airtime
  if (P <= 0) {
    return {
      allowed: false,
      reason: `Ad length of ${newBuyer.duration}s is too long for the slot airtime (${Math.floor(secondsPerDay * SLOT_SHARE)}s)`
    };
  }

  // 3. Check if screen capacity is exceeded
  const newBuyerSeconds = P * newBuyer.duration;
  let secondsAlreadyBooked = 0;

  for (const buyer of currentBuyers) {
    const metrics = calculateSlotMetrics(buyer.duration, X, SLOT_SHARE);
    secondsAlreadyBooked += (metrics.P * buyer.duration);
  }

  if (secondsAlreadyBooked + newBuyerSeconds > secondsPerDay) {
    const remainingTime = secondsPerDay - secondsAlreadyBooked;
    return {
      allowed: false,
      reason: `Screen is full (Needs ${newBuyerSeconds}s of airtime, but only ${remainingTime}s remains)`
    };
  }

  return {
    allowed: true,
    reason: null,
    P,
    F
  };
}

/**
 * Runs the minute-by-minute scheduling simulation for a single day using shared rotation.
 * @param {Object} params
 * @param {number} params.X - Open hours per day
 * @param {number} params.SLOT_SHARE - Fraction of airtime one slot buys
 * @param {Array<{id: string, name: string, duration: number}>} params.venueAds - List of venue promos
 * @param {Array<{id: string, name: string, duration: number}>} params.buyers - List of paid buyers
 * @returns {Object} Simulation results, metrics, and checklist ticks
 */
export function runSimulation({ X, SLOT_SHARE, venueAds, buyers }) {
  const secondsPerDay = X * 3600;

  // Initialize buyer states
  const buyerStates = buyers.map((buyer, index) => {
    const { P, F } = calculateSlotMetrics(buyer.duration, X, SLOT_SHARE);
    return {
      id: buyer.id || `buyer_${index}`,
      name: buyer.name,
      duration: buyer.duration,
      P,
      F,
      playsSoFar: 0,
      playTimes: []
    };
  });

  // Initialize venue states
  const venueStates = venueAds.map((ad, index) => ({
    id: ad.id || `venue_${index}`,
    name: ad.name || `Venue Ad ${index + 1}`,
    duration: ad.duration,
    playCount: 0
  }));

  // Safe fallback if there are no venue ads
  if (venueStates.length === 0) {
    venueStates.push({
      id: 'idle_fallback',
      name: 'Idle Standby',
      duration: 10,
      playCount: 0
    });
  }

  // Calculate sum of promised P
  const totalP = buyerStates.reduce((sum, b) => sum + b.P, 0);
  const pacingStep = totalP > 0 ? secondsPerDay / totalP : Infinity;

  let t = 0;
  let paidDone = 0;
  let nextPaidIdeal = pacingStep; // Pacing clock anchor
  let venueLoopIndex = 0;
  const events = [];

  // The V2 scheduling loop
  while (t < secondsPerDay) {
    const paidDue = (totalP > 0) && (paidDone < totalP) && (t >= nextPaidIdeal);

    if (paidDue) {
      // Find eligible buyers
      const eligible = buyerStates.filter(b => b.playsSoFar < b.P);

      if (eligible.length > 0) {
        // Pick the buyer most behind their fair pace: largest ( P[j] * (t / secondsPerDay) - playsSoFar[j] )
        eligible.sort((a, b) => {
          const paceA = a.P * (t / secondsPerDay) - a.playsSoFar;
          const paceB = b.P * (t / secondsPerDay) - b.playsSoFar;
          return paceB - paceA; // Descending (largest gap first)
        });

        const selectedBuyer = eligible[0];

        // Boundary guard: only play if it finishes before close
        if (t + selectedBuyer.duration <= secondsPerDay) {
          events.push({
            start: t,
            end: t + selectedBuyer.duration,
            adId: selectedBuyer.id,
            name: selectedBuyer.name,
            type: 'paid'
          });

          selectedBuyer.playTimes.push(t);
          selectedBuyer.playsSoFar++;
          paidDone++;
          t += selectedBuyer.duration;
        }
      }
      nextPaidIdeal += pacingStep; // Advance pace clock regardless of play or boundary check
    } else {
      // Gaps: play next venue ad in round-robin loop
      const adToPlay = venueStates[venueLoopIndex];

      // Boundary guard: if a venue ad would overshoot closing, stop the day cleanly
      if (t + adToPlay.duration > secondsPerDay) {
        break;
      }

      events.push({
        start: t,
        end: t + adToPlay.duration,
        adId: adToPlay.id,
        name: adToPlay.name,
        type: 'venue'
      });

      adToPlay.playCount++;
      venueLoopIndex = (venueLoopIndex + 1) % venueStates.length;
      t += adToPlay.duration;
    }
  }

  // Calculate metrics
  const totalSimulatedDuration = t;
  const idleAirtime = secondsPerDay - totalSimulatedDuration; // Leftover gap at end of day

  let paidAirtime = 0;
  let venueAirtime = 0;

  for (const e of events) {
    if (e.type === 'paid') {
      paidAirtime += (e.end - e.start);
    } else {
      venueAirtime += (e.end - e.start);
    }
  }

  // Longest stretch without any paid ads
  let maxStretchNoPaid = 0;
  let lastPaidEnd = 0;
  for (const e of events) {
    if (e.type === 'paid') {
      const stretch = e.start - lastPaidEnd;
      if (stretch > maxStretchNoPaid) {
        maxStretchNoPaid = stretch;
      }
      lastPaidEnd = e.end;
    }
  }
  // Check from last paid end to the end of the simulation
  const finalStretch = totalSimulatedDuration - lastPaidEnd;
  if (finalStretch > maxStretchNoPaid) {
    maxStretchNoPaid = finalStretch;
  }

  // Map individual buyer metrics (average gap, longest gap)
  const buyerMetrics = buyerStates.map(b => {
    const N = b.playTimes.length;
    const gaps = [];

    if (N > 0) {
      gaps.push(b.playTimes[0]); // First play gap
      for (let i = 1; i < N; i++) {
        gaps.push(b.playTimes[i] - b.playTimes[i - 1]);
      }
      gaps.push(totalSimulatedDuration - b.playTimes[N - 1]); // Final play gap to end of day
    }

    const longestGap = gaps.length > 0 ? Math.max(...gaps) : secondsPerDay;
    const averageGap = N > 0 ? totalSimulatedDuration / N : secondsPerDay;

    return {
      id: b.id,
      name: b.name,
      duration: b.duration,
      promisedP: b.P,
      actualP: N,
      idealF: b.F,
      averageGap,
      longestGap
    };
  });

  // Checklist verification rules
  const promises = {
    venueAdsNeverCut: true,
    noPaidAdsOverlap: true,
    noPaidAdPastClosing: true,
    playsAtOrJustBelowP: true,
    playsSpreadNotClustered: true
  };

  // 1. Venue ads never cut: check if played duration matches configuration duration
  for (const e of events) {
    if (e.type === 'venue') {
      const configAd = venueStates.find(v => v.id === e.adId);
      if (configAd && (e.end - e.start) !== configAd.duration) {
        promises.venueAdsNeverCut = false;
        break;
      }
    }
  }

  // 2. Overlap checks
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].end > events[i+1].start) {
      promises.noPaidAdsOverlap = false;
      break;
    }
  }

  // 3. No paid ad past closing time
  for (const e of events) {
    if (e.type === 'paid' && e.end > secondsPerDay) {
      promises.noPaidAdPastClosing = false;
      break;
    }
  }

  // 4. Plays at or just below promised P (e.g. difference is at most 2 plays)
  promises.playsAtOrJustBelowP = buyerMetrics.every(bm => (bm.promisedP - bm.actualP) <= 2);

  // 5. Plays spread across day, not clustered (e.g. longest gap <= 3.0 * idealF)
  promises.playsSpreadNotClustered = buyerMetrics.every(bm => {
    if (bm.promisedP <= 1) return true;
    return bm.longestGap <= 3.0 * bm.idealF;
  });

  return {
    events,
    totalSimulatedDuration,
    paidAirtime,
    venueAirtime,
    idleAirtime,
    maxStretchNoPaid,
    buyerMetrics,
    venueMetrics: venueStates.map(v => ({
      id: v.id,
      name: v.name,
      duration: v.duration,
      playCount: v.playCount
    })),
    promises
  };
}
