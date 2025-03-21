const express = require('express');
const router = express.Router();
const OpenAI = require("openai");
const axios = require('axios');
const Business = require('../models/Business');

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

// Simple in-memory cache for Perplexity results
const cache = new Map();

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

// New route for content details form
router.get("/content-details", (req, res) => {
  if (!req.session.tempBusinessDetails && !req.session.businessDetails) {
    return res.status(400).json({ redirect: "/social-media/branding-social" });
  }

  const businessDetails = req.session.businessDetails || req.session.tempBusinessDetails;
  res.json({
    business: {
      companyName: businessDetails.companyName,
      description: businessDetails.description,
      services: businessDetails.services,
      focusService: businessDetails.focusService,
      targetAudience: businessDetails.targetAudience,
      brandTone: businessDetails.brandTone,
      socialMediaType: businessDetails.socialMediaType,
    },
    error: null,
  });
});

// Handle business selection or new details
router.post("/generate-content-social", async (req, res) => {
  const { 
    companyName, 
    description, 
    targetAudience, 
    services,
    focusService, 
    socialMediaType,   
    brandTone,
    purpose, 
    topic, 
    theme, 
    hashtags,
    cta,
    adDetails 
  } = req.body;

  let businessData;

  console.log("Received form data for generate-content-social:", {
    companyName,
    description,
    targetAudience,
    services,
    focusService,
    socialMediaType,
    brandTone,
    purpose,
    topic,
    theme,
    hashtags,
    cta,
    adDetails
  });

  console.log("Current session state before processing:", req.session);

  if (!companyName && req.session.businessDetails) {
    businessData = {
      companyName: req.session.businessDetails.companyName,
      description: req.session.businessDetails.description,
      targetAudience: req.session.businessDetails.targetAudience,
      services: req.session.businessDetails.services,
      focusService: focusService || req.session.businessDetails.focusService,
      socialMediaType,
      brandTone,
      purpose,
      topic,
      theme,
      hashtags,
      cta,
      adDetails
    };
    console.log("Using registered business details:", req.session.businessDetails);
  } else {
    businessData = {
      companyName: companyName || "Unnamed Company",
      description: description || "No description provided.",
      targetAudience: targetAudience || "General audience",
      services: services || "General services",
      focusService: focusService || "All services",
      socialMediaType: socialMediaType || "post",
      brandTone: brandTone || "professional",
      purpose: purpose || "Promote services",
      topic: topic || "No description provided.",
      theme: theme || "Educational",
      hashtags: hashtags || [],
      cta: cta || "Follow us for more!",
      adDetails: adDetails || "No additional details"
    };
  
    req.session.tempBusinessDetails = businessData;
    req.session.businessDetails = null;
    console.log("Temp business details stored in session:", req.session.tempBusinessDetails);
  }

  console.log("Session state after storing tempBusinessDetails:", req.session);

  await generateSocialMediaContent(req, res, businessData);
});

