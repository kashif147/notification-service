const mongoose = require("mongoose");
const logger = require("./logger.js");

exports.mongooseConnection = async () => {
  // No built-in fallback: without MONGO_URI the service must not start, and it must never connect
  // with a default credential.
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is not set; refusing to start without database configuration");
  }
  try {

    const options = {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 15000,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
    };

    await mongoose.connect(mongoUri, options).then((data) => {
      logger.info(
        { db: data.connection.name },
        "Successfully connected to MongoDB"
      );
    });
  } catch (e) {
    logger.error({ error: e.message }, "Unable to connect to database");
    throw e;
  }
};

exports.disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected");
  } catch (e) {
    logger.error({ error: e.message }, "Error disconnecting from database");
  }
};

