const express = require('express');
const router = express.Router();
const OpenAI = require("openai");
const axios = require('axios');
const Business = require('../models/Business');
const { suggestKeywordsWithOpenAI } = require('../utils/keywordSuggester');

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
    });
  }

  const businessDetails = req.session.businessDetails || req.session.tempBusinessDetails;
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
    error: null,
  });
});


// Step 5: Generate the SEO-optimized article
router.post("/generate-content-article", async (req, res) => {
  const {
    companyName,
    description,
    services,
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

  // Fallbacks with dynamic, versatile defaults
  const finalCompanyName =
    companyName ||
    req.session.businessDetails?.companyName ||
    req.session.tempBusinessDetails?.companyName ||
    "Your Company"; // Neutral default
  const finalServices =
    services ||
    req.session.extractedBranding?.services ||
    req.session.businessDetails?.services ||
    "custom business solutions"; // Broad, adaptable default
  const finalDescription =
    description ||
    req.session.extractedBranding?.description ||
    req.session.businessDetails?.description ||
    `${finalCompanyName} provides ${finalServices} to help businesses achieve their goals.`; // Dynamic fallback using services
  const finalTargetAudience =
    targetAudience ||
    req.session.tempBusinessDetails?.targetAudience ||
    req.session.businessDetails?.targetAudience ||
    "businesses seeking growth"; // Neutral default
  const finalBrandTone =
    brandTone ||
    req.session.tempBusinessDetails?.brandTone ||
    req.session.businessDetails?.brandTone ||
    "professional";
  const finalUniqueBusinessGoal =
    uniqueBusinessGoal ||
    req.session.tempBusinessDetails?.uniqueBusinessGoal ||
    "enhance business success";
  const finalSpecificChallenge =
    specificChallenge ||
    req.session.tempBusinessDetails?.specificChallenge ||
    "competing in a crowded market";
  const finalPersonalAnecdote =
    personalAnecdote ||
    req.session.tempBusinessDetails?.personalAnecdote ||
    "A client saw significant improvement after using our services";

  const businessDetails = {
    companyName: finalCompanyName,
    description: finalDescription,
    services: finalServices,
    targetAudience: finalTargetAudience,
    uniqueBusinessGoal: finalUniqueBusinessGoal,
    specificChallenge: finalSpecificChallenge,
    personalAnecdote: finalPersonalAnecdote,
  };
  const suggestions = await suggestKeywordsWithOpenAI(businessDetails); // Assuming this exists
  const finalKeyword =
    keyword || suggestions.primaryKeywords[0] || "business growth solutions"; // Neutral default
  const finalSecondaryKeywords =
    secondaryKeywords ||
    suggestions.secondaryKeywords ||
    ["business strategy", "customer engagement", "market visibility"]; // Generic defaults
  const finalArticleLength = articleLength || "1500-2000 words";
  const finalKeyPoints =
    keyPoints ||
    suggestions.keyPoints ||
    [
      `How ${finalKeyword} drives ${finalUniqueBusinessGoal.split(' ')[0]}`,
      `Addressing ${finalSpecificChallenge} with ${finalCompanyName}`,
      `Benefits for ${finalTargetAudience}`,
    ];
  const finalCta = cta || "Contact us to boost your business today!";

  // Extract primary service from keyword or services for focus
  const primaryService = finalKeyword.split(' ')[0] === "professional" 
    ? finalKeyword.split(' ')[1] 
    : finalKeyword.split(' ')[0] || finalServices.split(',')[0].trim(); // Fallback to first service if keyword is vague

  // Updated prompt with versatile fallback
  const contentPrompt = `
You are an expert SEO content writer. Write a professional, SEO-optimized blog article for the following business. Use a ${finalBrandTone} tone, avoiding casual language or unrelated topics.

Business Details:
- Company Name: ${finalCompanyName}
- Description: ${finalDescription}
- Primary Service (Focus): ${primaryService} (derived from "${finalKeyword}" or first listed service)
- All Services (Context Only): ${finalServices}
- Target Audience: ${finalTargetAudience}
- Primary Keyword: ${finalKeyword}
- Secondary Keywords: ${finalSecondaryKeywords.join(', ')}
- Unique Business Goal: ${finalUniqueBusinessGoal}
- Specific Challenge: ${finalSpecificChallenge}
- Personal Anecdote: ${finalPersonalAnecdote}
- Article Length: ${finalArticleLength}
- CTA: ${finalCta}

Guidelines:
- Focus EXCLUSIVELY on ${primaryService} (e.g., "${primaryService}" from "${finalKeyword}" or first service in "${finalServices}"). Do NOT discuss other services unless directly supporting ${primaryService}.
- Use "${finalKeyword}" 5-7 times naturally (intro, each section, conclusion).
- Use each secondary keyword 2-3 times to reinforce ${finalKeyword}.
- Mention ${finalCompanyName} 3-5 times for brand reinforcement (intro, success stories, conclusion).
- Target middle-of-the-funnel ${finalTargetAudience} researching ${primaryService} to achieve ${finalUniqueBusinessGoal}.
- Include 2-3 internal links (e.g., /services/${primaryService.replace(/\s/g, '-')}) and 1-2 external links to authoritative sources (e.g., https://www.forbes.com for business topics).
- Write concise paragraphs (50-70 words) with clear topic sentences.
- Distribute content: 200-word intro, 300-400 words per section, 200-word conclusion.
- Address ${finalSpecificChallenge} in intro, success stories, and FAQs with ${primaryService} solutions.
- Base content on: ${finalKeyPoints.join(', ')}.

Structure:
- **Proposed URL:** /${finalKeyword.replace(/\s/g, '-')}
- **Title Tag:** ${finalKeyword} - ${finalCompanyName}
- **Meta Description:** (120-150 characters) Achieve ${finalUniqueBusinessGoal} with ${primaryService} from ${finalCompanyName}. Solve ${finalSpecificChallenge}.
- **Content Intent:** Targets ${finalTargetAudience} researching ${primaryService} for ${finalUniqueBusinessGoal}.
- **Key Takeaways:** 3-5 bullets based on ${finalKeyPoints}.
- **Introduction:** (200 words) Introduce ${primaryService}, ${finalCompanyName}, and ${finalSpecificChallenge} for ${finalTargetAudience}.
- **How ${finalKeyword} Transforms Your Business:** 
  - ### Leveraging ${primaryService} Expertise
  - ### Boosting ${finalUniqueBusinessGoal.split(' ')[0]} with ${primaryService}
- **Finding the Right ${primaryService} Partner:** 
  - ### Assessing ${finalTargetAudience} Needs
  - ### Why Choose ${finalCompanyName}
- **Connecting with ${finalTargetAudience} Through ${primaryService}:** 
  - ### Crafting Effective ${primaryService} Solutions
  - ### Engaging ${finalTargetAudience} with ${primaryService}
- **Comprehensive Solutions Beyond ${primaryService}:** 
  - ### Enhancing Brand with ${primaryService}
  - ### Tailored ${primaryService} Strategies
- **Success Stories from ${finalCompanyName}:** 
  - ### Overcoming ${finalSpecificChallenge} with ${primaryService}
  - ### ${finalPersonalAnecdote} (100-150 words)
- **Technology Behind Our ${primaryService}:** 
  - ### Advanced ${primaryService} Tools
  - ### Innovative ${primaryService} Techniques
- **The ROI of ${finalKeyword}:** 
  - ### Driving Results with ${primaryService}
  - ### Building Trust Through ${primaryService}
- **Conclusion:** (200 words) Summarize ${primaryService} benefits, tie to ${finalUniqueBusinessGoal}, end with ${finalCta}.
- **FAQs:** 10 unique questions (50-100 word answers) about ${primaryService}, ${finalKeyword}, and ${finalSpecificChallenge}.
- **Promotional Section:** (100-150 words) Offer a discount on ${primaryService}.
- **Internal Links:** 3 links (e.g., /services/${primaryService}, /portfolio, /contact).
- **Schema Markup:** JSON for Article, FAQPage, LocalBusiness with ${finalKeyword}.

Format Output:
**Proposed URL:** [URL]
**Title Tag:** [Title]
**Meta Description:** [Description]
**Content Intent:** [Intent]
**Key Takeaways:** 
- [Bullet]
**Introduction:** 
[Content]
## [H2 Heading]
### [H3 Subheading]
[Content]
...
## Frequently Asked Questions
**[Question]?**
[Answer]
...
**Promotional Section:** 
[Content]
**Internal Links:**
- [Link]
**Call to Action:** 
[CTA]
**Schema Markup:** 
[JSON]
`;

  try {
    const contentResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: contentPrompt }],
      max_tokens: 4000,
      temperature: 0.7,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
    });

    const generatedArticle = contentResponse.choices[0].message.content.trim();
    const lines = generatedArticle.split('\n').filter((line) => line.trim());

    // Structured parsing
    let parsedContent = {
      proposedUrl: "",
      titleTag: "",
      metaDescription: "",
      contentIntent: "",
      keyTakeaways: [],
      title: "",
      introduction: "",
      sections: [],
      faqs: [],
      promotionalSection: "",
      internalLinks: [],
      callToAction: "",
      schemaMarkup: "",
    };

    let currentSection = null;
    let currentSubheadingContent = "";
    let currentFaq = null;
    let currentField = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("**Proposed URL:**")) {
        parsedContent.proposedUrl = line.replace("**Proposed URL:**", "").trim();
      } else if (line.startsWith("**Title Tag:**")) {
        parsedContent.titleTag = line.replace("**Title Tag:**", "").trim();
        parsedContent.title = parsedContent.titleTag;
      } else if (line.startsWith("**Meta Description:**")) {
        parsedContent.metaDescription = line.replace("**Meta Description:**", "").trim();
      } else if (line.startsWith("**Content Intent:**")) {
        parsedContent.contentIntent = line.replace("**Content Intent:**", "").trim();
      } else if (line.startsWith("**Key Takeaways:**")) {
        currentField = "keyTakeaways";
      } else if (currentField === "keyTakeaways" && line.startsWith("- ")) {
        parsedContent.keyTakeaways.push(line.replace("- ", "").trim());
      } else if (currentField === "keyTakeaways" && line.startsWith("**")) {
        currentField = "";
      } else if (line.startsWith("**Introduction:**")) {
        currentField = "introduction";
        parsedContent.introduction = "";
      } else if (currentField === "introduction" && !line.startsWith("**") && !line.startsWith("## ")) {
        parsedContent.introduction += line + "\n";
      } else if (currentField === "introduction" && line.startsWith("## ")) {
        currentField = "";
        i--;
      } else if (line.startsWith("## ") && !line.includes("Frequently Asked Questions")) {
        if (currentSection) {
          if (currentSubheadingContent) currentSection.content.push(currentSubheadingContent.trim());
          parsedContent.sections.push(currentSection);
        }
        currentSection = { heading: line.replace("## ", "").trim(), subheadings: [], content: [] };
        currentField = "section";
      } else if (currentField === "section" && line.startsWith("### ")) {
        if (currentSubheadingContent) currentSection.content.push(currentSubheadingContent.trim());
        currentSection.subheadings.push(line.replace("### ", "").trim());
        currentSubheadingContent = "";
      } else if (currentField === "section" && !line.startsWith("**") && !line.startsWith("## ")) {
        currentSubheadingContent += line + "\n";
      } else if (currentField === "section" && line.startsWith("## ")) {
        if (currentSubheadingContent) currentSection.content.push(currentSubheadingContent.trim());
        currentField = "";
        i--;
      } else if (line.startsWith("## Frequently Asked Questions")) {
        if (currentSection) {
          if (currentSubheadingContent) currentSection.content.push(currentSubheadingContent.trim());
          parsedContent.sections.push(currentSection);
          currentSection = null;
        }
        currentField = "faqs";
      } else if (currentField === "faqs" && line.startsWith("**") && line.endsWith("?**")) {
        if (currentFaq) parsedContent.faqs.push(currentFaq);
        currentFaq = { question: line.replace(/\*\*/g, "").trim(), answer: "" };
      } else if (currentField === "faqs" && currentFaq && !line.startsWith("**")) {
        currentFaq.answer += line + "\n";
      } else if (currentField === "faqs" && line.startsWith("**")) {
        if (currentFaq) parsedContent.faqs.push(currentFaq);
        currentFaq = null;
        currentField = "";
        i--;
      } else if (line.startsWith("**Promotional Section:**")) {
        currentField = "promotionalSection";
        parsedContent.promotionalSection = "";
        while (i + 1 < lines.length && !lines[i + 1].startsWith("**")) {
          i++;
          parsedContent.promotionalSection += lines[i].trim() + "\n";
        }
      } else if (line.startsWith("**Internal Links:**")) {
        currentField = "internalLinks";
      } else if (currentField === "internalLinks" && line.startsWith("- ")) {
        parsedContent.internalLinks.push(line.replace("- ", "").trim());
      } else if (currentField === "internalLinks" && line.startsWith("**")) {
        currentField = "";
      } else if (line.startsWith("**Call to Action:**")) {
        parsedContent.callToAction = line.replace("**Call to Action:**", "").trim();
      } else if (line.startsWith("**Schema Markup:**")) {
        currentField = "schemaMarkup";
        parsedContent.schemaMarkup = "";
        while (i + 1 < lines.length && !lines[i + 1].startsWith("**")) {
          i++;
          parsedContent.schemaMarkup += lines[i].trim() + "\n";
        }
      }
    }

    if (currentSection) {
      if (currentSubheadingContent) currentSection.content.push(currentSubheadingContent.trim());
      parsedContent.sections.push(currentSection);
    }
    if (currentFaq) parsedContent.faqs.push(currentFaq);

    // Versatile fallbacks
    parsedContent.introduction =
      parsedContent.introduction.trim() ||
      `In today’s competitive market, ${primaryService} is key to ${finalUniqueBusinessGoal}. ${finalCompanyName} offers tailored solutions to address ${finalSpecificChallenge} for ${finalTargetAudience}. This article explores how we can help your business thrive.`;
    parsedContent.sections = parsedContent.sections.length
      ? parsedContent.sections
      : [
          {
            heading: `How ${finalKeyword} Transforms Your Business`,
            subheadings: [`Leveraging ${primaryService} Expertise`],
            content: [`${finalCompanyName} uses ${primaryService} to drive ${finalUniqueBusinessGoal}.`],
          },
        ];
    parsedContent.promotionalSection =
      parsedContent.promotionalSection.trim() ||
      `At ${finalCompanyName}, we’re offering a special deal on ${primaryService}. Contact us to enhance your ${finalTargetAudience} success today!`;
    parsedContent.internalLinks = parsedContent.internalLinks.length
      ? parsedContent.internalLinks
      : [
          `[Learn More About ${primaryService}](https://www.${finalCompanyName.toLowerCase().replace(/\s/g, '')}.com/services/${primaryService.replace(/\s/g, '-')})`,
          `[Portfolio](https://www.${finalCompanyName.toLowerCase().replace(/\s/g, '')}.com/portfolio)`,
          `[Contact Us](https://www.${finalCompanyName.toLowerCase().replace(/\s/g, '')}.com/contact)`,
        ];
    parsedContent.callToAction = parsedContent.callToAction || finalCta;

    // Ensure 10 unique FAQs
    const requiredFaqs = [
      `What exactly are ${primaryService} services?`,
      `How does ${finalKeyword} benefit my business?`,
      `What should I look for in a ${primaryService} provider?`,
      `How long does the ${primaryService} process take?`,
      `Can I provide my own materials for ${primaryService}?`,
      `Which ${finalTargetAudience} benefit from ${primaryService}?`,
      `Is it worth investing in ${primaryService}?`,
      `Does ${finalCompanyName} offer ${primaryService} packages?`,
      `What if I need revisions after using ${primaryService}?`,
      `How do I start with ${finalCompanyName} for ${primaryService}?`,
    ];
    const faqMap = new Map(parsedContent.faqs.map((faq) => [faq.question, faq]));
    requiredFaqs.forEach((q) => {
      if (!faqMap.has(q)) {
        faqMap.set(q, {
          question: q,
          answer: `${finalCompanyName} offers ${primaryService} to address ${finalSpecificChallenge} for ${finalTargetAudience}. Contact us to learn more.`,
        });
      }
    });
    parsedContent.faqs = Array.from(faqMap.values()).slice(0, 10);

    // Schema fallback
    parsedContent.schemaMarkup =
      parsedContent.schemaMarkup.trim() ||
      `
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${finalKeyword} - ${finalCompanyName}",
  "author": {"@type": "Organization", "name": "${finalCompanyName}"},
  "datePublished": "2025-03-21",
  "image": "/images/${primaryService}-example.jpg",
  "publisher": {"@type": "Organization", "name": "${finalCompanyName}", "logo": {"@type": "ImageObject", "url": "/images/${finalCompanyName.toLowerCase().replace(/\s/g, '')}-logo.jpg"}},
  "aggregateRating": {"@type": "AggregateRating", "ratingValue": "4.5", "reviewCount": "50"}
}
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": ${JSON.stringify(parsedContent.faqs.map((faq) => ({ "@type": "Question", "name": faq.question, "acceptedAnswer": { "@type": "Answer", "text": faq.answer.trim() } })))}
}
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "${finalCompanyName}",
  "address": {"@type": "PostalAddress", "addressLocality": "${finalTargetAudience}", "addressCountry": "PH"},
  "aggregateRating": {"@type": "AggregateRating", "ratingValue": "4.5", "reviewCount": "50"}
}
`;

    // Clean content
    const cleanContent = {
      proposedUrl: parsedContent.proposedUrl,
      titleTag: parsedContent.titleTag,
      metaDescription: parsedContent.metaDescription,
      contentIntent: parsedContent.contentIntent,
      keyTakeaways: parsedContent.keyTakeaways,
      title: parsedContent.title,
      introduction: parsedContent.introduction.trim(),
      sections: parsedContent.sections.map((s) => ({
        heading: s.heading,
        subheadings: s.subheadings,
        content: s.content.map((c) => c.trim()),
      })),
      faqs: parsedContent.faqs.map((f) => ({ question: f.question, answer: f.answer.trim() })),
      promotionalSection: parsedContent.promotionalSection.trim(),
      internalLinks: parsedContent.internalLinks,
      callToAction: parsedContent.callToAction.trim(),
      schemaMarkup: parsedContent.schemaMarkup.trim(),
    };

    req.session.generatedContent = cleanContent;
    console.log("Generated Content:", cleanContent);

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