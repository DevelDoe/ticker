import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

// Define the path to the ticker file
const tickerFilePath = path.join(process.cwd(), 'ticker.txt');

// Function to fetch and display stock data
const fetchStockData = async (ticker) => {
  try {
    // Construct the URL for the stock page
    const url = `https://finviz.com/quote.ashx?t=${ticker.toUpperCase()}&ta=1&p=d&ty=si&b=1`;

    // Launch a new browser instance
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Set a random user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to the Finviz stock page
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Extract data from the table
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

    // Format the output
    console.log(`\nStock Data for ${ticker.toUpperCase()} (from Finviz):\n`);

    // Format Settlement Date and other fields
    console.log(`  Settlement Date: ${chalk.reset(stockData['Settlement Date'] || 'N/A')}`);
    console.log(`  Short Interest: ${chalk.reset(stockData['Short Interest'] || 'N/A')}`);

    // Short Float Formatting
    const shortFloat = stockData['Short Float'];
    const shortFloatValue = shortFloat && !isNaN(parseFloat(shortFloat.replace('%', '').replace(',', '')))
      ? parseFloat(shortFloat.replace('%', '').replace(',', ''))
      : NaN;
    let shortFloatColor = chalk.reset;
    if (!isNaN(shortFloatValue)) {
      if (shortFloatValue > 20) {
        shortFloatColor = chalk.red; // High short float
      } else if (shortFloatValue > 10) {
        shortFloatColor = chalk.yellow; // Moderate short float
      } else {
        shortFloatColor = chalk.green; // Low short float
      }
    }

    console.log(`  Short Float: ${shortFloatColor(shortFloat || 'N/A')}`);

    // Short Ratio Formatting
    const shortRatio = stockData['Short Ratio'];
    const shortRatioValue = shortRatio && !isNaN(parseFloat(shortRatio))
      ? parseFloat(shortRatio)
      : NaN;
    let shortRatioColor = chalk.reset;
    if (!isNaN(shortRatioValue)) {
      if (shortRatioValue > 10) {
        shortRatioColor = chalk.red; // High short ratio
      } else if (shortRatioValue > 5) {
        shortRatioColor = chalk.yellow; // Moderate short ratio
      } else {
        shortRatioColor = chalk.green; // Low short ratio
      }
    }

    console.log(`  Short Ratio: ${shortRatioColor(shortRatio || 'N/A')}`);

    // Short Float Explanation with color coding
    if (shortFloat && shortFloat !== 'N/A') {
      console.log(`\nShort Float Overview`);
      console.log(`  Short Float: ${shortFloatColor(shortFloat)}`);

      if (!isNaN(shortFloatValue)) {
        console.log(`  Explanation: A short float of ${shortFloat} indicates that ${shortFloatValue}% of the company's available shares are being shorted.`);
        if (shortFloatValue > 20) {
          console.log('  This high short float indicates that a significant portion of the company’s shares are being shorted. For bullish traders, this could suggest a potential opportunity if the stock price rises, as the high short interest might lead to a short squeeze.');
        } else if (shortFloatValue > 10) {
          console.log('  This moderate short float suggests that a moderate portion of the company’s shares are being shorted. Bullish traders might see this as an opportunity, as a price increase could lead to short covering and drive the stock price higher.');
        } else {
          console.log('  This low short float shows that a small portion of the company’s shares are being shorted. For bullish traders, this indicates less bearish sentiment and might imply fewer obstacles if the stock price increases.');
        }
      } else {
        console.log(`  Explanation: Data not available.`);
      }
    } else {
      console.log(`\nShort Float Overview`);
      console.log(`  Short Float: Data not available.`);
    }

    // Short Ratio Explanation with color coding
    if (shortRatio && shortRatio !== 'N/A') {
      console.log(`\nShort Ratio Overview`);
      console.log(`  Short Ratio: ${shortRatioColor(shortRatio)}`);

      if (!isNaN(shortRatioValue)) {
        console.log(`  A short ratio of ${shortRatio} means that it would take ${shortRatioValue} days to cover all short positions based on average daily volume.`);
        if (shortRatioValue > 10) {
          console.log('  This high short ratio suggests that a significant number of shares are being shorted. For bullish traders, this might present an opportunity as a rise in the stock price could force short sellers to cover their positions, potentially driving the price higher.');
        } else if (shortRatioValue > 5) {
          console.log('  This moderate short ratio indicates some short interest. Bullish traders might see this as a potential opportunity, as a price increase could lead to short covering and upward price pressure.');
        } else {
          console.log('  This low short ratio indicates that fewer shares are being shorted. For bullish traders, this typically signifies lower bearish sentiment and may suggest a smoother path for upward price movements.');
        }
      } else {
        console.log(`  Explanation: Data not available.`);
      }
    } else {
      console.log(`\nShort Ratio Overview`);
      console.log(`  Short Ratio: Data not available.`);
    }

    // Take a screenshot of the page
    await page.screenshot({ path: `${ticker.toUpperCase()}_finviz_screenshot.png` });

    // Close the browser
    await browser.close();
  } catch (error) {
    console.error('An error occurred:', error);
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

  fs.watch(tickerFilePath, async (eventType) => {
    if (eventType === 'change') {
      try {
        const ticker = await readTickerFromFile();
        if (ticker !== lastTicker) {
          console.clear();
          console.log(`Ticker symbol changed to: ${ticker}`);
          await fetchStockData(ticker);
          lastTicker = ticker;
        }
      } catch (error) {
        console.error('Error reading ticker file:', error);
      }
    }
  });

  // Initial read to start
  try {
    const initialTicker = await readTickerFromFile();
    if (initialTicker) {
      lastTicker = initialTicker;
      console.log(`Initial ticker symbol: ${initialTicker}`);
      await fetchStockData(initialTicker);
    }
  } catch (error) {
    console.error('Error reading initial ticker file:', error);
  }
};

// Start monitoring the ticker file
monitorTickerFile().catch(console.error);
