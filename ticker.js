import fs from "fs/promises";
import readline from "readline";
import Table from "cli-table3";
import chokidar from "chokidar";
import notifier from "node-notifier";
import chalk from "chalk";

// Check for verbose flag (-v)
const verbose = process.argv.includes("-v");

// Create an interface to ask for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const tickerFilePath = "tickers.json";
const lastWipeFilePath = "lastWipeTicker.txt";
const legacyTickerFilePath = "ticker.txt"; // Legacy support
const watchlistFilePath = "watchlist.json"; // Path for the watchlist

let filterHeadlinesActive = false; // State for filtering headlines

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
    const lastWipeDateStr = await fs.readFile(lastWipeFilePath, "utf8");
    const lastWipeDate = new Date(lastWipeDateStr);
    const lastWipeAtMidnight = setToMidnight(lastWipeDate);
    const currentDateAtMidnight = setToMidnight(new Date());

    if (currentDateAtMidnight > lastWipeAtMidnight) {
      console.log("Wiping ticker files for a new day...");
      await fs.writeFile(tickerFilePath, "{}");
      await fs.writeFile(legacyTickerFilePath, "");
      await fs.writeFile(lastWipeFilePath, currentDateAtMidnight.toISOString());
      console.log("Ticker files wiped...");
    } else {
      logVerbose("No need to wipe ticker files today.");
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      const currentDateAtMidnight = setToMidnight(new Date());
      await fs.writeFile(tickerFilePath, "{}");
      await fs.writeFile(legacyTickerFilePath, "");
      await fs.writeFile(lastWipeFilePath, currentDateAtMidnight.toISOString());
      console.log("Ticker files created and wiped. Last wipe date set.");
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
    const tickerData = await fs.readFile(tickerFilePath, "utf8");
    const tickers = JSON.parse(tickerData);

    // Check if the ticker exists in tickers.json
    if (!tickers[sanitizedTicker]) {
      console.log(
        `Ticker ${sanitizedTicker} does not exist in tickers.json. Cannot add to watchlist.`
      );
      return; // Exit if the ticker does not exist
    }

    // Read the current watchlist
    const watchlistData = await fs.readFile(watchlistFilePath, "utf8");
    const watchlist = JSON.parse(watchlistData);

    // If the ticker doesn't exist in the watchlist, add it
    if (!watchlist[sanitizedTicker]) {
      watchlist[sanitizedTicker] = { ticker: sanitizedTicker };
      await fs.writeFile(watchlistFilePath, JSON.stringify(watchlist, null, 2));
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
    const data = await fs.readFile(watchlistFilePath, "utf8");
    const watchlist = JSON.parse(data);

    if (watchlist[sanitizedTicker]) {
      delete watchlist[sanitizedTicker];
      await fs.writeFile(watchlistFilePath, JSON.stringify(watchlist, null, 2));
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

// Initialize an object to keep track of the last displayed headlines
const lastDisplayedHeadlines = {};

// Function to display the tickers in a table format
const displayTickersTable = async () => {
  logVerbose("Displaying tickers in table format...");
  try {
    const data = await fs.readFile(tickerFilePath, "utf8");
    const tickers = JSON.parse(data);

    // Load watchlist data
    const watchlistData = await fs.readFile(watchlistFilePath, "utf8");
    const watchlist = JSON.parse(watchlistData);

    const table = new Table({
      head: ["Ticker", "Latest News", "Time", "Float"], // Added 'Float' column
      colWidths: [10, 55, 7, 10], // Adjusted column widths
    });

    // Create an array of tickers and sort by the latest news timestamp in descending order
    const sortedTickers = Object.values(tickers)
      .filter(
        (ticker) =>
          ticker.isActive && // Only display active tickers
          (!filterHeadlinesActive || (ticker.news && ticker.news.length > 0))
      ) // Apply filter if active
      .sort((a, b) => {
        const timestampA = new Date(
          a.news[0]?.updated_at || a.news[0]?.created_at
        );
        const timestampB = new Date(
          b.news[0]?.updated_at || b.news[0]?.created_at
        );
        return timestampB - timestampA; // Sort in descending order
      });

    // Inside displayTickersTable function
    sortedTickers.forEach((ticker) => {
      const latestNews = ticker.news[0]?.headline || "No news available"; // Safely access headline
      const timestamp =
        ticker.news[0]?.updated_at || ticker.news[0]?.created_at;
      const dateObj = new Date(timestamp);
      const formattedTime =
        latestNews === "No news available"
          ? ""
          : dateObj.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }); // Set empty string if no news

      // Check if this ticker is in the watchlist
      const isInWatchlist = watchlist[ticker.ticker] !== undefined;

      // Check if this is a new headline
      const isNewHeadline =
        lastDisplayedHeadlines[ticker.ticker] !== latestNews;

      const float = ticker.float ? `${ticker.float}` : "N/A"; // Handle float display, fallback to 'N/A'

      // Highlight the ticker if it is in the watchlist
      const coloredTicker = isInWatchlist
        ? chalk.black.yellow(ticker.ticker)
        : ticker.ticker;

      // Format the news headline
      let formattedNews = latestNews;
      if (isNewHeadline) {
        // Highlight new headlines in yellow
        formattedNews = chalk.black.yellow(latestNews);
      } else if (isInWatchlist) {
        // Highlight headlines in yellow if ticker is in the watchlist
        formattedNews = chalk.yellow(latestNews);
      }

      // Add the ticker and its news to the table with colored ticker and formatted news
      table.push([coloredTicker, formattedNews, formattedTime, float]); // Added float to table row

      // Update the last displayed headlines for this ticker
      lastDisplayedHeadlines[ticker.ticker] = latestNews;

      // Log the relevant values for debugging
      logVerbose(`Latest News for ${ticker.ticker}: ${latestNews}`);
      logVerbose(`Is new headline? ${isNewHeadline}`);

      // Send a notification for new headlines only if there is a headline
      if (isNewHeadline && latestNews !== "No news available") {
        notifier.notify({
          title: `${ticker.ticker}`,
          message: `${latestNews} (at ${formattedTime})`, // Include time in notification
          sound: true, // Only Notification Center or Windows Toasters
          wait: false, // Wait for user action
        });
      }
    });

    if (!verbose) console.clear(); // Clear the console before displaying the table
    console.log(table.toString());
  } catch (err) {
    console.error("Error displaying tickers:", err);
  }
};

// Function to clear all tickers from both tickers.json and ticker.txt
const clearTickers = async () => {
  logVerbose("Clearing all tickers...");
  try {
    const data = await fs.readFile(tickerFilePath, "utf8");
    const tickers = JSON.parse(data);

    Object.keys(tickers).forEach((ticker) => {
      tickers[ticker].isActive = false; // Mark all tickers as inactive
    });

    await fs.writeFile(tickerFilePath, JSON.stringify(tickers, null, 2));
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
      data = await fs.readFile(tickerFilePath, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") {
        data = "{}";
      } else {
        throw err;
      }
    }

    const tickers = JSON.parse(data);

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

    await fs.writeFile(tickerFilePath, JSON.stringify(tickers, null, 2));
    await displayTickersTable(); // Display the updated tickers table
  } catch (err) {
    console.error("Error appending ticker:", err);
  }
};

