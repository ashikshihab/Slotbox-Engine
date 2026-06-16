import { checkBuyerCapacity, runSimulation, calculateSlotMetrics } from './engine.js';

// --- SYSTEM STATE ---
let X = 8; // Open hours
let Y = 5; // Max paid slots
const SLOT_SHARE = 0.10; // Fraction of airtime per slot (always 10%)

// --- SIMULATOR PLAYBACK STATE ---
let currentTimeSec = 0;
let isPlaying = false;
let playbackRate = 200;
let lastFrameTime = 0;
let animationFrameId = null;
let currentSimulationResults = null;

// Default list of venue ads
let venueAds = [
  { id: 'v_promo_a', name: 'Venue Ad 1', duration: 30 },
  { id: 'v_promo_b', name: 'Venue Ad 2', duration: 60 },
  { id: 'v_promo_c', name: 'Venue Ad 3', duration: 15 }
];

// Default list of buyers
let buyers = [
  { id: 'b_pizza', name: 'Paid Ad 1', duration: 30 },
  { id: 'b_gym', name: 'Paid Ad 2', duration: 60 },
  { id: 'b_salon', name: 'Paid Ad 3', duration: 20 }
];

// Predefined buyer colors for the timeline and UI
const BUYER_COLORS = [
  '#4285f4', // Google Blue
  '#ea4335', // Google Red
  '#f9ab00', // Google Yellow
  '#34a853', // Google Green
  '#ab47bc', // Google Purple
  '#00acc1', // Google Cyan
  '#ff7043', // Google Orange
  '#26a69a', // Google Teal
  '#ec407a', // Google Pink
  '#3f51b5'  // Google Indigo
];

// --- DOM ELEMENTS ---
const inputHours = document.getElementById('input-hours');
const inputSlots = document.getElementById('input-slots');

const venueAdsList = document.getElementById('venue-ads-list');
const buyersList = document.getElementById('buyers-list');
const btnAddVenue = document.getElementById('btn-add-venue');
const btnAddBuyer = document.getElementById('btn-add-buyer');
const capacityWarning = document.getElementById('capacity-warning');
const capacityWarningText = document.getElementById('capacity-warning-text');

// Dialog modals removed - UI now uses inline sliders for direct control

// Scoreboard Elements
const statDuration = document.getElementById('stat-duration');
const statPaidPlays = document.getElementById('stat-paidplays');
const statIdleAirtime = document.getElementById('stat-idle-airtime');
const statMaxGap = document.getElementById('stat-maxgap');
const statSlotFill = document.getElementById('stat-slotfill');
const statAirtimeBooked = document.getElementById('stat-airtimebooked');

const pctPaidLabel = document.getElementById('pct-paid');
const pctVenueLabel = document.getElementById('pct-venue');
const pctIdleLabel = document.getElementById('pct-idle');
const barPaid = document.getElementById('bar-paid');
const barVenue = document.getElementById('bar-venue');
const barIdle = document.getElementById('bar-idle');

// Timeline Elements
const zoomSlider = document.getElementById('zoom-slider');
const zoomValLabel = document.getElementById('zoom-val');
const minimapTrack = document.getElementById('minimap-track');
const minimapViewport = document.getElementById('minimap-viewport');
const minimapContainer = document.getElementById('minimap-container');
const detailedTimelineScroller = document.getElementById('detailed-timeline-scroller');
const timeTicksTrack = document.getElementById('time-ticks');
const timelineTrack = document.getElementById('timeline-track');
const timelineLegend = document.getElementById('timeline-legend');

// Tables
const buyerMetricsTableBody = document.querySelector('#buyer-metrics-table tbody');
const venueMetricsTableBody = document.querySelector('#venue-metrics-table tbody');

