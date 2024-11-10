import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";
import { safeReadFile, safeWriteFile } from "./fileOps.js";

const verbose = process.argv.includes("-v"); // Check for -t flag

// Define paths
const tickerFilePath = path.join(process.cwd(), "tickers.json");
const processedTickersPath = path.join(process.cwd(), "short-processed_tickers.json");
const lastWipeFilePath = path.join(process.cwd(), "last-wipe.txt");

// Variables
const processedTickers = new Set(); // In-memory storage for processed tickers
const retryPool = []; // Array to hold tickers that need to be retried

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
 * Updates the ticker object in the tickers.json file with new stock data using safeWriteFile.
 */
const updateTickerInFile = async (ticker, stockData, tickersJson) => {
    try {
        if (tickersJson[ticker]) {
            tickersJson[ticker].shorts = stockData;
            console.log(`Updated ${ticker} with shorts data:`, stockData);
        } else {
            console.log(`Ticker ${ticker} not found in tickers.json. Skipping.`);
        }

        // Write updated tickers back to tickers.json safely
        await safeWriteFile(tickerFilePath, tickersJson);
        if (verbose) console.log(`Successfully wrote updated tickers to ${tickerFilePath}.`);
    } catch (error) {
        console.error(`Error updating ticker ${ticker} in file:`, error.message);
        if (verbose) console.log(`Error details: ${error.stack}`);
    }
};

