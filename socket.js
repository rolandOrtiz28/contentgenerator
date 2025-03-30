// backend/socket.js
let io;

module.exports = {
  init: (server) => {
    const { Server } = require("socket.io");
    io = new Server(server, {
      cors: {
        origin: [
          "http://localhost:8080",
          "https://content.editedgemultimedia.com",
          "https://ai.editedgemultimedia.com",
        ],
        credentials: true,
      },
    });

    io.on("connection", (socket) => {
      console.log("🟢 Socket connected:", socket.id);
      socket.on("disconnect", () => {
        console.log("🔴 Socket disconnected:", socket.id);
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) throw new Error("Socket.io not initialized!");
    return io;
  },
  // Add emitLog function to send logs to connected clients
  emitLog: (message) => {
    if (io) {
      io.emit("backendLog", { message });
    }
  },
  logAndEmitError(...args) {
    const message = args.join(" ");
    emitLog(`ERROR: ${message}`);
    console.error(...args);
  }
};