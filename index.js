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


const socialMediaRoute = require('./routes/socialMediaContent');
const articleBlogRoute = require('./routes/articleBlogContent');



const secret = process.env.SESSION_SECRET || "secret";
const dbUrl = process.env.DB_URL || "mongodb://127.0.0.1:27017/aicontentgenerator";
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
        res.redirect("/social-media/branding-social");
    } else if (contentType === "article") {
        res.redirect("/blog-article/branding-article");
    } else {
        res.redirect("/select-content");
    }
});







app.get("/select-content", (req, res) => {
  res.render("select-content");
});



app.use('/social-media', socialMediaRoute);
app.use('/blog-article', articleBlogRoute);


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
