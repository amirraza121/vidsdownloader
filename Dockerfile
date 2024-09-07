FROM node:18

# Install yt-dlp
RUN apt-get update && apt-get install -y wget
RUN wget https://github.com/yt-dlp/yt-dlp/releases/download/2024.09.05/yt-dlp-linux -O /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Expose port and start server
EXPOSE 3000
CMD ["node", "server.js"]
