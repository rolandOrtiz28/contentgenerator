require("dotenv").config();
const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const axios = require("axios");
const Business = require("../models/Business");
const { getSEOSuggestionsWithFallback } = require("../utils/suggestionFetcher"); // Updated import
const { fetchWithFallback } = require("../utils/keywordSuggester"); // Updated import
const { jsonrepair } = require("jsonrepair");
const Content = require("../models/Content");
const User = require("../models/User");
const { ensureAuthenticated } = require("../middleware/auth");
const { ensureBusinessRole } = require("../middleware/businessAccess");
const { logAndEmitError } = require("../socket");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory cache for results
const cache = new Map();

// Step 1: Fetch businesses for the initial form
router.get("/branding-article", async (req, res) => {
  try {
    const businesses = await Business.find({}, "companyName");
    res.json({ businesses, error: null });
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.status(500).json({ businesses: [], error: "Failed to load businesses." });
  }
});

router.get("/content-details", ensureAuthenticated, async (req, res) => {
  const businessId = req.session.businessId;

  if (!businessId) {
    return res.status(400).json({
      error: "No business selected. Please start the process again.",
      redirect: "/blog-article/branding-article",
    });
  }

  try {
    const business = await Business.findOne({
      _id: businessId,
      $or: [{ owner: req.user._id }, { "members.user": req.user._id }],
    });
    if (!business) {
      return res.status(404).json({
        error: "Business not found or you do not have access",
        redirect: "/blog-article/branding-article",
      });
    }

    const businessDetails = {
      companyName: business.companyName,
      description: business.description,
      services: business.services,
      focusService: business.focusService,
      targetAudience: business.targetAudience,
      demographic: business.demographic || "",
      address: business.address || "",
      email: business.email || "",
      phoneNumber: business.phoneNumber || "",
      brandTone: business.brandTone,
      companyWebsite: business.companyWebsite,
    };

    const response = { business: businessDetails };

    if (businessDetails.focusService) {
      const suggestionPrompt = `
Analyze the following business and provide SEO content suggestions in plain text with key-value pairs (e.g., key: value):
- primaryKeywords: 3 comma-separated keywords
- secondaryKeywords: 3 comma-separated keywords
- keyPoints: 3 comma-separated points
- uniqueBusinessGoal: one sentence
- specificChallenge: one sentence
- personalAnecdote: one sentence
- cta: one sentence
- specificInstructions: one sentence
- topH2s: comma-separated H2s from competitors
- metaDescriptions: comma-separated meta descriptions
- snippetSummaries: comma-separated snippet summaries
- contentGaps: comma-separated gaps
- stats: fact-source pairs separated by semicolons
- faqs: question-answer pairs separated by semicolons, questions and answers separated by |
- snippetQuestion: one question
- snippetFormat: one format (e.g., paragraph, list)
- clusters: comma-separated subtopics
- entities: name-description pairs separated by semicolons, names and descriptions separated by |

Business Details:
- Company Name: ${businessDetails.companyName}
- Description: ${businessDetails.description}
- Services: ${businessDetails.services}
- Focus Service: ${businessDetails.focusService}
- Target Audience: ${businessDetails.targetAudience}
- Brand Tone: ${businessDetails.brandTone}
`;
      const suggestionResponse = await getSEOSuggestionsWithFallback(suggestionPrompt);
      const suggestionsText = suggestionResponse.text;

      // Parse the plain text response into the expected suggestions object
      const suggestions = {};
      const lines = suggestionsText.split("\n").map((line) => line.trim());
      for (const line of lines) {
        const [key, value] = line.split(": ").map((part) => part.trim());
        if (!key || !value) continue;

        switch (key.toLowerCase()) {
          case "primarykeywords":
            suggestions.primaryKeywords = value.split(",").map((kw) => kw.trim());
            break;
          case "secondarykeywords":
            suggestions.secondaryKeywords = value.split(",").map((kw) => kw.trim());
            break;
          case "keypoints":
            suggestions.keyPoints = value.split(",").map((kp) => kp.trim());
            break;
          case "uniquebusinessgoal":
            suggestions.uniqueBusinessGoal = value;
            break;
          case "specificchallenge":
            suggestions.specificChallenge = value;
            break;
          case "personalanecdote":
            suggestions.personalAnecdote = value;
            break;
          case "cta":
            suggestions.cta = value;
            break;
          case "specificinstructions":
            suggestions.specificInstructions = value;
            break;
          case "toph2s":
            suggestions.competitiveData = suggestions.competitiveData || {};
            suggestions.competitiveData.topH2s = value;
            break;
          case "metadescriptions":
            suggestions.competitiveData = suggestions.competitiveData || {};
            suggestions.competitiveData.metaDescriptions = value;
            break;
          case "snippetsummaries":
            suggestions.competitiveData = suggestions.competitiveData || {};
            suggestions.competitiveData.snippetSummaries = value;
            break;
          case "contentgaps":
            suggestions.competitiveData = suggestions.competitiveData || {};
            suggestions.competitiveData.contentGaps = value;
            break;
          case "stats":
            suggestions.stats = Object.fromEntries(
              value.split(";").map((stat) => {
                const [fact, source] = stat.split("-").map((s) => s.trim());
                return [fact, source];
              })
            );
            break;
          case "faqs":
            suggestions.faqs = Object.fromEntries(
              value.split(";").map((faq) => {
                const [q, a] = faq.split("|").map((s) => s.trim());
                return [q, a];
              })
            );
            break;
          case "snippetquestion":
            suggestions.snippetData = suggestions.snippetData || {};
            suggestions.snippetData.question = value;
            break;
          case "snippetformat":
            suggestions.snippetData = suggestions.snippetData || {};
            suggestions.snippetData.format = value;
            break;
          case "clusters":
            suggestions.clusters = Object.fromEntries(
              value.split(",").map((cluster) => [cluster.trim(), ""])
            );
            break;
          case "entities":
            suggestions.entities = Object.fromEntries(
              value.split(";").map((entity) => {
                const [name, desc] = entity.split("|").map((s) => s.trim());
                return [name, desc];
              })
            );
            break;
        }
      }

      response.suggestedPrimaryKeywords = suggestions.primaryKeywords;
      response.suggestedSecondaryKeywords = suggestions.secondaryKeywords;
      response.suggestedKeyPoints = suggestions.keyPoints;
      response.suggestedUniqueBusinessGoal = suggestions.uniqueBusinessGoal;
      response.suggestedSpecificChallenge = suggestions.specificChallenge;
      response.suggestedPersonalAnecdote = suggestions.personalAnecdote;
      response.suggestedCTA = suggestions.cta;
      response.suggestedSpecificInstructions = suggestions.specificInstructions;
      response.competitiveData = suggestions.competitiveData;
      response.stats = suggestions.stats;
      response.faqs = suggestions.faqs;
      response.snippetData = suggestions.snippetData;
      response.clusters = suggestions.clusters;
      response.entities = suggestions.entities;
    }

    res.json({
      ...response,
      error: null,
    });
  } catch (error) {
    logAndEmitError("Error fetching business details:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch business details" });
  }
});