// Tab Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// TV Simulator Elements
const tvScreen = document.getElementById('tv-screen');
const tvScreenGlow = document.getElementById('tv-screen-glow');
const tvAdType = document.getElementById('tv-ad-type');
const tvAdName = document.getElementById('tv-ad-name');
const tvAdTimer = document.getElementById('tv-ad-timer');
const tvAdProgressFill = document.getElementById('tv-ad-progress-fill');
const tvPlayBtn = document.getElementById('tv-play-btn');
const tvScrubBar = document.getElementById('tv-scrub-bar');
const tvTimeLabel = document.getElementById('tv-time-label');
const tvSpeedSelect = document.getElementById('tv-speed-select');
const tvZoomSequenceTrack = document.getElementById('tv-zoom-sequence-track');
const tvZoomPlayhead = document.getElementById('tv-zoom-playhead');
const tvDaySequenceTrack = document.getElementById('tv-day-sequence-track');
const tvDayPlayhead = document.getElementById('tv-day-playhead');

// Playheads in Tab 2
const timelinePlayhead = document.getElementById('timeline-playhead');
const minimapPlayhead = document.getElementById('minimap-playhead');

// Create Tooltip Bubble
const tooltip = document.createElement('div');
tooltip.className = 'timeline-tooltip';
document.body.appendChild(tooltip);

// --- INITIALIZATION ---
function init() {
  // Bind inputs
  inputHours.value = X;
  inputSlots.value = Y;

  // Render lists in sidebar
  renderSidebarLists();

  // Run simulation initial load
  triggerRun();

  // Setup Event Listeners
  setupEventListeners();
}

// --- CORE SIMULATION TRIGGER ---
function triggerRun() {
  // 1. Validate the current state
  const validation = validateSystemCapacity();
  if (!validation.valid) {
    capacityWarning.classList.remove('hidden');
    capacityWarningText.textContent = validation.reason;
    return;
  } else {
    capacityWarning.classList.add('hidden');
  }

  // 2. Run Scheduling Engine
  const results = runSimulation({
    X,
    SLOT_SHARE,
    venueAds,
    buyers
  });

  // Store globally for playback
  currentSimulationResults = results;
  
  // Reset playback scrub range
  const secondsPerDay = X * 3600;
  tvScrubBar.max = secondsPerDay;
  if (currentTimeSec > secondsPerDay) {
    currentTimeSec = 0;
  }

  // 3. Render Results
  renderDashboard(results);
  renderMiniSequence(results);
  updateTvUi();
}

// --- STATE VALIDATION ---
function validateSystemCapacity() {
  const secondsPerDay = X * 3600;
  const slotAirtime = secondsPerDay * SLOT_SHARE;

  // Check if buyers count exceeds Y
  if (buyers.length > Y) {
    return {
      valid: false,
      reason: `Configuration exceeds slots! Current buyers: ${buyers.length}, offered slots Y: ${Y}.`
    };
  }

  // Check if total booked airtime exceeds day capacity
  let totalBooked = 0;
  for (const buyer of buyers) {
    const P = Math.floor(slotAirtime / buyer.duration);
    if (P <= 0) {
      return {
        valid: false,
        reason: `Buyer "${buyer.name}" has ad length (${buyer.duration}s) exceeding the slot airtime (${Math.floor(slotAirtime)}s).`
      };
    }
    totalBooked += (P * buyer.duration);
  }

  if (totalBooked > secondsPerDay) {
    return {
      valid: false,
      reason: `Day capacity overflow! Booked airtime (${totalBooked}s) exceeds open hours duration (${secondsPerDay}s).`
    };
  }

  return { valid: true };
}

// --- RENDER FUNCTIONS ---

