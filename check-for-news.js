import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import player from 'node-wav-player';
import chokidar from 'chokidar'; // Import chokidar
import { safeReadFile, safeWriteFile } from './fileOps.js'; // Import fileOps for safe file handling


const verbose = process.argv.includes('-v'); // Check for -v flag
const testServer = process.argv.includes('-t'); // Check for -t flag

dotenv.config({ path: path.join(process.cwd(), '.env.alpaca') }); // Load environment variables

// Define paths 
const tickerFilePath = path.join(process.cwd(), 'tickers.json'); // Path for the ticker.json

// Variables
const CHECK_INTERVAL_MS = 1 * 10 * 1000;

// Variables
let watcher; // Declare watcher globally
let fileChangeTimeout; // To debounce rapid file changes
let tickersData = {}; // To store tickers with news
let lastProcessedTime = 0; // Variable to track the last processed time

const playAlert = debounce(async () => {
    try {
        await player.play({
            path: './sounds/flash.wav', // Path to your audio file
        });
        if (verbose) console.log('Playing audio alert...');
    } catch (error) {
        console.error('Error playing audio alert:', error);
    }
});

function debounce(func, timeout = 3000) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

// Watch for changes in tickers.json
const startFileWatcher = () => {
    console.log(`Watching for changes in: ${tickerFilePath}`);
    watcher = chokidar.watch(tickerFilePath, { persistent: true });

    watcher.on('change', async () => {
        if (fileChangeTimeout) clearTimeout(fileChangeTimeout);

        // Debounce the file change event
        fileChangeTimeout = setTimeout(async () => {
            console.log(`File changed: ${tickerFilePath}, reprocessing tickers...`);
            await processTickers(); // Process tickers only after debouncing
        }, 500); // Adjust delay if necessary
    });

    watcher.on('error', error => console.error(`Watcher error: ${error}`));
};

// Read tickers from the JSON file
const readTickersFromFile = async () => {
    try {
        if (verbose) console.log(`Reading tickers from JSON file: ${tickerFilePath}`);
        tickersData = await safeReadFile(tickerFilePath); // Use safeReadFile
        const tickerSymbols = Object.keys(tickersData);
        console.log(`Tickers found: ${tickerSymbols.join(', ')}`);
        return tickerSymbols;
    } catch (err) {
        console.error('Error reading ticker file:', err);
        return [];
    }
};

const writeTickersToFile = async () => {
    try {
        if (verbose) console.log('Pausing watcher for safe write operation...');
        await watcher.close();
        await safeWriteFile(tickerFilePath, tickersData); // Use safeWriteFile for consistency
        startFileWatcher();
    } catch (err) {
        console.error('Error writing to ticker file:', err);
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
        method: 'GET',
        headers: {
            accept: 'application/json',
            'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
            'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY,
        },
    };

    try {
        if (verbose) console.log(`Fetching news for ticker: ${ticker} from ${testServer ? 'test server' : ''}`);
        const response = await fetch(url, options);

        if (response.ok) {
            const news = await response.json();
            if (verbose) console.log(`Received news for ticker ${ticker}:`, news);
            return news.news || [];
        } else {
            const text = await response.text();
            console.error('API request failed:', response.status, text);
            return [];
        }
    } catch (error) {
        console.error('Error fetching news:', error.message);
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

    news.forEach(newsItem => {
        // Filter out news where the `symbols` array contains more than just the ticker
        if (newsItem.symbols.length !== 1 || newsItem.symbols[0] !== ticker) {
            if(verbose) console.log(`Skipping news for ticker ${ticker} because it includes multiple symbols:`, newsItem.symbols);
            return; // Skip if there are other symbols besides the ticker
        }

         // Skip news items with the phrase "Shares Resume Trade" in the headline
         if (newsItem.headline && newsItem.headline.includes("Shares Resume Trade")) {
            if (verbose) console.log(`Skipping news for ticker ${ticker} due to headline: "${newsItem.headline}"`);
            return;
        }

        // Check if the news item is already present using its ID
        const exists = tickersData[ticker].news.some(existingNews => existingNews.id === newsItem.id);
        if (!exists) {
            tickersData[ticker].news.push({
                ...newsItem,
                added_at: new Date().toISOString(), // Add current timestamp
            });
            playAlert(); // Call the debounced audio alert
            newNewsFound = true; // Mark as new news found
            console.log(`Added news for ticker ${ticker}: ${newsItem.headline}`);
        } else {
            console.log(`${ticker}: ${newsItem.headline}`);
            
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
    if (verbose) console.log('Starting main function...');
    startFileWatcher(); // Start watching the file
    await processTickers(); // Process tickers immediately on start
    lastProcessedTime = Date.now(); // Set initial processed time

    setInterval(async () => {
        const currentTime = Date.now();
        const elapsedTime = currentTime - lastProcessedTime;

        // Check if at least 60 seconds have passed since the last run
        if (elapsedTime >= CHECK_INTERVAL_MS) {
            await processTickers(); // Process all tickers regularly at the defined interval
            lastProcessedTime = currentTime; // Update the last processed time
        } else {
            if (verbose) console.log(`Skipping tickers processing; only ${elapsedTime / 1000}s since last run.`);
        }
    }, CHECK_INTERVAL_MS);
};

// Start the script
main().catch(console.error);
