require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");

// Routes
app.get("/", (req, res) => {
  res.render("home");
});

app.post("/branding", (req, res) => {
    const contentType = req.body.contentType;
    res.render("branding", { contentType });
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
  

app.get("/select-content", (req, res) => {
  res.render("select-content");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
