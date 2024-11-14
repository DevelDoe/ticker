import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { safeReadFile, safeWriteFile } from "./fileOps.js";

puppeteer.use(StealthPlugin());

const verbose = process.argv.includes("-v");

const tickerFilePath = path.join(process.cwd(), "tickers.json");
const filingsFilePath = path.join(process.cwd(), "filings.json");

const processedTickers = new Set();
const retryPool = [];
let isProcessing = false;

const logVerbose = (message) => {
    if (verbose) console.log(`VERBOSE: ${message}`);
};

// New logging function for non-verbose mode
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

const readFilingsFile = async () => {
    try {
        let filingsData = await safeReadFile(filingsFilePath);
        if (!filingsData) filingsData = {};
        return typeof filingsData === "object" ? filingsData : JSON.parse(filingsData);
    } catch (error) {
        console.error(`Error reading ${filingsFilePath}:`, error.message);
        return {};
    }
};

const fetchFilingsData = async (ticker, attempt = 1) => {
    let browser;
    try {
        const delay = Math.floor(Math.random() * 5000) + 2000;
        await new Promise(resolve => setTimeout(resolve, delay));

        logVerbose(`Fetching filings for ${ticker} (Attempt ${attempt})`);
        logStatus(`Checking filings for ${ticker}...`);
        
        const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${ticker}`;
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: "C:\\chrome-win\\chrome.exe",
            args: ["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();
        const response = await page.goto(url, { waitUntil: "domcontentloaded" });
        if (!response || !response.ok()) {
            logStatus(`Failed to load page for ${ticker} (Attempt ${attempt})`);
            if (attempt <= 3 && response.status() === 429) {
                retryPool.push(ticker);
                return null;
            }
            return null;
        }

        logVerbose(`Page loaded for ${ticker} - Status: ${response.status()}`);
        
        const filings = await page.evaluate(() => {
            return Array.from(document.querySelectorAll(".tableFile2 tr"))
                .map((row) => {
                    const cells = row.querySelectorAll("td");
                    if (cells.length > 0 && cells[0].innerText.includes("S-3")) {
                        return { formType: cells[0].innerText, description: cells[2].innerText, date: cells[3].innerText };
                    }
                    return null;
                })
                .filter((filing) => filing);
        });

        return filings || null;

    } catch (error) {
        console.error(`Error fetching filings for ${ticker}: ${error.message}`);
        if (attempt <= 3) retryPool.push(ticker);
        return null;
    } finally {
        if (browser) await browser.close();
    }
};

const updateFilingsInFile = async (ticker, filingsData, filingsJson) => {
    try {
        if (filingsData && filingsData.length > 0) {
            filingsJson[ticker] = filingsData;
            await safeWriteFile(filingsFilePath, filingsJson);
            logVerbose(`Successfully wrote filings for ${ticker} to ${filingsFilePath}`);
            logStatus(`Updated filings for ${ticker}`);
        } else {
            logVerbose(`No new filings data for ${ticker}`);
            logStatus(`No updates needed for ${ticker}`);
        }
    } catch (error) {
        console.error(`Error updating filings for ${ticker}:`, error.message);
    }
};

const processNewTickers = async () => {
    const tickers = await readTickersFromFile();
    const filingsJson = await readFilingsFile();
    const newTickers = Object.keys(tickers).filter(ticker => !processedTickers.has(ticker));

    for (const ticker of newTickers) {
        const filingsData = await fetchFilingsData(ticker);
        processedTickers.add(ticker);
        if (filingsData) await updateFilingsInFile(ticker, filingsData, filingsJson);
    }
    logStatus("Completed processing new tickers.");
};

const retryFailedTickers = async () => {
    if (retryPool.length === 0) return;
    logVerbose(`Retrying ${retryPool.length} tickers from retry pool`);
    logStatus(`Retrying failed tickers...`);

    const filingsJson = await readFilingsFile();
    for (const ticker of retryPool) {
        const filingsData = await fetchFilingsData(ticker);
        if (filingsData) {
            await updateFilingsInFile(ticker, filingsData, filingsJson);
            retryPool.splice(retryPool.indexOf(ticker), 1);
        }
    }
    logStatus("Completed retrying failed tickers.");
};

const main = async () => {
    if (verbose) logVerbose("Starting filings scraper...");
    logStatus("Starting filings processing...");
    await processNewTickers();
    await retryFailedTickers();
    logStatus("Filings processing completed.");
};

const watchFile = () => {
    let fileChangeTimeout;
    fs.watch(tickerFilePath, async (eventType) => {
        if (eventType === "change" && !isProcessing) {
            if (fileChangeTimeout) clearTimeout(fileChangeTimeout);
            fileChangeTimeout = setTimeout(async () => {
                isProcessing = true;
                console.log("Detected changes in tickers.json. Reprocessing tickers...");
                await main();
                isProcessing = false;
            }, Math.floor(Math.random() * 3000) + 2000);
        }
    });
    console.log(`Watching for changes in ${tickerFilePath}`);
};

main().catch(console.error);
watchFile();
