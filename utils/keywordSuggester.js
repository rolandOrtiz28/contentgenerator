const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const suggestKeywordsWithOpenAI = async (businessDetails) => {
  const { companyName, description, services, focusService, targetAudience } = businessDetails;

  const prompt = `
    You are an SEO expert. Based on the following business details, provide SEO-optimized suggestions for a blog article focused on the specified Focus Service. Ensure the suggestions are unique, highly relevant to the Focus Service, and avoid repetition or generic terms.

    Business Details:
    - Company Name: ${companyName}
    - Description: ${description}
    - Services: ${services}
    - Focus Service: ${focusService || 'Not specified'} (Generate suggestions specifically for this service)
    - Target Audience: ${targetAudience}

    Provide the following, ensuring all suggestions are tailored to the Focus Service and avoid overly generic terms like "services" or "multimedia":

    1. **Primary Keywords:**  
       Suggest 3 specific, high-ranking, SEO-optimized long-tail keywords (3-5 words) with realistic search volume and low competition. These keywords must be directly related to the Focus Service and the target audience. Provide as a comma-separated list (e.g., "keyword 1, keyword 2, keyword 3").

    2. **Secondary Keywords:**  
       For the first primary keyword, suggest 3 closely related secondary keywords that improve topical relevance and support the article’s SEO. These should enhance LSI (latent semantic indexing) and diversify search visibility. Provide as a comma-separated list (e.g., "secondary 1, secondary 2, secondary 3").

    3. **Key Points to Cover:**  
       Recommend 3 specific key points or subtopics to cover in the blog article to rank well for the first primary keyword. These should be unique, resonate with the target audience, address their pain points, and be specific to the Focus Service. Avoid generic points like "Benefits of the service" or "How to choose the right provider". Provide as a comma-separated list (e.g., "point 1, point 2, point 3").

    Expected Output Format:

    Primary Keywords: keyword 1, keyword 2, keyword 3
    Secondary Keywords: secondary 1, secondary 2, secondary 3
    Key Points: point 1, point 2, point 3
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.8, // Increased to introduce more variability
    });

    const lines = response.choices[0].message.content.split('\n').filter(line => line.trim());
    let primaryKeywords = [];
    let secondaryKeywords = [];
    let keyPoints = [];

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
      }
    });

    // Fallback to heuristic if OpenAI fails
    if (primaryKeywords.length === 0 || secondaryKeywords.length === 0 || keyPoints.length === 0) {
      const heuristicKeywords = suggestKeywords(businessDetails);
      // Provide more dynamic key points based on focusService
      const dynamicKeyPoints = [
        `How ${focusService || 'the service'} improves your brand`,
        `Top trends in ${focusService || 'the service'} for ${targetAudience.toLowerCase()}`,
        `Why ${targetAudience.toLowerCase()} need ${focusService || 'this service'}`,
      ];
      return {
        primaryKeywords: heuristicKeywords,
        secondaryKeywords: heuristicKeywords.slice(1),
        keyPoints: dynamicKeyPoints,
      };
    }

    return {
      primaryKeywords,
      secondaryKeywords,
      keyPoints,
    };
  } catch (error) {
    console.error("Error with OpenAI keyword suggestion:", error);
    const heuristicKeywords = suggestKeywords(businessDetails);
    // Provide more dynamic key points based on focusService
    const dynamicKeyPoints = [
      `How ${focusService || 'the service'} improves your brand`,
      `Top trends in ${focusService || 'the service'} for ${targetAudience.toLowerCase()}`,
      `Why ${targetAudience.toLowerCase()} need ${focusService || 'this service'}`,
    ];
    return {
      primaryKeywords: heuristicKeywords,
      secondaryKeywords: heuristicKeywords.slice(1),
      keyPoints: dynamicKeyPoints,
    };
  }
};

// Existing heuristic function as a fallback (updated for better key points)
const suggestKeywords = (businessDetails) => {
  const { companyName, description, services, focusService, targetAudience } = businessDetails;

  const serviceList = services ? services.split(',').map(s => s.trim()) : [];
  const focus = focusService || serviceList[0] || 'services';

  const descriptionWords = description
    ? description.toLowerCase().split(/\s+/)
    : [];
  const meaningfulWords = descriptionWords.filter(word => 
    word.length > 3 && !['this', 'that', 'with', 'from', 'about'].includes(word)
  );

  let keywords = [
    `${focus} for ${targetAudience.toLowerCase()}`,
    `${companyName.toLowerCase()} ${focus}`,
    `${focus} solutions`,
  ];

  if (meaningfulWords.length > 0) {
    keywords.push(`${focus} ${meaningfulWords[0]}`);
    keywords.push(`${meaningfulWords[0]} ${targetAudience.toLowerCase()}`);
  }

  keywords.push(`best ${focus} provider`);
  keywords.push(`top ${focus} for ${targetAudience.toLowerCase()}`);
  keywords.push(`how to find ${focus}`);

  return [...new Set(keywords)]
    .filter(k => k.length > 5 && k.split(' ').length <= 4)
    .slice(0, 5);
};

module.exports = { suggestKeywords, suggestKeywordsWithOpenAI };