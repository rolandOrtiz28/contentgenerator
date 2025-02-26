require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");
const OpenAI = require("openai");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const session = require("express-session");
const app = express();
const PORT = 3000;
const MongoDBStore = require("connect-mongodb-session")(session);
const mongoose = require("mongoose");




const secret = process.env.SESSION_SECRET || "secret";
const dbUrl = process.env.DB_URL || "mongodb://127.0.0.1:27017/bluelightinnovations";
// Middleware
mongoose.connect(dbUrl, {
    serverSelectionTimeoutMS: 5000, // Adjust as needed
  });
  
  const db = mongoose.connection;
  db.on("error", console.error.bind(console, "Connection error:"));
  db.once("open", () => {
    console.log("✅ Database Connected");
  });
  
  // 🔹 Configure MongoDB session storage
  const store = new MongoDBStore({
    uri: dbUrl,
    collection: "sessions",
    touchAfter: 24 * 3600, // Save session once per 24 hours
  });
  
  store.on("error", (error) => {
    console.error("❌ Session Store Error:", error);
  });
  
  // 🔹 Configure session
  const sessionConfig = {
    secret,
    name: "_bluelight", // Custom session cookie name
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
      httpOnly: true, // Prevent client-side access
      secure: false, // Change to `true` if using HTTPS
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 1 week
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  };
  
  // 🔹 Apply session middleware
  app.use(session(sessionConfig));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
