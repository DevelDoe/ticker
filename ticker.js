import fs from 'fs/promises';
import readline from 'readline';

// Create an interface to ask for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to prompt for ticker symbol
const promptForTicker = () => {
  rl.question("What's the ticker symbol? ", async (ticker) => {
    // Clear the console screen
    console.clear();

    try {
      // Save the ticker symbol to a file
      await fs.writeFile('ticker.txt', ticker);
      console.log(`Ticker symbol '${ticker}' has been saved.`);
    } catch (err) {
      console.error('Error saving ticker symbol:', err);
    }

    // Prompt again
    promptForTicker();
  });
};

// Start the initial prompt
promptForTicker();