// Manual fix for common JSON issues
function manualFixJson(rawContent) {
  let fixedContent = rawContent;

  fixedContent = fixedContent.replace(/({|,)\s*([a-zA-Z0-9_]+)\s*:/g, '$1 "$2":');
  fixedContent = fixedContent.replace(/:\s*([a-zA-Z0-9_]+)(,|})/g, ': "$1"$2');

  if (fixedContent.includes('"schemaMarkup":')) {
    const schemaStart = fixedContent.indexOf('"schemaMarkup":') + 14;
    const schemaEnd = fixedContent.lastIndexOf('"}');
    if (schemaEnd > schemaStart) {
      let schemaPart = fixedContent.substring(schemaStart, schemaEnd + 2);
      let braceCount = 0;
      let inQuotes = false;
      for (let i = 0; i < schemaPart.length; i++) {
        if (schemaPart[i] === '"' && schemaPart[i - 1] !== "\\") {
          inQuotes = !inQuotes;
        }
        if (!inQuotes) {
          if (schemaPart[i] === "{") braceCount++;
          if (schemaPart[i] === "}") braceCount--;
        }
      }
      while (braceCount > 0) {
        schemaPart += "}";
        braceCount--;
      }
      while (braceCount < 0) {
        schemaPart = schemaPart.slice(0, -1);
        braceCount++;
      }
      fixedContent =
        fixedContent.substring(0, schemaStart) +
        schemaPart +
        fixedContent.substring(schemaEnd + 2);
    }
  }

  return fixedContent;
}

