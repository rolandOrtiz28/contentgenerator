const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Business",
    required: true
  },
  url: String,
  public_id: String,
  label: String,
  description: String,
  tags: [String],
}, { timestamps: true });

module.exports = mongoose.model("Image", imageSchema);
