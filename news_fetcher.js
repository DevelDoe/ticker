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

let MIN_DELAY = 10; // Minimum delay between requests (in ms)
const MAX_DELAY = 10000; // Maximum delay (in ms)
const BACKOFF_MULTIPLIER = 2; // Aggressive backoff multiplier
const RECOVERY_STEP = 50; // Decrease delay on multiple successful responses
const SUCCESS_THRESHOLD = 5; // Number of consecutive successes to reduce delay
const MIN_DELAY_INCREMENT = 10; // Increment to MIN_DELAY on throttle
const MAX_MIN_DELAY = 2000; // Maximum value for MIN_DELAY to prevent runaway growth

let throttleDelay = 10; // Initial delay
let consecutiveSuccesses = 0; // Tracks the number of successful requests in a row


let tickerPool = []; // Pool of tickers
let newsData = {}; // Loaded news data

// Performance monitoring variables
let tickersProcessed = 0; // Count of tickers processed
let newsAdded = 0; // Count of news items added

// Global object to track ticker statuses
const tickerStatus = {};
let isLogging = false; // To prevent overlapping logs

// Function to initialize ticker statuses
const initializeTickerStatus = async () => {
    const tickers = await safeReadFile(tickersFilePath);
    Object.keys(tickers).forEach((ticker) => {
        tickerStatus[ticker] = "waiting"; // Set default status
    });
};

// Function to update a ticker's status
const updateTickerStatus = (ticker, status, responseCode = null) => {
    tickerStatus[ticker] = {
        status,
        responseCode: responseCode !== null ? `(${responseCode})` : "",
    };
    logTickerStatuses(); // Refresh log immediately
};

// Function to log ticker statuses (the only visible output)
const logTickerStatuses = (responseCode = "") => {
    if (isLogging) return; // Prevent overlapping logs
    isLogging = true;

    console.clear(); // Clear the console for clean output
    console.log(`Throttle delay (real-time): ${throttleDelay}ms`);
    console.log(`Last fetch: ${responseCode || "N/A"}`);
    console.log("Tickers:");

    const tickerList = Object.keys(tickerStatus);
    const statuses = tickerList.map((ticker) => ticker);

    console.log(statuses.join("\n")); // Print tickers on separate lines

    isLogging = false;
};

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
const fetchNewsForTickers = async (tickers) => {
    const currentTime = new Date();
    const last24Hours = new Date(currentTime - 24 * 60 * 60 * 1000); // 24 hours ago
    const formattedDate = last24Hours.toISOString();

    // Join tickers into a comma-separated string
    const symbols = tickers.join(",");

    let url = `https://data.alpaca.markets/v1beta1/news?symbols=${symbols}&start=${formattedDate}&limit=50&sort=desc`;

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
        const responseStatus = response.status;

        // Log the response in verbose mode
        if (verbose) {
            console.log(`Fetched news for tickers: ${symbols}`);
            console.log(`Response Status: ${responseStatus}`);
            console.log("Response Headers:", response.headers.raw());
        }

        if (response.ok) {
            const news = await response.json();
            if (verbose) {
                console.log("Response Data:", JSON.stringify(news, null, 2));
            }

            // Successful response: Adjust throttle and MIN_DELAY
            consecutiveSuccesses += 1;
            if (consecutiveSuccesses >= SUCCESS_THRESHOLD) {
                throttleDelay = Math.max(throttleDelay - RECOVERY_STEP, MIN_DELAY);
                consecutiveSuccesses = 0; // Reset successes after reducing delay
                console.log(`Throttle delay decreased to ${throttleDelay}ms (after ${SUCCESS_THRESHOLD} successes).`);
            }

            return { news: news.news || [], responseStatus };
        } else if (responseStatus === 429) {
            // Too many requests: Aggressive backoff and increase MIN_DELAY
            throttleDelay = Math.min(throttleDelay * BACKOFF_MULTIPLIER, MAX_DELAY);
            MIN_DELAY = Math.min(MIN_DELAY + MIN_DELAY_INCREMENT, MAX_MIN_DELAY); // Increase MIN_DELAY
            console.warn(`Throttle delay increased to ${throttleDelay}ms due to 429 rate limit. MIN_DELAY is now ${MIN_DELAY}ms.`);
            consecutiveSuccesses = 0; // Reset consecutive successes on error
            return { news: [], responseStatus };
        } else {
            console.error(`API request failed: ${responseStatus} ${await response.text()}`);
            return { news: [], responseStatus };
        }
    } catch (error) {
        console.error(`Error fetching news for tickers: ${error.message}`);
        return { news: [], responseStatus: "Error" };
    }
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
        "US Stocks Set To Open",
        "Nasdaq Dips",
        "Here Are Top"
    ];

    return newsItems.filter((newsItem) => {
        if (
            newsItem.headline &&
            unwantedKeywords.some((keyword) =>
                newsItem.headline.toLowerCase().includes(keyword.toLowerCase())
            )
        ) {
            // if (verbose) console.log(`Skipping news due to unwanted keyword`);
            return false;
        }

        if (existingNews.some((item) => item.id === newsItem.id)) {
            // if (verbose) console.log(`Skipping duplicate news`);
            return false;
        }

        return true;
    });
};