// Routes
app.get("/", (req, res) => {
  res.render("home");
});



  app.post("/select-branding", (req, res) => {
    const contentType = req.body.contentType;
    
    if (contentType === "social") {
        res.redirect("/branding-social");
    } else if (contentType === "article") {
        res.redirect("/branding-article");
    } else {
        res.redirect("/select-content");
    }
});

  app.post('/generate-content', async (req, res) => {
    const { colorCombination, brandTone, purpose } = req.body;

    try {
        const prompt = `Create a ${brandTone} social media post for a brand using ${colorCombination} colors. The purpose is: ${purpose}.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
        });

        const generatedContent = response.choices[0].message.content;

        res.render('branding-result', { content: generatedContent });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error generating content.");
    }
});
  

app.get("/branding-social", (req, res) => {
  res.render("branding-social");
});

app.get("/branding-article", (req, res) => {
  res.render("branding-article");
});

app.post("/generate-content-social", async (req, res) => {
  const { 
      companyName, 
      description, 
      targetAudience, 
      services, 
      socialMediaType, 
      colorCombination,  
      brandTone, 
      purpose, 
      topic, 
      theme, 
      adDetails 
  } = req.body;

  if (!topic) {
      console.log("🚀 No topic provided - Generating AI-suggested topics...");
      const topicPrompt = `Suggest 5 topic ideas for a ${socialMediaType} about ${companyName} and its services (${services}).`;
      try {
          const topicResponse = await openai.chat.completions.create({
              model: "gpt-4",
              messages: [{ role: "user", content: topicPrompt }],
              max_tokens: 300,
              temperature: 0.7,
          });

          const suggestedTopics = topicResponse.choices[0].message.content.trim().split("\n");
          console.log("✅ Suggested Topics:", suggestedTopics);

          return res.render("select-topic", { 
              companyName, 
              description, 
              targetAudience, 
              services, 
              socialMediaType, 
              colorCombination,  
              brandTone, 
              purpose, 
              theme, 
              adDetails,
              suggestedTopics 
          });
      } catch (error) {
          console.error("❌ Error generating AI topics:", error);
          return res.status(500).send("Error generating suggested topics.");
      }
  }

  generateSocialMediaContent(req, res, {
      companyName, 
      description, 
      targetAudience, 
      services, 
      socialMediaType, 
      colorCombination,  
      brandTone, 
      purpose, 
      topic, 
      theme, 
      adDetails
  });
});

async function generateSocialMediaContent(req, res, data) {
  const { companyName, description, targetAudience, services, socialMediaType, colorCombination, brandTone, purpose, topic, theme, adDetails } = data;

  if (!data || Object.keys(data).length === 0) {
      console.error("❌ Error: `data` is missing or empty!");
      return res.status(400).send("❌ Error: No data provided for content generation.");
  }
  if (!socialMediaType) {
      console.error("❌ Error: `socialMediaType` is missing!");
      return res.status(400).send("❌ Error: Please select a social media type.");
  }

  console.log("✅ Generating content for:", socialMediaType);

  let prompt = `
  🚀 **Generate a Social Media Post/Reel for ${companyName}**
  - AI **must provide all required fields** in the **exact format below**.
  - If any field is missing, **regenerate the content until all fields are complete**.
  - **For reels/stories, AI must provide at least 3-4 scenes**.
  - Each **scene must have a corresponding text on screen**.
  - Avoid robotic, overly structured writing—make it natural, human, and engaging.
  - Match the brand's tone: "${brandTone}".
  
  🌟 **Brand & Content Details**:
  - **Topic:** ${topic}
  - **Description:** ${description}
  - **Services:** ${services}
  - **Target Audience:** ${targetAudience}
  - **Purpose:** ${purpose}
  - **Brand Tone:** ${brandTone}
  - **Theme:** ${theme}
  - **Color Combination:** ${colorCombination}
  - **Additional Details:** ${adDetails}
  
  📌 **FORMAT YOUR RESPONSE EXACTLY LIKE THIS:**  
  `;
  
  if (socialMediaType === "post") {
      prompt += `
  ---
  **Topic:** [Write Topic Here]  
  **Description:** [Write Description Here]  
  **Services:** [Write Services Here]  
  **Caption:** [Write Caption Here]  
  **Hashtags:** [Write Hashtags Here]  
  **CTA Options:** [1] [Write CTA 1] | [2] [Write CTA 2]  
  **Texts on Poster:** [Write Poster Text Here]  
  **Assets:** [Write Assets Here]  
  ---
  `;
  } else if (socialMediaType === "reel" || socialMediaType === "story") {
      prompt += `
  ---
  **Topic:** [Write Topic Here]  
  **Description:** [Write Description Here]  
  **Services:** [Write Services Here]  
  **Video Concept:** [Describe the video concept in 2-3 sentences]  
  **Caption:** [Write Caption Here]  
  **Hashtags:** [Write Hashtags Here]  
  **CTA Options:** [1] [Write CTA 1] | [2] [Write CTA 2]  
  **Video Script & Structure:**  
  - **Scene 1:** [Describe Scene 1]  
  - **Scene 2:** [Describe Scene 2]  
  - **Scene 3:** [Describe Scene 3]  
  - **Scene 4 (Optional):** [Describe Scene 4]  
  **Text on Screen:**  
  - **Scene 1:** [Write Text for Scene 1]  
  - **Scene 2:** [Write Text for Scene 2]  
  - **Scene 3:** [Write Text for Scene 3]  
  - **Scene 4 (Optional):** [Write Text for Scene 4]  
  **Video Assets:** [Describe assets to use, e.g., icons, branding elements]  
  **Texts on Poster:** [Not applicable for this format]  
  ---
  `;
  }
  
  prompt += `
  📌 **If a field is missing, regenerate the content!**
  🚨 AI MUST FOLLOW THIS STRUCTURE EXACTLY.
  `;

  let generatedContent;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
      try {
          const aiResponse = await openai.chat.completions.create({
              model: "gpt-4",
              messages: [{ role: "user", content: prompt }],
              max_tokens: 800,
              temperature: 1.0, 
              presence_penalty: 0.7,
              frequency_penalty: 0.5
          });

          generatedContent = aiResponse.choices[0].message.content.trim();
          console.log("✅ AI Raw Response:\n", generatedContent);

          // Helper function to extract text using regex
          const extractText = (pattern, content, fallback) => {
              const match = content.match(new RegExp(pattern, "i"));
              return match ? match[1].trim() : fallback;
          };

          // Extract scenes and text on screen with improved regex
          const scenePattern = /- \*\*Scene \d:\*\* (.+)/g;
          const textPattern = /- \*\*Scene \d:\*\* (.+)/g;

          const scenes = [...generatedContent.matchAll(scenePattern)].map(match => match[1].trim());
          const textOnScreen = [...generatedContent.matchAll(textPattern)].map(match => match[1].trim());

          // Ensure at least 3 scenes and corresponding texts are present
          if ((socialMediaType === "reel" || socialMediaType === "story") && (scenes.length < 3 || textOnScreen.length < 3)) {
              console.warn(`⚠️ Warning: Insufficient scenes (${scenes.length}) or text on screen (${textOnScreen.length}) detected. Regenerating...`);
              attempts++;
              continue; // Regenerate if scenes or text are insufficient
          }

          // Extract other fields
          const extractedContent = {
              companyName,
              socialMediaType,
              topic: extractText("\\*\\*Topic:?\\*\\*\\s*(.+)", generatedContent, "Missing topic"),
              description: extractText("\\*\\*Description:?\\*\\*\\s*(.+)", generatedContent, "Missing description"),
              services: extractText("\\*\\*Services:?\\*\\*\\s*(.+)", generatedContent, "Missing services"),
              caption: extractText("\\*\\*Caption:?\\*\\*\\s*(.+)", generatedContent, "Missing caption"),
              hashtags: extractText("\\*\\*Hashtags:?\\*\\*\\s*(.+)", generatedContent, "Missing hashtags"),
              cta: extractText("\\*\\*CTA(?: Options)?:?\\*\\*\\s*(.+)", generatedContent, "Missing CTA"),
              posterText: extractText("\\*\\*Texts? on Poster:?\\*\\*\\s*(.+)", generatedContent, "Not applicable for this format"),
              assets: extractText("\\*\\*Assets:?\\*\\*\\s*(.+)", generatedContent, "Missing assets"),
              videoConcept: extractText("\\*\\*Video Concept:?\\*\\*\\s*(.+)", generatedContent, "Missing video concept"),
              script: scenes.length >= 3 ? scenes.join("\n") : "Missing required scenes",
              textOnScreen: textOnScreen.length >= 3 ? textOnScreen.join("\n") : "Missing text for scenes",
              videoAssets: extractText("\\*\\*Video Assets:?\\*\\*\\s*(.+)", generatedContent, "Missing video assets")
          };

          console.log("✅ Extracted Content:", extractedContent);

          // Check for missing fields (excluding posterText for reels/stories as it’s not applicable)
          const requiredFields = socialMediaType === "post" 
              ? ["topic", "description", "services", "caption", "hashtags", "cta", "posterText", "assets"]
              : ["topic", "description", "services", "caption", "hashtags", "cta", "videoConcept", "script", "textOnScreen", "videoAssets"];
          
          const missingFields = requiredFields.filter(key => !extractedContent[key] || extractedContent[key].includes("Missing"));
          if (missingFields.length > 0) {
              console.warn(`⚠️ Warning: AI response is missing fields: ${missingFields.join(", ")}`);
              attempts++;
              if (attempts < maxAttempts) continue; // Regenerate if fields are missing
          }

          // Store the generated content in the session with posterText always included
          const sessionContent = {
              companyName,
              socialMediaType,
              topic: extractedContent.topic,
              description: extractedContent.description,
              services: extractedContent.services,
              caption: extractedContent.caption,
              hashtags: extractedContent.hashtags,
              cta: extractedContent.cta,
              posterText: extractedContent.posterText, // Always include posterText
              assets: extractedContent.assets,
              videoConcept: extractedContent.videoConcept,
              script: extractedContent.script,
              textOnScreen: extractedContent.textOnScreen,
              videoAssets: extractedContent.videoAssets
          };

          req.session.generatedContent = sessionContent;
          console.log("✅ Session Content Stored:", req.session.generatedContent);

          res.redirect("/generated-social");
          return; // Exit the function successfully

      } catch (error) {
          console.error("❌ Error generating AI content:", error);
          attempts++;
          if (attempts < maxAttempts) continue; // Retry on error
      }
  }

  // If all attempts fail, return an error
  console.error("❌ Failed to generate valid content after all attempts.");
  res.status(500).send("Error generating content after multiple attempts.");
}




app.post("/generate-content-article", async (req, res) => {
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



app.get("/extract-branding", async (req, res) => {
  const websiteURL = req.query.website;

  if (!websiteURL) {
      return res.status(400).send("Website URL is required.");
  }

  try {
      console.log("Fetching website data with Puppeteer...");
      
      // Launch Puppeteer
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();

      // Set user-agent to mimic real browsing behavior
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

      // Navigate to the website and wait for the content to load
      await page.goto(websiteURL, { waitUntil: "domcontentloaded", timeout: 45000 });

      // Extract the fully rendered HTML
      const html = await page.content();
      await browser.close();

      

      // Load HTML into Cheerio
      const $ = cheerio.load(html);

      // Extract company name
      const companyName = $("title").first().text().trim() || "Unknown Company";
      

      // Extract meta description
      let description = $('meta[name="description"]').attr("content") || "";

      // Backup: Extract first relevant paragraph
      if (!description || description.toLowerCase().includes("default blog description")) {
        
          $("p, h2, h3").each((index, element) => {
              const text = $(element).text().trim();
              if (!/terms of service|privacy policy|cookies|disclaimer|about us|faq/i.test(text) && text.length > 20) {
                  description = text;
                  return false; // Stop loop once found
              }
          });
      }

      // If still no description, assign a default message
      if (!description) {
          description = "No description available.";
      }

      

      // Extract specific services
      let services = extractServices($);
      if (!services) {
          services = "No services found.";
      }

   

      res.render("branding-social-details", { 
        companyName: companyName || "Input Your Company Name", 
        description: description || "Describe Your Company", 
        services: services || "What are the services you offer?" 
    });

  } catch (error) {
      console.error("Error extracting website data:", error);
      res.render("branding-social-details", { companyName: "Error", description: "No description available.", services: "No services found." });
  }
});

// ✅ Improved `extractServices` Function (Prevents Empty Values)
function extractServices($) {
  let servicesList = [];

  // Extract list items with service-related words
  $("ul, ol").each((index, element) => {
      $(element).find("li").each((i, li) => {
          const text = $(li).text().trim();
          if (/service|solution|specialize|offer|expertise|industries|products|what we do/i.test(text) && text.length < 100) {
              servicesList.push(text);
          }
      });
  });

  // If no services found, check paragraph sections
  if (servicesList.length === 0) {
      $("p, div").each((index, element) => {
          const text = $(element).text().trim();
          if (/we offer|our services include|we provide|specializing in|we specialize/i.test(text) && text.length < 150) {
              servicesList.push(text);
          }
      });
  }

  // Remove duplicates and filter out irrelevant text
  servicesList = [...new Set(servicesList)]
    .filter(text => !/terms of service|privacy policy|about us|faq/i.test(text))
    .slice(0, 5); // Limit to 5 services

  console.log("Final Filtered Services:", servicesList);

  return servicesList.length > 0 ? servicesList.join(", ") : "No services found.";
}





app.post("/branding-social-details", async (req, res) => {
  const { hasWebsite, companyWebsite, companyName, targetAudience, services,description } = req.body;

  if (hasWebsite === "yes" && companyWebsite) {
      // Extract business details from the website (this part will be built later)
      return res.redirect(`/extract-branding?website=${encodeURIComponent(companyWebsite)}`);
  } else {
      // Store manual details and proceed to branding selection
      res.render("branding-social-details", { companyName, targetAudience, services,description });
  }
});





app.get("/generated-social", (req, res) => {
    if (!req.session || !req.session.generatedContent) {
        return res.status(400).send("❌ Error: No content available. Generate a post first.");
    }

    console.log("🎯 Rendering Page with:", req.session.generatedContent);

    // ✅ Pass session data to the template
    res.render("generated-social", { ...req.session.generatedContent });
});





app.get("/select-content", (req, res) => {
  res.render("select-content");
});


app.get("/practice", (req, res) => {
  res.render("generate-content-forfix");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