function renderSidebarLists() {
  const secondsPerDay = X * 3600;
  const slotAirtime = secondsPerDay * SLOT_SHARE;

  // Render Venue Ads List
  venueAdsList.innerHTML = '';
  venueAds.forEach((ad, idx) => {
    const item = document.createElement('div');
    item.className = 'pill-item-slider';
    item.innerHTML = `
      <div class="pill-slider-header">
        <span class="pill-title">${ad.name}</span>
        <button type="button" class="btn-delete" data-type="venue" data-index="${idx}">&times;</button>
      </div>
      <div class="pill-slider-controls">
        <input type="range" class="duration-slider" data-type="venue" data-index="${idx}" min="10" max="300" step="5" value="${ad.duration}">
        <div class="pill-slider-meta">
          <span class="dur-val">${ad.duration}s</span>
        </div>
      </div>
    `;
    venueAdsList.appendChild(item);
  });

  // Render Buyers List
  buyersList.innerHTML = '';
  buyers.forEach((buyer, idx) => {
    const color = BUYER_COLORS[idx % BUYER_COLORS.length];
    const P = Math.floor(slotAirtime / buyer.duration);

    const item = document.createElement('div');
    item.className = 'pill-item-slider';
    item.style.borderLeft = `4px solid ${color}`;
    item.innerHTML = `
      <div class="pill-slider-header">
        <span class="pill-title">${buyer.name}</span>
        <button type="button" class="btn-delete" data-type="buyer" data-index="${idx}">&times;</button>
      </div>
      <div class="pill-slider-controls">
        <input type="range" class="duration-slider" data-type="buyer" data-index="${idx}" min="10" max="60" step="1" value="${buyer.duration}">
        <div class="pill-slider-meta">
          <span class="dur-val">${buyer.duration}s</span>
          <span class="p-val">P: ${P}</span>
        </div>
      </div>
    `;
    buyersList.appendChild(item);
  });
}

function renderDashboard(results) {
  const secondsPerDay = X * 3600;

  // 1. Scoreboard Header
  const hrs = Math.floor(results.totalSimulatedDuration / 3600);
  const mins = Math.floor((results.totalSimulatedDuration % 3600) / 60);
  const secs = results.totalSimulatedDuration % 60;
  statDuration.textContent = `${hrs}h ${mins}m ${secs}s`;
  
  const totalPaidPlays = results.buyerMetrics.reduce((sum, bm) => sum + bm.actualP, 0);
  statPaidPlays.textContent = totalPaidPlays;
  statIdleAirtime.textContent = formatDuration(results.idleAirtime);
  statMaxGap.textContent = formatDuration(results.maxStretchNoPaid);
  
  statSlotFill.textContent = `${buyers.length} / ${Y} (${Math.round((buyers.length / Y) * 100)}%)`;
  statAirtimeBooked.textContent = `${((results.paidAirtime / secondsPerDay) * 100).toFixed(1)}%`;

  // 2. Airtime Stacked Bar
  const paidPct = (results.paidAirtime / secondsPerDay) * 100;
  const venuePct = (results.venueAirtime / secondsPerDay) * 100;
  const idlePct = (results.idleAirtime / secondsPerDay) * 100;

  pctPaidLabel.textContent = `${paidPct.toFixed(1)}%`;
  pctVenueLabel.textContent = `${venuePct.toFixed(1)}%`;
  pctIdleLabel.textContent = `${idlePct.toFixed(1)}%`;

  barPaid.style.width = `${paidPct}%`;
  barVenue.style.width = `${venuePct}%`;
  barIdle.style.width = `${idlePct}%`;

  // 3. Promises Kept Checklist
  updateChecklistItem('promise-venue-cut', results.promises.venueAdsNeverCut);
  updateChecklistItem('promise-no-overlap', results.promises.noPaidAdsOverlap);
  updateChecklistItem('promise-no-past-close', results.promises.noPaidAdPastClosing);
  updateChecklistItem('promise-plays-delivered', results.promises.playsAtOrJustBelowP);
  updateChecklistItem('promise-plays-spread', results.promises.playsSpreadNotClustered);

  // 4. Render Data Tables
  renderMetricsTables(results);

  // 5. Render Timeline Track
  renderTimeline(results);
}

function updateChecklistItem(id, success) {
  const el = document.getElementById(id);
  if (success) {
    el.className = 'promise-pass';
  } else {
    el.className = 'promise-fail';
  }
}

