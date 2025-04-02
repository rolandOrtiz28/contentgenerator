// utils/suggestions.js
const { getSEOSuggestionsWithFallback } = require("./suggestionFetcher"); // Adjust path as needed

const buildPrompt = (query, options = {}) => {
  const {
    intent,
    output = [],
    type,
    sources = [],
    topFacts,
    criteria = [],
  } = options;

  const base = `You are an expert SEO content strategist working with top tools like Ahrefs, SEMrush, and Clearscope.`;

  const format = `Respond ONLY in plain text using this format:
key: value
(One per line. No extra commentary. No markdown.)
`;

  if (intent === "SERP_analysis") {
    return `${base}
Analyze the top 3 Google ranking pages for the query: "${query}"
Return:
${output.map((o) => `- ${o}`).join("\n")}
${format}`;
  }

  if (intent === "snippetAnalysis") {
    return `${base}
Find the featured snippet for the query: "${query}"
Return:
- snippetQuestion: the question being answered
- snippetFormat: one of: paragraph, list, or table
${format}`;
  }

  if (intent === "contentCluster") {
    return `${base}
Based on the query "${query}", suggest:
- Related Subtopics (cluster content)
- Internal linking opportunities
${format}`;
  }

  if (intent === "critique") {
    return `${base}
Critique the following content for the following SEO criteria: ${criteria.join(", ")}
Content:
${query}
Return suggestions using key: value format.
${format}`;
  }

  if (type === "relatedQuestions") {
    return `${base}
Extract 5 real questions people ask related to: "${query}"
Sources: ${sources.join(", ")}
Return each as:
question: example question
${format}`;
  }

  if (topFacts) {
    return `${base}
Give the top ${topFacts} recent statistics with sources related to: "${query}"
Each must be recent (within the last 2 years) and from a credible source (Statista, HubSpot, Google, etc).
Return:
fact: source
${format}`;
  }

  return `${base}
List top trending tools, influencers, or thought leaders for 2025 related to: "${query}"
${format}`;
};


const fetchWithFallback = async (query, options = {}) => {
  const prompt = buildPrompt(query, options);

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
    You are a top-tier SEO strategist using tools like Ahrefs, SEMrush, and Clearscope. Given the business context below, your task is to suggest **ONLY high-performing, high-search-volume SEO keywords**.
    
    🎯 Output Format:
    - Primary Keywords: 3 keywords with high search intent, high competition, and monthly search volume > 5K
    - Secondary Keywords: 3 semantically related, long-tail or support keywords
    - Key Points: 3 marketing angles or core benefits of the focus service
    - Unique Business Goal: One sentence tailored to the service
    - Specific Challenge: A real pain point this audience faces
    - Personal Anecdote: One-sentence anecdote or result story
    - Call to Action: Direct CTA (e.g., Book a Free Call, Try Now)
    - Specific AI Requirement: Instruction to improve content generation quality
    
    ⚠️ Do not suggest unrelated services like digital marketing if focus is "graphic design."
    All keywords MUST be related to the Focus Service and Target Audience ONLY.
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