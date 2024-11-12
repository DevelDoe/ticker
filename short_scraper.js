import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { safeReadFile, safeWriteFile } from "./fileOps.js";

puppeteer.use(StealthPlugin()); // Enable stealth mode

const verbose = process.argv.includes("-v"); // Check for -t flag

// Define paths
const tickerFilePath = path.join(process.cwd(), "tickers.json");
const shortsFilePath = path.join(process.cwd(), "shorts.json");

// Variables
const processedTickers = new Set(); // In-memory storage for processed tickers
const retryPool = []; // Array to hold tickers that need to be retried
let isProcessing = false;

/**
 * Reads tickers from the tickers.json file using safeReadFile.
 */
const readTickersFromFile = async () => {
    try {
        if (verbose) console.log(`Attempting to read tickers from ${tickerFilePath}`);
        let data = await safeReadFile(tickerFilePath);

        // Check if `data` is already an object
        if (typeof data === "object") {
            if (verbose) console.log("Tickers data is already parsed as an object.");
            return data;
        } else if (typeof data === "string") {
            if (verbose) console.log("Parsing tickers data from JSON string.");
            return JSON.parse(data);
        } else {
            throw new Error("Unexpected data type returned from safeReadFile.");
        }
    } catch (err) {
        console.error("Error reading tickers from file:", err);
        throw err;
    }
};

/**
 * Updates the ticker object in shorts.json with new stock data using safeWriteFile,
 * but only if the stock data contains valid entries.
 */
const updateShortsInFile = async (ticker, stockData, shortsJson) => {
    try {
        // Check if stockData has meaningful data
        if (Object.keys(stockData).length > 0 && Object.values(stockData).some((value) => value !== "N/A")) {
            shortsJson[ticker] = stockData; // Add or update the shorts data
            await safeWriteFile(shortsFilePath, shortsJson);
            if (verbose) console.log(`Successfully wrote updated shorts data for ${ticker} to ${shortsFilePath}.`);
        } else {
            if (verbose) console.log(`No valid data for ${ticker}. Skipping write to ${shortsFilePath}.`);
        }
    } catch (error) {
        console.error(`Error updating shorts data for ${ticker}:`, error.message);
    }
};

// Watch for changes to tickers.json and process new entries
const watchFile = () => {
    let fileChangeTimeout;

    // Watch only tickers.json for changes
    fs.watch(tickerFilePath, async (eventType) => {
        if (eventType === "change" && !isProcessing) {
            // Check the processing flag
            if (fileChangeTimeout) {
                clearTimeout(fileChangeTimeout);
            }

            // Add a debounce delay to prevent quick successive processing
            const randomDelay = Math.floor(Math.random() * 3000) + 2000; // 2-5 second delay
            fileChangeTimeout = setTimeout(async () => {
                if (!isProcessing) {
                    // Double-check the flag before starting
                    isProcessing = true;
                    console.log("tickers.json file changed. Processing new tickers after delay...");
                    await main(); // Call main function to process tickers
                    isProcessing = false; // Reset flag after processing
                }
            }, randomDelay);
        }
    });

    console.log(`Watching for changes in ${tickerFilePath}`);
};

/**
 * Fetches stock data for a given ticker.
 *
 * This function navigates to the stock's page on Finviz, scrapes relevant data
 * from the stock's financial table, and returns the extracted data. It uses
 * Puppeteer to open a headless browser and scrape the content.
 *
 * @param {string} ticker - The stock ticker symbol to fetch data for.
 * @return {Object|null} An object containing the stock data (short float, short ratio, etc.), or null if fetching failed.
 * @throws Will log an error and return null if fetching data fails.
 */
