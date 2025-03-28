require("dotenv").config();
const express = require('express');
const router = express.Router();
const OpenAI = require("openai");
const axios = require('axios');
const Business = require('../models/Business');
const { suggestSocialMediaDetails } = require("../utils/socialMediaSuggester");
const Content = require('../models/Content');
const User = require('../models/User');
const { ensureAuthenticated, ensureBusinessRole } = require('../middleware/auth');

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



router.post('/generate-content-social', ensureAuthenticated, ensureBusinessRole('Editor'), async (req, res) => {
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
    specificInstructions, // Add specificInstructions
  } = req.body;

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (process.env.NODE_ENV !== 'development' && user.subscription === 'None' && user.freeTrialUsed) {
      return res.status(403).json({
        error: 'You have already used your free trial. Please subscribe to continue.',
        redirect: '/subscribe',
      });
    }

    if (process.env.NODE_ENV !== 'development' && !user.isEditEdgeUser) {
      const now = new Date();
      if (!user.contentGenerationResetDate || now > user.contentGenerationResetDate) {
        user.articleGenerationCount = 0;
        user.socialMediaGenerationCount = 0;
        user.contentGenerationResetDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        await user.save();
      }

      const socialMediaLimits = {
        Basic: 3,
        Pro: 5,
        Enterprise: 15,
      };

      const userSocialMediaLimit = socialMediaLimits[user.subscription] || 0;
      if (user.subscription !== 'None' && user.socialMediaGenerationCount >= userSocialMediaLimit) {
        return res.status(403).json({
          error: `You have reached your social media content generation limit of ${userSocialMediaLimit} for the ${user.subscription} plan this week. Please upgrade your plan or wait until next week.`,
          redirect: '/subscribe',
        });
      }
    }

    const businessId = req.session.businessId;
    if (!businessId) {
      return res.status(400).json({
        error: 'No business selected. Please start the process again.',
        redirect: '/social-media/branding-social',
      });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(400).json({
        error: 'Business not found.',
        redirect: '/social-media/branding-social',
      });
    }

    const businessData = {
      companyName: business.companyName,
      description: business.description,
      targetAudience: business.targetAudience,
      services: business.services,
      focusService: business.focusService || focusService || business.services.split(',')[0].trim(),
      socialMediaType: socialMediaType || 'Facebook Post',
      brandTone: business.brandTone || brandTone || 'professional',
      goal: goal || 'Generate Leads',
      topic: topic || 'Untitled Topic',
      contentPillar: contentPillar || 'Educate',
      keyMessage: keyMessage || 'Highlight our services',
      adDetails: adDetails || 'No additional details',
      specificInstructions: specificInstructions || 'No specific instructions provided.', // Add specificInstructions
    };

    console.log('Using business data for content generation:', businessData);

    await generateSocialMediaContent(req, res, businessData, business, user);
  } catch (error) {
    console.error('Error in generate-content-social:', error);
    res.status(500).json({ error: 'Error processing request. Please try again.', details: error.message });
  }
});

