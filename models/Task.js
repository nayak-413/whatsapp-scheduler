const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema({
  to: String,
  type: String,
  message: String,
  caption: String,
  mediaUrl: String,
  time: Date,
  sent: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("Task", TaskSchema);
