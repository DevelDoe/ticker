// filtered-websocket.mjs

import WebSocket from 'ws';
import dotenv from 'dotenv';

// Load environment variables from .env.finnhub file
dotenv.config({ path: '.env.finnhub' });

// Get API key from environment variable
const API_KEY = process.env.FINNHUB_API_KEY;

// Check if API key is defined
if (!API_KEY) {
  console.error('API key is not defined. Check your .env.finnhub file.');
  process.exit(1);
}

// Check for verbose mode
const verbose = process.argv.includes('-v');

// Finnhub WebSocket endpoint
const WS_URL = `wss://ws.finnhub.io?token=${API_KEY}`;

// List of stock symbols to subscribe to
const symbols = ['AAPL', 'GOOGL', 'MSFT']; // Example symbols

// Define price range for filtering
const MIN_PRICE = 1;
const MAX_PRICE = 15;

// Create WebSocket client
const createWebSocketClient = () => {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    if (verbose) {
      console.log('Connected to Finnhub WebSocket API.');
    }

    // Subscribe to each symbol
    symbols.forEach(symbol => {
      const subscribeMessage = JSON.stringify({
        type: 'subscribe',
        symbol: symbol
      });
      if (verbose) {
        console.log(`Sending subscription message: ${subscribeMessage}`);
      }
      ws.send(subscribeMessage);
    });
  });

  ws.on('message', (data) => {
    if (verbose) {
      console.log('Received raw message:', data);
    }

    try {
      const message = JSON.parse(data);

      // Display the full message if in verbose mode
      if (verbose) {
        console.log('Parsed message:', message);
      }

      // Handle specific symbols
      if (message.s) {
        // Filter based on price range
        if (message.p && message.p >= MIN_PRICE && message.p <= MAX_PRICE) {
          console.log(`Price update for ${message.s} within range:`, message);
        } else if (verbose) {
          console.log(`Price update for ${message.s} outside range:`, message);
        }
      }
    } catch (error) {
      console.error('Error parsing message:', error.message);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed. Reconnecting...');
    // Reconnect after a delay
    setTimeout(createWebSocketClient, 5000);
  });
};

// Start the WebSocket client
createWebSocketClient();