router.post("/fetch-suggestions", ensureAuthenticated, async (req, res) => {
  const { businessId, focusService } = req.body;

  if (!businessId || !focusService) {
    return res.status(400).json({ error: "Business ID and focus service are required" });
  }

  try {
    const business = await Business.findOne({
      _id: businessId,
      $or: [
        { owner: req.user._id },
        { "members.user": req.user._id },
      ],
    });
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    business.focusService = focusService;
    await business.save();

    const businessDetails = {
      companyName: business.companyName,
      description: business.description,
      services: business.services,
      focusService: focusService,
      targetAudience: business.targetAudience,
      demographic: business.demographic || "",
      address: business.address || "",
      email: business.email || "",
      phoneNumber: business.phoneNumber || "",
      brandTone: business.brandTone,
      companyWebsite: business.companyWebsite,
    };

    const suggestionPrompt = `
Analyze the following business and provide SEO content suggestions in plain text with key-value pairs (e.g., key: value):
- primaryKeywords: 3 comma-separated keywords
- secondaryKeywords: 3 comma-separated keywords
- keyPoints: 3 comma-separated points
- uniqueBusinessGoal: one sentence
- specificChallenge: one sentence
- personalAnecdote: one sentence
- cta: one sentence
- specificInstructions: one sentence
- topH2s: comma-separated H2s from competitors
- metaDescriptions: comma-separated meta descriptions
- snippetSummaries: comma-separated snippet summaries
- contentGaps: comma-separated gaps
- stats: fact-source pairs separated by semicolons
- faqs: question-answer pairs separated by semicolons, questions and answers separated by |
- snippetQuestion: one question
- snippetFormat: one format (e.g., paragraph, list)
- clusters: comma-separated subtopics
- entities: name-description pairs separated by semicolons, names and descriptions separated by |

Business Details:
- Company Name: ${businessDetails.companyName}
- Description: ${businessDetails.description}
- Services: ${businessDetails.services}
- Focus Service: ${businessDetails.focusService}
- Target Audience: ${businessDetails.targetAudience}
- Brand Tone: ${businessDetails.brandTone}
`;
    const suggestionResponse = await getSEOSuggestionsWithFallback(suggestionPrompt);
    const suggestionsText = suggestionResponse.text;

    // Parse the plain text response into the expected suggestions object
    const suggestions = {};
    const lines = suggestionsText.split("\n").map((line) => line.trim());
    for (const line of lines) {
      const [key, value] = line.split(": ").map((part) => part.trim());
      if (!key || !value) continue;

      switch (key.toLowerCase()) {
        case "primarykeywords":
          suggestions.primaryKeywords = value.split(",").map((kw) => kw.trim());
          break;
        case "secondarykeywords":
          suggestions.secondaryKeywords = value.split(",").map((kw) => kw.trim());
          break;
        case "keypoints":
          suggestions.keyPoints = value.split(",").map((kp) => kp.trim());
          break;
        case "uniquebusinessgoal":
          suggestions.uniqueBusinessGoal = value;
          break;
        case "specificchallenge":
          suggestions.specificChallenge = value;
          break;
        case "personalanecdote":
          suggestions.personalAnecdote = value;
          break;
        case "cta":
          suggestions.cta = value;
          break;
        case "specificinstructions":
          suggestions.specificInstructions = value;
          break;
        case "toph2s":
          suggestions.competitiveData = suggestions.competitiveData || {};
          suggestions.competitiveData.topH2s = value;
          break;
        case "metadescriptions":
          suggestions.competitiveData = suggestions.competitiveData || {};
          suggestions.competitiveData.metaDescriptions = value;
          break;
        case "snippetsummaries":
          suggestions.competitiveData = suggestions.competitiveData || {};
          suggestions.competitiveData.snippetSummaries = value;
          break;
        case "contentgaps":
          suggestions.competitiveData = suggestions.competitiveData || {};
          suggestions.competitiveData.contentGaps = value;
          break;
        case "stats":
          suggestions.stats = Object.fromEntries(
            value.split(";").map((stat) => {
              const [fact, source] = stat.split("-").map((s) => s.trim());
              return [fact, source];
            })
          );
          break;
        case "faqs":
          suggestions.faqs = Object.fromEntries(
            value.split(";").map((faq) => {
              const [q, a] = faq.split("|").map((s) => s.trim());
              return [q, a];
            })
          );
          break;
        case "snippetquestion":
          suggestions.snippetData = suggestions.snippetData || {};
          suggestions.snippetData.question = value;
          break;
        case "snippetformat":
          suggestions.snippetData = suggestions.snippetData || {};
          suggestions.snippetData.format = value;
          break;
        case "clusters":
          suggestions.clusters = Object.fromEntries(
            value.split(",").map((cluster) => [cluster.trim(), ""])
          );
          break;
        case "entities":
          suggestions.entities = Object.fromEntries(
            value.split(";").map((entity) => {
              const [name, desc] = entity.split("|").map((s) => s.trim());
              return [name, desc];
            })
          );
          break;
      }
    }

    res.json({
      suggestedPrimaryKeywords: suggestions.primaryKeywords,
      suggestedSecondaryKeywords: suggestions.secondaryKeywords,
      suggestedKeyPoints: suggestions.keyPoints,
      suggestedUniqueBusinessGoal: suggestions.uniqueBusinessGoal,
      suggestedSpecificChallenge: suggestions.specificChallenge,
      suggestedPersonalAnecdote: suggestions.personalAnecdote,
      suggestedCTA: suggestions.cta,
      suggestedSpecificInstructions: suggestions.specificInstructions,
      competitiveData: suggestions.competitiveData,
      stats: suggestions.stats,
      faqs: suggestions.faqs,
      snippetData: suggestions.snippetData,
      clusters: suggestions.clusters,
      entities: suggestions.entities,
      error: null,
    });
  } catch (error) {
    logAndEmitError("Error fetching suggestions:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

router.post(
  "/generate-content-article",
  ensureAuthenticated,
  ensureBusinessRole("Editor"),
  async (req, res) => {
    const {
      companyName,
      description,
      services,
      focusService,
      targetAudience,
      brandTone,
      keyword,
      secondaryKeywords,
      articleLength,
      keyPoints,
      cta,
      uniqueBusinessGoal,
      specificChallenge,
      personalAnecdote,
      specificInstructions,
    } = req.body;

    try {
      // Fetch the user
      const user = await User.findById(req.user._id).populate("businesses");
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check free trial or subscription (bypass in development)
      if (
        process.env.NODE_ENV !== "development" &&
        !user.isEditEdgeUser && // Add this condition
        user.subscription === "None" &&
        user.freeTrialUsed
      ) {
        return res.status(403).json({
          error: "You have already used your free trial. Please subscribe to continue.",
          redirect: "/subscribe",
        });
      }

      // Check article generation limits (bypass in development and for EditEdge users)
      if (process.env.NODE_ENV !== "development" && !user.isEditEdgeUser) {
        const now = new Date();
        if (!user.contentGenerationResetDate || now > user.contentGenerationResetDate) {
          user.articleGenerationCount = 0;
          user.socialMediaGenerationCount = 0;
          user.contentGenerationResetDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          await user.save();
        }

        const articleLimits = {
          Basic: 2,
          Pro: 3,
          Enterprise: 10,
        };

        const userArticleLimit = articleLimits[user.subscription] || 0;
        if (
          user.subscription !== "None" &&
          user.articleGenerationCount >= userArticleLimit
        ) {
          return res.status(403).json({
            error: `You have reached your article generation limit of ${userArticleLimit} for the ${user.subscription} plan this week. Please upgrade your plan or wait until next week.`,
            redirect: "/subscribe",
          });
        }
      }

      let businessId = req.session.businessId;
      if (!businessId) {
        return res.status(400).json({
          error: "No business selected. Please start the process again.",
          redirect: "/blog-article/branding-article",
        });
      }

      const business = await Business.findById(businessId);
      if (!business) {
        return res.status(400).json({
          error: "Business not found.",
          redirect: "/blog-article/branding-article",
        });
      }

      // Define businessData correctly
      const businessData = {
        companyName: business.companyName,
        description: business.description,
        services: business.services,
        focusService: business.focusService || focusService || business.services.split(",")[0].trim(),
        targetAudience: business.targetAudience,
        brandTone: business.brandTone || brandTone || "professional",
      };

      // Fetch suggestions including all data for tweaks
      const suggestionPrompt = `
Analyze the following business and provide SEO content suggestions in plain text with key-value pairs (e.g., key: value):
- primaryKeywords: 3 comma-separated keywords
- secondaryKeywords: 3 comma-separated keywords
- keyPoints: 3 comma-separated points
- uniqueBusinessGoal: one sentence
- specificChallenge: one sentence
- personalAnecdote: one sentence
- cta: one sentence
- specificInstructions: one sentence
- topH2s: comma-separated H2s from competitors
- metaDescriptions: comma-separated meta descriptions
- snippetSummaries: comma-separated snippet summaries
- contentGaps: comma-separated gaps
- stats: fact-source pairs separated by semicolons
- faqs: question-answer pairs separated by semicolons, questions and answers separated by |
- snippetQuestion: one question
- snippetFormat: one format (e.g., paragraph, list)
- clusters: comma-separated subtopics
- entities: name-description pairs separated by semicolons, names and descriptions separated by |

Business Details:
- Company Name: ${businessData.companyName}
- Description: ${businessData.description}
- Services: ${businessData.services}
- Focus Service: ${businessData.focusService}
- Target Audience: ${businessData.targetAudience}
- Brand Tone: ${businessData.brandTone}
`;
      const suggestionResponse = await getSEOSuggestionsWithFallback(suggestionPrompt);
      const suggestionsText = suggestionResponse.text;

      // Parse the plain text response into the expected suggestions object
      const suggestions = {};
      const lines = suggestionsText.split("\n").map((line) => line.trim());
      for (const line of lines) {
        const [key, value] = line.split(": ").map((part) => part.trim());
        if (!key || !value) continue;

        switch (key.toLowerCase()) {
          case "primarykeywords":
            suggestions.primaryKeywords = value.split(",").map((kw) => kw.trim());
            break;
          case "secondarykeywords":
            suggestions.secondaryKeywords = value.split(",").map((kw) => kw.trim());
            break;
          case "keypoints":
            suggestions.keyPoints = value.split(",").map((kp) => kp.trim());
            break;
          case "uniquebusinessgoal":
            suggestions.uniqueBusinessGoal = value;
            break;
          case "specificchallenge":
            suggestions.specificChallenge = value;
            break;
          case "personalanecdote":
            suggestions.personalAnecdote = value;
            break;
          case "cta":
            suggestions.cta = value;
            break;
          case "specificinstructions":
            suggestions.specificInstructions = value;
            break;
          case "toph2s":
            suggestions.competitiveData = suggestions.competitiveData || {};
            suggestions.competitiveData.topH2s = value;
            break;
          case "metadescriptions":
            suggestions.competitiveData = suggestions.competitiveData || {};
            suggestions.competitiveData.metaDescriptions = value;
            break;
          case "snippetsummaries":
            suggestions.competitiveData = suggestions.competitiveData || {};
            suggestions.competitiveData.snippetSummaries = value;
            break;
          case "contentgaps":
            suggestions.competitiveData = suggestions.competitiveData || {};
            suggestions.competitiveData.contentGaps = value;
            break;
          case "stats":
            suggestions.stats = Object.fromEntries(
              value.split(";").map((stat) => {
                const [fact, source] = stat.split("-").map((s) => s.trim());
                return [fact, source];
              })
            );
            break;
          case "faqs":
            suggestions.faqs = Object.fromEntries(
              value.split(";").map((faq) => {
                const [q, a] = faq.split("|").map((s) => s.trim());
                return [q, a];
              })
            );
            break;
          case "snippetquestion":
            suggestions.snippetData = suggestions.snippetData || {};
            suggestions.snippetData.question = value;
            break;
          case "snippetformat":
            suggestions.snippetData = suggestions.snippetData || {};
            suggestions.snippetData.format = value;
            break;
          case "clusters":
            suggestions.clusters = Object.fromEntries(
              value.split(",").map((cluster) => [cluster.trim(), ""])
            );
            break;
          case "entities":
            suggestions.entities = Object.fromEntries(
              value.split(";").map((entity) => {
                const [name, desc] = entity.split("|").map((s) => s.trim());
                return [name, desc];
              })
            );
            break;
        }
      }

      // Define slugify for Tweak 5 (if not already available)
      const slugify = (str) => str.toLowerCase().replace(/\s+/g, "-");

      // Apply ChatGPT's prompt exactly as provided
      const businessContext = `
Company Name: ${businessData.companyName}
Description: ${businessData.description}
Services: ${businessData.services}
Focus Service: ${businessData.focusService}
Target Audience: ${businessData.targetAudience}
Tone: ${businessData.brandTone}
Persona Style: "Natural and Human-like"
Topic: ${keyword || suggestions.primaryKeywords?.[0]}
Key Message: ${keyPoints?.join(", ") || suggestions.keyPoints?.join(", ")}
Ad/Promo Details: ${cta || suggestions.cta}
Goal: ${uniqueBusinessGoal || suggestions.uniqueBusinessGoal}
Content Pillar: ${focusService || businessData.focusService}
Challenge: ${specificChallenge || suggestions.specificChallenge}
Business Goal: ${uniqueBusinessGoal || suggestions.uniqueBusinessGoal}
Personal Anecdote: ${personalAnecdote || suggestions.personalAnecdote}
Primary Keyword: ${keyword || suggestions.primaryKeywords?.[0]}
Secondary Keywords: ${secondaryKeywords?.join(", ") || suggestions.secondaryKeywords?.join(", ")}
Stats: ${Object.entries(suggestions.stats || {}).map(([fact, source]) => `${fact} - ${source}`).join(", ")}
FAQs: ${Object.entries(suggestions.faqs || {}).map(([q, a]) => `${q}: ${a}`).join(" | ")}
Related Subtopics: ${Object.keys(suggestions.clusters || {}).join(", ")}
Featured Snippet Target: ${suggestions.snippetData?.question || "N/A"} - ${suggestions.snippetData?.format || "paragraph"}
Trusted Tools/Entities: ${Object.entries(suggestions.entities || {}).map(([name, desc]) => `${name} (${desc})`).join(", ")}
Specific Instructions: ${specificInstructions || suggestions.specificInstructions}
`;

      const seoPrompt = `
You are a professional SEO strategist and content writer. Based on the business context above, generate a high-performing blog article in valid **escaped JSON format**.

🎯 Goals:
- Rank on Google for the topic: "${keyword || suggestions.primaryKeywords?.[0]}"
- Engage ${businessData.targetAudience}
- Convert interest into action for: "${businessData.focusService}"

🧠 Writing Guidelines:
- Write a unique, non-templated, original blog (1200–1500 words)
- Use the primary keyword 5–7 times (naturally)
- Use secondary keywords contextually (2–3 times each)
- Mention the business name 3–5 times
- Reference input stats (with source)
- Include subheadings (H2/H3) optimized for long-tail queries and snippet visibility
- Include 3–5 internal links using natural anchor text
- Include 1–2 external references (tools, sources, experts)
- Add a "Key Takeaways" section using bullet points
- Add a natural FAQ section using the FAQ input
- End with a clear CTA aligned to the business goal
- Use the selected tone/persona to influence voice and flow

⚙️ Output Format (JSON Only – No Markdown):
{
  "title": "SEO headline under 60 characters with primary keyword",
  "metaDescription": "150-160 character SEO meta with primary keyword",
  "proposedUrl": "/[focus-service]-[topic]-[audience]",
  "introduction": "250-300 word intro addressing the user pain point, using the primary keyword",
  "sections": [
    {
      "heading": "H2 optimized for long-tail keyword",
      "subheadings": ["H3 variation", "H3 actionable"],
      "content": ["300-400 words per subheading"]
    },
    {
      "heading": "H2 with case study or success insight",
      "subheadings": ["H3 with anecdote", "H3 with lesson learned"],
      "content": ["Real-world proof points or client win story"]
    }
  ],
  "keyTakeaways": ["Bullet 1", "Bullet 2", "Bullet 3"],
  "faqs": [
    {"question": "Keyword-rich question", "answer": "150-200 words"},
    {"question": "Keyword-rich question", "answer": "150-200 words"},
    {"question": "Conversational question", "answer": "150-200 words"}
  ],
  "conclusion": "Summarize benefits, re-emphasize focus service, use a CTA",
  "internalLinks": ["/services/${slugify(businessData.focusService)}", "/about", "/contact", "/blog/${slugify(keyword || suggestions.primaryKeywords?.[0])}"],
  "schemaMarkup": "Valid escaped JSON-LD string with headline, description, datePublished, author",
  "images": []
}

💥 IMPORTANT:
- Do NOT wrap output in markdown or backticks.
- Use escaped quotes (e.g. \\"example\\") for all string values inside the JSON.
- No trailing commas.
- No additional commentary outside of the JSON.
`;

      const contentPrompt = `${businessContext}\n\n${seoPrompt}`;

      let generatedContent;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          const contentResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: contentPrompt }],
            max_tokens: 3500,
            temperature: 0.6,
            presence_penalty: 0.5,
            frequency_penalty: 0.5,
          });

          let rawContent = contentResponse.choices[0].message.content.trim();
          console.log("Raw AI Response:", rawContent);

          rawContent = manualFixJson(rawContent);

          let repairedJson;
          try {
            repairedJson = jsonrepair(rawContent);
          } catch (repairError) {
            logAndEmitError("JSON Repair Error:", repairError.message, repairError.stack);
            attempts++;
            if (attempts === maxAttempts) {
              throw new Error("Unable to repair JSON response after multiple attempts");
            }
            continue;
          }

          generatedContent = JSON.parse(repairedJson);
          break;
        } catch (error) {
          console.error("Attempt", attempts + 1, "failed:", error);
          attempts++;
          if (attempts === maxAttempts) {
            console.error("JSON Parsing Failed after all attempts:", error);
            generatedContent = {
              title: "Fallback Article Title",
              metaDescription: "This is a fallback article due to generation issues.",
              proposedUrl: "/fallback-article",
              introduction:
                "We encountered an issue generating the full article. Please try again later.",
              sections: [
                {
                  heading: "Section 1",
                  subheadings: ["Subheading 1", "Subheading 2"],
                  content: [
                    "This is a fallback section.",
                    "Please try generating the article again.",
                  ],
                },
              ],
              keyTakeaways: ["Fallback point 1", "Fallback point 2", "Fallback point 3"],
              faqs: [
                {
                  question: "What happened?",
                  answer: "There was an issue generating the article.",
                },
                {
                  question: "What should I do?",
                  answer: "Please try again later.",
                },
              ],
              conclusion:
                "We apologize for the inconvenience. Contact support if the issue persists.",
              internalLinks: ["/about", "/contact"],
              schemaMarkup:
                '{"@context": "https://schema.org", "@type": "Article", "headline": "Fallback Article Title", "description": "This is a fallback article due to generation issues."}',
              images: [],
            };
          }
        }
      }

      // Tweak 7: Review the Final Draft with Fallback (replacing fetchFromPerplexity)
      const review = await fetchWithFallback(JSON.stringify(generatedContent), {
        intent: "critique",
        criteria: ["SEO", "E-A-T", "readability", "uniqueness"],
      });
      console.log("Review (with fallback):", review);
      // Note: Applying review suggestions would require manual edits or another OpenAI call. For now, we log it.

      generatedContent.sections = generatedContent.sections.map((section) => {
        if (!Array.isArray(section.content)) {
          section.content = [JSON.stringify(section.content)];
        }
        return section;
      });

      if (typeof generatedContent.schemaMarkup !== "string") {
        generatedContent.schemaMarkup = JSON.stringify(generatedContent.schemaMarkup);
      }

      if (!Array.isArray(generatedContent.images)) {
        generatedContent.images = [];
      }

      const content = new Content({
        type: "Article",
        businessId: business._id,
        userId: req.user._id,
        data: generatedContent,
        status: "Draft",
      });
      await content.save();

      if (process.env.NODE_ENV !== "development" && !user.isEditEdgeUser) {
        user.articleGenerationCount += 1;
        await user.save();
      }

      await Business.findByIdAndUpdate(business._id, {
        $push: { contentHistory: content._id },
      });

      await User.findByIdAndUpdate(req.user._id, {
        $push: { personalContent: content._id },
      });

      if (
        process.env.NODE_ENV !== "development" &&
        user.subscription === "None" &&
        !user.freeTrialUsed
      ) {
        await User.findByIdAndUpdate(req.user._id, { freeTrialUsed: true });
      }

      req.session.generatedContent = generatedContent;

      const articleLimits = {
        Basic: 2,
        Pro: 3,
        Enterprise: 10,
      };
      const userArticleLimit = articleLimits[user.subscription] || 0;
      const remainingArticles = userArticleLimit - user.articleGenerationCount;
      const response = {
        ...generatedContent,
        contentId: content._id.toString(),
        redirect: "/blog-article/generated-article",
      };
      if (
        process.env.NODE_ENV !== "development" &&
        !user.isEditEdgeUser &&
        remainingArticles === 1
      ) {
        response.warning = `You have 1 article generation left this week for the ${user.subscription} plan.`;
      }

      res.json(response);
    } catch (error) {
      logAndEmitError("Error generating article:", error.message, error.stack);
      res.status(500).json({
        error: "Error generating content. Please try again.",
        details: error.message,
      });
    }
  }
);

