import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        return {
            folder: "users",               
            resource_type: "image",
            public_id: `${Date.now()}-${file.originalname}`,
        };
    },
});

export const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (
            file.mimetype === "image/jpeg" ||
            file.mimetype === "image/jpg" ||
            file.mimetype === "image/png"
        ) {
            cb(null, true);
        } else {
            cb(new Error("Invalid file type. Only jpg, jpeg, png allowed."), false);
        }
    },
});

export const uploadFields = upload.fields([
    { name: "profilePhoto", maxCount: 1 },
    { name: "licensePhoto", maxCount: 2 },
]);