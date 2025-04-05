const express = require("express");
const passport = require("passport");
const FacebookStrategy = require("passport-facebook").Strategy;
const LinkedInStrategy = require("passport-linkedin-oauth2").Strategy;
const router = express.Router();
const SocialAccount = require("../models/SocialAccount");
const User = require("../models/User");
const { requireSubscription } = require("../middleware/subscription"); // Add this
const { ensureAuthenticated } = require('../middleware/auth');

// Passport setup for Facebook
passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: "https://content.editedgemultimedia.com/api/user/social-accounts/auth/facebook/callback",
      scope: ["pages_manage_posts", "pages_read_engagement"],
      profileFields: ["id"],
      passReqToCallback: true, // IMPORTANT!
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const user = req.user;
        if (!user) return done(new Error("No authenticated user"));

        let account = await SocialAccount.findOne({
          userId: user._id,
          platform: "facebook",
        });

        if (!account) {
          account = new SocialAccount({
            userId: user._id,
            platform: "facebook",
            accountId: profile.id,
            accessToken,
          });
        } else {
          account.accessToken = accessToken;
        }

        await account.save(); // Make sure it's persisted
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);


// Passport setup for LinkedIn
passport.use(
  new LinkedInStrategy(
    {
      clientID: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      callbackURL: "https://content.editedgemultimedia.com/api/user/social-accounts/linkedin/callback",
      scope: ["w_member_social"],
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const user = req.user;
        if (!user) return done(new Error("No authenticated user"));

        let account = await SocialAccount.findOne({
          userId: user._id,
          platform: "linkedin",
        });

        if (!account) {
          account = new SocialAccount({
            userId: user._id,
            platform: "linkedin",
            accountId: profile.id,
            accessToken,
            refreshToken,
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          });
        } else {
          account.accessToken = accessToken;
          account.refreshToken = refreshToken;
          account.expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        }

        await account.save();
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Serialize/deserialize user for Passport
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});


// Middleware to validate businessId
const validateBusiness = async (req, res, next) => {
  const { businessId } = req.query;
  if (!businessId) {
    return res.status(400).json({ error: "Business ID is required" });
  }

  const user = await User.findById(req.user._id);
  if (!user.businesses.includes(businessId)) {
    return res.status(403).json({ error: "You do not have access to this business" });
  }

  req.businessId = businessId;
  next();
};

// Routes for Facebook
router.get(
  "/facebook",
  ensureAuthenticated,
  requireSubscription, // Add this
  validateBusiness,
  (req, res, next) => {
    passport.authenticate("facebook", {
      scope: ["pages_manage_posts", "pages_read_engagement"],
      state: req.query.businessId
    })(req, res, next);
  }
);
router.get(
  "/auth/facebook/callback",
  passport.authenticate("facebook", { failureRedirect: "/login" }),
  async (req, res) => {
    const businessId = req.query.state;
    await SocialAccount.updateOne(
      { userId: req.user._id, platform: "facebook" },
      { $set: { businessId } }
    );
    res.redirect("/dashboard");
  }
);


// Routes for LinkedIn
router.get(
  "/linkedin",
  ensureAuthenticated,
  requireSubscription, // Add this
  validateBusiness,
  (req, res, next) => {
    passport.authenticate("linkedin", {
      scope: ["w_member_social"],
      state: req.query.businessId
    })(req, res, next);
  }
);
router.get(
  "/linkedin/callback",
  passport.authenticate("linkedin", { failureRedirect: "/login" }),
  async (req, res) => {
    const businessId = req.query.state;
    await SocialAccount.updateOne(
      { userId: req.user._id, platform: "linkedin" },
      { $set: { businessId } }
    );
    res.redirect("/dashboard");
  }
);

// Route to list connected accounts
router.get("/", ensureAuthenticated, requireSubscription, async (req, res) => {
  const accounts = await SocialAccount.find({ userId: req.user._id });
  res.json({ accounts });
});

// Admin route for EditEdge users to view client accounts
router.get("/client/:businessId", ensureAuthenticated, async (req, res) => {
  if (!req.user.isEditEdgeUser) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  const accounts = await SocialAccount.find({ businessId: req.params.businessId });
  res.json(accounts);
});

module.exports = router;