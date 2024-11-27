const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const heicConvert = require("heic-convert");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());

// Tăng giới hạn kích thước payload
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
const upload = multer({ dest: "uploads/" }); // Thư mục tạm lưu file upload

// Supabase configuration
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Xóa tất cả các file trong thư mục upload
const clearUploadDir = async (directory) => {
  try {
    const files = await promisify(fs.readdir)(directory);
    const deletePromises = files.map((file) =>
      promisify(fs.unlink)(path.join(directory, file))
    );
    await Promise.all(deletePromises);
    console.log(`Directory ${directory} has been cleared.`);
  } catch (err) {
    console.error(`Failed to clear directory ${directory}:`, err);
  }
};

// Chuyển đổi HEIC sang JPEG/WebP
async function convertHeicToJpeg(inputPath, outputPath) {
  const inputBuffer = await promisify(fs.readFile)(inputPath);
  const outputBuffer = await heicConvert({
    buffer: inputBuffer,
    format: "JPEG", // Hoặc 'WEBP' nếu muốn chuyển đổi sang WebP
    quality: 0.5, // Chất lượng (0.8 tương đương 80%)
  });
  await promisify(fs.writeFile)(outputPath, outputBuffer);
}

app.post("/convert-heic", upload.any(), async (req, res) => {
  try {
    console.log("Processing files:", req.files);

    if (!req.files || req.files.length === 0) {
      return res.status(400).send("No files uploaded");
    }

    if (req.files.length > 5) {
      return res
        .status(400)
        .send("You can upload a maximum of 5 files at a time.");
    }

    const maxFileSize = 20 * 1024 * 1024; // 20MB
    const uploadedFiles = [];

    for (const file of req.files) {
      if (file.size > maxFileSize) {
        return res
          .status(400)
          .send(
            `File size exceeds the limit of ${maxFileSize / (1024 * 1024)}MB.`
          );
      }

      const inputPath = file.path; // File upload tạm thời
      const outputFileName = `${path.parse(file.originalname).name}.jpg`; // Đổi thành .jpg
      const outputPath = `uploads/${outputFileName}`;

      // Chuyển đổi HEIC sang JPEG
      if (file.mimetype === "image/heic" || file.mimetype === "image/heif") {
        await convertHeicToJpeg(inputPath, outputPath);
      } else {
        await promisify(fs.copyFile)(inputPath, outputPath);
      }

      // Đọc nội dung file JPEG đã chuyển đổi
      const jpegBuffer = fs.readFileSync(outputPath);
      const uid = uuidv4();

      const parts = file.fieldname.split("/");
      const beforeSlash = parts[0];
      const afterSlash = parts[1];

      if (!beforeSlash) {
        return res.status(400).send("Uuid is null");
      }

      const storagePath = `${beforeSlash}/${path.parse(uid).name}`;

      // Upload file lên Supabase Storage
      const { data, error } = await supabase.storage
        .from(afterSlash)
        .upload(storagePath, jpegBuffer, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      const { data: publicURL, error: urlError } = supabase.storage
        .from(afterSlash)
        .getPublicUrl(storagePath);

      if (urlError) {
        return res.status(400).json({ error: urlError.message });
      }

      uploadedFiles.push(publicURL.publicUrl);
    }

    res.status(200).json(uploadedFiles);
  } catch (error) {
    console.error("Error processing files:", error);
    res.status(400).send("Error processing files");
  } finally {
    await clearUploadDir("uploads"); // Xóa thư mục tạm
  }
});

// Khởi động server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
