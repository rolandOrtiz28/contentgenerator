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

// In-memory cache for Perplexity results
const cache = new Map();

// Step 1: Display initial form
router.get("/branding-article", async (req, res) => {
  try {
    const businesses = await Business.find({}, 'companyName');
    res.render("branding-article", { businesses, error: null });
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.render("branding-article", { businesses: [], error: "Failed to load businesses." });
  }
});

// Step 2: Handle business selection or new details with website extraction
router.post("/branding-article-details", async (req, res) => {
  const { hasWebsite, companyWebsite, selectedBusiness, companyName, audience, brandTone, keyword, password } = req.body;

  if (!selectedBusiness) {
    req.session.businessDetails = null;
    console.log("🔄 Session cleared for new business entry.");
  }

  console.log("Before storing temp business details:", req.session);

  if (selectedBusiness) {
    try {
      const business = await Business.findById(selectedBusiness);
      if (!business) {
        return res.render("branding-article", {
          businesses: await Business.find({}, 'companyName'),
          error: "Selected business not found.",
        });
      }

      if (password) {
        const isMatch = await business.comparePassword(password);
        if (!isMatch) {
          return res.render("branding-article", {
            businesses: await Business.find({}, 'companyName'),
            error: "Incorrect password for the selected business.",
          });
        }

        req.session.businessDetails = business;
        return res.render("branding-article-details", {
          companyName: business.companyName,
          description: business.description || "No description provided.",
          services: business.services || "General services",
          audience: business.targetAudience || "General audience",
          brandTone: business.brandTone || "professional",
          keyword: keyword || "",
          isRegistered: true,
          error: null,
        });
      } else {
        return res.render("business-password-prompt", { businessId: selectedBusiness, error: null });
      }
    } catch (error) {
      console.error("❌ Error fetching selected business:", error);
      return res.render("branding-article", {
        businesses: await Business.find({}, 'companyName'),
        error: "Error loading business details.",
      });
    }
  }

  req.session.tempBusinessDetails = {
    companyName: companyName || "Unnamed Company",
    description: "No description provided.",
    services: "General services",
    audience: audience || "General audience",
    brandTone: brandTone || "professional",
    keyword: keyword || "SEO optimization",
  };

  if (hasWebsite === "yes" && companyWebsite) {
    return res.redirect(`/article/extract-branding-article?website=${encodeURIComponent(companyWebsite)}`);
  } else if (hasWebsite === "no") {
    return res.render("branding-article-details", {
      companyName: companyName || "",
      description: "",
      services: "",
      audience: audience || "",
      brandTone: brandTone || "",
      keyword: keyword || "",
      isRegistered: false,
      error: null,
    });
  } else {
    return res.render("branding-article", {
      businesses: await Business.find({}, 'companyName'),
      error: "Please select whether you have a website.",
    });
  }
});

