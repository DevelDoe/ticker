// ticker.js

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
import { checkAndResetJsonFiles } from "./wipeUtil.js";


const verbose = process.argv.includes("-v"); // Check for verbose flag (-v)

// Define paths
const tickerFilePath = "tickers.json";
const lastWipeFilePath = "last-wipe.txt";
const watchlistFilePath = "watchlist.json"; // Path for the watchlist
const shortsFilePath = "shorts.json";
const filingsFilePath = "filings.json";
const financialsFilePath = "financials.json";
const newsFilePath = "news.json"; // Path for news.json

let filterHeadlinesActive = true; // State for filtering headlines
const lastDisplayedHeadlines = {}; // Initialize an object to keep track of the last displayed headlines
let previousHodStatus = {}; // Stores the previous HOD status of each ticker
let previousPrices = {}; // Stores the last price for each ticker, declared globally

// Create an interface to ask for input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

let lastPlayedTime = 0; // Track last playback time
const DEBOUNCE_INTERVAL = 10000; // 10 seconds

// Play WAV sound with debounce and tracking
function playWav(filePath, ticker = "", context = "") {
    const now = Date.now();
    if (now - lastPlayedTime < DEBOUNCE_INTERVAL) {
        logVerbose(`Debounced playback for ${ticker} (${context})`);
        return; // Skip playback if within debounce interval
    }

    lastPlayedTime = now; // Update last playback time
    player
        .play({ path: filePath })
        .then(() => {
            logVerbose(`Played sound for ${ticker} (${context}): ${filePath}`);
        })
        .catch((error) => {
            if (verbose) console.error(`Error playing file for ${ticker} (${context}):`, error);
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
    const localMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    return localMidnight;
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

// Function to format short interest values for readability
const formatShortInterest = (value) => {
    if (value === undefined || value === null) return "";
    if (value >= 1e9) return (value / 1e9).toFixed(1) + "B";
    if (value >= 1e6) return (value / 1e6).toFixed(1) + "M";
    if (value >= 1e3) return (value / 1e3).toFixed(1) + "k";
    return value.toString();
};

let lastPlayedHeadlines = {}; // Track played headlines for each ticker

const displayTickersTable = async () => {
    logVerbose("Displaying tickers in table format...");
    try {
        // Safely read the tickers, watchlist, and news data
        const tickers = await safeReadFile(tickerFilePath);
        const watchlistData = await fsPromises.readFile(watchlistFilePath, "utf8");
        const watchlist = JSON.parse(watchlistData);
        const newsData = await safeReadFile(newsFilePath);

        // Initialize the table with headers
        const table = new Table({
            head: ["Ticker", "News"],
            colWidths: [20, 145], // Adjusted width
        });

        // Filter and sort tickers
        let filteredTickers = Object.values(tickers).filter((ticker) => {
            const newsForTicker = newsData[ticker.ticker] || [];
            return ticker.isActive && (!filterHeadlinesActive || (Array.isArray(newsForTicker) && newsForTicker.length > 0));
        });

        if (filterHeadlinesActive) {
            filteredTickers.sort((a, b) => {
                const latestA = newsData[a.ticker]?.[0]?.added_at || 0;
                const latestB = newsData[b.ticker]?.[0]?.added_at || 0;
                return new Date(latestB) - new Date(latestA); // Sort by most recent headline timestamp
            });
        }

        // Loop through the filtered tickers and build the table rows
        filteredTickers.forEach((ticker) => {
            const newsForTicker = newsData[ticker.ticker] || [];
            const latestNewsObject = newsForTicker[0]; // Get the latest news for the ticker
            const timestamp = latestNewsObject?.added_at || null;
            const latestNews = latestNewsObject?.headline || "No news available";
            const dateObj = timestamp ? new Date(timestamp) : null;
            const formattedTime = dateObj
                ? dateObj.toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                      timeZone: "America/New_York",
                  })
                : "";

            const isInWatchlist = watchlist[ticker.ticker] !== undefined;

            // Check for S-3 filing and running at a loss
            const hasS3Filing = ticker.filings?.some((filing) => filing.formType === "S-3");
            const isRunningAtLoss = ticker.financials?.netCashFlow < 1;
            const flag = hasS3Filing && isRunningAtLoss;

            let formattedTicker = ticker.ticker; // Start with the base ticker

            if (ticker.shorts?.["Short Interest"]) {
                const shortInterestValue = ticker.shorts["Short Interest"];
                const shortInterest = formatShortInterest(shortInterestValue);

                // Apply color coding based on the short interest value
                const coloredShortInterest =
                    shortInterestValue < 1e6
                        ? chalk.green(shortInterest) // Green if < 1M
                        : shortInterestValue < 5e6
                        ? chalk.yellow(shortInterest) // Yellow if >= 1M and < 5M
                        : chalk.redBright(shortInterest); // Red if >= 5M

                formattedTicker += `(${coloredShortInterest})`; // Add colored short interest in parentheses
            }

            // Add HOD indicator if applicable
            if (ticker.hod) {
                formattedTicker += chalk.cyanBright("HOD"); // Add "HOD" indicator
            }

            // Add "POTSELL" indicator if flagged
            if (flag) {
                formattedTicker += chalk.red("POTSELL");
            }

            // Highlight in yellow if in watchlist
            if (isInWatchlist) {
                formattedTicker = chalk.black.yellow(formattedTicker);
            }

            // Highlight news keywords and add "#" if matched
            const keywords = ["Offering", "Registered Direct", "Private Placement", "Shares Open For Trade"];
            let formattedNews = latestNews === "No news available" ? latestNews : `${formattedTime} - ${latestNews}`;
            const matchedKeyword = keywords.some((keyword) => latestNews.includes(keyword));

            if (matchedKeyword) {
                formattedNews = chalk.bgRed.white(formattedNews); // Red background for keywords
                formattedTicker += chalk.redBright("SELLING");

                // Play siren.wav only if not played before
                if (!lastPlayedHeadlines[ticker.ticker]?.includes(latestNews)) {
                    playWav("./sounds/siren.wav");
                    lastPlayedHeadlines[ticker.ticker] = latestNews; // Mark this headline as played
                }
            } else if (!lastPlayedHeadlines[ticker.ticker]?.includes(latestNews)) {
                formattedNews = chalk.black.yellowBright(formattedNews); // Highlight for new news
                playWav("./sounds/flash.wav");
                lastPlayedHeadlines[ticker.ticker] = latestNews; // Mark this headline as played
            } else if (isInWatchlist) {
                formattedNews = chalk.yellow(formattedNews); // Highlight for watchlist
            } else {
                formattedNews = chalk.white(formattedNews);
            }

            // Add the row to the table
            table.push([formattedTicker, formattedNews]);
        });

        // Clear the console and display the table
        if (!verbose) console.clear();
        process.stdout.write("\x1Bc"); // Clear the console
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
        } else if (command === "toggle-hl") {
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
    logVerbose("Watching tickers.json for changes...");

    // Track the last known state
    let previousTickers = {};

    const handleFileChange = async () => {
        logVerbose("Detected change in tickers.json...");

        try {
            const currentTickers = await safeReadFile(tickerFilePath);

            // Detect new tickers
            Object.keys(currentTickers).forEach((ticker) => {
                if (!previousTickers[ticker]) {
                    clipboardy.writeSync(ticker);
                    // console.log(`New ticker ${ticker} detected and copied to clipboard.`);
                }
            });

            previousTickers = currentTickers; // Update the last known state
            await displayTickersTable(); // Refresh the table
        } catch (err) {
            console.error("Error handling file change:", err);
        }
    };

    chokidar
        .watch(tickerFilePath, {
            persistent: true,
            awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
        })
        .on("change", handleFileChange)
        .on("error", (err) => {
            console.error("Error watching tickers.json:", err);
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

// Watch for changes in financials.json and update tickers.json accordingly
const watchFinancialsFile = () => {
    const watcher = chokidar.watch(financialsFilePath);

    watcher.on("change", async () => {
        logVerbose("financials.json changed.");

        try {
            // Read financials.json data
            const financialsData = await fsPromises.readFile(financialsFilePath, "utf8");
            const parsedFinancialsData = JSON.parse(financialsData);
            const tickersData = await safeReadFile(tickerFilePath);

            let updated = false;

            // Merge financials data into tickers.json only if there's new data
            for (const ticker in parsedFinancialsData) {
                if (parsedFinancialsData[ticker] && Object.keys(parsedFinancialsData[ticker]).length > 0) {
                    if (!tickersData[ticker]) {
                        tickersData[ticker] = { ticker, isActive: true };
                    }
                    tickersData[ticker].financials = parsedFinancialsData[ticker];
                    updated = true;
                }
            }

            if (updated) {
                await safeWriteFile(tickerFilePath, tickersData);
                logVerbose("tickers.json updated with new financials data.");
                await displayTickersTable(); // Refresh display
            } else {
                logVerbose("No new data found in financials.json to update tickers.json.");
            }
        } catch (error) {
            console.error("Error updating tickers.json from financials.json:", error);
        }
    });

    watcher.on("error", (error) => {
        console.error("Error watching financials.json:", error);
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

const watchNewsFile = () => {
    chokidar
        .watch(newsFilePath, {
            persistent: true,
            awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
        })
        .on("change", async () => {
            logVerbose("Detected changes in news.json...");
            await displayTickersTable(); // Refresh the table
        })
        .on("error", (error) => {
            console.error("Error watching news.json:", error);
        });
};

// Function to periodically refresh the table
const startPeriodicRefresh = () => {
    logVerbose("Starting periodic table refresh...");

    // Track if the refresh is already in progress
    let isRefreshing = false;

    setInterval(async () => {
        if (isRefreshing) {
            logVerbose("Skipping periodic refresh - already in progress.");
            return;
        }

        isRefreshing = true;

        try {
            logVerbose("Periodic refresh triggered.");
            await displayTickersTable(); // Refresh the table
        } catch (err) {
            console.error("Error during periodic refresh:", err);
        } finally {
            isRefreshing = false;
        }
    }, 10000); // Refresh every 10 seconds
};

// Modify init() to include watchFinancialsFile
const init = async () => {
    console.log("Starting file reset process...");

    const filesToReset = [
        tickerFilePath,
        filingsFilePath,
        shortsFilePath,
        newsFilePath,
        financialsFilePath,
    ];

    try {
        await checkAndResetJsonFiles(lastWipeFilePath, filesToReset);
        console.log("File reset process completed.");
    } catch (err) {
        console.error("Error during file reset:", err.message);
    }

    await checkAndCreateWatchlist();
    await displayTickersTable(); // Initial display
    startListening(); // Start listening for user commands
    startWatchingFile(); // Watch for changes in tickers.json
    startTickerClearSchedule(); // Schedule clear checks
    watchShortsFile(); // Watch shorts.json for updates
    watchFilingsFile(); // Watch filings.json for updates
    watchFinancialsFile(); // Watch financials.json for updates
    watchNewsFile(); // Watch news.json for updates
    startPeriodicRefresh(); // Safeguard to refresh table every minute
};

// Start the application
init();
