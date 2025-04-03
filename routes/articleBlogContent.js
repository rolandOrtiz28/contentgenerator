require("dotenv").config();
const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const axios = require("axios");
const Business = require("../models/Business");
const { getSEOSuggestionsWithFallback } = require("../utils/suggestionFetcher"); // Updated import
const { fetchWithFallback } = require("../utils/keywordSuggester"); // Updated import
const { parsePerplexityPlainText } = require("../utils/perplexity-utils.js"); // Updated import
const { fallbackManualParse } = require("../utils/openAI-utils.js"); // Updated import
const { jsonrepair } = require("jsonrepair");
const Content = require("../models/Content");
const User = require("../models/User");
const { ensureAuthenticated } = require("../middleware/auth");
const { ensureBusinessRole } = require("../middleware/businessAccess");
const { logAndEmitError } = require("../socket");
const { sanitizeAndRepairJson } = require("../utils/cleanJson");
const { suggestKeywordsWithPerplexity } = require("../utils/keywordSuggester");


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
    return res
      .status(400)
      .json({ error: "Business ID and focus service are required" });
  }

  try {
    const business = await Business.findOne({
      _id: businessId,
      $or: [{ owner: req.user._id }, { "members.user": req.user._id }],
    });

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Update business with selected focus service
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

    console.log("🔥 Calling suggestKeywordsWithPerplexity()");
    const suggestions = await suggestKeywordsWithPerplexity(businessDetails);
    console.log("🔥 Suggestions received:", suggestions);

    // Validate result
    if (
      !suggestions.primaryKeywords.length &&
      !suggestions.secondaryKeywords.length &&
      !suggestions.keyPoints.length
    ) {
      console.error("❌ No usable SEO suggestions returned:", suggestions);
      return res.status(500).json({
        error: "Failed to generate SEO suggestions. Please try again later.",
      });
    }

    const responseSuggestions = {
      suggestedPrimaryKeywords: suggestions.primaryKeywords,
      suggestedSecondaryKeywords: suggestions.secondaryKeywords,
      suggestedKeyPoints: suggestions.keyPoints,
      suggestedUniqueBusinessGoal: suggestions.uniqueBusinessGoal,
      suggestedSpecificChallenge: suggestions.specificChallenge,
      suggestedPersonalAnecdote: suggestions.personalAnecdote,
      suggestedCTA: suggestions.cta,
      suggestedSpecificInstructions: suggestions.specificInstructions,
      competitiveData: suggestions.competitiveData || {},
      stats: suggestions.stats || [],
      faqs: suggestions.faqs || [],
      snippetData: suggestions.snippetData || {},
      clusters: suggestions.clusters || {},
      entities: suggestions.entities || [],
      error: null,
    };

    console.log("✅ Final API Response:", responseSuggestions);
    res.json(responseSuggestions);
  } catch (error) {
    logAndEmitError("Error fetching suggestions:", error.message, error.stack);
    res
      .status(500)
      .json({ error: "Failed to fetch suggestions. Please try again later." });
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
      const user = await User.findById(req.user._id).populate("businesses");
      if (!user) return res.status(404).json({ error: "User not found" });

      // Subscription and limit checks (unchanged)
      if (
        process.env.NODE_ENV !== "development" &&
        !user.isEditEdgeUser &&
        user.subscription === "None" &&
        user.freeTrialUsed
      ) {
        return res.status(403).json({
          error: "You have already used your free trial. Please subscribe to continue.",
          redirect: "/subscribe",
        });
      }

      if (process.env.NODE_ENV !== "development" && !user.isEditEdgeUser) {
        const now = new Date();
        if (!user.contentGenerationResetDate || now > user.contentGenerationResetDate) {
          user.articleGenerationCount = 0;
          user.socialMediaGenerationCount = 0;
          user.contentGenerationResetDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          await user.save();
        }

        const articleLimits = { Basic: 2, Pro: 3, Enterprise: 10 };
        const userArticleLimit = articleLimits[user.subscription] || 0;
        if (user.subscription !== "None" && user.articleGenerationCount >= userArticleLimit) {
          return res.status(403).json({
            error: `You have reached your article generation limit of ${userArticleLimit} for the ${user.subscription} plan this week. Please upgrade your plan or wait until next week.`,
            redirect: "/subscribe",
          });
        }
      }

      const businessId = req.session.businessId || req.headers["x-business-id"];
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

      const businessData = {
        companyName: business.companyName,
        description: business.description,
        services: business.services,
        focusService: business.focusService || focusService || business.services.split(",")[0].trim(),
        targetAudience: business.targetAudience,
        brandTone: business.brandTone || brandTone || "professional",
      };

      // SEO Suggestions (unchanged)
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

      const suggestions = {};
      const lines = suggestionsText.split("\n").map((line) => line.trim());
      for (const line of lines) {
        const [key, value] = line.split(": ").map((part) => part.trim());
        if (!key || !value) continue;

        switch (key.toLowerCase()) {
          case "primarykeywords": suggestions.primaryKeywords = value.split(",").map((kw) => kw.trim()); break;
          case "secondarykeywords": suggestions.secondaryKeywords = value.split(",").map((kw) => kw.trim()); break;
          case "keypoints": suggestions.keyPoints = value.split(",").map((kp) => kp.trim()); break;
          case "uniquebusinessgoal": suggestions.uniqueBusinessGoal = value; break;
          case "specificchallenge": suggestions.specificChallenge = value; break;
          case "personalanecdote": suggestions.personalAnecdote = value; break;
          case "cta": suggestions.cta = value; break;
          case "specificinstructions": suggestions.specificInstructions = value; break;
          case "toph2s": suggestions.competitiveData = suggestions.competitiveData || {}; suggestions.competitiveData.topH2s = value; break;
          case "metadescriptions": suggestions.competitiveData = suggestions.competitiveData || {}; suggestions.competitiveData.metaDescriptions = value; break;
          case "snippetsummaries": suggestions.competitiveData = suggestions.competitiveData || {}; suggestions.competitiveData.snippetSummaries = value; break;
          case "contentgaps": suggestions.competitiveData = suggestions.competitiveData || {}; suggestions.competitiveData.contentGaps = value; break;
          case "stats": suggestions.stats = Object.fromEntries(value.split(";").map((stat) => stat.split("-").map((s) => s.trim()))); break;
          case "faqs": suggestions.faqs = Object.fromEntries(value.split(";").map((faq) => faq.split("|").map((s) => s.trim()))); break;
          case "snippetquestion": suggestions.snippetData = suggestions.snippetData || {}; suggestions.snippetData.question = value; break;
          case "snippetformat": suggestions.snippetData = suggestions.snippetData || {}; suggestions.snippetData.format = value; break;
          case "clusters": suggestions.clusters = Object.fromEntries(value.split(",").map((cluster) => [cluster.trim(), ""])); break;
          case "entities": suggestions.entities = Object.fromEntries(value.split(";").map((entity) => entity.split("|").map((s) => s.trim()))); break;
        }
      }

      // Word count setup (unchanged)
      let targetWordCountMin = 3500, targetWordCountMax = 4000;
      switch (articleLength) {
        case "1200-1500 words": targetWordCountMin = 1200; targetWordCountMax = 1500; break;
        case "1500-2000 words": targetWordCountMin = 1500; targetWordCountMax = 2000; break;
        case "2000+ words": targetWordCountMin = 2000; targetWordCountMax = 2500; break;
        default: console.warn(`Invalid articleLength value: ${articleLength}. Defaulting to 3500-4000 words.`); break;
      }

      // Shared business context
      const businessContext = `
Business Details:
- Company Name: ${businessData.companyName}
- Description: ${businessData.description}
- Services: ${businessData.services}
- Focus Service: ${businessData.focusService}
- Target Audience: ${businessData.targetAudience}
- Brand Tone: ${businessData.brandTone}
- Persona Style: "Natural and Human-like"
- Topic: ${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}
- Key Message: ${keyPoints?.join(", ") || suggestions.keyPoints?.join(", ") || "Enhance online presence"}
- Ad/Promo Details: ${cta || suggestions.cta || "Contact us today!"}
- Goal: ${uniqueBusinessGoal || suggestions.uniqueBusinessGoal || "Increase online visibility"}
- Content Pillar: ${focusService || businessData.focusService}
- Challenge: ${specificChallenge || suggestions.specificChallenge || "Standing out in a competitive market"}
- Personal Anecdote: ${personalAnecdote || suggestions.personalAnecdote || "A client saw a 30% increase in engagement after our redesign"}
- Primary Keyword: ${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}
- Secondary Keywords: ${secondaryKeywords?.join(", ") || suggestions.secondaryKeywords?.join(", ") || "online presence, brand enhancement"}
- Stats: ${Object.entries(suggestions.stats || {}).map(([fact, source]) => `${fact} - ${source}`).join(", ") || "N/A"}
- FAQs: ${Object.entries(suggestions.faqs || {}).map(([q, a]) => `${q}: ${a}`).join(" | ") || "N/A"}
- Related Subtopics: ${Object.keys(suggestions.clusters || {}).join(", ") || "N/A"}
- Featured Snippet Target: ${suggestions.snippetData?.question || "N/A"} - ${suggestions.snippetData?.format || "paragraph"}
- Trusted Tools/Entities: ${Object.entries(suggestions.entities || {}).map(([name, desc]) => `${name} (${desc})`).join(", ") || "N/A"}
- Specific Instructions: ${specificInstructions || suggestions.specificInstructions || "Focus on benefits for the target audience"}
`;

      // Shared JSON rules
      const jsonRules = `
📌 JSON OUTPUT RULES (STRICT):
- Return ONLY raw JSON. Do NOT wrap in markdown, backticks, or text.
- All string values must use straight double quotes: "
- Escape newlines as \\n (double backslash + n).
- Escape inner quotes as \\" (backslash + quote).
- No smart quotes like “ or ” — only use ".
- No trailing commas.
- Close all {} and [] brackets properly.
- Your output must be 100% valid and parsable with JSON.parse()
If you cannot follow these rules, do not reply at all.
`;

      // Helper function for API calls with retries
      async function generateWithRetry(prompt, maxTokens, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            const response = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }],
              max_tokens: maxTokens,
              temperature: 0.6,
              presence_penalty: 0.5,
              frequency_penalty: 0.5,
            });
            const rawContent = response.choices[0].message.content.trim();
            console.log(`Attempt ${attempt} Raw Response:`, rawContent);
            const parsedContent = await sanitizeAndRepairJson(rawContent);
            return parsedContent;
          } catch (error) {
            console.warn(`Attempt ${attempt} Failed:`, error.message);
            if (attempt === retries) throw new Error(`Failed after ${retries} attempts: ${error.message}`);
          }
        }
      }

      // Dynamically generate section headings and related content
      const suggestedHeadings = suggestions.competitiveData?.topH2s?.split(", ").map(h => h.trim()) || [];
      const fallbackHeadings = suggestions.keyPoints?.map(point => {
        return `How ${businessData.focusService} Can ${point}`;
      }) || [];
      const clusters = Object.keys(suggestions.clusters || {}).map(cluster => cluster.trim()) || [];
      const contentGaps = suggestions.competitiveData?.contentGaps?.split(", ").map(g => g.trim()) || [];

      // Ensure we have at least 6 headings (5 main sections + 1 with subheadings)
      const sectionHeadings = [];
      if (suggestedHeadings.length >= 6) {
        sectionHeadings.push(...suggestedHeadings.slice(0, 6));
      } else {
        const combinedHeadings = [...suggestedHeadings];
        for (let i = 0; combinedHeadings.length < 6 && i < fallbackHeadings.length; i++) {
          combinedHeadings.push(fallbackHeadings[i]);
        }
        while (combinedHeadings.length < 6) {
          combinedHeadings.push(`Exploring ${keyword || suggestions.primaryKeywords?.[0] || "Digital Marketing"} for ${businessData.targetAudience}`);
        }
        sectionHeadings.push(...combinedHeadings);
      }

      // Generate subheadings for the last section based on clusters, key points, or content gaps
      const subheadings = [];
      if (clusters.length >= 2) {
        subheadings.push(...clusters.slice(0, 2));
      } else if (suggestions.keyPoints?.length >= 2) {
        subheadings.push(`Maximizing ${suggestions.keyPoints[0]}`, `Achieving ${suggestions.keyPoints[1]}`);
      } else if (contentGaps.length >= 2) {
        subheadings.push(`Addressing ${contentGaps[0]} in ${businessData.focusService}`, `Overcoming ${contentGaps[1]} with ${businessData.focusService}`);
      } else {
        subheadings.push(
          `Improving ${businessData.focusService} for ${businessData.targetAudience}`,
          `Scaling ${businessData.focusService} for Growth`
        );
      }

      // Generate related articles based on clusters, key points, or content gaps
      const relatedArticles = [];
      const relatedTopics = clusters.length >= 3 ? clusters : (suggestions.keyPoints?.length >= 3 ? suggestions.keyPoints : contentGaps);
      for (let i = 0; i < 3; i++) {
        const topic = relatedTopics[i] || `Exploring ${businessData.focusService} Benefits ${i + 1}`;
        relatedArticles.push({
          title: topic,
          url: `/${topic.toLowerCase().replace(/\s+/g, '-')}`
        });
      }

      function slugify(text) {
        return text?.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      }
      
      const keywordSlug = slugify(keyword || suggestions.primaryKeywords?.[0] || 'digital marketing');
      const focusSlug = slugify(businessData.focusService);
      
      const proposedUrl = `/${focusSlug !== keywordSlug ? `${focusSlug}-${keywordSlug}` : keywordSlug}`;
      // Generate internal links dynamically
      const internalLinks = [
        `/services/${businessData.focusService.toLowerCase().replace(/\s+/g, '-')}`,
        `/company/${businessData.companyName.toLowerCase().replace(/\s+/g, '-')}-overview`,
        `/get-in-touch`,
        `/blog/${keyword?.toLowerCase().replace(/\s+/g, '-') || suggestions.primaryKeywords?.[0]?.toLowerCase().replace(/\s+/g, '-') || "digital-marketing"}`,
        `/resources/${businessData.targetAudience.toLowerCase().replace(/\s+/g, '-')}`
      ].slice(0, 4);

      // Call 1: Metadata and Introduction
      const call1Prompt = `
${businessContext}
You are a professional SEO strategist and content writer. Generate metadata and introduction in valid JSON format for a blog article targeting a middle-of-funnel audience with commercial intent.

🎯 Goals:
- Rank on Google for the topic: "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}"
- Engage ${businessData.targetAudience}
- Convert interest into action for: "${businessData.focusService}"

🧠 Writing Guidelines:
- Write a unique, non-templated, original introduction that hooks the reader by addressing a key challenge or opportunity related to the topic "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}" for ${businessData.targetAudience}.
- Use the primary keyword "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}" 1-2 times naturally.
- Mention the business name "${businessData.companyName}" once.
- Use the brand tone "${businessData.brandTone}" and persona style "Natural and Human-like".

**Word Count Requirement:**
- Introduction: 200-250 words

{
  "title": "SEO headline under 60 characters with primary keyword",
  "titleTag": "SEO-optimized alternate title under 60 chars with primary keyword and brand",
  "metaDescription": "150-160 character SEO meta with primary keyword",
  "proposedUrl":  "${proposedUrl}",
  "contentIntent": "Middle-of-funnel, commercial intent targeting ideal customers researching options",
  "targetKeyword": "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}",
  "tags": [
    "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}",
    "${suggestions.secondaryKeywords?.[0] || "online presence"}",
    "${suggestions.secondaryKeywords?.[1] || "brand enhancement"}",
    "${suggestions.secondaryKeywords?.[2] || "seo"}",
    "business",
    "marketing",
    "content"
  ],
  "introduction": "200-250 word intro with a unique hook addressing a challenge or opportunity for ${businessData.targetAudience}"
}
${jsonRules}
`;
      const call1Result = await generateWithRetry(call1Prompt, 500);
      console.log("Call 1 Result:", call1Result);

      // Call 2: Sections and Key Takeaways
      const call2Prompt = `
${businessContext}
Previous Output: ${JSON.stringify(call1Result)}
You are a professional SEO strategist and content writer. Generate sections and key takeaways in valid JSON format, building on the introduction "${call1Result.introduction.substring(0, 100)}...".

🎯 Goals:
- Rank on Google for the topic: "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}"
- Engage ${businessData.targetAudience}
- Convert interest into action for: "${businessData.focusService}"

🧠 Writing Guidelines:
- Write unique, non-templated, original sections that align with the business's focus service "${businessData.focusService}" and target audience "${businessData.targetAudience}".
- Use the primary keyword "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}" 3-4 times across sections naturally.
- Use secondary keywords (${secondaryKeywords?.join(", ") || suggestions.secondaryKeywords?.join(", ") || "online presence, brand enhancement"}) 1-2 times each contextually across sections.
- Mention the business name "${businessData.companyName}" 2-3 times across sections.
- Include at least 2 stats from the input with sources (e.g., '70% of consumers - Source: Forrester').
- Include subheadings (H2/H3) optimized for long-tail queries and snippet visibility.
- Use the brand tone "${businessData.brandTone}" and persona style "Natural and Human-like".

**Word Count Requirement:**
- Each section: 300-400 words (5 main sections), 250-300 words (1 additional section with subheadings)
- Key Takeaways: 50-60 words
- For the section with subheadings, ensure each subheading has a dedicated paragraph of 125-150 words to meet the total 250-300 word requirement.

{
  "sections": [
    {"heading": "${sectionHeadings[0]}", "content": ["300-400 word section exploring the first suggested topic or key point for ${businessData.targetAudience}"]},
    {"heading": "${sectionHeadings[1]}", "content": ["300-400 word section exploring the second suggested topic or key point for ${businessData.targetAudience}"]},
    {"heading": "${sectionHeadings[2]}", "content": ["300-400 word section exploring the third suggested topic or key point for ${businessData.targetAudience}"]},
    {"heading": "${sectionHeadings[3]}", "content": ["300-400 word section exploring the fourth suggested topic or key point for ${businessData.targetAudience}"]},
    {"heading": "${sectionHeadings[4]}", "content": ["300-400 word section exploring the fifth suggested topic or key point for ${businessData.targetAudience}"]},
    {
      "heading": "${sectionHeadings[5]}",
      "subheadings": ["${subheadings[0]}", "${subheadings[1]}"],
      "content": [
        "125-150 word paragraph explaining how ${subheadings[0].toLowerCase()} benefits ${businessData.focusService} for ${businessData.targetAudience}, with examples.",
        "125-150 word paragraph discussing how ${subheadings[1].toLowerCase()} enhances ${businessData.focusService} outcomes, focusing on practical benefits."
      ]
    }
  ],
  "keyTakeaways": [
    "18-20 word bullet summarizing the impact of ${businessData.focusService} on ${suggestions.keyPoints?.[0] || "visibility and conversions"}.",
    "18-20 word bullet highlighting the role of ${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"} in ${suggestions.keyPoints?.[1] || "e-commerce success"}.",
    "18-20 word bullet emphasizing the importance of ${businessData.focusService} in ${suggestions.keyPoints?.[2] || "driving sales"}."
  ]
}
${jsonRules}
`;
      const call2Result = await generateWithRetry(call2Prompt, 2500);
      console.log("Call 2 Result:", call2Result);

      // Call 3: FAQs, Conclusion, and Extras
      const call3Prompt = `
${businessContext}
Previous Outputs: ${JSON.stringify({ call1: call1Result, call2: call2Result })}
You are a professional SEO strategist and content writer. Generate FAQs, conclusion, and extras in valid JSON format, tying to prior content from "${call1Result.title}" and sections.

🎯 Goals:
- Rank on Google for the topic: "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}"
- Engage ${businessData.targetAudience}
- Convert interest into action for: "${businessData.focusService}"

🧠 Writing Guidelines:
- Write a unique, non-templated, original conclusion that summarizes the key benefits discussed in the sections and encourages action.
- Write 10 FAQs that are keyword-rich and relevant to the topic, using the FAQ input where applicable, and expanding with related questions if needed.
- Use the primary keyword "${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"}" 1-2 times in the conclusion and 3-4 times across FAQs naturally.
- Use secondary keywords (${secondaryKeywords?.join(", ") || suggestions.secondaryKeywords?.join(", ") || "online presence, brand enhancement"}) 1-2 times each across FAQs.
- Mention the business name "${businessData.companyName}" 1-2 times in the conclusion and 2-3 times across FAQs.
- Include 1 stat from the input with source (e.g., '70% of consumers - Source: Forrester') in the conclusion.
- Include 3–5 internal links and 2-3 external references (tools, sources, experts) across the FAQs and conclusion.
- End with a clear CTA aligned to "${cta || suggestions.cta || "Contact us today!"}".
- Use the brand tone "${businessData.brandTone}" and persona style "Natural and Human-like".

**Word Count Requirement:**
- Conclusion: 200-250 words
- FAQs: 1200-1500 words total (10 questions, 120-150 words per answer)
- Related Articles: 30-50 words

{
  "faqs": [
    {"question": "${Object.keys(suggestions.faqs || {})[0] || "What is the importance of " + (keyword || suggestions.primaryKeywords?.[0] || "digital marketing") + " for " + businessData.targetAudience + "?"}", "answer": "120-150 word answer addressing the importance of the topic for the target audience"},
    {"question": "${Object.keys(suggestions.faqs || {})[1] || "How can " + (keyword || suggestions.primaryKeywords?.[0] || "digital marketing") + " address " + (suggestions.competitiveData?.contentGaps?.split(", ")[0] || "common business challenges") + "?"}", "answer": "120-150 word answer explaining how the topic addresses specific challenges"},
    {"question": "${Object.keys(suggestions.faqs || {})[2] || "What are the best practices for " + (keyword || suggestions.primaryKeywords?.[0] || "digital marketing") + " in " + (Object.keys(suggestions.clusters || {})[0] || "e-commerce") + "?"}", "answer": "120-150 word answer listing best practices"},
    {"question": "How does ${businessData.focusService} address ${suggestions.specificChallenge || "common challenges"}?", "answer": "120-150 word answer addressing the challenge"},
    {"question": "What role does ${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"} play in ${suggestions.keyPoints?.[0] || "increasing visibility"}?", "answer": "120-150 word answer explaining the role"},
    {"question": "How can ${businessData.focusService} help with ${suggestions.keyPoints?.[1] || "boosting conversions"}?", "answer": "120-150 word answer detailing benefits"},
    {"question": "What are common mistakes to avoid when implementing ${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"} for ${businessData.targetAudience}?", "answer": "120-150 word answer listing common mistakes"},
    {"question": "How often should I update my ${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"} approach to stay competitive?", "answer": "120-150 word answer on strategy updates"},
    {"question": "What tools can enhance my ${keyword || suggestions.primaryKeywords?.[0] || "digital marketing"} efforts for ${Object.keys(suggestions.clusters || {})[1] || "business growth"}?", "answer": "120-150 word answer mentioning tools like Google Analytics or SEMrush"},
    {"question": "Why choose ${businessData.companyName} for ${businessData.focusService}?", "answer": "120-150 word answer highlighting the company's expertise"}
  ],
  "relatedArticles": [
    {"title": "${relatedArticles[0].title}", "url": "${relatedArticles[0].url}"},
    {"title": "${relatedArticles[1].title}", "url": "${relatedArticles[1].url}"},
    {"title": "${relatedArticles[2].title}", "url": "${relatedArticles[2].url}"}
  ],
  "conclusion": "200-250 word summary of the article's key benefits, including 1 stat with source (e.g., '70% of consumers - Source: Forrester'), and ending with the CTA",
  "internalLinks": [
    "${internalLinks[0]}",
    "${internalLinks[1]}",
    "${internalLinks[2]}",
    "${internalLinks[3]}"
  ],
  "images": []
}
${jsonRules}
`;
      const call3Result = await generateWithRetry(call3Prompt, 2000);
      console.log("Call 3 Result:", call3Result);

      // Combine results
      const generatedContent = {
        ...call1Result,
        ...call2Result,
        ...call3Result,
      };

      // Fix conclusion formatting
      if (generatedContent.conclusion) {
        generatedContent.conclusion = generatedContent.conclusion
          .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between lowercase and uppercase letters
          .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
          .trim(); // Remove leading/trailing spaces
      }

      // Word count check (unchanged)
      const countWords = (content) => {
        if (!content) return 0;
        let totalWords = 0;
        const countSectionWords = (text) => (typeof text === "string" ? text.split(/\s+/).filter((word) => word.length > 0).length : 0);
        totalWords += countSectionWords(content.introduction);
        totalWords += countSectionWords(content.conclusion);
        totalWords += countSectionWords(content.keyTakeaways?.join(" ") || "");
        totalWords += countSectionWords(content.relatedArticles?.map(r => r.title).join(" ") || "");
        content.sections?.forEach((section) => section.content?.forEach((p) => (totalWords += countSectionWords(p))));
        content.faqs?.forEach((faq) => (totalWords += countSectionWords(faq.answer)));
        return totalWords;
      };

      const wordCount = countWords(generatedContent);
      console.log("Generated Word Count:", wordCount);
      if (wordCount < targetWordCountMin || wordCount > targetWordCountMax) {
        console.warn(
          `Generated content does not meet the required word count range of ${targetWordCountMin}-${targetWordCountMax} words. Generated: ${wordCount} words. Proceeding anyway.`
        );
      }

      // Post-processing (unchanged)
      if (generatedContent.sections && Array.isArray(generatedContent.sections)) {
        generatedContent.sections = generatedContent.sections.map((section) => {
          if (!Array.isArray(section.content)) {
            section.content = [JSON.stringify(section.content)];
          }
          return section;
        });
      } else {
        generatedContent.sections = [];
      }
      if (!Array.isArray(generatedContent.images)) generatedContent.images = [];
      if (!Array.isArray(generatedContent.tags)) {
        generatedContent.tags = suggestions.primaryKeywords?.concat(suggestions.secondaryKeywords || []).slice(0, 7) || ["default", "article"];
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

      await Business.findByIdAndUpdate(business._id, { $push: { contentHistory: content._id } });
      await User.findByIdAndUpdate(req.user._id, { $push: { personalContent: content._id } });

      if (
        process.env.NODE_ENV !== "development" &&
        user.subscription === "None" &&
        !user.freeTrialUsed
      ) {
        await User.findByIdAndUpdate(req.user._id, { freeTrialUsed: true });
      }

      req.session.generatedContent = generatedContent;

      const articleLimits = { Basic: 2, Pro: 3, Enterprise: 10 };
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