// Step 3: Extract branding details from website
router.get("/extract-branding-article", async (req, res) => {
  const websiteURL = req.query.website;

  if (!websiteURL) {
    return res.render("branding-article-details", {
      companyName: req.session.tempBusinessDetails?.companyName || "",
      description: "",
      services: "",
      audience: req.session.tempBusinessDetails?.audience || "",
      brandTone: req.session.tempBusinessDetails?.brandTone || "",
      keyword: req.session.tempBusinessDetails?.keyword || "",
      isRegistered: false,
      error: "Website URL is required.",
    });
  }

  try {
    // Check session cache
    if (req.session.extractedBranding && req.session.extractedBranding.websiteURL === websiteURL) {
      return res.render("branding-article-details", {
        ...req.session.extractedBranding,
        audience: req.session.tempBusinessDetails?.audience || "",
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
      return res.render("branding-article-details", {
        ...req.session.extractedBranding,
        audience: req.session.tempBusinessDetails?.audience || "",
        brandTone: req.session.tempBusinessDetails?.brandTone || "",
        keyword: req.session.tempBusinessDetails?.keyword || "",
        isRegistered: true,
        error: null,
      });
    }

    // Check in-memory cache
    if (cache.has(websiteURL)) {
      req.session.extractedBranding = cache.get(websiteURL);
      return res.render("branding-article-details", {
        ...req.session.extractedBranding,
        audience: req.session.tempBusinessDetails?.audience || "",
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

    res.render("branding-article-details", {
      companyName,
      description,
      services,
      audience: req.session.tempBusinessDetails?.audience || "",
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
    res.render("branding-article-details", {
      ...req.session.extractedBranding,
      audience: req.session.tempBusinessDetails?.audience || "",
      brandTone: req.session.tempBusinessDetails?.brandTone || "",
      keyword: req.session.tempBusinessDetails?.keyword || "",
      isRegistered: false,
      error: "Failed to extract website data. Using fallback values.",
    });
  }
});

// Step 4: Generate the SEO-optimized article
router.post("/generate-content-article", async (req, res) => {
  const { companyName, description, services, audience, brandTone, keyword } = req.body;

  let finalCompanyName = companyName || req.session.businessDetails?.companyName || req.session.tempBusinessDetails?.companyName || "Unknown Company";
  let finalDescription = description || req.session.extractedBranding?.description || req.session.businessDetails?.description || "A company offering digital solutions.";
  let finalServices = services || req.session.extractedBranding?.services || req.session.businessDetails?.services || "General digital services";
  let finalAudience = audience || req.session.tempBusinessDetails?.audience || req.session.businessDetails?.targetAudience || "General audience";
  let finalBrandTone = brandTone || req.session.tempBusinessDetails?.brandTone || req.session.businessDetails?.brandTone || "professional";
  let finalKeyword = keyword || req.session.tempBusinessDetails?.keyword || "SEO optimization";

  // Step 1: Generate an outline
  const outlinePrompt = `
    Create a detailed outline for an SEO-optimized blog article based on:
    - **Company Name:** ${finalCompanyName}
    - **Target Audience:** ${finalAudience}
    - **Brand Tone:** ${finalBrandTone}
    - **Primary SEO Keyword:** ${finalKeyword}
    - **Description:** ${finalDescription}
    - **Services:** ${finalServices}

    Follow Ahrefs SEO guidelines, targeting middle-of-the-funnel readers. Include:
    - A compelling title with the keyword.
    - A meta description (120-150 characters) with the keyword.
    - 5-7 main sections with H2 headings and H3 subheadings.
    - A "Key Takeaways" section with 3-5 bullet points.
    - A promotional section with services and a bundle discount.
    - A conclusion.
    - 3-5 FAQs.
    - A CTA.
    - 2-3 internal linking suggestions.
    - Schema markup (Article, FAQPage).

    Use a conversational, human-like tone. Avoid repetition.

    Format:
    - **Title:**
    - **Meta Description:**
    - **Outline:**
      - **Introduction:** [2-3 sentences]
      - **Section 1: [H2]**
        - [H3] [1 sentence]
      - **Section 2: [H2]**
        - [H3] [1 sentence]
      - **Key Takeaways:** [3-5 bullets]
      - **Promotional Section:** [2-3 sentences]
      - **Conclusion:** [2-3 sentences]
      - **FAQs:** [3-5 questions]
      - **CTA:**
      - **Internal Links:**
      - **Schema Markup:**
  `;

  try {
    const outlineResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: outlinePrompt }],
      max_tokens: 500,
      temperature: 0.6,
    });

    const generatedOutline = outlineResponse.choices[0].message.content.trim();
    console.log("Generated Outline:", generatedOutline);

    // Step 2: Generate full article
    const contentPrompt = `
      Write a full SEO-optimized blog article based on this outline, sounding completely human-written (0% AI detection). Make it engaging, conversational, with storytelling or anecdotes. Avoid repetitive phrases or keyword stuffing.

      **Outline:**
      ${generatedOutline.replace(/[\n\r]+/g, '\n').trim()}

      - Expand each section to 200-300 words with varied sentences.
      - Use ${finalKeyword} 5-7 times naturally.
      - Include semantic keywords (e.g., "search engine ranking", "online visibility").
      - Add a personal anecdote or quote in one section.
      - In the promotional section, highlight ${finalServices} with a bundle discount (e.g., "Web Development + Graphic Design: Save 10%").
      - Target 1,500-2,000 words.

      Format:
      - **Title:**
      - **Meta Description:**
      - **URL:** /${finalKeyword.replace(/\s+/g, '-')}-article
      - **Introduction:**
      - **[H2 Heading 1]:**
        - **[H3 Subheading]:** [Content]
      - **[H2 Heading 2]:**
        - **[H3 Subheading]:** [Content]
      - **Key Takeaways:**
        - [Bullet 1]
        - [Bullet 2]
        - [Bullet 3]
      - **Promotional Section:**
      - **Conclusion:**
      - **FAQs:**
        - **[Question 1]:** [Answer]
        - **[Question 2]:** [Answer]
        - **[Question 3]:** [Answer]
      - **CTA:**
      - **Internal Links:**
      - **Schema Markup:**
    `;

    const contentResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: contentPrompt }],
      max_tokens: 2000,
      temperature: 0.7,
      presence_penalty: 0.2,
      frequency_penalty: 0.2,
    });

    const generatedArticle = contentResponse.choices[0].message.content.trim();
    console.log("Generated Article:", generatedArticle);

    // Humanize post-processing
    let humanizedArticle = generatedArticle
      .replace(/In this article, we will/g, "Let’s dive into")
      .replace(/It is important to note/g, "Here’s something worth mentioning")
      .replace(/Furthermore/g, "Plus");

    req.session.generatedContent = humanizedArticle;

    if (req.session.tempBusinessDetails) {
      return res.redirect("/article/save-details-prompt");
    }

    res.redirect("/article/generated-article");
  } catch (error) {
    console.error("Error generating article:", error);
    res.status(500).send("Error generating content. Please try again.");
  }
});

