import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import player from "node-wav-player";
import chokidar from "chokidar"; // Import chokidar
import chalk from "chalk";
import { safeReadFile, safeWriteFile } from "./fileOps.js"; // Import fileOps for safe file handling

const verbose = process.argv.includes("-v"); // Check for -v flag
const testServer = process.argv.includes("-t"); // Check for -t flag

dotenv.config({ path: path.join(process.cwd(), ".env.alpaca") }); // Load environment variables

// Define paths
const tickerFilePath = path.join(process.cwd(), "tickers.json"); // Path for the ticker.json

// Variables
const CHECK_INTERVAL = 20 * 1000;

// Variables
let watcher; // Declare watcher globally
let fileChangeTimeout; // To debounce rapid file changes
let tickersData = {}; // To store tickers with news
let lastProcessedTime = 0; // Variable to track the last processed time

let lastPlayedTime = 0; // Track last playback time
const DEBOUNCE_INTERVAL = 10000; // 10 seconds

// Play WAV sound with debounce and tracking
function playWav(filePath, ticker = "", context = "") {
    const now = Date.now();
    if (now - lastPlayedTime < DEBOUNCE_INTERVAL) {
        return; // Skip playback if within debounce interval
    }

    lastPlayedTime = now; // Update last playback time
    player
        .play({ path: filePath })
        .then(() => {
            logVerbose(`Played sound for ${ticker} (${context}): ${filePath}`);
        })
        .catch((error) => {
            if (verbose) console.error(`Error playing file for ${ticker} (${context}):`, error);
        });
}
// Watch for changes in tickers.json
const startFileWatcher = () => {
    console.log(`Watching for changes in: ${tickerFilePath}`);
    watcher = chokidar.watch(tickerFilePath, { persistent: true });

    watcher.on("change", async () => {
        if (fileChangeTimeout) clearTimeout(fileChangeTimeout);

        // Debounce the file change event
        fileChangeTimeout = setTimeout(async () => {
            console.log(`File changed: ${tickerFilePath}, reprocessing tickers...`);
            await processTickers(); // Process tickers only after debouncing
        }, 500); // Adjust delay if necessary
    });

    watcher.on("error", (error) => console.error(`Watcher error: ${error}`));
};

// Read tickers from the JSON file
const readTickersFromFile = async () => {
    try {
        if (verbose) console.log(`Reading tickers from JSON file: ${tickerFilePath}`);
        tickersData = await safeReadFile(tickerFilePath); // Use safeReadFile
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
        await safeWriteFile(tickerFilePath, tickersData); // Use safeWriteFile for consistency
        startFileWatcher();
    } catch (err) {
        console.error("Error writing to ticker file:", err);
    }
};

// Fetch news for a ticker from the Alpaca API or Test Serve
const getNewsForTicker = async (ticker) => {
    let url;
    const currentTime = new Date();
    const last24Hours = new Date(currentTime - 24 * 60 * 60 * 1000); // 24 hours ago
    const formattedDate = last24Hours.toISOString(); // Format to ISO 8601

    if (testServer) {
        // Test server mode
        url = `http://localhost:3000/v1beta1/news?symbols=${ticker}&start=${formattedDate}`;
    } else {
        // Live API mode
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
        if (verbose) console.log(`Fetching news for ticker: ${ticker} from ${testServer ? "test server" : ""}`);
        const response = await fetch(url, options);

        if (response.ok) {
            const news = await response.json();
            if (verbose) console.log(`Received news for ticker ${ticker}:`, news);
            return news.news || [];
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
        // Skip news where `symbols` array contains more than the ticker
        if (newsItem.symbols.length !== 1 || newsItem.symbols[0] !== ticker) {
            if (verbose) console.log(`Skipping news for ${ticker} due to multiple symbols:`, newsItem.symbols);
            return;
        }

        // List of unwanted keywords (case insensitive, trimmed)
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
        ];

        // Skip news items with unwanted keywords in the headline
        if (newsItem.headline && unwantedKeywords.some((keyword) => newsItem.headline.toLowerCase().trim().includes(keyword.toLowerCase().trim()))) {
            if (verbose) console.log(`Skipping news for ${ticker} due to headline: "${newsItem.headline}"`);
            return;
        }

        // Check if the news item is already present using its ID
        const exists = tickersData[ticker].news.some((existingNews) => existingNews.id === newsItem.id);
        if (!exists) {
            let formattedNews = newsItem.headline; // Initialize formatted news
            tickersData[ticker].news.push({
                ...newsItem,
                added_at: new Date().toISOString(), // Add current timestamp
            });
            console.log(`${ticker}: "${newsItem.headline}"`);

            // Highlight specific keywords and play relevant sounds
            const keywords = ["Offering", "Registered Direct", "Private Placement"];
            if (keywords.some((keyword) => newsItem.headline.includes(keyword))) {
                playWav("./sounds/siren.wav"); // Play siren sound
            } else {
                playWav("./sounds/flash.wav"); // Play flash sound
            }

            newNewsFound = true; // Mark as new news found
            console.log(`Added news for ${ticker}: ${newsItem.headline}`);
        }
    });

    // Set isActive to true if new news was found
    if (newNewsFound) {
        tickersData[ticker].isActive = true;
        console.log(`Ticker ${ticker} is now active due to new news.`);
    }
};

// Collect and process news for tickers
const collectAllNews = async (tickers) => {
    let updatesMade = false; // Track if any updates were made

    for (const ticker of tickers) {
        if (verbose) console.log(`Fetching news for ticker: ${ticker}`);
        const newsData = await getNewsForTicker(ticker); // Fetch news based on mode
        if (newsData && newsData.length > 0) {
            const initialNewsCount = tickersData[ticker]?.news?.length || 0;
            updateTickersWithNews(ticker, newsData);
            if (tickersData[ticker]?.news?.length > initialNewsCount) {
                updatesMade = true; // Mark if new news was added
            }
        } else {
            if (verbose) console.log(`No news found for ticker: ${ticker}`);
        }
    }
    if (updatesMade) {
        await writeTickersToFile(); // Write only if updates were made
    } else if (verbose) {
        console.log("No new updates to write to tickers.json");
    }
};

// Process tickers, fetch news, and print results
const processTickers = async () => {
    const tickersToProcess = await readTickersFromFile(); // Fetch tickers from the new JSON
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

        // Check if at least 60 seconds have passed since the last run
        if (elapsedTime >= CHECK_INTERVAL) {
            await processTickers(); // Process all tickers regularly at the defined interval
            lastProcessedTime = currentTime; // Update the last processed time
        } else {
            if (verbose) console.log(`Skipping tickers processing; only ${elapsedTime / 1000}s since last run.`);
        }
    }, CHECK_INTERVAL);
};

// Start the script
main().catch(console.error);
