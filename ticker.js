import fs from "fs"; // Import regular fs for synchronous checks
import fsPromises from "fs/promises"; // Import fs/promises for async operations
import readline from "readline";
import Table from "cli-table3";
import chokidar from "chokidar";
import notifier from "node-notifier";
import chalk from "chalk";
import player from "node-wav-player";
import clipboardy from "clipboardy";
import { safeReadFile, safeWriteFile } from "./fileOps.js";

const verbose = process.argv.includes("-v"); // Check for verbose flag (-v)

// Define paths
const tickerFilePath = "tickers.json";
const lastWipeFilePath = "last-wipe.txt";
const watchlistFilePath = "watchlist.json"; // Path for the watchlist
const shortsFilePath = "shorts.json"; // Declare shortsFilePath
const filingsFilePath = "filings.json"; // Path for filings



let filterHeadlinesActive = false; // State for filtering headlines
const lastDisplayedHeadlines = {}; // Initialize an object to keep track of the last displayed headlines
let previousHodStatus = {}; // Stores the previous HOD status of each ticker
let previousPrices = {}; // Stores the last price for each ticker, declared globally

// Create an interface to ask for input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
// Function to play a WAV file
function playWav(filePath) {
    return player
        .play({
            path: filePath,
        })
        .catch((error) => {
            console.error(`Error playing file: ${filePath}`, error);
        });
}
// Function to log verbose messages
const logVerbose = (message) => {
    if (verbose) {
        console.log(`VERBOSE: ${message}`);
    }
};

// Function to sanitize and capitalize the ticker symbol
const sanitizeTicker = (ticker) => {
    const trimmedTicker = ticker.trim();

    if (trimmedTicker.length < 2) {
        console.log("Ticker must be at least 2 characters long.");
        logVerbose("Sanitize attempt with insufficient length:", trimmedTicker);
        return "";
    }

    const sanitized = trimmedTicker.toUpperCase().replace(/[^A-Z]/g, "");
    logVerbose(`Sanitized ticker: ${sanitized}`);
    return sanitized;
};

// Function to set a date to midnight (00:00:00)
const setToMidnight = (date) => {
    const newDate = new Date(date);
    newDate.setHours(0, 0, 0, 0);
    return newDate;
};

// Function to check if the ticker files need to be wiped
const checkAndWipeIfNeeded = async () => {
    logVerbose("Checking if the ticker files need to be wiped...");
    try {
        const lastWipeDateStr = await fsPromises.readFile(lastWipeFilePath, "utf8");
        const lastWipeDate = new Date(lastWipeDateStr);
        const lastWipeAtMidnight = setToMidnight(lastWipeDate);
        const currentDateAtMidnight = setToMidnight(new Date());

        console.log("Last wipe date:", lastWipeAtMidnight);
        console.log("Current date:", currentDateAtMidnight);

        if (currentDateAtMidnight > lastWipeAtMidnight) {
            console.log("Wiping ticker, filings, and shorts files for a new day...");
            
            // Wipe each of the files by resetting their contents to empty objects
            await safeWriteFile(tickerFilePath, {});
            await safeWriteFile(filingsFilePath, {});
            await safeWriteFile(shortsFilePath, {});

            console.log(`Updating last wipe date to: ${currentDateAtMidnight.toISOString()}`);
            await fsPromises.writeFile(lastWipeFilePath, currentDateAtMidnight.toISOString());
            console.log("All data files wiped for the new day.");
        } else {
            logVerbose("No need to wipe ticker files today.");
        }
    } catch (err) {
        if (err.code === "ENOENT") {
            const currentDateAtMidnight = setToMidnight(new Date());
            await safeWriteFile(tickerFilePath, {});
            await safeWriteFile(filingsFilePath, {});
            await safeWriteFile(shortsFilePath, {});

            console.log(`Updating last wipe date to: ${currentDateAtMidnight.toISOString()}`);
            await fsPromises.writeFile(lastWipeFilePath, currentDateAtMidnight.toISOString());
            console.log("Data files created and wiped. Last wipe date set.");
        } else {
            console.error("Error checking wipe status:", err);
        }
    }
};

// Function to check if it's 15:30
const checkTimeForClear = () => {
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    if (!tickers[sanitizedTicker]) {
        tickers[sanitizedTicker] = { ticker: sanitizedTicker, news: [] };
        console.log(`Ticker ${sanitizedTicker} added.`);
    }

    logVerbose(`Checking time: ${now.toLocaleTimeString()}`);

    if (currentHours === 15 && currentMinutes === 45) {
        logVerbose("triggering clearTickers()...");
        clearTickers();
        return true; // Time matched
    }
    return false; // Not time yet
};