// Write news to file
const writeNewsToFile = async (data) => {
    try {
        await safeWriteFile(newsFilePath, data);
        // console.log("News data saved to news.json.");
    } catch (err) {
        console.error("Error writing to news.json:", err);
    }
};

// Process a batch of tickers
const processTickerBatch = async (batch) => {
    const { news, responseStatus } = await fetchNewsForTickers(batch);

    if (news.length > 0) {
        // Iterate over each news item
        news.forEach((newsItem) => {
            // Check all symbols associated with the news item
            newsItem.symbols.forEach((symbol) => {
                if (batch.includes(symbol)) {
                    // Initialize the array for the ticker if it doesn't exist
                    if (!newsData[symbol]) {
                        newsData[symbol] = [];
                    }

                    // Filter out unwanted news and duplicates
                    const filteredNews = filterNews([newsItem], newsData[symbol]);

                    if (filteredNews.length > 0) {
                        // Add the 'added_at' timestamp
                        filteredNews.forEach((filteredItem) => {
                            filteredItem.added_at = new Date().toISOString();
                            newsData[symbol].push(filteredItem);
                        });
                    }
                }
            });
        });

        // Write updated newsData to file
        await writeNewsToFile(newsData);
        newsAdded += news.length; // Increment the count of news items added
    }

    // Update all ticker statuses to "waiting" and pass response code to logging
    batch.forEach((ticker) => {
        tickerStatus[ticker] = "waiting";
    });

    logTickerStatuses(responseStatus); // Updated logging here
};




// Ticker processing loop
let poolEmptyLogged = false; // Tracks whether the empty pool message was logged

// Updated processing loop with batching
const processTickerPool = async () => {
    const batchSize = 10; // Number of tickers to process in one API call
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
                }

                await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
                continue;
            }

            poolEmptyLogged = false; // Reset the empty pool log flag

            // Take a batch of tickers from the pool
            const batch = tickerPool.splice(0, batchSize);
            await processTickerBatch(batch);

            // Add batch back to pool for continuous processing
            tickerPool.push(...batch);

            // Wait before the next batch
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
        // console.log("tickers.json updated. Refreshing ticker pool...");
        await initializeTickerPool();
    });
};

const logPerformanceSummary = () => {
    setInterval(() => {
        // console.log(`\nPerformance Summary (last minute):`);
        // console.log(`- Tickers processed: ${tickersProcessed}`);
        // console.log(`- News items added: ${newsAdded}`);
        // console.log(`- Current throttle delay: ${throttleDelay}ms\n`);

        // Reset metrics for the next interval
        tickersProcessed = 0;
        newsAdded = 0;
    }, 60000); // Log every 60 seconds
};


// Main function
const main = async () => {
    try {
        newsData = (await safeReadFile(newsFilePath)) || {};
        await initializeTickerStatus();
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
