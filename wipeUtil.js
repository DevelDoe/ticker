import fs from "fs/promises";

/**
 * Check and reset multiple JSON files based on the date in the time file.
 * @param {string} timeFilePath - Path to the file storing the last reset date.
 * @param {string[]} jsonFilePaths - Array of JSON file paths to reset.
 */
export const checkAndResetJsonFiles = async (timeFilePath, jsonFilePaths) => {
    const setToMidnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

    try {
        const currentDate = setToMidnight(new Date());
        let lastWipeDate;

        try {
            const lastWipeContent = await fs.readFile(timeFilePath, "utf8");
            lastWipeDate = setToMidnight(new Date(lastWipeContent));
        } catch (err) {
            if (err.code === "ENOENT") {
                lastWipeDate = null; // If the file doesn't exist, assume no previous wipe
            } else {
                throw err;
            }
        }

        if (!lastWipeDate || currentDate > lastWipeDate) {
            for (const jsonFilePath of jsonFilePaths) {
                await fs.writeFile(jsonFilePath, JSON.stringify({}, null, 2));
            }
            await fs.writeFile(timeFilePath, currentDate.toISOString());
        }
    } catch (err) {
        throw new Error(`Error resetting files: ${err.message}`);
    }
};
