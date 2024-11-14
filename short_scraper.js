import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { safeReadFile, safeWriteFile } from "./fileOps.js";

puppeteer.use(StealthPlugin()); // Enable stealth mode

const verbose = process.argv.includes("-v"); // Check for -v flag

// Define paths
const tickerFilePath = path.join(process.cwd(), "tickers.json");
const shortsFilePath = path.join(process.cwd(), "shorts.json");

// Variables
const processedTickers = new Set();
const retryPool = [];
let isProcessing = false;

/**
 * Log verbose messages only when the -v flag is enabled.
 */
const logVerbose = (message) => {
    if (verbose) console.log(`VERBOSE: ${message}`);
};

/**
 * Log non-verbose status updates for general progress information.
 */
const logStatus = (message) => {
    if (!verbose) console.log(message);
};

const readTickersFromFile = async () => {
    try {
        logStatus("Reading tickers...");
        const data = await safeReadFile(tickerFilePath);
        return typeof data === "object" ? data : JSON.parse(data);
    } catch (err) {
        console.error("Error reading tickers file:", err);
        throw err;
    }
};

const updateShortsInFile = async (ticker, stockData, shortsJson) => {
    try {
        if (Object.keys(stockData).length > 0 && Object.values(stockData).some((value) => value !== "N/A")) {
            shortsJson[ticker] = stockData;
            await safeWriteFile(shortsFilePath, shortsJson);
            logStatus(`Updated shorts data for ${ticker}`);
            logVerbose(`Successfully wrote updated shorts data for ${ticker} to ${shortsFilePath}`);
        } else {
            logVerbose(`No valid data for ${ticker}. Skipping write.`);
            logStatus(`No update needed for ${ticker}`);
        }
    } catch (error) {
        console.error(`Error updating shorts data for ${ticker}:`, error.message);
    }
};

const watchFile = () => {
    let fileChangeTimeout;

    fs.watch(tickerFilePath, async (eventType) => {
        if (eventType === "change" && !isProcessing) {
            if (fileChangeTimeout) clearTimeout(fileChangeTimeout);
            const randomDelay = Math.floor(Math.random() * 3000) + 2000;
            fileChangeTimeout = setTimeout(async () => {
                isProcessing = true;
                console.log("Detected changes in tickers.json. Processing tickers...");
                await main();
                isProcessing = false;
            }, randomDelay);
        }
    });
    console.log(`Watching for changes in ${tickerFilePath}`);
};

const fetchStockData = async (ticker, attempt = 1) => {
    let browser;
    try {
        const delay = Math.floor(Math.random() * 10000) + 10000;
        logStatus(`Fetching data for ${ticker}...`);
        logVerbose(`Delaying request by ${delay / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, delay));

        const url = `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}&ta=1&p=d&ty=si&b=1`;
        browser = await puppeteer.launch({
            headless: true,
            executablePath: "C:\\chrome-win\\chrome.exe",
            args: ["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0");

        const response = await page.goto(url, { waitUntil: "networkidle2" });
        if (!response || !response.ok()) {
            console.error(`Failed to load page for ${ticker}. Status: ${response ? response.status() : "No response"}`);
            if (response && response.status() === 429 && attempt <= 3) {
                const retryDelay = Math.min(20000 * attempt, 60000);
                console.log(`Rate limited for ${ticker}. Retrying in ${retryDelay / 1000} seconds...`);
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
                return await fetchStockData(ticker, attempt + 1);
            }
            return null;
        }

        const stockData = await page.evaluate(() => {
            const data = {};
            const table = document.querySelector("table.financials-table");
            if (!table) return null;

            const rows = table.querySelectorAll("tbody tr");
            const labels = ["Settlement Date", "Short Interest", "Avg. Daily Volume", "Short Float", "Short Ratio"];
            const cells = rows[0]?.querySelectorAll("td") || []; // Ensure cells array is defined

            labels.forEach((label, index) => {
                let value = cells[index]?.innerText?.trim() ?? "N/A"; // Default to "N/A" if undefined or null

                // Convert value if it's a valid string with "M" or "K" suffix
                if (typeof value === "string") {
                    if (value.endsWith("M")) {
                        value = parseFloat(value) * 1e6;
                    } else if (value.endsWith("K")) {
                        value = parseFloat(value) * 1e3;
                    } else if (value === "-") {
                        value = null; // Convert "-" to null for consistency
                    }
                } else {
                    value = "N/A"; // Assign "N/A" if value is not a string
                }

                data[label] = value ?? "N/A"; // Fallback to "N/A" if value is null or undefined
            });

            return data;
        });

        logStatus(`Data fetched for ${ticker}`);
        logVerbose(`Extracted data for ${ticker}: ${JSON.stringify(stockData)}`);
        return stockData || null;
    } catch (error) {
        console.error(`Error fetching data for ${ticker}: ${error.message}`);
        logVerbose(`Detailed error for ${ticker}: ${error.stack}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
};

const readShortsFile = async () => {
    try {
        let shortsJson = (await safeReadFile(shortsFilePath)) || {};
        return typeof shortsJson === "string" ? JSON.parse(shortsJson) : shortsJson;
    } catch (error) {
        console.error(`Error reading ${shortsFilePath}:`, error.message);
        return {};
    }
};

const processNewTickers = async (newTickers) => {
    logStatus(`Processing ${newTickers.length} tickers...`);
    const shortsJson = await readShortsFile();

    for (const ticker of newTickers) {
        if (processedTickers.has(ticker)) continue;
        const stockData = await fetchStockData(ticker);
        if (stockData) {
            Object.keys(stockData).forEach((key) => {
                if (!stockData[key]) stockData[key] = "N/A";
            });
            await updateShortsInFile(ticker, stockData, shortsJson);
            processedTickers.add(ticker);
        }
    }
    logStatus("Tickers processing completed.");
};

const processRetryPool = async () => {
    if (retryPool.length === 0) return;
    logStatus(`Retrying ${retryPool.length} tickers...`);

    for (const ticker of retryPool) {
        const stockData = await fetchStockData(ticker);
        if (stockData) {
            await updateShortsInFile(ticker, stockData, await readShortsFile());
            retryPool.splice(retryPool.indexOf(ticker), 1);
        }
    }
    logStatus("Retry pool processing completed.");
};

const main = async () => {
    logStatus("Starting main process...");
    const tickersJson = await readTickersFromFile();
    const newTickers = Object.keys(tickersJson).filter((ticker) => !processedTickers.has(ticker));
    logStatus(newTickers.length ? `Found ${newTickers.length} new tickers.` : "No new tickers to process.");

    if (newTickers.length > 0) {
        await processNewTickers(newTickers);
        await processRetryPool();
    }
    logStatus("Main process completed.");
};

// Start the script and file watcher
main().catch(console.error);
watchFile();
