// imageRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { storage, cloudinary } = require("../config/cloudinary");
const { ensureAuthenticated } = require("../middleware/auth");
const upload = multer({ storage });
const Image = require("../models/Image");

// Upload Image
router.post("/upload", ensureAuthenticated, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "Image upload failed" });
    }

    const { businessId } = req.body;
    const newImage = new Image({
      url: req.file.path,
      publicId: req.file.filename,
      businessId,
      order: 0,
      caption: "",
      altText: "",
      tags: [],
    });

    await newImage.save();

    res.status(200).json({
      image: newImage,
      previewUrl: cloudinary.url(req.file.filename, { width: 400, crop: "scale" }),
    });
  } catch (err) {
    res.status(500).json({ error: "Upload failed" });
  }
});

// Get Images by Business
router.get("/business/:businessId", ensureAuthenticated, async (req, res) => {
  try {
    const images = await Image.find({ businessId: req.params.businessId }).sort({ order: 1 });
    res.status(200).json({ images });
  } catch (err) {
    res.status(500).json({ error: "Failed to load images" });
  }
});

// Update Image Metadata
router.patch("/:imageId", ensureAuthenticated, async (req, res) => {
  try {
    const updates = (({ caption, altText, tags }) => ({ caption, altText, tags }))(req.body);
    const image = await Image.findByIdAndUpdate(req.params.imageId, updates, { new: true });
    if (!image) return res.status(404).json({ error: "Image not found" });
    res.status(200).json({ image });
  } catch (err) {
    res.status(500).json({ error: "Failed to update image" });
  }
});

// Delete Image
router.delete("/:imageId", ensureAuthenticated, async (req, res) => {
  try {
    const image = await Image.findById(req.params.imageId);
    if (!image) return res.status(404).json({ error: "Image not found" });

    await cloudinary.uploader.destroy(image.publicId);
    await image.deleteOne();

    res.status(200).json({ message: "Image deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete image" });
  }
});

// Reorder Images (Drag & Drop)
router.patch("/reorder", ensureAuthenticated, async (req, res) => {
  try {
    const updates = req.body;
    const bulkOps = updates.map(img => ({
      updateOne: {
        filter: { _id: img._id },
        update: { $set: { order: img.order } }
      }
    }));
    await Image.bulkWrite(bulkOps);
    res.status(200).json({ message: "Image order updated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to reorder images" });
  }
});

// Cleanup All Images by Business
router.delete("/business/:businessId", ensureAuthenticated, async (req, res) => {
  try {
    const images = await Image.find({ businessId: req.params.businessId });
    for (const img of images) {
      await cloudinary.uploader.destroy(img.publicId);
      await img.deleteOne();
    }
    res.status(200).json({ message: "All images deleted for business" });
  } catch (err) {
    res.status(500).json({ error: "Cleanup failed" });
  }
});

router.get("/cloud/:businessId", ensureAuthenticated, async (req, res) => {
  try {
    const images = await Image.find({ businessId: req.params.businessId }).select("url label description tags _id");
    res.status(200).json({ images });
  } catch (err) {
    console.error("Failed to load cloud images:", err); // ADD THIS
    res.status(500).json({ error: "Failed to load cloud images" });
  }
});

router.get("/accessible-cloud", ensureAuthenticated, async (req, res) => {
  try {
    const businessId = req.session.businessId || req.query.businessId;
    if (!businessId) {
      return res.status(400).json({ error: "No businessId provided" });
    }
    const images = await Image.find({ businessId }).select("url label description tags _id");
    res.status(200).json({ images });
  } catch (err) {
    res.status(500).json({ error: "Failed to load cloud images" });
  }
});

module.exports = router;
