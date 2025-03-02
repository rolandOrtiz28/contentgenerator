const express = require('express');
const router = express.Router();
const OpenAI = require("openai");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const Business = require('../models/Business'); // Add this

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.get("/branding-social", async (req, res) => {
    try {
      const businesses = await Business.find({}, 'companyName'); // Fetch registered businesses
      res.render("branding-social", { businesses, error: null });
    } catch (error) {
      console.error("Error fetching businesses:", error);
      res.render("branding-social", { businesses: [], error: "Failed to load businesses." });
    }
  });
  
  router.post("/branding-social-details", async (req, res) => {
    const { hasWebsite, companyWebsite, selectedBusiness, companyName, targetAudience, services, description, focusService } = req.body;
  
    // Handle registered business selection first
    if (selectedBusiness) {
      try {
        const business = await Business.findById(selectedBusiness);
        if (business) {
          req.session.businessDetails = business; // Store in session
          return res.render("branding-social-details", {
            companyName: business.companyName,
            description: business.description,
            targetAudience: business.targetAudience,
            services: business.services,
            focusService: business.focusService,
            isRegistered: true
          });
        } else {
          return res.render("branding-social", { 
            businesses: await Business.find({}, 'companyName'), 
            error: "Selected business not found." 
          });
        }
      } catch (error) {
        console.error("Error fetching selected business:", error);
        return res.render("branding-social", { 
          businesses: await Business.find({}, 'companyName'), 
          error: "Error loading business details." 
        });
      }
    }
  
    // Handle website or manual entry
    if (hasWebsite === "yes" && companyWebsite) {
      console.log("Redirecting to extract-branding with URL:", companyWebsite); // Debug log
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

  if (req.session.businessDetails) {
    // Use stored business details if registered
    businessData = {
      companyName: req.session.businessDetails.companyName,
      description: req.session.businessDetails.description,
      targetAudience: req.session.businessDetails.targetAudience,
      services: req.session.businessDetails.services,
      focusService: focusService || req.session.businessDetails.focusService, // Allow override
      socialMediaType,
      brandTone: finalBrandTone,
      purpose,
      topic,
      theme,
      adDetails
    };
  } else {
    // Use submitted details for unregistered businesses
    businessData = {
      companyName,
      description,
      targetAudience,
      services,
      focusService,
      socialMediaType,
      brandTone: finalBrandTone,
      purpose,
      topic,
      theme,
      adDetails
    };
    req.session.tempBusinessDetails = { companyName, description, targetAudience, services, focusService }; // Store temporarily
  }

  if (!topic) {
    console.log("🚀 No topic provided - Generating AI-suggested topics...");
    const topicPrompt = `Suggest 5 topic ideas for a ${socialMediaType} about ${businessData.companyName} and its services (${businessData.services}).`;
    try {
      const topicResponse = await openai.chat.completions.create({
        model: "gpt-4",
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
  // ... (your existing generateSocialMediaContent function remains mostly unchanged)

  // After generating content, check if unregistered and prompt to save
  const extractedContent = {
    // ... (your existing extractedContent object)
  };

  req.session.generatedContent = extractedContent;

  if (!req.session.businessDetails && req.session.tempBusinessDetails) {
    // If unregistered, redirect to save prompt
    return res.redirect("/social-media/save-details-prompt");
  }

  res.redirect("/social-media/generated-social");
}

// New route for save prompt
router.get("/save-details-prompt", (req, res) => {
  if (!req.session.tempBusinessDetails) {
    return res.redirect("/social-media/branding-social");
  }
  res.render("save-details-prompt", { business: req.session.tempBusinessDetails });
});

router.post("/save-details", async (req, res) => {
  const { saveChoice } = req.body;

  if (saveChoice === "yes" && req.session.tempBusinessDetails) {
    try {
      const business = new Business(req.session.tempBusinessDetails);
      await business.save();
      req.session.businessDetails = business; // Save to session as registered
      delete req.session.tempBusinessDetails;
    } catch (error) {
      console.error("Error saving business:", error);
    }
  } else {
    delete req.session.tempBusinessDetails; // Clear temp data if not saving
  }
  res.redirect("/social-media/generated-social");
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
  
    // ✅ Pass session data to the template
    res.render("generated-social", { ...req.session.generatedContent });
  });
  

module.exports = router;