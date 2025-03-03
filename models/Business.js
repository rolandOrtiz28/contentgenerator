const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const bcrypt = require('bcrypt');

const businessSchema = new Schema({
  companyName: { type: String, required: true },
  description: { type: String, required: true },
  targetAudience: { type: String, required: true },
  services: { type: String, required: true },
  focusService: { type: String, required: true },
  password: { type: String, required: true }, // Store hashed password
  createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
businessSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10); // Hash with salt rounds 10
  }
  next();
});

// Method to check password
businessSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Business', businessSchema);