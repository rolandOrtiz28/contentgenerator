const express = require('express');
const router = express.Router();
const OpenAI = require("openai");
const axios = require('axios');
const Business = require('../models/Business');
const { suggestKeywordsWithOpenAI } = require('../utils/keywordSuggester');
const { jsonrepair } = require('jsonrepair');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Perplexity API
const perplexityApi = axios.create({
  baseURL: 'https://api.perplexity.ai',
  headers: {
    'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    'Content-Type': 'application/json',
  },
});


// In-memory cache for Perplexity results
const cache = new Map();

// Step 1: Fetch businesses for the initial form
router.get("/branding-article", async (req, res) => {
  try {
    const businesses = await Business.find({}, 'companyName');
    res.json({ businesses, error: null });
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.status(500).json({ businesses: [], error: "Failed to load businesses." });
  }
});

// Step 3: Extract branding details from website
router.get("/extract-branding-article", async (req, res) => {
  const websiteURL = req.query.website;

  if (!websiteURL) {
    return res.status(400).json({
      companyName: req.session.tempBusinessDetails?.companyName || "",
      description: "",
      services: "",
      targetAudience: req.session.tempBusinessDetails?.targetAudience || "", // Updated to targetAudience
      brandTone: req.session.tempBusinessDetails?.brandTone || "",
      keyword: req.session.tempBusinessDetails?.keyword || "",
      isRegistered: false,
      error: "Website URL is required.",
    });
  }

  try {
    // Check session cache
    if (req.session.extractedBranding && req.session.extractedBranding.websiteURL === websiteURL) {
      return res.json({
        ...req.session.extractedBranding,
        targetAudience: req.session.tempBusinessDetails?.targetAudience || "", // Updated to targetAudience
        brandTone: req.session.tempBusinessDetails?.brandTone || "",
        keyword: req.session.tempBusinessDetails?.keyword || "",
        isRegistered: false,
        error: null,
      });
    }

    // Check database cache
    const existingBusiness = await Business.findOne({ companyWebsite: websiteURL });
    if (existingBusiness) {
      req.session.extractedBranding = {
        companyName: existingBusiness.companyName,
        description: existingBusiness.description,
        services: existingBusiness.services,
        websiteURL,
      };
      return res.json({
        ...req.session.extractedBranding,
        targetAudience: req.session.tempBusinessDetails?.targetAudience || "", // Updated to targetAudience
        brandTone: req.session.tempBusinessDetails?.brandTone || "",
        keyword: req.session.tempBusinessDetails?.keyword || "",
        isRegistered: true,
        error: null,
      });
    }

    // Check in-memory cache
    if (cache.has(websiteURL)) {
      req.session.extractedBranding = cache.get(websiteURL);
      return res.json({
        ...req.session.extractedBranding,
        targetAudience: req.session.tempBusinessDetails?.targetAudience || "", // Updated to targetAudience
        brandTone: req.session.tempBusinessDetails?.brandTone || "",
        keyword: req.session.tempBusinessDetails?.keyword || "",
        isRegistered: false,
        error: null,
      });
    }

    // Query Perplexity API
    const prompt = `
      Analyze the website at ${websiteURL} and provide:
      1. Company Name
      2. Description (50-100 words)
      3. Services (comma-separated)
      Use placeholders like "Unknown Company" if data is unavailable.
    `;

    const response = await perplexityApi.post('/chat/completions', {
      model: 'mistral-7b-instruct',
      messages: [
        { role: 'system', content: 'Extract branding info concisely.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.5,
    });

    const perplexityResponse = response.data.choices[0].message.content.trim();
    console.log("Perplexity Response:", perplexityResponse);

    let companyName = "Unknown Company";
    let description = "No description available.";
    let services = "No services found.";

    const lines = perplexityResponse.split('\n');
    lines.forEach(line => {
      if (line.startsWith('1. Company Name')) {
        companyName = line.replace('1. Company Name', '').replace(':', '').trim() || "Unknown Company";
      } else if (line.startsWith('2. Description')) {
        description = line.replace('2. Description', '').replace(':', '').trim() || "No description available.";
      } else if (line.startsWith('3. Services')) {
        services = line.replace('3. Services', '').replace(':', '').trim() || "No services found.";
      }
    });

    req.session.extractedBranding = { companyName, description, services, websiteURL };
    cache.set(websiteURL, req.session.extractedBranding);

    res.json({
      companyName,
      description,
      services,
      targetAudience: req.session.tempBusinessDetails?.targetAudience || "", // Updated to targetAudience
      brandTone: req.session.tempBusinessDetails?.brandTone || "",
      keyword: req.session.tempBusinessDetails?.keyword || "",
      isRegistered: false,
      error: null,
    });
  } catch (error) {
    console.error("Error with Perplexity API:", error.response?.data || error.message);
    const urlFallback = new URL(websiteURL);
    req.session.extractedBranding = {
      companyName: urlFallback.hostname.replace('www.', '').split('.')[0] || "Unknown Company",
      description: "No description available due to extraction error.",
      services: "No services found.",
      websiteURL,
    };
    res.status(500).json({
      ...req.session.extractedBranding,
      targetAudience: req.session.tempBusinessDetails?.targetAudience || "", // Updated to targetAudience
      brandTone: req.session.tempBusinessDetails?.brandTone || "",
      keyword: req.session.tempBusinessDetails?.keyword || "",
      isRegistered: false,
      error: "Failed to extract website data. Using fallback values.",
    });
  }
});

// Step 4: New route for content details form
router.get("/content-details", async (req, res) => {
  if (!req.session.tempBusinessDetails && !req.session.businessDetails) {
    return res.status(400).json({
      error: 'Business details not found in session. Please start the process again.',
      business: {},
      suggestedPrimaryKeywords: [],
      suggestedSecondaryKeywords: [],
      suggestedKeyPoints: [],
      suggestedUniqueBusinessGoal: '',
      suggestedSpecificChallenge: '',
      suggestedPersonalAnecdote: '',
    });
  }

  const businessDetails = req.session.businessDetails || req.session.tempBusinessDetails;
  console.log("Business Details in /content-details:", businessDetails); // Debug log

  // Ensure focusService is set
  if (!businessDetails.focusService) {
    console.warn("focusService not set, defaulting to first service.");
    businessDetails.focusService = businessDetails.services?.split(',').map(s => s.trim())[0] || "business solutions";
  }

  // Get suggestions from OpenAI
  const suggestions = await suggestKeywordsWithOpenAI(businessDetails);

  res.json({
    business: {
      companyName: businessDetails.companyName,
      description: businessDetails.description,
      services: businessDetails.services,
      focusService: businessDetails.focusService,
      targetAudience: businessDetails.targetAudience,
      demographic: businessDetails.demographic,
      address: businessDetails.address,
      email: businessDetails.email,
      phoneNumber: businessDetails.phoneNumber,
      brandTone: businessDetails.brandTone,
      companyWebsite: businessDetails.companyWebsite,
    },
    suggestedPrimaryKeywords: suggestions.primaryKeywords,
    suggestedSecondaryKeywords: suggestions.secondaryKeywords,
    suggestedKeyPoints: suggestions.keyPoints,
    suggestedUniqueBusinessGoal: suggestions.uniqueBusinessGoal, // New field
    suggestedSpecificChallenge: suggestions.specificChallenge, // New field
    suggestedPersonalAnecdote: suggestions.personalAnecdote, // New field
    error: null,
  });
});


// Step 5: Generate the SEO-optimized article


router.post("/generate-content-article", async (req, res) => {
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
  } = req.body;

  const contentPrompt = `
You are a top-tier SEO content strategist. Generate a highly optimized blog article as a JSON object for the provided business details. All fields must be fully AI-generated based on the input, with no hardcoded fallbacks. The content must be SEO-optimized, engaging, and at least 1200-1500 words long.

**Business Details:**
- Company Name: ${companyName || "Edit Edge Multimedia"}
- Description: ${description || "A multimedia company specializing in innovative digital solutions"}
- Services: ${services || "video editing, graphic design, 3D art, web development, digital marketing"}
- Focus Service: ${focusService || "Digital Marketing"}
- Target Audience: ${targetAudience || "e-commerce businesses and SaaS startups"}
- Brand Tone: ${brandTone || "professional yet conversational"}
- Primary Keyword: ${keyword || "digital marketing for e-commerce"}
- Secondary Keywords: ${secondaryKeywords?.join(", ") || "real estate marketing strategies, e-commerce growth, social media marketing"}
- Article Length: ${articleLength || "1200-1500 words"}
- Key Points: ${keyPoints?.join(", ") || "Increase visibility, Boost conversions, Enhance trust"}
- CTA: ${cta || "Contact Edit Edge Multimedia to skyrocket your online presence!"}
- Unique Business Goal: ${uniqueBusinessGoal || "Increase conversion rates through engaging digital strategies"}
- Specific Challenge: ${specificChallenge || "Overcoming low online visibility in competitive markets"}
- Personal Anecdote: ${personalAnecdote || "A client saw a 50% sales boost after our digital marketing overhaul"}

**SEO Guidelines:**
- Use the primary keyword ("${keyword || "digital marketing for e-commerce"}") 5-7 times naturally across the article, including:
  - Within the first 100 words of the introduction.
  - At least 2-3 times in the body (sections).
  - In at least one subheading.
- Incorporate secondary keywords ("${secondaryKeywords?.join(", ") || "real estate marketing strategies, e-commerce growth, social media marketing"}") 2-3 times each where relevant.
- Optimize for Google Featured Snippets with concise, question-based subheadings and bullet points.
- Mention the company name 3-5 times naturally.
- Include 3-5 internal links (e.g., /services/[focus-service], /about, /contact).
- Ensure readability: Use a conversational tone, short sentences, and bullet points where applicable.
- Add image suggestions with SEO-optimized alt text (e.g., "Digital marketing infographic for e-commerce growth").

**Output Format (JSON):**
{
  "title": "SEO-optimized title (under 60 chars) with primary keyword",
  "metaDescription": "150-160 char SEO meta description with primary keyword",
  "proposedUrl": "/[focus-service]-[target-audience]-[secondary-keyword], e.g., /digital-marketing-ecommerce-growth",
  "introduction": "250-300 word intro addressing the specific challenge, using primary keyword in first 100 words",
  "sections": [
    {
      "heading": "H2 with primary or secondary keyword",
      "subheadings": ["H3 with keyword or question", "H3 with keyword or question"],
      "content": ["300-400 words with keyword usage, stats, or examples", "300-400 words with keyword usage"]
    },
    {
      "heading": "H2 targeting secondary keyword or real-world example",
      "subheadings": ["H3 with actionable tip", "H3 with data insight"],
      "content": ["300-400 words with case study or anecdote", "300-400 words with bullet points"]
    }
  ],
  "keyTakeaways": ["Point 1 with keyword", "Point 2 with keyword", "Point 3"],
  "faqs": [
    {"question": "Question with primary keyword", "answer": "150-200 word answer with keyword"},
    {"question": "Question with secondary keyword", "answer": "150-200 word answer with keyword"},
    {"question": "Conversational question", "answer": "150-200 word answer"},
    {"question": "Conversational question", "answer": "150-200 word answer"}
  ],
  "conclusion": "250-300 word conclusion reinforcing focus service, with primary keyword and CTA",
  "internalLinks": ["/services/[focus-service]", "/about", "/contact", "/blog/[related-topic]"],
  "schemaMarkup": "Valid JSON-LD string combining Article and FAQPage schema, with escaped quotes",
  "images": [
    {"url": "/images/[descriptive-name].jpg", "altText": "Primary keyword + descriptive text"}
  ]
}

**Structure:**
1. Introduction: Address the specific challenge with primary keyword early.
2. Section 1: How [Focus Service] Drives [Target Audience] Success (keyword-rich).
3. Section 2: Optimizing [Secondary Keyword] for Growth (e.g., Social Media Marketing).
4. Section 3: Real-World Success: Case Study (use personal anecdote).
5. Section 4: Tools and Strategies for [Focus Service] (data-driven insights).
6. Conclusion: Reinforce benefits with CTA.
7. Key Takeaways: Bullet points with keywords.
8. FAQs: 4 keyword-rich, conversational questions.
9. Schema Markup: Article + FAQPage schema.
10. Images: Suggest 1-2 visuals with alt text.

**Instructions:**
- Return a valid JSON object with no backticks, markdown, or extra text.
- Use straight quotes (") and escape internal quotes with \\ (e.g., "She said \\"yes\\"").
- Ensure content is 1200-1500 words total across sections.
- Include stats, examples, or step-by-step tips to add depth.
- SchemaMarkup must be a single-line string with escaped quotes, e.g., "{\\"@context\\": \\"https://schema.org\\"}".
- Add an images array with at least one image suggestion.
`;

  try {
    const contentResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: contentPrompt }],
      max_tokens: 4000,
      temperature: 0.6,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
    });

    let rawContent = contentResponse.choices[0].message.content.trim();
    console.log("Raw AI Response:", rawContent);

    // Use jsonrepair to fix any broken JSON
    let repairedJson;
    try {
      repairedJson = jsonrepair(rawContent);
    } catch (repairError) {
      console.error("JSON Repair Error:", repairError);
      throw new Error("Unable to repair JSON response");
    }

    // Parse the repaired JSON
    const generatedContent = JSON.parse(repairedJson);

    // Ensure sections.content is an array of strings
    generatedContent.sections = generatedContent.sections.map(section => {
      if (!Array.isArray(section.content)) {
        section.content = [JSON.stringify(section.content)];
      }
      return section;
    });

    // Ensure schemaMarkup and images are properly formatted
    if (typeof generatedContent.schemaMarkup !== 'string') {
      generatedContent.schemaMarkup = JSON.stringify(generatedContent.schemaMarkup);
    }
    if (!Array.isArray(generatedContent.images)) {
      generatedContent.images = [];
    }

    req.session.generatedContent = generatedContent;
    res.json({ redirect: "/blog-article/generated-article" });
  } catch (error) {
    console.error("Error generating article:", error);
    res.status(500).json({ error: "Error generating content. Please try again." });
  }
});




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
  console.log('Fetching generated content from session:', req.session.generatedContent);
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
      targetAudience: req.session.businessDetails.targetAudience || "", // Updated to targetAudience
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
      targetAudience: req.session.tempBusinessDetails.targetAudience || "", // Updated to targetAudience
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