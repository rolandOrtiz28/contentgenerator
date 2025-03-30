// suggestionFetcher.js
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

// Existing social media fallback
const getSuggestionsWithFallback = async (prompt) => {
  try {
    const response = await perplexityApi.post("/chat/completions", {
      model: "sonar-pro",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.7,
    });

    return {
      source: "perplexity",
      text: response.data.choices[0].message.content.trim(),
    };
  } catch (error) {
    console.warn("⚠️ Perplexity failed, falling back to OpenAI:", error.message);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a social media strategist. Respond in plain text only with exactly 2 sections: 'Key Messages:' followed by 3 short bullet points (3–5 words each), and 'Specific AI Instruction:' followed by one full sentence. No other explanation.",
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
      };
    } catch (openaiError) {
      console.error("❌ OpenAI Fallback Failed:", openaiError);
      return { source: "openai", text: "" };
    }
  }
};

// New SEO-specific fallback
const getSEOSuggestionsWithFallback = async (prompt) => {
  try {
    const response = await perplexityApi.post("/chat/completions", {
      model: "sonar-pro",
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

    return {
      source: "perplexity",
      text: response.data.choices[0].message.content.trim(),
    };
  } catch (error) {
    console.warn("⚠️ Perplexity failed, falling back to OpenAI for SEO:", error.message);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are an SEO and content analysis expert. Respond in plain text, no markdown, with key-value pairs separated by newlines (e.g., key: value) matching the requested format.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const content = response?.choices?.[0]?.message?.content?.trim() || "";
      console.log("✅ OpenAI SEO Fallback Content:\n", content);

      return {
        source: "openai",
        text: content,
      };
    } catch (openaiError) {
      console.error("❌ OpenAI SEO Fallback Failed:", openaiError);
      return { source: "openai", text: "" };
    }
  }
};

module.exports = { getSuggestionsWithFallback, getSEOSuggestionsWithFallback };