function renderMetricsTables(results) {
  // Render Buyers Table
  buyerMetricsTableBody.innerHTML = '';
  if (results.buyerMetrics.length === 0) {
    buyerMetricsTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim);">No paid buyers added</td></tr>`;
  } else {
    results.buyerMetrics.forEach((bm, idx) => {
      const color = BUYER_COLORS[idx % BUYER_COLORS.length];
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>
          <span style="display:inline-block; width: 10px; height: 10px; border-radius: 50%; background:${color}; margin-right: 6px;"></span>
          <strong>${bm.name}</strong>
        </td>
        <td>${bm.duration}s</td>
        <td>${bm.promisedP}</td>
        <td style="color: ${bm.actualP >= bm.promisedP - 2 ? 'var(--color-success)' : 'var(--color-warning)'}">
          ${bm.actualP} / ${bm.promisedP}
        </td>
        <td>${bm.idealF.toFixed(0)}s</td>
        <td>${bm.averageGap.toFixed(1)}s</td>
        <td style="font-weight: 600; color: ${bm.longestGap <= 3.0 * bm.idealF ? 'var(--text-bright)' : 'var(--color-warning)'}">
          ${bm.longestGap.toFixed(0)}s
        </td>
      `;
      buyerMetricsTableBody.appendChild(row);
    });
  }

  // Render Venue Table
  venueMetricsTableBody.innerHTML = '';
  results.venueMetrics.forEach(vm => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${vm.name}</td>
      <td>${vm.duration}s</td>
      <td>${vm.playCount}</td>
      <td>${formatDuration(vm.playCount * vm.duration)}</td>
    `;
    venueMetricsTableBody.appendChild(row);
  });
}

function renderTimeline(results) {
  const secondsPerDay = X * 3600;
  const zoomFactor = parseInt(zoomSlider.value);

  // Update track width dynamically as percentage
  const widthPercent = zoomFactor === 1 ? 100 : zoomFactor * 100;
  timelineTrack.style.width = `${widthPercent}%`;
  timeTicksTrack.style.width = `${widthPercent}%`;

  // Clear ticks & tracks
  timeTicksTrack.innerHTML = '';
  timelineTrack.innerHTML = '';
  minimapTrack.innerHTML = '';
  timelineLegend.innerHTML = '';

  // Render Time Ticks (every 1 hour)
  const hoursCount = X;
  for (let h = 0; h <= hoursCount; h++) {
    const timeSec = h * 3600;
    if (timeSec > results.totalSimulatedDuration) break;
    const pct = (timeSec / results.totalSimulatedDuration) * 100;
    const tick = document.createElement('div');
    tick.className = 'time-tick';
    tick.style.left = `${pct}%`;
    tick.innerHTML = `<span>Hour ${h}</span>`;
    timeTicksTrack.appendChild(tick);
  }

  // Render Detailed Blocks & Mini-map Blocks
  results.events.forEach((evt) => {
    const duration = evt.end - evt.start;
    const pctWidth = (duration / results.totalSimulatedDuration) * 100;
    const pctLeft = (evt.start / results.totalSimulatedDuration) * 100;

    // Timeline Block
    const block = document.createElement('div');
    block.className = `timeline-block ${evt.type}`;
    block.style.left = `${pctLeft}%`;
    block.style.width = `${pctWidth}%`;

    // Associate color if paid
    let colorIndex = -1;
    if (evt.type === 'paid') {
      colorIndex = buyers.findIndex(b => b.id === evt.adId);
      if (colorIndex !== -1) {
        const color = BUYER_COLORS[colorIndex % BUYER_COLORS.length];
        block.style.setProperty('--buyer-color', color);
      }
    }

    block.innerHTML = `
      <span class="block-name">${evt.name}</span>
      <span class="block-dur">${duration}s</span>
    `;

    // Tooltip trigger
    block.addEventListener('mouseenter', (e) => showTooltip(e, evt, colorIndex));
    block.addEventListener('mousemove', (e) => positionTooltip(e));
    block.addEventListener('mouseleave', () => hideTooltip());

    timelineTrack.appendChild(block);

    // Mini-map Block
    const miniBlock = document.createElement('div');
    miniBlock.className = `minimap-block`;
    miniBlock.style.flex = `${duration}`;
    if (evt.type === 'paid') {
      const color = colorIndex !== -1 ? BUYER_COLORS[colorIndex % BUYER_COLORS.length] : 'var(--color-primary)';
      miniBlock.style.backgroundColor = color;
    } else {
      miniBlock.style.backgroundColor = 'var(--color-venue)';
    }
    minimapTrack.appendChild(miniBlock);
  });

  // Render Buyer Legend
  buyers.forEach((buyer, idx) => {
    const color = BUYER_COLORS[idx % BUYER_COLORS.length];
    const legendItem = document.createElement('span');
    legendItem.className = 'legend-dot paid';
    legendItem.style.setProperty('--color-primary', color);
    legendItem.innerHTML = `${buyer.name} (Ad: ${buyer.duration}s)`;
    timelineLegend.appendChild(legendItem);
  });

  // Add Venue Legend
  const venueLegendItem = document.createElement('span');
  venueLegendItem.className = 'legend-dot venue';
  venueLegendItem.innerHTML = `Venue Promos`;
  timelineLegend.appendChild(venueLegendItem);

  // Sync Minimap Viewport indicator
  syncMinimapViewport();
}