// Function to start checking every minute, then every second when close to 15:45
const startTickerClearSchedule = () => {
    logVerbose("Starting minute-based checking...");

    // Check every minute
    const minuteInterval = setInterval(() => {
        const now = new Date();
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();

        logVerbose(`Minute check: ${now.toLocaleTimeString()}`);

        // Check if we are within the last minute before 15:45
        if (currentHours === 15 && currentMinutes === 44) {
            logVerbose("Switching to second-by-second checks...");

            // Stop minute-based checking
            clearInterval(minuteInterval);

            // Start checking every second
            const secondInterval = setInterval(() => {
                logVerbose(`Seconds check: ${new Date().toLocaleTimeString()}`);
                if (checkTimeForClear()) {
                    clearInterval(secondInterval); // Stop second-based checking after clearing
                }
            }, 1000); // Check every second
        }
    }, 60000); // Check every minute
};

// Function to append a ticker to the watchlist
const appendToWatchlist = async (sanitizedTicker) => {
    try {
        // Read tickers from the tickers.json file
        const tickers = await safeReadFile(tickerFilePath);

        // Check if the ticker exists in tickers.json
        if (!tickers[sanitizedTicker]) {
            console.log(`Ticker ${sanitizedTicker} does not exist in tickers.json. Cannot add to watchlist.`);
            return; // Exit if the ticker does not exist
        }

        // Read the current watchlist
        const watchlistData = await fsPromises.readFile(watchlistFilePath, "utf8"); // Change here
        const watchlist = JSON.parse(watchlistData);

        // If the ticker doesn't exist in the watchlist, add it
        if (!watchlist[sanitizedTicker]) {
            watchlist[sanitizedTicker] = { ticker: sanitizedTicker };
            await fsPromises.writeFile(watchlistFilePath, JSON.stringify(watchlist, null, 2)); // Change here
            console.log(`Ticker ${sanitizedTicker} added to watchlist.`);
        } else {
            console.log(`Ticker ${sanitizedTicker} is already in the watchlist.`);
        }
        // Refresh the display
        await displayTickersTable();
    } catch (err) {
        console.error("Error appending to watchlist:", err);
    }
};

// Function to remove a ticker from the watchlist
const removeFromWatchlist = async (sanitizedTicker) => {
    logVerbose(`Removing from watchlist: ${sanitizedTicker}`);
    try {
        const data = await fsPromises.readFile(watchlistFilePath, "utf8"); // Change here
        const watchlist = JSON.parse(data);

        if (watchlist[sanitizedTicker]) {
            delete watchlist[sanitizedTicker];
            await fsPromises.writeFile(watchlistFilePath, JSON.stringify(watchlist, null, 2)); // Change here
            console.log(`Ticker ${sanitizedTicker} removed from watchlist.`);
        } else {
            console.log(`Ticker ${sanitizedTicker} not found in watchlist.`);
        }

        // Refresh the display
        await displayTickersTable();
    } catch (err) {
        console.error("Error removing from watchlist:", err);
    }
};

// ANSI color codes
const colors = {
    yellow: "\x1b[93m",
    darkGray: "\x1b[90m",
    reset: "\x1b[0m",
};

/**
 * Displays tickers in a formatted table with color-coded data based on activity.
 * @async
 * @function displayTickersTable
 */
