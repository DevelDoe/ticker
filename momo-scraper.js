// Import required modules
import fs from "fs";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import player from "node-wav-player";
import { safeReadFile, safeWriteFile } from "./fileOps.js"; // Import safe file operations

puppeteer.use(StealthPlugin());

const verbose = process.argv.includes("-v");

// Variables
const seenTimestamps = new Set(); // Set to keep track of seen timestamps
let totalOccurrences = {}; // Storage for total occurrences of each ticker
let isRunning = false; // Set an interval to scrape every minute
let browser; // Function to launch Puppeteer browser

/**
 * Launch Puppeteer browser.
 *
 * This function launches a Puppeteer browser in headless mode with specific
 * arguments and returns the browser instance. It prints verbose logs if the
 * `-v` flag is passed.
 *
 * @returns {Promise<Object>} - The Puppeteer browser instance.
 * @throws {Error} - Throws error if browser launch fails.
 */
async function launchBrowser(retries = 3) {
    let attempt = 0;
    while (attempt < retries) {
        try {
            if (verbose) console.log("Launching Puppeteer with StealthPlugin...");
            return await puppeteer.launch({
                headless: true,
                executablePath: "C:\\chrome-win\\chrome.exe", // Update as needed
                args: ["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox"],
            });
        } catch (error) {
            attempt++;
            console.error(`Failed to launch browser (attempt ${attempt}/${retries}):`, error);
            if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    throw new Error("Failed to launch browser after multiple attempts.");
}


/**
 * Play a WAV file.
 *
 * This function uses the node-wav-player module to play a given .wav file.
 * If any error occurs, it will catch the error and log it.
 *
 * @param {string} filePath - The path to the WAV file to play.
 * @returns {Promise<void>} - A promise that resolves when the sound is played.
 */
function playWav(filePath) {
    return player
        .play({
            path: filePath,
        })
        .catch((error) => {
            console.error(`Error playing file: ${filePath}`, error);
        });
}

/**
 * Navigate to the desired page.
 *
 * This function navigates to the specified URL using Puppeteer and waits until
 * the page is fully loaded or a timeout occurs. It also waits for a specific
 * element to ensure the target table is visible before proceeding.
 *
 * @param {Object} page - The Puppeteer page instance.
 * @returns {Promise<void>} - A promise that resolves when navigation is complete.
 * @throws {Error} - Throws an error if navigation or element loading fails.
 */
async function navigateToPage(page) {
    try {
        if (verbose) console.log("Navigating to the URL...");
        await page.goto("https://momoscreener.com/scanner", {
            waitUntil: "networkidle2",
        });
        await page.waitForSelector(".tableFixHead tbody tr", {
            visible: true,
            timeout: 60000,
        });
    } catch (error) {
        console.error("Error navigating to page:", error);
        throw new Error("Navigation failed"); // Propagate the error
    }
}

/**
 * Scrape symbols and additional data.
 *
 * This function scrapes data from the target page using Puppeteer's `page.evaluate()`
 * to extract rows from a specific table. Each row contains multiple fields, such as
 * Symbol, Price, ChangePercent, and more. The function filters out invalid rows and 
 * returns an array of valid data objects.
 *
 * @param {Object} page - The Puppeteer page instance.
 * @returns {Promise<Array>} - A promise that resolves to an array of scraped data objects.
 * @throws {Error} - Throws an error if scraping fails.
 */
async function scrapeData(page) {
    try {
        if (verbose) console.log("Scraping symbols and additional data...");

        const scrapedData = await page.evaluate(() => {
            const rows = Array.from(
                document.querySelectorAll(".tableFixHead tbody tr")
            );
            return rows
                .map((row) => {
                    const cells = row.cells;

                    // Check if cells exist and have the required columns
                    if (!cells || cells.length < 8) return null;

                    return {
                        Symbol: cells[0]?.innerText.trim() || "",
                        Price: cells[1]?.innerText.trim() || "",
                        ChangePercent: cells[2]?.innerText.trim() || "",
                        FiveM: cells[3]?.innerText.trim() || "",
                        Float: cells[4]?.innerText.trim() || "",
                        Volume: cells[5]?.innerText.trim() || "",
                        SprPercent: cells[6]?.innerText.trim() || "",
                        Time: cells[7]?.innerText.trim() || "",
                    };
                })
                .filter((data) => data !== null); // Filter out any null rows
        });

        return scrapedData;
    } catch (error) {
        console.error("Error scraping data:", error);
        return []; // Return empty array on error
    }
}

// Filter scraped data based on specific criteria.
/**
 * This function filters the scraped data by ensuring the symbol matches a valid pattern,
 * the price is between threshholds, and the float (number of shares) is less than set limit.
 * It also checks whether the data has already been processed (using timestamps).
 *
 * @param {Array} scrapedData - The array of scraped data objects to filter.
 * @returns {Array} - An array of filtered data objects that meet the criteria.
 */
function filterData(scrapedData) {
    if (verbose) console.log("Filtering data...");

    const filteredData = scrapedData.filter((data) => {
        // Check if we already have processed this data in the past
        const timestamp = data.Time; // Extract the timestamp
        if (seenTimestamps.has(timestamp)) return false; // Check if the timestamp has been seen
        seenTimestamps.add(timestamp); // Add the timestamp to the set

        // Validate the symbol length (1 to 5 letters) and optionally ends with (HOD)
        const symbolPattern = /^[A-Za-z]{1,5}(\s*\(HOD\))?$/;
        if (!symbolPattern.test(data.Symbol)) return false; // Return false if it doesn't match the pattern

        // Filter by Price between 1.75 and 20
        const price = parseFloat(data.Price.replace("$", ""));
        if (isNaN(price) || price < 1.75 || price > 20) return false;

        // Handle float in 'K' (thousands), 'M' (millions), and 'B' (billions)
        const floatString = data.Float.trim();
        let float = 0;

        if (floatString.endsWith("B")) {
            float = parseFloat(floatString.replace("B", "")) * 1000; // Convert billions to millions
        } else if (floatString.endsWith("M")) {
            float = parseFloat(floatString.replace("M", "")); // Already in millions
        } else if (floatString.endsWith("K")) {
            float = parseFloat(floatString.replace("K", "")) / 1000; // Convert thousands to millions
        } else {
            float = parseFloat(floatString); // Assume it's already in a numeric format
        }

        if (isNaN(float) || float > 300) {
            // Skip if the float is invalid or greater than 50 million
            return false;
        }

        return true;
    });

    return filteredData;
}

/**
 * Save filtered symbols to a JSON file.
 *
 * This function saves the filtered ticker data to a JSON file. If the symbol is new,
 * it will add it to the JSON file. If the symbol is already present, it will update
 * the ticker's information (e.g., price, HOD status, and time last seen). The function
 * also plays a sound if new data is added.
 *
 * @param {Array} tickersToSave - An array of ticker symbols to save to the JSON file.
 * @param {Array} filteredData - The filtered data objects to extract additional information from.
 * @returns {void}
 */
async function saveToJson(tickersToSave, filteredData) {

    const filePath = "tickers.json";
    let tickersData = {};
    let newData = false;
    let tickerUpdated = false;

    // Read tickers data using safeReadFile
    try {
        tickersData = await safeReadFile(filePath);
    } catch (error) {
        console.error("Error reading tickers file:", error);
        return;
    }

    tickersToSave.forEach((symbol) => {
        const symbolData = filteredData.find((data) => data.Symbol === symbol);

        const isHOD = /\(HOD\)$/.test(symbol);
        const sanitizedSymbol = isHOD
            ? symbol.replace(/\s*\(HOD\)\s*$/, "").trim()
            : symbol;

        const newPrice = symbolData?.Price || null;
        const newFloat = symbolData?.Float || null;

        
        if (!tickersData[sanitizedSymbol]) {
            // New ticker data, save it
            tickersData[sanitizedSymbol] = {
                ticker: sanitizedSymbol,
                news: [],
                hod: isHOD,
                float: newFloat,
                price: newPrice,
                time: symbolData?.Time || null,
                isActive: true,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
            };
            // playWav('./sounds/addTicker.wav'); 
            newData = true;
        } else {
            // Check if HOD or price has changed
            const existingTicker = tickersData[sanitizedSymbol];
            

            if (existingTicker.hod !== isHOD) {
                existingTicker.hod = isHOD;
                tickerUpdated = true;
                existingTicker.isActive = true;
                // playWav('./sounds/addTicker.wav'); 
            }

            if (existingTicker.price !== newPrice) {
                existingTicker.price = newPrice;
                existingTicker.lastSeen = new Date().toISOString();
                existingTicker.isActive = true;
                tickerUpdated = true;
                // playWav('./sounds/addTicker.wav'); 
            }
            
            existingTicker.lastSeen = new Date().toISOString();
        }
    });

    if (newData || tickerUpdated) {
        try {
            await safeWriteFile(filePath, tickersData); // Use safeWriteFile to write data
        } catch (error) {
            console.error("Error writing to tickers file:", error);
        }
    } else {
        if (verbose) console.log("No new data to save.");
    }
}

/**
 * Update total occurrences of symbols
 * 
 * Updates the total occurrences for each symbol in the finalSymbols array.
 * This function increments the occurrence count of each symbol in the totalOccurrences object.
 * It also handles symbols with "(HOD)" tags, removing the tag before counting occurrences.
 *
 * @param {Array} finalSymbols - The array of symbols scraped and filtered from the data.
 */
function updateOccurrences(finalSymbols) {
    if (verbose) console.log("Updating total occurrences...");

    finalSymbols.forEach((symbol) => {
        // Check if the symbol has a HOD tag and sanitize it by removing the "(HOD)" text
        const isHOD = symbol.endsWith("(HOD)");
        const sanitizedSymbol = isHOD
            ? symbol.replace(/\(HOD\)$/, "").trim() // Remove the HOD tag and trim spaces
            : symbol;

        // Increment the count for the sanitized symbol in totalOccurrences
        totalOccurrences[sanitizedSymbol] =
            (totalOccurrences[sanitizedSymbol] || 0) + 1;
    });

    if (verbose) console.log("Total occurrences updated:", totalOccurrences);
}

/**
 * Color coding based on rank
 * 
 * Returns a specific terminal color code based on the rank of the symbol count.
 * Green for the highest count, yellow for the second highest, and salmon for the third highest.
 * Resets the color for all other ranks.
 *
 * @param {number} count - The occurrence count of the symbol.
 * @param {number} highestCount - The highest occurrence count in the list.
 * @param {number} secondHighestCount - The second highest occurrence count.
 * @param {number} thirdHighestCount - The third highest occurrence count.
 * @returns {string} - The terminal color code.
 */
function colorCode(count, highestCount, secondHighestCount, thirdHighestCount) {
    if (count === highestCount) return "\x1b[32m"; // Green for highest count
    if (count === secondHighestCount) return "\x1b[33m"; // Yellow for second highest
    if (count === thirdHighestCount) return "\x1b[38;5;213m"; // Salmon for third highest
    return "\x1b[0m"; // Reset to default color for all other counts
}


/**
 * Display sorted tickers with their counts for scraped Momo
 * 
 * Displays the sorted symbols with their occurrence counts in the terminal.
 * Applies color coding based on symbol rank (highest, second highest, third highest).
 *
 * @param {Array} sortedSymbols - Array of symbols and their counts, sorted by count in descending order.
 * @param {number} highestCount - The highest occurrence count in the list.
 * @param {number} secondHighestCount - The second highest occurrence count.
 * @param {number} thirdHighestCount - The third highest occurrence count.
 */
function displayScrapedMomo(
    sortedSymbols,
    highestCount,
    secondHighestCount,
    thirdHighestCount
) {
    console.clear(); // Clear the terminal screen before displaying
    if (sortedSymbols.length > 0) console.log("New");

    sortedSymbols.forEach(([symbol, count]) => {
        // Apply color coding to the symbol based on its count
        const color = colorCode(
            count,
            highestCount,
            secondHighestCount,
            thirdHighestCount
        );
        // Display the symbol and count with the applied color
        console.log(`${color}${symbol} ${count}\x1b[0m`); // Reset color after each symbol
    });
}

/**
 * Display the top occurrences for Today's Top Momo
 * 
 * Displays the top 10 symbols with the most occurrences for the day.
 * Applies color coding based on rank (highest, second highest, third highest).
 *
 * @param {Array} topOccurrences - Array of symbols and their total counts for the day.
 * @param {number} highestCountDay - The highest occurrence count for the day.
 * @param {number} secondHighestCountDay - The second highest occurrence count for the day.
 * @param {number} thirdHighestCountDay - The third highest occurrence count for the day.
 */
function displayTodaysTopMomo(
    topOccurrences,
    highestCountDay,
    secondHighestCountDay,
    thirdHighestCountDay
) {
    if (topOccurrences.length > 0) console.log("\nToday's");

    topOccurrences.forEach(([symbol, count]) => {
        // Apply day-specific color coding to the symbol
        const color = colorCode(
            count,
            highestCountDay,
            secondHighestCountDay,
            thirdHighestCountDay
        );
        // Display the symbol and count with the applied color
        console.log(`${color}${symbol} ${count}\x1b[0m`);
    });
}

/**
 * Main scraping function
 * 
 * Main function that orchestrates the web scraping process. This includes:
 * - Navigating to the target page
 * - Scraping symbol data
 * - Filtering and processing the data
 * - Updating the occurrence counts
 * - Displaying the results
 * - Running periodically every 60 seconds
 *
 * @returns {Promise<void>} - Resolves when the process completes.
 */
async function main() {
    if (!browser || browser.isConnected() === false) {
        browser = await launchBrowser(); // Relaunch the browser if it's not running
    }
    const page = await browser.newPage(); // Open a new browser tab
    await page.setUserAgent("Mozilla/5.0"); // Set custom user agent

    try {
        await navigateToPage(page); // Navigate to the web page
        (async () => {
            try {
                const scrapedSymbols = await scrapeData(page);
            } catch (error) {
                console.error("Failed to scrape symbols:", error);
            }
        })();
        
        const scrapedData = await scrapeData(page); // Scrape data from the page
        const filteredData = filterData(scrapedData); // Filter scraped data

        // Count occurrences of each symbol
        const symbolCount = filteredData.reduce((acc, data) => {
            acc[data.Symbol] = (acc[data.Symbol] || 0) + 1; // Increment occurrence count
            return acc;
        }, {});

        // Extract unique symbols from the filtered data
        let finalSymbols = filteredData
            .map((data) => data.Symbol)
            .filter((symbol, index, self) => self.indexOf(symbol) === index); // Ensure uniqueness

        // Get all symbols for the current scrape
        const allSymbols = filteredData.map((data) => data.Symbol);

        // Save symbols that occur more than once to a JSON file
        const tickersToSave = Object.keys(symbolCount).filter(
            (symbol) => symbolCount[symbol] > 1
        );

        if (verbose) {
            console.log("symbolCount:", JSON.stringify(symbolCount, null, 2));
            console.log(
                "tickersToSave:",
                JSON.stringify(tickersToSave, null, 2)
            );
            console.log("filteredData:", JSON.stringify(filteredData, null, 2));
        }

        saveToJson(tickersToSave, filteredData); // Save filtered data to JSON

        if (verbose) console.log("Filtered symbols:", finalSymbols);

        // Sort symbols based on their counts in descending order
        const sortedSymbols = Object.entries(symbolCount).sort(
            (a, b) => b[1] - a[1]
        );

        // Get the top 10 symbols for the day
        const topOccurrences = Object.entries(totalOccurrences)
            .sort(([, countA], [, countB]) => countB - countA)
            .slice(0, 10);

        // Get counts for color coding
        const counts = sortedSymbols.map(([, count]) => count);
        const countsDay = Object.values(totalOccurrences);

        // Determine highest counts for color coding
        const highestCount = counts[0] || 0;
        const secondHighestCount = counts[1] || 0;
        const thirdHighestCount = counts[2] || 0;

        const highestCountDay = countsDay[0] || 0;
        const secondHighestCountDay = countsDay[1] || 0;
        const thirdHighestCountDay = countsDay[2] || 0;

        // Update total occurrences for the scraped symbols
        updateOccurrences(allSymbols);

        // Display the results in the terminal
        displayScrapedMomo(
            sortedSymbols,
            highestCount,
            secondHighestCount,
            thirdHighestCount
        );

        if (Object.keys(totalOccurrences).length > 0) {
            displayTodaysTopMomo(
                topOccurrences,
                highestCountDay,
                secondHighestCountDay,
                thirdHighestCountDay
            );
        } else {
            if (verbose)
                console.log("No occurrences to display for Today's Top Momo.");
        }

        if (verbose)
            console.log(
                `\nTotal occurrences updated for today:`,
                totalOccurrences
            );
    } catch (error) {
        console.error("Error scraping symbols:", error); // Log any scraping errors
    } finally {
        await page.close(); // Close the browser tab after the scrape is complete
        if (verbose) console.log("Page closed.");
    }
}

/**
 * Delay function with a randomized delay time between 30 and 90 seconds.
 *
 * This function generates a random delay time between 30,000 ms (30 seconds)
 * and 90,000 ms (90 seconds) to help avoid server overload.
 *
 * @returns {number} - The randomized delay in milliseconds.
 */
function getRandomDelay() {
    return Math.floor(Math.random() * 60000) + 30000;
}

/**
 * Main scraping loop with random delay to avoid detection.
 *
 * This function calls the main scraping function, then waits for a random delay
 * between 30 and 90 seconds before calling itself again.
 */
async function startScrapingLoop() {
    if (isRunning) return;
    isRunning = true;

    try {
        await main(); // Main scraping logic
    } catch (error) {
        console.error("Error during scrape:", error);
    } finally {
        isRunning = false;
        const delay = getRandomDelay();
        if (verbose) console.log(`Waiting for ${delay / 1000} seconds before the next scrape...`);
        setTimeout(startScrapingLoop, delay);
    }
}

// Run the first scrape immediately
startScrapingLoop();

// Handle graceful shutdown to close the browser
process.on("exit", async () => {
    if (browser) {
        await browser.close();
        if (verbose) console.log("Browser closed.");
    }
});

// Handle SIGINT and SIGTERM for graceful shutdown
["SIGINT", "SIGTERM"].forEach((signal) => {
    process.on(signal, async () => {
        if (browser) {
            await browser.close();
            if (verbose) console.log(`Browser closed due to ${signal}.`);
        }
        process.exit();
    });
});
