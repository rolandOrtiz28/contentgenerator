require("dotenv").config();
const express = require('express');
const router = express.Router();
const OpenAI = require("openai");
const axios = require('axios');
const Business = require('../models/Business');
const { suggestKeywordsWithOpenAI } = require('../utils/keywordSuggester');
const { jsonrepair } = require('jsonrepair');
const Content = require('../models/Content'); 
const User = require('../models/User');
const { ensureAuthenticated, ensureBusinessRole } = require('../middleware/auth');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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


// Step 4: New route for content details form
router.get('/content-details', ensureAuthenticated, async (req, res) => {
  const businessId = req.session.businessId;

  if (!businessId) {
    return res.status(400).json({
      error: 'No business selected. Please start the process again.',
      redirect: '/blog-article/branding-article',
    });
  }

  try {
    const business = await Business.findOne({ _id: businessId, owner: req.user._id });
    if (!business) {
      return res.status(404).json({
        error: 'Business not found',
        redirect: '/blog-article/branding-article',
      });
    }

    const businessDetails = {
      companyName: business.companyName,
      description: business.description,
      services: business.services,
      focusService: business.focusService,
      targetAudience: business.targetAudience,
      demographic: business.demographic || '',
      address: business.address || '',
      email: business.email || '',
      phoneNumber: business.phoneNumber || '',
      brandTone: business.brandTone,
      companyWebsite: business.companyWebsite,
    };

    const response = { business: businessDetails };

    // Only generate suggestions if focusService is explicitly set
    if (businessDetails.focusService) {
      const suggestions = await suggestKeywordsWithOpenAI(businessDetails);
      response.suggestedPrimaryKeywords = suggestions.primaryKeywords;
      response.suggestedSecondaryKeywords = suggestions.secondaryKeywords;
      response.suggestedKeyPoints = suggestions.keyPoints;
      response.suggestedUniqueBusinessGoal = suggestions.uniqueBusinessGoal;
      response.suggestedSpecificChallenge = suggestions.specificChallenge;
      response.suggestedPersonalAnecdote = suggestions.personalAnecdote;
    }

    res.json({
      ...response,
      error: null,
    });
  } catch (error) {
    console.error('Error fetching business details:', error);
    res.status(500).json({ error: 'Failed to fetch business details' });
  }
});


// Manual fix for common JSON issues
function manualFixJson(rawContent) {
  let fixedContent = rawContent;

  // Fix missing quotes around keys in schemaMarkup
  fixedContent = fixedContent.replace(/({|,)\s*([a-zA-Z0-9_]+)\s*:/g, '$1 "$2":');

  // Fix missing quotes around values in schemaMarkup
  fixedContent = fixedContent.replace(/:\s*([a-zA-Z0-9_]+)(,|})/g, ': "$1"$2');

  // Ensure schemaMarkup has proper closing braces
  if (fixedContent.includes('"schemaMarkup":')) {
    const schemaStart = fixedContent.indexOf('"schemaMarkup":') + 14;
    const schemaEnd = fixedContent.lastIndexOf('"}');
    if (schemaEnd > schemaStart) {
      let schemaPart = fixedContent.substring(schemaStart, schemaEnd + 2);
      let braceCount = 0;
      let inQuotes = false;
      for (let i = 0; i < schemaPart.length; i++) {
        if (schemaPart[i] === '"' && schemaPart[i - 1] !== '\\') {
          inQuotes = !inQuotes;
        }
        if (!inQuotes) {
          if (schemaPart[i] === '{') braceCount++;
          if (schemaPart[i] === '}') braceCount--;
        }
      }
      while (braceCount > 0) {
        schemaPart += '}';
        braceCount--;
      }
      while (braceCount < 0) {
        schemaPart = schemaPart.slice(0, -1);
        braceCount++;
      }
      fixedContent = fixedContent.substring(0, schemaStart) + schemaPart + fixedContent.substring(schemaEnd + 2);
    }
  }

  return fixedContent;
}


