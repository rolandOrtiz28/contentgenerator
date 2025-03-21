const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Heuristic-based keyword suggestion function as a fallback
const suggestKeywords = (businessDetails) => {
  const { focusService, targetAudience } = businessDetails;
  // Ensure focusService is defined, fallback to a default if not specified
  const effectiveFocusService = focusService || (typeof businessDetails.services === 'string' ? businessDetails.services.split(',').map(s => s.trim())[0] : null) || "business solutions";
  return [
    `${effectiveFocusService.toLowerCase()} for ${targetAudience.toLowerCase()}`,
    `best ${effectiveFocusService.toLowerCase()} provider`,
    `${effectiveFocusService.toLowerCase()} solutions`,
  ];
};

const suggestKeywordsWithOpenAI = async (businessDetails) => {
  const { companyName, description, services, focusService, targetAudience } = businessDetails;

  // Ensure focusService is defined, fallback to first service if not specified
  const effectiveFocusService = focusService || (typeof services === 'string' ? services.split(',').map(s => s.trim())[0] : null) || "business solutions";
  console.log("Effective Focus Service:", effectiveFocusService); // Debug log

  const prompt = `
    You are an SEO expert and content strategist. Based on the following business details, provide SEO-optimized suggestions for a blog article focused EXCLUSIVELY on the specified Focus Service. Do NOT generate keywords or content related to other services unless they directly support the Focus Service. Ensure all suggestions are highly relevant to the Focus Service, tailored to the target audience, and avoid generic or unrelated terms.

    Business Details:
    - Company Name: ${companyName || 'Unknown Company'}
    - Description: ${description || 'No description provided.'}
    - Services: ${services || 'General services'}
    - Focus Service: ${effectiveFocusService} (Generate suggestions ONLY for this service: "${effectiveFocusService}". Ignore other services unless they directly support "${effectiveFocusService}")
    - Target Audience: ${targetAudience || 'general audience'}

    Provide the following, ensuring all suggestions are tailored to the Focus Service (${effectiveFocusService}):

    1. **Primary Keywords:**  
       Suggest 3 specific, high-ranking, SEO-optimized long-tail keywords (3-5 words) with realistic search volume and low competition. These keywords MUST be directly related to the Focus Service (${effectiveFocusService}) and the target audience. Do NOT include keywords related to other services like "video editing" unless the Focus Service is explicitly about video editing. Provide as a comma-separated list (e.g., "keyword 1, keyword 2, keyword 3").

    2. **Secondary Keywords:**  
       For the first primary keyword, suggest 3 closely related secondary keywords that improve topical relevance and support the article’s SEO. These should enhance LSI (latent semantic indexing) and diversify search visibility, while remaining specific to the Focus Service (${effectiveFocusService}). Provide as a comma-separated list (e.g., "secondary 1, secondary 2, secondary 3").

    3. **Key Points to Cover:**  
       Recommend 3 specific key points or subtopics to cover in the blog article to rank well for the first primary keyword. These should be unique, resonate with the target audience, address their pain points, and be specific to the Focus Service (${effectiveFocusService}). Avoid generic points like "Benefits of the service" or "How to choose the right provider". Provide as a comma-separated list (e.g., "point 1, point 2, point 3").

    4. **Unique Business Goal:**  
       Suggest a specific, actionable business goal that the company might aim to achieve through the Focus Service (${effectiveFocusService}) for the target audience (${targetAudience}). The goal should be unique to the business context and relevant to the service. Provide a single sentence (e.g., "Expand online presence through targeted digital marketing campaigns").

    5. **Specific Challenge:**  
       Suggest a specific challenge that the target audience (${targetAudience}) might face when trying to achieve the Unique Business Goal using the Focus Service (${effectiveFocusService}). The challenge should be realistic and relevant to the service and audience. Provide a single sentence (e.g., "Attracting the right audience in a saturated digital marketing landscape").

    6. **Personal Anecdote:**  
       Suggest a brief personal anecdote (1-2 sentences) that the company (${companyName}) might use to illustrate the success of their Focus Service (${effectiveFocusService}) for the target audience (${targetAudience}). The anecdote should include a specific result (e.g., percentage increase, number of new customers). Provide a single anecdote (e.g., "A small business client saw a 40% increase in website traffic after we implemented our digital marketing strategies").

    Expected Output Format:

    Primary Keywords: keyword 1, keyword 2, keyword 3
    Secondary Keywords: secondary 1, secondary 2, secondary 3
    Key Points: point 1, point 2, point 3
    Unique Business Goal: [goal]
    Specific Challenge: [challenge]
    Personal Anecdote: [anecdote]
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300, // Increased to accommodate additional fields
      temperature: 0.7,
    });

    const lines = response.choices[0].message.content.split('\n').filter(line => line.trim());
    let primaryKeywords = [];
    let secondaryKeywords = [];
    let keyPoints = [];
    let uniqueBusinessGoal = '';
    let specificChallenge = '';
    let personalAnecdote = '';

    // Robust parsing of OpenAI response
    lines.forEach(line => {
      if (line.startsWith('Primary Keywords:')) {
        primaryKeywords = line
          .replace('Primary Keywords:', '')
          .split(',')
          .map(k => k.trim())
          .filter(k => k.length > 0)
          .slice(0, 3);
      } else if (line.startsWith('Secondary Keywords:')) {
        secondaryKeywords = line
          .replace('Secondary Keywords:', '')
          .split(',')
          .map(k => k.trim())
          .filter(k => k.length > 0)
          .slice(0, 3);
      } else if (line.startsWith('Key Points:')) {
        keyPoints = line
          .replace('Key Points:', '')
          .split(',')
          .map(k => k.trim())
          .filter(k => k.length > 0)
          .slice(0, 3);
      } else if (line.startsWith('Unique Business Goal:')) {
        uniqueBusinessGoal = line.replace('Unique Business Goal:', '').trim();
      } else if (line.startsWith('Specific Challenge:')) {
        specificChallenge = line.replace('Specific Challenge:', '').trim();
      } else if (line.startsWith('Personal Anecdote:')) {
        personalAnecdote = line.replace('Personal Anecdote:', '').trim();
      }
    });

    // Validate parsed data
    if (!primaryKeywords.length || !secondaryKeywords.length || !keyPoints.length || !uniqueBusinessGoal || !specificChallenge || !personalAnecdote) {
      console.warn("OpenAI response incomplete, falling back to heuristic values.");
      const heuristicKeywords = suggestKeywords(businessDetails);
      const dynamicKeyPoints = [
        `How ${effectiveFocusService} enhances your online presence`,
        `Latest strategies in ${effectiveFocusService} for ${targetAudience?.toLowerCase() || 'general audience'}`,
        `Why ${targetAudience?.toLowerCase() || 'general audience'} should invest in ${effectiveFocusService}`,
      ];
      const fallbackUniqueBusinessGoal = `Increase ${effectiveFocusService.toLowerCase()} ROI for ${targetAudience?.toLowerCase() || 'general audience'}`;
      const fallbackSpecificChallenge = `Standing out in a competitive ${effectiveFocusService.toLowerCase()} market for ${targetAudience?.toLowerCase() || 'general audience'}`;
      const fallbackPersonalAnecdote = `A ${targetAudience?.toLowerCase() || 'general audience'} client achieved a 30% increase in engagement after using our ${effectiveFocusService.toLowerCase()} services`;

      return {
        primaryKeywords: primaryKeywords.length ? primaryKeywords : heuristicKeywords,
        secondaryKeywords: secondaryKeywords.length ? secondaryKeywords : heuristicKeywords.slice(1),
        keyPoints: keyPoints.length ? keyPoints : dynamicKeyPoints,
        uniqueBusinessGoal: uniqueBusinessGoal || fallbackUniqueBusinessGoal,
        specificChallenge: specificChallenge || fallbackSpecificChallenge,
        personalAnecdote: personalAnecdote || fallbackPersonalAnecdote,
      };
    }

    return {
      primaryKeywords,
      secondaryKeywords,
      keyPoints,
      uniqueBusinessGoal,
      specificChallenge,
      personalAnecdote,
    };
  } catch (error) {
    console.error("Error with OpenAI keyword suggestion:", error);
    const heuristicKeywords = suggestKeywords(businessDetails);
    const dynamicKeyPoints = [
      `How ${effectiveFocusService} enhances your online presence`,
      `Latest strategies in ${effectiveFocusService} for ${targetAudience?.toLowerCase() || 'general audience'}`,
      `Why ${targetAudience?.toLowerCase() || 'general audience'} should invest in ${effectiveFocusService}`,
    ];
    const fallbackUniqueBusinessGoal = `Increase ${effectiveFocusService.toLowerCase()} ROI for ${targetAudience?.toLowerCase() || 'general audience'}`;
    const fallbackSpecificChallenge = `Standing out in a competitive ${effectiveFocusService.toLowerCase()} market for ${targetAudience?.toLowerCase() || 'general audience'}`;
    const fallbackPersonalAnecdote = `A ${targetAudience?.toLowerCase() || 'general audience'} client achieved a 30% increase in engagement after using our ${effectiveFocusService.toLowerCase()} services`;

    return {
      primaryKeywords: heuristicKeywords,
      secondaryKeywords: heuristicKeywords.slice(1),
      keyPoints: dynamicKeyPoints,
      uniqueBusinessGoal: fallbackUniqueBusinessGoal,
      specificChallenge: fallbackSpecificChallenge,
      personalAnecdote: fallbackPersonalAnecdote,
    };
  }
};

module.exports = { suggestKeywords, suggestKeywordsWithOpenAI };