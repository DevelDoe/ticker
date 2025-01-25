// financials_scraper.js 

import fs from "fs";
import path from "path";
import axios from "axios";
import { config as dotenvConfig } from "dotenv";
import { safeReadFile, safeWriteFile } from "./fileOps.js";

dotenvConfig({ path: path.resolve(process.cwd(), ".env.polygon-news") });

const tickerFilePath = path.join(process.cwd(), "tickers.json");
const financialsFilePath = path.join(process.cwd(), "financials.json");

const POLY_API_KEY = process.env.POLY_API_KEY;
if (!POLY_API_KEY) {
    console.error("API key missing! Set POLY_API_KEY in .env.polygon-news");
    process.exit(1);
}

const processedTickers = new Set();
const retryPool = [];
let isProcessing = false;
const verbose = process.argv.includes("-v");
const MAX_RETRIES = 50;

// Throttle settings
let delay = 10000; // Start with 1 second delay
const MIN_DELAY = 10000; // Minimum delay (500ms)
const MAX_DELAY = 120000; // Maximum delay (10 seconds)
const INCREASE_FACTOR = 1.1; // Multiply delay on rate limit
const DECREASE_FACTOR = 0.999; // Reduce delay on success

// Verbose logging
const logVerbose = (msg) => verbose && console.log(`VERBOSE: ${msg}`);

// Read financials file
const readFinancialsFile = async () => {
    try {
        let financials = await safeReadFile(financialsFilePath);
        return typeof financials === "string" ? JSON.parse(financials) : financials || {};
    } catch (err) {
        console.error(`Error reading ${financialsFilePath}:`, err.message);
        return {};
    }
};

// Write updates to financials.json
const updateFinancialsInFile = async (ticker, financialData, financials) => {
    financials[ticker] = financialData;
    await safeWriteFile(financialsFilePath, financials);
    console.log(`Updated financials for ${ticker}`);
};

// Fetch financials with dynamic throttling
const fetchFinancials = async (ticker, attempt = 1) => {
    const url = `https://api.polygon.io/vX/reference/financials?ticker=${ticker}&limit=1&apiKey=${POLY_API_KEY}`;
    try {
        logVerbose(`Fetching financials for ${ticker} (Attempt ${attempt}, Delay: ${delay}ms)...`);
        await new Promise((resolve) => setTimeout(resolve, delay)); // Apply delay
        const response = await axios.get(url);
        const results = response.data.results;

        // Decrease delay on successful requests
        delay = Math.max(MIN_DELAY, delay * DECREASE_FACTOR);

        if (!results?.length) {
            console.log(`No financials available for ${ticker}`);
            processedTickers.add(ticker); // Mark ticker as processed even if no financials
            return null; // No retry needed
        }

        const financials = results[0].financials;
        return {
            netIncome: financials.income_statement?.net_income_loss?.value || 0,
            netCashFlow: financials.cash_flow_statement?.net_cash_flow?.value || 0,
            cash: financials.balance_sheet?.assets?.value || 0,
        };
    } catch (err) {
        if (err.response?.status === 429) {
            // Increase delay on rate limit errors
            delay = Math.min(MAX_DELAY, delay * INCREASE_FACTOR);
            if (attempt <= MAX_RETRIES) {
                console.log(`Rate limited for ${ticker}. Retrying in ${delay / 1000} seconds...`);
                return await fetchFinancials(ticker, attempt + 1);
            }
        }
        console.error(`Error fetching financials for ${ticker}:`, err.message);
        return null;
    }
};


// Process tickers
const processTickers = async (tickers) => {
    const financials = await readFinancialsFile();

    for (const ticker of tickers) {
        if (processedTickers.has(ticker)) continue; // Skip already processed tickers

        const data = await fetchFinancials(ticker);

        if (data) {
            await updateFinancialsInFile(ticker, data, financials);
            processedTickers.add(ticker); // Mark ticker as successfully processed
        } else if (!processedTickers.has(ticker)) {
            // Add to retry pool only if there was an error fetching data
            console.log(`Adding ${ticker} to retry pool due to fetch error.`);
            retryPool.push(ticker);
        }
    }

    if (retryPool.length > 0) {
        const retries = [...retryPool];
        retryPool.length = 0; // Clear retry pool
        console.log(`Retrying ${retries.length} tickers...`);
        await processTickers(retries);
    }
};






// Watch tickers.json for changes
const watchFile = () => {
    let fileChangeTimeout = null;

    fs.watch(tickerFilePath, { persistent: true }, async (eventType) => {
        if (eventType === "change" && !isProcessing) {
            clearTimeout(fileChangeTimeout);
            fileChangeTimeout = setTimeout(async () => {
                isProcessing = true;
                console.log("Detected changes in tickers.json. Processing...");
                const tickers = Object.keys(await safeReadFile(tickerFilePath));
                await processTickers(tickers);
                isProcessing = false;
            }, 500); // Debounce time of 500ms
        }
    });
    console.log(`Watching ${tickerFilePath} for changes...`);
};


// Main function
const main = async () => {
    console.log("Starting financials scraper...");
    const tickers = Object.keys(await safeReadFile(tickerFilePath));
    await processTickers(tickers);
    watchFile();
};

main().catch(console.error);