// --- MINIMAP VIEWPORT SYNC ---
function syncMinimapViewport() {
  const scrollLeft = detailedTimelineScroller.scrollLeft;
  const scrollWidth = detailedTimelineScroller.scrollWidth;
  const clientWidth = detailedTimelineScroller.clientWidth;

  if (scrollWidth <= clientWidth) {
    minimapViewport.style.left = '0%';
    minimapViewport.style.width = '100%';
    return;
  }

  const viewportWidthPct = (clientWidth / scrollWidth) * 100;
  const viewportLeftPct = (scrollLeft / scrollWidth) * 100;

  minimapViewport.style.width = `${viewportWidthPct}%`;
  minimapViewport.style.left = `${viewportLeftPct}%`;
}

// --- TOOLTIP BUBBLE CONTROLS ---
function showTooltip(e, evt, colorIndex) {
  const color = colorIndex !== -1 ? BUYER_COLORS[colorIndex % BUYER_COLORS.length] : 'var(--color-venue)';
  const typeText = evt.type === 'paid' ? 'Paid Ad (Buyer)' : 'Venue Promo';
  const startStr = formatTime(evt.start);
  const endStr = formatTime(evt.end);
  const duration = evt.end - evt.start;

  tooltip.innerHTML = `
    <div style="font-weight:700; margin-bottom: 2px; color:${color}">${evt.name}</div>
    <div style="color:var(--text-dim); font-size:0.7rem; margin-bottom: 4px;">${typeText}</div>
    Time: <strong>${startStr} - ${endStr}</strong> (${duration}s)
  `;
  tooltip.style.display = 'block';
}

function positionTooltip(e) {
  const padding = 15;
  let x = e.clientX + padding;
  let y = e.clientY + padding;

  // Boundary checks
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;

  if (x + tooltipWidth > window.innerWidth) {
    x = e.clientX - tooltipWidth - padding;
  }
  if (y + tooltipHeight > window.innerHeight) {
    y = e.clientY - tooltipHeight - padding;
  }

  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  tooltip.style.display = 'none';
}

