// Creates (or resets) thce admin account defined in .env
// Run with: npm run seed
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const email = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "Admin123!";

  
  let admin = await User.findOne({ email });
  if (admin) {
    admin.password = password; // will be re-hashed by the pre-save hook
    admin.role = "admin";
    await admin.save();
    console.log(`Existing user updated to admin: ${email}`);
  } else {
    admin = await User.create({ name: "Administrator", email, password, role: "admin" });
    console.log(`Admin account created: ${email}`);
  }

  console.log(`Login with email: ${email}  password: ${password}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
