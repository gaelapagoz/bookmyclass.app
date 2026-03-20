import { config } from "dotenv";

config({ path: ".env.test" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env.test.");
}

if (!process.env.DATABASE_URL.includes("test")) {
  throw new Error("Test DB must contain 'test' in its name.");
}
