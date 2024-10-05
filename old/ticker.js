import fs from 'fs/promises';
import readline from 'readline';

// Check for verbose flag (-v)
const verbose = process.argv.includes('-v');

// Create an interface to ask for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const tickerFilePath = 'tickers.json';
const lastWipeFilePath = 'lastWipeTicker.txt';

// ====== Legacy Support for ticker.txt ======
const legacyTickerFilePath = 'ticker.txt';
// ====== End of Legacy Support ======

// Function to log verbose messages
const logVerbose = (message) => {
  if (verbose) {
    console.log(`VERBOSE: ${message}`);
  }
};

// Function to sanitize and capitalize the ticker symbol
const sanitizeTicker = (ticker) => {
  const sanitized = ticker
    .toUpperCase()                   // Convert to uppercase
    .replace(/[^A-Z]/g, '');         // Remove any non-letter characters
  logVerbose(`Sanitized ticker: ${sanitized}`);
  return sanitized;
};

// Function to set a date to midnight (00:00:00)
const setToMidnight = (date) => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);  // Set time to 00:00:00.000
  return newDate;
};

// Function to check if the ticker files need to be wiped
const checkAndWipeIfNeeded = async () => {
  logVerbose('Checking if the ticker files need to be wiped...');
  try {
    const lastWipeDateStr = await fs.readFile(lastWipeFilePath, 'utf8');
    logVerbose(`Last wipe date (raw): ${lastWipeDateStr}`);
    
    const lastWipeDate = new Date(lastWipeDateStr);
    const lastWipeAtMidnight = setToMidnight(lastWipeDate);
    const currentDateAtMidnight = setToMidnight(new Date());

    logVerbose(`Last wipe date (midnight): ${lastWipeAtMidnight}`);
    logVerbose(`Current date (midnight): ${currentDateAtMidnight}`);

    // Check if it's a new day
    if (currentDateAtMidnight > lastWipeAtMidnight) {
      console.log('Wiping ticker files for a new day...');
      
      // Wipe both tickers.json and legacy ticker.txt
      await fs.writeFile(tickerFilePath, '{}'); // Reset the JSON file to an empty object
      await fs.writeFile(legacyTickerFilePath, ''); // Wipe the old ticker.txt file

      await fs.writeFile(lastWipeFilePath, currentDateAtMidnight.toISOString()); // Update the wipe date
      console.log('Ticker files wiped...');
      logVerbose('Ticker files successfully wiped and date updated.');
    } else {
      logVerbose('No need to wipe ticker files today.');
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      logVerbose('lastWipeFile not found. Creating it and wiping the ticker files.');
      const currentDateAtMidnight = setToMidnight(new Date());
      
      // Create and wipe both files
      await fs.writeFile(tickerFilePath, '{}'); // Reset the JSON file to an empty object
      await fs.writeFile(legacyTickerFilePath, ''); // Wipe the old ticker.txt file
      await fs.writeFile(lastWipeFilePath, currentDateAtMidnight.toISOString()); // Create the last wipe file

      console.log('Ticker files created and wiped. Last wipe date set.');
      logVerbose('Ticker files created and last wipe date file initialized.');
    } else {
      console.error('Error checking wipe status:', err);
      logVerbose(`Error during wipe check: ${err.message}`);
    }
  }
};

// Function to append or update a ticker in the JSON file
const appendTicker = async (sanitizedTicker) => {
  logVerbose(`Appending ticker: ${sanitizedTicker}`);
  try {
    // ====== JSON file logic ======
    // Read the current contents of the JSON file (or create an empty object if it doesn't exist)
    let data;
    try {
      data = await fs.readFile(tickerFilePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        logVerbose('tickers.json not found. Creating a new file.');
        data = '{}'; // Initialize as an empty object
      } else {
        throw err; // If the error is not ENOENT, re-throw it
      }
    }

    // Parse the JSON data
    const tickers = JSON.parse(data);

    logVerbose(`Current tickers in JSON file: ${JSON.stringify(tickers, null, 2)}`);

    // Update the ticker object (additional fields can be added in the future)
    tickers[sanitizedTicker] = {
      ticker: sanitizedTicker,
      updatedAt: new Date().toISOString(), // You can store more data here in the future
    };

    // Write the updated object back to the JSON file
    await fs.writeFile(tickerFilePath, JSON.stringify(tickers, null, 2));
    logVerbose(`Ticker ${sanitizedTicker} written to JSON file.`);
    
    // ====== End of JSON file logic ======

    // ====== Legacy ticker.txt logic ======
    // Read the current contents of the ticker.txt file
    const legacyData = await fs.readFile(legacyTickerFilePath, 'utf8');
    const tickersList = legacyData.split('\n').filter(Boolean); // Split lines and filter out empty lines

    logVerbose(`Current tickers in legacy ticker.txt: ${tickersList}`);

    // Remove all occurrences of the sanitized ticker
    const updatedTickers = tickersList.filter(ticker => ticker !== sanitizedTicker);

    // Append the new ticker to the list
    updatedTickers.push(sanitizedTicker);

    // Write the updated list back to the ticker.txt file
    await fs.writeFile(legacyTickerFilePath, updatedTickers.join('\n') + '\n');
    logVerbose(`Ticker ${sanitizedTicker} written to legacy ticker.txt file.`);
    // ====== End of Legacy ticker.txt logic ======

  } catch (err) {
    console.error('Error appending ticker symbol:', err);
    logVerbose(`Error appending ticker: ${err.message}`);
  }
};

// Function to prompt for ticker symbol
const promptForTicker = () => {
  rl.question('Ticker: ', async (ticker) => {
    // Sanitize and capitalize the ticker
    const sanitizedTicker = sanitizeTicker(ticker);

    // Clear the console screen
    console.clear();
    logVerbose(`Processing ticker: ${sanitizedTicker}`);

    try {
      // Append the ticker, ensuring no duplicates
      await appendTicker(sanitizedTicker);
    } catch (err) {
      console.error('Error handling ticker:', err);
      logVerbose(`Error during ticker processing: ${err.message}`);
    }

    // Prompt again
    promptForTicker();
  });
};

// Run checkAndWipeIfNeeded on script start (boot)
const boot = async () => {
  logVerbose('Boot process started.');
  await checkAndWipeIfNeeded(); // Check and wipe before prompting for input
  promptForTicker();            // Start the initial prompt after wipe check
  logVerbose('Boot process finished.');
};

// Start the boot process
boot();