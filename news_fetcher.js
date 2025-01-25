import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import player from "node-wav-player";
import chokidar from "chokidar";
import chalk from "chalk";
import { safeReadFile, safeWriteFile } from "./fileOps.js";

const verbose = process.argv.includes("-v");
const testServer = process.argv.includes("-t");

dotenv.config({ path: path.join(process.cwd(), ".env.alpaca") });

const tickersFilePath = path.join(process.cwd(), "tickers.json");
const newsFilePath = path.join(process.cwd(), "news.json");

const MIN_DELAY = 2000; // Minimum delay between requests (in ms)
const MAX_DELAY = 5000; // Maximum delay (in ms)
const BACKOFF_MULTIPLIER = 2; // Multiply delay on 429 errors
const RECOVERY_STEP = 100; // Decrease delay on successful responses

let throttleDelay = 500; // Initial delay
let tickerPool = []; // Pool of tickers
let newsData = {}; // Loaded news data

// Performance monitoring variables
let tickersProcessed = 0; // Count of tickers processed
let newsAdded = 0; // Count of news items added

// Play WAV sound with debounce
let lastPlayedTime = 100;
const DEBOUNCE_INTERVAL = 10000; // 10 seconds
function playWav(filePath, ticker = "", context = "") {
    const now = Date.now();
    if (now - lastPlayedTime < DEBOUNCE_INTERVAL) return;
    lastPlayedTime = now;
    player
        .play({ path: filePath })
        .then(() => {
            if (verbose) console.log(`Played sound for ${ticker} (${context}): ${filePath}`);
        })
        .catch((error) => {
            if (verbose) console.error(`Error playing file for ${ticker} (${context}):`, error);
        });
}

// Fetch news for a ticker with throttling logic
const fetchTickerNews = async (ticker) => {
    const currentTime = new Date();
    const last24Hours = new Date(currentTime - 24 * 60 * 60 * 1000); // 24 hours ago
    const formattedDate = last24Hours.toISOString();

    let url = `https://data.alpaca.markets/v1beta1/news?symbols=${ticker}&start=${formattedDate}&limit=50&sort=desc`;

    const options = {
        method: "GET",
        headers: {
            accept: "application/json",
            "APCA-API-KEY-ID": process.env.APCA_API_KEY_ID,
            "APCA-API-SECRET-KEY": process.env.APCA_API_SECRET_KEY,
        },
    };

    try {
        const response = await fetch(url, options);
        if (response.ok) {
            const news = await response.json();
            const previousThrottle = throttleDelay; // Capture previous delay
            throttleDelay = Math.max(throttleDelay - RECOVERY_STEP, MIN_DELAY); // Decrease delay on success
            if (throttleDelay !== previousThrottle) {
                console.log(`Throttle delay decreased to ${throttleDelay}ms (API success).`);
            }
            return news.news || [];
        } else if (response.status === 429) {
            const previousThrottle = throttleDelay; // Capture previous delay
            throttleDelay = Math.min(throttleDelay * BACKOFF_MULTIPLIER, MAX_DELAY); // Exponential backoff
            if (throttleDelay !== previousThrottle) {
                console.error(`Throttle delay increased to ${throttleDelay}ms due to API rate limit (429).`);
            }
        } else {
            console.error(`API request failed: ${response.status} ${await response.text()}`);
        }
    } catch (error) {
        console.error(`Error fetching news for ${ticker}: ${error.message}`);
    }
    return [];
};



// Filter news and remove duplicates/unwanted keywords
const filterNews = (newsItems, existingNews) => {
    const unwantedKeywords = [
        "Why Is",
        "Stock Soaring",
        "shares resumed trade",
        "halted",
        "suspended",
        "Shares Resume",
        "Stock Is Down",
        "Stock Is Rising",
        "Rockets Higher",
        "trading higher",
        "Shares Are Down",
        "Shares Resume Trade",
        "What's Going On",
        "Stock Is Trading Lower",
        "Shares Are Skyrocketing",
        "Here's Why",
        "Moving In",
        "Market-Moving News",
        "US Stocks Set To Open"
    ];

    return newsItems.filter((newsItem) => {
        if (
            newsItem.headline &&
            unwantedKeywords.some((keyword) =>
                newsItem.headline.toLowerCase().includes(keyword.toLowerCase())
            )
        ) {
            if (verbose) console.log(`Skipping news due to unwanted keyword`);
            return false;
        }

        if (existingNews.some((item) => item.id === newsItem.id)) {
            if (verbose) console.log(`Skipping duplicate news`);
            return false;
        }

        return true;
    });
};

