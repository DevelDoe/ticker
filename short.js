import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import debounce from 'lodash.debounce';
import puppeteer from 'puppeteer-core';

// Define paths for files
const tickerFilePath = path.join(process.cwd(), 'ticker.txt');
const logFilePath = path.join(process.cwd(), 'log.txt');

// Command-line arguments
const verboseMode = process.argv.includes('-v');

// Logger function
function log(message) {
    if (verboseMode) {
        fs.writeFileSync(logFilePath, `${new Date().toISOString()}: ${message}\n`, { flag: 'a' });
    }
    console.log(message);
}

// Function to fetch and display stock data
const fetchStockData = async (ticker) => {
    try {
        const url = `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}&ta=1&p=d&ty=si&b=1`;

        const browser = await puppeteer.launch({
            headless: true,
            executablePath: 'C:\\chrome-win\\chrome.exe',  // Replace this with the actual path to your Chromium/Chrome
            args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
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
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 5) {
                        data[labels[0]] = cells[0]?.innerText.trim();
                        data[labels[1]] = cells[1]?.innerText.trim();
                        data[labels[2]] = cells[2]?.innerText.trim();
                        data[labels[3]] = cells[3]?.innerText.trim();
                        data[labels[4]] = cells[4]?.innerText.trim();
                    }
                });
            }
            return data;
        });

        console.clear();
        console.log('\n  Short data for ' + chalk.black.bgYellow(`${ticker}`) + '\n');

        log(`  Settlement Date: ${chalk.reset(stockData['Settlement Date'] || 'N/A')}`);
        log(`  Short Interest: ${chalk.reset(stockData['Short Interest'] || 'N/A')}`);

        const shortFloat = stockData['Short Float'];
        const shortFloatValue = shortFloat && !isNaN(parseFloat(shortFloat.replace('%', '').replace(',', '')))
            ? parseFloat(shortFloat.replace('%', '').replace(',', ''))
            : NaN;

        let shortFloatColor = chalk.reset;
        if (!isNaN(shortFloatValue)) {
            if (shortFloatValue > 20) {
                shortFloatColor = chalk.red;
            } else if (shortFloatValue > 10) {
                shortFloatColor = chalk.yellow;
            } else {
                shortFloatColor = chalk.green;
            }
        }

        log(`  Short Float: ${shortFloatColor(shortFloat || 'N/A')}`);

        const shortRatio = stockData['Short Ratio'];
        const shortRatioValue = shortRatio && !isNaN(parseFloat(shortRatio))
            ? parseFloat(shortRatio)
            : NaN;

        let shortRatioColor = chalk.reset;
        if (!isNaN(shortRatioValue)) {
            if (shortRatioValue > 10) {
                shortRatioColor = chalk.red;
            } else if (shortRatioValue > 5) {
                shortRatioColor = chalk.yellow;
            } else {
                shortRatioColor = chalk.green;
            }
        }

        log(`  Short Ratio: ${shortRatioColor(shortRatio || 'N/A')}`);

        if (shortFloat && shortFloat !== 'N/A') {
            log(`\n`);

            if (!isNaN(shortFloatValue)) {
                if (shortFloatValue > 20) {
                    log(`  ${shortFloatColor(shortFloat)} is a high short float that indicates that a significant portion of the company’s shares are being shorted. For bullish traders, this could suggest a potential opportunity if the stock price rises, as the high short interest might lead to a short squeeze.`);
                } else if (shortFloatValue > 10) {
                    log(`  ${shortFloatColor(shortFloat)} is a moderate short float that suggests that a moderate portion of the company’s shares are being shorted. Bullish traders might see this as an opportunity, as a price increase could lead to short covering and drive the stock price higher.`);
                } else {
                    log(`  ${shortFloatColor(shortFloat)} is a low short float This shows that a small portion of the company’s shares are being shorted. For bullish traders, this indicates less bearish sentiment and might imply fewer obstacles if the stock price increases.`);
                }
            } else {
                log(`  Short Float: Data not available.`);
            }
        } else {
            log(`\n  Short Float Overview`);
            log(`  Short Float: Data not available.`);
        }

        if (shortRatio && shortRatio !== 'N/A') {
            log(`\n  `);

            if (!isNaN(shortRatioValue)) {
                log(`  It would take ${shortRatioColor(shortRatio)} days to cover all short positions based on average daily volume.`);
                if (shortRatioValue > 10) {
                    log(`  This high short ratio ${shortRatioColor(shortRatio)} suggests that a significant number of shares are being shorted. For bullish traders, this might present an opportunity as a rise in the stock price could force short sellers to cover their positions, potentially driving the price higher.`);
                } else if (shortRatioValue > 5) {
                    log(`  This moderate short ratio ${shortRatioColor(shortRatio)} indicates some short interest. Bullish traders might see this as a potential opportunity, as a price increase could lead to short covering and upward price pressure.`);
                } else {
                    log(`  This low short ratio ${shortRatioColor(shortRatio)} indicates that fewer shares are being shorted. For bullish traders, this typically signifies lower bearish sentiment and may suggest a smoother path for upward price movements.`);
                }
            } else {
                log(`  Short Ratio: Data not available.`);
            }
        } else {
            log(`\n  Short Ratio Overview`);
            log(`  Short Ratio: Data not available.`);
        }

        await browser.close();
    } catch (error) {
        log('An error occurred: ' + error.message);
    }
};

// Function to read ticker from the file
const readTickerFromFile = () => {
    return new Promise((resolve, reject) => {
        fs.readFile(tickerFilePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data.trim());
            }
        });
    });
};

// Main function to monitor the ticker file
const monitorTickerFile = async () => {
    let lastTicker = '';

    const debouncedFileChange = debounce(async () => {
        try {
            const ticker = await readTickerFromFile();
            if (ticker !== lastTicker) {
                console.clear(); // Clears the console
                log(`Ticker symbol changed to: ${ticker}`);
                await fetchStockData(ticker);
                lastTicker = ticker;
            }
        } catch (error) {
            log('Error reading ticker file: ' + error.message);
        }
    }, 1000); // Debounce interval

    fs.watch(tickerFilePath, (eventType) => {
        if (eventType === 'change') {
            debouncedFileChange();
        }
    });

    try {
        const initialTicker = await readTickerFromFile();
        if (initialTicker) {
            lastTicker = initialTicker;
            log(`\n  Loading: ${initialTicker}`);
            await fetchStockData(initialTicker);
        }
    } catch (error) {
        log('  Error reading initial ticker file: ' + error.message);
    }
};

// Start monitoring the ticker file
monitorTickerFile().catch(console.error);