const fetchStockData = async (ticker, attempt = 1) => {
    let browser;
    try {
        // Random delay between requests to avoid bot detection
        const delay = Math.floor(Math.random() * 10000) + 10000; // 10-20 seconds delay
        if (verbose) console.log(`Delaying request for ${ticker} by ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay)); // Delay before fetching data

        if (verbose) console.log(`Fetching stock data for ticker: ${ticker} (Attempt ${attempt})`);
        const url = `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}&ta=1&p=d&ty=si&b=1`;

        browser = await puppeteer.launch({
            headless: true,
            executablePath: "C:\\chrome-win\\chrome.exe", // Replace with your Chromium/Chrome path
            args: ["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0");

        const response = await page.goto(url, { waitUntil: "networkidle2" });
        if (!response || !response.ok()) {
            console.error(`Failed to load page for ${ticker}. Status: ${response ? response.status() : "No response"}`);
            
            // If rate-limited, retry with backoff
            if (response && response.status() === 429) {
                if (attempt <= 3) { // Retry up to 3 times
                    const retryDelay = Math.min(20000 * attempt, 60000); // 20s, 40s, then max 60s
                    console.log(`Rate limited for ${ticker}. Retrying in ${retryDelay / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    return await fetchStockData(ticker, attempt + 1); // Retry with incremented attempt
                } else {
                    console.error(`Max retries reached for ${ticker}. Skipping...`);
                    return null;
                }
            }

            return null;
        }

        if (verbose) console.log(`Successfully loaded page for ${ticker} - Status: ${response.status()}`);

        const tableExists = await page.$("table.financials-table");
        if (!tableExists) {
            console.warn(`No data table found on page for ticker: ${ticker}`);
            return null;
        }

        const stockData = await page.evaluate(() => {
            const data = {};
            const table = document.querySelector("table.financials-table");

            if (!table) return null;

            const rows = table.querySelectorAll("tbody tr");
            const labels = ["Settlement Date", "Short Interest", "Avg. Daily Volume", "Short Float", "Short Ratio"];

            if (rows.length > 0) {
                const cells = rows[0].querySelectorAll("td");
                if (cells.length >= labels.length) {
                    labels.forEach((label, index) => {
                        let value = cells[index]?.innerText.trim();
                        value = value === "-" ? null : value;
                        if (value && typeof value === "string" && value.endsWith("M")) value = parseFloat(value) * 1e6;
                        if (value && typeof value === "string" && value.endsWith("K")) value = parseFloat(value) * 1e3;
                        data[label] = value || "N/A";
                    });
                }
            }
            return data;
        });

        if (verbose && stockData) console.log(`Extracted data for ${ticker}:`, stockData);

        return stockData || null;

    } catch (error) {
        console.error(`An error occurred while fetching data for ticker ${ticker}: ${error.message}`);
        if (verbose) console.log(`Detailed error for ${ticker}: ${error.stack}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
};


const readShortsFile = async () => {
    try {
        let shortsJson = await safeReadFile(shortsFilePath);

        // If shortsJson is null or undefined, initialize it as an empty object
        if (!shortsJson) {
            if (verbose) console.log(`${shortsFilePath} not found or empty. Initializing as empty object.`);
            shortsJson = {};
        }

        // If `shortsJson` is a string, parse it as JSON
        if (typeof shortsJson === "string") {
            shortsJson = JSON.parse(shortsJson);
        }

        return shortsJson;
    } catch (error) {
        console.error(`Error reading ${shortsFilePath}:`, error.message);
        if (verbose) console.log(`Returning empty object as fallback for ${shortsFilePath}.`);
        return {}; // Fallback to an empty object if there's an error
    }
};

/**
 * Processes new tickers by fetching their stock data and updating the shorts.json file.
 *
 * @param {Array<string>} newTickers - An array of ticker symbols that need to be processed.
 */
const processNewTickers = async (newTickers) => {
    try {
        if (verbose) console.log(`Processing ${newTickers.length} new tickers...`);
        const tickersJson = await readTickersFromFile();
        let shortsJson = await readShortsFile();

        for (const ticker of newTickers) {
            if (processedTickers.has(ticker)) continue; // Skip if already processed
            if (verbose) console.log(`Processing stock data for ticker: ${ticker}`);

            const stockData = await fetchStockData(ticker);
            if (stockData) {
                // Filter out invalid entries (e.g., empty strings or null values)
                Object.keys(stockData).forEach((key) => {
                    if (!stockData[key] || stockData[key] === "") {
                        stockData[key] = "N/A";
                    }
                });

                await updateShortsInFile(ticker, stockData, shortsJson); // Write to shorts.json only if there's valid data
                processedTickers.add(ticker); // Mark as processed in memory
            } else {
                if (verbose) console.log(`No stock data returned for ticker: ${ticker}`);
            }
        }
    } catch (error) {
        console.error("Error processing new tickers:", error.message);
    }
};

const processRetryPool = async () => {
    if (retryPool.length === 0) return; // Skip if empty
    if (verbose) console.log(`Processing retry pool with ${retryPool.length} tickers...`);

    const results = await Promise.allSettled(
        retryPool.map(async (ticker) => {
            try {
                const stockData = await fetchStockData(ticker);
                if (stockData) {
                    await updateShortsInFile(ticker, stockData, await readShortsFile());
                    retryPool.splice(retryPool.indexOf(ticker), 1); // Remove ticker from retry pool
                } else {
                    throw new Error(`No data returned for ticker: ${ticker}`);
                }
            } catch (error) {
                console.error(`Failed to process ticker ${ticker} in retry pool: ${error.message}`);
            }
        })
    );

    // Post-processing logging for any rejected promises
    results.forEach((result, index) => {
        const ticker = retryPool[index];
        if (result.status === "rejected") {
            console.error(`Error processing ticker ${ticker}: ${result.reason}`);
        }
    });

    if (verbose) console.log("Retry pool processed.");
};

/**
 * Main function to process tickers and set up file watcher
 */
const main = async () => {
    if (verbose) console.log("Starting main process...");

    // Load tickers from tickers.json
    const tickersJson = await readTickersFromFile();
    const tickers = Object.keys(tickersJson);

    // Filter to only new tickers not already processed
    const newTickers = tickers.filter((ticker) => !processedTickers.has(ticker));
    if (verbose) console.log(`Loaded ${newTickers.length} tickers to process.`);

    if (newTickers.length > 0) {
        if (verbose) console.log(`Found ${newTickers.length} new tickers to process.`);
        await processNewTickers(newTickers);
        await processRetryPool();
    } else {
        if (verbose) console.log("No new tickers to process.");
    }
};

// Start the script and file watcher
main().catch(console.error);
watchFile();