// --- SLIDER CONTROLS EVENT LISTENERS ---

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Tab Switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));
      
      btn.classList.add('active');
      document.getElementById(`tab-content-${tabId}`).classList.remove('hidden');
      
      if (tabId === '2') {
        setTimeout(syncMinimapViewport, 50);
      }
    });
  });

  // TV Simulator Playback Controls
  tvPlayBtn.addEventListener('click', () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  });

  tvScrubBar.addEventListener('input', (e) => {
    pausePlayback();
    currentTimeSec = parseFloat(e.target.value);
    updateTvUi();
  });

  tvSpeedSelect.addEventListener('change', (e) => {
    playbackRate = parseFloat(e.target.value);
  });

  // Global Settings Controls
  inputHours.addEventListener('change', () => {
    X = Math.max(1, Math.min(24, parseInt(inputHours.value) || 8));
    inputHours.value = X;
    triggerRun();
  });

  inputSlots.addEventListener('change', () => {
    Y = Math.max(1, Math.min(10, parseInt(inputSlots.value) || 5));
    inputSlots.value = Y;
    triggerRun();
  });

  // Zoom Slider
  zoomSlider.addEventListener('input', () => {
    zoomValLabel.textContent = zoomSlider.value === '1' ? 'Fit' : `${zoomSlider.value}x`;
    const results = runSimulation({
      X,
      SLOT_SHARE,
      venueAds,
      buyers
    });
    renderTimeline(results);
  });

  // Timeline Scroll Event to move Mini-map viewport
  detailedTimelineScroller.addEventListener('scroll', syncMinimapViewport);
  window.addEventListener('resize', syncMinimapViewport);

  // Jump to location in timeline via click on Mini-map
  minimapContainer.addEventListener('click', (e) => {
    const rect = minimapContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickPct = clickX / rect.width;
    
    const maxScroll = detailedTimelineScroller.scrollWidth - detailedTimelineScroller.clientWidth;
    detailedTimelineScroller.scrollLeft = clickPct * detailedTimelineScroller.scrollWidth - (detailedTimelineScroller.clientWidth / 2);
  });

  // Delete Action Event Delegation
  document.body.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-delete')) {
      const type = e.target.getAttribute('data-type');
      const idx = parseInt(e.target.getAttribute('data-index'));

      if (type === 'venue') {
        venueAds.splice(idx, 1);
      } else if (type === 'buyer') {
        buyers.splice(idx, 1);
      }

      renderSidebarLists();
      triggerRun();
    }
  });

  // Add Venue Promo instantly (no modal popup)
  btnAddVenue.addEventListener('click', () => {
    const name = `Venue Ad ${venueAds.length + 1}`;
    venueAds.push({
      id: `venue_${Date.now()}`,
      name,
      duration: 30
    });
    renderSidebarLists();
    triggerRun();
  });

  // Add Buyer instantly (no modal popup)
  btnAddBuyer.addEventListener('click', () => {
    const name = `Paid Ad ${buyers.length + 1}`;
    const newBuyer = {
      id: `buyer_${Date.now()}`,
      name,
      duration: 30
    };

    const capacityCheck = checkBuyerCapacity(newBuyer, buyers, X, Y, SLOT_SHARE);
    if (!capacityCheck.allowed) {
      capacityWarning.classList.remove('hidden');
      capacityWarningText.textContent = `Blocked: ${capacityCheck.reason}`;
      return;
    }

    capacityWarning.classList.add('hidden');
    buyers.push(newBuyer);
    renderSidebarLists();
    triggerRun();
  });

  // Handle slider inputs inside lists (instant UI and simulation updates)
  const handleSliderInput = (e) => {
    if (e.target.classList.contains('duration-slider')) {
      const type = e.target.getAttribute('data-type');
      const idx = parseInt(e.target.getAttribute('data-index'));
      const val = parseInt(e.target.value);

      if (type === 'venue') {
        venueAds[idx].duration = val;
        const meta = e.target.nextElementSibling;
        meta.querySelector('.dur-val').textContent = `${val}s`;
      } else if (type === 'buyer') {
        buyers[idx].duration = val;
        const meta = e.target.nextElementSibling;
        meta.querySelector('.dur-val').textContent = `${val}s`;

        const secondsPerDay = X * 3600;
        const slotAirtime = secondsPerDay * SLOT_SHARE;
        const P = Math.floor(slotAirtime / val);
        meta.querySelector('.p-val').textContent = `P: ${P}`;
      }
      triggerRun();
    }
  };

  venueAdsList.addEventListener('input', handleSliderInput);
  buyersList.addEventListener('input', handleSliderInput);
}

