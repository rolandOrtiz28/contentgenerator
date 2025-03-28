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
You are a social media strategist. Based on the business context below, generate:
- 3 short key message ideas (3 to 5 words only)
- 1 specific AI instruction for content generation
- 1 suggested hook style (e.g., "shocking stat", "rhetorical question")
Make sure suggestions match the focus service, pillar, tone, platform, and target.

Tone: ${adjustedTone}
Format Trend: ${format}

Business:
- Company Name: ${companyName || "Unknown Company"}
- Description: ${description || "No description provided."}
- Services: ${services || "General services"}
- Focus Service: ${effectiveFocusService}
- Target Audience: ${targetAudience || "general audience"}
- Platform: ${socialMediaType || "Facebook Post"}
- Goal: ${goal || "Generate Leads"}
- Content Pillar: ${contentPillar || "Educate"}

Respond in plain text:
Key Messages: message 1, message 2, message 3
Specific AI Instruction: Create a ${socialMediaType} targeting ${targetAudience}. Focus on ${pillarVerb} content about ${effectiveFocusService} with a ${adjustedTone} tone. Use a format like: "${format}". Goal: ${goal}.
Suggested Hook: ${suggestedHook}
`;

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

    const lines = response.data.choices[0].message.content.split("\n").filter((line) => line.trim());
    const extract = (label) => lines.find((l) => l.startsWith(label))?.replace(label, "").split(",").map((x) => x.trim()) || [];
    const extractSingle = (label) => lines.find((l) => l.startsWith(label))?.replace(label, "").trim() || "";

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