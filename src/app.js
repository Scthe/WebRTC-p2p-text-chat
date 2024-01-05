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

  const createNewRoom = () => {
    const roomId = nanoid(10); // "jNdKguxVBe";
    socket.join(roomNs(roomId));
    socket.emit("room-created", roomId);
  };

  socket.on("create-room", createNewRoom);

  socket.on("join-room", (roomId) => {
    const { rooms } = io.sockets.adapter;
    const room = rooms.get(roomNs(roomId));
    if (!room) {
      logSocket(`User tried joining room '${roomId}' that does not exist?`);
      createNewRoom();
    } else {
      socket.join(roomNs(roomId));
      // everyone gets it but the sender
      socket.broadcast.to(roomNs(roomId)).emit("new-user-joined", userId);
    }
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

  socket.on("disconnecting", () => {
    // No need to remove from rooms, 'socket.io' already does that for us.
    // Just inform other users that the peer might have DCed
    const chatRooms = getChatRooms(socket);
    console.log("Disconnecting from rooms:", chatRooms);
    chatRooms.forEach((roomId) =>
      socket.broadcast.to(roomId).emit("user-disconnected", userId),
    );
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

const CHAT_ROOM_NS = "chat-room";

const roomNs = (roomId) => `${CHAT_ROOM_NS}/${roomId}`;

const getChatRooms = (socket) => {
  const { rooms } = socket;
  return [...rooms].filter((e) => e.startsWith(CHAT_ROOM_NS));
};

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
