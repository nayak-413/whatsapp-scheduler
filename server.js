const express = require("express");
const mongoose = require("mongoose");
const cron = require("node-cron");
const cors = require("cors");
const multer = require("multer");
const QRCode = require("qrcode");
let waStatus = "disconnected";
let waName = "";
let latestQR = "";

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");

const Task = require("./models/Task");

const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({ storage });

mongoose.connect(
  "mongodb://mongouser:Mongo%40DB_413@ac-pdt0u8x-shard-00-00.5pboehu.mongodb.net:27017,ac-pdt0u8x-shard-00-01.5pboehu.mongodb.net:27017,ac-pdt0u8x-shard-00-02.5pboehu.mongodb.net:27017/whatsappScheduler?ssl=true&replicaSet=atlas-h3p60v-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0",
);

const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
  latestQR = qr;
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp Ready");

  waStatus = "connected";
  waName = client.info.pushname || "WhatsApp User";

  io.emit("wa-status", {
    status: waStatus,
    name: waName,
  });
});

client.on("disconnected", () => {
  waStatus = "disconnected";

  io.emit("wa-status", {
    status: waStatus,
  });
});

client.initialize();

io.on("connection", (socket) => {
  socket.emit("wa-status", {
    status: waStatus,
    name: waName,
  });
});

app.post("/schedule", async (req, res) => {
  try {
    const { to, message, type, scheduleTime } = req.body;

    const task = new Task({
      to,
      message,
      type,
      time: scheduleTime,
      mediaUrl: req.body.media || "",
      sent: false,
    });

    await task.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/upload", upload.single("media"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  res.json({
    path: req.file.path,
  });
});

app.get("/tasks", async (req, res) => {
  const tasks = await Task.find().sort({ time: 1 });
  res.json(tasks);
});

app.get("/stats", async (req, res) => {
  const sent = await Task.countDocuments({ sent: true });
  const pending = await Task.countDocuments({ sent: false });

  res.json({
    sent,
    pending,
  });
});

app.get("/wa-status", (req, res) => {
  res.json({
    status: waStatus,
    name: waName,
  });
});

app.get("/qr", async (req, res) => {
  if (!latestQR) return res.json({ qr: null });
  const qrImage = await QRCode.toDataURL(latestQR);
  res.json({ qr: qrImage });
});

async function sendWhatsapp(task) {
  try {
    const number = task.to.replace(/\D/g, "");
    const chatId = number + "@c.us";

    // check if number exists on WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);

    if (!isRegistered) {
      console.log("Number not on WhatsApp:", number);
      return;
    }

    if (task.type === "text") {
      await client.sendMessage(chatId, task.message);
    }

    if (task.type === "image" || task.type === "video" || task.type === "gif") {
      if (!fs.existsSync(task.mediaUrl)) {
        console.log("Media file missing:", task.mediaUrl);
        return;
      }

      const media = MessageMedia.fromFilePath(task.mediaUrl);

      await client.sendMessage(chatId, media, {
        caption: task.caption,
      });
    }

    if (task.type === "sticker") {
      const media = MessageMedia.fromFilePath(task.mediaUrl);

      await client.sendMessage(chatId, media, {
        sendMediaAsSticker: true,
      });
    }

    if (task.type === "link") {
      await client.sendMessage(chatId, task.message);
    }

    console.log("Message sent to:", number);
  } catch (err) {
    console.log("Send error:", err.message);
  }
}

cron.schedule("* * * * *", async () => {
  const tasks = await Task.find({ sent: false });

  for (const task of tasks) {
    if (new Date(task.time) <= new Date()) {
      await sendWhatsapp(task);

      task.sent = true;
      await task.save();
    }
  }
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
