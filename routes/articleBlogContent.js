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
router.get("/content-details", (req, res) => {
  if (!req.session.tempBusinessDetails && !req.session.businessDetails) {
    return res.status(400).json({ redirect: "/blog-article/branding-article" });
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
      keyword: businessDetails.keyword,
    },
    error: null,
  });
});

// Step 5: Generate the SEO-optimized article
router.post("/generate-content-article", async (req, res) => {
  const { companyName, description, services, targetAudience, brandTone, keyword, secondaryKeywords, articleLength, keyPoints, cta } = req.body;

  let finalCompanyName = companyName || req.session.businessDetails?.companyName || req.session.tempBusinessDetails?.companyName || "Unknown Company";
  let finalDescription = description || req.session.extractedBranding?.description || req.session.businessDetails?.description || "A company offering digital solutions.";
  let finalServices = services || req.session.extractedBranding?.services || req.session.businessDetails?.services || "General digital services";
  let finalTargetAudience = targetAudience || req.session.tempBusinessDetails?.targetAudience || req.session.businessDetails?.targetAudience || "General audience";
  let finalBrandTone = brandTone || req.session.tempBusinessDetails?.brandTone || req.session.businessDetails?.brandTone || "professional";
  let finalKeyword = keyword || req.session.tempBusinessDetails?.keyword || "SEO optimization";
  let finalSecondaryKeywords = secondaryKeywords || [];
  let finalArticleLength = articleLength || "1500-2000 words";
  let finalKeyPoints = keyPoints || [];
  let finalCta = cta || "Contact us for more information!";

  // Step 1: Generate an outline
  const outlinePrompt = `
    Create a detailed outline for an SEO-optimized blog article based on:
    - **Company Name:** ${finalCompanyName}
    - **Target Audience:** ${finalTargetAudience}
    - **Brand Tone:** ${finalBrandTone}
    - **Primary SEO Keyword:** ${finalKeyword}
    - **Secondary Keywords:** ${finalSecondaryKeywords.join(', ')}
    - **Description:** ${finalDescription}
    - **Services:** ${finalServices}
    - **Key Points to Cover:** ${finalKeyPoints.join(', ')}

    Follow Ahrefs SEO guidelines, targeting middle-of-the-funnel readers. Include:
    - A compelling title with the keyword.
    - A meta description (120-150 characters) with the keyword.
    - 5-7 main sections with H2 headings and H3 subheadings.
    - A "Key Takeaways" section with 3-5 bullet points.
    - A promotional section with services and a bundle discount.
    - A conclusion.
    - 3-5 FAQs.
    - A CTA: "${finalCta}"
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
      - Include semantic keywords: ${finalSecondaryKeywords.join(', ')}.
      - Add a personal anecdote or quote in one section.
      - In the promotional section, highlight ${finalServices} with a bundle discount (e.g., "Web Development + Graphic Design: Save 10%").
      - Target ${finalArticleLength}.

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

    // Step 3: Parse the article into a structured object
    const lines = humanizedArticle.split('\n').filter(line => line.trim());
    let parsedContent = {
      title: '',
      metaDescription: '',
      url: '',
      introduction: '',
      sections: [],
      keyTakeaways: [],
      promotionalSection: '',
      conclusion: '',
      faqs: [],
      cta: '',
      internalLinks: [],
      schemaMarkup: '',
    };

    let currentSection = null;
    let currentFaq = null;
    let inIntroduction = false;
    let inKeyTakeaways = false;
    let inPromotionalSection = false;
    let inConclusion = false;
    let inFaqs = false;
    let inInternalLinks = false;
    let inSchemaMarkup = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Parse Title
      if (line.startsWith('**Title:**')) {
        parsedContent.title = line.replace('**Title:**', '').trim();
      }
      // Parse Meta Description
      else if (line.startsWith('**Meta Description:**')) {
        parsedContent.metaDescription = line.replace('**Meta Description:**', '').trim();
      }
      // Parse URL
      else if (line.startsWith('**URL:**')) {
        parsedContent.url = line.replace('**URL:**', '').trim();
      }
      // Parse Introduction
      else if (line.startsWith('**Introduction:**')) {
        inIntroduction = true;
        parsedContent.introduction = '';
      }
      else if (inIntroduction && !line.startsWith('**[')) {
        parsedContent.introduction += line + '\n';
      }
      // Parse Sections
      else if (line.startsWith('**[') && finalKeyPoints.some(point => line.includes(point))) {
        inIntroduction = false;
        if (currentSection) parsedContent.sections.push(currentSection);
        currentSection = {
          heading: line.replace('**', '').replace(':', '').replace('[', '').replace(']', ''),
          content: '',
        };
      }
      else if (currentSection && !line.startsWith('**Key Takeaways:**') && !line.startsWith('**Promotional Section:**') && !line.startsWith('**Conclusion:**') && !line.startsWith('**FAQs:**')) {
        currentSection.content += line + '\n';
      }
      // Parse Key Takeaways
      else if (line.startsWith('**Key Takeaways:**')) {
        if (currentSection) parsedContent.sections.push(currentSection);
        currentSection = null;
        inKeyTakeaways = true;
      }
      else if (inKeyTakeaways && line.startsWith('- ')) {
        parsedContent.keyTakeaways.push(line.replace('- ', '').trim());
      }
      // Parse Promotional Section
      else if (line.startsWith('**Promotional Section:**')) {
        inKeyTakeaways = false;
        inPromotionalSection = true;
        parsedContent.promotionalSection = '';
      }
      else if (inPromotionalSection && !line.startsWith('**Conclusion:**')) {
        parsedContent.promotionalSection += line + '\n';
      }
      // Parse Conclusion
      else if (line.startsWith('**Conclusion:**')) {
        inPromotionalSection = false;
        inConclusion = true;
        parsedContent.conclusion = '';
      }
      else if (inConclusion && !line.startsWith('**FAQs:**')) {
        parsedContent.conclusion += line + '\n';
      }
      // Parse FAQs
      else if (line.startsWith('**FAQs:**')) {
        inConclusion = false;
        inFaqs = true;
      }
      else if (inFaqs && line.startsWith('**[') && line.includes(']:')) {
        if (currentFaq) parsedContent.faqs.push(currentFaq);
        currentFaq = {
          question: line.replace('**', '').replace(':', '').replace('[', '').replace(']', ''),
          answer: '',
        };
      }
      else if (currentFaq && !line.startsWith('**CTA:**')) {
        currentFaq.answer += line + '\n';
      }
      // Parse CTA
      else if (line.startsWith('**CTA:**')) {
        inFaqs = false;
        if (currentFaq) parsedContent.faqs.push(currentFaq);
        currentFaq = null;
        parsedContent.cta = line.replace('**CTA:**', '').trim();
      }
      // Parse Internal Links
      else if (line.startsWith('**Internal Links:**')) {
        inInternalLinks = true;
      }
      else if (inInternalLinks && line.startsWith('- ')) {
        parsedContent.internalLinks.push(line.replace('- ', '').trim());
      }
      // Parse Schema Markup
      else if (line.startsWith('**Schema Markup:**')) {
        inInternalLinks = false;
        inSchemaMarkup = true;
        parsedContent.schemaMarkup = '';
      }
      else if (inSchemaMarkup) {
        parsedContent.schemaMarkup += line + '\n';
      }
    }

    // Push the last section and FAQ if they exist
    if (currentSection) parsedContent.sections.push(currentSection);
    if (currentFaq) parsedContent.faqs.push(currentFaq);

    // Trim all string fields
    parsedContent.introduction = parsedContent.introduction.trim();
    parsedContent.promotionalSection = parsedContent.promotionalSection.trim();
    parsedContent.conclusion = parsedContent.conclusion.trim();
    parsedContent.schemaMarkup = parsedContent.schemaMarkup.trim();
    parsedContent.sections = parsedContent.sections.map(section => ({
      ...section,
      content: section.content.trim(),
    }));
    parsedContent.faqs = parsedContent.faqs.map(faq => ({
      ...faq,
      answer: faq.answer.trim(),
    }));

    // Store the parsed content in the session
    req.session.generatedContent = parsedContent;
    console.log('Parsed content stored in session:', req.session.generatedContent);

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

// Step 7: Handle saving
router.post("/save-details", async (req, res) => {
  const { saveChoice, password } = req.body;

  if (saveChoice === "yes" && req.session.tempBusinessDetails && password) {
    try {
      const businessData = {
        companyName: req.session.tempBusinessDetails.companyName,
        description: req.session.tempBusinessDetails.description,
        targetAudience: req.session.tempBusinessDetails.targetAudience,
        services: req.session.tempBusinessDetails.services,
        focusService: req.session.tempBusinessDetails.focusService,
        password,
      };
      const business = new Business(businessData);
      await business.save();
      req.session.businessDetails = business;
      delete req.session.tempBusinessDetails;
      res.json({ redirect: "/blog-article/content-details" }); // Redirect to content details form
    } catch (error) {
      console.error("Error saving business:", error);
      res.status(500).json({
        business: req.session.tempBusinessDetails,
        error: "Failed to save business details.",
      });
    }
  } else if (saveChoice === "no") {
    res.json({ redirect: "/blog-article/content-details" }); // Redirect to content details form
  } else {
    res.status(400).json({
      business: req.session.tempBusinessDetails,
      error: "Please provide a password to save your details.",
    });
  }
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