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

// Set to keep track of processed news headlines and display all news
let processedNews = new Set();
let allNewsEntries = [];  // Persist all news entries to keep the display
let currentTickers = new Set(); // Track currently processed tickers
let lastHeadlines = {}; // Store last headline for each ticker

// Timestamp for last played alert
let lastAlertTime = 0;  // Initialize as 0 to allow the first sound to play
let startTime = Date.now(); // Record the start time

// Calculate APP_START_TIME based on hours specified in command line
const setAppStartTime = () => {
    const hourArgIndex = process.argv.indexOf('-v') + 1; // Get index of the hour argument after -v
    if (hourArgIndex > 0 && hourArgIndex < process.argv.length) {
        const hoursBack = parseInt(process.argv[hourArgIndex], 10);
        if (!isNaN(hoursBack)) {
            startTime = Date.now() - (hoursBack * 60 * 60 * 1000); // Subtract hours in milliseconds
            console.log(`APP_START_TIME set to ${hoursBack} hours back.`);
        }
    }
};

// Get the current date and time
const getCurrentDate = () => {
    return new Date(startTime).toISOString();
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
    const url = `https://data.alpaca.markets/v1beta1/news?symbols=${ticker}&start=${getCurrentDate()}&limit=50&sort=desc`;

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
                const url = newsItem.url;
                const headline = newsItem.headline || '';

                // Check if the headline is new
                const isUnique = !processedNews.has(headline);
                const color = isUnique ? '\x1b[33m' : '\x1b[37m'; // Yellow for unique, gray for shared
                const starSymbol = '*'; // Representing new headlines with a star

                // Update last headline
                lastHeadlines[ticker] = headline;

                // Only process new news items (skip if already processed for this headline)
                if (isUnique) {
                    newNews.push({ ticker, headline, color }); // Push new news with color
                    processedNews.add(headline);  // Mark this headline as processed
                    allNewsEntries.push({ ticker, headline });  // Add to persistent news list

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

    // Create a new table
    const table = new Table({
        head: ['Ticker', 'News', 'Last Headline'],
        colWidths: [10, 10, 80], // Adjust widths as needed
    });

    currentTickers.forEach(ticker => {
        const newsCount = newsEntries.filter(entry => entry.ticker === ticker).length;
        const lastHeadline = lastHeadlines[ticker] || '';
        const newsSymbol = '*'.repeat(newsCount); // Using star symbols for new headlines
        const rowColor = newsCount > 0 ? '\x1b[43m' : '\x1b[0m'; // Yellow background if there is new news

        table.push([ticker, newsSymbol, lastHeadline].map(item => rowColor + item + '\x1b[0m'));
    });

    if(!VERBOSE) console.clear();  // Clear the console before printing the table
    console.log(table.toString());

    if (VERBOSE) console.log('News entries printed successfully.');
};

// Process tickers, fetch news, and print results
const processTickers = async (tickersToProcess = currentTickers) => {
    if (VERBOSE) console.log(`Processing tickers: ${[...tickersToProcess].join(', ')}`);
    const newNews = await collectAllNews(tickersToProcess);

     printNewsEntries(newNews);
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

    // Set the app start time based on command line arguments
    setAppStartTime();

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
