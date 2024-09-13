import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch'; // Ensure you have node-fetch installed
import debounce from 'lodash.debounce';
import chalk from 'chalk';
import readline from 'readline';
import open from 'open';

// Load environment variables
dotenv.config({ path: '.env.alpaca' });

// Determine the current working directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the current working directory for file paths
const tickerFilePath = path.join(process.cwd(), 'ticker.txt');

// Initialize currentTicker
let currentTicker = '';

// Get the date range for the past 24 hours
function getPast24HoursDateRange() {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000); // Subtract 24 hours

    return {
        start: start.toISOString(),
        end: end.toISOString(),
    };
}

// Read ticker from file
function readTickerFromFile() {
    return new Promise((resolve, reject) => {
        fs.readFile(tickerFilePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data.trim());
            }
        });
    });
}

// Fetch news for a ticker using Fetch API
async function getNews(ticker) {
    const now = new Date();
    const end = now.toISOString();
    
    // Calculate start time (16 hours back)
    const start = new Date(now.getTime() - (16 * 60 * 60 * 1000)).toISOString();

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
        const response = await fetch(url, options);

        // Check if response is JSON
        if (response.headers.get('content-type')?.includes('application/json')) {
            const news = await response.json();
            return news.news;
        } else {
            // Handle unexpected response body
            const text = await response.text();
            throw new Error('Unexpected response body: ' + text);
        }
    } catch (error) {
        console.error('Error fetching news: ' + error.message);
        return null;
    }
}

// Format and display news
function formatNewsOutput(ticker, newsData) {
    console.clear(); // Clear the console before outputting new information

    // Format the ticker symbol with black text on a yellow background
    console.log('\n  News for ' + chalk.black.bgYellow(`${ticker}`) + '\n');

    if (newsData.length === 0) {
        console.log('No news found.');
    } else {
        const now = new Date();
        newsData.forEach(newsItem => {
            const headline = newsItem.headline || 'No headline available';
            const url = newsItem.url; // Keep the full URL
            const timestamp = newsItem.created_at ? new Date(newsItem.created_at) : null; // Use created_at field

            if (!timestamp || isNaN(timestamp.getTime())) {
                console.error('Invalid timestamp:', newsItem.created_at);
                return; // Skip this entry if the timestamp is invalid
            }

            // Calculate time elapsed
            const elapsedMilliseconds = now - timestamp;
            const elapsedHours = Math.floor(elapsedMilliseconds / (1000 * 60 * 60));
            const elapsedMinutes = Math.floor((elapsedMilliseconds % (1000 * 60 * 60)) / (1000 * 60));
            const timeElapsed = `${elapsedHours}h ${elapsedMinutes}m ago`;

            // Output headline in bold and URL
            console.log(`- ${chalk.bold(headline)}`); // Bold text
            console.log(`  ${url}`);
            console.log(`  Published: ${timeElapsed}\n`); // Line break between entries
        });

        // Prompt the user to open the latest news
        promptToOpenLatestNews(newsData);
    }
}

// Prompt the user to open the latest news
function promptToOpenLatestNews(newsData) {
    if (newsData.length > 0) {
        const latestNews = newsData[0];
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log();
        rl.question(`  Read: ${latestNews.headline} (y/n): `, async (answer) => {
            if (answer.toLowerCase() === 'y') {
                if (latestNews.url) {
                    await open(latestNews.url); // Open the URL in the default browser
                }
            } 
            rl.close(); // Close the readline interface
        });
    }
}

// Process the ticker
async function processTicker() {
    const newTicker = await readTickerFromFile();
    if (newTicker !== currentTicker) {
        currentTicker = newTicker;
        const newsData = await getNews(currentTicker);
        if (newsData) {
            formatNewsOutput(currentTicker, newsData);
        } else {
            console.log(`No news found for ticker ${currentTicker} in the past 24 hours.`);
        }
    }
}

// Debounced function to process ticker updates
const debouncedProcessTicker = debounce(() => {
    processTicker().catch(console.error);
}, 1000); // Debounce interval

// Watch for changes in ticker.txt
fs.watch(tickerFilePath, (eventType) => {
    if (eventType === 'change') {
        debouncedProcessTicker();
    }
});

// Initial processing
processTicker().catch(console.error);