// --- SIMULATOR PLAYBACK LOOP FUNCTIONS ---
function renderMiniSequence(results) {
  const secondsPerDay = X * 3600;
  tvDaySequenceTrack.innerHTML = '';
  
  results.events.forEach(evt => {
    const duration = evt.end - evt.start;
    const pctWidth = (duration / secondsPerDay) * 100;
    const pctLeft = (evt.start / secondsPerDay) * 100;
    
    const block = document.createElement('div');
    block.className = `tv-mini-sequence-block ${evt.type}`;
    block.style.left = `${pctLeft}%`;
    block.style.width = `${pctWidth}%`;
    
    let color = '#34a853'; // Venue ads are green
    if (evt.type === 'paid') {
      const idx = buyers.findIndex(b => b.id === evt.adId);
      if (idx !== -1) {
        color = BUYER_COLORS[idx % BUYER_COLORS.length];
      } else {
        color = 'var(--color-primary)';
      }
    }
    block.style.backgroundColor = color;
    
    tvDaySequenceTrack.appendChild(block);
  });
}

function renderZoomSequence(results) {
  if (!results) return;
  const secondsPerDay = X * 3600;
  const windowDuration = 1800; // 30 minutes in seconds
  
  // Calculate window start centering around currentTimeSec, clamped to day bounds
  const T_start = Math.max(0, Math.min(secondsPerDay - windowDuration, currentTimeSec - windowDuration / 2));
  const T_end = T_start + windowDuration;
  
  tvZoomSequenceTrack.innerHTML = '';
  
  results.events.forEach(evt => {
    // Check if event overlaps the 30-min window
    if (evt.end > T_start && evt.start < T_end) {
      const blockStart = Math.max(T_start, evt.start);
      const blockEnd = Math.min(T_end, evt.end);
      const duration = blockEnd - blockStart;
      
      const pctWidth = (duration / windowDuration) * 100;
      const pctLeft = ((blockStart - T_start) / windowDuration) * 100;
      
      const block = document.createElement('div');
      block.className = `tv-mini-sequence-block ${evt.type}`;
      block.style.left = `${pctLeft}%`;
      block.style.width = `${pctWidth}%`;
      
      let color = '#34a853'; // Venue ads are green
      if (evt.type === 'paid') {
        const idx = buyers.findIndex(b => b.id === evt.adId);
        if (idx !== -1) {
          color = BUYER_COLORS[idx % BUYER_COLORS.length];
        } else {
          color = 'var(--color-primary)';
        }
      }
      block.style.backgroundColor = color;
      
      tvZoomSequenceTrack.appendChild(block);
    }
  });
  
  // Position Zoom playhead relative to active window
  const zoomPct = ((currentTimeSec - T_start) / windowDuration) * 100;
  tvZoomPlayhead.style.left = `${zoomPct}%`;
}

