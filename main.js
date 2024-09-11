import puppeteer from 'puppeteer';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Get the directory name from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a writable stream for logging
const logFile = path.join(__dirname, 'log.txt');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Log function
function log(message) {
  console.log(message); // Log to console
  logStream.write(message + '\n'); // Log to file
}

// Create an interface to ask user for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Function to scrape stock data from Finviz
async function scrapeFinviz(symbol) {
  const url = `https://finviz.com/quote.ashx?t=${symbol}`;

  log(`Starting scrape for symbol: ${symbol}`);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  try {
    // Navigate to the stock's profile page on Finviz
    await page.goto(url);

    // Wait for the table containing the data to load
    await page.waitForSelector('.snapshot-table2');

    // Extract the necessary stock data, such as Short Float and other metrics
    const stockData = await page.evaluate(() => {
      const rows = document.querySelectorAll('.snapshot-table2 tr');
      let result = {};
      
      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        const label = cells[0] ? cells[0].innerText : null;
        const value = cells[1] ? cells[1].innerText : null;
        
        if (label && value) {
          result[label] = value;
        }
      });

      return {
        currentPrice: result['Price'] || 'N/A',
        marketCap: result['Market Cap'] || 'N/A',
        peRatio: result['P/E'] || 'N/A',
        week52Range: result['52W Range'] || 'N/A',
        shortFloat: result['Shs Float'] || 'N/A',
        fiftyDayAvg: result['50 Day'] || 'N/A',
        twoHundredDayAvg: result['200 Day'] || 'N/A',
      };
    });

    const { currentPrice, marketCap, peRatio, week52Range, shortFloat, fiftyDayAvg, twoHundredDayAvg } = stockData;

    // User-friendly output with colors using Chalk
    log(chalk.bold.blue(`\nStock Data for ${symbol.toUpperCase()} (from Finviz):\n`));

    log(`Current Price: ${chalk.green(currentPrice)}`);
    log(`Market Cap: ${chalk.yellow(marketCap)}`);
    log(`P/E Ratio: ${chalk.cyan(peRatio)}`);
    log(`52-Week Range: ${chalk.magenta(week52Range)}`);
    log(`50-Day Moving Average: ${chalk.cyan(fiftyDayAvg)}`);
    log(`200-Day Moving Average: ${chalk.red(twoHundredDayAvg)}\n`);

    // Short Interest Section
    log(chalk.bold.magenta(`--- Short Interest ---`));
    log(`Short Float: ${chalk.red(shortFloat)}`);

    // Explanation of Short Float
    if (shortFloat !== 'N/A') {
      const shortFloatValue = parseFloat(shortFloat.replace('%', ''));

      log(
        chalk.blue(`Explanation: A short float of ${chalk.red(shortFloat)} means that ${chalk.bold(
          shortFloatValue
        )}% of the company's available shares are being shorted.`)
      );

      // Provide an interpretation of the short interest level
      if (shortFloatValue > 20) {
        log(
          chalk.red(
            'This is a high short interest, indicating many investors are betting against the stock.'
          )
        );
      } else if (shortFloatValue > 10) {
        log(
          chalk.yellow(
            'This is a moderate short interest, signaling a fair amount of bearish sentiment.'
          )
        );
      } else {
        log(chalk.green('This is a low short interest, indicating minimal bearish sentiment.'));
      }
    } else {
      log(chalk.red('Short float data not available.'));
    }

    log('\n-------------------------');
  } catch (error) {
    log(`Error occurred: ${error.message}`);
  } finally {
    await browser.close();
    log('Browser closed.');
  }
}

// Main function to prompt the user and scrape stock data
async function start() {
  rl.question('Enter the stock symbol (e.g., AAPL): ', async (stockSymbol) => {
    // Call the function to scrape Finviz using the user's input
    await scrapeFinviz(stockSymbol);
    
    // Close the readline interface
    rl.close();
  });
}

start();
