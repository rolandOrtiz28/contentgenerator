const express = require('express');
const router = express.Router();
const OpenAI = require("openai");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const Business = require('../models/Business');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.get("/branding-social", async (req, res) => {
  try {
    const businesses = await Business.find({}, 'companyName');
    res.render("branding-social", { businesses, error: null });
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.render("branding-social", { businesses: [], error: "Failed to load businesses." });
  }
});

router.post("/branding-social-details", async (req, res) => {
  const { hasWebsite, companyWebsite, selectedBusiness, companyName, targetAudience, services, description, focusService, password } = req.body;

  // 🛠 Clear session when adding a new business
  if (!selectedBusiness) {
    req.session.businessDetails = null;
    console.log("🔄 Session cleared for new business entry.");
  }

  if (selectedBusiness) {
    try {
      const business = await Business.findById(selectedBusiness);
      if (!business) {
        return res.render("branding-social", { 
          businesses: await Business.find({}, 'companyName'), 
          error: "Selected business not found." 
        });
      }

      if (password) {
        const isMatch = await business.comparePassword(password);
        if (!isMatch) {
          return res.render("branding-social", { 
            businesses: await Business.find({}, 'companyName'), 
            error: "Incorrect password for the selected business." 
          });
        }

        req.session.businessDetails = business;
        console.log("✅ Business details set in session:", business);
        return res.render("branding-social-details", {
          companyName: business.companyName,
          description: business.description,
          targetAudience: business.targetAudience,
          services: business.services,
          focusService: business.focusService,
          isRegistered: true
        });
      } else {
        return res.render("business-password-prompt", { 
          businessId: selectedBusiness,
          error: null
        });
      }
    } catch (error) {
      console.error("❌ Error fetching selected business:", error);
      return res.render("branding-social", { 
        businesses: await Business.find({}, 'companyName'), 
        error: "Error loading business details." 
      });
    }
  }

  if (hasWebsite === "yes" && companyWebsite) {
    console.log("🔄 Redirecting to extract-branding with URL:", companyWebsite);
    return res.redirect(`/social-media/extract-branding?website=${encodeURIComponent(companyWebsite)}`);
  } else if (hasWebsite === "no") {
    res.render("branding-social-details", { 
      companyName: companyName || "", 
      targetAudience: targetAudience || "", 
      services: services || "", 
      description: description || "", 
      focusService: focusService || "", 
      isRegistered: false 
    });
  } else {
    res.render("branding-social", { 
      businesses: await Business.find({}, 'companyName'), 
      error: "Please select whether you have a website." 
    });
  }
});

router.post("/generate-content-social", async (req, res) => {
  const { 
    companyName, 
    description, 
    targetAudience, 
    services,
    focusService, 
    socialMediaType,   
    brandTone,
    customBrandTone, 
    purpose, 
    topic, 
    theme, 
    adDetails 
  } = req.body;

  const finalBrandTone = brandTone === "custom" && customBrandTone ? customBrandTone : brandTone;
  let businessData;

  console.log("Received form data for generate-content-social:", {
    companyName,
    description,
    targetAudience,
    services,
    focusService,
    socialMediaType,
    brandTone,
    customBrandTone,
    purpose,
    topic,
    theme,
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
      brandTone: finalBrandTone,
      purpose,
      topic,
      theme,
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
      brandTone: finalBrandTone || "professional",
      purpose: purpose || "Promote services",
      topic: topic || "",
      theme: theme || "Educational",
      adDetails: adDetails || "No additional details"
    };
  
    // 🛠 Explicitly update session with new business details
    req.session.tempBusinessDetails = businessData;
    req.session.businessDetails = null;  // Ensure old business details are removed
    console.log("Temp business details stored in session:", req.session.tempBusinessDetails);
  }

  console.log("Session state after storing tempBusinessDetails:", req.session);

  if (!topic) {
    console.log("🚀 No topic provided - Generating AI-suggested topics...");
    const topicPrompt = `Suggest 5 topic ideas for a ${socialMediaType} about ${businessData.companyName} and its services (${businessData.services}).`;
    try {
      const topicResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: topicPrompt }],
        max_tokens: 300,
        temperature: 0.7,
      });

      const suggestedTopics = topicResponse.choices[0].message.content.trim().split("\n");
      return res.render("select-topic", { 
        ...businessData,
        suggestedTopics,
        isRegistered: !!req.session.businessDetails
      });
    } catch (error) {
      console.error("❌ Error generating AI topics:", error);
      return res.status(500).send("Error generating suggested topics.");
    }
  }

  await generateSocialMediaContent(req, res, businessData);
});

