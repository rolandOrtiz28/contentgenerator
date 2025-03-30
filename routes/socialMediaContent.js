require("dotenv").config();
const express = require('express');
const router = express.Router();
const OpenAI = require("openai");
const axios = require('axios');
const Business = require('../models/Business');
const { suggestSocialMediaDetails } = require("../utils/socialMediaSuggester");
const Content = require('../models/Content');
const User = require('../models/User');
const { ensureAuthenticated } = require('../middleware/auth');
const { ensureBusinessRole } = require('../middleware/businessAccess');
const removeMarkdown = require('remove-markdown');


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const perplexityApi = axios.create({
  baseURL: "https://api.perplexity.ai",
  headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
});

const cache = new Map();

const fetchFromPerplexity = async (query) => {
  if (cache.has(query)) return cache.get(query);
  try {
    const response = await perplexityApi.post("/chat/completions", {
      model: "sonar-pro",
      messages: [{ role: "user", content: query }],
      max_tokens: 100,
      temperature: 0.7,
    });
    const result = response.data.choices[0].message.content.trim().split("\n");
    cache.set(query, result);
    return result;
  } catch (err) {
    console.error("Perplexity Fetch Error:", err);
    return [];
  }
};

// Keep this for backward compatibility, but we'll update the frontend to use /businesses
router.get("/branding-social", async (req, res) => {
  try {
    const businesses = await Business.find({}, 'companyName description services focusService targetAudience brandTone socialMediaType hasWebsite companyWebsite');
    res.json({ businesses, error: null });
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.status(500).json({ businesses: [], error: "Failed to load businesses." });
  }
});