const displayTickersTable = async () => {
    logVerbose("Displaying tickers in table format...");
    try {
        const tickers = await safeReadFile(tickerFilePath);

        // Load watchlist data
        const watchlistData = await fsPromises.readFile(watchlistFilePath, "utf8");
        const watchlist = JSON.parse(watchlistData);

        const table = new Table({
            head: ["Ticker", "Latest News", "S-3", "Short Interest", "Float", "Price"],
            colWidths: [10, 85, 15, 10, 10, 10],
        });

        // Function to format short interest values for readability
        const formatShortInterest = (value) => {
            if (value === undefined || value === null) return "";
            if (value >= 1e9) return (value / 1e9).toFixed(1) + "B";
            if (value >= 1e6) return (value / 1e6).toFixed(1) + "M";
            if (value >= 1e3) return (value / 1e3).toFixed(1) + "k";
            return value.toString();
        };

        Object.values(tickers)
            .filter((ticker) => ticker.isActive && (!filterHeadlinesActive || (ticker.news && ticker.news.length > 0)))
            .forEach((ticker) => {
                const timestamp = ticker.news[0]?.updated_at || ticker.news[0]?.created_at;
                const latestNews = ticker.news[0]?.headline || "No news available";
                const dateObj = new Date(timestamp);
                const formattedTime = latestNews === "No news available" ? "" : dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                // Check if this ticker is in the watchlist
                const isInWatchlist = watchlist[ticker.ticker] !== undefined;

                // Get the latest filing for the ticker (update here based on new structure)
                const latestFiling = ticker.filings?.[0]; // Assuming filings is now an array of objects
                const filingInfo = latestFiling ? ` ${latestFiling.date}` : "";

                // Format the ticker for the table
                const formattedTicker = isInWatchlist ? chalk.black.yellow(ticker.ticker) : ticker.ticker;
                const coloredTicker = ticker.hod ? formattedTicker + chalk.cyanBright("*") : formattedTicker;

                // Format latest news with appropriate coloring
                let formattedNews = latestNews === "No news available" ? latestNews : `${formattedTime} - ${latestNews}`;
                if (lastDisplayedHeadlines[ticker.ticker] !== latestNews) {
                    formattedNews = chalk.black.yellow(formattedNews);
                } else if (isInWatchlist) {
                    formattedNews = chalk.yellow(formattedNews);
                }

                // Format price with color based on changes
                const previousPrice = previousPrices[ticker.ticker];
                let formattedPrice = ticker.price ? ticker.price : 0;
                if (previousPrice !== undefined) {
                    formattedPrice = previousPrice < ticker.price ? chalk.green(formattedPrice) : chalk.red(formattedPrice);
                }
                previousPrices[ticker.ticker] = ticker.price;

                // Add the ticker and its info to the table
                table.push([
                    coloredTicker,
                    formattedNews,
                    filingInfo,  // Updated to use `filingInfo`
                    ticker.shorts ? formatShortInterest(ticker.shorts["Short Interest"]) : "",
                    ticker.float || "",
                    formattedPrice,
                ]);

                // Update last displayed headline
                lastDisplayedHeadlines[ticker.ticker] = latestNews;
            });

        if (!verbose) console.clear();
        console.log(table.toString());
    } catch (err) {
        console.error("Error displaying tickers:", err);
    }
};


// Function to clear all tickers from both tickers.json and ticker.txt
const clearTickers = async () => {
    logVerbose("Clearing all tickers...");
    try {
        const tickers = await safeReadFile(tickerFilePath);

        Object.keys(tickers).forEach((ticker) => {
            tickers[ticker].isActive = false; // Mark all tickers as inactive
        });

        await safeWriteFile(tickerFilePath, tickers);
        console.log("All tickers marked as inactive.");

        await displayTickersTable();
    } catch (err) {
        console.error("Error clearing tickers:", err);
    }
};

// Function to append or update a ticker in the JSON file
// Function to append or update a ticker in the JSON file
const appendTicker = async (sanitizedTicker) => {
    logVerbose(`Appending ticker: ${sanitizedTicker}`);
    try {
        let data;
        try {
            data = await safeReadFile(tickerFilePath);
        } catch (err) {
            if (err.code === "ENOENT") {
                data = "{}";
            } else {
                throw err;
            }
        }

        const tickers = data;

        // If the ticker doesn't exist, create it
        if (!tickers[sanitizedTicker]) {
            tickers[sanitizedTicker] = {
                ticker: sanitizedTicker,
                news: [],
                isActive: true,
            }; // Add isActive
            console.log(`Ticker ${sanitizedTicker} added.`);
        } else {
            if (!tickers[sanitizedTicker].isActive) {
                tickers[sanitizedTicker].isActive = true; // Reactivate the ticker if it's inactive
                console.log(`Ticker ${sanitizedTicker} reactivated.`);
            } else {
                console.log(`Ticker ${sanitizedTicker} is already active.`);
            }
        }

        await safeWriteFile(tickerFilePath, tickers);
        await displayTickersTable(); // Display the updated tickers table

        // Copy ticker to clipboard and inform the user
        clipboardy.writeSync(sanitizedTicker); // Copy to clipboard
        console.log(`Ticker ${sanitizedTicker} has been copied to the clipboard.`); // Inform the user
    } catch (err) {
        console.error("Error appending ticker:", err);
    }
};

