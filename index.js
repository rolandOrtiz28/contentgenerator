require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");
const OpenAI = require("openai");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const app = express();
const PORT = 3000;

// Middleware
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

  // If no topic is provided, generate suggested topics first
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

          // Render a new page where the user can select a topic
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

  // If a topic was already selected, proceed with content generation
  generateSocialMediaContent(res, {
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

async function generateSocialMediaContent(res, data) {
    const { companyName, description, targetAudience, services, socialMediaType, colorCombination, brandTone, purpose, topic, theme, adDetails } = data;

    let adDetailsText = "";
    if (theme === "Advertising" && adDetails) {
        adDetailsText = `This campaign is specifically promoting: ${adDetails}`;
    }

    let prompt = `
Generate a **structured ${socialMediaType} post** for social media based on:
- **Company Name:** ${companyName}
- **Description:** ${description}
- **Target Audience:** ${targetAudience}
- **Services Provided:** ${services}
- **Topic:** ${topic}
- **Theme:** ${theme}
- **Purpose:** ${purpose}
- **Brand Tone:** ${brandTone}
- **Color Combination:** ${colorCombination}
- **Additional Details:** ${adDetailsText}

The content **must** include the following:
1️⃣ **Topic:** A catchy and relevant topic.
2️⃣ **Caption:** A short, engaging caption that is friendly and conversational.
3️⃣ **Hashtags:** Exactly **3-4 relevant hashtags**.
4️⃣ **Text for Visuals:** 
    - **Heading:** A powerful one-liner that captures attention.
    - **Subheading:** A short supporting statement.
    - **Bullet Points:** (Optional) If necessary, add 2-3 concise bullet points.
5️⃣ **CTA (Call to Action):** Provide **exactly 2 CTA options** (each max **5 words**).


💡 **Important Rules**:
- Keep the caption **natural and engaging** (avoid robotic phrasing).
- CTA should **be action-oriented and under 5 words**.
- Use **only 3-4 hashtags** (if they are not already in the caption).
- **Avoid generic marketing language.** Write like a social media marketer, not AI.
`;

    try {
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 400,
            temperature: 0.8,
        });

        const generatedContent = aiResponse.choices[0].message.content.trim();

        // 🔹 Extract structured data using regex
        const topicMatch = generatedContent.match(/\*\*Topic:\*\*\s*(.+)/);
        const captionMatch = generatedContent.match(/\*\*Caption:\*\*\s*(.+)/);
        const hashtagsMatch = generatedContent.match(/\*\*Hashtags:\*\*\s*(.+)/);
        const headingMatch = generatedContent.match(/\*\*Heading:\*\*\s*(.+)/);
        const subheadingMatch = generatedContent.match(/\*\*Subheading:\*\*\s*(.+)/);
        const bulletPointsMatch = generatedContent.match(/\*\*Bullet Points:\*\*\s*(.+)/);
        const ctaMatch = generatedContent.match(/\*\*CTA Options:\*\*\s*(.+)/);

        const extractedContent = {
            topic: topicMatch ? topicMatch[1].trim() : "No topic found.",
            caption: captionMatch ? captionMatch[1].trim() : "No caption generated.",
            hashtags: hashtagsMatch ? hashtagsMatch[1].trim() : "No hashtags available.",
            heading: headingMatch ? headingMatch[1].trim() : "",
            subheading: subheadingMatch ? subheadingMatch[1].trim() : "",
            bulletPoints: bulletPointsMatch ? bulletPointsMatch[1].trim() : "",
            cta: ctaMatch ? ctaMatch[1].trim() : "No CTA available.",
        };

        console.log("✅ Extracted AI Content:", extractedContent);

        // 🔹 Pass extracted values to EJS template
        res.render("generated-social", {
            companyName,
            socialMediaType,
            caption: extractedContent.caption,
            hashtags: extractedContent.hashtags,
            heading: extractedContent.heading,
            subheading: extractedContent.subheading,
            bulletPoints: extractedContent.bulletPoints,
            cta: extractedContent.cta,
        });

    } catch (error) {
        console.error("❌ Error generating AI content:", error);
        res.status(500).send("Error generating content.");
    }
}




// app.post("/generate-content-article", async (req, res) => {
//   const { companyName, audience, brandTone, keyword } = req.body;

//   let prompt = `
//   Generate an SEO-optimized blog article based on the following details:
//   - **Company Name:** ${companyName}
//   - **Target Audience:** ${audience}
//   - **Brand Tone:** ${brandTone}
//   - **Primary SEO Keyword:** ${keyword}

//   Follow **Ahrefs SEO guidelines** and include:
//   - **Title:** A compelling blog title using the keyword.
//   - **Meta Description:** A short, keyword-optimized description.
//   - **Headings & Subheadings:** Well-structured content with keyword placement.
//   - **Content:** Engaging, informative, and well-formatted.
//   - **Call to Action (CTA):** A clear CTA to drive action.
//   - **FAQs:** Commonly asked questions related to the topic.

//   Format the response like this:
//   - **Title:** 
//   - **Meta Description:** 
//   - **Headings & Content:** 
//   - **FAQs:** 
//   - **CTA:** 
//   `;

//   try {
//       const aiResponse = await openai.chat.completions.create({
//           model: "gpt-4",
//           messages: [{ role: "user", content: prompt }],
//           max_tokens: 700,
//           temperature: 0.7,
//       });

//       const generatedArticle = aiResponse.choices[0].message.content.trim();

//       res.render("generated-article", { content: generatedArticle });
//   } catch (error) {
//       console.error("Error generating AI content:", error);
//       res.status(500).send("Error generating content.");
//   }
// });

app.post("/generate-content-article", async (req, res) => {
  const { companyName, audience, brandTone, keyword } = req.body;

  let prompt = `
  Generate an SEO-optimized blog article based on:
  - **Company Name:** ${companyName}
  - **Target Audience:** ${audience}
  - **Brand Tone:** ${brandTone}
  - **Primary SEO Keyword:** ${keyword}

  The article should include **only one word per section** for testing.

  Format:
  - **Title:** [1 word]
  - **Meta Description:** [1 word]
  - **Headings:** [1 word each]
  - **Content:** [1 word per section]
  - **FAQs:** [1 word]
  - **CTA:** [1 word]
  `;

  try {
      const aiResponse = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 50,
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

      console.log("Extracted Full HTML (First 500 Characters):", html.substring(0, 500));

      // Load HTML into Cheerio
      const $ = cheerio.load(html);

      // Extract company name
      const companyName = $("title").first().text().trim() || "Unknown Company";
      console.log("Extracted Company Name:", companyName);

      // Extract meta description
      let description = $('meta[name="description"]').attr("content") || "";

      // Backup: Extract first relevant paragraph
      if (!description || description.toLowerCase().includes("default blog description")) {
          console.log("🚨 Default or Missing Description - Extracting from content...");
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

      console.log("Final Business Description:", description);

      // Extract specific services
      let services = extractServices($);
      if (!services) {
          services = "No services found.";
      }

      console.log("Extracted Services:", services);

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





// Route to display generated blog article
app.get("/generated-social", (req, res) => {
    res.render("generated-social", { 
        companyName: "EditEdge Multimedia",
        socialMediaType: "Post",
        caption: "Default sample caption for testing.",
        hashtags: "#Default #Hashtags #ForTest",
        cta: "Check it out! | Learn more!",
    });
});




app.get("/select-content", (req, res) => {
  res.render("select-content");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
