const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid"); // For generating unique file names
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const port = process.env.PORT || 4000;
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// Define the directory where you want to save temporary files
const tempDir = path.join(__dirname, "temp");

// Ensure the directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Store running processes
const runningProcesses = new Map();

// Dynamic import for node-fetch
async function getNodeFetch() {
  return (await import("node-fetch")).default;
}

app.post("/download", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    console.log("Invalid URL:", url);
    return res.status(400).send("Invalid URL");
  }

  try {
    console.log("Downloading video from URL:", url);

    // Generate a unique file name for the download
    const uniqueFileName = `video_${uuidv4()}.mp4`;
    const output = path.join(tempDir, uniqueFileName); // Save file in the temp directory
    console.log(output);

    const command = `yt-dlp -f "bestvideo+bestaudio[ext=m4a]/best" --merge-output-format mp4 -o "${output}" ${url}`;
    const process = exec(command);

    // Store the process in the map
    runningProcesses.set(process.pid, { process, output });

    process.stdout.on("data", (data) => {
      // Emit download progress to the client
      const progress = parseProgress(data);
      if (progress) {
        io.emit("downloadProgress", progress);
      }
    });

    process.on("close", (code) => {
      runningProcesses.delete(process.pid); // Remove process from map
      if (code === 0) {
        console.log("Download complete");
        res.download(output, uniqueFileName, (err) => {
          if (err) {
            console.error("Error sending file:", err);
            cleanupFile(output); // Delete file if there's an error sending it
          } else {
            cleanupFile(output); // Delete the file after it has been sent to the user
          }
        });
      } else {
        console.error("Download process exited with code:", code);
        cleanupFile(output); // Delete the file if the download was interrupted
        res.status(500).send("Error downloading video");
      }
    });

    process.on("error", (err) => {
      runningProcesses.delete(process.pid); // Remove process from map
      console.error("Process error:", err);
      cleanupFile(output); // Delete the file if there was an error during the download
      res.status(500).send("Error downloading video");
    });

    // Listen for the 'aborted' event to clean up the file if the request is aborted
    res.on("aborted", () => {
      console.log("Request aborted by the client");
      process.kill(); // Kill the process
      cleanupFile(output); // Clean up the temporary file
    });
  } catch (error) {
    console.error("Error in try block:", error);
    res.status(500).send("Error downloading video");
  }
});

function parseProgress(data) {
  // Parse the progress from yt-dlp output (simplified version)
  const match = data.match(/(\d+.\d+)%/);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

function cleanupFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
      else console.log("Temporary file deleted:", filePath);
    });
  }
}

// Handle server shutdown to clean up any running processes
function shutdown() {
  console.log("Shutting down server...");
  runningProcesses.forEach(({ process, output }) => {
    console.log(`Terminating process ${process.pid}`);
    process.kill();
    cleanupFile(output);
  });
  process.exit(0);
}

// Handle server interruption signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