// Function to remove a ticker from both tickers.json and ticker.txt
const removeTicker = async (sanitizedTicker) => {
    logVerbose(`Removing ticker: ${sanitizedTicker}`);
    try {
        const tickers = await safeReadFile(tickerFilePath);

        if (tickers[sanitizedTicker]) {
            tickers[sanitizedTicker].isActive = false; // Mark as inactive
            await safeWriteFile(tickerFilePath, JSON.stringify(tickers, null, 2));
            console.log(`Ticker ${sanitizedTicker} marked as inactive in tickers.json.`);
        } else {
            console.log(`Ticker ${sanitizedTicker} not found in tickers.json.`);
        }

        await displayTickersTable();
    } catch (err) {
        console.error("Error removing ticker:", err);
    }
};

// Function to read tickers from a file and append to the JSON file
const readTickersFromFile = async (filePath) => {
    logVerbose(`Reading tickers from file: ${filePath}`);
    try {
        const data = await safeReadFile(filePath);

        // Ensure data is parsed as JSON in case it's an array of tickers
        const tickers = data
            .split("\n")
            .map((ticker) => sanitizeTicker(ticker))
            .filter((ticker) => ticker);

        for (const ticker of tickers) {
            await appendTicker(ticker);
        }
    } catch (err) {
        console.error("Error reading tickers from file:", err);
    }
};

// Function to toggle filtering of tickers without headlines
const toggleFilterHeadlines = () => {
    filterHeadlinesActive = !filterHeadlinesActive;
    const state = filterHeadlinesActive ? "active" : "inactive";
    console.log(`Filtering ${state}.`);
};

const clearUnwatchedTickers = async () => {
    logVerbose("Clearing tickers not on the watchlist...");
    try {
        // Read data from tickers.json
        let tickers = await safeReadFile(tickerFilePath);

        // Read data from watchlist.json
        const watchlistData = await fsPromises.readFile(watchlistFilePath, "utf8"); // Change here
        const watchlist = JSON.parse(watchlistData);

        // Iterate over tickers and deactivate those not in the watchlist
        Object.keys(tickers).forEach((ticker) => {
            if (!watchlist[ticker]) {
                tickers[ticker].isActive = false;
                logVerbose(`Ticker ${ticker} is not in the watchlist and has been deactivated.`);
            }
        });

        // Write updated tickers to tickers.json
        await safeWriteFile(tickerFilePath, tickers);
        console.log("Tickers not in the watchlist have been marked as inactive.");

        // Refresh the display to reflect updated tickers
        await displayTickersTable();
    } catch (err) {
        console.error("Error clearing unwatched tickers:", err);
    }
};

// Update the startListening function to include the new 'clear-unwatched' command
const startListening = () => {
    rl.on("line", async (line) => {
        const command = line.trim().toLowerCase();

        if (command.startsWith("add ")) {
            const ticker = sanitizeTicker(command.split(" ")[1]);
            if (ticker) {
                await appendTicker(ticker);
            }
        } else if (command.startsWith("rm ")) {
            const ticker = sanitizeTicker(command.split(" ")[1]);
            if (ticker) {
                await removeTicker(ticker);
            }
        } else if (command.startsWith("load ")) {
            const filePath = command.split(" ")[1];
            await readTickersFromFile(filePath);
        } else if (command === "clear-all") {
            clearTickers();
        } else if (command === "clear") {
            await clearUnwatchedTickers();
        } else if (command === "filter-healines") {
            toggleFilterHeadlines();
            await displayTickersTable();
        } else if (command.startsWith("wl ")) {
            const ticker = sanitizeTicker(command.split(" ")[1]);
            if (ticker) {
                await appendToWatchlist(ticker);
            }
        } else if (command.startsWith("unwl ")) {
            const ticker = sanitizeTicker(command.split(" ")[1]);
            if (ticker) {
                await removeFromWatchlist(ticker);
            }
        } else if (command === "exit") {
            rl.close();
        } else {
            console.log(`Unknown command: ${command}`);
        }
    });
};