// Process a single ticker
const processTicker = async (ticker) => {
    const news = await fetchTickerNews(ticker);

    if (news.length > 0) {
        const filteredNews = filterNews(news, newsData[ticker] || []);
        if (filteredNews.length > 0) {
            filteredNews.forEach((newsItem) => {
                newsItem.added_at = new Date().toISOString();
            });
            newsData[ticker] = [...(newsData[ticker] || []), ...filteredNews];
            await writeNewsToFile(newsData);

            console.log(`Added ${filteredNews.length} news items for ticker: ${ticker}`);
            newsAdded += filteredNews.length; // Increment news items added
        }
    } else {
        console.log(`No news found for ticker: ${ticker}`);
    }

    tickersProcessed++; // Increment tickers processed
};

// Write news to file
const writeNewsToFile = async (data) => {
    try {
        await safeWriteFile(newsFilePath, data);
        console.log("News data saved to news.json.");
    } catch (err) {
        console.error("Error writing to news.json:", err);
    }
};

// Ticker processing loop
let poolEmptyLogged = false; // Tracks whether the empty pool message was logged

const processTickerPool = async () => {
    try {
        while (true) {
            if (tickerPool.length === 0) {
                if (!poolEmptyLogged) {
                    console.log("No tickers in the pool. Waiting for updates...");
                    poolEmptyLogged = true; // Mark the empty pool message as logged
                }

                // Attempt to refresh the pool from tickers.json
                const tickers = await safeReadFile(tickersFilePath);
                if (tickers && Object.keys(tickers).length > 0) {
                    tickerPool = Object.keys(tickers);
                    console.log(`Refreshed ticker pool with ${tickerPool.length} tickers.`);
                }

                await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
                continue;
            }

            poolEmptyLogged = false; // Reset the empty pool log flag
            const ticker = tickerPool.shift();
            await processTicker(ticker);
            tickerPool.push(ticker);

            console.log(`Waiting for ${throttleDelay}ms before the next ticker...`);
            await new Promise((resolve) => setTimeout(resolve, throttleDelay));
        }
    } catch (error) {
        console.error("Error in processTickerPool:", error);
    }
};



// Initialize ticker pool
const initializeTickerPool = async () => {
    const tickers = await safeReadFile(tickersFilePath);
    if (!tickers || Object.keys(tickers).length === 0) {
        console.log("No tickers found in tickers.json.");
        return;
    }
    tickerPool = Object.keys(tickers);
    console.log(`Initialized ticker pool with ${tickerPool.length} tickers.`);
};

// Watch tickers.json for changes
const watchTickersFile = () => {
    chokidar.watch(tickersFilePath, { persistent: true }).on("change", async () => {
        console.log("tickers.json updated. Refreshing ticker pool...");
        await initializeTickerPool();
    });
};

const logPerformanceSummary = () => {
    setInterval(() => {
        console.log(`\nPerformance Summary (last minute):`);
        console.log(`- Tickers processed: ${tickersProcessed}`);
        console.log(`- News items added: ${newsAdded}`);
        console.log(`- Current throttle delay: ${throttleDelay}ms\n`);

        // Reset metrics for the next interval
        tickersProcessed = 0;
        newsAdded = 0;
    }, 60000); // Log every 60 seconds
};


// Main function
const main = async () => {
    try {
        newsData = (await safeReadFile(newsFilePath)) || {};
        await initializeTickerPool();
        watchTickersFile();
        logPerformanceSummary(); // Start performance summaries
        processTickerPool();
    } catch (error) {
        console.error("Error in main function:", error);
        process.exit(1); // Exit the script if a critical error occurs
    }
};

// Start the script
main().catch(console.error);
