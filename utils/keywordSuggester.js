const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const suggestKeywordsWithOpenAI = async (businessDetails) => {
  console.log("Business Details for Suggestion:", businessDetails);

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

Generate exactly 3 primary keywords, 3 secondary keywords, and 3 key points. Also provide a unique business goal, specific challenge, and personal anecdote. Ensure the output strictly follows the format below.

Expected Output Format:

Primary Keywords: keyword 1, keyword 2, keyword 3  
Secondary Keywords: secondary 1, secondary 2, secondary 3  
Key Points: point 1, point 2, point 3  
Unique Business Goal: [goal]  
Specific Challenge: [challenge]  
Personal Anecdote: [anecdote]
`;

  console.log("Generated Prompt:", prompt);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 1.0,
      presence_penalty: 0.3,
      frequency_penalty: 0.3,
      seed: Math.floor(Math.random() * 10000),
    });

    console.log("Raw OpenAI Response:", response.choices[0].message.content);

    const lines = response.choices[0].message.content.split("\n").filter((line) => line.trim());
    let primaryKeywords = [];
    let secondaryKeywords = [];
    let keyPoints = [];
    let uniqueBusinessGoal = "";
    let specificChallenge = "";
    let personalAnecdote = "";
    let currentSection = null;

    lines.forEach((line) => {
      if (line.startsWith("**Primary Keywords:**") || line.startsWith("Primary Keywords:")) {
        currentSection = "primaryKeywords";
        const keywords = line
          .replace(/(\*\*Primary Keywords:\*\*|Primary Keywords:)/, "")
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
        if (keywords.length >= 3) {
          primaryKeywords = keywords.slice(0, 3);
        }
      } else if (line.startsWith("**Secondary Keywords:**") || line.startsWith("Secondary Keywords:")) {
        currentSection = "secondaryKeywords";
        const keywords = line
          .replace(/(\*\*Secondary Keywords:\*\*|Secondary Keywords:)/, "")
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
        if (keywords.length >= 3) {
          secondaryKeywords = keywords.slice(0, 3);
        }
      } else if (line.startsWith("**Key Points:**") || line.startsWith("Key Points:")) {
        currentSection = "keyPoints";
        const points = line
          .replace(/(\*\*Key Points:\*\*|Key Points:)/, "")
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
        if (points.length >= 3) {
          keyPoints = points.slice(0, 3);
        }
      } else if (line.startsWith("**Unique Business Goal:**") || line.startsWith("Unique Business Goal:")) {
        currentSection = null;
        uniqueBusinessGoal = line.replace(/(\*\*Unique Business Goal:\*\*|Unique Business Goal:)/, "").trim();
      } else if (line.startsWith("**Specific Challenge:**") || line.startsWith("Specific Challenge:")) {
        currentSection = null;
        specificChallenge = line.replace(/(\*\*Specific Challenge:\*\*|Specific Challenge:)/, "").trim();
      } else if (line.startsWith("**Personal Anecdote:**") || line.startsWith("Personal Anecdote:")) {
        currentSection = null;
        personalAnecdote = line.replace(/(\*\*Personal Anecdote:\*\*|Personal Anecdote:)/, "").trim();
      } else if (currentSection === "primaryKeywords" && line.match(/^\d+\.\s/)) {
        const keyword = line.replace(/^\d+\.\s/, "").replace(/^["']|["']$/g, "").trim();
        if (keyword) primaryKeywords.push(keyword);
      } else if (currentSection === "secondaryKeywords" && line.match(/^\d+\.\s/)) {
        const keyword = line.replace(/^\d+\.\s/, "").replace(/^["']|["']$/g, "").trim();
        if (keyword) secondaryKeywords.push(keyword);
      } else if (currentSection === "keyPoints" && line.match(/^\d+\.\s/)) {
        const point = line.replace(/^\d+\.\s/, "").replace(/^["']|["']$/g, "").trim();
        if (point) keyPoints.push(point);
      }
    });

    primaryKeywords = primaryKeywords.slice(0, 3);
    secondaryKeywords = secondaryKeywords.slice(0, 3);
    keyPoints = keyPoints.slice(0, 3);

    console.log("Parsed Suggestions:", {
      primaryKeywords,
      secondaryKeywords,
      keyPoints,
      uniqueBusinessGoal,
      specificChallenge,
      personalAnecdote,
    });

    // Return partial suggestions if available
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
    return {
      primaryKeywords: [],
      secondaryKeywords: [],
      keyPoints: [],
      uniqueBusinessGoal: "",
      specificChallenge: "",
      personalAnecdote: "",
    };
  }
};

module.exports = { suggestKeywordsWithOpenAI };