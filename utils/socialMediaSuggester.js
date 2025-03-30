const axios = require("axios");

const perplexityApi = axios.create({
  baseURL: "https://api.perplexity.ai",
  headers: {
    Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json",
  },
});

const cache = new Map();

const fetchFromPerplexity = async (query) => {
  if (cache.has(query)) return cache.get(query);
  try {
    const response = await perplexityApi.post("/chat/completions", {
      model: "sonar-pro",
      messages: [{ role: "user", content: query }],
      max_tokens: 100,
      temperature: 0.7,
    });
    const result = response.data.choices[0].message.content.trim().split("\n");
    cache.set(query, result);
    return result;
  } catch (err) {
    console.error("Perplexity Fetch Error:", err);
    return [];
  }
};

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
  const suggestedHook = hookTypes[Math.floor(Math.random() * hookTypes.length)]; // Suggest a hook, but don't enforce it

  const goalVerb = (goal || "Generate Leads").toLowerCase();
  const pillarVerbMap = { Educate: "educating", Entertain: "entertaining", Inspire: "inspiring", Promote: "promoting" };
  const pillarVerb = pillarVerbMap[contentPillar] || "educating";

  const trendQuery = `What are the top-performing ${socialMediaType} formats to ${goalVerb} in ${effectiveFocusService} for ${targetAudience} audiences in 2025?`;
  const trendInsights = await fetchFromPerplexity(trendQuery);
  const format = trendInsights[0]?.length > 10 ? trendInsights[0] : "simple, visual-first post";

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
    const response = await perplexityApi.post("/chat/completions", {
      model: "sonar-pro",
      messages: [
        { role: "system", content: "Generate social media suggestions. Respond in plain text only." },
        { role: "user", content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });
    console.log("Raw Perplexity Response:\n", response.data.choices[0].message.content);
    const lines = response.data.choices[0].message.content.split("\n").filter((line) => line.trim());

    // Updated extract function to handle numbered list format
    const extract = (label) => {
      const index = lines.findIndex((line) =>
        line.toLowerCase().startsWith(label.toLowerCase())
      );
      if (index === -1) return [];
    
      const raw = lines[index];
      const cleaned = raw.split(":")[1] || raw.split("–")[1] || raw.split("-")[1];
      if (!cleaned) return [];
    
      if (cleaned.includes(",")) {
        return cleaned.split(",").map((item) => item.trim()).filter(Boolean);
      }
    
      // fallback if numbered format below the line
      const messages = [];
      for (let i = index + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^\d+\.\s/.test(line)) {
          messages.push(line.replace(/^\d+\.\s*/, "").trim());
        } else {
          break;
        }
      }
      return messages;
    };

    // Updated extractSingle function to handle single-line instruction
    const extractSingle = (label) => {
      const index = lines.findIndex((line) =>
        line.toLowerCase().startsWith(label.toLowerCase())
      );
      if (index === -1) return "";
    
      const raw = lines[index];
      const cleaned = raw.split(":")[1] || raw.split("–")[1] || raw.split("-")[1];
      return cleaned ? cleaned.trim() : "";
    };

    return {
      suggestedKeyMessages: extract("Key Messages:"),
      suggestedSpecificInstructions: extractSingle("Specific AI Instruction:"),
      suggestedHook: extractSingle("Suggested Hook:"),
    };
  } catch (err) {
    console.error("Perplexity Suggestion Error:", err);
    return { suggestedKeyMessages: [], suggestedSpecificInstructions: "", suggestedHook: "" };
  }
};

module.exports = { suggestSocialMediaDetails };