// Step 6: Save business details prompt
router.get("/save-details-prompt", (req, res) => {
  if (!req.session.tempBusinessDetails) {
    return res.status(400).json({ redirect: "/blog-article/branding-article" });
  }
  res.json({
    business: req.session.tempBusinessDetails,
    error: null,
  });
});

// Step 8: Display generated article
router.get("/generated-article", (req, res) => {
  console.log("Fetching generated content from session:", req.session.generatedContent);
  if (!req.session.generatedContent) {
    return res.status(400).json({ redirect: "/blog-article/branding-article" });
  }

  res.json({
    content: req.session.generatedContent,
    error: null,
  });
});

// Step 9: Generate new content
router.get("/generate-new-content", (req, res) => {
  if (req.session.businessDetails) {
    return res.json({
      companyName: req.session.businessDetails.companyName,
      description: req.session.businessDetails.description || "",
      services: req.session.businessDetails.services || "",
      targetAudience: req.session.businessDetails.targetAudience || "",
      brandTone: req.session.businessDetails.brandTone || "",
      keyword: "",
      isRegistered: true,
      error: null,
    });
  } else if (req.session.tempBusinessDetails) {
    return res.json({
      companyName: req.session.tempBusinessDetails.companyName,
      description: req.session.tempBusinessDetails.description || "",
      services: req.session.tempBusinessDetails.services || "",
      targetAudience: req.session.tempBusinessDetails.targetAudience || "",
      brandTone: req.session.tempBusinessDetails.brandTone || "",
      keyword: req.session.tempBusinessDetails.keyword || "",
      isRegistered: false,
      error: null,
    });
  }
  res.json({ redirect: "/blog-article/branding-article" });
});

// Clear cache every hour
setInterval(() => cache.clear(), 60 * 60 * 1000);

module.exports = router;