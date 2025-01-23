import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import player from "node-wav-player";
import chokidar from "chokidar";
import chalk from "chalk";
import { safeReadFile, safeWriteFile } from "./fileOps.js";

const verbose = process.argv.includes("-v"); // Check for -v flag
const testServer = process.argv.includes("-t"); // Check for -t flag

dotenv.config({ path: path.join(process.cwd(), ".env.alpaca") }); // Load environment variables

// Define paths
const tickerFilePath = path.join(process.cwd(), "tickers.json");

// Variables
const CHECK_INTERVAL = 1 * 1000; // 1 second
let delay = 500; // Initial delay in ms
const maxDelay = 100000000; // Maximum delay
const minDelay = 100; // Minimum delay

let watcher; // Declare watcher globally
let fileChangeTimeout; // To debounce rapid file changes
let tickersData = {}; // To store tickers with news
let lastProcessedTime = 0; // Variable to track the last processed time

// Play WAV sound with debounce and tracking
let lastPlayedTime = 0;
const DEBOUNCE_INTERVAL = 10000; // 10 seconds

function playWav(filePath) {
    const now = Date.now();
    if (now - lastPlayedTime < DEBOUNCE_INTERVAL) {
        return; // Skip playback if within debounce interval
    }

    lastPlayedTime = now; // Update last playback time
    player.play({ path: filePath }).catch((error) => {
        if (verbose) console.error(`Error playing file:`, error);
    });
}

// Sleep function for delays
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Watch for changes in tickers.json
const startFileWatcher = () => {
    console.log(`Watching for changes in: ${tickerFilePath}`);
    watcher = chokidar.watch(tickerFilePath, { persistent: true });

    watcher.on("change", async () => {
        if (fileChangeTimeout) clearTimeout(fileChangeTimeout);

        // Debounce the file change event
        fileChangeTimeout = setTimeout(async () => {
            console.log(`File changed: ${tickerFilePath}, reprocessing tickers...`);
            await processTickers();
        }, 500);
    });

    watcher.on("error", (error) => console.error(`Watcher error: ${error}`));
};

// Read tickers from the JSON file
const readTickersFromFile = async () => {
    try {
        if (verbose) console.log(`Reading tickers from JSON file: ${tickerFilePath}`);
        tickersData = await safeReadFile(tickerFilePath);
        const tickerSymbols = Object.keys(tickersData);
        console.log(`Tickers found: ${tickerSymbols.join(", ")}`);
        return tickerSymbols;
    } catch (err) {
        console.error("Error reading ticker file:", err);
        return [];
    }
};

const writeTickersToFile = async () => {
    try {
        if (verbose) console.log("Pausing watcher for safe write operation...");
        await watcher.close();
        await safeWriteFile(tickerFilePath, tickersData);
        startFileWatcher();
    } catch (err) {
        console.error("Error writing to ticker file:", err);
    }
};

// Fetch news for a ticker from the Alpaca API or Test Server
const getNewsForTicker = async (ticker) => {
    let url;
    const currentTime = new Date();
    const last24Hours = new Date(currentTime - 24 * 60 * 60 * 1000); // 24 hours ago
    const formattedDate = last24Hours.toISOString(); // Format to ISO 8601

    if (testServer) {
        url = `http://localhost:3000/v1beta1/news?symbols=${ticker}&start=${formattedDate}`;
    } else {
        url = `https://data.alpaca.markets/v1beta1/news?symbols=${ticker}&start=${formattedDate}&limit=50&sort=desc`;
    }

    const options = {
        method: "GET",
        headers: {
            accept: "application/json",
            "APCA-API-KEY-ID": process.env.APCA_API_KEY_ID,
            "APCA-API-SECRET-KEY": process.env.APCA_API_SECRET_KEY,
        },
    };

    try {
        if (verbose) console.log(`Fetching news for ticker: ${ticker} with delay: ${delay}ms`);
        const response = await fetch(url, options);

        if (response.ok) {
            const news = await response.json();
            delay = Math.max(minDelay, delay - 100); // Reduce delay after a successful request
            return news.news || [];
        } else if (response.status === 429) {
            delay = Math.min(maxDelay, delay * 2); // Double the delay on rate limiting
            console.warn(`Rate limited! Increasing delay to ${delay}ms`);
            return [];
        } else {
            const text = await response.text();
            console.error("API request failed:", response.status, text);
            return [];
        }
    } catch (error) {
        console.error("Error fetching news:", error.message);
        return [];
    }
};

const updateTickersWithNews = (ticker, news) => {
    if (!tickersData[ticker]) {
        console.error(`Ticker ${ticker} not found in tickersData.`);
        return;
    }

    tickersData[ticker].news = tickersData[ticker].news || []; // Initialize if undefined

    let newNewsFound = false; // Track if new news is found

    news.forEach((newsItem) => {
        if (newsItem.symbols.length !== 1 || newsItem.symbols[0] !== ticker) {
            if (verbose) console.log(`Skipping news for ${ticker} due to multiple symbols:`, newsItem.symbols);
            return;
        }

        const exists = tickersData[ticker].news.some((existingNews) => existingNews.id === newsItem.id);
        if (!exists) {
            tickersData[ticker].news.push({
                ...newsItem,
                added_at: new Date().toISOString(),
            });
            console.log(`${ticker}: "${newsItem.headline}"`);
            newNewsFound = true; // Mark as new news found
        }
    });

    if (newNewsFound) {
        tickersData[ticker].isActive = true;
        console.log(`Ticker ${ticker} is now active due to new news.`);
    }
};

// Collect and process news for tickers with adaptive throttling
const collectAllNews = async (tickers) => {
    let updatesMade = false; // Track if any updates were made

    for (const ticker of tickers) {
        if (verbose) console.log(`Fetching news for ticker: ${ticker}`);
        const newsData = await getNewsForTicker(ticker);
        if (newsData && newsData.length > 0) {
            const initialNewsCount = tickersData[ticker]?.news?.length || 0;
            updateTickersWithNews(ticker, newsData);
            if (tickersData[ticker]?.news?.length > initialNewsCount) {
                updatesMade = true; // Mark if new news was added
            }
        } else {
            if (verbose) console.log(`No news found for ticker: ${ticker}`);
        }

        await sleep(delay); // Wait for the current delay before the next request
    }
    if (updatesMade) {
        await writeTickersToFile(); // Write only if updates were made
    } else if (verbose) {
        console.log("No new updates to write to tickers.json");
    }
};

// Process tickers, fetch news, and print results
const processTickers = async () => {
    const tickersToProcess = await readTickersFromFile();
    console.log(`Processing ${tickersToProcess.length} tickers...`);
    await collectAllNews(tickersToProcess);
};

// Main function to run the script every interval
const main = async () => {
    if (verbose) console.log("Starting main function...");
    startFileWatcher(); // Start watching the file
    await processTickers(); // Process tickers immediately on start
    lastProcessedTime = Date.now(); // Set initial processed time

    setInterval(async () => {
        const currentTime = Date.now();
        const elapsedTime = currentTime - lastProcessedTime;

        if (elapsedTime >= CHECK_INTERVAL) {
            await processTickers();
            lastProcessedTime = currentTime; // Update the last processed time
        } else {
            if (verbose) console.log(`Skipping tickers processing; only ${elapsedTime / 1000}s since last run.`);
        }
    }, CHECK_INTERVAL);
};

main().catch(console.error);