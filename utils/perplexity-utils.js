const axios = require("axios");

// In-memory cache to avoid repeat requests
const cache = new Map();

const perplexityApi = axios.create({
  baseURL: "https://api.perplexity.ai",
  headers: {
    Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json",
  },
});

async function fetchFromPerplexity(query) {
  if (cache.has(query)) return cache.get(query);

  try {
    const response = await perplexityApi.post("/chat/completions", {
      model: "sonar-pro",
      messages: [{ role: "user", content: query }],
      max_tokens: 100,
      temperature: 0.7,
    });

    const result = response.data.choices[0].message.content.trim().split("\n");
    cache.set(query, result);
    return result;
  } catch (err) {
    console.error("Perplexity Fetch Error:", err.message);
    return ["default format"];
  }
}

module.exports = { fetchFromPerplexity };
