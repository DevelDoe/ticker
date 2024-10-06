// index.js
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import chokidar from 'chokidar';
import dotenv from 'dotenv';

// Load environment variables from .env-git file
dotenv.config({ path: '.env-git' });
const MAJOR_VERSION = process.env.MAJOR || '0';
let MINOR_VERSION = parseInt(process.env.MINOR || '0');

// Verbose mode flag
const VERBOSE_MODE = process.argv.includes('-v');

// Log function for verbose output
const log = (message) => {
    if (VERBOSE_MODE) {
        console.log(message);
    }
};

// Function to increment minor version
const incrementMinorVersion = () => {
    log(`Current minor version: ${MINOR_VERSION}`);
    MINOR_VERSION += 1;
    log(`Incrementing minor version to: ${MINOR_VERSION}`);
    fs.writeFileSync('.env-git', `MAJOR=${MAJOR_VERSION}\nMINOR=${MINOR_VERSION}`, 'utf8');
};

// Function to commit and push changes
const commitAndPush = () => {
    exec('git status --porcelain', (error, stdout) => {
        if (error) {
            log(`Error checking git status: ${error.message}`);
            return;
        }
        
        // If stdout is empty, there are no changes to commit
        if (!stdout.trim()) {
            log('No changes to commit.');
            return; // Exit early if no changes
        }

        log(`Detected changes. Preparing to commit...`);
        
        // Stage changes
        exec('git add .', (addError) => {
            if (addError) {
                log(`Failed to stage changes: ${addError.message}`);
                return;
            }
            
            const commitMessage = `update v${MAJOR_VERSION}.${MINOR_VERSION}`;
            exec(`git commit -m '${commitMessage}'`, (commitError) => {
                if (commitError) {
                    log(`Commit failed: ${commitError.message}`);
                    return;
                }
                log(`Committed: ${commitMessage}`);
                exec('git push', (pushError) => {
                    if (pushError) {
                        log(`Push failed: ${pushError.message}`);
                        return;
                    }
                    log('Changes pushed successfully.');
                });
            });
        });
    });
};



// Function to read .gitignore and return ignored patterns
const getIgnoredPatterns = () => {
    try {
        const data = fs.readFileSync('.gitignore', 'utf8');
        // Add .git to ignored patterns
        const ignoredPatterns = data.split('\n').map(pattern => pattern.trim()).filter(Boolean);
        ignoredPatterns.push('.git'); // Explicitly ignore .git directory
        return ignoredPatterns;
    } catch (error) {
        log(`Failed to read .gitignore: ${error.message}`);
        return [];
    }
};

// Function to check if a path should be ignored
const shouldIgnorePath = (filePath, ignoredPatterns) => {
    return ignoredPatterns.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*')); // Convert glob to regex
        return regex.test(filePath);
    });
};

// Function to watch the directory for changes
const watchDirectory = (dir) => {
    const ignoredPatterns = getIgnoredPatterns();
    chokidar.watch(dir, { ignored: (path) => shouldIgnorePath(path, ignoredPatterns) })
        .on('all', (event, filePath) => {
            log(`File ${filePath} has been changed. Event: ${event}`);
            incrementMinorVersion();
            commitAndPush();
        });
};

// Start watching the directory
const start = () => {
    const watchDir = '.'; // Specify the directory to watch
    log(`Watching for changes in ${watchDir}...`);
    watchDirectory(watchDir);
};

// Execute the main function
start();
