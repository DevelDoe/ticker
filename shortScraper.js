import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

// Define paths for files
const tickerFilePath = path.join(process.cwd(), 'ticker.txt');
const outputFilePath = path.join(process.cwd(), 'short_scrapes.json');
const processedTickersFilePath = path.join(process.cwd(), 'short_processed_tickers.json');
const lastWipeFilePath = path.join(process.cwd(), 'lastWipeShort.txt'); // File to store the last wipe date

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

// Function to set a date to midnight (00:00:00)
const setToMidnight = (date) => {
    const newDate = new Date(date);
    newDate.setHours(0, 0, 0, 0);  // Set time to 00:00:00.000
    return newDate;
};

// Function to check if the data files need to be wiped
const checkAndWipeIfNeeded = async () => {
    try {
        const lastWipeDateStr = await fs.promises.readFile(lastWipeFilePath, 'utf8');
        const lastWipeDate = new Date(lastWipeDateStr);

        // Set both last wipe date and current date to midnight for comparison
        const lastWipeAtMidnight = setToMidnight(lastWipeDate);
        const currentDateAtMidnight = setToMidnight(new Date());

        // Check if it's a new day
        if (currentDateAtMidnight > lastWipeAtMidnight) {
            console.log('Wiping short_scrapes.json and short_processed_tickers.json for a new day...');
            await fs.promises.writeFile(outputFilePath, JSON.stringify([])); // Wipe the short scrapes file with empty array
            await fs.promises.writeFile(processedTickersFilePath, JSON.stringify([])); // Wipe the processed tickers file with empty array
            await fs.promises.writeFile(lastWipeFilePath, currentDateAtMidnight.toISOString()); // Update the wipe date
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            // If the file doesn't exist, create it and wipe the data files
            const currentDateAtMidnight = setToMidnight(new Date());
            await fs.promises.writeFile(outputFilePath, JSON.stringify([])); // Wipe the short scrapes file with empty array
            await fs.promises.writeFile(processedTickersFilePath, JSON.stringify([])); // Wipe the processed tickers file with empty array
            await fs.promises.writeFile(lastWipeFilePath, currentDateAtMidnight.toISOString()); // Create the last wipe file
        } else {
            console.error('Error checking wipe status:', err);
        }
    }
};

// Function to fetch stock data
const fetchStockData = async (ticker) => {
    try {
        const url = `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}&ta=1&p=d&ty=si&b=1`;

        const browser = await puppeteer.launch({
            headless: true,
            executablePath: 'C:\\chrome-win\\chrome.exe',  // Replace with the actual path to your Chromium/Chrome
            args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0');
        await page.goto(url, { waitUntil: 'networkidle2' });

        const stockData = await page.evaluate(() => {
            const data = {};
            const table = document.querySelector('table.financials-table');
            if (table) {
                const rows = table.querySelectorAll('tbody tr');
                const labels = [
                    'Settlement Date',
                    'Short Interest',
                    'Avg. Daily Volume',
                    'Short Float',
                    'Short Ratio'
                ];

                // Only fetch data from the first row
                if (rows.length > 0) {
                    const cells = rows[0].querySelectorAll('td'); // Get the first row
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
        console.error('An error occurred:', error.message);
        return null;
    }
};


// Function to check if a stock's data is valuable
const isValuableData = (shortFloat, shortRatio) => {
    const shortFloatValue = shortFloat && !isNaN(parseFloat(shortFloat.replace('%', '').replace(',', '')))
        ? parseFloat(shortFloat.replace('%', '').replace(',', ''))
        : NaN;
    const shortRatioValue = shortRatio && !isNaN(parseFloat(shortRatio))
        ? parseFloat(shortRatio)
        : NaN;

    return (shortFloatValue > 10 || shortRatioValue > 5); // Example threshold for valuable data
};

// Function to write valuable tickers to a JSON file
const writeValuableTickersToFile = (ticker, data) => {
    const outputData = fs.existsSync(outputFilePath) ? JSON.parse(fs.readFileSync(outputFilePath, 'utf8')) : [];
    outputData.push({ ticker, data });
    fs.writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2), 'utf8');
    console.log(`Added ${ticker} to valuable tickers list.`);
};

// Function to load processed tickers
const loadProcessedTickers = () => {
    return new Promise((resolve, reject) => {
        fs.readFile(processedTickersFilePath, 'utf8', (err, data) => {
            if (err && err.code === 'ENOENT') {
                resolve(new Set()); // File does not exist, return empty set
            } else if (err) {
                reject(err);
            } else {
                resolve(new Set(JSON.parse(data)));
            }
        });
    });
};

// Function to save processed tickers
const saveProcessedTickers = (processedTickers) => {
    fs.writeFileSync(processedTickersFilePath, JSON.stringify([...processedTickers], null, 2), 'utf8');
};

// Function to process new tickers
const processNewTickers = async (newTickers) => {
    for (const ticker of newTickers) {
        const stockData = await fetchStockData(ticker);

        if (stockData) {
            const shortFloat = stockData['Short Float'];
            const shortRatio = stockData['Short Ratio'];

            if (isValuableData(shortFloat, shortRatio)) {
                writeValuableTickersToFile(ticker, stockData);
            } else {
                console.log(`Ticker ${ticker} does not meet the criteria.`);
            }
        }
    }
};

// Main function to process tickers and set up file watcher
const main = async () => {
    // Check and wipe data if needed
    await checkAndWipeIfNeeded();

    // Load previously processed tickers
    const processedTickers = await loadProcessedTickers();
    const tickers = await readTickersFromFile();

    // Determine new tickers by comparing with processed ones
    const newTickers = tickers.filter(ticker => !processedTickers.has(ticker));
    
    if (newTickers.length > 0) {
        console.log('Processing new tickers...');
        await processNewTickers(newTickers);
        // Update processed tickers set
        newTickers.forEach(ticker => processedTickers.add(ticker));
        saveProcessedTickers(processedTickers);
    } else {
        console.log('No new tickers to process.');
    }
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
            fileChangeTimeout = setTimeout(main, 2000); // Debounce file changes
        }
    });

    console.log(`Watching for changes in ${tickerFilePath}`);
};

// Start the script and file watcher
main().catch(console.error);
watchFile();