router.get('/content-details', ensureAuthenticated, async (req, res) => {
  const businessId = req.session.businessId;

  if (!businessId) {
    return res.status(400).json({
      error: 'No business selected. Please start the process again.',
      redirect: '/social-media/branding-social',
    });
  }

  try {
    // Allow both owner and members to access the business
    const business = await Business.findOne({
      _id: businessId,
      $or: [
        { owner: req.user._id },
        { 'members.user': req.user._id },
      ],
    });
    if (!business) {
      return res.status(404).json({
        error: 'Business not found or you do not have access',
        redirect: '/social-media/branding-social',
      });
    }

    const businessDetails = {
      companyName: business.companyName,
      description: business.description,
      services: business.services,
      focusService: business.focusService,
      targetAudience: business.targetAudience,
      brandTone: business.brandTone,
      socialMediaType: business.socialMediaType || 'Facebook Post',
      goal: business.goal || 'Generate Leads',
      topic: business.topic || '',
      contentPillar: business.contentPillar || 'Educate',
      keyMessage: business.keyMessage || '',
      specificInstructions: business.specificInstructions || '',
    };

    const response = { business: businessDetails };

    // Only generate suggestions if focusService is explicitly set
    if (businessDetails.focusService) {
      const socialMediaSuggestions = await suggestSocialMediaDetails(businessDetails);
      response.socialMediaSuggestions = {
        suggestedKeyMessages: socialMediaSuggestions.suggestedKeyMessages,
        suggestedSpecificInstructions: socialMediaSuggestions.suggestedSpecificInstructions,
      };
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

router.post('/fetch-suggestions', ensureAuthenticated, async (req, res) => {
  const { businessId, focusService, socialMediaType, goal, contentPillar } = req.body;

  if (!businessId || !focusService) {
    return res.status(400).json({ error: 'Business ID and focus service are required' });
  }

  try {
    const business = await Business.findOne({ _id: businessId, owner: req.user._id });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    business.focusService = focusService;
    await business.save();

    const businessDetails = {
      companyName: business.companyName,
      description: business.description,
      services: business.services,
      focusService: focusService,
      targetAudience: business.targetAudience,
      brandTone: business.brandTone,
      socialMediaType: socialMediaType || business.socialMediaType || 'Facebook Post',
      goal: business.goal || 'Generate Leads', // Updated from purpose
      topic: business.topic || '',
      contentPillar: contentPillar || 'Educate', // Added contentPillar
      keyMessage: business.keyMessage || '',
      specificInstructions: business.specificInstructions || '',
    };

    const socialMediaSuggestions = await suggestSocialMediaDetails(businessDetails);

    res.json({
      socialMediaSuggestions: {
        suggestedKeyMessages: socialMediaSuggestions.suggestedKeyMessages,
        suggestedSpecificInstructions: socialMediaSuggestions.suggestedSpecificInstructions,
      },
      error: null,
    });
  } catch (error) {
    console.error('Error fetching suggestions:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});



router.post("/generate-content-social", ensureAuthenticated, ensureBusinessRole("Editor"), async (req, res) => {
  console.log("Received request to /generate-content-social:", req.body);
  const {
    companyName,
    description,
    targetAudience,
    services,
    focusService,
    socialMediaType,
    brandTone,
    goal,
    topic,
    contentPillar,
    keyMessage,
    adDetails,
    specificInstructions,
    selectedPersona,
    hook,
  } = req.body;

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      console.log("User not found for ID:", req.user._id);
      return res.status(404).json({ error: "User not found" });
    }

    const socialMediaLimits = { Basic: 3, Pro: 5, Enterprise: 15 };
    const userSocialMediaLimit = socialMediaLimits[user.subscription] || 0;

    if (process.env.NODE_ENV !== "development" && user.subscription === "None" && user.freeTrialUsed) {
      console.log("Free trial used for user:", user._id);
      return res.status(403).json({
        error: "You have already used your free trial. Please subscribe to continue.",
        redirect: "/subscribe",
      });
    }
    if (
      process.env.NODE_ENV !== "development" &&
      !user.isEditEdgeUser &&
      user.socialMediaGenerationCount >= userSocialMediaLimit
    ) {
      console.log("Limit reached for user:", user._id, "Count:", user.socialMediaGenerationCount);
      return res.status(403).json({
        error: `You have reached your social media content generation limit of ${userSocialMediaLimit} for the ${user.subscription} plan this week.`,
        redirect: "/subscribe",
      });
    }

    const businessId = req.session.businessId;
    if (!businessId) {
      console.log("No business ID in session");
      return res.status(400).json({ error: "No business selected.", redirect: "/social-media/branding-social" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      console.log("Business not found for ID:", businessId);
      return res.status(400).json({ error: "Business not found.", redirect: "/social-media/branding-social" });
    }

    const businessData = {
      companyName: business.companyName,
      description: business.description,
      targetAudience: business.targetAudience,
      services: business.services,
      focusService: business.focusService || focusService || business.services.split(",")[0].trim(),
      socialMediaType: socialMediaType || "Facebook Post",
      brandTone: business.brandTone || brandTone || "professional",
      goal: goal || "Generate Leads",
      topic: topic || "Untitled Topic",
      contentPillar: contentPillar || "Educate",
      keyMessage: keyMessage || "Highlight our services",
      adDetails: adDetails || "No additional details",
      specificInstructions: specificInstructions || "No specific instructions provided.",
      selectedPersona: selectedPersona || null,
      hook: hook || "",
    };

    console.log("Calling generateSocialMediaContent with data:", businessData);
    await generateSocialMediaContent(req, res, businessData, business, user, userSocialMediaLimit);
  } catch (error) {
    console.error("Error in generate-content-social route:", error.message, error.stack);
    res.status(500).json({ error: "Error processing request.", details: error.message });
  }
});

async function generateSocialMediaContent(req, res, data, business, user, userSocialMediaLimit) {
  console.log("Entering generateSocialMediaContent with data:", data);
  const {
    companyName,
    description,
    targetAudience,
    services,
    focusService,
    socialMediaType,
    brandTone,
    goal,
    topic,
    contentPillar,
    keyMessage,
    adDetails,
    specificInstructions,
    selectedPersona,
    hook,
  } = data;

  if (!data || !socialMediaType) {
    console.log("Missing data or socialMediaType");
    return res.status(400).json({ error: "Missing data or social media type." });
  }

  try {
    const platform = socialMediaType.split(" ")[0];
    const captionLimitMap = {
      Facebook: "1-100 characters",
      Instagram: "138-150 characters",
      LinkedIn: "25 words",
      Tiktok: "300 characters",
    };
    const hashtagCountMap = {
      Facebook: "1-2",
      Instagram: "3-5",
      LinkedIn: "1-2",
      Tiktok: "2-3",
    };
    const captionLimit = captionLimitMap[platform] || "71-100 characters";
    const hashtagCount = hashtagCountMap[platform] || "1-2";

    const personaStyles = {
      "Gen Z Marketer": "Trendy, casual, uses slang, emojis, fast hooks",
      "SaaS Founder": "Thought-leader, insightful, confident",
      "Wellness Coach": "Calming, inspiring, affirming",
      "Bold Entrepreneur": "Direct, bold, no-BS, urgency-driven",
      "Storyteller": "Narrative-driven, emotional, hook first",
      "Corporate Strategist": "Formal, data-backed, structured",
      "Relatable Friend": "Friendly, conversational, humorous",
      "Creative Director": "Visual-first, aesthetic-focused, sharp and bold",
      "Motivational Coach": "Uplifting, growth-focused, high-energy",
      "Data Nerd": "Analytical, stat-heavy, logic-driven",
    };

    let adjustedTone = brandTone;
    if (selectedPersona && personaStyles[selectedPersona]) {
      adjustedTone = personaStyles[selectedPersona];
    } else if (contentPillar === "Entertain" && adjustedTone === "professional") {
      adjustedTone = "witty and playful";
    } else if (contentPillar === "Promote") {
      adjustedTone = "bold";
    }

    const selectedHook = hook || keyMessage || "quick tip";
    console.log("Selected hook:", selectedHook);

    console.log("Fetching Perplexity trends...");
    let trendInsights, visualTrends;
    try {
      trendInsights = await fetchFromPerplexity(`Most engaging post formats for ${platform} in 2025`);
      visualTrends = await fetchFromPerplexity(`Top visual styles for ${platform} in 2025`);
    } catch (error) {
      console.error("Perplexity API error:", error.message);
      trendInsights = ["default format"];
      visualTrends = ["standard visual"];
    }
    console.log("Perplexity trends fetched:", { trendInsights, visualTrends });

    // Ensure specificInstructions respects the user-selected hook
    let finalInstructions = specificInstructions;
    if (hook && specificInstructions.toLowerCase().includes("start with a")) {
      // Replace any "Start with a ..." instruction with the user-selected hook
      finalInstructions = specificInstructions.replace(/Start with a \w+(\s\w+)*/i, `Start with a ${selectedHook}`);
    }

    const prompt = `
Create a high-performing ${socialMediaType} post for the company "${companyName}" targeting "${targetAudience}".
- Focus Service: ${focusService}
- Content Pillar: ${contentPillar}
- Platform: ${platform}
- Goal: ${goal}
- Key Message: "${keyMessage}"
- Topic: "${topic}"
- Caption: Within ${captionLimit}, include 2-3 emojis, ensure "${keyMessage}" is clearly communicated
- Hashtags: ${hashtagCount}, must be relevant to platform and topic "${topic}"
- CTA: Engage reader, align with goal "${goal}"
- Hook: ${selectedHook}
- Tone: ${adjustedTone}
- Format: ${trendInsights[0] || "default format"}
- Visual Style: ${visualTrends[0] || "standard visual"}
- Voice: ${selectedPersona ? personaStyles[selectedPersona] : "natural human-like"}
- Specific Instructions: Strictly follow these instructions: ${finalInstructions}
---
**Caption:**
**Hashtags:**
**CTA:**
**Main Content:**
**Assets:**
${socialMediaType.includes("Reel") || socialMediaType.includes("Story") || socialMediaType === "Tiktok Video" ? `
**Video Concept:**
**Video Script:**
- **0-3 sec:** [Hook based on "${selectedHook}"] | [Assets] | [Animation]
- **3-6 sec:** [Problem or context] | [Assets] | [Animation]
- **6-9 sec:** [Solution or insight] | [Assets] | [Animation]
- **9-12 sec:** [Insight tied to "${topic}"] | [Assets] | [Animation]
- **12-15 sec:** [Reinforce "${keyMessage}"] | [Assets] | [Animation]
- **15-18 sec:** [Build to CTA] | [Assets] | [Animation]
- **18-20 sec:** [CTA aligned with "${goal}"] | [Assets] | [Animation]
` : `**Texts on Poster:**`}
---
`;
    console.log("Generated prompt:", prompt);

    console.log("Calling OpenAI API...");
    let aiResponse;
    try {
      aiResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        temperature: 0.7,
      });
    } catch (error) {
      console.error("OpenAI API error:", error.message, error.stack);
      throw new Error("Failed to generate content from OpenAI: " + error.message);
    }
    console.log("OpenAI response received:", aiResponse.choices[0].message.content);

    const output = aiResponse.choices[0].message.content.trim();
    const lines = output.split("\n").filter((line) => line.trim());
    const extractField = (label) => {
      const fieldLine = lines.find((line) => line.startsWith(label));
      if (!fieldLine) return "";
      const content = fieldLine.replace(label, "").trim();
      const startIndex = lines.indexOf(fieldLine);
      let fullContent = content;
      for (let i = startIndex + 1; i < lines.length && !lines[i].startsWith("**"); i++) {
        fullContent += "\n" + lines[i].trim();
      }
      return fullContent;
    };

    const responseData = {
      companyName,
      socialMediaType,
      topic,
      description,
      services,
      targetAudience,
      caption: removeMarkdown(extractField("**Caption:**")),
      hashtags: removeMarkdown(extractField("**Hashtags:**")).split(" ").filter(Boolean),
      cta: removeMarkdown(extractField("**CTA:**")),
      mainContent: removeMarkdown(extractField("**Main Content:**")),
      assets: removeMarkdown(extractField("**Assets:**")),
      posterText: removeMarkdown(extractField("**Texts on Poster:**")),
      videoConcept: removeMarkdown(extractField("**Video Concept:**")),
      script: lines
        .filter((l) => l.startsWith("- **") && l.includes("|"))
        .map((line) => {
          const [timestampPart, ...rest] = line.split("|");
          const timestamp = timestampPart.match(/\*\*(.*?)\*\*/)?.[1]?.trim() || "";
          return {
            timestamp: removeMarkdown(timestamp),
            sceneDescription: removeMarkdown(rest[0]?.trim() || ""),
            assetsToUse: removeMarkdown(rest[1]?.trim() || ""),
            animationStyle: removeMarkdown(rest[2]?.trim() || ""),
          };
        }),
    };

    console.log("Saving content to database...");
    const content = new Content({
      type: "SocialMedia",
      businessId: business._id,
      userId: req.user._id,
      data: responseData,
      status: "Draft",
    });
    await content.save();

    if (process.env.NODE_ENV !== "development" && !user.isEditEdgeUser) {
      user.socialMediaGenerationCount += 1;
      await user.save();
    }

    await Business.findByIdAndUpdate(business._id, { $push: { contentHistory: content._id } });
    await User.findByIdAndUpdate(req.user._id, { $push: { personalContent: content._id } });

    if (process.env.NODE_ENV !== "development" && user.subscription === "None" && !user.freeTrialUsed) {
      await User.findByIdAndUpdate(req.user._id, { freeTrialUsed: true });
    }

    const remainingSocialMedia = userSocialMediaLimit - user.socialMediaGenerationCount;
    const response = {
      ...responseData,
      contentId: content._id.toString(),
      ...(socialMediaType.includes("Reel") || socialMediaType.includes("Story") || socialMediaType === "Tiktok Video"
        ? {}
        : { imageSelectionPending: true }),
      ...(remainingSocialMedia === 1 && process.env.NODE_ENV !== "development" && !user.isEditEdgeUser
        ? { warning: `1 social media generation left this week for ${user.subscription}.` }
        : {}),
    };

    console.log("Sending response:", response);
    res.json(response);
  } catch (error) {
    console.error("Error in generateSocialMediaContent:", error.message, error.stack);
    res.status(500).json({ error: "Error generating content.", details: error.message });
  }
}



router.get("/save-details-prompt", (req, res) => {
  if (!req.session.tempBusinessDetails) {
    return res.json({ redirect: "/social-media/branding-social" });
  }
  res.json({
    business: req.session.tempBusinessDetails,
    error: null
  });
});



// Clear in-memory cache every hour (optional)
setInterval(() => cache.clear(), 60 * 60 * 1000);

router.get("/generated-social", (req, res) => {
  if (!req.session || !req.session.generatedContent) {
    return res.status(400).json({
      error: "No content available. Generate a post first.",
    });
  }

  const content = {
    ...req.session.generatedContent,
    socialMediaType: req.session.generatedContent.socialMediaType || "post"
  };

  return res.json(content);
});

router.get("/generate-new-content", (req, res) => {
  if (req.session.businessDetails) {
    return res.json({
      companyName: req.session.businessDetails.companyName,
      description: req.session.businessDetails.description,
      targetAudience: req.session.businessDetails.targetAudience,
      services: req.session.businessDetails.services,
      focusService: req.session.businessDetails.focusService || "",
      isRegistered: true,
    });
  } else if (req.session.tempBusinessDetails) {
    return res.json({
      companyName: req.session.tempBusinessDetails.companyName,
      description: req.session.tempBusinessDetails.description,
      targetAudience: req.session.tempBusinessDetails.targetAudience,
      services: req.session.tempBusinessDetails.services,
      focusService: req.session.tempBusinessDetails.focusService || "",
      isRegistered: false,
    });
  } else {
    return res.json({ redirect: "/social-media/branding-social" });
  }
});

module.exports = router;