async function generateSocialMediaContent(req, res, data) {
  const { companyName, description, targetAudience, services, focusService, socialMediaType, brandTone, purpose, topic, theme, hashtags, cta, adDetails } = data;

  if (!data || Object.keys(data).length === 0) {
    console.error("❌ Error: `data` is missing or empty!");
    return res.status(400).send("❌ Error: No data provided for content generation.");
  }
  if (!socialMediaType) {
    console.error("❌ Error: `socialMediaType` is missing!");
    return res.status(400).send("❌ Error: Please select a social media type.");
  }

  console.log("✅ Generating content for:", socialMediaType);
  console.log("Business data used:", data);

  let themeDescription = "";

  switch (theme) {
    case "Educational":
      themeDescription = "Provide an informative and insightful post about the topic. The content should explain concepts clearly and educate the audience with useful knowledge.";
      break;
    case "Tips":
      themeDescription = "Provide at least **3 to 5 expert tips** related to the topic. Each tip should be short, clear, and actionable for the audience.";
      break;
    case "Advertising":
      themeDescription = "Focus on promoting a product or service. Highlight its benefits and why the audience should consider it.";
      break;
    case "Motivational":
      themeDescription = "Create an inspiring post related to the business, encouraging the audience with uplifting messages.";
      break;
    case "Engagement":
      themeDescription = "Include a question, quiz, or poll to encourage interaction. Make sure the content invites the audience to respond.";
      break;
    case "Entertainment":
      themeDescription = "Generate a fun and engaging post, such as a meme, joke, or interesting fun fact related to the topic.";
      break;
    case "News & Updates":
      themeDescription = "Share the latest announcements, updates, or industry news related to the business.";
      break;
    case "About":
      themeDescription = "Provide an informative post about the company, its mission, values, and what makes it unique.";
      break;
    default:
      themeDescription = "Generate a post related to the topic with a general informative or promotional approach.";
      break;
  }

  let prompt = `
Generate a Social Media ${socialMediaType === "reel" || socialMediaType === "story" ? "Video (Reel/Story)" : "Post"} for ${companyName}.
- Content must strictly follow this theme: **${theme}**.
- **Theme Guidelines:** ${themeDescription}
- Provide ALL fields in the exact format below.
- For reels/stories: Include **3 to 5 scenes** in "Video Script & Structure" and **3 to 5 unique texts** in "Text on Screen".
- "Video Script & Structure": Describe the video actions (e.g., "Show a raw video clip").
- "Text on Screen": Short, catchy text for each scene, DIFFERENT from the script (e.g., "Boost Your Video! 🌟").
- NO duplication between script and text on screen.
- Tone: "${brandTone || 'professional'}".
- Use this data:
- Topic: ${topic || "Untitled Topic"}
- Description: ${description || "A creative agency offering top-tier services."}
- Services: ${services || "General services"}
- Focus Product/Service: ${focusService ? focusService : "All services"}
- Target Audience: ${targetAudience || "General audience"}
- Purpose: ${purpose || "Promote services"}
- Theme: ${theme || "Generic theme"}
- Hashtags: ${hashtags.join(', ')}
- CTA: ${cta}
- Details: ${adDetails || "No additional details"}

**FORMAT EXACTLY LIKE THIS:**

`;

  if (socialMediaType === "reel" || socialMediaType === "story") {
    prompt += `
---
**Video Concept:** [2-3 sentences describing the video idea based on topic/purpose]  
**Caption:** [Ensure this follows the theme, e.g., tips list, educational insights, engaging questions, etc.]  
**Hashtags:** [4-5 relevant hashtags]  
**CTA:** ${cta}  
**Video Script & Structure:**  
- **Scene 1:** [Action for scene 1]  
- **Scene 2:** [Action for scene 2]  
- **Scene 3:** [Action for scene 3]  
- **Scene 4:** [Action for scene 4] *(Optional: Max 5 scenes)*  
- **Scene 5:** [Action for scene 5] *(Optional: Max 5 scenes)*  
**Text on Screen:**  
- **Scene 1:** [Unique text for scene 1]  
- **Scene 2:** [Unique text for scene 2]  
- **Scene 3:** [Unique text for scene 3]  
- **Scene 4:** [Unique text for scene 4] *(Optional: Max 5 scenes)*  
- **Scene 5:** [Unique text for scene 5] *(Optional: Max 5 scenes)*  
**Assets:** [Assets like footage, logos, etc.]  
---
`;
  } else if (socialMediaType === "post") {
    prompt += `
---
**Caption:** [Catchy caption tied to theme]  
**Hashtags:** [4-5 relevant hashtags]
**Main Content:** [Ensure this follows the theme, e.g., tips list, educational insights, engaging questions, etc.]  
**CTA:** ${cta}  
**Texts on Poster:** [Short text for poster]  
**Assets:** [Assets like images, icons, etc.]  
---
`;
  }

  try {
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.5,
      presence_penalty: 0.2,
      frequency_penalty: 0.2
    });

    const generatedContent = aiResponse.choices[0].message.content.trim();
    console.log("✅ AI Raw Response:\n", generatedContent);

    const scriptPattern = /\*\*Video Script & Structure:\*\*([\s\S]*?)\n\*\*/;
    const textOnScreenPattern = /\*\*Text on Screen:\*\*([\s\S]*?)\n\*\*/;

    const scriptMatch = generatedContent.match(scriptPattern);
    const textOnScreenMatch = generatedContent.match(textOnScreenPattern);

    let scriptScenes = scriptMatch ? scriptMatch[1].trim().split("\n").map(scene => scene.replace(/^-\s\*\*Scene\s\d:\*\*\s/, "").trim()) : [];
    let textScenes = textOnScreenMatch ? textOnScreenMatch[1].trim().split("\n").map(text => text.replace(/^-\s\*\*Scene\s\d:\*\*\s/, "").trim()) : [];

    while (scriptScenes.length < 3) scriptScenes.push(`Scene ${scriptScenes.length + 1} content missing`);
    while (textScenes.length < 3) textScenes.push(`Scene ${textScenes.length + 1} text missing`);
    if (scriptScenes.length > 5) scriptScenes = scriptScenes.slice(0, 5);
    if (textScenes.length > 5) textScenes = textScenes.slice(0, 5);

    const extractedContent = {
      companyName,
      socialMediaType,
      topic: topic || "Untitled Topic",
      description: description || "A creative agency offering top-tier services.",
      services: services || "General services",
      targetAudience: targetAudience || "General Audience",
      caption: generatedContent.match(/\*\*Caption:\*\* (.+)/)?.[1] || "Contact us for amazing content!",
      hashtags: generatedContent.match(/\*\*Hashtags:\*\* (.+)/)?.[1] || hashtags.join(', '),
      cta: generatedContent.match(/\*\*CTA(?: Options)?:\*\* (.+)/)?.[1] || cta,
      mainContent: generatedContent.match(/\*\*Main Content:\*\*([\s\S]+?)\n\*\*/)?.[1]?.trim() || "No content provided.",
      assets: generatedContent.match(/\*\*Assets:\*\* (.+)/)?.[1] || "Generic assets",
      ...(socialMediaType === "reel" || socialMediaType === "story" ? {
        videoConcept: generatedContent.match(/\*\*Video Concept:\*\* (.+)/)?.[1] || "Showcase our services.",
        script: scriptScenes.join("\n"),
        textOnScreen: textScenes.join("\n"),
      } : {}),
      ...(socialMediaType === "post" ? {
        posterText: generatedContent.match(/\*\*Texts? on Poster:\*\* (.+)/)?.[1] || "Default poster text",
      } : {})
    };

    console.log("✅ Extracted Content:", extractedContent);

    req.session.generatedContent = extractedContent;
    console.log("✅ Session Content Stored:", req.session.generatedContent);

    console.log("Session state in generateSocialMediaContent:", {
      businessDetails: req.session.businessDetails,
      tempBusinessDetails: req.session.tempBusinessDetails
    });

    res.json(extractedContent);
  } catch (error) {
    console.error("❌ Error generating AI content:", error);
    res.status(500).send("Error generating content. Please try again or contact support.");
  }
};

