import fs from "fs/promises";

// Track locked file paths with timestamps
const lockSet = new Map();
const lockTimeout = 10000; // Max wait time for acquiring the lock
const maxLockDuration = 20000; // Max time to hold a lock before forced release

// Acquire lock for safe file operations with retries
const acquireLock = async (filePath) => {
    const startTime = Date.now();
    while (lockSet.has(filePath)) {
        const lockStartTime = lockSet.get(filePath);

        // Force release lock if held too long
        if (Date.now() - lockStartTime >= maxLockDuration) {
            console.warn(`Warning: Lock on ${filePath} exceeded max duration. Forcing release.`);
            releaseLock(filePath);
            break;
        }

        // Retry with random delay if lock acquisition times out
        if (Date.now() - startTime >= lockTimeout) {
            throw new Error(`Timeout: Could not acquire lock for ${filePath}`);
        }
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
    }
    lockSet.set(filePath, Date.now()); // Acquire lock with timestamp
};

// Release lock after file operation
const releaseLock = (filePath) => {
    if (lockSet.has(filePath)) {
        lockSet.delete(filePath);
    }
};

// Safely read file with JSON parsing
export const safeReadFile = async (filePath) => {
    await acquireLock(filePath);
    try {
        const data = await fs.readFile(filePath, "utf8");
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading file at ${filePath}:`, error);
        return {};
    } finally {
        releaseLock(filePath);
    }
};

// Safely write JSON data to file without nested locking
export const safeWriteFile = async (filePath, newData) => {
    await acquireLock(filePath); // Acquire the initial lock
    try {
        // Directly read current data without acquiring a lock to avoid nested locking issues
        const currentDataRaw = await fs.readFile(filePath, "utf8");
        const currentData = JSON.parse(currentDataRaw);

        // Merge current data with new data (newData takes precedence)
        const mergedData = { ...currentData, ...newData };
        const jsonData = JSON.stringify(mergedData, null, 2);

        // Write merged data to the file
        await fs.writeFile(filePath, jsonData, "utf8");
        console.log(`File written successfully to ${filePath}`);
    } catch (error) {
        console.error(`Error writing file at ${filePath}:`, error);
        throw error;
    } finally {
        releaseLock(filePath); // Ensure the lock is released
    }
};

