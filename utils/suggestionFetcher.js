const { OpenAI } = require("openai");
const axios = require("axios");

const perplexityApi = axios.create({
  baseURL: "https://api.perplexity.ai",
  headers: {
    Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json",
  },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Fallback-enabled SEO fetcher
 * @param {string} prompt - The prompt for Perplexity or OpenAI
 * @param {boolean} usePro - Whether to use sonar-pro or sonar
 */
const getSEOSuggestionsWithFallback = async (prompt, usePro = false) => {
  const model = usePro ? "sonar-pro" : "sonar";
  console.log(`🚀 [PERPLEXITY] Using model: ${model}`);
  console.log("📝 Prompt:\n", prompt);

  try {
    const response = await perplexityApi.post("/chat/completions", {
      model,
      messages: [
        {
          role: "system",
          content: "Provide analysis or data based on input. Use plain text, no formatting.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });
    const content = response.data.choices[0].message.content.trim();
    const tokenUsage = {
      model,
      module: "seo",
      promptTokens: response.data.usage?.prompt_tokens || 0,
      completionTokens: response.data.usage?.completion_tokens || 0,
      totalTokens: response.data.usage?.total_tokens || 0,
    };

    console.log("✅ [PERPLEXITY] Token usage:", tokenUsage);
    console.log("📄 [PERPLEXITY] Response:\n", content);
    return {
      source: usePro ? "perplexity-sonar-pro" : "perplexity-sonar",
      text: response.data.choices[0].message.content.trim(),
      tokenUsage,
      
    };
  } catch (error) {
    console.warn(`⚠️ Perplexity (${usePro ? "Pro" : "Sonar"}) failed:`, error.message);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an SEO and content analysis expert. Respond in plain text, no markdown, with key-value pairs separated by newlines (e.g., key: value).",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const content = response?.choices?.[0]?.message?.content?.trim() || "";
      console.log("✅ OpenAI Fallback Content:\n", content);
      const fallbackTokenUsage = {
        model: "gpt-4o",
        module: "seo",
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      };

      console.log("✅ [OpenAI Fallback] Token usage:", fallbackTokenUsage);
      console.log("📄 [OpenAI Fallback] Response:\n", content);

      return {
        source: "openai",
        text: content,
        tokenUsage: fallbackTokenUsage,
      };
    } catch (openaiError) {
      console.error("❌ OpenAI Fallback Failed:", openaiError);
      return { source: "openai", text: "" };
    }
  }
};

// Social media fallback (still uses sonar-pro by default)
const getSuggestionsWithFallback = async (prompt) => {
  try {
    const response = await perplexityApi.post("/chat/completions", {
      model: "sonar",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.7,
    });

    return {
      source: "perplexity-sonar",
      text: response.data.choices[0].message.content.trim(),
      tokenUsage: {
        model: "sonar",
        module: "keyword", // <- manually set per usage
        promptTokens: response.data.usage?.prompt_tokens || 0,
        completionTokens: response.data.usage?.completion_tokens || 0,
        totalTokens: response.data.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    console.warn("⚠️ Perplexity failed, falling back to OpenAI:", error.message);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a social media strategist. Respond in plain text only with exactly 2 sections: 'Key Messages:' followed by 3 bullet points, and 'Specific AI Instruction:'.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 250,
        temperature: 0.7,
      });

      const content = response?.choices?.[0]?.message?.content?.trim() || "";
      console.log("✅ OpenAI Fallback Content:\n", content);

      return {
        source: "openai",
        text: content,
        tokenUsage: {
          model: "gpt-4o",
          module: "keyword",
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (openaiError) {
      console.error("❌ OpenAI Fallback Failed:", openaiError);
      return { source: "openai", text: "" };
    }
  }
};

module.exports = {
  getSuggestionsWithFallback,
  getSEOSuggestionsWithFallback,
};
