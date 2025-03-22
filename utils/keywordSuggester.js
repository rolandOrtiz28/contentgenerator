const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Heuristic-based fallback
const suggestKeywords = (businessDetails) => {
  const { focusService, targetAudience } = businessDetails;
  const effectiveFocusService =
    focusService ||
    (typeof businessDetails.services === "string"
      ? businessDetails.services.split(",").map((s) => s.trim())[0]
      : null) ||
    "business solutions";

  return [
    `${effectiveFocusService.toLowerCase()} for ${targetAudience.toLowerCase()}`,
    `best ${effectiveFocusService.toLowerCase()} provider`,
    `${effectiveFocusService.toLowerCase()} solutions`,
  ];
};

const suggestKeywordsWithOpenAI = async (businessDetails) => {
  const { companyName, description, services, focusService, targetAudience } = businessDetails;

  const effectiveFocusService =
    focusService ||
    (typeof services === "string"
      ? services.split(",").map((s) => s.trim())[0]
      : null) ||
    "business solutions";

  const creativeTone = [
    "Use a storytelling tone with data-driven insights.",
    "Use a punchy, startup-style marketing tone.",
    "Be technical but accessible, like speaking to a smart founder.",
    "Take a challenger-brand tone, with bold, confident wording.",
    "Make it sound like a growth hacker's secret playbook.",
  ];
  const randomTone = creativeTone[Math.floor(Math.random() * creativeTone.length)];

  const prompt = `
You are an SEO expert and content strategist. Based on the following business details, provide SEO-optimized suggestions for a blog article focused EXCLUSIVELY on the specified Focus Service. Do NOT generate keywords or content related to other services unless they directly support the Focus Service. Ensure all suggestions are highly relevant to the Focus Service, tailored to the target audience, and avoid generic or unrelated terms.

Business Details:
- Company Name: ${companyName || "Unknown Company"}
- Description: ${description || "No description provided."}
- Services: ${services || "General services"}
- Focus Service: ${effectiveFocusService}
- Target Audience: ${targetAudience || "general audience"}

Make each suggestion creative and avoid repeating generic keyword patterns. Use unique wording, specific user intents, and real-world context when forming keywords. Vary keyword structure—some should imply outcomes, others problems or benefits. Keep output original, not templated.

Tone Directive: ${randomTone}

Here’s an example of diverse outputs:
- Primary Keywords: "AI-powered content strategy for startups", "automated SEO analysis tools", "scalable digital growth system"
- Secondary Keywords: "startup SEO automation", "AI for keyword ranking", "content intelligence tools"

Expected Output Format:

Primary Keywords: keyword 1, keyword 2, keyword 3  
Secondary Keywords: secondary 1, secondary 2, secondary 3  
Key Points: point 1, point 2, point 3  
Unique Business Goal: [goal]  
Specific Challenge: [challenge]  
Personal Anecdote: [anecdote]
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 1.0,
      seed: Math.floor(Math.random() * 10000),
    });

    const lines = response.choices[0].message.content.split("\n").filter((line) => line.trim());
    let primaryKeywords = [];
    let secondaryKeywords = [];
    let keyPoints = [];
    let uniqueBusinessGoal = "";
    let specificChallenge = "";
    let personalAnecdote = "";

    lines.forEach((line) => {
      if (line.startsWith("Primary Keywords:")) {
        primaryKeywords = line
          .replace("Primary Keywords:", "")
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
          .slice(0, 3);
      } else if (line.startsWith("Secondary Keywords:")) {
        secondaryKeywords = line
          .replace("Secondary Keywords:", "")
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
          .slice(0, 3);
      } else if (line.startsWith("Key Points:")) {
        keyPoints = line
          .replace("Key Points:", "")
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
          .slice(0, 3);
      } else if (line.startsWith("Unique Business Goal:")) {
        uniqueBusinessGoal = line.replace("Unique Business Goal:", "").trim();
      } else if (line.startsWith("Specific Challenge:")) {
        specificChallenge = line.replace("Specific Challenge:", "").trim();
      } else if (line.startsWith("Personal Anecdote:")) {
        personalAnecdote = line.replace("Personal Anecdote:", "").trim();
      }
    });

    if (
      !primaryKeywords.length ||
      !secondaryKeywords.length ||
      !keyPoints.length ||
      !uniqueBusinessGoal ||
      !specificChallenge ||
      !personalAnecdote
    ) {
      console.warn("OpenAI response incomplete, falling back to heuristic values.");
      const heuristicKeywords = suggestKeywords(businessDetails);
      const dynamicKeyPoints = [
        `How ${effectiveFocusService} enhances your online presence`,
        `Latest strategies in ${effectiveFocusService} for ${targetAudience?.toLowerCase() || "general audience"}`,
        `Why ${targetAudience?.toLowerCase() || "general audience"} should invest in ${effectiveFocusService}`,
      ];
      const fallbackUniqueBusinessGoal = `Increase ${effectiveFocusService.toLowerCase()} ROI for ${targetAudience?.toLowerCase() || "general audience"}`;
      const fallbackSpecificChallenge = `Standing out in a competitive ${effectiveFocusService.toLowerCase()} market for ${targetAudience?.toLowerCase() || "general audience"}`;
      const fallbackPersonalAnecdote = `A ${targetAudience?.toLowerCase() || "general audience"} client achieved a 30% increase in engagement after using our ${effectiveFocusService.toLowerCase()} services`;

      return {
        primaryKeywords: primaryKeywords.length ? primaryKeywords : heuristicKeywords,
        secondaryKeywords: secondaryKeywords.length ? secondaryKeywords : heuristicKeywords.slice(1),
        keyPoints: keyPoints.length ? keyPoints : dynamicKeyPoints,
        uniqueBusinessGoal: uniqueBusinessGoal || fallbackUniqueBusinessGoal,
        specificChallenge: specificChallenge || fallbackSpecificChallenge,
        personalAnecdote: personalAnecdote || fallbackPersonalAnecdote,
      };
    }

    return {
      primaryKeywords,
      secondaryKeywords,
      keyPoints,
      uniqueBusinessGoal,
      specificChallenge,
      personalAnecdote,
    };
  } catch (error) {
    console.error("Error with OpenAI keyword suggestion:", error);
    const heuristicKeywords = suggestKeywords(businessDetails);
    const dynamicKeyPoints = [
      `How ${effectiveFocusService} enhances your online presence`,
      `Latest strategies in ${effectiveFocusService} for ${targetAudience?.toLowerCase() || "general audience"}`,
      `Why ${targetAudience?.toLowerCase() || "general audience"} should invest in ${effectiveFocusService}`,
    ];
    const fallbackUniqueBusinessGoal = `Increase ${effectiveFocusService.toLowerCase()} ROI for ${targetAudience?.toLowerCase() || "general audience"}`;
    const fallbackSpecificChallenge = `Standing out in a competitive ${effectiveFocusService.toLowerCase()} market for ${targetAudience?.toLowerCase() || "general audience"}`;
    const fallbackPersonalAnecdote = `A ${targetAudience?.toLowerCase() || "general audience"} client achieved a 30% increase in engagement after using our ${effectiveFocusService.toLowerCase()} services`;

    return {
      primaryKeywords: heuristicKeywords,
      secondaryKeywords: heuristicKeywords.slice(1),
      keyPoints: dynamicKeyPoints,
      uniqueBusinessGoal: fallbackUniqueBusinessGoal,
      specificChallenge: fallbackSpecificChallenge,
      personalAnecdote: fallbackPersonalAnecdote,
    };
  }
};

module.exports = { suggestKeywords, suggestKeywordsWithOpenAI };
