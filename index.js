require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      "http://localhost:8080",
      "https://content.editedgemultimedia.com",
      "https://app-aagi02dfpgs.canva-apps.com",
      "https://ai.editedgemultimedia.com"
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

app.options('*', cors());   

app.use((req, res, next) => {
  res.on('finish', () => {
    console.log('Response Headers:', res.getHeaders());
  });
  next();
});

const bodyParser = require("body-parser");
const OpenAI = require("openai");
const session = require("express-session");
const MongoDBStore = require("connect-mongodb-session")(session);
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const xss = require("xss-clean");
const mongoSanitize = require("express-mongo-sanitize");

const passport = require('passport');

const billingWebhookRoute = require('./routes/billing-webhook');
const socialMediaRoute = require('./routes/socialMediaContent');
const articleBlogRoute = require('./routes/articleBlogContent');
const businessRoute = require('./routes/business');
const contentRoutes = require('./routes/content');
const userRoutes = require('./routes/user');
const authRoute = require('./routes/auth');
const billingRoutes = require('./routes/billing');
const imageRoutes = require('./routes/imageRoutes');

require('./config/passport'); // Initialize Passport


const PORT = process.env.PORT || 3000;

const secret = process.env.SESSION_SECRET || "default-secret-please-change-me";
const dbUrl = process.env.DB_URL;
// || "mongodb://127.0.0.1:27017/aicontentgenerator"
const isProduction = process.env.NODE_ENV === "production";




// Security Headers (Helmet)
const frameSrcUrls = [
  "https://js.stripe.com/",
  "https://www.sandbox.paypal.com/",
  "https://www.facebook.com/",
  "https://my.spline.design/",
  "https://drive.google.com/",
  "https://accounts.google.com/",
];

const scriptSrcUrls = [
  "https://js.stripe.com/",
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
  "https://cdn.quilljs.com/",
  "https://cdn.tailwindcss.com/",
  "https://cdn.ckeditor.com/",
];

const styleSrcUrls = [
  "https://cdn.jsdelivr.net/",
  "https://fonts.googleapis.com/",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css",
  "https://cdnjs.cloudflare.com/",
  "https://kit-free.fontawesome.com/",
  "https://api.mapbox.com/",
  "https://api.tiles.mapbox.com/",
  "https://cdn.quilljs.com/",
];

const connectSrcUrls = [
  "https://api.stripe.com/",
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
  "ws://localhost:3000",
  "wss://content.editedgemultimedia.com",
];

const imgSrcUrls = [
  "https://images.unsplash.com/",
  "https://app.spline.design/_assets/_icons/icon_favicon32x32.png",
  "https://cdn.jsdelivr.net/",
  "https://kit-free.fontawesome.com/",
  "https://cdnjs.cloudflare.com/",
  "https://res.cloudinary.com/",
  "https://media.istockphoto.com/",
  "https://plus.unsplash.com/",
  "https://mdbcdn.b-cdn.net/",
];

const fontSrcUrls = [
  "https://fonts.gstatic.com/",
  "https://cdnjs.cloudflare.com/",
  "https://cdn.jsdelivr.net/",
  "https://ka-f.fontawesome.com/",
];

const mediaSrcUrls = [
  "'self'",
  "blob:",
  "https://res.cloudinary.com/",
  "https://drive.google.com/",
  "https://www.google.com/",
  "https://www.dropbox.com/",
  "https://dl.dropboxusercontent.com/",
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

// Rate Limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: "Too many requests from this IP, please try again later.",
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 50 : 500,
  message: "Too many API requests from this IP, please try again later.",
});

// Apply rate limiting to non-webhook routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/billing/webhook')) {
    return next(); // Skip rate limiting for webhook
  }
  if (req.path.startsWith('/socket.io/')) {
    return next();
  }
  generalLimiter(req, res, next);
});

app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/billing/webhook')) {
    return next(); // Skip API limiter for webhook
  }
  apiLimiter(req, res, next);
});

// Security Middleware
app.use(xss());
app.use(mongoSanitize());

// Mount the webhook route at the very top, before any other middleware
app.use('/api/billing/webhook', billingWebhookRoute);

// Database Connection
mongoose.connect(dbUrl, {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log("✅ Database Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

const db = mongoose.connection;
db.on("error", (err) => {
  console.error("❌ MongoDB Connection Error:", err);
});
db.once("open", () => {
  console.log("✅ MongoDB Connection Established");
});

// Session Store
const store = new MongoDBStore({
  uri: dbUrl,
  collection: "sessions",
});
store.on("connected", () => {
  console.log("✅ MongoDB session store connected");
});

store.on("error", (error) => {
  console.error("❌ Session store error:", error);
});

// Session Configuration
app.use(
  session({
    secret: secret,
    name: "_editEdge",
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// Add logging to verify session middleware
app.use((req, res, next) => {
  next();
});

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Verify Passport session setup
app.use((req, res, next) => {
  console.log('Passport middleware - User:', req.user?.name || 'Not Logged In');
  console.log('Passport middleware - Authenticated:', req.isAuthenticated?.() || false);
  next();
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true, limit: "10kb" }));
app.use(express.json({ limit: "10kb" }));
app.use(express.static("public", {
  etag: true,
  lastModified: true,
}));
app.set("trust proxy", 1);

// Request Logging
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
  console.log("✅ OpenAI Initialized");
} catch (error) {
  console.error("❌ Failed to initialize OpenAI:", error);
}

// API Routes
app.use('/api/auth', authRoute);
app.use('/api/social-media', socialMediaRoute);
app.use('/api/blog-article', articleBlogRoute);
app.use('/api/business', businessRoute);
app.use('/api/content', contentRoutes);
app.use('/api/user', userRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/images', imageRoutes);

// Error Handling
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
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