router.post('/fetch-suggestions', ensureAuthenticated, async (req, res) => {
  const { businessId, focusService } = req.body;

  if (!businessId || !focusService) {
    return res.status(400).json({ error: 'Business ID and focus service are required' });
  }

  try {
    const business = await Business.findOne({ _id: businessId, owner: req.user._id });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Update the business with the new focusService
    business.focusService = focusService;
    await business.save();

    const businessDetails = {
      companyName: business.companyName,
      description: business.description,
      services: business.services,
      focusService: focusService,
      targetAudience: business.targetAudience,
      demographic: business.demographic || '',
      address: business.address || '',
      email: business.email || '',
      phoneNumber: business.phoneNumber || '',
      brandTone: business.brandTone,
      companyWebsite: business.companyWebsite,
    };

    const suggestions = await suggestKeywordsWithOpenAI(businessDetails);

    res.json({
      suggestedPrimaryKeywords: suggestions.primaryKeywords,
      suggestedSecondaryKeywords: suggestions.secondaryKeywords,
      suggestedKeyPoints: suggestions.keyPoints,
      suggestedUniqueBusinessGoal: suggestions.uniqueBusinessGoal,
      suggestedSpecificChallenge: suggestions.specificChallenge,
      suggestedPersonalAnecdote: suggestions.personalAnecdote,
      error: null,
    });
  } catch (error) {
    console.error('Error fetching suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

router.post('/generate-content-article', ensureAuthenticated, ensureBusinessRole('Editor'), async (req, res) => {
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
    specificInstructions, // Add specificInstructions
  } = req.body;

  try {
    // Fetch the user
    const user = await User.findById(req.user._id).populate('businesses');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check free trial or subscription (bypass in development)
    if (process.env.NODE_ENV !== 'development' && user.subscription === 'None' && user.freeTrialUsed) {
      return res.status(403).json({
        error: 'You have already used your free trial. Please subscribe to continue.',
        redirect: '/subscribe',
      });
    }

    // Check article generation limits (bypass in development and for EditEdge users)
    if (process.env.NODE_ENV !== 'development' && !user.isEditEdgeUser) {
      const now = new Date();
      if (!user.contentGenerationResetDate || now > user.contentGenerationResetDate) {
        user.articleGenerationCount = 0;
        user.socialMediaGenerationCount = 0;
        user.contentGenerationResetDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        await user.save();
        console.log(`Reset counts for user ${user._id}: articleGenerationCount=${user.articleGenerationCount}, contentGenerationResetDate=${user.contentGenerationResetDate}`);
      }

      const articleLimits = {
        Basic: 2,
        Pro: 3,
        Enterprise: 10,
      };

      const userArticleLimit = articleLimits[user.subscription] || 0;
      if (user.subscription !== 'None' && user.articleGenerationCount >= userArticleLimit) {
        return res.status(403).json({
          error: `You have reached your article generation limit of ${userArticleLimit} for the ${user.subscription} plan this week. Please upgrade your plan or wait until next week.`,
          redirect: '/subscribe',
        });
      }
    }

    let businessId = req.session.businessId;
    if (!businessId) {
      return res.status(400).json({
        error: 'No business selected. Please start the process again.',
        redirect: '/blog-article/branding-article',
      });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(400).json({
        error: 'Business not found.',
        redirect: '/blog-article/branding-article',
      });
    }

    const businessData = {
      companyName: business.companyName,
      description: business.description,
      services: business.services,
      focusService: business.focusService || focusService || business.services.split(',')[0].trim(),
      targetAudience: business.targetAudience,
      brandTone: business.brandTone || brandTone || 'professional',
    };

    const contentPrompt = `
    You are a top-tier SEO content strategist. Generate a highly optimized blog article as a JSON object for the provided business details. All fields must be fully AI-generated based on the input, with no hardcoded fallbacks. The content must be SEO-optimized, engaging, and at least 1200-1500 words long.

    **Business Details:**
    - Company Name: ${businessData.companyName || 'Edit Edge Multimedia'}
    - Description: ${businessData.description || 'A multimedia company specializing in innovative digital solutions'}
    - Services: ${businessData.services || 'video editing, graphic design, 3D art, web development, digital marketing'}
    - Focus Service: ${businessData.focusService || 'Digital Marketing'}
    - Target Audience: ${businessData.targetAudience || 'e-commerce businesses and SaaS startups'}
    - Brand Tone: ${businessData.brandTone || 'professional yet conversational'}
    - Primary Keyword: ${keyword || 'digital marketing for e-commerce'}
    - Secondary Keywords: ${secondaryKeywords?.join(', ') || 'real estate marketing strategies, e-commerce growth, social media marketing'}
    - Article Length: ${articleLength || '1200-1500 words'}
    - Key Points: ${keyPoints?.join(', ') || 'Increase visibility, Boost conversions, Enhance trust'}
    - CTA: ${cta || 'Contact Edit Edge Multimedia to skyrocket your online presence!'}
    - Unique Business Goal: ${uniqueBusinessGoal || 'Increase conversion rates through engaging digital strategies'}
    - Specific Challenge: ${specificChallenge || 'Overcoming low online visibility in competitive markets'}
    - Personal Anecdote: ${personalAnecdote || 'A client saw a 50% sales boost after our digital marketing overhaul'}
    - Specific AI Instructions: ${specificInstructions || 'No specific instructions provided.'}

    **SEO Guidelines:**
    - Use the primary keyword ("${keyword || 'digital marketing for e-commerce'}") 5-7 times naturally across the article, including:
      - Within the first 100 words of the introduction.
      - At least 2-3 times in the body (sections).
      - In at least one subheading.
    - Incorporate secondary keywords ("${secondaryKeywords?.join(', ') || 'real estate marketing strategies, e-commerce growth, social media marketing'}") 2-3 times each where relevant.
    - Optimize for Google Featured Snippets with concise, question-based subheadings and bullet points.
    - Mention the company name 3-5 times naturally.
    - Include 3-5 internal links (e.g., /services/[focus-service], /about, /contact).
    - Ensure readability: Use a conversational tone, short sentences, and bullet points where applicable.
    - Add image suggestions with SEO-optimized alt text (e.g., "Digital marketing infographic for e-commerce growth").

    **Specific AI Instructions:**
    - Follow the specific instructions provided: "${specificInstructions || 'No specific instructions provided.'}"
    - If specific instructions are provided, ensure the content structure adheres to them (e.g., "the content must start with a question, followed by a problem of the focus service, then how we solve that problem").

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
    1. Introduction: Address the specific challenge with primary keyword early, following the specific AI instructions if provided.
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
    - Use straight quotes (") and escape all internal quotes with \\ (e.g., "She said \\"yes\\"").
    - Do not use markdown formatting (e.g., *italics*, **bold**) in any field; use plain text instead.
    - Ensure all fields, including "schemaMarkup", are properly formatted as valid JSON strings with escaped quotes.
    - Ensure "schemaMarkup" is a complete and valid JSON-LD string, properly closed with all braces (e.g., "{\\"@context\\": \\"https://schema.org\\", ...}").
    - For the "schemaMarkup" field, include both Article and FAQPage schemas. Ensure all nested objects (e.g., "faqPage", "mainEntity") are properly structured with correct syntax, including quotes around all keys and values, and proper closing of all braces.
    - In the "schemaMarkup" field, ensure the "faqPage.mainEntity" array contains 4 valid Question objects, each with a non-empty "name" field (the question text) and an "acceptedAnswer" object with non-empty "@type" (must be "Answer") and "text" fields (the answer text). Do not include empty or placeholder fields (e.g., "name": "", "text": "").
    - Ensure there are no trailing commas in any JSON object or array.
    - Ensure content is 1200-1500 words total across sections.
    - Include stats, examples, or step-by-step tips to add depth.
    - "schemaMarkup" must be a single-line string with escaped quotes, e.g., "{\\"@context\\": \\"https://schema.org\\"}".
    - Add an "images" array with at least one image suggestion.
    `;

    const contentResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: contentPrompt }],
      max_tokens: 4000,
      temperature: 0.6,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
    });

    let rawContent = contentResponse.choices[0].message.content.trim();
    console.log('Raw AI Response:', rawContent);

    rawContent = manualFixJson(rawContent);

    let generatedContent;
    try {
      let repairedJson;
      try {
        repairedJson = jsonrepair(rawContent);
      } catch (repairError) {
        console.error('JSON Repair Error:', repairError);
        throw new Error('Unable to repair JSON response');
      }
      generatedContent = JSON.parse(repairedJson);
    } catch (error) {
      console.error('JSON Parsing Failed:', error);
      generatedContent = {
        title: "Fallback Article Title",
        metaDescription: "This is a fallback article due to generation issues.",
        proposedUrl: "/fallback-article",
        introduction: "We encountered an issue generating the full article. Please try again later.",
        sections: [
          {
            heading: "Section 1",
            subheadings: ["Subheading 1", "Subheading 2"],
            content: ["This is a fallback section.", "Please try generating the article again."]
          }
        ],
        keyTakeaways: ["Fallback point 1", "Fallback point 2", "Fallback point 3"],
        faqs: [
          { question: "What happened?", answer: "There was an issue generating the article." },
          { question: "What should I do?", answer: "Please try again later." }
        ],
        conclusion: "We apologize for the inconvenience. Contact support if the issue persists.",
        internalLinks: ["/about", "/contact"],
        schemaMarkup: "{\"@context\": \"https://schema.org\", \"@type\": \"Article\", \"headline\": \"Fallback Article Title\", \"description\": \"This is a fallback article due to generation issues.\"}",
        images: [
          { url: "/images/fallback-image.jpg", altText: "Fallback image" }
        ]
      };
    }

    generatedContent.sections = generatedContent.sections.map(section => {
      if (!Array.isArray(section.content)) {
        section.content = [JSON.stringify(section.content)];
      }
      return section;
    });

    if (typeof generatedContent.schemaMarkup !== 'string') {
      generatedContent.schemaMarkup = JSON.stringify(generatedContent.schemaMarkup);
    }

    if (!Array.isArray(generatedContent.images)) {
      generatedContent.images = [];
    }

    const content = new Content({
      type: 'Article',
      businessId: business._id,
      userId: req.user._id,
      data: generatedContent,
      status: 'Draft',
    });
    await content.save();

    if (process.env.NODE_ENV !== 'development' && !user.isEditEdgeUser) {
      console.log(`Before increment: articleGenerationCount=${user.articleGenerationCount}`);
      user.articleGenerationCount += 1;
      try {
        await user.save();
        console.log(`After increment: articleGenerationCount=${user.articleGenerationCount}`);
        const updatedUser = await User.findById(req.user._id);
        console.log(`Verified articleGenerationCount after save: ${updatedUser.articleGenerationCount}`);
      } catch (saveError) {
        console.error('Error saving user with incremented count:', saveError);
        throw new Error('Failed to update article generation count');
      }
    } else {
      console.log('Skipping articleGenerationCount increment due to development mode or EditEdge user');
    }

    await Business.findByIdAndUpdate(business._id, {
      $push: { contentHistory: content._id },
    });

    await User.findByIdAndUpdate(req.user._id, {
      $push: { personalContent: content._id },
    });

    if (process.env.NODE_ENV !== 'development' && user.subscription === 'None' && !user.freeTrialUsed) {
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
    const response = { redirect: '/blog-article/generated-article' };
    if (process.env.NODE_ENV !== 'development' && !user.isEditEdgeUser && remainingArticles === 1) {
      response.warning = `You have 1 article generation left this week for the ${user.subscription} plan.`;
    }

    res.json(response);
  } catch (error) {
    console.error('Error generating article:', error);
    res.status(500).json({ error: 'Error generating content. Please try again.', details: error.message });
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