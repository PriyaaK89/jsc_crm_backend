const minioClient = require("../config/minio");
const { v4: uuidv4 } = require("uuid");

const BUCKET = "jsc-crm";

const folderMap = {
  user_document: "users/documents",
  profile_image: "users/profile",
  attendance_photo: "attendance/photos",
  product_image: "products/images",
  employee_letters: "employee/letter"
};

exports.imageUpload = async (req, res) => {
  try {

    const file = req.file;
    const type = req.body.type;

    if (!file) {
      return res.status(400).json({
        message: "Image file is required"
      });
    }

    if (!type || !folderMap[type]) {
      return res.status(400).json({
        message: "Invalid upload type"
      });
    }

    const folder = folderMap[type];

    const fileExtension = file.originalname.split(".").pop();

    const fileName = `${folder}/${uuidv4()}.${fileExtension}`;

    await minioClient.putObject(
      BUCKET,
      fileName,
      file.buffer,
      file.size,
      { "Content-Type": file.mimetype }
    );

    const image_url = `${process.env.MINIO_PUBLIC_URL}/${BUCKET}/${fileName}`;

    res.json({
      message: "Image uploaded successfully",
      image_url
    });

  } catch (error) {

    res.status(500).json({
      error: error.message
    });

  }
};