function updateTvUi() {
  if (!currentSimulationResults) return;
  
  const secondsPerDay = X * 3600;
  
  // Clamp currentTimeSec
  if (currentTimeSec > secondsPerDay) {
    currentTimeSec = 0;
  }
  
  // Update scrub bar and timeline time label
  tvScrubBar.value = Math.floor(currentTimeSec);
  
  const curTimeStr = formatTime(Math.floor(currentTimeSec));
  const maxTimeStr = formatTime(secondsPerDay);
  tvTimeLabel.textContent = `${curTimeStr} / ${maxTimeStr}`;
  
  // Find current event
  const activeEvt = currentSimulationResults.events.find(
    evt => currentTimeSec >= evt.start && currentTimeSec < evt.end
  );
  
  if (activeEvt) {
    // Current ad type and name
    tvAdName.textContent = activeEvt.name;
    tvAdType.textContent = activeEvt.type === 'paid' ? 'Paid Slot' : 'Venue Promo';
    tvAdType.className = `tv-badge ${activeEvt.type}`;
    
    // Timer & Progress inside ad
    const adElapsed = currentTimeSec - activeEvt.start;
    const adDuration = activeEvt.end - activeEvt.start;
    
    tvAdTimer.textContent = `${formatDuration(Math.floor(adElapsed))} / ${formatDuration(adDuration)}`;
    const adProgressPct = (adElapsed / adDuration) * 100;
    tvAdProgressFill.style.width = `${adProgressPct}%`;
    
    // Background and glow colors
    let adColor = '#34a853'; // Venue ads are green
    if (activeEvt.type === 'paid') {
      const idx = buyers.findIndex(b => b.id === activeEvt.adId);
      if (idx !== -1) {
        adColor = BUYER_COLORS[idx % BUYER_COLORS.length];
      } else {
        adColor = 'var(--color-primary)';
      }
      tvScreen.style.borderColor = adColor;
      tvScreen.style.boxShadow = `inset 0 0 40px rgba(0, 0, 0, 0.8), 0 0 15px ${adColor}44`;
      tvScreenGlow.style.background = `radial-gradient(circle, ${adColor} 0%, transparent 70%)`;
      tvScreenGlow.style.opacity = '0.25';
    } else {
      // Venue ad: glows and displays green
      tvScreen.style.borderColor = adColor;
      tvScreen.style.boxShadow = `inset 0 0 40px rgba(0, 0, 0, 0.8), 0 0 15px ${adColor}44`;
      tvScreenGlow.style.background = `radial-gradient(circle, ${adColor} 0%, transparent 70%)`;
      tvScreenGlow.style.opacity = '0.25';
    }
    tvAdProgressFill.style.background = adColor;
  } else {
    // We are in the idle gap at the end of the day or simulation finished
    tvAdName.textContent = 'Closed / Idle';
    tvAdType.textContent = 'Idle';
    tvAdType.className = `tv-badge idle`;
    tvAdTimer.textContent = `0s / 0s`;
    tvAdProgressFill.style.width = '0%';
    tvAdProgressFill.style.background = 'var(--color-primary)';
    
    tvScreen.style.borderColor = 'rgba(255, 255, 255, 0.05)';
    tvScreen.style.boxShadow = `inset 0 0 40px rgba(0, 0, 0, 0.9)`;
    tvScreenGlow.style.background = 'none';
    tvScreenGlow.style.opacity = '0';
  }
  
  // Sync day playhead
  const dayPct = (currentTimeSec / secondsPerDay) * 100;
  tvDayPlayhead.style.left = `${dayPct}%`;
  
  // Render/sync the zoom track & zoom playhead
  renderZoomSequence(currentSimulationResults);
  
  if (timelinePlayhead) {
    timelinePlayhead.style.left = `${dayPct}%`;
  }
  if (minimapPlayhead) {
    minimapPlayhead.style.left = `${dayPct}%`;
  }
}

function playbackTick(timestamp) {
  if (!isPlaying) return;
  
  if (!lastFrameTime) lastFrameTime = timestamp;
  const elapsedMs = timestamp - lastFrameTime;
  lastFrameTime = timestamp;
  
  // Calculate delta time in seconds
  const dt = elapsedMs / 1000;
  
  // Advance time
  const secondsPerDay = X * 3600;
  currentTimeSec += dt * playbackRate;
  
  if (currentTimeSec >= secondsPerDay) {
    currentTimeSec = 0; // Loop day
  }
  
  updateTvUi();
  
  animationFrameId = requestAnimationFrame(playbackTick);
}

function startPlayback() {
  if (isPlaying) return;
  isPlaying = true;
  lastFrameTime = 0;
  tvPlayBtn.textContent = '⏸ Pause';
  tvPlayBtn.classList.add('pause-btn');
  animationFrameId = requestAnimationFrame(playbackTick);
}

function pausePlayback() {
  if (!isPlaying) return;
  isPlaying = false;
  tvPlayBtn.textContent = '▶ Play';
  tvPlayBtn.classList.remove('pause-btn');
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// --- UTILITY FORMATTERS ---
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Start the Application
window.addEventListener('DOMContentLoaded', init);
