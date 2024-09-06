const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const http = require("http");
const socketIo = require("socket.io");
const { URL } = require("url"); // For URL validation

const app = express();
const port = process.env.PORT || 4000;
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// Directory for temporary files
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const runningProcesses = new Map();
const RECAPTCHA_SECRET_KEY =
  process.env.RECAPTCHA_SECRET_KEY ||
  "6LdItjgqAAAAALWbkFRObFwDL04UQ9zmAEFgdTMw"; // Use production key

async function getNodeFetch() {
  return (await import("node-fetch")).default;
}

app.post("/download", async (req, res) => {
  const { url, recaptchaResponse } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).send("Invalid URL");
  }

  try {
    const fetch = await getNodeFetch();
    const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${recaptchaResponse}`;
    const recaptchaRes = await fetch(verificationUrl, { method: "POST" });
    const recaptchaData = await recaptchaRes.json();

    if (!recaptchaData.success) {
      return res.status(400).send("reCAPTCHA verification failed");
    }

    console.log("Downloading video from URL:", url);

    const uniqueFileName = `video_${uuidv4()}.mp4`;
    const output = path.join(tempDir, uniqueFileName);

    const command = `yt-dlp -f "bestvideo+bestaudio[ext=m4a]/best" --merge-output-format mp4 -o "${output}" ${url}`;
    const process = exec(command);

    runningProcesses.set(process.pid, { process, output });

    process.stdout.on("data", (data) => {
      const progress = parseProgress(data);
      if (progress) {
        io.emit("downloadProgress", progress);
      }
    });

    process.on("close", (code) => {
      runningProcesses.delete(process.pid);
      if (code === 0) {
        res.download(output, uniqueFileName, (err) => {
          cleanupFile(output);
          if (err) {
            console.error("Error sending file:", err);
            res.status(500).send("Error sending file");
          }
        });
      } else {
        console.error(`Download process exited with code ${code}`);
        cleanupFile(output);
        res.status(500).send("Error downloading video");
      }
    });

    process.on("error", (err) => {
      runningProcesses.delete(process.pid);
      cleanupFile(output);
      console.error("Process error:", err);
      res.status(500).send("Error downloading video");
    });

    res.on("aborted", () => {
      console.log("Request aborted by the client");
      process.kill();
      cleanupFile(output);
    });
  } catch (error) {
    console.error("Error in try block:", error);
    res.status(500).send(`Error downloading video: ${error.message}`);
  }
});

function parseProgress(data) {
  const match = data.toString().match(/(\d+.\d+)%/);
  return match ? parseFloat(match[1]) : null;
}

function cleanupFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
      else console.log("Temporary file deleted:", filePath);
    });
  }
}

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function shutdown() {
  console.log("Shutting down server...");
  runningProcesses.forEach(({ process, output }) => {
    process.kill();
    cleanupFile(output);
  });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
