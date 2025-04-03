const { jsonrepair } = require("jsonrepair");
const { logAndEmitError } = require("../socket");

const sanitizeAndRepairJson = (input) => {
  try {
    // Normalize and escape problematic characters
    let cleaned = input
      .replace(/\r\n|\n|\r/g, " ") // Normalize line breaks
      .replace(/\\(?!["\\\/bfnrtu])/g, "\\\\") // Escape lone backslashes
      .replace(/[\u0000-\u001F]+/g, " ") // Remove control chars
      .replace(/[“”]/g, '"') // Replace curly quotes
      .replace(/[’]/g, "'") // Replace curly apostrophes
      .replace(/\s+/g, " ") // Collapse whitespace
      .trim();

    // Try using jsonrepair first
    const repaired = jsonrepair(cleaned);
    return JSON.parse(repaired);

  } catch (err) {
    console.warn("Initial JSON repair failed:", err.message);

    let fixed = input
      .replace(/\r\n|\n|\r/g, " ")
      .replace(/\\(?!["\\\/bfnrtu])/g, "\\\\")
      .replace(/[\u0000-\u001F]+/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/\s+/g, " ")
      // Fix keys without quotes
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
      // Fix unquoted string values (basic safety)
      .replace(/:\s*([a-zA-Z0-9_\-\/@.]+)(?=[,\]}])/g, ':"$1"')
      // Remove trailing commas
      .replace(/,\s*([}\]])/g, "$1")
      .trim();

    // Balance brackets
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/]/g) || []).length;

    if (openBraces > closeBraces) fixed += "}".repeat(openBraces - closeBraces);
    if (openBrackets > closeBrackets) fixed += "]".repeat(openBrackets - closeBrackets);

    try {
      return JSON.parse(fixed);
    } catch (parseError) {
      logAndEmitError("Manual JSON fix failed:", parseError.message, parseError.stack);
      throw new Error("Unable to repair JSON response");
    }
  }
};

module.exports = { sanitizeAndRepairJson };
