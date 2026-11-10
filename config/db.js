
const mongoose = require("mongoose");
require("./dns");

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGO_URI;

        if (!mongoURI) {
            throw new Error(
                "Missing MONGO_URI in .env file"
            );
        }

        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 10000
        });

        console.log("MongoDB Connected!");
        console.log("Database:", mongoose.connection.name);

    } catch (error) {
        console.error(
            "MongoDB connection failed:",
            error.message
        );

        throw error;
    }
};

module.exports = connectDB;
