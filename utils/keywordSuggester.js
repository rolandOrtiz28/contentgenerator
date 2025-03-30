// utils/suggestions.js
const { getSEOSuggestionsWithFallback } = require("./suggestionFetcher"); // Adjust path as needed

const fetchWithFallback = async (query, options = {}) => {
  const { intent, output, type, sources, topFacts, criteria } = options;

  const prompt = `
You are an SEO and content analysis expert. Based on the query "${query}", provide the following:
${
  intent === "SERP_analysis"
    ? `Analyze the top-ranking pages. Return: ${output.join(", ")}`
    : intent === "snippetAnalysis"
    ? "Analyze the featured snippet. Return its format (paragraph, list, table) and triggering question."
    : intent === "contentCluster"
    ? "Suggest related subtopics for a content cluster and internal linking opportunities."
    : intent === "critique"
    ? `Critique this content for: ${criteria.join(", ")}. Suggest improvements.`
    : type === "relatedQuestions"
    ? `Find real user questions from ${sources.join(", ")}.`
    : topFacts
    ? `Return the top ${topFacts} recent stats or facts with sources.`
    : "List trending tools or thought leaders for 2025 related to the query."
}
Respond in plain text, no markdown, with key-value pairs separated by newlines (e.g., key: value).
`;

  const response = await getSEOSuggestionsWithFallback(prompt);
  const content = response.text;

  if (!content) return {};

  const lines = content.split("\n").filter((line) => line.trim());
  const result = {};
  lines.forEach((line) => {
    const [key, value] = line.split(": ").map((part) => part.trim());
    if (key && value) result[key] = value;
  });

  return result;
};

const suggestKeywordsWithPerplexity = async (businessDetails) => {
  const {
    companyName,
    description,
    services,
    focusService,
    targetAudience,
  } = businessDetails;

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
  const randomTone =
    creativeTone[Math.floor(Math.random() * creativeTone.length)];

  const prompt = `
You are an SEO expert and strategist. Given the business info below, suggest the following:
- 3 Primary Keywords
- 3 Secondary Keywords
- 3 Key Points
- 1 Unique Business Goal
- 1 Specific Challenge
- 1 Personal Anecdote
- 1 Call to Action (CTA)
- 1 Specific AI Requirement to get the best article output
All suggestions must be tailored specifically to the Focus Service and target audience.
Tone: ${randomTone}

Business:
- Name: ${companyName || "Unknown Company"}
- Description: ${description || "No description provided"}
- Services: ${services || "General services"}
- Focus Service: ${effectiveFocusService}
- Target Audience: ${targetAudience || "general audience"}

Respond in plain text and follow this format:
Primary Keywords: ..., ..., ...
Secondary Keywords: ..., ..., ...
Key Points: ..., ..., ...
Unique Business Goal: ...
Specific Challenge: ...
Personal Anecdote: ...
Call to Action: ...
Specific AI Requirement: ...
`;

  try {
    const response = await getSEOSuggestionsWithFallback(prompt);
    const content = response.text.trim();
    const source = response.source;

    const lines = content.split("\n").filter((line) => line.trim());

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

    const result = {
      primaryKeywords: extract("Primary Keywords:"),
      secondaryKeywords: extract("Secondary Keywords:"),
      keyPoints: extract("Key Points:"),
      uniqueBusinessGoal: extractSingle("Unique Business Goal:"),
      specificChallenge: extractSingle("Specific Challenge:"),
      personalAnecdote: extractSingle("Personal Anecdote:"),
      cta: extractSingle("Call to Action:"),
      specificInstructions: extractSingle("Specific AI Requirement:"),
    };

    // Handle empty results gracefully
    if (!result.primaryKeywords.length && !result.secondaryKeywords.length) {
      console.warn("No valid suggestions received from", source);
      return {
        primaryKeywords: [],
        secondaryKeywords: [],
        keyPoints: [],
        uniqueBusinessGoal: "",
        specificChallenge: "",
        personalAnecdote: "",
        cta: "",
        specificInstructions: "",
        competitiveData: {},
        stats: {},
        faqs: {},
        snippetData: {},
        clusters: {},
        entities: {},
      };
    }

    const primaryKeyword = result.primaryKeywords[0] || effectiveFocusService;

    // Tweak 1: Competitive Research
    const competitiveData = await fetchWithFallback(primaryKeyword, {
      intent: "SERP_analysis",
      output: ["topH2s", "metaDescriptions", "snippetSummaries", "contentGaps"],
    });
    result.competitiveData = competitiveData;

    // Tweak 2: Real Stats
    const stats = await fetchWithFallback(`latest stats on ${effectiveFocusService}`, { topFacts: 3 });
    result.stats = stats;

    // Tweak 3: Better FAQs
    const faqs = await fetchWithFallback(primaryKeyword, {
      type: "relatedQuestions",
      sources: ["Google", "Reddit", "Quora"],
    });
    result.faqs = faqs;

    // Tweak 4: Featured Snippet Optimization
    const snippetData = await fetchWithFallback(primaryKeyword, { intent: "snippetAnalysis" });
    result.snippetData = snippetData;

    // Tweak 5: Topic Clusters
    const clusters = await fetchWithFallback(effectiveFocusService, { intent: "contentCluster" });
    result.clusters = clusters;

    // Tweak 6: Entity Enrichment
    const entities = await fetchWithFallback(`trending tools or thought leaders in ${effectiveFocusService} for 2025`);
    result.entities = entities;

    return result;
  } catch (err) {
    console.error("Suggestion Error:", err);
    return {
      primaryKeywords: [],
      secondaryKeywords: [],
      keyPoints: [],
      uniqueBusinessGoal: "",
      specificChallenge: "",
      personalAnecdote: "",
      cta: "",
      specificInstructions: "",
      competitiveData: {},
      stats: {},
      faqs: {},
      snippetData: {},
      clusters: {},
      entities: {},
    };
  }
};

module.exports = { suggestKeywordsWithPerplexity, fetchWithFallback };