async function generateSocialMediaContent(req, res, data) {
  const { companyName, description, targetAudience, services, focusService, socialMediaType, brandTone, purpose, topic, theme, adDetails } = data;

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
- Details: ${adDetails || "No additional details"}

**FORMAT EXACTLY LIKE THIS:**

`;

  if (socialMediaType === "reel" || socialMediaType === "story") {
    prompt += `
---
**Video Concept:** [2-3 sentences describing the video idea based on topic/purpose]  
**Caption:** [Ensure this follows the theme, e.g., tips list, educational insights, engaging questions, etc.]  
**Hashtags:** [4-5 relevant hashtags]  
**CTA Options:** [1] [CTA 1] | [2] [CTA 2]  
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
**CTA Options:** [1] [CTA 1] | [2] [CTA 2]  
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
      hashtags: generatedContent.match(/\*\*Hashtags:\*\* (.+)/)?.[1] || "#default",
      cta: generatedContent.match(/\*\*CTA(?: Options)?:\*\* (.+)/)?.[1] || "[1] DM us | [2] Visit us",
      mainContent: generatedContent.match(/\*\*Main Content:\*\*([\s\S]+?)\n\*\*/)?.[1]?.trim() || "No content provided.",
      assets: generatedContent.match(/\*\*Assets:\*\* (.+)/)?.[1] || "Generic assets",
      ...(socialMediaType === "reel" || socialMediaType === "story" ? {
        videoConcept: generatedContent.match(/\*\*Video Concept:\*\* (.+)/)?.[1] || "Showcase our services.",
        script: scriptScenes.join("\n"),
        textOnScreen: textScenes.join("\n"),
      } : {}),
      ...(socialMediaType === "post" ? {
        posterText: generatedContent.match(/\*\*Texts? on Poster:\*\* (.+)/)?.[1] || "Default poster text",
      } : {}) // ✅ Only set posterText for posts
    };

    console.log("✅ Extracted Content:", extractedContent);

    req.session.generatedContent = extractedContent;
    console.log("✅ Session Content Stored:", req.session.generatedContent);

    console.log("Session state in generateSocialMediaContent:", {
      businessDetails: req.session.businessDetails,
      tempBusinessDetails: req.session.tempBusinessDetails
    });

    // Ensure we check for tempBusinessDetails even if businessDetails exists
    if (req.session.tempBusinessDetails) {
      console.log("Redirecting to save-details-prompt for unregistered business");
      return res.redirect("/social-media/save-details-prompt");
    }

    res.redirect("/social-media/generated-social");
  } catch (error) {
    console.error("❌ Error generating AI content:", error);
    res.status(500).send("Error generating content. Please try again or contact support.");
  }
}

router.get("/save-details-prompt", (req, res) => {
  if (!req.session.tempBusinessDetails) {
    return res.redirect("/social-media/branding-social");
  }
  res.render("save-details-prompt", { 
    business: req.session.tempBusinessDetails,
    error: null 
  });
});

router.post("/save-details", async (req, res) => {
  const { saveChoice, password } = req.body;

  if (saveChoice === "yes" && req.session.tempBusinessDetails && password) {
    try {
      const businessData = {
        ...req.session.tempBusinessDetails,
        password // Store the plain password; it will be hashed in the pre-save hook
      };
      
      const business = new Business(businessData);
      await business.save();
      req.session.businessDetails = business; // Save to session as registered
      delete req.session.tempBusinessDetails;
      res.redirect("/social-media/generated-social");
    } catch (error) {
      console.error("Error saving business:", error);
      res.render("save-details-prompt", { 
        business: req.session.tempBusinessDetails, 
        error: "Failed to save business details." 
      });
    }
  } else if (saveChoice === "no") {
    delete req.session.tempBusinessDetails; // Clear temp data if not saving
    res.redirect("/social-media/generated-social");
  } else {
    res.render("save-details-prompt", { 
      business: req.session.tempBusinessDetails, 
      error: "Please provide a password to save your details." 
    });
  }
});

