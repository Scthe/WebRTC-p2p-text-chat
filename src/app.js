const express = require("express");
const chalk = require("chalk");
const { nanoid } = require("nanoid");
const { Server } = require("socket.io");

// TODO auto-tunnel so we can test p2p outside local network? Does tunelling work with sockets?
const EXPRESS_PORT = 3000;

// Express server to serve HTML
const app = express();
app.use(express.static("public"));

const server = app.listen(EXPRESS_PORT, () => {
  console.log(chalk.blue("Http started:"), `http://localhost:${EXPRESS_PORT}/`);
  console.log(
    `To connect to the room add it to the query param e.g. http://localhost:${EXPRESS_PORT}/?roomId=jNdKguxVBe`,
    "\n",
  );
});

// Socket server used for chatting
const io = new Server(server);

io.on("connection", (socket) => {
  const userId = socket.id;
  const chalkColor = getRandomChalkColor();
  logSocket(`New socket connection userId=${userId}`);

  socket.on("create-room", () => {
    const roomId = "jNdKguxVBe"; // nanoid(10);
    socket.join(roomNs(roomId));
    socket.emit("room-created", roomId);
  });

  socket.on("join-room", (roomId) => {
    // const { rooms } = io.sockets.adapter;
    // const room = rooms.get(roomId); // TODO handle if does not exist etc. Just create a new room instead?

    socket.join(roomNs(roomId));
    // everyone gets it but the sender
    socket.broadcast.to(roomNs(roomId)).emit("new-user-joined", userId);
  });

  // Forward the offer from `userId` to `peerUserId`
  socket.on("rtc-offer", (peerUserId, offer) => {
    emitToUser(peerUserId, "rtc-offer", userId, offer);
  });

  socket.on("rtc-answer", (peerUserId, answer) => {
    emitToUser(peerUserId, "rtc-answer", userId, answer);
  });

  socket.on("ice-candidate", (peerUserId, candidate) => {
    emitToUser(peerUserId, "ice-candidate", userId, candidate);
  });

  socket.on("disconnect", () => {
    // TODO inform rooms, remove from rooms
    logSocket("User disconnected");
  });

  socket.onAny((event, ...args) => {
    logSocket(`Received '${event}', args: ${JSON.stringify(args)}`);
  });

  function emitToUser(userId, ...args) {
    socket.to(userId).emit(...args);
  }

  function logSocket(...args) {
    console.log(chalk[chalkColor](`[Socket ${userId}]`), ...args);
  }
});

const roomNs = (roomId) => `chat-room/${roomId}`;

const randomFromArray = (items) =>
  items[Math.floor(Math.random() * items.length)];

function getRandomChalkColor() {
  const colors = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "redBright",
    "greenBright",
    "yellowBright",
    "blueBright",
    "magentaBright",
    "cyanBright",
  ];
  return randomFromArray(colors);
}
