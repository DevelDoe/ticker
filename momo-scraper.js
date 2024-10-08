// Import required modules
import fs from "fs";
import puppeteer from "puppeteer";

const verbose = process.argv.includes("-v");

// Variables
const seenTimestamps = new Set(); // Set to keep track of seen timestamps
let totalOccurrences = {}; // Storage for total occurrences of each ticker
let isRunning = false; // Set an interval to scrape every minute
let browser; // Function to launch Puppeteer browser

async function launchBrowser() {
    if (verbose) console.log("Launching Puppeteer...");

    return await puppeteer.launch({
        headless: true,
        executablePath: "C:\\chrome-win\\chrome.exe", // Replace with your actual path
        args: ["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox"],
    });
}

// Function to navigate to the desired page
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

// Function to scrape symbols and additional data
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

        if (verbose) console.log("Scraped data:", scrapedData);
        return scrapedData;
    } catch (error) {
        console.error("Error scraping data:", error);
        return []; // Return empty array on error
    }
}

// Function to filter scraped data based on criteria
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

        // Filter by Price between 0.75 and 20
        const price = parseFloat(data.Price.replace("$", ""));
        if (isNaN(price) || price < 0.75 || price > 20) return false;

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

        if (isNaN(float) || float > 50) {
            // Skip if the float is invalid or greater than 50 million
            return false;
        }

        return true;
    });

    if (verbose) console.log("Filtered data:", filteredData);
    return filteredData;
}

// Function to save filtered symbols to a JSON file
function saveToJson(tickersToSave, filteredData) {
    if (verbose) console.log("tickersToSave: ", tickersToSave);

    const filePath = "tickers.json";
    let tickersData = {};
    let newData = false;
    let updated = false;

    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        tickersData = JSON.parse(data);
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
            newData = true;
        } else {
            // Check if HOD or price has changed
            const existingTicker = tickersData[sanitizedSymbol];
            let tickerUpdated = false;

            if (existingTicker.hod !== isHOD) {
                existingTicker.hod = isHOD;
                tickerUpdated = true;
            }

            if (existingTicker.price !== newPrice) {
                existingTicker.price = newPrice;
                tickerUpdated = true;
            }

            // Update lastSeen and isActive fields
            existingTicker.lastSeen = new Date().toISOString();
            existingTicker.isActive = true;

            updated = true;

        }
    });

    // Log tickersData for debugging
    if (verbose) console.log("Saving:", tickersData);

    if (newData || updated) {
        fs.writeFileSync(filePath, JSON.stringify(tickersData, null, 2));
        if (verbose) console.log(`New data saved to ${filePath}`);
    } else {
        if (verbose) console.log("No new data to save.");
    }
}

// Function to update total occurrences of symbols
function updateOccurrences(finalSymbols) {
    if (verbose) console.log("Updating total occurrences...");

    finalSymbols.forEach((symbol) => {
        // Check if the symbol has a HOD tag and sanitize it
        const isHOD = symbol.endsWith("(HOD)");
        const sanitizedSymbol = isHOD
            ? symbol.replace(/\(HOD\)$/, "").trim()
            : symbol;

        // Update total occurrences for the sanitized symbol
        totalOccurrences[sanitizedSymbol] =
            (totalOccurrences[sanitizedSymbol] || 0) + 1; // Increment by 1 for each symbol
    });

    if (verbose) console.log("Total occurrences updated:", totalOccurrences);
}

// Function to apply color coding based on rank
function colorCode(count, highestCount, secondHighestCount, thirdHighestCount) {
    if (count === highestCount) return "\x1b[32m"; // Green
    if (count === secondHighestCount) return "\x1b[33m"; // Yellow
    if (count === thirdHighestCount) return "\x1b[38;5;213m"; // Salmon
    return "\x1b[0m"; // Reset color
}

// Function to display sorted tickers with their counts for scraped Momo
function displayScrapedMomo(
    sortedSymbols,
    highestCount,
    secondHighestCount,
    thirdHighestCount
) {
    console.clear();
    if (sortedSymbols.length > 0) console.log("Scraped Momos");
    sortedSymbols.forEach(([symbol, count]) => {
        const color = colorCode(
            count,
            highestCount,
            secondHighestCount,
            thirdHighestCount
        );
        console.log(`${color}${symbol}: ${count}\x1b[0m`); // Reset after printing
    });
}

// Function to display the top occurrences for Today's Top Momo
function displayTodaysTopMomo(
    topOccurrences,
    highestCountDay,
    secondHighestCountDay,
    thirdHighestCountDay
) {
    if (topOccurrences.length > 0) console.log("\nToday's Top Momos");
    topOccurrences.forEach(([symbol, count]) => {
        const color = colorCode(
            count,
            highestCountDay,
            secondHighestCountDay,
            thirdHighestCountDay
        ); // Use day counts
        console.log(`${color}${symbol}: ${count}\x1b[0m`); // Display symbol and count with color
    });
}

// Function to scrape symbols and additional data
async function main() {
    if (!browser) browser = await launchBrowser(); // Launch browser only if it's not already open
    const page = await browser.newPage(); // Create a new page
    await page.setUserAgent("Mozilla/5.0"); // Set a custom user agent

    try {
        await navigateToPage(page); // Navigate to the page
        const scrapedData = await scrapeData(page); // Scrape data
        const filteredData = filterData(scrapedData); // Filter the data

        // Count occurrences of each symbol
        const symbolCount = filteredData.reduce((acc, data) => {
            acc[data.Symbol] = (acc[data.Symbol] || 0) + 1; // Accessing Symbol property correctly
            return acc;
        }, {});

        // Extract unique symbols from filtered data
        let finalSymbols = filteredData
            .map((data) => data.Symbol)
            .filter((symbol, index, self) => self.indexOf(symbol) === index); // Get unique symbols

        // Filter out symbols that are dates
        const allSymbols = filteredData.map((data) => data.Symbol);

        // Save to JSON file (only keep symbols that occur more than once)
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

        saveToJson(tickersToSave, filteredData);

        if (verbose) console.log("Filtered symbols:", finalSymbols);

        // Sort symbols based on their counts from highest to lowest
        const sortedSymbols = Object.entries(symbolCount).sort(
            (a, b) => b[1] - a[1]
        ); // Sort in descending order without filtering

        // Get the top occurrences
        const topOccurrences = Object.entries(totalOccurrences)
            .sort(([, countA], [, countB]) => countB - countA) // Sort by count in descending order
            .slice(0, 10); // Get the top 10

        // Get counts for color coding
        const counts = sortedSymbols.map(([, count]) => count);
        const countsDay = Object.values(totalOccurrences);

        // Update highest counts for both lists
        const highestCount = counts[0] || 0;
        const secondHighestCount = counts[1] || 0;
        const thirdHighestCount = counts[2] || 0;

        const highestCountDay = countsDay[0] || 0;
        const secondHighestCountDay = countsDay[1] || 0;
        const thirdHighestCountDay = countsDay[2] || 0;

        // Update total occurrences
        updateOccurrences(allSymbols);

        // Display results
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
        console.error("Error scraping symbols:", error);
    } finally {
        await page.close(); // Close the page after scraping
        if (verbose) console.log("Page closed.");
    }
}

setInterval(async () => {
    if (isRunning) return; // Skip if the previous scrape is still running
    isRunning = true;

    try {
        await main(); // Scrape symbols
    } catch (error) {
        console.error("Error during scrape:", error);
    } finally {
        isRunning = false; // Reset the flag after scraping
    }
}, 60000); // 60000 ms = 1 minute

// Run the first scrape immediately
main();

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