// Step 5: Save business details prompt
router.get("/save-details-prompt", (req, res) => {
  if (!req.session.tempBusinessDetails) {
    return res.redirect("/article/branding-article");
  }
  res.render("save-details-prompt", {
    business: req.session.tempBusinessDetails,
    error: null,
  });
});

// Step 6: Handle saving
router.post("/save-details", async (req, res) => {
  const { saveChoice, password } = req.body;

  if (saveChoice === "yes" && req.session.tempBusinessDetails && password) {
    try {
      const businessData = {
        ...req.session.tempBusinessDetails,
        password,
      };
      const business = new Business(businessData);
      await business.save();
      req.session.businessDetails = business;
      delete req.session.tempBusinessDetails;
      res.redirect("/article/generated-article");
    } catch (error) {
      console.error("Error saving business:", error);
      res.render("save-details-prompt", {
        business: req.session.tempBusinessDetails,
        error: "Failed to save business details.",
      });
    }
  } else if (saveChoice === "no") {
    delete req.session.tempBusinessDetails;
    res.redirect("/article/generated-article");
  } else {
    res.render("save-details-prompt", {
      business: req.session.tempBusinessDetails,
      error: "Please provide a password to save your details.",
    });
  }
});

// Step 7: Display generated article
router.get("/generated-article", (req, res) => {
  if (!req.session?.generatedContent) {
    return res.status(400).send("No content available. Generate an article first.");
  }
  res.render("generated-article", { content: req.session.generatedContent });
});

// Step 8: Generate new content
router.get("/generate-new-content", (req, res) => {
  if (req.session.businessDetails) {
    return res.render("branding-article-details", {
      companyName: req.session.businessDetails.companyName,
      description: req.session.businessDetails.description || "",
      services: req.session.businessDetails.services || "",
      audience: req.session.businessDetails.targetAudience || "",
      brandTone: req.session.businessDetails.brandTone || "",
      keyword: "",
      isRegistered: true,
      error: null,
    });
  } else if (req.session.tempBusinessDetails) {
    return res.render("branding-article-details", {
      companyName: req.session.tempBusinessDetails.companyName,
      description: req.session.tempBusinessDetails.description || "",
      services: req.session.tempBusinessDetails.services || "",
      audience: req.session.tempBusinessDetails.audience || "",
      brandTone: req.session.tempBusinessDetails.brandTone || "",
      keyword: req.session.tempBusinessDetails.keyword || "",
      isRegistered: false,
      error: null,
    });
  }
  res.redirect("/article/branding-article");
});

// Clear cache every hour
setInterval(() => cache.clear(), 60 * 60 * 1000);

module.exports = router;