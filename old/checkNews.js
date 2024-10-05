import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import Table from 'cli-table3';
import wavPlayer from 'node-wav-player'; // Import node-wav-player

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.alpaca') });

// Determine the current working directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the current working directory for file paths
const tickerFilePath = path.join(process.cwd(), 'ticker.txt');
const alertSoundPath = path.join(__dirname, 'flash.wav'); // Path to your alert sound

// Configuration
const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const SOUND_COOLDOWN_MS = 60 * 1000; // Debounce period (1 minute)
const VERBOSE = process.argv.includes('-v');
const APP_START_TIME = new Date().toISOString();

// Set to keep track of processed news headlines and display all news
let processedNews = new Set();
let allNewsEntries = [];  // Persist all news entries to keep the display
let currentTickers = new Set(); // Track currently processed tickers

// Timestamp for last played alert
let lastAlertTime = 0;  // Initialize as 0 to allow the first sound to play immediately

// Get the date range from the application start time to the current time
const getRealTimeDateRange = () => {
    const end = new Date();  // Current time
    return {
        start: APP_START_TIME,  // Use the app start time as the beginning of the range
        end: end.toISOString(), // Use current time as the end of the range
    };
};


// Read tickers from the file
const readTickersFromFile = async () => {
    try {
        if (VERBOSE) console.log(`Reading tickers from file: ${tickerFilePath}`);
        const data = await fs.readFile(tickerFilePath, 'utf8');
        const lines = data.trim().split('\n').filter(line => line.trim() !== '');
        if (VERBOSE) console.log(`Tickers found: ${lines.join(', ')}`);
        return new Set(lines); // Use a Set to avoid duplicate entries
    } catch (err) {
        console.error('Error reading ticker file:', err);
        return new Set();
    }
};

// Fetch news for a ticker using Fetch API
const getNews = async (ticker) => {
    const { start, end } = getRealTimeDateRange(); // Use real-time date range now
    const url = `https://data.alpaca.markets/v1beta1/news?symbols=${ticker}&start=${start}&end=${end}&limit=50&sort=desc`;

    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
            'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY,
        },
    };

    try {
        if (VERBOSE) console.log(`Fetching news for ticker: ${ticker}`);
        const response = await fetch(url, options);

        if (response.ok) {
            const news = await response.json();
            if (VERBOSE) console.log(`Received news for ticker ${ticker}:`, news);
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


// Play an alert sound if enough time has passed since the last alert
const playAlertSound = async () => {
    const now = Date.now();

    // Check if enough time has passed since the last alert
    if (now - lastAlertTime >= SOUND_COOLDOWN_MS) {
        try {
            if (VERBOSE) console.log('Playing alert sound...');
            await wavPlayer.play({ path: alertSoundPath });
            lastAlertTime = now;  // Update the timestamp for the last played alert
        } catch (error) {
            console.error('Error playing alert sound:', error);
        }
    } else {
        if (VERBOSE) console.log('Skipping alert sound (debounced).');
    }
};

// Collect and process news for tickers
const collectAllNews = async (tickers) => {
    const newNews = [];

    if (VERBOSE) console.log(`Collecting news for tickers: ${[...tickers].join(', ')}`);

    for (const ticker of tickers) {
        if (VERBOSE) console.log(`Processing news for ticker: ${ticker}`);
        const newsData = await getNews(ticker);
        if (newsData && newsData.length > 0) {
            newsData.forEach(newsItem => {
                const headline = newsItem.headline || 'No headline available';
                const url = newsItem.url;
                const timestamp = newsItem.created_at ? new Date(newsItem.created_at) : null;

                if (!timestamp || isNaN(timestamp.getTime())) {
                    if (VERBOSE) console.error('Invalid timestamp:', newsItem.created_at);
                    return;
                }

                // Create a unique key for each ticker-headline combination
                const uniqueKey = `${ticker}-${headline}`;

                // Only process new news items (skip if already processed for this ticker-headline combination)
                if (!processedNews.has(uniqueKey)) {
                    const newsEntry = {
                        time: timestamp,
                        ticker: ticker,
                        headline: headline,
                    };

                    newNews.push(newsEntry);
                    processedNews.add(uniqueKey);  // Mark this ticker-headline combination as processed
                    allNewsEntries.push(newsEntry);  // Add to persistent news list

                    if (VERBOSE) console.log(`New news entry added: ${headline} for ticker: ${ticker}`);
                }
            });

            // Play sound alert for the batch of new news, but only once
            if (newNews.length > 0) {
                await playAlertSound();  // Ensure the sound is played only once per debounce period
            }
        } else {
            if (VERBOSE) console.log(`No news found for ticker: ${ticker}`);
        }
    }

    return newNews;
};


// Print the news entries in a table
const printNewsEntries = (newsEntries) => {
    if (VERBOSE) console.log('Preparing to print news entries...');

    if (allNewsEntries.length === 0) {
        console.clear()
        console.log('No new news entries found');
        return;
    }

    // Sort news entries from oldest to newest
    allNewsEntries.sort((a, b) => a.time - b.time);

    // Create a new table
    const table = new Table({
        head: ['Time', 'Ticker', 'Headline'],
        colWidths: [22, 7, 93], // Adjust widths as needed
    });

    allNewsEntries.forEach(entry => {
        const time = entry.time.toISOString().replace('T', ' ').replace(/\..+/, ''); // Format time
        table.push([time, entry.ticker, entry.headline]);
    });

    console.clear();  // Only clear if we have something to print
    console.log(table.toString());

    if (VERBOSE) console.log('News entries printed successfully.');
};

// Process tickers, fetch news, and print results
const processTickers = async (tickersToProcess = currentTickers) => {
    if (VERBOSE) console.log(`Processing tickers: ${[...tickersToProcess].join(', ')}`);
    const newNews = await collectAllNews(tickersToProcess);

    if (newNews.length === 0 && allNewsEntries.length === 0) {
        console.clear()
        console.log('No new news entries found');
    } else if (newNews.length === 0) {
        if (VERBOSE) console.log('No new news entries, but there are existing ones.');
    } else {
        printNewsEntries(newNews);
    }
};

// Watch for changes to the ticker.txt file and process new tickers
const watchFile = () => {
    fsSync.watch(tickerFilePath, async (eventType) => {
        if (eventType === 'change') {
            const newTickers = await readTickersFromFile();
            const addedTickers = [...newTickers].filter(ticker => !currentTickers.has(ticker));

            if (addedTickers.length > 0) {
                currentTickers = new Set([...currentTickers, ...addedTickers]); // Update current tickers set with new ones
                await processTickers(new Set(addedTickers)); // Process only the newly added tickers
            }
        }
    });

    if (VERBOSE) console.log(`Watching for changes in ${tickerFilePath}`);
};

// Main function to run the script every interval
const main = async () => {
    if (VERBOSE) console.log('Starting main function...');

    // Initial read and processing
    currentTickers = await readTickersFromFile();
    await processTickers(currentTickers);

    // Set interval to process all tickers periodically (every 60 seconds)
    setInterval(async () => {
        await processTickers(currentTickers); // Process all tickers regularly
    }, CHECK_INTERVAL_MS);
};

// Start the script and file watcher
main().catch(console.error);
watchFile();