// Watch for changes to tickers.json and process new entries
const watchFile = () => {
    let fileChangeTimeout;
    let processing = false;

    fs.watch(tickerFilePath, async (eventType) => {
        if (eventType === "change") {
            if (fileChangeTimeout) {
                clearTimeout(fileChangeTimeout);
            }

             // Introduce a random delay after file change detection
             const randomDelay = Math.floor(Math.random() * 3000); // Delay up to 3 seconds
             fileChangeTimeout = setTimeout(async () => {
                 if (!processing) {
                     processing = true;
                     console.log('Ticker file changed. Processing new tickers after delay...');
                     await main(); // Call the main function to process tickers
                     processing = false;
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
const fetchStockData = async (ticker) => {
    try {
        if (verbose) console.log(`Fetching stock data for ticker: ${ticker}`);
        const url = `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}&ta=1&p=d&ty=si&b=1`;

        const browser = await puppeteer.launch({
            headless: true,
            executablePath: "C:\\chrome-win\\chrome.exe", // Replace with the actual path to your Chromium/Chrome
            args: ["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0");
        await page.goto(url, { waitUntil: "networkidle2" });

        // Wait for a specific element to load (e.g., the first row of the table)
        try {
            // Delay between requests to avoid overwhelming the server
            // const delay = Math.floor(Math.random() * 60000) + 60000; // Random delay between 180 and 420 seconds
            // if (verbose) console.log(`Delaying next request to avoid server overload for ${delay / 1000} seconds.`);
            // await new Promise((resolve) => setTimeout(resolve, delay)); // Delay before the next request
            // await page.waitForSelector("table.financials-table tbody tr", { timeout: 20000 }); // 10 seconds timeout
        } catch (error) {
            console.error(`Failed to find selector for ticker: ${ticker}. Error: ${error.message}`);
            retryPool.push(ticker); // Add ticker back to retry pool
            await browser.close();
            return null; // Exit if selector not found
        }

        const stockData = await page.evaluate(() => {
            const data = {};
            const table = document.querySelector("table.financials-table");
            if (table) {
                const rows = table.querySelectorAll("tbody tr");
                const labels = ["Settlement Date", "Short Interest", "Avg. Daily Volume", "Short Float", "Short Ratio"];

                // Only fetch data from the first row
                if (rows.length > 0) {
                    const cells = rows[0].querySelectorAll("td"); // Get the first row
                    if (cells.length >= 5) {
                        labels.forEach((label, index) => {
                            let value = cells[index]?.innerText.trim();
                            // Convert placeholders like "-" to null for easier handling
                            value = value === "-" ? null : value;
                            // Parse numeric values with units (e.g., "6.33M")
                            if (value && value.endsWith("M")) {
                                value = parseFloat(value) * 1e6;
                            } else if (value && value.endsWith("K")) {
                                value = parseFloat(value) * 1e3;
                            }
                            data[label] = value;
                        });
                    }
                }
            }
            return data;
        });

        await browser.close();
        return stockData;
    } catch (error) {
        console.error("An error occurred:", error.message);
        if (verbose) console.log(`Error fetching data for ticker: ${ticker} - ${error.message}`);
        return null;
    }
};

/**
 * Processes new tickers by fetching their stock data and updating the tickers.json file.
 *
 * @param {Array<string>} newTickers - An array of ticker symbols that need to be processed.
 * @param {Set<string>} processedTickers - A set of already processed tickers.
 */
const processNewTickers = async (newTickers, processedTickers) => {
    try {
        if (verbose) console.log(`Processing ${newTickers.length} new tickers...`);
        const tickersJson = await readTickersFromFile(); // Read tickers once

        for (const ticker of newTickers) {
            if (verbose) console.log(`Processing stock data for ticker: ${ticker}`);
            const stockData = await fetchStockData(ticker);

            if (stockData) {
                // Handle empty or null fields by setting default values
                Object.keys(stockData).forEach((key) => {
                    if (stockData[key] === "" || stockData[key] === null) {
                        stockData[key] = "N/A"; // Replace empty strings or null with "N/A"
                    }
                });

                await updateTickerInFile(ticker, stockData, tickersJson); // Update tickers.json
                processedTickers.add(ticker); // Add to processed set
                await writeProcessedTickers(processedTickers); // Save processed tickers
            } else {
                if (verbose) console.log(`No stock data returned for ticker: ${ticker}`);
            }
        }
    } catch (error) {
        console.error("Error processing new tickers:", error.message);
    }
};

/**
 * Reads processed tickers from the processed_tickers.json file.
 * If the file doesn't exist or the last-wipe.txt indicates a reset, it will return an empty set.
 *
 * @return {Set<string>} The set of processed tickers.
 */
const readProcessedTickers = async () => {
    try {
        const wipeTime = await fs.promises.readFile(lastWipeFilePath, "utf8");
        if (verbose) console.log(`Last wipe timestamp: ${wipeTime}`);

        if (fs.existsSync(processedTickersPath)) {
            const data = await fs.promises.readFile(processedTickersPath, "utf8");
            const processedTickersData = JSON.parse(data);

            if (processedTickersData.lastWipe === wipeTime) {
                return new Set(processedTickersData.tickers);
            }
        }
        // If no matching wipe time, return an empty set
        return new Set();
    } catch (err) {
        console.error("Error reading processed tickers file:", err);
        return new Set();
    }
};

/**
 * Writes the processed tickers to the processed_tickers.json file.
 *
 * @param {Set<string>} processedTickers - The set of processed tickers.
 */
const writeProcessedTickers = async (processedTickers) => {
    try {
        const wipeTime = await fs.promises.readFile(lastWipeFilePath, "utf8");
        const data = {
            lastWipe: wipeTime,
            tickers: Array.from(processedTickers),
        };
        await fs.promises.writeFile(processedTickersPath, JSON.stringify(data, null, 2), "utf8");
        if (verbose) console.log(`Successfully wrote processed tickers to ${processedTickersPath}`);
    } catch (err) {
        console.error("Error writing processed tickers file:", err);
    }
};

/**
 * Main function to process tickers and set up file watcher
 */
const main = async () => {
    if (verbose) console.log("Starting main process...");

    // Load all tickers from the JSON file
    const tickersJson = await readTickersFromFile();
    const processedTickers = await readProcessedTickers();

    const tickers = Object.keys(tickersJson); // Get all tickers
    const newTickers = tickers.filter((ticker) => !processedTickers.has(ticker)); // Filter out already processed tickers
    if (verbose) console.log(`Loaded ${newTickers.length} tickers to process.`);

    if (newTickers.length > 0) {
        if (verbose) console.log(`Found ${newTickers.length} new tickers to process.`);
        await processNewTickers(newTickers, processedTickers);
    } else {
        if (verbose) console.log("No new tickers to process.");
    }
};

// Start the script and file watcher
main().catch(console.error);
watchFile();