router.get("/save-details-prompt", (req, res) => {
  if (!req.session.tempBusinessDetails) {
    return res.json({ redirect: "/social-media/branding-social" });
  }
  res.json({
    business: req.session.tempBusinessDetails,
    error: null
  });
});



// Updated /extract-branding route using Perplexity with cost-saving measures
router.get("/extract-branding", async (req, res) => {
  const websiteURL = req.query.website;

  if (!websiteURL) {
    return res.status(400).json({
      error: "Website URL is required.",
    });
  }

  try {
    console.log("Processing website:", websiteURL);

    // Check session cache
    if (req.session.extractedBranding && req.session.extractedBranding.websiteURL === websiteURL) {
      return res.json({
        ...req.session.extractedBranding,
        isRegistered: false,
      });
    }

    // Check database cache
    const existingBusiness = await Business.findOne({ companyWebsite: websiteURL });
    if (existingBusiness) {
      req.session.extractedBranding = {
        companyName: existingBusiness.companyName,
        description: existingBusiness.description,
        services: existingBusiness.services,
        targetAudience: existingBusiness.targetAudience || "Describe Your Target Audience",
        focusService: existingBusiness.focusService || "Describe what service you want to focus on",
        websiteURL,
      };
      return res.json({
        ...req.session.extractedBranding,
        isRegistered: true,
      });
    }

    // Check in-memory cache
    if (cache.has(websiteURL)) {
      return res.json({
        ...cache.get(websiteURL),
        isRegistered: false,
      });
    }

    // Query Perplexity API
    console.log("Fetching data from Perplexity for:", websiteURL);

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

    return res.json({
      companyName,
      description,
      services,
      targetAudience: "Describe Your Target Audience",
      focusService: "Describe what service you want to focus on",
      websiteURL,
      isRegistered: false,
    });
  } catch (error) {
    console.error("Error with Perplexity API:", error.response?.data || error.message);
    const urlFallback = new URL(websiteURL);
    const fallbackData = {
      companyName: urlFallback.hostname.replace('www.', '').split('.')[0] || "Unknown Company",
      description: "No description available due to extraction error.",
      services: "No services found.",
      targetAudience: "Describe Your Target Audience",
      focusService: "Describe what service you want to focus on",
      websiteURL,
    };

    req.session.extractedBranding = fallbackData;
    return res.status(500).json({
      ...fallbackData,
      error: "Failed to extract website data. Using fallback values.",
    });
  }
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