router.get("/extract-branding", async (req, res) => {
  const websiteURL = req.query.website;

  if (!websiteURL) {
    return res.status(400).send("Website URL is required.");
  }

  try {
    console.log("Fetching website data from:", websiteURL);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    await page.goto(websiteURL, { waitUntil: "domcontentloaded", timeout: 45000 });
    const html = await page.content();
    await browser.close();

    const $ = cheerio.load(html);
    const companyName = $("title").first().text().trim() || "Unknown Company";
    let description = $('meta[name="description"]').attr("content") || "";

    if (!description || description.toLowerCase().includes("default blog description")) {
      $("p, h2, h3").each((index, element) => {
        const text = $(element).text().trim();
        if (!/terms of service|privacy policy|cookies|disclaimer|about us|faq/i.test(text) && text.length > 20) {
          description = text;
          return false;
        }
      });
    }

    description = description || "No description available.";
    let services = extractServices($) || "No services found.";

    res.render("branding-social-details", { 
      companyName, 
      description, 
      services,
      targetAudience: "Describe Your Target Audience", // Default placeholder
      focusService: "Describe what service you want to focus on",
      isRegistered: false
    });
  } catch (error) {
    console.error("Error extracting website data:", error);
    res.render("branding-social-details", { 
      companyName: "Error", 
      description: "No description available.", 
      services: "No services found.",
      targetAudience: "No target audience found.",
      focusService: "No focus service found",
      isRegistered: false
    });
  }
});

function extractServices($) {
  let servicesList = [];
  $("ul, ol").each((index, element) => {
    $(element).find("li").each((i, li) => {
      const text = $(li).text().trim();
      if (/service|solution|specialize|offer|expertise|industries|products|what we do/i.test(text) && text.length < 100) {
        servicesList.push(text);
      }
    });
  });

  if (servicesList.length === 0) {
    $("p, div").each((index, element) => {
      const text = $(element).text().trim();
      if (/we offer|our services include|we provide|specializing in|we specialize/i.test(text) && text.length < 150) {
        servicesList.push(text);
      }
    });
  }

  servicesList = [...new Set(servicesList)]
    .filter(text => !/terms of service|privacy policy|about us|faq/i.test(text))
    .slice(0, 5);

  return servicesList.length > 0 ? servicesList.join(", ") : "No services found.";
}

router.get("/generated-social", (req, res) => {
  if (!req.session || !req.session.generatedContent) {
    return res.status(400).send("❌ Error: No content available. Generate a post first.");
  }

  console.log("🎯 Rendering Page with:", req.session.generatedContent);

  const content = {
    ...req.session.generatedContent,
    socialMediaType: req.session.generatedContent.socialMediaType || "post"
  };

  res.render("generated-social", content);
});

router.get("/generate-new-content", (req, res) => {
  if (req.session.businessDetails) {
    return res.render("branding-social-details", {
      companyName: req.session.businessDetails.companyName,
      description: req.session.businessDetails.description,
      targetAudience: req.session.businessDetails.targetAudience,
      services: req.session.businessDetails.services,
      focusService: req.session.businessDetails.focusService || "",
      isRegistered: true
    });
  } else if (req.session.tempBusinessDetails) {
    return res.render("branding-social-details", {
      companyName: req.session.tempBusinessDetails.companyName,
      description: req.session.tempBusinessDetails.description,
      targetAudience: req.session.tempBusinessDetails.targetAudience,
      services: req.session.tempBusinessDetails.services,
      focusService: req.session.tempBusinessDetails.focusService || "",
      isRegistered: false
    });
  } else {
    return res.redirect("/social-media/branding-social");
  }
});

module.exports = router;