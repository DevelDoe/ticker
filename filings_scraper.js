import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";
import { safeReadFile, safeWriteFile } from "./fileOps.js";
import player from "node-wav-player";

const verbose = process.argv.includes("-v"); // Enables verbose logging if '-v' flag is passed

// Define paths for key files
const tickerFilePath = path.join(process.cwd(), "tickers.json"); // Path to tickers data
const processedTickersPath = path.join(process.cwd(), "filings-processed_tickers.json"); // Path to processed tickers tracking
const lastWipeFilePath = path.join(process.cwd(), "last-wipe.txt"); // Path to last reset timestamp

// In-memory structures for processed tickers and retries
const processedTickers = new Set(); // Set to track tickers that have already been processed
const retryPool = []; // Array for tickers needing retry attempts due to errors

// Helper function for logging if verbose mode is enabled
const logVerbose = (message) => {
    if (verbose) console.log(`VERBOSE: ${message}`);
};

/**
 * Reads tickers from the tickers.json file.
 */
const readTickersFromFile = async () => {
    try {
        logVerbose(`Reading tickers from ${tickerFilePath}`);
        const data = await safeReadFile(tickerFilePath);
        logVerbose("Tickers file read successfully.");
        return data;
    } catch (err) {
        console.error("Error reading tickers file:", err);
        throw err;
    }
};

/**
 * Fetches S-3 filings for a given ticker symbol from the SEC website.
 */
const scrapeS3Filings = async (ticker) => {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${ticker}`;
    const timeoutDuration = 15000;

    let browser;
    try {
        logVerbose(`Launching browser to fetch filings for ${ticker}`);

        browser = await puppeteer.launch({
            headless: true,
            executablePath: "C:\\chrome-win\\chrome.exe",
            args: ["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0");
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutDuration });
        logVerbose(`Page loaded for ${ticker}`);

        // Delay to prevent rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Scrape S-3 filings data
        const filings = await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".tableFile2 tr"))
                .map((row) => {
                    const cells = row.querySelectorAll("td");
                    if (cells.length > 0) {
                        const formType = cells[0].innerText.trim();
                        const description = cells[2].innerText.trim();
                        const date = cells[3].innerText.trim();
                        if (formType.includes("S-3")) {
                            return { formType, description, date };
                        }
                    }
                    return null;
                })
                .filter((filing) => filing);
        });

        logVerbose(`Fetched ${filings.length} filings for ${ticker}`);
        return filings;
    } catch (error) {
        console.warn(`WARNING: Failed to fetch filings for ${ticker}. Error: ${error.message}`);
        retryPool.push(ticker);
        return null;
    } finally {
        if (browser) await browser.close();
    }
};

/**
 * Updates ticker data in tickers.json with fetched S-3 filings.
 */
const updateTickerInFile = async (ticker, s3Filings, tickersJson) => {
    if (tickersJson[ticker]) {
        tickersJson[ticker].s3Filings = s3Filings;
        logVerbose(`Updated ${ticker} with S-3 filings: ${JSON.stringify(s3Filings)}`);

        await safeWriteFile(tickerFilePath, tickersJson); // Directly pass tickersJson, no need to stringify
        player.play({  path: "./sounds/filings.wav", });
    } else {
        console.log(`Ticker ${ticker} not found in tickers.json. Skipping.`);
    }
};

/**
 * Reads previously processed tickers from the filings-processed_tickers.json file.
 */
const readProcessedTickers = async () => {
    try {
        const wipeTime = await fs.promises.readFile(lastWipeFilePath, "utf8");
        logVerbose(`Last wipe timestamp: ${wipeTime}`);

        if (fs.existsSync(processedTickersPath)) {
            const data = JSON.parse(await fs.promises.readFile(processedTickersPath, "utf8"));
            if (data.lastWipe === wipeTime) {
                logVerbose("Processed tickers file read successfully.");
                return new Set(data.tickers);
            }
        }
        return new Set();
    } catch (err) {
        console.error("Error reading processed tickers file:", err);
        return new Set();
    }
};

/**
 * Writes the set of processed tickers to the filings-processed_tickers.json file.
 */
const writeProcessedTickers = async () => {
    const wipeTime = await fs.promises.readFile(lastWipeFilePath, "utf8");
    const data = { lastWipe: wipeTime, tickers: Array.from(processedTickers) };
    await fs.promises.writeFile(processedTickersPath, JSON.stringify(data, null, 2), "utf8");
    logVerbose(`Successfully wrote processed tickers to ${processedTickersPath}`);
};

/**
 * Processes each new ticker by fetching S-3 filings data and updating tickers.json.
 */
const processNewTickers = async (newTickers, tickersJson) => {
    for (const ticker of newTickers) {
        if (processedTickers.has(ticker)) continue;

        const s3Filings = await scrapeS3Filings(ticker);

        // Always mark the ticker as processed
        processedTickers.add(ticker);
        await writeProcessedTickers();

        if (s3Filings && s3Filings.length > 0) {
            await updateTickerInFile(ticker, s3Filings, tickersJson);
        } else {
            console.log(`No S-3 filings found for ticker ${ticker}. Skipping update.`);
        }
    }
};

/**
 * Main function to coordinate reading, processing, and updating tickers.
 */
const main = async () => {
    logVerbose("Starting the filings process...");

    const tickersJson = await readTickersFromFile();
    const processedTickersSet = await readProcessedTickers();

    const allTickers = Object.keys(tickersJson);
    const newTickers = allTickers.filter((ticker) => !processedTickersSet.has(ticker));

    logVerbose(`Loaded ${newTickers.length} tickers to process.`);
    if (newTickers.length > 0) {
        await processNewTickers(newTickers, tickersJson);
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
                    console.log("Ticker file changed. Processing new tickers after delay...");
                    await main(); // Call the main function to process tickers
                    processing = false;
                }
            }, randomDelay);
        }
    });

    console.log(`Watching for changes in ${tickerFilePath}`);
};

// Start the script and file watcher
main().catch(console.error);
watchFile();
