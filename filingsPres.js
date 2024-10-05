import fs from 'fs';
import path from 'path';
import cliTable3 from 'cli-table3';

// Define the path for the JSON file
const outputFilePath = path.join(process.cwd(), 's3_filings.json');

let isVerbose = false;

// Define the maximum length for the description column
const MAX_DESCRIPTION_LENGTH = 45; // Adjust as needed to prevent wrapping

// Function to read and parse JSON file
const readFilingsFromFile = () => {
    if (!fs.existsSync(outputFilePath)) {
        console.log('No filings data found.');
        return [];
    }

    const data = fs.readFileSync(outputFilePath, 'utf8');
    return JSON.parse(data);
};

// Function to truncate text if it exceeds a certain length
const truncateText = (text, maxLength) => {
    if (text.length > maxLength) {
        return text.slice(0, maxLength) + '...'; // Append ellipsis if truncated
    }
    return text;
};

// Function to present the filings data in a table format
const displayTable = () => {
    const filingsData = readFilingsFromFile();
    if (filingsData.length === 0) {
        console.log('No S-3 filings to display.');
        return;
    }

    // Create a table with headers for Ticker, Form Type, Description, and Date
    const table = new cliTable3({
        head: ['Ticker', 'Form Type', 'Description', 'Date'],
        colWidths: [10, 10, 50, 15], // Adjust column widths as needed
        wordWrap: true
    });

    // Loop through each ticker's filings
    filingsData.forEach(({ ticker, filings }) => {
        // Sort filings by date (oldest to newest)
        const sortedFilings = filings.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Add sorted filings to the table
        sortedFilings.forEach(filing => {
            table.push([
                ticker.toUpperCase(),
                filing.formType,
                truncateText(filing.description, MAX_DESCRIPTION_LENGTH),
                filing.date
            ]);
        });
    });

    console.log(table.toString());
};

// Function to watch the JSON file for changes and update the table
const watchFile = () => {
    let fileChangeTimeout;

    fs.watch(outputFilePath, (eventType) => {
        if (eventType === 'change') {
            if (fileChangeTimeout) {
                clearTimeout(fileChangeTimeout);
            }

            fileChangeTimeout = setTimeout(() => {
                if(isVerbose) console.log('Detected change in filings data. Updating table...');
                if(!isVerbose) console.clear()
                displayTable();
            }, 500); // Debounce file changes
        }
    });
};

// Initial display of the table
displayTable();
watchFile();
