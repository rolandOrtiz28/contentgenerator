const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const businessSchema = new Schema({
  companyName: { type: String, required: true },
  description: { type: String, required: true },
  targetAudience: { type: String, required: true },
  services: { type: String, required: true },
  focusService: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Business', businessSchema);