const { uploadFileToMinio } = require("../utils/fileUpload");

exports.imageUpload = async (req, res) => {
  try {
    const file = req.file;
    const type = req.body.type;

    const result = await uploadFileToMinio(file, type);

    res.json({
      message: "File uploaded successfully",
      object_path: result.object_path,
      file_url: result.file_url
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};