async function generateSocialMediaContent(req, res, data, business, user) {
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
    specificInstructions, // Add specificInstructions
  } = data;

  if (!data || Object.keys(data).length === 0) {
    console.error('❌ Error: `data` is missing or empty!');
    return res.status(400).json({ error: 'No data provided for content generation.' });
  }
  if (!socialMediaType) {
    console.error('❌ Error: `socialMediaType` is missing!');
    return res.status(400).json({ error: 'Please select a social media type.' });
  }

  console.log('✅ Generating content for:', socialMediaType);
  console.log('Business data used:', data);

  let platform = socialMediaType.split(' ')[0];
  let captionLimit, hashtagCount;
  switch (platform) {
    case 'Facebook':
      captionLimit = '1-100 characters';
      hashtagCount = '1-2';
      break;
    case 'Instagram':
      captionLimit = '138-150 characters';
      hashtagCount = '3-5';
      break;
    case 'LinkedIn':
      captionLimit = '25 words';
      hashtagCount = '1-2';
      break;
    case 'Tiktok':
      captionLimit = '300 characters';
      hashtagCount = '2-3';
      break;
    default:
      captionLimit = '71-100 characters';
      hashtagCount = '1-2';
  }

  let pillarDescription = '';
  switch (contentPillar) {
    case 'Educate':
      pillarDescription = 'Provide an informative and insightful post about the topic. The content should explain concepts clearly and educate the audience with useful knowledge (e.g., tips, FAQs, Top 10 lists, Did you know?).';
      break;
    case 'Entertain':
      pillarDescription = 'Create an entertaining post that’s intriguing, quick, and punchy. Include unusual stories, behind-the-scenes, or fun facts related to the topic.';
      break;
    case 'Inspire':
      pillarDescription = 'Generate an inspiring post that’s positive or memorable, with emotional impact. Include people-focused stories or content about social responsibility/community involvement.';
      break;
    case 'Promote':
      pillarDescription = 'Focus on encouraging the audience to take the next step. Highlight benefits, include a clear call to action (e.g., shop now, enter a contest, see the link in bio).';
      break;
    default:
      pillarDescription = 'Generate a post related to the topic with a general informative or promotional approach.';
  }

  let platformInstructions = '';
  switch (platform) {
    case 'Facebook':
      platformInstructions = `
- Create an emotional connection or sense of intrigue to capture attention quickly.
- Make the post actionable (e.g., ask a question or share a link).
- Prioritize video content if applicable, with captions for accessibility.
- Keep the tone conversational and concise.`;
      break;
    case 'Instagram':
      platformInstructions = `
- Focus on strong visuals (bold, colorful, high-quality).
- Use branded hashtags to encourage organic growth.
- For Stories, include a link if applicable (e.g., "Swipe up to learn more").
- Keep the tone visually engaging and trendy.`;
      break;
    case 'LinkedIn':
      platformInstructions = `
- Use a professional tone, positioning the brand as a thought leader.
- Keep copy brief, use formatting (bullets, line breaks) for readability.
- Share industry-related insights or company news.
- Target the audience directly (e.g., "For marketing professionals...").`;
      break;
    case 'Tiktok':
      platformInstructions = `
- Create a fun, short-form video with a trendy vibe.
- Incorporate trending topics or hashtags (e.g., #TrendAlert).
- Use engaging audio to enhance memorability.
- Encourage user-generated content (e.g., "Tag us in your videos!").`;
      break;
    default:
      platformInstructions = `
- Keep the tone conversational and engaging.
- Use a question or curiosity-driven approach to capture attention.`;
  }

  let prompt = `
Generate a Social Media ${socialMediaType} for ${companyName}.
- Content must strictly follow this pillar: **${contentPillar}**.
- **Pillar Guidelines:** ${pillarDescription}
- **Platform:** ${platform}
- **Platform Guidelines:** ${platformInstructions}
- Caption must be within ${captionLimit}.
- Avoid repetitive phrases like "Let's dive in!" in the caption. Be creative and vary the ending.
- Include ${hashtagCount} relevant hashtags, tailored to the platform.
- Add 2-3 relevant emojis to the caption for engagement (e.g., 🌟, 🚀, 💡), but keep it professional.
- Generate a CTA that encourages interaction (e.g., ask a question, invite to learn more, try a product, purchase).
- Use natural, human-like language to avoid AI detection.
- Vary sentence structure and tone to sound conversational.
- Tone: "${brandTone || 'professional'}".
- Use this data:
  - Topic: ${topic || 'Untitled Topic'}
  - Key Message: ${keyMessage || 'Highlight our services'}
  - Description: ${description || 'A creative agency offering top-tier services.'}
  - Services: ${services || 'General services'}
  - Focus Product/Service: ${focusService ? focusService : 'All services'}
  - Target Audience: ${targetAudience || 'General audience'}
  - Goal: ${goal || 'Genearate Leads'}
  - Details: ${adDetails || 'No additional details'}
- Specific AI Instructions: ${specificInstructions || 'No specific instructions provided.'}

**Specific AI Instructions:**
- Follow the specific instructions provided: "${specificInstructions || 'No specific instructions provided.'}"
- If specific instructions are provided, ensure the content structure adheres to them (e.g., "the content must start with a question, followed by a problem of the focus service, then how we solve that problem").

**FORMAT EXACTLY LIKE THIS:**
`;

  if (socialMediaType.includes('Reel') || socialMediaType.includes('Story') || socialMediaType === 'Tiktok Video') {
    prompt += `
---
**Video Concept:** [2-3 sentences describing the video idea based on topic/purpose]  
**Caption:** [Within ${captionLimit}, include 2-3 emojis, follow the pillar, avoid "Let's dive in!"]  
**Hashtags:** [${hashtagCount} relevant hashtags, include a branded hashtag if applicable]  
**CTA:** [Engaging call to action]  
**Video Script & Structure (Timestamped Table):**  
- **0-3 sec:** [Hook: Attention-grabbing scene description] | [Assets to use] | [Animation style]  
- **3-6 sec:** [Scene description addressing a problem or myth] | [Assets to use] | [Animation style]  
- **6-9 sec:** [Scene description debunking the myth or providing a solution] | [Assets to use] | [Animation style]  
- **9-12 sec:** [Scene description with a question or key insight] | [Assets to use] | [Animation style]  
- **12-15 sec:** [Scene description addressing a limiting belief] | [Assets to use] | [Animation style]  
- **15-18 sec:** [Scene description highlighting a challenge] | [Assets to use] | [Animation style]  
- **18-20 sec:** [Call to action scene] | [Assets to use, include company logo] | [Animation style]  
**Assets:** [Assets like footage, logos, etc.]  
---
`;
  } else {
    prompt += `
---
**Caption:** [Within ${captionLimit}, include 2-3 emojis, follow the pillar, avoid "Let's dive in!"]  
**Hashtags:** [${hashtagCount} relevant hashtags, include a branded hashtag if applicable]  
**Main Content:** [Follow the pillar, e.g., tips list, educational insights, engaging questions, etc.]  
**CTA:** [Engaging call to action]  
**Texts on Poster:** [Short text for poster]  
**Assets:** [Assets like images, icons, etc.]  
---
`;
  }

  const aiResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 800,
    temperature: 0.7,
    presence_penalty: 0.3,
    frequency_penalty: 0.3,
  });

  const generatedContent = aiResponse.choices[0].message.content.trim();
  console.log('✅ AI Raw Response:\n', generatedContent);

  const lines = generatedContent.split('\n').filter((line) => line.trim());
  let extractedContent = {
    companyName,
    socialMediaType,
    topic: topic || 'Untitled Topic',
    description: description || 'A creative agency offering top-tier services.',
    services: services || 'General services',
    targetAudience: targetAudience || 'General Audience',
    caption: '',
    hashtags: '',
    cta: '',
    mainContent: '',
    assets: '',
    posterText: '',
    videoConcept: '',
    script: [],
    textOnScreen: '',
    imageUrl: '',
  };

  let currentSection = null;
  let scriptTable = [];

  lines.forEach((line) => {
    if (line.startsWith('**Caption:**')) {
      extractedContent.caption = line.replace('**Caption:**', '').trim();
    } else if (line.startsWith('**Hashtags:**')) {
      extractedContent.hashtags = line.replace('**Hashtags:**', '').trim();
    } else if (line.startsWith('**CTA:**')) {
      extractedContent.cta = line.replace('**CTA:**', '').trim();
    } else if (line.startsWith('**Main Content:**')) {
      currentSection = 'mainContent';
      extractedContent.mainContent = line.replace('**Main Content:**', '').trim();
    } else if (line.startsWith('**Assets:**')) {
      currentSection = null;
      extractedContent.assets = line.replace('**Assets:**', '').trim();
    } else if (line.startsWith('**Texts on Poster:**')) {
      currentSection = null;
      extractedContent.posterText = line.replace('**Texts on Poster:**', '').trim();
    } else if (line.startsWith('**Video Concept:**')) {
      currentSection = null;
      extractedContent.videoConcept = line.replace('**Video Concept:**', '').trim();
    } else if (line.startsWith('**Video Script & Structure (Timestamped Table):**')) {
      currentSection = 'script';
    } else if (line.startsWith('**Text on Screen:**')) {
      currentSection = 'textOnScreen';
    } else if (currentSection === 'mainContent' && line.trim()) {
      let cleanedLine = line.trim().replace(/\*\*(.*?)\*\*/g, '$1');
      extractedContent.mainContent += '\n' + cleanedLine;
    } else if (currentSection === 'script' && line.match(/^\-\s\*\*\d+-\d+\ssec:\*\*/)) {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length >= 3) {
        const timestampMatch = parts[0].match(/^\-\s\*\*(\d+-\d+\ssec):\*\*/);
        if (timestampMatch) {
          const timestamp = timestampMatch[1];
          const sceneDescription = parts[0].replace(/^\-\s\*\*\d+-\d+\ssec:\*\*/, '').trim();
          const assetsToUse = parts[1] || 'No assets specified';
          const animationStyle = parts[2] || 'No animation specified';
          scriptTable.push({ timestamp, sceneDescription, assetsToUse, animationStyle });
        }
      }
    } else if (currentSection === 'textOnScreen' && line.match(/^\-\s\*\*Scene\s\d:\*\*/)) {
      extractedContent.textOnScreen += line.replace(/^\-\s\*\*Scene\s\d:\*\*\s/, '').trim() + '\n';
    }
  });

  extractedContent.hashtags = extractedContent.hashtags
    ? extractedContent.hashtags.split(' ').filter((tag) => tag.trim())
    : ['#DefaultHashtag'];


  extractedContent = {
    ...extractedContent,
    ...(socialMediaType.includes('Reel') || socialMediaType.includes('Story') || socialMediaType === 'Tiktok Video'
      ? {
          videoConcept: extractedContent.videoConcept || 'Showcase our services.',
          script: scriptTable.length > 0 ? scriptTable : [],
          textOnScreen: extractedContent.textOnScreen.trim(),
        }
      : {}),
    ...(socialMediaType.includes('Post')
      ? {
          posterText: extractedContent.posterText || 'Default poster text',
        }
      : {}),
  };

  extractedContent.caption = extractedContent.caption || 'Contact us for amazing content! 🌟';
  extractedContent.cta = extractedContent.cta || 'Learn more!';
  extractedContent.mainContent = extractedContent.mainContent || 'No content provided.';
  extractedContent.assets = extractedContent.assets || 'Generic assets';

  console.log('✅ Extracted Content:', extractedContent);

  const content = new Content({
    type: 'SocialMedia',
    businessId: business._id,
    userId: req.user._id,
    data: extractedContent,
    status: 'Draft',
  });
  await content.save();

  if (process.env.NODE_ENV !== 'development' && !user.isEditEdgeUser) {
    user.socialMediaGenerationCount += 1;
    await user.save();
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

  req.session.generatedContent = extractedContent;
  console.log('✅ Session Content Stored:', req.session.generatedContent);

  const socialMediaLimits = {
    Basic: 3,
    Pro: 5,
    Enterprise: 15,
  };
  const userSocialMediaLimit = socialMediaLimits[user.subscription] || 0;
  const remainingSocialMedia = userSocialMediaLimit - user.socialMediaGenerationCount;
// Updated response
const response = {
  ...extractedContent,
  contentId: content._id.toString(), // Include content ID for later updates
};

// Add imageSelectionPending flag for non-Reel content
if (
  !socialMediaType.includes('Reel') &&
  !socialMediaType.includes('Story') &&
  socialMediaType !== 'Tiktok Video'
) {
  response.imageSelectionPending = true;
}
  if (process.env.NODE_ENV !== 'development' && !user.isEditEdgeUser && remainingSocialMedia === 1) {
    response.warning = `You have 1 social media generation left this week for the ${user.subscription} plan.`;
  }

  res.json(response);
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