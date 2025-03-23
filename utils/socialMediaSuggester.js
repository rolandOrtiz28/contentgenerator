const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const suggestSocialMediaDetails = async (businessDetails) => {
  console.log("OpenAI API Key:", process.env.OPENAI_API_KEY ? "Set" : "Not set");
  console.log("Business Details for Suggestion:", businessDetails);

  const { companyName, description, services, focusService, targetAudience, socialMediaType, purpose, contentPillar } = businessDetails;

  const effectiveFocusService = focusService || (typeof services === "string" ? services.split(",").map((s) => s.trim())[0] : null) || "business solutions";

  const prompt = `
You are a social media marketing expert. Based on the following business details, provide suggestions for a social media post's key message and ad details. The suggestions must be highly relevant to the focus service, target audience, and social media type, and align with the purpose and content pillar.

Business Details:
- Company Name: ${companyName || "Unknown Company"}
- Description: ${description || "No description provided."}
- Services: ${services || "General services"}
- Focus Service: ${effectiveFocusService}
- Target Audience: ${targetAudience || "general audience"}
- Social Media Type: ${socialMediaType || "Facebook Post"}
- Purpose: ${purpose || "Promote"}
- Content Pillar: ${contentPillar || "Educate"}

Generate exactly 3 key message suggestions that are concise, actionable, and tailored to the content pillar and purpose. Each suggestion must be unique in structure and wording—avoid repetitive patterns or generic phrasing. Focus on creativity and relevance to the business context.

Generate exactly 3 ad detail suggestions that include target demographics, budget, or campaign focus, tailored to the social media type and target audience. Each ad detail must be distinct, avoiding repetition in structure or content (e.g., don’t repeat "Target [audience]" in every suggestion).

Expected Output Format:

Key Messages: message 1, message 2, message 3  
Ad Details: detail 1, detail 2, detail 3
`;

  console.log("Generated Prompt:", prompt);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.9,
      presence_penalty: 0.3,
      frequency_penalty: 0.3,
    });

    console.log("Raw OpenAI Response:", response.choices[0].message.content);

    const lines = response.choices[0].message.content.split("\n").filter((line) => line.trim());
    let suggestedKeyMessages = [];
    let suggestedAdDetails = [];
    let currentSection = null;

    lines.forEach((line) => {
      if (line.startsWith("**Key Messages:**") || line.startsWith("Key Messages:")) {
        currentSection = "keyMessages";
        const messages = line.replace(/(\*\*Key Messages:\*\*|Key Messages:)/, "").split(",").map((k) => k.trim()).filter((k) => k.length > 0);
        if (messages.length >= 3) {
          suggestedKeyMessages = messages.slice(0, 3);
        }
      } else if (line.startsWith("**Ad Details:**") || line.startsWith("Ad Details:")) {
        currentSection = "adDetails";
        const details = line.replace(/(\*\*Ad Details:\*\*|Ad Details:)/, "").split(",").map((k) => k.trim()).filter((k) => k.length > 0);
        if (details.length >= 3) {
          suggestedAdDetails = details.slice(0, 3);
        }
      } else if (currentSection === "keyMessages" && line.match(/^\d+\.\s/)) {
        const message = line.replace(/^\d+\.\s/, "").replace(/^["']|["']$/g, "").trim();
        if (message) suggestedKeyMessages.push(message);
      } else if (currentSection === "adDetails" && line.match(/^\d+\.\s/)) {
        const detail = line.replace(/^\d+\.\s/, "").trim();
        if (detail) suggestedAdDetails.push(detail);
      }
    });

    suggestedKeyMessages = suggestedKeyMessages.slice(0, 3);
    suggestedAdDetails = suggestedAdDetails.slice(0, 3);

    console.log("Parsed Suggestions:", { suggestedKeyMessages, suggestedAdDetails });

    // Relax validation: return what we have even if incomplete
    if (suggestedKeyMessages.length === 0 && suggestedAdDetails.length === 0) {
      console.warn("OpenAI response empty, returning empty suggestions.");
      return {
        suggestedKeyMessages: [],
        suggestedAdDetails: [],
      };
    }

    return {
      suggestedKeyMessages,
      suggestedAdDetails,
    };
  } catch (error) {
    console.error("Error with OpenAI social media suggestion:", error);
    return {
      suggestedKeyMessages: [],
      suggestedAdDetails: [],
    };
  }
};

module.exports = { suggestSocialMediaDetails };