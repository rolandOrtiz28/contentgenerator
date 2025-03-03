require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");
const OpenAI = require("openai");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const session = require("express-session");
const MongoDBStore = require("connect-mongodb-session")(session);
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const xss = require("xss-clean");
const mongoSanitize = require("express-mongo-sanitize");

const socialMediaRoute = require('./routes/socialMediaContent');
const articleBlogRoute = require('./routes/articleBlogContent');

const app = express();
const PORT = process.env.PORT || 3000;

const secret = process.env.SESSION_SECRET || "default-secret-please-change-me";
const dbUrl = process.env.DB_URL || "mongodb://127.0.0.1:27017/aicontentgenerator";

const frameSrcUrls = [
  "https://js.stripe.com/",
  "https://www.sandbox.paypal.com/",
  "https://www.facebook.com/",
  "https://my.spline.design/",
  "https://drive.google.com/",
  "https://accounts.google.com/",
];

const scriptSrcUrls = [
  "https://stackpath.bootstrapcdn.com/",
  "https://cdn.jsdelivr.net/",
  "https://cdnjs.cloudflare.com/",
  "https://unpkg.com/",
  "https://kit.fontawesome.com/",
  "https://unpkg.com/@splinetool/viewer@1.9.48/build/spline-viewer.js",
  "https://unpkg.com/@splinetool/viewer@1.9.48/build/process.js",
  "https://api.tiles.mapbox.com/",
  "https://api.mapbox.com/",
  "https://code.jquery.com/",
  "https://cdn.quilljs.com/" ,
  "https://cdn.tailwindcss.com/" ,
  "https://cdn.ckeditor.com/" 
];

const styleSrcUrls = [
  "https://cdn.jsdelivr.net/",
  "https://fonts.googleapis.com/",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css",
  "https://cdnjs.cloudflare.com/",
  "https://kit-free.fontawesome.com/",
  "https://api.mapbox.com/",
  "https://api.tiles.mapbox.com/",
  "https://cdn.quilljs.com/"
];

const connectSrcUrls = [
  "https://unsplash.com/",
  "https://prod.spline.design/",
  "https://unpkg.com/",
  "https://ka-f.fontawesome.com/",
  "https://fonts.gstatic.com/",
  "https://api.mapbox.com/",
  "https://a.tiles.mapbox.com/",
  "https://b.tiles.mapbox.com/",
  "https://events.mapbox.com/",
  "blob:",
];

const imgSrcUrls = [
  "https://images.unsplash.com/",
  "https://app.spline.design/_assets/_icons/icon_favicon32x32.png",
  "https://cdn.jsdelivr.net/",
  "https://kit-free.fontawesome.com/",
  "https://cdnjs.cloudflare.com/",
  "https://res.cloudinary.com/" ,
  "https://media.istockphoto.com/" ,
  "https://plus.unsplash.com/" ,
  "https://mdbcdn.b-cdn.net/" ,
  
];

const fontSrcUrls = [
  "https://fonts.gstatic.com/",
  "https://cdnjs.cloudflare.com/",
  "https://cdn.jsdelivr.net/",
  "https://ka-f.fontawesome.com/"
];

const mediaSrcUrls = [
  "'self'",
  "blob:",
  "https://res.cloudinary.com/",
  "https://drive.google.com/",
  "https://www.google.com/",
  "https://www.dropbox.com/",
  "https://dl.dropboxusercontent.com/" // Allow direct Dropbox links
];

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'", "blob:"],
      formAction: ["'self'"],
      frameSrc: ["'self'", ...frameSrcUrls],
      connectSrc: ["'self'", ...connectSrcUrls],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...scriptSrcUrls],
      scriptSrcElem: ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...scriptSrcUrls],
      styleSrc: ["'self'", "'unsafe-inline'", ...styleSrcUrls],
      styleSrcElem: ["'self'", "'unsafe-inline'", ...styleSrcUrls],
      workerSrc: ["'self'", "blob:"],
      objectSrc: [],
      imgSrc: ["'self'", "blob:", "data:", ...imgSrcUrls],
      fontSrc: ["'self'", ...fontSrcUrls, "data:"],
      mediaSrc: [...mediaSrcUrls],
      "script-src-attr": ["'unsafe-inline'"], 
    },
  })
);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests from this IP, please try again later."
});
app.use(limiter);

app.use(xss());
app.use(mongoSanitize());

// Database Connection
mongoose.connect(dbUrl, {
    serverSelectionTimeoutMS: 5000
}).catch(err => console.error("MongoDB Connection Error:", err));

const db = mongoose.connection;
db.on("error", console.error.bind(console, "Connection error:"));
db.once("open", () => {
    console.log("✅ Database Connected");
});

// Session Store
const store = new MongoDBStore({
    uri: dbUrl,
    collection: "sessions",
    touchAfter: 24 * 3600,
});
store.on("error", (error) => {
    console.error("❌ Session Store Error:", error);
});

// Session Configuration
app.use(session({
    secret: secret,
    name: "_editEdge",
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24 * 7,
    },
}));

// Middleware
app.use(bodyParser.urlencoded({ extended: true, limit: "10kb" }));
app.use(bodyParser.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public"), {
    etag: true,
    lastModified: true
}));
app.set("view engine", "ejs");
app.set("trust proxy", 1);

// Logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - ${req.ip}`);
    next();
});

// OpenAI Setup
let openai;
try {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
} catch (error) {
    console.error("Failed to initialize OpenAI:", error);
}

// Routes
app.get("/", (req, res) => res.render("home"));
app.post("/select-branding", (req, res) => {
    const contentType = req.body.contentType;
    if (!contentType) return res.status(400).send("Content type is required");
    switch(contentType) {
        case "social": res.redirect("/social-media/branding-social"); break;
        case "article": res.redirect("/blog-article/branding-article"); break;
        default: res.redirect("/select-content");
    }
});
app.get("/select-content", (req, res) => res.render("select-content"));
app.use('/social-media', socialMediaRoute);
app.use('/blog-article', articleBlogRoute);

// Error Handling
app.use((req, res) => res.status(404).send("Page not found"));
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send("Something went wrong!");
});

// Start Server
const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received: closing server');
    server.close(() => {
        mongoose.connection.close();
        console.log('Server closed');
        process.exit(0);
    });
});