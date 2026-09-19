FROM node:20-alpine
WORKDIR /app
COPY package.json server.js index.html styles.css app.js device.html device.css device.js manifest.json icon.svg sw.js pwa.js .env.example ./
COPY data ./data
COPY supabase ./supabase
EXPOSE 4173
ENV PORT=4173
CMD ["node", "server.js"]
