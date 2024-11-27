const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { promisify } = require("util");
const convert = require("heic-convert");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const cors = require("cors");
const { v1: uuidv1, v4: uuidv4 } = require("uuid");
require("dotenv").config();
const sharp = require("sharp");
const Jimp = require("jimp");
// Supabase Configuration
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
// Tạo thư mục lưu trữ file upload nếu chưa tồn tại
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Cấu hình multer để lưu file tạm thời
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024, // Giới hạn kích thước file 50MB
  },
});

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// Tăng giới hạn kích thước payload
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
// Hàm xóa tất cả các file trong thư mục
const clearUploadDir = async () => {
  try {
    const files = await promisify(fs.readdir)(uploadDir);
    const deletePromises = files.map((file) => {
      const filePath = path.join(uploadDir, file);
      return promisify(fs.unlink)(filePath).catch((err) => {
        console.error(`Failed to delete file ${filePath}:`, err);
      });
    });
    await Promise.all(deletePromises);
  } catch (err) {
    console.error("Error clearing upload directory:", err);
  }
};

// Route upload và xử lý file
app.post("/convert-heic", upload.any(), async (req, res) => {
  try {
    // Kiểm tra file upload
    if (!req.files || req.files.length === 0) {
      return res.status(400).send("No files uploaded.");
    }

    if (req.files.length > 5) {
      return res.status(400).send("Max 5 files are allowed.");
    }

    console.log(req.files);

    const convertedFiles = []; // Mảng lưu trữ thông tin file đã chuyển đổi

    for (const file of req.files) {
      try {
        let outputBuffer;
        let contentType;

        if (file.size > 50 * 800 * 800) {
          return res.status(400).send("File size too large.");
        }

        if (
          path.extname(file.originalname).toLowerCase() === ".heic" ||
          path.extname(file.originalname).toLowerCase() === ".HEIC" ||
          path.extname(file.originalname).toLowerCase() === ".heif" ||
          path.extname(file.originalname).toLowerCase() === ".HEIF"
        ) {
          // Đọc file HEIC
          console.log("file đổi nè", file);
          const inputBuffer = await promisify(fs.readFile)(file.path);

          // Chuyển đổi sang JPEG
          outputBuffer = await convert({
            buffer: inputBuffer, // Buffer từ file HEIC
            format: "JPEG", // Định dạng đầu ra
            quality: 1, // Chất lượng JPEG (0 - 1)
          });

          contentType = "image/jpeg";
        } else {
          // Đọc file không phải HEIC
          outputBuffer = await promisify(fs.readFile)(file.path);
          contentType = file.mimetype;
        }

        // Resize the image only if it is larger than 800 pixels in either dimension

        let uid = uuidv4();

        console.log("avatar", file.fieldname);
        const parts = file.fieldname.split("/");
        const beforeSlash = parts[0];
        const afterSlash = parts[1];

        // Tạo tên file cho storage
        const storagePath = `${beforeSlash}/${path.parse(uid).name}`;

        // Tải lên Supabase Storage
        const { data, error } = await supabase.storage
          .from(`${afterSlash}`) // Thay 'images' bằng tên bucket của bạn
          .upload(storagePath, outputBuffer, {
            contentType: contentType,
            upsert: true,
          });

        if (error) {
          return res.status(400).json({ error: error.message });
        }

        // Lấy URL công khai từ Supabase Storage
        const { data: publicUrlData, error: errorGetUrl } = supabase.storage
          .from(`${afterSlash}`) // Thay 'images' bằng tên bucket của bạn
          .getPublicUrl(storagePath);

        if (errorGetUrl) {
          return res.status(400).json({ error: errorGetUrl.message });
        }
        // Thêm thông tin file vào danh sách
        convertedFiles.push(publicUrlData.publicUrl);

        // Xóa file tạm
        await promisify(fs.unlink)(file.path);
      } catch (fileError) {
        return res.status(400).json({ error: fileError.message });
      }
    }

    if (convertedFiles.length === 0) {
      return res.status(400).json({ error: "No files converted." });
    }

    // Trả về danh sách các file đã chuyển đổi và URL từ Supabase Storage
    res.status(200).json(convertedFiles);

    // Xóa tất cả file trong thư mục uploads sau khi phản hồi
    clearUploadDir();
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
