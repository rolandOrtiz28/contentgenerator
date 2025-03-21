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
  const { companyName, description, services, targetAudience, brandTone, keyword, secondaryKeywords, articleLength, keyPoints, cta, uniqueBusinessGoal, specificChallenge, personalAnecdote } = req.body;

  // Fallback to session data if request body values are missing
  let finalCompanyName = companyName || req.session.businessDetails?.companyName || req.session.tempBusinessDetails?.companyName || "Unknown Company";
  let finalDescription = description || req.session.extractedBranding?.description || req.session.businessDetails?.description || "A company offering digital solutions.";
  let finalServices = services || req.session.extractedBranding?.services || req.session.businessDetails?.services || "General digital services";
  let finalTargetAudience = targetAudience || req.session.tempBusinessDetails?.targetAudience || req.session.businessDetails?.targetAudience || "General audience";
  let finalBrandTone = brandTone || req.session.tempBusinessDetails?.brandTone || req.session.businessDetails?.brandTone || "professional";
  let finalUniqueBusinessGoal = uniqueBusinessGoal || req.session.tempBusinessDetails?.uniqueBusinessGoal || "Increase online visibility";
  let finalSpecificChallenge = specificChallenge || req.session.tempBusinessDetails?.specificChallenge || "Standing out in a competitive market";
  let finalPersonalAnecdote = personalAnecdote || req.session.tempBusinessDetails?.personalAnecdote || "A client success story that highlights our expertise";
  
  const businessDetails = { 
    companyName: finalCompanyName, 
    description: finalDescription, 
    services: finalServices, 
    targetAudience: finalTargetAudience,
    uniqueBusinessGoal: finalUniqueBusinessGoal,
    specificChallenge: finalSpecificChallenge,
    personalAnecdote: finalPersonalAnecdote,
  };
  const suggestions = await suggestKeywordsWithOpenAI(businessDetails);
  let finalKeyword = keyword || suggestions.primaryKeywords[0] || "SEO optimization";
  let finalSecondaryKeywords = secondaryKeywords || suggestions.secondaryKeywords || [];
  let finalArticleLength = articleLength || "1500-2000 words";
  let finalKeyPoints = keyPoints || suggestions.keyPoints || ["Importance of the service", "How to choose the right provider", "Why it matters for your audience"];
  let finalCta = cta || "Contact us for more information!";

  // Introduce variability in section headings and tone
  const toneVariations = [
    "conversational and witty",
    "professional and authoritative",
    "inspirational and motivational",
    "casual and relatable",
    "technical and informative",
  ];
  const selectedTone = finalBrandTone || toneVariations[Math.floor(Math.random() * toneVariations.length)];

  const sectionVariations = {
    benefits: [
      "Why [Service] Matters for Your Business",
      "The Power of [Service] in Growing Your Brand",
      "How [Service] Can Transform Your Online Presence",
    ],
    choosingProvider: [
      "Finding the Perfect [Service] Partner",
      "What to Look for in a [Service] Provider",
      "How to Choose the Best [Service] Team",
    ],
    audience: [
      "Why Your Audience Needs [Service]",
      "Connecting with Your Audience Through [Service]",
      "How [Service] Speaks to Your Customers",
    ],
    beyondService: [
      "More Than [Service]: A Full Multimedia Experience",
      "Expanding Your Strategy Beyond [Service]",
      "Comprehensive Solutions to Complement [Service]",
    ],
    successStories: [
      "Real Wins with [CompanyName]",
      "Success Stories: How [CompanyName] Delivered Results",
      "Client Victories Powered by [CompanyName]",
    ],
    technology: [
      "Using Cutting-Edge Tech for [Service]",
      "How Technology Elevates Our [Service] Game",
      "The Tech Behind Superior [Service]",
    ],
    impact: [
      "Measuring the ROI of [Service]",
      "How [Service] Impacts Your Bottom Line",
      "Tracking the Success of Your [Service] Efforts",
    ],
  };

  const selectedSections = {
    benefits: sectionVariations.benefits[Math.floor(Math.random() * sectionVariations.benefits.length)],
    choosingProvider: sectionVariations.choosingProvider[Math.floor(Math.random() * sectionVariations.choosingProvider.length)],
    audience: sectionVariations.audience[Math.floor(Math.random() * sectionVariations.audience.length)],
    beyondService: sectionVariations.beyondService[Math.floor(Math.random() * sectionVariations.beyondService.length)],
    successStories: sectionVariations.successStories[Math.floor(Math.random() * sectionVariations.successStories.length)],
    technology: sectionVariations.technology[Math.floor(Math.random() * sectionVariations.technology.length)],
    impact: sectionVariations.impact[Math.floor(Math.random() * sectionVariations.impact.length)],
  };

  // Replace placeholders in section headings
  const serviceName = finalServices.split(',')[0].trim(); // Use the first service as the main focus
  const formattedSections = {
    benefits: selectedSections.benefits.replace('[Service]', serviceName),
    choosingProvider: selectedSections.choosingProvider.replace('[Service]', serviceName),
    audience: selectedSections.audience.replace('[Service]', serviceName),
    beyondService: selectedSections.beyondService.replace('[Service]', serviceName),
    successStories: selectedSections.successStories.replace('[CompanyName]', finalCompanyName),
    technology: selectedSections.technology.replace('[Service]', serviceName),
    impact: selectedSections.impact.replace('[Service]', serviceName),
  };

  // Generate the article with a more explicit and structured prompt
  const contentPrompt = `
    You are an expert content writer specializing in SEO-optimized blog articles. Write a high-quality, SEO-optimized blog article for the following business. Follow the exact structure and format provided below, ensuring all sections are included and properly formatted with the specified markers (e.g., **Section Name:**, ## Heading, ### Subheading). Do not skip any sections, and ensure the content is engaging, humanized, and tailored to the business details. Generate the full article, including all sections, even if it requires more tokens—do not truncate the response.

    Business Details:
    - **Company Name:** ${finalCompanyName}
    - **Target Audience:** ${finalTargetAudience}
    - **Brand Tone:** ${selectedTone}
    - **Primary SEO Keyword:** ${finalKeyword}
    - **Secondary Keywords:** ${finalSecondaryKeywords.join(', ')}
    - **Description:** ${finalDescription}
    - **Services:** ${finalServices}
    - **Unique Business Goal:** ${finalUniqueBusinessGoal}
    - **Specific Challenge:** ${finalSpecificChallenge}
    - **Personal Anecdote:** ${finalPersonalAnecdote}
    - **Article Length:** ${finalArticleLength}
    - **CTA:** ${finalCta}

    Follow these strict guidelines to make the content humanized, engaging, and cost-efficient:
    1. **Humanization Guidelines**:
       - Use a ${selectedTone} tone to make the content feel fresh and engaging.
       - Include idioms, metaphors, anecdotes, and natural dialogue to connect with the reader.
       - Incorporate the personal anecdote (${finalPersonalAnecdote}) in the "${formattedSections.successStories}" section to add a unique touch.
       - Avoid overusing the words "unique", "ensure", "utmost" (use each fewer than 3 times).
       - Rewrite sentences containing the following words with appropriate alternatives: meticulous, meticulously, navigating, complexities, realm, bespoke, tailored, towards, underpins, ever-changing, ever-evolving, the world of, not only, seeking more than just, designed to enhance, it’s not merely, our suite, it is advisable, daunting, in the heart of, when it comes to, in the realm of, amongst, unlock the secrets, unveil the secrets, robust.
    2. **Structure and Readability**:
       - Use heterogeneous paragraphs and sentence lengths, primarily short and straightforward sentences.
       - Format the content with proper markdown (e.g., line breaks between paragraphs, bullet points for lists).
       - Use ** for bold section titles (e.g., **Introduction:**), ## for H2 headings, and ### for H3 subheadings.
    3. **Content Quality**:
       - Add 2-3 relevant facts to support the content (e.g., statistics about the service or target audience).
       - Include unique insights related to the specific challenge (${finalSpecificChallenge}) and business goal (${finalUniqueBusinessGoal}).
       - Do not include fluff; every sentence must provide value.
    4. **SEO Guidelines**:
       - Follow Ahrefs SEO guidelines, targeting middle-of-the-funnel readers.
       - Use the primary keyword (${finalKeyword}) 5-7 times naturally.
       - Include semantic keywords (${finalSecondaryKeywords.join(', ')}) naturally.
    5. **Engagement**:
       - Prioritize engagement by addressing the specific challenge (${finalSpecificChallenge}) and tying it to the business goal (${finalUniqueBusinessGoal}).
       - Use storytelling to make the content memorable, incorporating the personal anecdote in the "${formattedSections.successStories}" section.

    The article must include the following sections and structure, matching the format of a professional SEO-optimized blog post:
    - **Proposed URL:** /[keyword-slug]-article
    - **Title Tag:** [Title with keyword] - ${finalCompanyName}
    - **Meta Description:** (120-150 characters) with the keyword.
    - **Content Intent:** This blog post targets a middle-of-the-funnel audience, focusing on ${finalTargetAudience} who are researching ${finalServices} to achieve ${finalUniqueBusinessGoal}. It addresses their needs, challenges (e.g., ${finalSpecificChallenge}), and considerations while showcasing ${finalCompanyName}’s expertise.
    - **Target Keyword:** ${finalKeyword}
    - **Key Takeaways:** 3-5 bullet points summarizing the main points.
    - **Introduction:** (150-200 words) introducing the topic, the company, and the value of the service, mentioning the specific challenge (${finalSpecificChallenge}). This section is mandatory—do not skip it.
    - **Main Sections:** 7 sections (200-300 words each) with H2 headings, providing detailed explanations with examples, facts, and insights:
      - **${formattedSections.benefits}** with 2 H3 subheadings.
      - **${formattedSections.choosingProvider}** with 2 H3 subheadings.
      - **${formattedSections.audience}** with 2 H3 subheadings.
      - **${formattedSections.beyondService}** with 2 H3 subheadings.
      - **${formattedSections.successStories}** with 2 H3 subheadings (include the personal anecdote here).
      - **${formattedSections.technology}** with 2 H3 subheadings.
      - **${formattedSections.impact}** with 2 H3 subheadings.
    - **Alt Image Text and Link:** Include 2 placeholders for images with alt text and links (e.g., "Alt Image Text: [Description]" and "Link: [URL]").
    - **Conclusion:** (100-150 words) summarizing the article, reinforcing the company’s value, and tying back to the business goal (${finalUniqueBusinessGoal}).
    - **Read Also:** 3 internal links to related blog posts (e.g., "Read also: [Link Text]").
    - **Frequently Asked Questions:** 10 FAQs with concise answers (50-100 words each, 3-4 sentences), covering common questions about the service, its impact on SEO, conversions, and audience engagement, tailored to the specific challenge (${finalSpecificChallenge}). Answers must be direct and to the point—do not exceed 100 words per answer.
    - **Call to Action:** The provided CTA: "${finalCta}".
    - **Promotional Section:** (100-150 words) highlighting ${finalServices} with a bundle discount (e.g., "Bundle [Service 1] + [Service 2] and save 10% today!").
    - **2nd Visual CTA:** Placeholder for a second visual call-to-action image.
    - **Internal Links:** 3 internal links in the "Read Also" section (e.g., "[Link Text](URL)").
    - **Schema Markup:** Include schema for Article and FAQPage.

    Format the output exactly as follows, ensuring all sections are included and properly formatted:
    **Proposed URL:** /[keyword-slug]-article
    
    **Title Tag:** [Title with keyword] - ${finalCompanyName}
    
    **Meta Description:** [Meta Description]
    
    **Content Intent:** [Content intent description]
    
    **Target Keyword:** ${finalKeyword}
    
    **Key Takeaways:**  
    - [Bullet 1]  
    - [Bullet 2]  
    - [Bullet 3]  
    
    **Introduction:**  
    [Introduction content with line breaks between paragraphs]
    
    ## ${formattedSections.benefits}  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    
    **Alt Image Text:** [Description]  
    **Link:** [URL]  
    
    ## ${formattedSections.choosingProvider}  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    
    ## ${formattedSections.audience}  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    
    ## ${formattedSections.beyondService}  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    
    ## ${formattedSections.successStories}  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words, include the personal anecdote]  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    
    ## ${formattedSections.technology}  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    
    ## ${formattedSections.impact}  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    ### [H3 Subheading]  
    [Content with line breaks, 100-150 words]  
    
    **Alt Image Text:** [Description]  
    **Link:** [URL]  
    
    **Conclusion:**  
    [Conclusion content with line breaks]
    
    **Read Also:**  
    - [Link Text](URL)  
    - [Link Text](URL)  
    - [Link Text](URL)  
    
    **Frequently Asked Questions:**  
    **What exactly are ${serviceName} services?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **How can ${serviceName} impact my SEO?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **What should I look for in a ${serviceName} provider?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **How long does the ${serviceName} process typically take?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **Can I provide my own materials for ${serviceName}?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **What types of businesses benefit from professional ${serviceName}?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **Is it worth investing in professional ${serviceName} production?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **Do you offer packages for multiple services?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **What if I need revisions after the initial ${serviceName}?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    **How do I get started working with ${finalCompanyName}?**  
    [Answer with line breaks, 50-100 words, 3-4 sentences]  
    
    **Call to Action:**  
    ${finalCta}
    
    **Promotional Section:**  
    [Promotional content with line breaks, 100-150 words]
    
    **2nd Visual CTA:**  
    [Placeholder for second visual call-to-action image]
    
    **Internal Links:**  
    - [Link Text](URL)  
    - [Link Text](URL)  
    - [Link Text](URL)  
    
    **Schema Markup:**  
    [Schema JSON]
  `;

  try {
    const contentResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: contentPrompt }],
      max_tokens: 9000, // Increased further to ensure all sections are generated
      temperature: 0.9,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
    });

    const generatedArticle = contentResponse.choices[0].message.content.trim();
    console.log("Generated Article:", generatedArticle);

    // Parse the article into a structured object
    const lines = generatedArticle.split('\n').filter(line => line.trim());
    let parsedContent = {
      proposedUrl: '',
      titleTag: '',
      metaDescription: '',
      contentIntent: '',
      targetKeyword: '',
      keyTakeaways: [],
      title: '',
      introduction: '',
      sections: [],
      altImageText1: '',
      link1: '',
      altImageText2: '',
      link2: '',
      conclusion: '',
      readAlso: [],
      faqs: [],
      callToAction: '',
      promotionalSection: '',
      secondVisualCta: '',
      internalLinks: [],
      schemaMarkup: '',
    };

    let currentSection = null;
    let currentSubheadingContent = '';
    let currentFaq = null;
    let currentField = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('**Proposed URL:**')) {
        parsedContent.proposedUrl = line.replace('**Proposed URL:**', '').trim();
        currentField = '';
      } else if (line.startsWith('**Title Tag:**')) {
        parsedContent.titleTag = line.replace('**Title Tag:**', '').trim();
        parsedContent.title = parsedContent.titleTag;
        currentField = '';
      } else if (line.startsWith('**Meta Description:**')) {
        parsedContent.metaDescription = line.replace('**Meta Description:**', '').trim();
        currentField = '';
      } else if (line.startsWith('**Content Intent:**')) {
        parsedContent.contentIntent = line.replace('**Content Intent:**', '').trim();
        currentField = '';
      } else if (line.startsWith('**Target Keyword:**')) {
        parsedContent.targetKeyword = line.replace('**Target Keyword:**', '').trim();
        currentField = '';
      } else if (line.startsWith('**Key Takeaways:**')) {
        currentField = 'keyTakeaways';
      } else if (currentField === 'keyTakeaways' && line.startsWith('- ')) {
        parsedContent.keyTakeaways.push(line.replace('- ', '').trim());
      } else if (currentField === 'keyTakeaways' && (line.startsWith('**') || line.startsWith('---'))) {
        currentField = '';
      } else if (line.startsWith('**Introduction:**')) {
        currentField = 'introduction';
        parsedContent.introduction = '';
      } else if (currentField === 'introduction' && !line.startsWith('**') && !line.startsWith('---') && !line.startsWith('## ')) {
        parsedContent.introduction += line + '\n';
      } else if (currentField === 'introduction' && (line.startsWith('**') || line.startsWith('---') || line.startsWith('## '))) {
        currentField = '';
        i--;
      } else if (line.startsWith('## ') && !line.startsWith('## Read Also:') && !line.startsWith('## Frequently Asked Questions:') && !line.startsWith('## Conclusion:')) {
        currentField = 'section';
        if (currentSection) {
          if (currentSubheadingContent) {
            currentSection.content.push(currentSubheadingContent.trim());
            currentSubheadingContent = '';
          }
          parsedContent.sections.push(currentSection);
        }
        currentSection = {
          heading: line.replace('## ', '').trim(),
          subheadings: [],
          content: [],
        };
      } else if (currentField === 'section' && line.startsWith('### ')) {
        if (currentSubheadingContent) {
          currentSection.content.push(currentSubheadingContent.trim());
          currentSubheadingContent = '';
        }
        currentSection.subheadings.push(line.replace('### ', '').replace(':', '').trim());
      } else if (currentField === 'section' && !line.startsWith('**') && !line.startsWith('---') && !line.startsWith('## ') && !line.startsWith('### ')) {
        currentSubheadingContent += line + '\n';
      } else if (currentField === 'section' && (line.startsWith('**') || line.startsWith('---') || line.startsWith('## '))) {
        if (currentSubheadingContent) {
          currentSection.content.push(currentSubheadingContent.trim());
          currentSubheadingContent = '';
        }
        currentField = '';
        i--;
      } else if (line.startsWith('**Alt Image Text:**')) {
        currentField = '';
        if (currentSection) {
          if (currentSubheadingContent) {
            currentSection.content.push(currentSubheadingContent.trim());
            currentSubheadingContent = '';
          }
          parsedContent.sections.push(currentSection);
          currentSection = null;
        }
        if (!parsedContent.altImageText1) {
          parsedContent.altImageText1 = line.replace('**Alt Image Text:**', '').trim();
        } else {
          parsedContent.altImageText2 = line.replace('**Alt Image Text:**', '').trim();
        }
      } else if (line.startsWith('**Link:**')) {
        if (!parsedContent.link1) {
          parsedContent.link1 = line.replace('**Link:**', '').trim();
        } else {
          parsedContent.link2 = line.replace('**Link:**', '').trim();
        }
      } else if (line.startsWith('**Conclusion:**') || line.startsWith('## Conclusion:')) {
        currentField = 'conclusion';
        if (currentSection) {
          if (currentSubheadingContent) {
            currentSection.content.push(currentSubheadingContent.trim());
            currentSubheadingContent = '';
          }
          parsedContent.sections.push(currentSection);
          currentSection = null;
        }
        parsedContent.conclusion = '';
      } else if (currentField === 'conclusion' && !line.startsWith('**') && !line.startsWith('## ') && !line.startsWith('---')) {
        parsedContent.conclusion += line + '\n';
      } else if (currentField === 'conclusion' && (line.startsWith('**') || line.startsWith('## ') || line.startsWith('---'))) {
        currentField = '';
        i--;
      } else if (line.startsWith('**Read Also:**') || line.startsWith('## Read Also:')) {
        currentField = 'readAlso';
      } else if (currentField === 'readAlso' && line.startsWith('- ')) {
        parsedContent.readAlso.push(line.replace('- ', '').trim());
      } else if (currentField === 'readAlso' && (line.startsWith('**') || line.startsWith('## '))) {
        currentField = '';
        i--;
      } else if (line.startsWith('**Frequently Asked Questions:**') || line.startsWith('## Frequently Asked Questions:')) {
        currentField = 'faqs';
      } else if (currentField === 'faqs' && line.startsWith('**') && line.endsWith('?**')) {
        if (currentFaq) {
          parsedContent.faqs.push(currentFaq);
        }
        currentFaq = {
          question: line.replace(/\*\*/g, '').trim(),
          answer: '',
        };
      } else if (currentField === 'faqs' && currentFaq && !line.startsWith('**') && !line.startsWith('## ') && !line.startsWith('---')) {
        currentFaq.answer += line + '\n';
      } else if (currentField === 'faqs' && (line.startsWith('**') || line.startsWith('## ') || line.startsWith('---'))) {
        if (currentFaq) {
          parsedContent.faqs.push(currentFaq);
          currentFaq = null;
        }
        currentField = '';
        i--;
      } else if (line.startsWith('**Call to Action:**')) {
        currentField = 'callToAction';
        parsedContent.callToAction = '';
        while (i + 1 < lines.length && !lines[i + 1].startsWith('**') && !lines[i + 1].startsWith('---')) {
          i++;
          parsedContent.callToAction += lines[i].trim() + '\n';
        }
        parsedContent.callToAction = parsedContent.callToAction.trim() || finalCta;
      } else if (line.startsWith('**Promotional Section:**')) {
        currentField = 'promotionalSection';
        parsedContent.promotionalSection = '';
        while (i + 1 < lines.length && !lines[i + 1].startsWith('**') && !lines[i + 1].startsWith('---')) {
          i++;
          parsedContent.promotionalSection += lines[i].trim() + '\n';
        }
      } else if (line.startsWith('**2nd Visual CTA:**')) {
        currentField = 'secondVisualCta';
        parsedContent.secondVisualCta = '';
        while (i + 1 < lines.length && !lines[i + 1].startsWith('**') && !lines[i + 1].startsWith('---')) {
          i++;
          parsedContent.secondVisualCta += lines[i].trim() + '\n';
        }
        parsedContent.secondVisualCta = parsedContent.secondVisualCta.trim() || '[Placeholder for second visual call-to-action image]';
      } else if (line.startsWith('**Internal Links:**')) {
        currentField = 'internalLinks';
      } else if (currentField === 'internalLinks' && line.startsWith('- ')) {
        parsedContent.internalLinks.push(line.replace('- ', '').trim());
      } else if (currentField === 'internalLinks' && (line.startsWith('**') || line.startsWith('---'))) {
        currentField = '';
        i--;
      } else if (line.startsWith('**Schema Markup:**')) {
        currentField = 'schemaMarkup';
        parsedContent.schemaMarkup = '';
        while (i + 1 < lines.length && !lines[i + 1].startsWith('**') && !lines[i + 1].startsWith('---')) {
          i++;
          parsedContent.schemaMarkup += lines[i].trim() + '\n';
        }
      }
    }

    if (currentSection) {
      if (currentSubheadingContent) {
        currentSection.content.push(currentSubheadingContent.trim());
      }
      parsedContent.sections.push(currentSection);
    }
    if (currentFaq) {
      parsedContent.faqs.push(currentFaq);
    }

    parsedContent.introduction = parsedContent.introduction.trim();
    parsedContent.conclusion = parsedContent.conclusion.trim();
    parsedContent.promotionalSection = parsedContent.promotionalSection.trim();
    parsedContent.schemaMarkup = parsedContent.schemaMarkup.trim();
    parsedContent.callToAction = parsedContent.callToAction.trim();
    parsedContent.secondVisualCta = parsedContent.secondVisualCta.trim();
    parsedContent.sections = parsedContent.sections.map(section => ({
      ...section,
      content: section.content.map(content => content.trim()),
    }));
    parsedContent.faqs = parsedContent.faqs.map(faq => ({
      ...faq,
      answer: faq.answer.trim(),
    }));

    const cleanContent = {
      proposedUrl: parsedContent.proposedUrl,
      titleTag: parsedContent.titleTag,
      metaDescription: parsedContent.metaDescription,
      contentIntent: parsedContent.contentIntent,
      targetKeyword: parsedContent.targetKeyword,
      keyTakeaways: parsedContent.keyTakeaways,
      title: parsedContent.title,
      introduction: parsedContent.introduction
        .replace(/\*\*/g, '')
        .replace(/### /g, '')
        .replace(/## /g, '')
        .replace(/---/g, '')
        .trim(),
      sections: parsedContent.sections.map(section => ({
        heading: section.heading
          .replace(/\*\*/g, '')
          .replace(/### /g, '')
          .replace(/## /g, '')
          .replace(/---/g, '')
          .trim(),
        subheadings: section.subheadings.map(subheading =>
          subheading
            .replace(/\*\*/g, '')
            .replace(/### /g, '')
            .replace(/## /g, '')
            .replace(/---/g, '')
            .trim()
        ),
        content: section.content.map(content =>
          content
            .replace(/\*\*/g, '')
            .replace(/### /g, '')
            .replace(/## /g, '')
            .replace(/---/g, '')
            .trim()
        ),
      })),
      altImageText1: parsedContent.altImageText1,
      link1: parsedContent.link1,
      altImageText2: parsedContent.altImageText2,
      link2: parsedContent.link2,
      conclusion: parsedContent.conclusion
        .replace(/\*\*/g, '')
        .replace(/### /g, '')
        .replace(/## /g, '')
        .replace(/---/g, '')
        .trim(),
      readAlso: parsedContent.readAlso,
      faqs: parsedContent.faqs.map(faq => ({
        question: faq.question
          .replace(/\*\*/g, '')
          .replace(/### /g, '')
          .replace(/## /g, '')
          .replace(/---/g, '')
          .trim(),
        answer: faq.answer
          .replace(/\*\*/g, '')
          .replace(/### /g, '')
          .replace(/## /g, '')
          .replace(/---/g, '')
          .trim(),
      })),
      callToAction: parsedContent.callToAction
        .replace(/\*\*/g, '')
        .replace(/### /g, '')
        .replace(/## /g, '')
        .replace(/---/g, '')
        .trim(),
      promotionalSection: parsedContent.promotionalSection
        .replace(/\*\*/g, '')
        .replace(/### /g, '')
        .replace(/## /g, '')
        .replace(/---/g, '')
        .trim(),
      secondVisualCta: parsedContent.secondVisualCta,
      internalLinks: parsedContent.internalLinks,
      schemaMarkup: parsedContent.schemaMarkup.trim(),
    };

    req.session.generatedContent = cleanContent;
    console.log('Cleaned content stored in session:', req.session.generatedContent);

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