// Function to remove a ticker from both tickers.json and ticker.txt
const removeTicker = async (sanitizedTicker) => {
  logVerbose(`Removing ticker: ${sanitizedTicker}`);
  try {
    const data = await fs.readFile(tickerFilePath, "utf8");
    const tickers = JSON.parse(data);

    if (tickers[sanitizedTicker]) {
      tickers[sanitizedTicker].isActive = false; // Mark as inactive
      await fs.writeFile(tickerFilePath, JSON.stringify(tickers, null, 2));
      console.log(
        `Ticker ${sanitizedTicker} marked as inactive in tickers.json.`
      );
    } else {
      console.log(`Ticker ${sanitizedTicker} not found in tickers.json.`);
    }

    const legacyData = await fs.readFile(legacyTickerFilePath, "utf8");
    const tickersList = legacyData.split("\n").filter(Boolean);
    const updatedTickers = tickersList.filter(
      (ticker) => ticker !== sanitizedTicker
    );

    if (updatedTickers.length !== tickersList.length) {
      await fs.writeFile(
        legacyTickerFilePath,
        updatedTickers.join("\n") + "\n"
      );
      console.log(`Ticker ${sanitizedTicker} removed from ticker.txt.`);
    } else {
      console.log(`Ticker ${sanitizedTicker} not found in ticker.txt.`);
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
    const data = await fs.readFile(filePath, "utf8");
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
  console.log(`Filtering of tickers without headlines is now ${state}.`);
};

// Command line listener
const startListening = () => {
  rl.on("line", async (line) => {
    const command = line.trim();

    if (command.startsWith("add ")) {
      const ticker = sanitizeTicker(command.split(" ")[1]);
      if (ticker) {
        await appendTicker(ticker);
      }
    } else if (command.startsWith("remove ")) {
      // Add this block
      const ticker = sanitizeTicker(command.split(" ")[1]);
      if (ticker) {
        await removeTicker(ticker);
      }
    } else if (command.startsWith("load ")) {
      const filePath = command.split(" ")[1];
      await readTickersFromFile(filePath);
    } else if (command === "clear") {
      clearTickers();
    } else if (command === "toggle-filter") {
      toggleFilterHeadlines();
      await displayTickersTable(); // Display the table after toggling filter
    } else if (command.startsWith("wl ")) {
      const ticker = sanitizeTicker(command.split(" ")[1]);
      if (ticker) {
        await appendToWatchlist(ticker); // Add ticker to watchlist
      }
    } else if (command.startsWith("unwl ")) {
      // Command to remove a ticker
      const ticker = sanitizeTicker(command.split(" ")[1]);
      if (ticker) {
        await removeFromWatchlist(ticker); // Remove ticker from watchlist
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
  
  // Watch for changes in the tickers.json file
  chokidar.watch(tickerFilePath).on("change", async () => {
    logVerbose("Tickers.json changed, updating display...");
    
    try {
      // Call the display function to reflect the new data
      await displayTickersTable();
      logVerbose("Display updated after file change.");
    } catch (err) {
      console.error("Error updating display after tickers.json change:", err);
    }
  });
};

const checkAndCreateWatchlist = async () => {
  try {
    await fs.readFile(watchlistFilePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      // Create a new empty watchlist
      await fs.writeFile(watchlistFilePath, "{}");
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
};

// Start the application
init();
