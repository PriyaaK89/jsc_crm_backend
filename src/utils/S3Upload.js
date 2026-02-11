const { PutObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require("../config/s3");

const uploadToS3 = async (file, userId, folder = "users") => {
  const key = `${folder}/${userId}/${Date.now()}-${file.originalname}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    })
  );

  return {
    bucket: process.env.AWS_BUCKET_NAME,
    key,
    url: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
    mimeType: file.mimetype,
    sizeKb: Math.round(file.size / 1024)
  };
};

module.exports = uploadToS3;
