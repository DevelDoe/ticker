import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import Table from 'cli-table3';
import chalk from 'chalk';

// Define paths for files
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

// Function to fetch and display data
const fetchData = async () => {
    try {
        const url = 'https://momoscreener.com/scanner';

        const browser = await puppeteer.launch({
            headless: true,
            executablePath: 'C:\\chrome-win\\chrome.exe',  // Replace this with the actual path to your Chromium/Chrome
            args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Extract data from the Momentum table
        const momentumTableData = await page.evaluate(() => {
            const rows = document.querySelectorAll('.card-body .table tbody tr');
            const result = [];

            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length === 8) { // Ensure there are exactly 8 cells
                    const rowData = {
                        Symbol: cells[0]?.innerText.trim(),
                        Price: parseFloat(cells[1]?.innerText.trim()) || 0, // Ensure Price is a number
                        Change: cells[2]?.innerText.trim(),
                        '5m': cells[3]?.innerText.trim(),
                        Float: cells[4]?.innerText.trim(),
                        Volume: cells[5]?.innerText.trim(),
                        'Spr(%)': cells[6]?.innerText.trim(),
                        Time: cells[7]?.innerText.trim()
                    };

                    // Sanitize Symbol field if it contains unexpected values
                    if (!isNaN(new Date(rowData.Symbol).getTime())) {
                        rowData.Symbol = 'Unknown'; // Set Symbol to 'Unknown' if it looks like a date
                    }

                    result.push(rowData);
                }
            });

            return result;
        });

        // Extract data from the Halted table
        const haltedTableData = await page.evaluate(() => {
            const rows = document.querySelectorAll('.card-body .tableFixHead tbody tr');  // Adjust selector as needed
            const result = [];

            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length === 7) { // Ensure there are exactly 7 cells
                    const rowData = {
                        Symbol: cells[0]?.innerText.trim(),
                        Price: parseFloat(cells[1]?.innerText.trim()) || 0, // Ensure Price is a number
                        Change: cells[2]?.innerText.trim(),
                        '5m': cells[3]?.innerText.trim(),
                        Float: cells[4]?.innerText.trim(),
                        Volume: cells[5]?.innerText.trim(),
                        Time: cells[6]?.innerText.trim()
                    };

                    // Sanitize Symbol field if it contains unexpected values
                    if (!isNaN(new Date(rowData.Symbol).getTime())) {
                        rowData.Symbol = 'Unknown'; // Set Symbol to 'Unknown' if it looks like a date
                    }

                    result.push(rowData);
                }
            });

            return result;
        });

        // Filter data from both tables
        const filteredMomentumData = momentumTableData.filter(row => 
            row['5m'] && row['5m'].trim() !== '-' && row['5m'].trim() !== '' &&
            row['Symbol'] !== 'Unknown' &&
            row['Price'] > 1 && row['Price'] < 15 // Filter by Price
        );

        const filteredHaltedData = haltedTableData.filter(row => 
            row['5m'] && row['5m'].trim() !== '-' && row['5m'].trim() !== '' &&
            row['Symbol'] !== 'Unknown' &&
            row['Time'].includes(' ') // Ensure Time includes date and time
        );

        console.clear();

        // Log filtered data for Momentum table using cli-table3 with compact layout
        const momentumTable = new Table({
            chars: { 
                'top': '' , 'top-mid': '' , 'top-left': '' , 'top-right': '',
                'bottom': '' , 'bottom-mid': '' , 'bottom-left': '' , 'bottom-right': '',
                'left': '' , 'left-mid': '' , 'mid': '' , 'mid-mid': '',
                'right': '' , 'right-mid': '' , 'middle': ' ' 
            },
            style: { 'padding-left': 0, 'padding-right': 0 }
        });
        momentumTable.push(
            ...filteredMomentumData.map(item => [
                chalk.cyan(item.Symbol),
                chalk.green(item.Price),
                chalk.yellow(item.Change),
                chalk.magenta(item['5m']),
                chalk.blue(item.Float),
                chalk.red(item.Volume),
                chalk.gray(item['Spr(%)']),
                chalk.white(item.Time)
            ])
        );

        log(`\n  Momentum scanning \n`);
        log(momentumTable.toString());

        // Log filtered data for Halted table using cli-table3 with compact layout
        const haltedTable = new Table({
            chars: { 
                'top': '' , 'top-mid': '' , 'top-left': '' , 'top-right': '',
                'bottom': '' , 'bottom-mid': '' , 'bottom-left': '' , 'bottom-right': '',
                'left': '' , 'left-mid': '' , 'mid': '' , 'mid-mid': '',
                'right': '' , 'right-mid': '' , 'middle': ' ' 
            },
            style: { 'padding-left': 0, 'padding-right': 0 }
        });
        haltedTable.push(
            ...filteredHaltedData.map(item => [
                chalk.cyan(item.Symbol),
                chalk.green(item.Price),
                chalk.yellow(item.Change),
                chalk.magenta(item['5m']),
                chalk.blue(item.Float),
                chalk.red(item.Volume),
                chalk.white(item.Time)
            ])
        );

        log(`\n  Halted stocks \n`);
        log(haltedTable.toString());

        await browser.close();
    } catch (error) {
        log('An error occurred: ' + error.message);
    }
};

// Main function renamed to momentum
const momentum = async () => {
    await fetchData();
};

// Start the momentum function in a loop
const runContinuous = () => {
    momentum()
        .then(() => setTimeout(runContinuous, 5 * 60 * 1000)) // Run every 5 minutes
        .catch(error => {
            log('An error occurred: ' + error.message);
            setTimeout(runContinuous, 5 * 60 * 1000); // Run again after 5 minutes if an error occurs
        });
};

// Start the continuous loop
runContinuous();
