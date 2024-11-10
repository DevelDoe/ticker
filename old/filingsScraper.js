import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

// Define paths for files
const tickerFilePath = path.join(process.cwd(), 'ticker.txt');
const outputFilePath = path.join(process.cwd(), 's3_filings.json');

// Helper function to read tickers from file
const readTickersFromFile = () => {
    return new Promise((resolve, reject) => {
        fs.readFile(tickerFilePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                const tickers = data.trim().split('\n').filter(line => line.trim() !== '');
                resolve(tickers);
            }
        });
    });
};

// Function to scrape S-3 filings for a given ticker
const scrapeS3Filings = async (ticker) => {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${ticker}`;
    const timeoutDuration = 15000; // Set timeout duration for the entire scrape

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: 'C:\\chrome-win\\chrome.exe', // Replace with the actual path to your Chromium/Chrome
        args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36');

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Add a delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Attempt to wait for the selector with a shorter timeout
        const selectorPromise = page.waitForSelector('.tableFile2', { timeout: 5000 }); // 5 seconds
        const result = await Promise.race([
            selectorPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for selector')), timeoutDuration))
        ]);

        if (result) {
            const filings = await page.evaluate(() => {
                const filingElements = document.querySelectorAll('.tableFile2 tr');
                const filings = [];

                filingElements.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length > 0) {
                        const formType = cells[0].innerText.trim();
                        const description = cells[2].innerText.trim();
                        const date = cells[3].innerText.trim();

                        if (formType.includes('S-3')) {
                            filings.push({
                                formType,
                                description,
                                date,
                            });
                        }
                    }
                });

                return filings;
            });

            return filings;
        } else {
            throw new Error('Selector not found');
        }
    } catch (error) {
        console.warn(`WARNING: Ticker ${ticker.toUpperCase()} could not be processed. Error: ${error.message}`);
        return []; // Return an empty array instead of throwing an error
    } finally {
        await browser.close();
    }
};

// Queue for processing tickers
let tickerQueue = [];
const processedTickers = new Set(); // Internal set to track processed tickers

// Function to process the next ticker in the queue
const processNextTicker = async () => {
    if (tickerQueue.length === 0) {
        console.log('No more tickers to process.');
        return;
    }

    const ticker = tickerQueue.shift(); // Get the first ticker from the queue
    console.log(`Processing ticker: ${ticker}`);

    // Skip if already processed
    if (processedTickers.has(ticker)) {
        console.log(`Ticker ${ticker} has already been processed. Skipping...`);
        processNextTicker(); // Process the next ticker
        return;
    }

    const s3Filings = await scrapeS3Filings(ticker);
    if (s3Filings && s3Filings.length > 0) {
        const outputData = fs.existsSync(outputFilePath) ? JSON.parse(fs.readFileSync(outputFilePath, 'utf8')) : [];
        outputData.push({ ticker, filings: s3Filings });
        fs.writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2), 'utf8');
        console.log(`S-3 filings for ticker ${ticker} saved.`);
    } else {
        console.log(`No S-3 filings found for ticker ${ticker}.`);
    }

    // Add to processed tickers
    processedTickers.add(ticker);

    // Process the next ticker in the queue
    processNextTicker();
};

// Function to enqueue tickers for processing
const enqueueTickers = (newTickers) => {
    const uniqueTickers = newTickers.filter(ticker => !processedTickers.has(ticker));
    tickerQueue.push(...uniqueTickers);
    console.log(`Enqueued tickers: ${uniqueTickers.join(', ')}`);
    processNextTicker(); // Start processing if not already started
};

// Main function to read tickers, clear output file, and enqueue them
const main = async () => {
    // Clear the output file at the start
    fs.writeFileSync(outputFilePath, JSON.stringify([], null, 2), 'utf8');
    console.log('Cleared s3_filings.json.');

    const tickers = await readTickersFromFile();
    console.log(`Read tickers: ${tickers.join(', ')}`);
    enqueueTickers(tickers);
};

// Watch for changes to the ticker.txt file and process new entries
const watchFile = () => {
    let fileChangeTimeout;
    fs.watch(tickerFilePath, async (eventType) => {
        if (eventType === 'change') {
            console.log('Ticker file changed. Processing new tickers...');
            if (fileChangeTimeout) {
                clearTimeout(fileChangeTimeout);
            }
            fileChangeTimeout = setTimeout(async () => {
                const tickers = await readTickersFromFile();
                enqueueTickers(tickers);
            }, 500); // Debounce file changes
        }
    });

    console.log(`Watching for changes in ${tickerFilePath}`);
};

// Start the script and file watcher
main().catch(console.error);
watchFile();
