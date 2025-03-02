
const express = require('express');
const router = express.Router();
const OpenAI = require("openai");



router.get("/branding-article", (req, res) => {
    res.render("branding-article");
  });
  
  
  
  
  
  
  
  router.post("/generate-content-article", async (req, res) => {
    const { companyName, audience, brandTone, keyword } = req.body;
  
    let prompt = `
    Generate an SEO-optimized blog article based on the following details:
    - **Company Name:** ${companyName}
    - **Target Audience:** ${audience}
    - **Brand Tone:** ${brandTone}
    - **Primary SEO Keyword:** ${keyword}
  
    Follow **Ahrefs SEO guidelines** and include:
    - **Title:** A compelling blog title using the keyword.
    - **Meta Description:** A short, keyword-optimized description.
    - **Headings & Subheadings:** Well-structured content with keyword placement.
    - **Content:** Engaging, informative, and well-formatted.
    - **Call to Action (CTA):** A clear CTA to drive action.
    - **FAQs:** Commonly asked questions related to the topic.
  
    Format the response like this:
    - **Title:** 
    - **Meta Description:** 
    - **Headings & Content:** 
    - **FAQs:** 
    - **CTA:** 
    `;
  
    try {
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 700,
            temperature: 0.7,
        });
  
        const generatedArticle = aiResponse.choices[0].message.content.trim();
  
        res.render("generated-article", { content: generatedArticle });
    } catch (error) {
        console.error("Error generating AI content:", error);
        res.status(500).send("Error generating content.");
    }
  });
  
  
  
  module.exports = router;