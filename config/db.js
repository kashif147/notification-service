const mongoose = require("mongoose");
const logger = require("./logger.js");

exports.mongooseConnection = async () => {
  try {
    const mongoUri =
      process.env.MONGO_URI ||
      `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@clusterprojectshell.tptnh8w.mongodb.net/${process.env.MONGO_DB}/?retryWrites=true&w=majority&appName=ClusterProjectShell`;

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

