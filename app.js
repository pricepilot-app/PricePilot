/**
 * Vendor Price Optimizer - Core Application Logic
 * Combines data management, math functions (linear regression),
 * price optimization algorithm, and DOM/Chart updates.
 */

import { auth, db } from './firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// State
let dailyRecords = [];
const MIN_DATA_POINTS = 3;
const MIN_TOTAL_UNITS_FOR_RECOMMENDATION = 15;
const MIN_PRICE_OVER_COST_MULTIPLIER = 1.10;
let activeProductId = 'default';
let activeUserId = null;
let activeProductName = null;

function getRecordsCollectionRef() {
    if (!activeUserId || !activeProductId) return null;
    return collection(db, 'users', activeUserId, 'products', activeProductId, 'records');
}

async function loadRecords() {
    const col = getRecordsCollectionRef();
    if (!col) return [];
    const q = query(col, orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function saveRecord(record) {
    const col = getRecordsCollectionRef();
    if (!col) return null;
    const ref = await addDoc(col, { ...record, createdAt: serverTimestamp() });
    return ref.id;
}

async function deleteRecord(index) {
    const record = dailyRecords[index];
    if (!record) return;
    if (record.id && activeUserId && activeProductId) {
        try {
            await deleteDoc(doc(db, 'users', activeUserId, 'products', activeProductId, 'records', record.id));
        } catch (e) {
            console.error('Failed to delete record', e);
        }
    }
    dailyRecords.splice(index, 1);
    updateUI();
}

function editRecord(index) {
    const record = dailyRecords[index];
    if (!record) return;
    document.getElementById('revenue-input').value = record.revenue;
    document.getElementById('cost-input').value = record.cost;
    document.getElementById('quantity-input').value = record.quantity;
    deleteRecord(index);
    document.getElementById('revenue-input').focus();
}

async function clearRecords() {
    const col = getRecordsCollectionRef();
    if (!col) return;
    const snap = await getDocs(col);
    for (const d of snap.docs) {
        await deleteDoc(d.ref);
    }
}

function updateProductSubtitle() {
    const subtitle = document.getElementById('product-subtitle');
    if (!subtitle) return;
    const productName = activeProductName;
    subtitle.textContent = productName ? `Optimizing: ${productName}` : 'Data-driven margin maximization for dropshippers';
}

async function loadProductName() {
    if (!activeUserId || !activeProductId) return null;
    const productRef = doc(db, 'users', activeUserId, 'products', activeProductId);
    const snap = await getDoc(productRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    return data && data.name ? data.name : null;
}

// --- Math & Core Logic ---

/**
 * Perform simple linear regression to find best fit line: y = mx + c (or Q = aP + b)
 * Equivalent to np.polyfit(x, y, 1)
 * @param {Array} x - Independent variable (e.g., price)
 * @param {Array} y - Dependent variable (e.g., quantity)
 * @returns {Object} { slope: a, intercept: b }
 */
function linearRegression(x, y) {
    const n = x.length;
    if (n === 0) return { slope: 0, intercept: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += (x[i] * y[i]);
        sumXX += (x[i] * x[i]);
    }

    const denominator = (n * sumXX) - (sumX * sumX);
    if (denominator === 0) return { slope: 0, intercept: sumY / n }; // Vertical line edge case

    const slope = ((n * sumXY) - (sumX * sumY)) / denominator;
    const intercept = (sumY - (slope * sumX)) / n;

    return { slope, intercept };
}

/**
 * Compute R^2 for a linear model y = a x + b
 */
function regressionR2(x, y, a, b) {
    const n = x.length;
    if (n === 0) return 0;

    const meanY = y.reduce((sum, v) => sum + v, 0) / n;
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
        const yHat = a * x[i] + b;
        const diff = y[i] - yHat;
        ssRes += diff * diff;
        const diffTot = y[i] - meanY;
        ssTot += diffTot * diffTot;
    }
    if (ssTot === 0) return 0;
    return 1 - (ssRes / ssTot);
}

function pearsonCorrelation(x, y) {
    const n = x.length;
    if (n === 0) return 0;
    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    if (denX === 0 || denY === 0) return 0;
    return num / Math.sqrt(denX * denY);
}

function quadraticRegression(x, y) {
    const n = x.length;
    if (n === 0) return { a: 0, b: 0, c: 0 };

    let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
    let sumY = 0, sumXY = 0, sumX2Y = 0;

    for (let i = 0; i < n; i++) {
        const xi = x[i];
        const yi = y[i];
        const x2 = xi * xi;
        const x3 = x2 * xi;
        const x4 = x2 * x2;

        sumX += xi;
        sumX2 += x2;
        sumX3 += x3;
        sumX4 += x4;
        sumY += yi;
        sumXY += xi * yi;
        sumX2Y += x2 * yi;
    }

    const det =
        sumX4 * (sumX2 * n - sumX * sumX) -
        sumX3 * (sumX3 * n - sumX * sumX2) +
        sumX2 * (sumX3 * sumX - sumX2 * sumX2);

    if (det === 0) return { a: 0, b: 0, c: sumY / n };

    const detA =
        sumX2Y * (sumX2 * n - sumX * sumX) -
        sumX3 * (sumXY * n - sumX * sumY) +
        sumX2 * (sumXY * sumX - sumX2 * sumY);

    const detB =
        sumX4 * (sumXY * n - sumX * sumY) -
        sumX2Y * (sumX3 * n - sumX * sumX2) +
        sumX2 * (sumX3 * sumY - sumX2 * sumXY);

    const detC =
        sumX4 * (sumX2 * sumY - sumX * sumXY) -
        sumX3 * (sumX3 * sumY - sumX2 * sumXY) +
        sumX2Y * (sumX3 * sumX - sumX2 * sumX2);

    return {
        a: detA / det,
        b: detB / det,
        c: detC / det
    };
}

function standardDeviation(arr) {
    const n = arr.length;
    if (n === 0) return 0;
    const mean = arr.reduce((s, v) => s + v, 0) / n;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
}

/**
 * The core price optimization numerical search algorithm
 * @param {Array} records - Array of daily data objects
 * @returns {Object} Contains optimal price, predicted profit, and demand model details
 */
function optimizePrice(records) {
    if (records.length < MIN_DATA_POINTS) return null;

    const cleanRecords = records.filter(r =>
        Number.isFinite(r?.avgPrice) &&
        r.avgPrice > 0 &&
        Number.isFinite(r?.quantity) &&
        r.quantity >= 0 &&
        Number.isFinite(r?.revenue) &&
        r.revenue >= 0 &&
        Number.isFinite(r?.cost) &&
        r.cost >= 0
    );
    if (cleanRecords.length < MIN_DATA_POINTS) return null;

    // 1. Use derived or provided price (supports 0-unit entries)
    const prices = cleanRecords.map(r => r.avgPrice);
    const quantities = cleanRecords.map(r => r.quantity);
    const costs = cleanRecords.map(r => r.cost);

    const totalQty = quantities.reduce((sum, v) => sum + v, 0);
    if (totalQty < MIN_TOTAL_UNITS_FOR_RECOMMENDATION) {
        return {
            stop: true,
            warning: `Not enough sales yet. Get at least ${MIN_TOTAL_UNITS_FOR_RECOMMENDATION} total units sold before trusting a recommendation. Tip: if you didn’t run ads (or traffic was abnormal), don’t log that day.`
        };
    }

    // 2. Check price variation (must vary)
    const minObservedPrice = Math.min(...prices);
    const maxObservedPrice = Math.max(...prices);
    if (minObservedPrice === maxObservedPrice) {
        return {
            stop: true,
            warning: 'Try different prices to learn demand'
        };
    }

    // 3. Quadratic demand model
    let { a, b, c } = quadraticRegression(prices, quantities);
    if (a > 0) {
        a = -Math.abs(a);
    }

    // 4. Flat curve warning
    if (Math.abs(a) < 0.0001 && Math.abs(b) < 0.01) {
        return {
            stop: true,
            warning: 'Not enough variation in data. Recommendation may be unreliable'
        };
    }

    const corr = pearsonCorrelation(prices, quantities);
    const confidence = Math.abs(corr);

    // 4. Cost handling (weighted average unit cost)
    const totalCost = costs.reduce((sum, v) => sum + v, 0);
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    // 5. Always run optimization on observed price range (no extension)
    const minPrice = minObservedPrice;
    const maxPrice = maxObservedPrice;
    const step = 0.5;

    const demand = (p) => (a * p * p) + (b * p) + c;

    let optimalPrice = minPrice;
    let maxProfit = -Infinity;
    let expectedDemand = 0;
    const profitCurveData = [];

    for (let price = minPrice; price <= maxPrice + 1e-9; price += step) {
        const qPred = demand(price);
        if (qPred < 0) continue;
        const profit = (price - avgCost) * qPred;
        profitCurveData.push({ x: price, y: profit });

        if (profit > maxProfit) {
            maxProfit = profit;
            optimalPrice = price;
            expectedDemand = qPred;
        }
    }

    if (Number.isFinite(maxProfit) && maxProfit <= 0) {
        return {
            stop: true,
            warning: 'All tested prices appear unprofitable. Your costs may be too high, or try testing higher price points.'
        };
    }
    if (profitCurveData.length === 0 || maxProfit === -Infinity) {
        return {
            stop: true,
            warning: 'Try different prices to learn demand'
        };
    }

    // Clamp recommendation to mean ± 2σ of observed prices (safety band).
    // Filter outliers via IQR first so a single typo (e.g. $10,000 vs $100)
    // doesn't blow the band so wide it stops protecting against bad picks.
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const percentile = (p) => {
        const idx = (sortedPrices.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return sortedPrices[lo];
        return sortedPrices[lo] + (sortedPrices[hi] - sortedPrices[lo]) * (idx - lo);
    };
    const q1 = percentile(0.25);
    const q3 = percentile(0.75);
    const iqr = q3 - q1;
    let cleanedPrices;
    if (iqr === 0) {
        // Most prices are identical; IQR filter would collapse the band to a
        // single point, so fall back to the natural std dev of all prices.
        cleanedPrices = prices;
    } else {
        const iqrLower = q1 - 1.5 * iqr;
        const iqrUpper = q3 + 1.5 * iqr;
        cleanedPrices = prices.filter(p => p >= iqrLower && p <= iqrUpper);
    }
    const safePrices = cleanedPrices.length > 0 ? cleanedPrices : prices;

    const avgObservedPrice = safePrices.reduce((s, v) => s + v, 0) / safePrices.length;
    const variance = safePrices.reduce((s, v) => s + ((v - avgObservedPrice) ** 2), 0) / safePrices.length;
    const stdDev = Math.sqrt(variance);
    const lowerBound = avgObservedPrice - (2 * stdDev);
    const upperBound = avgObservedPrice + (2 * stdDev);

    const modelOptimalPrice = optimalPrice;
    let bestPrice = modelOptimalPrice;
    let wasCappedToBounds = false;
    
    if (Number.isFinite(stdDev) && stdDev > 0) {
        const boundedPrice = Math.max(lowerBound, Math.min(bestPrice, upperBound));
        wasCappedToBounds = Math.abs(boundedPrice - modelOptimalPrice) > 1e-9;
        bestPrice = boundedPrice;
    }

    // Never recommend below a minimum margin over cost
    const minViablePrice = avgCost > 0 ? avgCost * MIN_PRICE_OVER_COST_MULTIPLIER : 0;
    if (minViablePrice > 0 && minViablePrice > maxPrice) {
        return {
            stop: true,
            warning: `Your unit cost implies a minimum viable price above your tested range. Try higher prices before optimizing.`
        };
    }
    if (minViablePrice > 0) bestPrice = Math.max(bestPrice, minViablePrice);

    const finalDemand = Math.max(demand(bestPrice), 0);
    const finalProfit = (bestPrice - avgCost) * finalDemand;
    if (!Number.isFinite(finalProfit) || finalProfit <= 0) {
        return {
            stop: true,
            warning: `No profitable price found within your tested range. Try higher prices or lower costs.`
        };
    }

    const expectedPrice = bestPrice;
    const askingPrice = expectedPrice * 1.1;

    return {
        optimalPrice: bestPrice,
        modelOptimalPrice,
        bounds: { lower: lowerBound, upper: upperBound },
        wasCapped: wasCappedToBounds,
        expectedPrice,
        askingPrice,
        rawBestPrice: bestPrice,
        currentPrice: avgObservedPrice,
        maxProfit: finalProfit,
        expectedDemand: finalDemand,
        globalAvgCost: avgCost,
        model: { type: 'quadratic', a, b, c },
        confidence,
        profitCurve: profitCurveData
    };
}

// --- UI Interaction & DOM Updates ---

// Chart Instances
let demandChartInst = null;
let profitChartInst = null;
let trendsChartInst = null;

// Helpers to format currency
const CURRENCY_SYMBOL = '$';
const formatCurr = (val) => CURRENCY_SYMBOL + Math.round(parseFloat(val));
const formatNum = (val) => Math.round(parseFloat(val)).toString();

function updateUI() {
    updateMetrics();
    updateTable();
    updateRecommendationPanel();
    updateCharts();
}

function updateMetrics() {
    if (dailyRecords.length === 0) {
        document.getElementById('metric-avg-price').innerText = `${CURRENCY_SYMBOL}0`;
        document.getElementById('metric-avg-demand').innerText = '0';
        document.getElementById('metric-avg-cost').innerText = `${CURRENCY_SYMBOL}0`;
        document.getElementById('metric-avg-profit').innerText = `${CURRENCY_SYMBOL}0`;
        return;
    }

    const sumList = arr => arr.reduce((a, b) => a + b, 0);
    const finite = arr => arr.filter(v => Number.isFinite(v));
    const avgOf = arr => {
        const xs = finite(arr);
        if (xs.length === 0) return 0;
        return sumList(xs) / xs.length;
    };

    const avgPrice = avgOf(dailyRecords.map(r => r.avgPrice));
    const avgDemand = avgOf(dailyRecords.map(r => r.quantity));
    const avgCost = avgOf(dailyRecords.map(r => r.avgCost));
    const avgProfit = avgOf(dailyRecords.map(r => r.profit));

    document.getElementById('metric-avg-price').innerText = formatCurr(avgPrice);
    document.getElementById('metric-avg-demand').innerText = Math.round(avgDemand);
    document.getElementById('metric-avg-cost').innerText = formatCurr(avgCost);
    document.getElementById('metric-avg-profit').innerText = formatCurr(avgProfit);
}

function updateTable(animateLast = false) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    
    document.getElementById('record-count').innerText = `${dailyRecords.length} entries`;

    if (dailyRecords.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row" id="empty-row-msg">
                <td colspan="8">No data logged yet. Add your first entry.</td>
            </tr>`;
        return;
    }

    dailyRecords.forEach((record, index) => {
        const tr = document.createElement('tr');
        // Add animation class if it's the latest item and flag is true
        if (animateLast && index === dailyRecords.length - 1) {
            tr.classList.add('row-enter');
        }

        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${formatCurr(record.revenue)}</td>
            <td>${formatCurr(record.cost)}</td>
            <td>${record.quantity}</td>
            <td>${formatCurr(record.avgPrice)}</td>
            <td>${formatCurr(record.avgCost)}</td>
            <td style="color:${record.profit >= 0 ? 'var(--success)' : 'var(--danger)'}">${formatCurr(record.profit)}</td>
            <td class="actions-cell">
                <button type="button" class="btn-link edit-record-btn" data-index="${index}">Edit</button>
                <button type="button" class="btn-link delete-record-btn" data-index="${index}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.edit-record-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt(btn.getAttribute('data-index'), 10);
            editRecord(i);
        });
    });
    tbody.querySelectorAll('.delete-record-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt(btn.getAttribute('data-index'), 10);
            deleteRecord(i);
        });
    });
}

function updateRecommendationPanel() {
    const needsMsg = document.getElementById('needs-data-msg');
    const optimalResult = document.getElementById('optimal-result');
    const progressBar = document.getElementById('data-progress');
    const progressText = document.getElementById('progress-text');

    const count = dailyRecords.length;
    
    if (count < MIN_DATA_POINTS) {
        needsMsg.classList.remove('hide');
        optimalResult.classList.add('hide');
        
        const pct = (count / MIN_DATA_POINTS) * 100;
        progressBar.style.width = `${pct}%`;
        progressText.innerText = `${count} / ${MIN_DATA_POINTS} entries logged`;
    } else {
        needsMsg.classList.add('hide');
        optimalResult.classList.remove('hide');

        const optResult = optimizePrice(dailyRecords);
        if(!optResult) return;

	        if (optResult.stop) {
	            document.getElementById('rec-optimal-price').innerText = `Recommended price: ${CURRENCY_SYMBOL}--`;
	            const insightBadge = document.getElementById('insight-badge');
	            const insightText = document.getElementById('insight-text');
	            insightBadge.className = 'insight-badge badge-neutral';
	            insightBadge.innerText = 'Low';
	            insightText.innerText = optResult.warning;
            document.getElementById('model-equation').innerText = 'Demand Model: Not enough variation';
            return;
        }

	        // Baseline price used for "increase/decrease by" messaging
	        // (currently: average observed selling price across logged records)
	        const baselineAvgPrice = optResult.currentPrice;

	        const recEl = document.getElementById('rec-optimal-price');
	        if (optResult.wasCapped && Number.isFinite(optResult.modelOptimalPrice)) {
	            recEl.innerHTML = `
                    <div class="rec-price-main">Recommended price: ${formatCurr(optResult.optimalPrice)}</div>
                    <div class="rec-price-model">Model's optimal price: ${formatCurr(optResult.modelOptimalPrice)}</div>
                    <div class="rec-price-note">
                        The recommended price stays within what you've already tested. The optimal price is what the model believes will maximize profit based on your demand curve.
                    </div>
                `;
	        } else {
	            recEl.innerHTML = `<div class="rec-price-main">Recommended price: ${formatCurr(optResult.optimalPrice)}</div>`;
	        }
	        
	        const diff = optResult.optimalPrice - baselineAvgPrice;
	        const insightBadge = document.getElementById('insight-badge');
	        const insightText = document.getElementById('insight-text');

        const confidence = optResult.confidence ?? 0;
        const confidenceLabel = confidence < 0.3 ? "Low confidence" : confidence < 0.6 ? "Medium confidence" : "High confidence";

	        const baselineLabel = `average price (${formatCurr(baselineAvgPrice)})`;
	        let directionText = `Current ${baselineLabel} looks optimal`;
	        if (Math.abs(diff) >= 0.5) {
	            if (diff > 0) {
	                directionText = `Increase price by ${formatCurr(diff)} vs your ${baselineLabel}`;
	                insightBadge.className = 'insight-badge badge-up';
	                insightBadge.innerText = `+${formatCurr(diff)}`;
	            } else {
	                directionText = `Decrease price by ${formatCurr(Math.abs(diff))} vs your ${baselineLabel}`;
	                insightBadge.className = 'insight-badge badge-down';
	                insightBadge.innerText = `-${formatCurr(Math.abs(diff))}`;
	            }
	        } else {
	            insightBadge.className = 'insight-badge badge-neutral';
	            insightBadge.innerText = 'Optimal';
	        }

        if (confidence < 0.3) {
            insightBadge.className = 'insight-badge badge-neutral';
            insightBadge.innerText = 'Low';
            insightText.innerText = `Low confidence estimate – based on limited/ noisy data. ${directionText}`;
        } else {
            insightText.innerText = directionText;
        }

        const a_fmt = optResult.model ? optResult.model.a.toFixed(6) : '0.000000';
        const b_fmt = optResult.model ? optResult.model.b.toFixed(4) : '0.0000';
        const c_fmt = optResult.model ? optResult.model.c.toFixed(2) : '0.00';
        const modelLabel = optResult.model ? optResult.model.type : 'quadratic';

        document.getElementById('model-equation').innerText = 
            `Demand Model (${modelLabel}): Q = ${a_fmt}P^2 + ${b_fmt}P + ${c_fmt} (${confidenceLabel})`;
    }
}

// Chart Management
const defaultChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    color: '#718096',
    plugins: { legend: { labels: { color: '#2d3748' } } },
    scales: {
        x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#718096' } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#718096' } }
    }
};

function initCharts() {
    Chart.defaults.font.family = "'Inter', sans-serif";
    
    // 1. Demand Chart (Scatter plot + regression line)
    const ctxDemand = document.getElementById('demandChart').getContext('2d');
    demandChartInst = new Chart(ctxDemand, {
        type: 'scatter',
        data: { datasets: [] },
        options: {
            ...defaultChartOptions,
            plugins: {
                ...defaultChartOptions.plugins,
                title: { display: false }
            },
            scales: {
                ...defaultChartOptions.scales,
                x: { ...defaultChartOptions.scales.x, title: { display: true, text: 'Average Selling Price ($)', color: '#718096' } },
                y: { ...defaultChartOptions.scales.y, title: { display: true, text: 'Quantity Sold', color: '#718096' } }
            }
        }
    });

    // 2. Profit Simulation Chart
    const ctxProfit = document.getElementById('profitChart').getContext('2d');
    profitChartInst = new Chart(ctxProfit, {
        type: 'line',
        data: { datasets: [] },
        options: {
            ...defaultChartOptions,
            elements: { point: { radius: 0 } }, // hide points for smooth curve
            scales: {
                ...defaultChartOptions.scales,
                x: { ...defaultChartOptions.scales.x, type: 'linear', title: { display: true, text: 'Candidate Price ($)', color: '#718096' } },
                y: { ...defaultChartOptions.scales.y, title: { display: true, text: 'Predicted Profit ($)', color: '#718096' } }
            }
        }
    });

    // 3. Historical Trends Chart (Bar/Line combo)
    const ctxTrends = document.getElementById('trendsChart').getContext('2d');
    trendsChartInst = new Chart(ctxTrends, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            ...defaultChartOptions,
            scales: {
                ...defaultChartOptions.scales,
                x: { ...defaultChartOptions.scales.x, title: { display: true, text: 'Entry', color: '#718096' } },
                y: { ...defaultChartOptions.scales.y, title: { display: true, text: 'Amount ($) / Qty', color: '#718096' } }
            }
        }
    });
}

function updateCharts() {
    if(!demandChartInst) return;

    if (dailyRecords.length === 0) {
        demandChartInst.data.datasets = []; demandChartInst.update();
        profitChartInst.data.datasets = []; profitChartInst.update();
        trendsChartInst.data.labels = []; trendsChartInst.data.datasets = []; trendsChartInst.update();
        return;
    }

    // Prepare real data points for Demand Chart
    const scatterData = dailyRecords.map(r => ({ x: r.avgPrice, y: r.quantity }));
    
    let demandDatasets = [{
        label: 'Daily Sales',
        data: scatterData,
        backgroundColor: '#1a365d',
        borderColor: '#1a365d',
        pointRadius: 6,
        type: 'scatter'
    }];

    // Update charts based on optimization result
    if (dailyRecords.length >= MIN_DATA_POINTS) {
        const result = optimizePrice(dailyRecords);
        if (result) {
            const minX = Math.min(...scatterData.map(d=>d.x));
            const maxX = Math.max(...scatterData.map(d=>d.x));

            if (result.model) {
                const steps = 24;
                const curve = Array.from({ length: steps }, (_, i) => {
                    const p = minX + (i / (steps - 1)) * (maxX - minX);
                    const y = (result.model.a * p * p) + (result.model.b * p) + result.model.c;
                    return { x: p, y };
                });
                demandDatasets.push({
                    label: 'Demand Trend (Quadratic)',
                    data: curve,
                    type: 'line',
                    borderColor: '#c5a880',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                });
            }

            // Update Profit Chart
            const optPoint = { x: result.optimalPrice, y: result.maxProfit };
            
            profitChartInst.data.datasets = [
                {
                    label: 'Predicted Profit',
                    data: result.profitCurve,
                    borderColor: '#2f855a',
                    backgroundColor: 'rgba(47, 133, 90, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Optimal Point',
                    data: [optPoint],
                    type: 'scatter',
                    backgroundColor: '#c5a880',
                    pointRadius: 8,
                    pointStyle: 'star'
                }
            ];
            profitChartInst.update();
        }
    } else {
        profitChartInst.data.datasets = []; 
        profitChartInst.update();
    }

    demandChartInst.data.datasets = demandDatasets;
    demandChartInst.update();

    // Update Trends Chart
    const labels = dailyRecords.map((_, i) => String(i + 1));
    trendsChartInst.data.labels = labels;
    trendsChartInst.data.datasets = [
        {
            label: 'Revenue',
            data: dailyRecords.map(r => r.revenue),
            backgroundColor: 'rgba(26, 54, 93, 0.5)',
            borderColor: '#1a365d',
            borderWidth: 1,
            type: 'bar'
        },
        {
            label: 'Cost',
            data: dailyRecords.map(r => r.cost),
            backgroundColor: 'rgba(197, 48, 48, 0.5)',
            borderColor: '#c53030',
            borderWidth: 1,
            type: 'bar'
        },
        {
            label: 'Profit',
            data: dailyRecords.map(r => r.profit),
            borderColor: '#2f855a',
            backgroundColor: '#2f855a',
            borderWidth: 2,
            type: 'line',
            tension: 0.3
        }
    ];
    trendsChartInst.update();
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const urlProduct = params.get('product');
    activeProductId = urlProduct || 'default';

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        activeUserId = user.uid;

        if (!urlProduct) {
            window.location.href = 'hub.html';
            return;
        }

        activeProductName = await loadProductName();
        updateProductSubtitle();

        dailyRecords = await loadRecords();

        initCharts();
        updateUI();
        updateTable(false);
    });
    
    // Tab switching logic for charts
    const tabs = document.querySelectorAll('.tab-btn');
    const chartWrappers = document.querySelectorAll('.chart-wrapper');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            chartWrappers.forEach(w => w.classList.add('hide'));
            
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hide');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Form Submission
    document.getElementById('daily-data-form').addEventListener('submit', (e) => {
        e.preventDefault();

        const revenue = parseFloat(document.getElementById('revenue-input').value);
        const cost = parseFloat(document.getElementById('cost-input').value);
        const quantity = parseInt(document.getElementById('quantity-input').value, 10);

        // Derived values
        const avgPrice = quantity > 0 ? revenue / quantity : NaN;
        const avgCost = quantity > 0 ? cost / quantity : 0;
        const profit = revenue - cost;

        if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
            alert('Enter valid revenue and quantity so we can infer an average selling price (> 0).');
            return;
        }

        const newRecord = { revenue, cost, quantity, avgPrice, avgCost, profit };

        dailyRecords.push(newRecord);
        e.target.reset(); // clear form

        saveRecord(newRecord).then(id => {
            if (id) newRecord.id = id;
        });
        updateUI();
        updateTable(true); // passed true to animate the new row
    });

    // Clear Data Modal Logic
    const clearBtn = document.getElementById('clear-data-btn');
    const clearModal = document.getElementById('clear-data-modal');
    const cancelClearBtn = document.getElementById('cancel-clear-btn');
    const confirmClearBtn = document.getElementById('confirm-clear-btn');
    const clearCloseBtn = document.getElementById('clear-modal-close');

    const openClearModal = () => {
        clearModal.classList.add('open');
        clearModal.setAttribute('aria-hidden', 'false');
    };

    const closeClearModal = () => {
        clearModal.classList.remove('open');
        clearModal.setAttribute('aria-hidden', 'true');
    };

    if (clearBtn) clearBtn.addEventListener('click', openClearModal);
    if (cancelClearBtn) cancelClearBtn.addEventListener('click', closeClearModal);
    if (clearCloseBtn) clearCloseBtn.addEventListener('click', closeClearModal);

    if (clearModal) {
        clearModal.addEventListener('click', (e) => {
            if (e.target === clearModal) closeClearModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && clearModal && clearModal.classList.contains('open')) {
            closeClearModal();
        }
    });

    if (confirmClearBtn) {
        confirmClearBtn.addEventListener('click', async () => {
            dailyRecords = [];
            await clearRecords();
            updateUI();
            closeClearModal();
        });
    }

    // Initial render occurs after auth+load
});
