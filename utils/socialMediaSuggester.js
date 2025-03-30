require("dotenv").config();
const { getSuggestionsWithFallback } = require("./suggestionFetcher");

const cache = new Map();

const suggestSocialMediaDetails = async (businessDetails) => {
  const {
    companyName,
    description,
    services,
    focusService,
    targetAudience,
    socialMediaType,
    goal,
    contentPillar,
    brandTone,
  } = businessDetails;

  const effectiveFocusService =
    focusService || (typeof services === "string" ? services.split(",").map((s) => s.trim())[0] : null) || "business solutions";

  let adjustedTone = brandTone || "professional";
  if (contentPillar === "Entertain" && adjustedTone === "professional") adjustedTone = "witty and playful";
  else if (contentPillar === "Inspire") adjustedTone = "motivational";
  else if (contentPillar === "Promote") adjustedTone = "bold";

  const hookTypes = ["shocking stat", "rhetorical question", "common myth", "quick tip", "relatable scenario"];
  const suggestedHook = hookTypes[Math.floor(Math.random() * hookTypes.length)];

  const goalVerb = (goal || "Generate Leads").toLowerCase();
  const pillarVerbMap = { Educate: "educating", Entertain: "entertaining", Inspire: "inspiring", Promote: "promoting" };
  const pillarVerb = pillarVerbMap[contentPillar] || "educating";

  const trendQuery = `What are the top-performing ${socialMediaType} formats to ${goalVerb} in ${effectiveFocusService} for ${targetAudience} audiences in 2025?`;
  const trendInsights = await getSuggestionsWithFallback(trendQuery);
  const format = trendInsights.text?.split("\n")[0] || "simple, visual-first post";

  const prompt = `
You are a social media strategist. Based on the business information and selected content configuration below, generate the following:

1. Key Messages – give exactly 3 ideas (3-5 words only).
2. Specific AI Instruction – one full sentence that tells the AI **how to write** the post **based on the user's selected preferences** including platform, goal, content pillar, brand tone, and focus service. Mention these choices explicitly when applicable.
3. You must incorporate the selected **Hook Style** into the content format and reference it clearly in the instruction.

Business Details:
- Company Name: ${companyName}
- Description: ${description}
- Services: ${services}
- Focus Service: ${effectiveFocusService}
- Target Audience: ${targetAudience}

User-Selected Content Configuration:
- Platform: ${socialMediaType}
- Goal: ${goal}
- Content Pillar: ${contentPillar}
- Brand Tone: ${adjustedTone}
- Suggested Hook Style: ${suggestedHook}
- Format Trend: ${format}

Respond in plain text with exactly 2 sections:
"Key Messages:" followed by the 3 ideas, and "Specific AI Instruction:" followed by 1 sentence.
`;

  console.log("Final Perplexity Prompt:\n", prompt);

  try {
    const result = await getSuggestionsWithFallback(prompt);
    console.log(`Suggestions from: ${result.source}`);
    const lines = result.text.split("\n").filter((line) => line.trim());

    // Flexible extraction for Key Messages
    const extractKeyMessages = () => {
      const startIndex = lines.findIndex((line) => line.toLowerCase().startsWith("key messages:"));
      if (startIndex === -1) return [];
      const messages = [];
      for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        // Handle both bullet points (-) and numbered items (1., 2., etc.)
        if (line.startsWith("-") || /^\d+\./.test(line)) {
          const cleaned = line.replace(/^[-]|\d+\./, "").trim();
          if (cleaned) messages.push(cleaned);
        } else if (line.toLowerCase().startsWith("specific ai instruction:")) {
          break; // Stop at next section
        }
      }
      return messages.slice(0, 3); // Ensure exactly 3 messages
    };

    // Flexible extraction for Specific AI Instruction
    const extractSpecificInstruction = () => {
      const index = lines.findIndex((line) => line.toLowerCase().startsWith("specific ai instruction:"));
      if (index === -1) return "";
      const raw = lines[index];
      // Extract everything after the colon, or take the next line if colon is empty
      const afterColon = raw.split(":")[1]?.trim();
      return afterColon || (lines[index + 1] ? lines[index + 1].trim() : "");
    };

    const keyMessages = extractKeyMessages();
    const specificInstruction = extractSpecificInstruction();

    // Fallback if parsing fails
    if (keyMessages.length === 0 || !specificInstruction) {
      console.warn("Parsing failed, returning defaults");
      return {
        suggestedKeyMessages: ["Boost your online presence.", "Engage your audience.", "Drive more leads."],
        suggestedSpecificInstructions: `Write a ${socialMediaType} post for ${goal} using ${adjustedTone} tone.`,
        suggestedHook,
      };
    }

    const suggestions = {
      suggestedKeyMessages: keyMessages,
      suggestedSpecificInstructions: specificInstruction,
      suggestedHook,
    };

    console.log("Parsed suggestions:", suggestions);
    return suggestions;
  } catch (err) {
    console.error("Suggestion Fetch Error:", err.message);
    return {
      suggestedKeyMessages: ["Boost your online presence.", "Engage your audience.", "Drive more leads."],
      suggestedSpecificInstructions: `Write a ${socialMediaType} post for ${goal} using ${adjustedTone} tone.`,
      suggestedHook,
    };
  }
};

module.exports = { suggestSocialMediaDetails };
