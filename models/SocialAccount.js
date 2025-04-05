const mongoose = require("mongoose");

const socialAccountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  platform: { type: String, required: true, enum: ["facebook", "linkedin"] },
  accountId: { type: String, required: true },
  accessToken: { type: String, required: true },
  refreshToken: { type: String },
  expiresAt: { type: Date },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business" }, // Add this field
});

module.exports = mongoose.model("SocialAccount", socialAccountSchema);