// Watch for changes in tickers.json and trigger display
const startWatchingFile = () => {
    logVerbose("Watching for changes in tickers.json...");

    let previousTickers = {}; // Keep track of the previous state of tickers

    // Load the initial tickers state
    const loadPreviousTickers = async () => {
        try {
            previousTickers = await safeReadFile(tickerFilePath);
        } catch (err) {
            console.error("Error loading previous tickers:", err);
        }
    };

    loadPreviousTickers(); // Load the state when the app starts

    // Watch for changes in the tickers.json file
    chokidar.watch(tickerFilePath).on("change", async () => {
        logVerbose("Tickers.json changed, checking for new tickers...");
        try {
            const currentTickers = await safeReadFile(tickerFilePath);

            // Compare previous and current tickers to detect new additions
            for (const ticker in currentTickers) {
                if (!previousTickers[ticker]) {
                    // New ticker detected, copy it to the clipboard and notify the user
                    clipboardy.writeSync(ticker); // Copy to clipboard
                    console.log(`New ticker ${ticker} has been added and copied to the clipboard.`);
                }
            }

            // Update the previous tickers state
            previousTickers = currentTickers;

            // Call the display function to reflect the new data
            await displayTickersTable();
            logVerbose("Display updated after file change.");
        } catch (err) {
            console.error("Error updating display after tickers.json change:", err);
        }
    });
};

// Watch for changes in shorts.json and update tickers.json accordingly
const watchShortsFile = () => {
    const watcher = chokidar.watch(shortsFilePath);

    watcher.on("change", async () => {
        logVerbose("shorts.json changed."); // Simple log to confirm this runs

        try {
            // Attempt to read shorts.json asynchronously
            const shortsData = await fsPromises.readFile(shortsFilePath, "utf8");
            const parsedShortsData = JSON.parse(shortsData);
            const tickersData = await safeReadFile(tickerFilePath);

            let updated = false;

            // Merge shorts data into tickers.json only if there's new data
            for (const ticker in parsedShortsData) {
                if (parsedShortsData[ticker] && Object.keys(parsedShortsData[ticker]).length > 0) {
                    if (!tickersData[ticker]) {
                        tickersData[ticker] = { ticker, isActive: true };
                    }
                    tickersData[ticker].shorts = parsedShortsData[ticker];
                    updated = true;
                }
            }

            if (updated) {
                await safeWriteFile(tickerFilePath, tickersData);
                logVerbose("tickers.json updated with new shorts data.");
                await displayTickersTable(); // Refresh display
            } else {
                logVerbose("No new data found in shorts.json to update tickers.json.");
            }
        } catch (error) {
            console.error("Error updating tickers.json from shorts.json:", error);
        }
    });

    watcher.on("error", (error) => {
        console.error("Error watching shorts.json:", error);
    });
};

// Watch for changes in filings.json and update tickers.json accordingly
const watchFilingsFile = () => {
    const watcher = chokidar.watch(filingsFilePath);

    watcher.on("change", async () => {
        logVerbose("filings.json changed.");

        try {
            // Read filings.json data
            const filingsData = await fsPromises.readFile(filingsFilePath, "utf8");
            const parsedFilingsData = JSON.parse(filingsData);
            const tickersData = await safeReadFile(tickerFilePath);

            let updated = false;

            // Merge filings data into tickers.json only if there's new data
            for (const ticker in parsedFilingsData) {
                if (parsedFilingsData[ticker] && Object.keys(parsedFilingsData[ticker]).length > 0) {
                    if (!tickersData[ticker]) {
                        tickersData[ticker] = { ticker, isActive: true };
                    }
                    tickersData[ticker].filings = parsedFilingsData[ticker];
                    updated = true;
                }
            }

            if (updated) {
                await safeWriteFile(tickerFilePath, tickersData);
                logVerbose("tickers.json updated with new filings data.");
                await displayTickersTable();
            } else {
                logVerbose("No new data found in filings.json to update tickers.json.");
            }
        } catch (error) {
            console.error("Error updating tickers.json from filings.json:", error);
        }
    });

    watcher.on("error", (error) => {
        console.error("Error watching filings.json:", error);
    });
};

const checkAndCreateWatchlist = async () => {
    try {
        await fsPromises.readFile(watchlistFilePath, "utf8"); // Change here
    } catch (err) {
        if (err.code === "ENOENT") {
            // Create a new empty watchlist
            await fsPromises.writeFile(watchlistFilePath, "{}"); // Change here
            console.log("Watchlist file created.");
        } else {
            console.error("Error checking watchlist:", err);
        }
    }
};

// Initialize the application
const init = async () => {
    await checkAndWipeIfNeeded();
    await checkAndCreateWatchlist(); // Check and create watchlist
    await displayTickersTable();
    startListening();
    startWatchingFile();
    startTickerClearSchedule();
    watchShortsFile(); 
    watchFilingsFile(); // Watch filings.json for updates
};

// Start the application
init();
