import fs from 'fs/promises';
import readline from 'readline';

// Create an interface to ask for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to sanitize and capitalize the ticker symbol
const sanitizeTicker = (ticker) => {
  return ticker
    .toUpperCase()                   // Convert to uppercase
    .replace(/[^A-Z]/g, '');         // Remove any non-letter characters
};

// Function to prompt for ticker symbol
const promptForTicker = () => {
  rl.question("ticker: ", async (ticker) => {
    // Sanitize and capitalize the ticker
    const sanitizedTicker = sanitizeTicker(ticker);

    // Clear the console screen
    console.clear();

    try {
      // Save the sanitized ticker symbol to a file
      await fs.writeFile('ticker.txt', sanitizedTicker);
    } catch (err) {
      console.error('Error saving ticker symbol:', err);
    }

    // Prompt again
    promptForTicker();
  });
};

// Start the initial prompt
promptForTicker();