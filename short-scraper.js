import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";

const verbose = process.argv.includes('-v'); // Check for -t flag

// Define paths 
const tickerFilePath = path.join(process.cwd(), "tickers.json");

// Variables
const processedTickers = new Set(); // In-memory storage for processed tickers

// Helper function to read tickers from JSON file
const readTickersFromFile = async () => {
    try {
        const data = await fs.promises.readFile(tickerFilePath, "utf8");
        return JSON.parse(data); // Return the full object instead of just keys
    } catch (err) {
        console.error("Error reading tickers from file:", err);
        throw err;
    }
};

// Function to fetch stock data
const fetchStockData = async (ticker) => {
    try {
        if(verbose) console.log(`Fetching stock data for ticker: ${ticker}`);
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
        await page.waitForSelector("table.financials-table tbody tr");

        const stockData = await page.evaluate(() => {
            const data = {};
            const table = document.querySelector("table.financials-table");
            if (table) {
                const rows = table.querySelectorAll("tbody tr");
                const labels = [
                    "Settlement Date",
                    "Short Interest",
                    "Avg. Daily Volume",
                    "Short Float",
                    "Short Ratio",
                ];

                // Only fetch data from the first row
                if (rows.length > 0) {
                    const cells = rows[0].querySelectorAll("td"); // Get the first row
                    if (cells.length >= 5) {
                        data[labels[0]] = cells[0]?.innerText.trim();
                        data[labels[1]] = cells[1]?.innerText.trim();
                        data[labels[2]] = cells[2]?.innerText.trim();
                        data[labels[3]] = cells[3]?.innerText.trim();
                        data[labels[4]] = cells[4]?.innerText.trim();
                    }
                }
            }
            return data;
        });

        await browser.close();
        return stockData;
    } catch (error) {
        console.error("An error occurred:", error.message);
        if(verbose) console.log(`Error fetching data for ticker: ${ticker} - ${error.message}`);
        return null;
    }
};

// Function to check if a stock's data is valuable
const isValuableData = (shortFloat, shortRatio) => {
    const shortFloatValue =
        shortFloat &&
        !isNaN(parseFloat(shortFloat.replace("%", "").replace(",", "")))
            ? parseFloat(shortFloat.replace("%", "").replace(",", ""))
            : NaN;
    const shortRatioValue =
        shortRatio && !isNaN(parseFloat(shortRatio))
            ? parseFloat(shortRatio)
            : NaN;

    return shortFloatValue > 10 || shortRatioValue > 5; // Example threshold for valuable data
};

// Function to update the ticker object in the tickers.json
const updateTickerInFile = async (ticker, stockData, tickersJson) => {
    if (tickersJson[ticker]) {
        // Add the shorts field or update if it already exists
        tickersJson[ticker].shorts = stockData; 
        console.log(`Updated ${ticker} with shorts data.`);
    } else {
        console.log(`Ticker ${ticker} not found in tickers.json. Skipping.`);
    }

    // Write updated tickers back to tickers.json
    await fs.promises.writeFile(tickerFilePath, JSON.stringify(tickersJson, null, 2), 'utf8');
};

// Function to process new tickers
const processNewTickers = async (newTickers) => {
    const tickersJson = await readTickersFromFile(); // Read tickers once

    for (const ticker of newTickers) {
        const stockData = await fetchStockData(ticker);

        if (stockData) {
            const shortFloat = stockData['Short Float'];
            const shortRatio = stockData['Short Ratio'];

            if (isValuableData(shortFloat, shortRatio)) {
                await updateTickerInFile(ticker, stockData, tickersJson); // Update tickers.json
            } else {
                if(verbose) console.log(`Ticker ${ticker} does not meet the criteria.`);
            }
        } else {
            if(verbose) console.log(`No stock data returned for ticker: ${ticker}`);
        }
    }

    // Delay between requests to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 6000)); // Wait for 1 second before the next request
};

// Main function to process tickers and set up file watcher
const main = async () => {
    if(verbose) console.log('Starting main process...');

    // Load all tickers from the JSON file
    const tickersJson = await readTickersFromFile(); // Updated call

    const tickers = Object.keys(tickersJson); // Get all tickers
    if(verbose) console.log(`Loaded ${tickers.length} tickers from file.`);

    // Determine new tickers by comparing with processed ones
    const newTickers = tickers.filter(ticker => !processedTickers.has(ticker));
    
    if (newTickers.length > 0) {
        if(verbose) console.log(`Found ${newTickers.length} new tickers to process.`);
        await processNewTickers(newTickers);
        // Update processed tickers set
        newTickers.forEach(ticker => processedTickers.add(ticker));
    } else {
        if(verbose) console.log('No new tickers to process.');
    }
};

// Watch for changes to the ticker.json file and process new entries
const watchFile = () => {
    let fileChangeTimeout;
    let processing = false; // Flag to prevent overlapping processing

    fs.watch(tickerFilePath, async (eventType) => {
        if (eventType === 'change') {
            console.log('Ticker file changed. Processing new tickers...');

            if (fileChangeTimeout) {
                clearTimeout(fileChangeTimeout);
            }

            if (!processing) { // Only proceed if not currently processing
                processing = true;
                fileChangeTimeout = setTimeout(async () => {
                    await main(); // Call the main function to process tickers
                    processing = false; // Reset the processing flag
                }, 5000); // Debounce file changes
            }
        }
    });

    console.log(`Watching for changes in ${tickerFilePath}`);
};

// Start the script and file watcher
main().catch(console.error);
watchFile();
