const perplexityApi = require("axios").create({
  baseURL: "https://api.perplexity.ai",
  headers: {
    Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json",
  },
});

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
  } = businessDetails;

  const effectiveFocusService =
    focusService ||
    (typeof services === "string"
      ? services.split(",").map((s) => s.trim())[0]
      : null) ||
    "business solutions";

  const prompt = `
You are a social media strategist. Based on the business context below, generate:
- 3 short key message ideas (3 to 5 words only) tailored to the specified social media platform and goal
- 1 specific AI instruction to guide content generation, ensuring it aligns with the platform, goal, and focus service
Do NOT include ad details.
Ensure messages and instruction are highly relevant to the focus service, content pillar, goal, and platform.

Business:
- Company Name: ${companyName || "Unknown Company"}
- Description: ${description || "No description provided."}
- Services: ${services || "General services"}
- Focus Service: ${effectiveFocusService}
- Target Audience: ${targetAudience || "general audience"}
- Social Media Platform: ${socialMediaType || "Facebook Post"}
- Goal: ${goal || "Generate Leads"}
- Content Pillar: ${contentPillar || "Educate"}

Respond in plain text:
Key Messages: message 1, message 2, message 3
Specific AI Instruction: Generate a 150-word ${socialMediaType || "Facebook Post"} to ${goal.toLowerCase() || "promote"} the ${effectiveFocusService} for ${targetAudience || "general audience"}, focusing on ${contentPillar.toLowerCase() || "educate"} content.
`;

  try {
    const response = await perplexityApi.post("/chat/completions", {
      model: "sonar-pro",
      messages: [
        {
          role: "system",
          content: "Generate social media suggestions. Respond in plain text only. No markdown.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const lines = response.data.choices[0].message.content.split("\n").filter((line) => line.trim());

    const extract = (label) => {
      const line = lines.find((l) => l.startsWith(label));
      return line
        ? line.replace(label, "").split(",").map((x) => x.trim()).filter(Boolean)
        : [];
    };

    const extractSingle = (label) => {
      const line = lines.find((l) => l.startsWith(label));
      return line ? line.replace(label, "").trim() : "";
    };

    return {
      suggestedKeyMessages: extract("Key Messages:"),
      suggestedSpecificInstructions: extractSingle("Specific AI Instruction:"),
    };
  } catch (err) {
    console.error("Perplexity Suggestion Error:", err);
    return {
      suggestedKeyMessages: [],
      suggestedSpecificInstructions: "",
    };
  }
};

module.exports = { suggestSocialMediaDetails };